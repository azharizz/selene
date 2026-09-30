import React from 'react';
import {AppState, BackHandler, Image, Pressable, StyleSheet, Text, View} from 'react-native';
import type {NativeEventSubscription} from 'react-native';
import type {IMediaControlClientAsync, MediaSessionState, ISubscription} from '@amazon-devices/kepler-media-controls';
import {WebView} from '@amazon-devices/webview';
import {appUrl} from './config.json';

type Session = {client: IMediaControlClientAsync; state: MediaSessionState; packageId: string; title?: string; providerName?: string};
type Snapshot = {package_id: string; session_id: number; catalog_name: string; content_id: string; title: string; provider_name: string; at_seconds: number};
type State = {busy: boolean; sessions: Session[]; selected: Session | null; title: string; message: string; snapshot: Snapshot | null; page: number};
const momentUrl = `${appUrl.replace(/\/$/, '')}/?companion=1`;
function playback(state: MediaSessionState, revision = 0, observing = false) {
  return {state: state.playbackState.playbackStatus === 'PAUSED' ? 'paused' : state.playbackState.playbackStatus === 'PLAYING' ? 'playing' : 'unknown',
    can_pause: state.capabilities.actions.some(a => a.name === 'PAUSE'), can_play: state.capabilities.actions.some(a => a.name === 'PLAY'), revision, observing};
}

function sameMedia(left: MediaSessionState, right: MediaSessionState) {
  return left.mediaInfo?.id.contentId === right.mediaInfo?.id.contentId &&
    left.mediaInfo?.id.catalogName === right.mediaInfo?.id.catalogName;
}

function positionSeconds(state: MediaSessionState) {
  const position = state.playbackState.position?.position;
  if (!position || !Number.isFinite(position.seconds) || position.seconds < 0 || !Number.isFinite(position.nanoseconds) || position.nanoseconds < 0 || position.nanoseconds > 999999999) return null;
  return position.seconds + position.nanoseconds / 1e9;
}

// Native client ownership stays here: discovery never sends a playback command.
export class Companion extends React.Component<{onDemo: () => void; onReady: () => void}, State> {
  state: State = {busy: false, sessions: [], selected: null, title: '', snapshot: null, page: 0, message: 'Finding what’s playing…'};
  private clients: IMediaControlClientAsync[] = [];
  private mounted = false;
  private pending = false;
  private revision = 0;
  private appState?: NativeEventSubscription;
  private backSubscription?: NativeEventSubscription;
  private frame = React.createRef<React.ElementRef<typeof WebView>>();
  private subscription: ISubscription | null = null;
  private momentRevision = 0;
  private playbackVersion = 0;
  private observedStatus = '';

