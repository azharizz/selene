/* global AbortSignal */
// Native own-player (demo films and imports). Port of web/App.tsx without a WebView.
// Voice input and read-aloud are absent: they relied on browser speech APIs that Vega's native runtime does not provide.
import React from 'react';
import {AppState, BackHandler, Image, ScrollView, StyleSheet, View} from 'react-native';
import type {NativeEventSubscription} from 'react-native';
import AsyncStorage from '@amazon-devices/react-native-async-storage__async-storage';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import type {AccessibilitySnapshot} from './Accessibility';
import {clock, endSession, mediaUrl, openSession, request, RelayError} from './api';
import type {Bundle, CatalogStory, Choice, Example, Input, Moment, Pairing, ReturnResult, Story} from './api';
import {NativeFilm} from './media';
import type {FilmEvent} from './media';
import {AskPanel, LoadingPanel, MomentPanel, plain} from './Moment';
import {OwnPlayerSession} from './OwnPlayerSession';
import {Body, Brand, Button, Captions, Field, Heading, LoadingMark, Panel, Row, palette} from './ui';
import {Visual} from './Visual';

type Screen = 'watch' | 'ask' | 'loading' | 'moment' | 'preferences' | 'more' | 'exit' | 'error' | 'tools' | 'pair' | 'return' | 'credits' | 'films' | 'import';
type Props = {importMp4: boolean; accessibility: AccessibilitySnapshot; onCompanion: () => void; onReady: () => void};
type State = {
  bundle: Bundle | null; loadError: string; screen: Screen; started: boolean; controls: boolean; position: number; paused: boolean; ended: boolean; captions: boolean;
  request: string; moment: Moment | null; error: string; anchorAt: number; clarifying: boolean; choice: Choice;
  savedPlace: {at_seconds: number; epoch: number} | null; returnResult: ReturnResult | null; mirror: Pairing | null; pairing: boolean;
  examples: Example[]; examplesOpen: boolean; examplesStatus: 'loading' | 'ready' | 'error'; importUrl: string; importTitle: string; importing: boolean;
};
const CAPTIONS_KEY = 'selene.captions';

export class Player extends React.Component<Props, State> {
  state: State = {
    bundle: null, loadError: '', screen: this.props.importMp4 ? 'import' : 'watch', started: false, controls: true, position: 0, paused: true, ended: false, captions: true,
    request: '', moment: null, error: '', anchorAt: 0, clarifying: false, choice: 'unspecified', savedPlace: null, returnResult: null, mirror: null, pairing: false,
    examples: [], examplesOpen: false, examplesStatus: 'ready', importUrl: '', importTitle: '', importing: false,
  };
  private film: NativeFilm | null = null;
  private filmFor = '';
  private mounted = false;
  private pending: AbortController | null = null;
  private examplesRequest: AbortController | null = null;
  private pairingRequest: AbortController | null = null;
  private lastInput: Input | null = null;
  private lastSeekTo: number | undefined;
  private playbackRevision = 0;
  private playbackEpoch = 0;
  private relaySequence = 0;
  private buffering = false;
  private resuming = false;
  private explicitCaptions: boolean | null = null;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastStateAt = 0;
  private back?: NativeEventSubscription;
  private appState?: NativeEventSubscription;
  private session = new OwnPlayerSession(message => this.remote(message as {action: string; position_ms?: number; relative?: boolean}));

  componentDidMount() {
    this.mounted = true;
    this.back = BackHandler.addEventListener('hardwareBackPress', () => {this.goBack(); return true;});
    this.appState = AppState.addEventListener('change', state => {if (state !== 'active') this.background();});
    this.session.start();
    this.heartbeat = setInterval(() => {if (this.state.started) this.postState(true);}, 2000);
    void AsyncStorage.getItem(CAPTIONS_KEY).then(value => {
      if (value === 'true' || value === 'false') this.explicitCaptions = value === 'true';
      if (this.mounted) this.setState({captions: this.captionChoice()});
    }, () => undefined);
    void this.load();
  }
  componentDidUpdate(previous: Props) {
    if (previous.accessibility !== this.props.accessibility) this.setState({captions: this.captionChoice()});
  }
  componentWillUnmount() {
    this.mounted = false;
    this.back?.remove(); this.appState?.remove();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.cancel(); this.examplesRequest?.abort(); this.pairingRequest?.abort();
    this.session.stop(); this.closeSession(); this.film?.destroy();
  }

  private get story(): Story | null {return this.state.bundle?.story ?? null;}
  private get sessionId() {return this.state.bundle?.session_id ?? '';}
  private captionChoice() {return this.explicitCaptions ?? this.props.accessibility.captions ?? true;}
  private cancel = () => {this.pending?.abort(); this.pending = null;};
  private closeSession = () => {endSession(this.sessionId);};

