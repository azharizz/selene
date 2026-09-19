import React from 'react';
import {AppState, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import type {NativeEventSubscription} from 'react-native';
import type {IMediaControlClientAsync, MediaSessionState, ISubscription} from '@amazon-devices/kepler-media-controls';
import {WebView} from '@amazon-devices/webview';
import {appUrl} from './config.json';

type Session = {client: IMediaControlClientAsync; state: MediaSessionState; packageId: string};
type Snapshot = {package_id: string; session_id: number; catalog_name: string; content_id: string; title: string; provider_name: string; at_seconds: number};
type State = {busy: boolean; sessions: Session[]; selected: Session | null; title: string; message: string; snapshot: Snapshot | null};
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
  state: State = {busy: false, sessions: [], selected: null, title: '', snapshot: null, message: 'Find an app that shares its playback session with SELENE.'};
  private clients: IMediaControlClientAsync[] = [];
  private mounted = false;
  private pending = false;
  private revision = 0;
  private appState?: NativeEventSubscription;
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
    this.props.onReady();
    this.scan();
  }
  componentWillUnmount() {
    this.mounted = false;
    this.appState?.remove();
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
    if (this.mounted) this.setState({busy: false, sessions: [], selected: null, title: '', snapshot: null, message});
  };

  private scan = async () => {
    if (!this.mounted || this.pending) return;
    this.pending = true;
    const revision = ++this.revision;
    this.setState({busy: true, selected: null, title: '', sessions: [], message: 'Checking shared playback sessions…'});
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
        return states.map(state => ({client, state, packageId}));
      }));
      if (!this.current(revision)) return;
      const sessions = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      const failed = results.filter(result => result.status === 'rejected').length;
      const message = sessions.length
        ? failed ? 'Choose a session. Some playback apps could not be read.' : 'Choose the playback session you want to check.'
        : failed ? 'A playback app could not share its session. Return to the app, then try again.'
          : clients.length ? 'Playback apps were found, but none shared an active session. Start a title, then check again.'
            : 'No shared playback apps found. Open your viewing app, start a title, then check again.';
      this.setState({sessions, message});
    } catch {
      if (this.current(revision)) this.setState({message: 'Playback discovery is unavailable on this device. You can check again.'});
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

  private openMoment = async () => {
    if (!this.state.selected) return;
    const found = await this.select(this.state.selected);
    if (!found || !this.current(found.revision)) return;
    const {session, title, providerName} = found;
    const position = positionSeconds(session.state);
    const media = session.state.mediaInfo?.id;
    if (position === null || !media?.contentId || !media.catalogName) {
      this.setState({message: 'This app has not supplied the content identity and playback position needed to select a moment.'});
      return;
    }
    const snapshot = {package_id: session.packageId, session_id: session.state.id.id, catalog_name: media.catalogName,
      content_id: media.contentId, title, provider_name: providerName, at_seconds: position};
    this.observedStatus = session.state.playbackState.playbackStatus; this.playbackVersion = 0;
    this.setState({snapshot}, () => {void this.watch(session);});
  };
  private closeMoment = () => {
    this.revision++; this.pending = false; this.stopObserving();
    this.setState({snapshot: null, selected: null, title: '', busy: false, message: 'Moment closed. A playback request already sent may still finish. Select a session to read its current state.'});
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
    const {busy, sessions, selected, title, message, snapshot} = this.state;
    if (snapshot) return <WebView ref={this.frame} style={styles.page} source={{uri: momentUrl}} hasTVPreferredFocus allowSystemKeyEvents
      javaScriptEnabled mixedContentMode="never" mediaPlaybackRequiresUserAction
      injectedJavaScriptBeforeContentLoaded={`window.__SELENE_COMPANION__=${JSON.stringify({snapshot, playback: selected ? playback(selected.state) : null}).replace(/</g, '\\u003c')};true;`}
      onShouldStartLoadWithRequest={event => [momentUrl, 'about:blank', 'about:srcdoc'].includes(event.url)}
      onMessage={event => {void this.bridge(event.nativeEvent.data, event.nativeEvent.url);}}
      onLoad={() => {if (this.state.selected) this.publish({type: 'selene:provider', playback: this.observed(this.state.selected.state)});}}
      onCloseWindow={this.closeMoment}
      onError={() => {this.closeMoment(); this.setState({message: 'SELENE could not load this moment. Check the SELENE service and try again.'});}}
      onHttpError={event => {if (event.nativeEvent.isMainFrame) {this.closeMoment(); this.setState({message: 'SELENE could not load this moment. Check the SELENE service and try again.'});}}} />;
    const seconds = selected?.state.playbackState.position?.position.seconds;
    return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.brand}>SELENE</Text>
      <Text style={styles.heading} numberOfLines={2}>{selected ? title || 'Title not supplied' : 'Connect to your playback'}</Text>
      <Text style={styles.copy}>Use Back to leave SELENE. Your viewing app controls what happens when you return.</Text>
      <Text style={styles.copy} accessibilityLiveRegion="polite">{message}</Text>
      {!selected && sessions.map((session, index) => <Button key={`${session.packageId}:${session.state.id.id}:${index}`} disabled={busy} label={`${session.packageId} · Session ${session.state.id.id}`} onPress={() => this.select(session)} />)}
      {selected && <View style={styles.details}>
        <Text style={styles.copy}>{selected.packageId} · Session {selected.state.id.id}</Text>
        <Text style={styles.copy}>Last reported state: {selected.state.playbackState.playbackStatus.toLowerCase().replace(/_/g, ' ')}</Text>
        <Text style={styles.copy}>{seconds !== undefined && Number.isFinite(seconds) && seconds >= 0 ? `Sampled position: ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : 'Playback position not supplied'}</Text>
        <View style={styles.actions}>
          <Button label="Help with this moment" disabled={busy} preferred onPress={this.openMoment} />
          <Button label="Refresh this session" disabled={busy} onPress={() => this.select(selected)} />
          <Button label="Pause this session" disabled={busy || !selected.state.capabilities.actions.some(a => a.name === 'PAUSE')} onPress={() => this.command('pause')} />
          <Button label="Play this session" disabled={busy || !selected.state.capabilities.actions.some(a => a.name === 'PLAY')} onPress={() => this.command('play')} />
        </View>
      </View>}
      <View style={styles.actions}>
        <Button label="Check playback apps" disabled={busy} preferred={!selected} onPress={this.scan} />
        {busy && <Button label="Stop waiting" preferred onPress={() => this.disconnect()} />}
        <Button label="Open the original story demo" onPress={this.props.onDemo} />
      </View>
    </ScrollView>;
  }
}
export function Button({label, onPress, disabled = false, preferred = false}: {label: string; onPress: () => void; disabled?: boolean; preferred?: boolean}) {
  const [focused, setFocused] = React.useState(false);
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} hasTVPreferredFocus={preferred && !disabled}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress}
    style={[styles.button, focused && styles.focused, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#101714'}, content: {padding: 96, gap: 24},
  brand: {fontSize: 28, letterSpacing: 5, color: '#e8bb70'}, heading: {fontSize: 48, color: '#f6f2e9'},
  copy: {fontSize: 30, color: '#c5ccc6', lineHeight: 42, maxWidth: 1400}, details: {gap: 20},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 20},
  button: {alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 4, borderColor: '#55625b', borderRadius: 6, padding: 20},
  focused: {borderColor: '#e8bb70', backgroundColor: '#354239'}, disabled: {opacity: 0.45},
  buttonText: {fontSize: 30, color: '#f6f2e9'},
});
