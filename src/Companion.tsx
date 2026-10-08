import React from 'react';
import {AppState, Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import type {NativeEventSubscription} from 'react-native';
import type {IMediaControlClientAsync, MediaSessionState, ISubscription} from '@amazon-devices/kepler-media-controls';
import type {AccessibilitySnapshot} from './Accessibility';
import {CompanionMoment} from './CompanionMoment';
import type {Playback, Snapshot} from './CompanionMoment';
import {Backdrop, Pulse, Reveal, Rule, Words} from './Motion';
import {Button, accessibleText} from './ui';

export {Button, accessibleText};
const tileBox = {flex: 1, minWidth: 160};


type Session = {client: IMediaControlClientAsync; state: MediaSessionState; packageId: string; title?: string; providerName?: string};
type State = {busy: boolean; sessions: Session[]; selected: Session | null; title: string; message: string; snapshot: Snapshot | null; page: number; momentPlayback: Playback};
function playback(state: MediaSessionState, revision = 0, observing = false): Playback {
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
export class Companion extends React.Component<{onDemo: () => void; onImport: () => void; onReady: () => void; accessibility?: AccessibilitySnapshot}, State> {
  state: State = {busy: false, sessions: [], selected: null, title: '', snapshot: null, page: 0, message: 'Finding what’s playing…',
    momentPlayback: {state: 'unknown', can_pause: false, can_play: false, revision: 0, observing: false}};
  private clients: IMediaControlClientAsync[] = [];
  private mounted = false;
  private pending = false;
  private revision = 0;
  private appState?: NativeEventSubscription;
  private subscription: ISubscription | null = null;
  private momentRevision = 0;
  private playbackVersion = 0;
  private observedStatus = '';
  private started = Date.now();

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
  private watch = async (session: Session) => {
    const revision = this.momentRevision;
    try {
      const subscription = await session.client.addListener({onStateChanged: states => {
        if (!this.mounted || revision !== this.momentRevision || !this.state.snapshot) return;
        const state = states.find(value => value.id.id === session.state.id.id);
        if (!state) return;
        if (!sameMedia(state, session.state)) {this.disconnect('The viewing app changed content. Select its current session to ask again.'); return;}
        this.setState({selected: {...session, state}, momentPlayback: this.observed(state)});
      }});
      if (!this.mounted || revision !== this.momentRevision || !this.state.snapshot) {subscription.unsubscribe(); return;}
      this.subscription = subscription;
      if (this.state.selected) this.setState({momentPlayback: this.observed(this.state.selected.state)});
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
      if (error instanceof Error) console.info(`[SELENE] playback discovery unavailable: ${error.message}`);
      if (this.current(revision)) this.setState({message: 'Playback discovery is unavailable. Watch a demo instead.'});
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
    this.setState({snapshot, momentPlayback: playback(selectedSession.state)}, () => {void this.watch(selectedSession);});
  };
  private closeMoment = () => {
    this.revision++; this.pending = false; this.stopObserving();
    this.setState({snapshot: null, selected: null, title: '', busy: false, message: 'Choose a title to ask about another moment.'});
  };
  // Playback commands from the native moment panel: re-read the exact session, then report what it confirmed.
  private momentCommand = async (action: 'play' | 'pause' | 'refresh', expectedRevision?: number): Promise<Playback> => {
    const momentRevision = this.momentRevision;
    const reported = await this.command(action, expectedRevision);
    if (!reported || this.momentRevision !== momentRevision || !this.state.snapshot) {
      throw new Error('The selected session changed or could not be confirmed. Close this moment and check the playback app.');
    }
    const confirmed = this.observed(reported);
    this.setState({momentPlayback: confirmed});
    return confirmed;
  };

  render() {
    const {busy, sessions, message, snapshot, page} = this.state;
    if (snapshot) return <View style={styles.page}>
      <Backdrop busy={false}/>
      <View style={styles.momentHeader}><Text allowFontScaling={false} style={accessibleText(styles.eyebrow, this.props.accessibility)}>{snapshot.title || snapshot.provider_name}</Text></View>
      <CompanionMoment snapshot={snapshot} playback={this.state.momentPlayback} command={this.momentCommand} onClose={this.closeMoment} accessibility={this.props.accessibility ?? {}}/>
    </View>;
    const pages = Math.ceil(sessions.length / 3);
    const visible = sessions.slice(page * 3, page * 3 + 3);
    const accessibility = this.props.accessibility;
    // A heading that changes mid-intro still lands on the intro's beat.
    const after = (ms: number) => Math.max(0, ms - (Date.now() - this.started));
    const heading = busy ? 'Checking playback' : sessions.length ? 'Choose your film' : 'Watch with Selene';
    return <View style={styles.page}>
      <Backdrop busy={busy}/>
      <ScrollView contentContainerStyle={styles.content}>
        <Reveal delay={150} dy={-14} style={styles.topbar}><View style={styles.logo}><Image source={require('../assets/selene-mark.png')} style={styles.mark}/><Text allowFontScaling={false} style={accessibleText(styles.brand, accessibility)}>selene</Text></View></Reveal>
        <View style={styles.main}>
          <Reveal delay={550} dy={10}><Text allowFontScaling={false} style={accessibleText(styles.eyebrow, accessibility)}>YOUR VIEWING COMPANION</Text></Reveal>
          <Words key={heading} text={heading} delay={after(750)} style={accessibleText(styles.heading, accessibility)}/>
          <Rule delay={1150}/>
          {!sessions.length && <Reveal delay={1300}><Text allowFontScaling={false} style={accessibleText(styles.tagline, accessibility)}>Ask about the moment you’re watching. Selene explains it, then steps aside.</Text></Reveal>}
          <Reveal delay={1450} style={styles.status}><Pulse active={busy}/><Text allowFontScaling={false} style={accessibleText(styles.copy, accessibility)} accessibilityLiveRegion="polite">{busy ? 'Looking for shared playback.' : message}</Text></Reveal>
          {visible.length > 0 && <View style={styles.sessionRow}>{visible.map((session, index) => <Reveal key={`${session.packageId}:${session.state.id.id}`} delay={index * 90} style={tileBox}><Button accessibility={accessibility} disabled={busy} preferred={index === 0} label={session.title || session.providerName || 'Playback app'} detail={`${session.providerName || session.packageId} · ${session.state.playbackState.playbackStatus.toLowerCase().replace(/_/g, ' ')}`} tile onPress={() => this.openMoment(session)}/></Reveal>)}</View>}
          {pages > 1 && <View style={styles.actions}><Button accessibility={accessibility} label="Previous" disabled={busy || page === 0} onPress={() => this.setState({page: page - 1})}/><Text allowFontScaling={false} style={accessibleText(styles.copy, accessibility)}>Page {page + 1} of {pages}</Text><Button accessibility={accessibility} label="Next" disabled={busy || page + 1 === pages} onPress={() => this.setState({page: page + 1})}/></View>}
          <View style={styles.actions}>
            <Reveal delay={1650}><Button accessibility={accessibility} label="Try the demo" preferred={!busy && !sessions.length} onPress={this.props.onDemo}/></Reveal>
            <Reveal delay={1780}>{busy ? <Button accessibility={accessibility} label="Cancel" preferred onPress={() => this.disconnect('Search cancelled.')}/> : sessions.length ? <Button accessibility={accessibility} label="Refresh apps" onPress={this.scan}/> : <Button accessibility={accessibility} label="Import MP4" onPress={this.props.onImport}/>}</Reveal>
          </View>
        </View>
      </ScrollView>
    </View>;
  }
}
const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#101114'}, momentHeader: {position: 'absolute', left: '6%', top: '7%'}, content: {flexGrow: 1, paddingHorizontal: '6%', paddingVertical: '5%', gap: 12},
  topbar: {flexDirection: 'row', alignItems: 'center'}, logo: {flexDirection: 'row', alignItems: 'center', gap: 8}, mark: {width: 26, height: 26},
  brand: {fontSize: 24, fontWeight: '600', color: '#f1f1f1', letterSpacing: 0.5},
  main: {flex: 1, justifyContent: 'center', gap: 10},
  eyebrow: {fontSize: 11, lineHeight: 14, letterSpacing: 2.5, fontWeight: '600', color: '#b9bdc6'},
  heading: {fontSize: 34, lineHeight: 40, color: '#f1f1f1', fontWeight: '700', letterSpacing: -0.5},
  tagline: {fontSize: 16, lineHeight: 23, color: '#d6d9df', maxWidth: 330},
  status: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, maxWidth: 440},
  copy: {fontSize: 14, color: '#b9bdc6', lineHeight: 20, flexShrink: 1},
  actions: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14}, sessionRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginVertical: 8},
});