  private load = async (contentId?: string) => {
    this.setState({loadError: ''});
    try {
      const bundle = await openSession(contentId ? {content_id: contentId} : {});
      if (!this.mounted) return;
      this.closeSession();
      this.setState({bundle, started: false, position: 0, paused: true, ended: false, controls: true, savedPlace: null, returnResult: null, mirror: null, moment: null});
      this.prepareFilm(bundle.story);
    } catch {
      if (this.mounted) this.setState({loadError: 'The story could not load. Check the SELENE service and try again.'});
    } finally {this.props.onReady();}
  };
  private reopen = async (signal?: AbortSignal) => {
    const bundle = await openSession({content_id: this.story!.id}, signal);
    if (this.mounted) this.setState({bundle: {...bundle, catalog: bundle.catalog ?? this.state.bundle?.catalog}, mirror: null, pairing: false});
    return bundle.session_id;
  };

  private prepareFilm(story: Story) {
    if (this.filmFor === story.video && this.film) return;
    this.film?.destroy();
    this.filmFor = story.video;
    this.film = new NativeFilm(this.filmEvent, message => {if (this.mounted) this.setState({error: message, controls: true});});
    void this.film.load(story.video);
    this.forceUpdate(); // remount the surface for the new player
  }
  private filmEvent = (event: FilmEvent) => {
    const film = this.film;
    if (!film || !this.mounted) return;
    if (event === 'timeupdate') {
      const position = film.currentTime;
      if (Math.floor(position) !== Math.floor(this.state.position) || this.captionAt(position) !== this.captionAt(this.state.position)) this.setState({position});
      this.postState();
      return;
    }
    if (event === 'waiting') this.buffering = true;
    if (['playing', 'seeked', 'play', 'pause'].includes(event)) this.buffering = false;
    if (event === 'play' || event === 'pause') {this.playbackRevision++; this.setState({paused: event === 'pause', ended: false});}
    if (event === 'playing') this.setState({paused: false, ended: false});
    if (event === 'ended') this.setState({paused: true, ended: true, controls: true});
    if (event === 'seeking') this.seeked();
    if (event === 'error') this.setState({error: `The film could not load${film.errorCode ? ` (media error ${film.errorCode})` : ''}. Check the SELENE service, then reload the film.`, controls: true});
    this.postState(true);
  };
  private captionAt = (position: number) => this.story?.transcript.find(line => position >= line.start && position < line.end);
  private playState() {
    const film = this.film;
    if (!film || film.ended) return 'stopped' as const;
    if (film.paused) return 'paused' as const;
    return this.buffering ? 'buffering' as const : 'playing' as const;
  }
  private postState = (force = false) => {
    const film = this.film, story = this.story;
    if (!film || !story) return;
    if (!force && Date.now() - this.lastStateAt < 1000) return;
    this.lastStateAt = Date.now();
    this.session.update({state: this.playState(), position_ms: film.currentTime * 1000, duration_ms: story.duration * 1000, muted: false, volume: 1});
    if (this.state.started) void this.publishPlayback().catch(() => undefined); // A missing heartbeat makes phone help explicitly unavailable.
  };
  private publishPlayback = async (signal?: AbortSignal) => {
    const film = this.film, story = this.story;
    if (!film || !story || !this.sessionId) throw new Error('Start the film before connecting a phone.');
    if (film.seeking) throw new Error('Wait for the TV to finish seeking, then try again.');
    await request('/api/playback', {method: 'POST', session: this.sessionId, signal, body: {content_id: story.id, content_version: story.content_version,
      sequence: ++this.relaySequence, epoch: this.playbackEpoch, at_seconds: Math.min(story.duration, Math.max(0, film.currentTime)),
      play_state: film.ended ? 'ended' : this.playState(), playback_rate: 1}});
  };
  private seeked = () => {
    this.playbackEpoch++;
    this.setState({savedPlace: null, returnResult: null});
    if (!this.resuming && !(this.pending && this.lastSeekTo !== undefined) && (this.pending || this.state.screen !== 'watch')) this.close();
  };

  // Remote media keys and voice transport arrive through the Vega PlayerSession.
  private remote = (message: {action: string; position_ms?: number; relative?: boolean}) => {
    const film = this.film;
    if (!film || this.state.screen === 'import') {if (message.action === 'request_state') this.postState(true); return;}
    if (message.action === 'play') this.play();
    if (message.action === 'pause') film.pause();
    if (message.action === 'stop') {film.pause(); film.currentTime = 0;}
    if (message.action === 'start_over') {film.currentTime = 0; this.play();}
    if (message.action === 'seek' && this.story) {
      const target = message.relative ? film.currentTime * 1000 + Number(message.position_ms) : Number(message.position_ms ?? 0);
      film.currentTime = Math.max(0, Math.min(this.story.duration, target / 1000));
    }
    this.postState(true);
  };
  private play = () => {
    if (this.state.screen === 'import') return;
    this.film?.play().catch(() => {if (this.mounted) this.setState({error: 'Playback could not start. Press Play to try again.', controls: true});});
  };
  private background = () => {
    this.film?.pause(); this.cancel(); void this.stopMirror();
    this.lastInput = null;
    this.setState({screen: 'watch', moment: null, controls: true, request: ''});
  };