  componentDidMount() {
    this.mounted = true;
    this.appState = AppState.addEventListener('change', state => {
      if (state !== 'active') this.disconnect('Check playback apps again when you return.');
    });
    this.backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!this.state.snapshot) return false;
      this.publish({type: 'selene:back'});
      return true;
    });
    this.props.onReady();
    this.scan();
  }
  componentWillUnmount() {
    this.mounted = false;
    this.appState?.remove(); this.backSubscription?.remove();
    this.disconnect();
  }
  private release() {this.stopObserving(); this.clients.forEach(client => client.destroy()); this.clients = [];}
  private stopObserving() {this.momentRevision++; this.subscription?.unsubscribe(); this.subscription = null;}
  private observed(state: MediaSessionState) {
    if (this.observedStatus !== state.playbackState.playbackStatus) {this.playbackVersion++; this.observedStatus = state.playbackState.playbackStatus;}
    return playback(state, this.playbackVersion, Boolean(this.subscription));
  }
  private publish(data: object) {
    this.frame.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:${JSON.stringify(data).replace(/</g, '\\u003c')}}));true;`);
  }
  private watch = async (session: Session) => {
    const revision = this.momentRevision;
    try {
      const subscription = await session.client.addListener({onStateChanged: states => {
        if (!this.mounted || revision !== this.momentRevision || !this.state.snapshot) return;
        const state = states.find(value => value.id.id === session.state.id.id);
        if (!state) return;
        if (!sameMedia(state, session.state)) {this.disconnect('The viewing app changed content. Select its current session to ask again.'); return;}
        this.setState({selected: {...session, state}});
        this.publish({type: 'selene:provider', playback: this.observed(state)});
      }});
      if (!this.mounted || revision !== this.momentRevision || !this.state.snapshot) {subscription.unsubscribe(); return;}
      this.subscription = subscription;
      if (this.state.selected) this.publish({type: 'selene:provider', playback: this.observed(this.state.selected.state)});
    } catch {
      // A provider may not support change notifications. Explicit controls still re-read its state.
      if (revision === this.momentRevision) this.subscription = null;
    }
  };
  private current(revision: number) {return this.mounted && revision === this.revision;}
  private disconnect = (message = 'Check closed. A playback command already sent may still finish.') => {
    this.revision++;
    this.pending = false;
    this.release();
    if (this.mounted) this.setState({busy: false, sessions: [], selected: null, title: '', snapshot: null, page: 0, message});
  };

  private scan = async () => {
    if (!this.mounted || this.pending) return;
    this.pending = true;
    const revision = ++this.revision;
    this.setState({busy: true, selected: null, title: '', sessions: [], page: 0, message: 'Finding what’s playing…'});
    this.release();
    try {
      const {MediaControlComponentAsync} = await import('@amazon-devices/kepler-media-controls');
      if (!this.current(revision)) return;
      const locator = MediaControlComponentAsync.makeMediaControlEndpointLocator();
      const clients = await locator.getMediaControlEndpoints();
      if (!this.current(revision)) {clients.forEach(client => client.destroy()); return;}
      this.clients = clients;
      const results = await Promise.allSettled(clients.map(async client => {
        const packageId = client.getEndpointPackageId().id;
        const states = await client.getSessionState();
        return Promise.all(states.map(async state => {
          const metadata = state.mediaInfo ? await client.getMetadata(state.mediaInfo.id).catch(() => null) : null;
          return {client, state, packageId, title: metadata?.title ?? '', providerName: metadata?.mediaProviderInfo?.name ?? ''};
        }));
      }));
      if (!this.current(revision)) return;
      const sessions = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      const failed = results.filter(result => result.status === 'rejected').length;
      const message = sessions.length
        ? failed ? 'Choose a title. Some apps could not be read.' : 'Choose what you’re watching.'
        : failed ? 'Couldn’t read playback. Open your viewing app, then try again.'
          : clients.length ? 'Start a title in your viewing app, then try again.'
            : 'No shared playback found. Start a title in a supported app, then try again.';
      this.setState({sessions, message});
    } catch (error) {
      if (error instanceof Error) console.warn(`[SELENE] playback discovery unavailable: ${error.message}`);
      if (this.current(revision)) this.setState({message: 'Playback discovery is unavailable on this device. You can still try the SELENE demo.'});
    } finally {
      if (this.current(revision)) {this.pending = false; this.setState({busy: false});}
    }
  };

  private select = async (session: Session) => {
    if (!this.mounted || this.pending || !this.clients.includes(session.client)) return;
    this.pending = true;
    const revision = ++this.revision;
    this.setState({busy: true, selected: session, title: '', message: 'Reading the selected session…'});
    try {
      const states = await session.client.getSessionState(session.state.id);
      if (!this.current(revision)) return;
      const state = states.find(value => value.id.id === session.state.id.id);
      if (!state) throw new Error('Session ended');
      const metadata = state.mediaInfo ? await session.client.getMetadata(state.mediaInfo.id).catch(() => null) : null;
      if (this.current(revision)) {
        const title = metadata?.title ?? '';
        this.setState({selected: {...session, state}, title, message: 'Ask about this moment. If the app does not share scene details, add the dialogue or describe what you saw.'});
        return {session: {...session, state}, title, providerName: metadata?.mediaProviderInfo?.name ?? '', revision};
      }
    } catch {
      if (this.current(revision)) this.setState({selected: null, title: '', message: 'This session is no longer readable. Check for playback apps again.'});
    } finally {
      if (this.current(revision)) {this.pending = false; this.setState({busy: false});}
    }
  };

  private command = async (action: 'play' | 'pause' | 'refresh', expectedPlaybackRevision?: number) => {
    const selected = this.state.selected;
    if (!this.mounted || !selected || this.pending) return;
    this.pending = true;
    const revision = ++this.revision;
    this.setState({busy: true, message: 'Checking the selected session before sending your request…'});
    try {
      const {Action} = await import('@amazon-devices/kepler-media-controls');
      if (!this.current(revision)) return;
      // Re-read the exact session before acting; never switch to the focused app implicitly.
      const states = await selected.client.getSessionState(selected.state.id);
      if (!this.current(revision)) return;
      const current = states.find(state => state.id.id === selected.state.id.id);
      if (!current || !sameMedia(current, selected.state)) throw new Error('Playback changed');
      this.observed(current);
      if (expectedPlaybackRevision !== undefined && expectedPlaybackRevision !== this.playbackVersion) throw new Error('Playback changed after the request');
      if (action === 'refresh' || (action === 'pause' && current.playbackState.playbackStatus === 'PAUSED') || (action === 'play' && current.playbackState.playbackStatus === 'PLAYING')) {
        this.setState({selected: {...selected, state: current}});
        return current;
      }
      const required = action === 'play' ? Action.PLAY.name : Action.PAUSE.name;
      if (!current.capabilities.actions.some(value => value.name === required)) throw new Error('Action unavailable');
      await selected.client[action](current.id);
      if (!this.current(revision)) return;
      const reported = (await selected.client.getSessionState(current.id)).find(state => state.id.id === current.id.id);
      if (!reported || !sameMedia(reported, current)) throw new Error('Playback changed');
      if (this.current(revision)) {
        this.setState({selected: {...selected, state: reported}, message: 'Request sent. The last reported state is shown below. Return to your viewing app to continue watching.'});
        return reported;
      }
    } catch {
      if (this.current(revision)) this.setState({selected: null, title: '', message: 'The playback action could not be confirmed. Check the playback app before trying again.'});
    } finally {
      if (this.current(revision)) {this.pending = false; this.setState({busy: false});}
    }
  };

  private openMoment = async (session = this.state.selected) => {
    if (!session) return;
    const found = await this.select(session);
    if (!found || !this.current(found.revision)) return;
    const {session: selectedSession, title, providerName} = found;
    const position = positionSeconds(selectedSession.state);
    const media = selectedSession.state.mediaInfo?.id;
    if (position === null || !media?.contentId || !media.catalogName) {
      this.setState({message: 'This app has not supplied the content identity and playback position needed to select a moment.'});
      return;
    }
    const snapshot = {package_id: selectedSession.packageId, session_id: selectedSession.state.id.id, catalog_name: media.catalogName,
      content_id: media.contentId, title, provider_name: providerName, at_seconds: position};
    this.observedStatus = selectedSession.state.playbackState.playbackStatus; this.playbackVersion = 0;
    this.setState({snapshot}, () => {void this.watch(selectedSession);});
  };
  private closeMoment = () => {
    this.revision++; this.pending = false; this.stopObserving();
    this.setState({snapshot: null, selected: null, title: '', busy: false, message: 'Choose a title to ask about another moment.'});
  };
  private bridge = async (data: string, url: string) => {
    if (url !== momentUrl || !this.state.snapshot || data.length > 200) return;
    let message;
    try {message = JSON.parse(data);} catch {return;}
    if (!message || typeof message !== 'object') return;
    if (message.action === 'close') {this.closeMoment(); return;}
    if (message.action === 'cancel') {this.revision++; this.pending = false; this.setState({busy: false}); return;}
    if (!['play', 'pause', 'refresh'].includes(message.action) || !Number.isSafeInteger(message.id)) return;
    if (message.expected_revision !== undefined && !Number.isSafeInteger(message.expected_revision)) return;
    const momentRevision = this.momentRevision;
    const pending = this.command(message.action, message.expected_revision);
    const revision = this.revision;
    const reported = await pending;
    if (!this.current(revision) || this.momentRevision !== momentRevision || !this.state.snapshot) return;
    const reply = {type: 'selene:playback', id: message.id,
      playback: reported ? this.observed(reported) : null,
      error: reported ? '' : 'The selected session changed or could not be confirmed. Close this moment and check the playback app.'};
    // SDK bridge delivers data to React state. Generated visual code has no access to it.
    this.publish(reply);
  };

  render() {
    const {busy, sessions, selected, message, snapshot, page} = this.state;
    if (snapshot) return <WebView ref={this.frame} style={styles.page} source={{uri: momentUrl}} hasTVPreferredFocus allowSystemKeyEvents
      javaScriptEnabled mixedContentMode="never" mediaPlaybackRequiresUserAction
      injectedJavaScriptBeforeContentLoaded={`window.__SELENE_COMPANION__=${JSON.stringify({snapshot, playback: selected ? playback(selected.state) : null}).replace(/</g, '\\u003c')};true;`}
      onShouldStartLoadWithRequest={event => [momentUrl, 'about:blank', 'about:srcdoc'].includes(event.url)}
      onMessage={event => {void this.bridge(event.nativeEvent.data, event.nativeEvent.url);}}
      onLoad={() => {if (this.state.selected) this.publish({type: 'selene:provider', playback: this.observed(this.state.selected.state)});}}
      onCloseWindow={this.closeMoment}
      onError={() => {this.closeMoment(); this.setState({message: 'SELENE could not load this moment. Check the SELENE service and try again.'});}}
      onHttpError={event => {if (event.nativeEvent.isMainFrame) {this.closeMoment(); this.setState({message: 'SELENE could not load this moment. Check the SELENE service and try again.'});}}} />;
    const pages = Math.ceil(sessions.length / 3);
    const visible = sessions.slice(page * 3, page * 3 + 3);
    return <View style={styles.page}>
      <View style={styles.content}>
        <View style={styles.topbar}><View style={styles.logo}><Image source={require('../assets/selene-mark.png')} style={styles.mark}/><Text style={styles.brand}>selene</Text></View><Text style={styles.tagline}>Your viewing companion</Text></View>
        <View style={styles.main}>
          <Text style={styles.heading}>{busy ? 'Finding what’s playing…' : 'What are you watching?'}</Text>
          <Text style={styles.copy} accessibilityLiveRegion="polite">{busy ? 'Checking apps that share playback with SELENE.' : message}</Text>
          {visible.length > 0 && <View style={styles.sessionRow}>{visible.map((session, index) => <Button key={`${session.packageId}:${session.state.id.id}`} disabled={busy} preferred={index === 0} label={session.title || session.providerName || 'Playback app'} detail={`${session.providerName || session.packageId} · ${session.state.playbackState.playbackStatus.toLowerCase().replace(/_/g, ' ')}`} tile onPress={() => this.openMoment(session)}/>)}</View>}
          {pages > 1 && <View style={styles.actions}><Button label="Previous" disabled={busy || page === 0} onPress={() => this.setState({page: page - 1})}/><Text style={styles.copy}>Page {page + 1} of {pages}</Text><Button label="Next" disabled={busy || page + 1 === pages} onPress={() => this.setState({page: page + 1})}/></View>}
          <View style={styles.actions}>{busy ? <Button label="Cancel" preferred onPress={() => this.disconnect('Search cancelled. Try again when you’re ready.')}/> : <Button label={sessions.length ? 'Refresh apps' : 'Try again'} preferred={!sessions.length} onPress={this.scan}/>}<Button label="Try the demo" onPress={this.props.onDemo}/></View>
        </View>
        <View style={styles.footer}><Text style={styles.hint}>Back to leave SELENE</Text><Text style={styles.hint}>Playback stays in your control</Text></View>
      </View>
    </View>;
  }
}
export function Button({label, detail, onPress, disabled = false, preferred = false, tile = false}: {label: string; detail?: string; onPress: () => void; disabled?: boolean; preferred?: boolean; tile?: boolean}) {
  const [focused, setFocused] = React.useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label} accessibilityState={{disabled}} disabled={disabled} hasTVPreferredFocus={preferred && !disabled}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress}
    style={[styles.button, tile && styles.tile, focused && styles.focused, disabled && styles.disabled]}><Text numberOfLines={2} style={[styles.buttonText, tile && styles.tileTitle, focused && styles.focusedText]}>{label}</Text>{detail && <Text numberOfLines={2} style={[styles.tileDetail, focused && styles.focusedText]}>{detail}</Text>}</Pressable>;
}
const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#101114'}, content: {flex: 1, paddingHorizontal: '5%', paddingVertical: '5%', gap: 36},
  topbar: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, logo: {flexDirection: 'row', alignItems: 'center', gap: 12}, mark: {width: 48, height: 48},
  brand: {fontSize: 46, fontWeight: '600', color: '#f1f1f1'}, tagline: {fontSize: 28, color: '#b9bdc6'},
  main: {flex: 1, justifyContent: 'center', gap: 32}, heading: {fontSize: 64, lineHeight: 76, color: '#f1f1f1', maxWidth: 1250, fontWeight: '600'},
  copy: {fontSize: 30, color: '#b9bdc6', lineHeight: 42, maxWidth: 1400},
  actions: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 24}, sessionRow: {flexDirection: 'row', gap: 28, marginVertical: 16},
  button: {alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 3, borderColor: 'transparent', borderRadius: 12, backgroundColor: '#303238', paddingVertical: 18, paddingHorizontal: 30},
  tile: {flex: 1, minHeight: 180, justifyContent: 'space-between', padding: 30, gap: 20}, tileTitle: {fontSize: 36, fontWeight: '600'}, tileDetail: {fontSize: 28, color: '#b9bdc6'},
  focused: {borderColor: '#f1f1f1', backgroundColor: '#f1f1f1', transform: [{scale: 1.025}]}, focusedText: {color: '#101114'}, disabled: {opacity: 0.45},
  buttonText: {fontSize: 30, color: '#f1f1f1'}, footer: {flexDirection: 'row', justifyContent: 'space-between', gap: 24}, hint: {fontSize: 28, color: '#b9bdc6'},
});
