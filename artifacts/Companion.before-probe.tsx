import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import type {IMediaControlClientAsync, MediaSessionState} from '@amazon-devices/kepler-media-controls';

type Session = {client: IMediaControlClientAsync; state: MediaSessionState; packageId: string};
type State = {busy: boolean; sessions: Session[]; selected: Session | null; title: string; message: string};

// Native client ownership stays here: discovery never sends a playback command.
export class Companion extends React.Component<{onDemo: () => void; onReady: () => void}, State> {
  state: State = {busy: false, sessions: [], selected: null, title: '', message: 'Find an app that shares its playback session with SELENE.'};
  private clients: IMediaControlClientAsync[] = [];
  private mounted = false;
  private pending = false;

  componentDidMount() {this.mounted = true; this.props.onReady(); this.scan();}
  componentWillUnmount() {this.mounted = false; this.release();}
  private release() {this.clients.forEach(client => client.destroy()); this.clients = [];}

  private scan = async () => {
    if (this.pending) return;
    this.pending = true;
    this.setState({busy: true, selected: null, title: '', sessions: [], message: 'Checking shared playback sessions…'});
    this.release();
    console.log('SELENE companion discovery started');
    try {
      const {MediaControlComponentAsync} = await import('@amazon-devices/kepler-media-controls');
      const clients = await MediaControlComponentAsync.makeMediaControlEndpointLocator().getMediaControlEndpoints();
      if (!this.mounted) {clients.forEach(client => client.destroy()); return;}
      this.clients = clients;
      const results = await Promise.allSettled(clients.map(async client => {
        const packageId = client.getEndpointPackageId().id;
        const states = await client.getSessionState();
        return states.map(state => ({client, state, packageId}));
      }));
      if (!this.mounted) return;
      const sessions = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      const failed = results.filter(result => result.status === 'rejected').length;
      console.log(`SELENE companion discovery: endpoints=${clients.length} sessions=${sessions.length} failed=${failed}`);
      this.setState({sessions, message: sessions.length ? 'Choose the playback session you want to check.' : failed ? 'A playback app could not share its session. Return to the app, then try again.' : 'No shared playback sessions found. Start a supported app, then check again.'});
    } catch (error) {
      console.warn('SELENE companion discovery failed', error instanceof Error ? error.message : 'Platform request failed');
      if (this.mounted) this.setState({message: 'Playback discovery is unavailable on this device. You can check again.'});
    } finally {
      this.pending = false;
      if (this.mounted) this.setState({busy: false});
    }
  };

  private select = async (session: Session) => {
    if (this.pending) return;
    this.pending = true;
    this.setState({busy: true, selected: session, title: '', message: 'Reading the selected session…'});
    try {
      const states = await session.client.getSessionState(session.state.id);
      const state = states.find(value => value.id.id === session.state.id.id);
      if (!state) throw new Error('Session ended');
      const metadata = state.mediaInfo ? await session.client.getMetadata(state.mediaInfo.id).catch(() => null) : null;
      if (this.mounted) this.setState({selected: {...session, state}, title: metadata?.title ?? '', message: 'Scene dialogue is not available through this connection. SELENE cannot explain this scene yet.'});
    } catch {
      if (this.mounted) this.setState({selected: null, message: 'This session is no longer readable. Check for playback apps again.'});
    } finally {
      this.pending = false;
      if (this.mounted) this.setState({busy: false});
    }
  };

  private command = async (action: 'play' | 'pause') => {
    const selected = this.state.selected;
    if (!selected || this.pending) return;
    this.pending = true;
    this.setState({busy: true});
    try {
      // Re-read the exact session before acting; never switch to the focused app implicitly.
      const states = await selected.client.getSessionState(selected.state.id);
      const current = states.find(state => state.id.id === selected.state.id.id);
      if (!current || JSON.stringify(current.mediaInfo?.id) !== JSON.stringify(selected.state.mediaInfo?.id)) throw new Error('Playback changed');
      const {Action} = await import('@amazon-devices/kepler-media-controls');
      const required = action === 'play' ? Action.PLAY.name : Action.PAUSE.name;
      if (!current.capabilities.actions.some(value => value.name === required)) throw new Error('Action unavailable');
      await selected.client[action](current.id);
      const reported = (await selected.client.getSessionState(current.id)).find(state => state.id.id === current.id.id);
      if (!reported) throw new Error('Session ended');
      if (this.mounted) this.setState({selected: {...selected, state: reported}, message: 'Command sent. Playback status below is reported by the app.'});
    } catch {
      if (this.mounted) this.setState({selected: null, message: 'The playback action could not be confirmed. Check the playback app before trying again.'});
    } finally {
      this.pending = false;
      if (this.mounted) this.setState({busy: false});
    }
  };

  render() {
    const {busy, sessions, selected, title, message} = this.state;
    const position = selected?.state.playbackState.position?.position;
    return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.brand}>SELENE</Text>
      <Text style={styles.heading}>Connect to your playback</Text>
      <Text style={styles.copy}>This screen opens separately from your viewing app. Use Back to return; SELENE does not resume playback automatically.</Text>
      <Text style={styles.copy} accessibilityLiveRegion="polite">{message}</Text>
      <Button label={busy ? 'Checking…' : 'Check playback apps'} disabled={busy} preferred onPress={this.scan} />
      {!selected && sessions.map((session, index) => <Button key={`${session.packageId}:${session.state.id.id}:${index}`} disabled={busy} label={`${session.packageId} · Session ${session.state.id.id}`} onPress={() => this.select(session)} />)}
      {selected && <View style={styles.details}>
        <Text style={styles.heading}>{title || 'Title not supplied'}</Text>
        <Text style={styles.copy}>{selected.packageId} · Session {selected.state.id.id}</Text>
        <Text style={styles.copy}>Reported state: {selected.state.playbackState.playbackStatus}</Text>
        <Text style={styles.copy}>{position ? `Sampled position: ${Math.floor(position.seconds / 60)}:${String(Math.floor(position.seconds % 60)).padStart(2, '0')}` : 'Playback position not supplied'}</Text>
        <Button label="Refresh this session" disabled={busy} onPress={() => this.select(selected)} />
        <Button label="Pause this session" disabled={busy || !selected.state.capabilities.actions.some(a => a.name === 'PAUSE')} onPress={() => this.command('pause')} />
        <Button label="Play this session" disabled={busy || !selected.state.capabilities.actions.some(a => a.name === 'PLAY')} onPress={() => this.command('play')} />
      </View>}
      <Button label="Open the original story demo" disabled={busy} onPress={this.props.onDemo} />
    </ScrollView>;
  }
}
function Button({label, onPress, disabled = false, preferred = false}: {label: string; onPress: () => void; disabled?: boolean; preferred?: boolean}) {
  const [focused, setFocused] = React.useState(false);
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} hasTVPreferredFocus={preferred && !disabled}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress}
    style={[styles.button, focused && styles.focused, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#101714'}, content: {padding: 96, gap: 24},
  brand: {fontSize: 28, letterSpacing: 5, color: '#e8bb70'}, heading: {fontSize: 48, color: '#f6f2e9'},
  copy: {fontSize: 30, color: '#c5ccc6', lineHeight: 42}, details: {gap: 20},
  button: {alignSelf: 'flex-start', borderWidth: 4, borderColor: '#55625b', borderRadius: 6, padding: 20},
  focused: {borderColor: '#e8bb70', backgroundColor: '#354239'}, disabled: {opacity: 0.45},
  buttonText: {fontSize: 30, color: '#f6f2e9'},
});