  private close = () => {
    this.cancel(); this.lastInput = null;
    this.setState({screen: 'watch', moment: null, controls: true, request: '', error: '', clarifying: false, choice: 'unspecified', returnResult: null});
  };
  private dismiss = () => {this.close(); this.setState({controls: false});};
  private closeReturn = () => {
    if (['ready', 'no_gap'].includes(this.state.returnResult?.status ?? '')) this.setState({savedPlace: null});
    this.dismiss();
  };
  private goBack = () => {
    const {screen, started, controls, clarifying, importing} = this.state;
    if (importing) return this.cancelImport();
    if (screen === 'exit') return this.exit();
    if (screen === 'preferences') return this.setState({screen: 'watch'});
    if (screen === 'more') return this.setState({screen: 'moment'});
    if (screen === 'return') return this.closeReturn();
    if (screen === 'import') return this.state.bundle ? this.setState({screen: 'films'}) : this.props.onCompanion();
    if (screen === 'ask' && clarifying) return this.setState({screen: 'moment', clarifying: false, error: ''});
    if (screen === 'moment') return this.dismiss();
    if (screen !== 'watch') return this.close();
    if (started && controls) return this.setState({controls: false});
    this.setState({screen: 'exit'});
  };
  private exit = () => {this.film?.pause(); this.closeSession(); BackHandler.exitApp();};
  private companion = () => {this.film?.pause(); this.closeSession(); this.props.onCompanion();};

  private start = () => this.setState({started: true, controls: false, error: ''}, this.play);
  private chooseStory = (id: string) => {
    if (id === this.story?.id) return this.close();
    this.film?.pause(); this.cancel();
    this.setState({screen: 'watch'});
    void this.load(id);
  };
  private toggleCaptions = () => {
    const captions = !this.state.captions; this.explicitCaptions = captions;
    void AsyncStorage.setItem(CAPTIONS_KEY, String(captions)).catch(() => undefined);
    this.setState({captions});
  };
  private systemCaptions = () => {
    this.explicitCaptions = null;
    void AsyncStorage.removeItem(CAPTIONS_KEY).catch(() => undefined);
    this.setState({captions: this.captionChoice()});
  };
  private seek = (by: number) => {
    const film = this.film;
    if (!film || !this.story) return;
    this.close();
    film.currentTime = Math.max(0, Math.min(this.story.duration, film.currentTime + by));
  };

  private savePlace = () => {
    if (!this.film || !this.story) return;
    this.cancel();
    this.setState({savedPlace: {at_seconds: Math.min(this.story.duration, Math.max(0, this.film.currentTime)), epoch: this.playbackEpoch}, screen: 'watch', controls: false, error: ''});
  };
  private bringUsBack = async () => {
    const saved = this.state.savedPlace, film = this.film, story = this.story;
    if (!saved || !film || !story) return;
    this.cancel(); this.lastInput = null;
    const pending = new AbortController(); this.pending = pending;
    this.setState({screen: 'loading', returnResult: null, error: ''});
    try {
      await this.publishPlayback(pending.signal);
      const result = await request<ReturnResult>('/api/return', {method: 'POST', session: this.sessionId, signal: pending.signal, timeoutMs: 45000,
        body: {content_version: story.content_version, epoch: saved.epoch, from_seconds: saved.at_seconds, need: 'Show visually', language: 'English', recipient: 'everyone'}});
      if (!this.mounted || this.pending !== pending || pending.signal.aborted || saved.epoch !== this.playbackEpoch) return;
      if (film.paused && !film.ended) {this.resuming = true; try {await film.play();} finally {this.resuming = false;}}
      if (film.paused && !film.ended) throw new Error('Playback could not resume. Close the recap and press Play to try again.');
      this.pending = null;
      this.setState({returnResult: result, screen: 'return'});
    } catch (error) {
      if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
      this.pending = null; this.setState({screen: 'tools', error: error instanceof Error ? error.message : 'This return is unavailable.'});
    }
  };

  private openAsk = () => {
    const anchorAt = Math.min(this.story?.duration ?? 0, this.film?.currentTime ?? this.state.position);
    this.setState({screen: 'ask', anchorAt, request: '', clarifying: false, error: '', choice: 'unspecified', examples: [], examplesOpen: false}, this.loadExamples);
  };
  private loadExamples = async () => {
    const {anchorAt} = this.state, story = this.story;
    if (!story) return;
    const pending = new AbortController(); this.examplesRequest?.abort(); this.examplesRequest = pending;
    this.setState({examplesStatus: 'loading'});
    try {
      const result = await request<{examples: Example[]}>(`/api/examples?content_id=${encodeURIComponent(story.id)}&at_seconds=${anchorAt}`, {signal: pending.signal, timeoutMs: 5000});
      if (this.mounted && this.examplesRequest === pending && this.state.screen === 'ask' && this.state.anchorAt === anchorAt) this.setState({examples: result.examples, examplesStatus: 'ready'});
    } catch {
      if (this.mounted && !pending.signal.aborted && this.examplesRequest === pending && this.state.screen === 'ask') this.setState({examplesStatus: 'error'});
    }
  };
  private playStateNow = () => {const film = this.film; return film?.ended ? 'ended' as const : film?.paused ? 'paused' as const : 'playing' as const;};
  private ask = () => {
    const {moment, clarifying, request: text, anchorAt} = this.state, story = this.story;
    if (!story || !this.film) return;
    if (!text.trim()) {this.setState({error: 'Type a question or choose an example.'}); return;}
    this.deliver({request: clarifying && this.lastInput ? this.lastInput.request : text.trim(), content_id: story.id, at_seconds: anchorAt, play_state: this.playStateNow(),
      playback_choice: 'unspecified', need: 'Show visually', language: 'English', recipient: 'everyone', session: 'family',
      continuation: clarifying && moment && this.lastInput ? {request: this.lastInput.request, question: moment.answer, answer: text.trim()} : null});
  };
  private selectExample = (example: Example) => {
    if (!this.story) return;
    void this.deliver({request: example.request, content_id: this.story.id, at_seconds: example.at_seconds, play_state: this.playStateNow(), playback_choice: 'keep_watching',
      need: 'Show visually', language: 'English', recipient: 'everyone', session: 'family', continuation: null}, example.at_seconds > this.state.anchorAt ? example.at_seconds : undefined);
  };
  private deliver = async (input: Input, seekTo?: number) => {
    const film = this.film, story = this.story;
    if (!film || !story) return;
    const choice = input.playback_choice;
    if (choice === 'pause_to_explore') film.pause();
    input = {...input, play_state: this.playStateNow()};
    this.lastInput = input; this.lastSeekTo = seekTo;
    this.cancel();
    const pending = new AbortController(); this.pending = pending;
    const revision = this.playbackRevision;
    this.setState({screen: 'loading', error: '', choice, anchorAt: seekTo === undefined ? input.at_seconds : this.state.anchorAt});
    try {
      if (seekTo !== undefined) {
        film.currentTime = seekTo;
        const deadline = Date.now() + 5000;
        while ((film.seeking || film.currentTime < seekTo - 0.5) && Date.now() < deadline && !pending.signal.aborted) await new Promise(resolve => setTimeout(resolve, 100));
        if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
        const at = Math.min(story.duration, film.currentTime);
        if (!Number.isFinite(at) || at < seekTo - 0.5) throw new Error('The player did not reach the prepared demo moment. Try again.');
        input = {...input, at_seconds: Math.max(at, seekTo), play_state: this.playStateNow()};
        this.lastInput = input; this.lastSeekTo = undefined; this.setState({anchorAt: input.at_seconds});
      }
      const send = (session: string) => request<Moment>('/api/moment', {method: 'POST', session, body: input, signal: pending.signal, timeoutMs: 0});
      let result: Moment;
      try {result = await send(this.sessionId);}
      catch (error) {if ((error as RelayError).status !== 410) throw error; result = await send(await this.reopen(pending.signal));}
      if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
      if (result.state === 'quiet') return this.close();
      if (result.state === 'response') {
        if (!film.ended) {this.resuming = true; try {await film.play();} finally {this.resuming = false;}}
        if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
        if (film.paused && !film.ended) throw new Error('Playback could not resume. Press Play and try again.');
        result.intervention.playback = 'keep_watching';
      } else if (result.intervention.playback === 'request_pause') {
        if (revision === this.playbackRevision) film.pause(); else result.intervention.playback = 'keep_watching';
      }
      this.pending = null;
      this.setState({moment: result, screen: result.state === 'clarification' ? 'ask' : 'moment', clarifying: result.state === 'clarification',
        request: result.state === 'clarification' ? '' : this.state.request, choice: result.intervention.playback === 'request_pause' ? 'pause_to_explore' : choice});
    } catch (error) {
      if (pending.signal.aborted || !this.mounted) return;
      this.pending = null;
      this.setState({error: error instanceof Error ? error.message : 'This moment could not be prepared. Please try again.', screen: 'error'});
    }
  };

  private openMirror = async () => {
    if (!this.sessionId || this.state.pairing) return;
    this.setState({screen: 'pair', pairing: true, error: ''});
    const pending = new AbortController(); this.pairingRequest?.abort(); this.pairingRequest = pending;
    const sessionId = this.sessionId;
    try {
      await this.publishPlayback(pending.signal);
      const result = await request<Pairing>('/api/private/pair', {method: 'POST', session: sessionId, body: {}, signal: pending.signal});
      if (typeof result.code !== 'string') throw new Error('Phone pairing is unavailable.');
      if (this.mounted && !pending.signal.aborted && this.sessionId === sessionId) this.setState({mirror: result});
    } catch (error) {if (this.mounted && !pending.signal.aborted) this.setState({error: error instanceof Error ? error.message : 'Phone pairing is unavailable.'});}
    finally {if (this.mounted && this.pairingRequest === pending) {this.pairingRequest = null; this.setState({pairing: false});}}
  };
  private stopMirror = async () => {
    this.pairingRequest?.abort();
    const pending = new AbortController(); this.pairingRequest = pending;
    const sessionId = this.sessionId;
    if (this.mounted) this.setState({pairing: true, error: ''});
    try {
      if (sessionId) await request('/api/private/close', {method: 'POST', session: sessionId, body: {}, signal: pending.signal}).catch(error => {if ((error as RelayError).status !== 410) throw error;});
      if (this.mounted && this.pairingRequest === pending && this.sessionId === sessionId) this.setState({mirror: null});
    } catch {
      if (this.mounted && this.pairingRequest === pending && !pending.signal.aborted) this.setState({error: 'The phone may still be connected. Try Disconnect phone again.'});
    } finally {if (this.mounted && this.pairingRequest === pending) {this.pairingRequest = null; this.setState({pairing: false});}}
  };

  private submitImport = async () => {
    const url = this.state.importUrl.trim(), title = this.state.importTitle.trim();
    if (!/^https:\/\/\S+$/.test(url) || url.length > 2048) {this.setState({error: 'Enter an HTTPS MP4 URL.'}); return;}
    if (!title) {this.setState({error: 'Enter a title for the film.'}); return;}
    this.cancel();
    const pending = new AbortController(); this.pending = pending;
    this.setState({importing: true, error: ''});
    try {
      const session = this.sessionId || (await openSession({}, pending.signal)).session_id;
      const result = await request<{story: {id: string}}>('/api/media/import', {method: 'POST', session, body: {url, title}, signal: pending.signal, timeoutMs: 0});
      if (typeof result.story?.id !== 'string') throw new Error('The service did not return an imported film.');
      if (this.mounted && !pending.signal.aborted) {this.setState({importing: false, importUrl: '', importTitle: '', screen: 'watch'}); void this.load(result.story.id);}
    } catch (error) {
      if (this.mounted && !pending.signal.aborted) this.setState({importing: false, error: error instanceof Error ? error.message : 'The import could not finish. Check the connection and try again.'});
    } finally {if (this.pending === pending) this.pending = null;}
  };
  private cancelImport = () => {this.cancel(); this.setState({importing: false});};

  render() {
    const {bundle, loadError, screen, started, controls, position, paused, ended, captions, moment, error, savedPlace, returnResult, mirror, pairing, clarifying} = this.state;
    const a11y = this.props.accessibility;
    const story = this.story;
    const film = this.film;
    if (!bundle || !story) {
      if (screen === 'import') return <View style={styles.page}>{this.renderImport()}</View>;
      return <View style={[styles.page, styles.centre]}>
        <Brand size={28}/>
        {loadError ? <><Body accessibility={a11y} live>{loadError}</Body>
          <Row><Button preferred label="Try again" onPress={() => {void this.load();}} accessibility={a11y}/>
            <Button label="Back to playback apps" accessibilityLabel="Connect to another playback app" onPress={this.props.onCompanion} accessibility={a11y}/></Row></>
          : <Body muted accessibility={a11y}>Loading the story…</Body>}
      </View>;
    }
    const caption = this.captionAt(position);
    const captionStatus = story.ingestion ? !story.transcript.length || story.ingestion.caption_source === 'unavailable'
      ? 'Captions unavailable · dialogue is not captured; help is visual-only.'
      : story.ingestion.caption_source === 'generated' ? 'Generated captions · automated transcription may be inaccurate.'
        : story.ingestion.caption_source === 'embedded' ? 'Embedded captions' : 'Supplied captions' : '';
    const showCaptions = started && captions && ['watch', 'loading', 'moment', 'return', 'tools', 'pair'].includes(screen);
    return <View style={styles.page}>
      {film && <KeplerVideoSurfaceView key={this.filmFor} style={styles.video} onSurfaceViewCreated={handle => film.attach(handle)} onSurfaceViewDestroyed={handle => film.detach(handle)}/>}
      {!started && <Image source={{uri: mediaUrl(story.poster)}} style={styles.video} resizeMode="cover"/>}
      {showCaptions && <Captions line={caption} accessibility={a11y}/>}

      {!started && screen === 'watch' && <View style={styles.welcome}>
        <Brand size={26}/>
        <Heading accessibility={a11y}>{story.title}</Heading>
        <Body muted accessibility={a11y}>{story.subtitle} · {clock(story.duration)}</Body>
        {captionStatus ? <Body small accessibility={a11y}>{captionStatus}</Body> : null}
        {error ? <Body muted live accessibility={a11y}>{error}</Body> : null}
        <Row><Button preferred primary label={position > 0 ? 'Continue watching' : 'Watch demo'} onPress={this.start} accessibility={a11y}/>
          <Button label="Films" onPress={() => this.setState({screen: 'films'})} accessibility={a11y}/></Row>
        <Button small label="← Playback apps" accessibilityLabel="Connect to another playback app" onPress={this.companion} accessibility={a11y}/>
      </View>}

      {started && screen === 'watch' && (!controls
        ? <View style={styles.quiet}><Button small preferred mark label={savedPlace ? '•' : ''} accessibilityLabel={savedPlace ? 'Bring us back' : 'Selene'}
          onPress={() => {if (savedPlace) void this.bringUsBack(); else this.setState({controls: true});}} accessibility={a11y}/></View>
        : <View style={styles.toolbar} accessibilityLabel="Selene tools">
          {error ? <Body muted live accessibility={a11y}>{error}</Body> : null}
          <Row><Button preferred primary label="Ask Selene" onPress={this.openAsk} accessibility={a11y}/>
            <Button label="Tools" accessibilityLabel="Selene tools" onPress={() => this.setState({screen: 'tools', error: ''})} accessibility={a11y}/>
            <Button label="Hide" accessibilityLabel="Hide Selene" onPress={() => this.setState({controls: false})} accessibility={a11y}/></Row>
        </View>)}

      {screen === 'films' && <Panel label="Choose a film">
        <Row><View style={styles.grow}><Heading accessibility={a11y}>Films</Heading></View><Button small preferred label="Close" accessibilityLabel="Close films" onPress={this.close} accessibility={a11y}/></Row>
        <ScrollView contentContainerStyle={styles.list}>
          {(bundle.catalog ?? []).map((item: CatalogStory) => <Button key={item.id} small pressed={item.id === story.id} label={item.title} detail={clock(item.duration)}
            accessibilityLabel={`Open ${item.title}`} onPress={() => this.chooseStory(item.id)} accessibility={a11y}/>)}
        </ScrollView>
        <Row><Button small label="Import MP4" onPress={() => {this.film?.pause(); this.cancel(); this.setState({screen: 'import', error: ''});}} accessibility={a11y}/>
          <Button small label="Film credits" onPress={() => this.setState({screen: 'credits'})} accessibility={a11y}/></Row>
      </Panel>}

      {screen === 'import' && this.renderImport()}

      {screen === 'tools' && <Panel label="Watch together">
        <Row><View style={styles.grow}><Heading accessibility={a11y}>Watch together</Heading></View>
          <Button small label="Films" accessibilityLabel="Change film" onPress={() => this.setState({screen: 'films'})} accessibility={a11y}/>
          <Button small preferred label="Close" accessibilityLabel="Close tools" onPress={this.close} accessibility={a11y}/></Row>
        <Button primary label={savedPlace ? 'Bring us back' : 'Hold our place'} onPress={() => {if (savedPlace) void this.bringUsBack(); else this.savePlace();}} accessibility={a11y}/>
        <Button label={mirror ? 'Phone connection' : 'Pair phone'} onPress={() => {if (mirror) this.setState({screen: 'pair'}); else void this.openMirror();}} accessibility={a11y}/>
        <Button label="Playback" onPress={() => this.setState({screen: 'preferences'})} accessibility={a11y}/>
        {savedPlace && <Row><Body muted accessibility={a11y}>Saved at {clock(savedPlace.at_seconds)}</Body>
          <Button small label="Clear" accessibilityLabel="Clear saved place" onPress={() => this.setState({savedPlace: null})} accessibility={a11y}/></Row>}
        {error ? <Body muted live accessibility={a11y}>{error}</Body> : null}
      </Panel>}

      {screen === 'pair' && <Panel label="Use your phone">
        <Row><View style={styles.grow}><Heading accessibility={a11y}>Use your phone</Heading></View>
          <Button small preferred label="Close" accessibilityLabel="Close pairing" onPress={this.close} accessibility={a11y}/></Row>
        {mirror ? <>
          <Body muted accessibility={a11y}>Open {mirror.join_url}</Body>
          <Heading accessibility={a11y}>{`${mirror.code.slice(0, 3)} ${mirror.code.slice(3)}`}</Heading>
          <Body small accessibility={a11y}>One phone. Code expires after five minutes. The TV keeps its own controls.</Body>
          <Row><Button small label="New code" disabled={pairing} onPress={() => {void this.openMirror();}} accessibility={a11y}/>
            <Button small label="Disconnect phone" disabled={pairing} onPress={() => {void this.stopMirror();}} accessibility={a11y}/></Row>
        </> : <>
          <Body muted live accessibility={a11y}>{pairing ? 'Creating your code…' : 'Pair a phone for private explanations.'}</Body>
          <Button small label="Create code" disabled={pairing} onPress={() => {void this.openMirror();}} accessibility={a11y}/>
        </>}
        {error ? <Body muted live accessibility={a11y}>{error}</Body> : null}
      </Panel>}

      {screen === 'return' && returnResult && <Panel place="toast" label="Guided return">
        <Row>
          {returnResult.moment?.visual.status === 'ready' && <Visual visual={returnResult.moment.visual}/>}
          <View style={styles.grow}><Body accessibility={a11y} live>{returnResult.quote ? `“${returnResult.quote.text}”` : returnResult.moment ? plain(returnResult.moment.answer)
            : returnResult.status === 'unavailable' ? 'The recap could not be prepared. Close to try again.' : returnResult.status === 'no_gap' ? 'There was no gap at the sampled TV moment.'
              : 'There is not enough evidence for this gap. Replay it or ask someone watching with you.'}</Body></View>
        </Row>
        {returnResult.quote && <Body small accessibility={a11y}>Original caption · {clock(returnResult.quote.at_seconds)} · Recap unavailable; close to retry.</Body>}
        <Body small accessibility={a11y}>{returnResult.status === 'ready' ? 'Covers' : 'Requested'} {clock(returnResult.from_seconds)} to {clock(returnResult.through_seconds)}
          {position - returnResult.through_seconds >= 2 ? ` · TV ${clock(position)}` : ''}</Body>
        <Button small preferred label="Close" accessibilityLabel="Close return" onPress={this.closeReturn} accessibility={a11y}/>
      </Panel>}

      {screen === 'ask' && <AskPanel clarification={clarifying && moment ? plain(moment.answer) : undefined} request={this.state.request} onChange={value => this.setState({request: value})}
        onSubmit={this.ask} onClose={this.goBack} error={error} accessibility={a11y}
        examples={{status: this.state.examplesStatus, items: this.state.examples, open: this.state.examplesOpen, anchorAt: this.state.anchorAt,
          onToggle: () => this.setState(({examplesOpen}) => ({examplesOpen: !examplesOpen})), onRetry: this.loadExamples, onSelect: this.selectExample}}/>}

      {screen === 'loading' && <LoadingPanel onCancel={this.close}/>}

      {screen === 'moment' && moment && <MomentPanel moment={moment} error={error} onDismiss={this.dismiss} onMore={() => this.setState({screen: 'more'})} accessibility={a11y}
        notice={story.ingestion && moment.grounding.evidence_ids.some(id => id.startsWith('frame-')) ? 'Sampled image; details may be inaccurate.' : undefined}/>}

      {screen === 'more' && <Panel place="toast" label="This moment">
        <Row><View style={styles.grow}><Heading accessibility={a11y}>This moment</Heading></View><Button small label="Back" onPress={this.goBack} accessibility={a11y}/></Row>
        {!paused && <Button small preferred label="Pause playback" onPress={() => {this.film?.pause(); this.setState({choice: 'pause_to_explore', screen: 'moment'});}} accessibility={a11y}/>}
        <Button small label="Explain on phone" onPress={() => {if (mirror) this.setState({screen: 'pair'}); else void this.openMirror();}} accessibility={a11y}/>
        <Button small preferred={paused} label={paused ? 'Close, stay paused' : 'Dismiss'} onPress={this.dismiss} accessibility={a11y}/>
      </Panel>}

      {screen === 'preferences' && <Panel label="Playback">
        <Row><View style={styles.grow}><Heading accessibility={a11y}>Playback</Heading></View>
          <Button small label="Close" accessibilityLabel="Close playback" onPress={this.goBack} accessibility={a11y}/></Row>
        <Row><Button small label="−10s" accessibilityLabel="Back 10 seconds" onPress={() => this.seek(-10)} accessibility={a11y}/>
          <Button small preferred label={ended ? 'Replay' : paused ? 'Play' : 'Pause'} onPress={() => {
            if (ended && this.film) this.film.currentTime = 0;
            if (ended || paused) this.play(); else this.film?.pause();
          }} accessibility={a11y}/>
          <Button small label="+10s" accessibilityLabel="Forward 10 seconds" onPress={() => this.seek(10)} accessibility={a11y}/></Row>
        <Button small pressed={captions && story.transcript.length > 0} disabled={!story.transcript.length} onPress={this.toggleCaptions} accessibility={a11y}
          label={!story.transcript.length ? 'Captions unavailable' : captions ? 'Captions on' : 'Captions off'}/>
        {a11y.captions !== undefined && <Button small label="Use TV caption setting" onPress={this.systemCaptions} accessibility={a11y}/>}
        {captionStatus ? <Body small accessibility={a11y}>{captionStatus}</Body> : null}
      </Panel>}

      {screen === 'credits' && <Panel label="Film credits">
        <Row><View style={styles.grow}><Heading accessibility={a11y}>Film credits</Heading></View>
          <Button small preferred label="Close" accessibilityLabel="Close credits" onPress={this.close} accessibility={a11y}/></Row>
        <Body accessibility={a11y}>{story.ingestion?.credit ?? story.subtitle}</Body>
        {story.ingestion?.license_url ? <Body small accessibility={a11y}>License: {story.ingestion.license_url}</Body> : null}
        {captionStatus ? <Body small accessibility={a11y}>{captionStatus}</Body> : null}
        {story.ingestion?.evidence_notice ? <Body small accessibility={a11y}>{story.ingestion.evidence_notice}</Body> : null}
      </Panel>}

      {screen === 'exit' && <Panel place="center" label="Leave SELENE?">
        <Heading accessibility={a11y}>Leave SELENE?</Heading>
        <Body muted accessibility={a11y}>The story will stop. Press Back again to leave.</Body>
        <Row><Button small preferred label="Stay here" onPress={() => this.setState({screen: 'watch', controls: true})} accessibility={a11y}/>
          <Button small label="Leave SELENE" onPress={this.exit} accessibility={a11y}/></Row>
      </Panel>}

      {screen === 'error' && <Panel place="center" label="This moment is unavailable">
        <Heading accessibility={a11y}>This moment is unavailable</Heading>
        <Body muted live accessibility={a11y}>{error}</Body>
        <Row><Button small preferred label="Back to the story" onPress={this.close} accessibility={a11y}/>
          <Button small label="Retry this moment" onPress={() => {if (this.lastInput) void this.deliver(this.lastInput, this.lastSeekTo);}} accessibility={a11y}/>
          <Button small label="Edit request" onPress={() => this.setState({screen: 'ask', error: ''})} accessibility={a11y}/></Row>
      </Panel>}
    </View>;
  }

  private renderImport() {
    const a11y = this.props.accessibility;
    const {importing, importUrl, importTitle, error} = this.state;
    if (importing) return <Panel place="center" label="Importing MP4">
      <Body muted live accessibility={a11y}>Preparing the imported film. Cancel stops processing.</Body>
      <LoadingMark label="Cancel import" onCancel={this.cancelImport}/>
    </Panel>;
    return <Panel label="Import MP4">
      <Row><View style={styles.grow}><Heading accessibility={a11y}>Import MP4</Heading></View>
        <Button small label="Cancel" onPress={() => this.state.bundle ? this.setState({screen: 'films', error: ''}) : this.props.onCompanion()} accessibility={a11y}/></Row>
      <Body small accessibility={a11y}>Imports the full video. Import only media you have permission to use. Storage and model costs apply.</Body>
      <Field preferred label="HTTPS MP4 URL" value={importUrl} maxLength={2048} placeholder="https://publisher.example/film.mp4" onChange={value => this.setState({importUrl: value})} accessibility={a11y}/>
      <Field label="Title" value={importTitle} maxLength={500} placeholder="Title" onChange={value => this.setState({importTitle: value})} onSubmit={this.submitImport} accessibility={a11y}/>
      <Body small accessibility={a11y}>Selene uses embedded captions or transcribes the audio. Without dialogue it explains images only.</Body>
      <Button primary label="Import and open" onPress={() => {void this.submitImport();}} accessibility={a11y}/>
      {error ? <Body muted live accessibility={a11y}>{error}</Body> : null}
    </Panel>;
  }
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: palette.page},
  centre: {justifyContent: 'center', paddingHorizontal: '6%', gap: 16},
  video: {position: 'absolute', left: 0, top: 0, right: 0, bottom: 0},
  welcome: {position: 'absolute', left: 0, top: 0, bottom: 0, width: '60%', paddingHorizontal: '6%', justifyContent: 'center', gap: 14, backgroundColor: 'rgba(16,17,20,0.88)'},
  quiet: {position: 'absolute', right: '5%', bottom: '7%'},
  toolbar: {position: 'absolute', left: '5%', bottom: '7%', gap: 8, padding: 12, borderRadius: 14, backgroundColor: 'rgba(32,34,40,0.92)'},
  grow: {flex: 1},
  list: {gap: 8},
});
