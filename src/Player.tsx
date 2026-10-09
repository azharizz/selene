/* global AbortSignal */
// Native own-player (demo films and imports). Port of web/App.tsx without a WebView.
// Voice input and read-aloud are absent: they relied on browser speech APIs that Vega's native runtime does not provide.
import React from 'react';
import {AppState, BackHandler, Image, Pressable, StyleSheet, Text, View} from 'react-native';
import type {NativeEventSubscription} from 'react-native';
import AsyncStorage from '@amazon-devices/react-native-async-storage__async-storage';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import type {AccessibilitySnapshot} from './Accessibility';
import {clock, endSession, mediaUrl, openSession, request, RelayError} from './api';
import type {AssistantReply, Bundle, CatalogStory, Choice, Example, Input, Moment, Pairing, ReturnResult, Story} from './api';
import {NativeFilm} from './media';
import type {FilmEvent} from './media';
import {AskPanel, MomentPanel, plain} from './Moment';
import {OwnPlayerSession} from './OwnPlayerSession';
import {Actions, Alert, Captions, Control, Field, LoadingPanel, P, Sheet, SheetHead, WelcomeShade, Wordmark, palette, px} from './ui';

type Screen = 'watch' | 'ask' | 'loading' | 'moment' | 'preferences' | 'more' | 'exit' | 'error' | 'tools' | 'pair' | 'return' | 'credits' | 'films' | 'import';
type Props = {importMp4: boolean; accessibility: AccessibilitySnapshot; onCompanion: () => void; onReady: () => void};
type State = {
  bundle: Bundle | null; loadError: string; screen: Screen; started: boolean; controls: boolean; position: number; paused: boolean; ended: boolean; captions: boolean;
  request: string; moment: Moment | null; error: string; anchorAt: number; clarifying: boolean; choice: Choice;
  savedPlace: {at_seconds: number; epoch: number} | null; returnResult: ReturnResult | null; mirror: Pairing | null; pairing: boolean;
  examples: Example[]; examplesOpen: boolean; examplesStatus: 'loading' | 'ready' | 'error'; importUrl: string; importTitle: string; importing: boolean;
  turns: {question: string; answer: string}[]; reply: string; asked: string;
};
const CAPTIONS_KEY = 'selene.captions';

export class Player extends React.Component<Props, State> {
  state: State = {
    bundle: null, loadError: '', screen: this.props.importMp4 ? 'import' : 'watch', started: false, controls: true, position: 0, paused: true, ended: false, captions: true,
    request: '', moment: null, error: '', anchorAt: 0, clarifying: false, choice: 'unspecified', savedPlace: null, returnResult: null, mirror: null, pairing: false,
    examples: [], examplesOpen: false, examplesStatus: 'ready', importUrl: '', importTitle: '', importing: false,
    turns: [], reply: '', asked: '',
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
      this.setState({bundle, started: false, position: 0, paused: true, ended: false, controls: true, savedPlace: null, returnResult: null, mirror: null, moment: null, turns: [], reply: '', asked: ''});
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
    const result = await request<{command?: AssistantReply['command']}>('/api/playback', {method: 'POST', session: this.sessionId, signal, body: {content_id: story.id, content_version: story.content_version,
      sequence: ++this.relaySequence, epoch: this.playbackEpoch, at_seconds: Math.min(story.duration, Math.max(0, film.currentTime)),
      play_state: film.ended ? 'ended' : this.playState(), playback_rate: 1}});
    if (result.command) this.remote(result.command); // "Pause" or "go back" asked on the paired phone.
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
  private ask = () => {void this.askAssistant(this.state.request);};
  // Typed questions and suggestions go to the simulated Alexa+ orchestrator, which picks a SELENE skill over MCP.
  // A pending clarification is answered server-side by the same explanation.
  private askAssistant = async (text: string) => {
    const {anchorAt} = this.state, story = this.story, film = this.film;
    if (!story || !film) return;
    const question = text.trim();
    if (!question) {this.setState({error: 'Type a question or choose a suggestion.'}); return;}
    this.cancel(); this.lastInput = null;
    const pending = new AbortController(); this.pending = pending;
    this.setState({screen: 'loading', error: '', asked: question});
    try {
      await this.publishPlayback(pending.signal);
      const send = (session: string) => request<AssistantReply>('/api/assistant', {method: 'POST', session, signal: pending.signal, timeoutMs: 0,
        body: {request: question, content_id: story.id, at_seconds: anchorAt}});
      let reply: AssistantReply;
      try {reply = await send(this.sessionId);}
      catch (error) {if ((error as RelayError).status !== 410) throw error; reply = await send(await this.reopen(pending.signal));}
      if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
      this.pending = null;
      const turns = [...this.state.turns, {question, answer: reply.text}].slice(-2);
      if (reply.command) {this.setState({turns}); this.close(); this.remote(reply.command); return;}
      const moment = reply.moment;
      if (moment?.intervention.playback === 'request_pause') film.pause();
      const clarifying = moment?.state === 'clarification';
      this.setState({turns, moment, reply: reply.text, screen: clarifying ? 'ask' : 'moment', clarifying, request: ''});
    } catch (error) {
      if (pending.signal.aborted || !this.mounted) return;
      this.pending = null;
      this.setState({error: error instanceof Error ? error.message : 'Selene could not answer. Please try again.', screen: 'error'});
    }
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
      return <View style={[styles.page, styles.startup]}>
        <Wordmark size={px(28)}/>
        {loadError ? <>
          <P accessibility={a11y} live>{loadError}</P>
          <Actions style={styles.welcomeActions}><Control variant="welcome" preferred primary label="Try again" onPress={() => {void this.load();}} accessibility={a11y}/>
            <Control variant="welcome" text icon="back" label="Playback apps" accessibilityLabel="Connect to another playback app" onPress={this.props.onCompanion} accessibility={a11y}/></Actions>
        </> : <P muted accessibility={a11y} live>Loading the story…</P>}
      </View>;
    }
    const caption = this.captionAt(position);
    const captionStatus = story.ingestion ? !story.transcript.length || story.ingestion.caption_source === 'unavailable'
      ? 'Captions unavailable · dialogue is not captured; help is visual-only.'
      : story.ingestion.caption_source === 'generated' ? 'Generated captions · automated transcription may be inaccurate.'
        : story.ingestion.caption_source === 'embedded' ? 'Embedded captions' : 'Supplied captions' : '';
    const showCaptions = started && captions && ['watch', 'loading', 'moment', 'return', 'tools', 'pair'].includes(screen);
    const close = (label: string) => <Control icon="close" accessibilityLabel={label} preferred onPress={this.close} accessibility={a11y}/>;
    return <View style={styles.page}>
      {film && <KeplerVideoSurfaceView key={this.filmFor} style={styles.video} onSurfaceViewCreated={handle => film.attach(handle)} onSurfaceViewDestroyed={handle => film.detach(handle)}/>}
      {!started && <Image source={{uri: mediaUrl(story.poster)}} style={styles.video} resizeMode="contain"/>}
      {showCaptions && <Captions line={caption} accessibility={a11y}/>}

      {!started && screen === 'watch' && <View style={styles.welcome}>
        <WelcomeShade/>
        <Wordmark size={px(28) * (a11y.textScale ?? 1)}/>
        <View style={styles.welcomeCopy}>
          <Text allowFontScaling={false} accessibilityRole="header" style={[styles.welcomeTitle, fontScale(32, a11y, 1.14)]}>{story.title}</Text>
          <P muted accessibility={a11y} style={styles.welcomeLine}>{story.subtitle} · {clock(story.duration)}</P>
          {captionStatus ? <P muted size={19} accessibility={a11y} style={styles.welcomeLine}>{captionStatus}</P> : null}
          {error ? <Alert accessibility={a11y}>{error}</Alert> : null}
          <Actions style={styles.welcomeActions}>
            <Control variant="welcome" preferred primary icon="play" label={position > 0 ? 'Continue watching' : 'Watch demo'} onPress={this.start} accessibility={a11y}/>
            <Control variant="welcome" label="Films" onPress={() => this.setState({screen: 'films'})} accessibility={a11y}/>
          </Actions>
          <View style={styles.playbackApps}><Control variant="sheet" text icon="back" label="Playback apps" accessibilityLabel="Connect to another playback app" onPress={this.companion} accessibility={a11y}/></View>
        </View>
      </View>}

      {started && screen === 'watch' && (!controls
        ? <QuietControl saved={Boolean(savedPlace)} onPress={() => {if (savedPlace) void this.bringUsBack(); else this.setState({controls: true});}}/>
        : <View style={styles.toolbar} accessibilityLabel="Selene tools">
          <Control variant="toolbar" preferred primary label="Ask Selene" onPress={this.openAsk} accessibility={a11y}/>
          <Control variant="toolbar" square icon="more" accessibilityLabel="Selene tools" onPress={() => this.setState({screen: 'tools', error: ''})} accessibility={a11y}/>
          <Control variant="toolbar" square icon="close" accessibilityLabel="Hide Selene" onPress={() => this.setState({controls: false})} accessibility={a11y}/>
        </View>)}
      {started && screen === 'watch' && controls && error ? <View style={styles.watchAlert}><Alert accessibility={a11y}>{error}</Alert></View> : null}

      {screen === 'films' && <Sheet label="Choose a film">
        <SheetHead title="Films" accessibility={a11y}>{close('Close films')}</SheetHead>
        <View style={styles.list}>
          {(bundle.catalog ?? []).map((item: CatalogStory) => <Control key={item.id} block pressed={item.id === story.id} label={item.title} detail={clock(item.duration)}
            accessibilityLabel={`Open ${item.title}`} onPress={() => this.chooseStory(item.id)} accessibility={a11y}/>)}
        </View>
        <Actions style={styles.gapTop}>
          <Control label="Import MP4" onPress={() => {this.film?.pause(); this.cancel(); this.setState({screen: 'import', error: ''});}} accessibility={a11y}/>
          <Control text label="Film credits" onPress={() => this.setState({screen: 'credits'})} accessibility={a11y}/>
        </Actions>
      </Sheet>}

      {screen === 'import' && this.renderImport()}

      {screen === 'tools' && <Sheet label="Watch together">
        <SheetHead title="Watch together" accessibility={a11y}>
          <Control label="Films" accessibilityLabel="Change film" onPress={() => this.setState({screen: 'films'})} accessibility={a11y}/>
          {close('Close tools')}
        </SheetHead>
        <Actions>
          <Control primary label={savedPlace ? 'Bring us back' : 'Hold our place'} onPress={() => {if (savedPlace) void this.bringUsBack(); else this.savePlace();}} accessibility={a11y}/>
          <Control label={mirror ? 'Phone connection' : 'Pair phone'} onPress={() => {if (mirror) this.setState({screen: 'pair'}); else void this.openMirror();}} accessibility={a11y}/>
          <Control label="Playback" onPress={() => this.setState({screen: 'preferences'})} accessibility={a11y}/>
        </Actions>
        {savedPlace && <View style={styles.savedRow}><P muted size={16} accessibility={a11y}>Saved at {clock(savedPlace.at_seconds)}</P>
          <Control label="Clear" accessibilityLabel="Clear saved place" onPress={() => this.setState({savedPlace: null})} accessibility={a11y}/></View>}
        <Alert accessibility={a11y}>{error}</Alert>
      </Sheet>}

      {screen === 'pair' && <Sheet label="Use your phone">
        <SheetHead title="Use your phone" accessibility={a11y}>{close('Close pairing')}</SheetHead>
        {mirror ? <>
          <P muted accessibility={a11y}>Open {mirror.join_url}</P>
          <Text allowFontScaling={false} accessibilityLabel={`Pairing code ${mirror.code.split('').join(' ')}`} style={[styles.pairCode, fontScale(32, a11y, 1.3)]}>{`${mirror.code.slice(0, 3)} ${mirror.code.slice(3)}`}</Text>
          <P muted size={16} accessibility={a11y}>One phone. Code expires after five minutes. The TV keeps its own controls.</P>
          <Actions style={styles.gapTop}><Control label="New code" disabled={pairing} onPress={() => {void this.openMirror();}} accessibility={a11y}/>
            <Control label="Disconnect phone" disabled={pairing} onPress={() => {void this.stopMirror();}} accessibility={a11y}/></Actions>
        </> : <>
          <P muted live accessibility={a11y}>{pairing ? 'Creating your code…' : 'Pair a phone for private explanations.'}</P>
          <Actions style={styles.gapTop}><Control label="Create code" disabled={pairing} onPress={() => {void this.openMirror();}} accessibility={a11y}/></Actions>
        </>}
        <Alert accessibility={a11y}>{error}</Alert>
      </Sheet>}

      {screen === 'return' && returnResult && <MomentPanel moment={returnResult.moment?.visual.status === 'ready' ? returnResult.moment : null} onDismiss={this.closeReturn} dismissLabel="Close return" accessibility={a11y}
        text={returnResult.quote ? `“${returnResult.quote.text}”` : returnResult.moment ? plain(returnResult.moment.answer)
          : returnResult.status === 'unavailable' ? 'The recap could not be prepared. Close to try again.' : returnResult.status === 'no_gap' ? 'There was no gap at the sampled TV moment.'
            : 'There is not enough evidence for this gap. Replay it or ask someone watching with you.'}
        lines={[...(returnResult.quote ? [`Original caption · ${clock(returnResult.quote.at_seconds)} · Recap unavailable; close to retry.`] : []),
          `${returnResult.status === 'ready' ? 'Covers' : 'Requested'} ${clock(returnResult.from_seconds)} to ${clock(returnResult.through_seconds)}${position - returnResult.through_seconds >= 2 ? ` · TV ${clock(position)}` : ''}`]}/>}

      {screen === 'ask' && <AskPanel clarification={clarifying && moment ? plain(moment.answer) : undefined} request={this.state.request} onChange={value => this.setState({request: value})}
        onSubmit={this.ask} onClose={this.goBack} error={error} accessibility={a11y} turns={this.state.turns} label="SELENE · SIMULATED ALEXA+ EXPERIENCE"
        quick={[{label: 'Who is this?', onPress: () => {void this.askAssistant('Who is this?');}}, {label: 'What did I miss?', onPress: () => {void this.askAssistant('What did I miss?');}},
          {label: 'Something fun', onPress: () => {void this.askAssistant('Tell me something fun about this.');}}]}
        examples={{status: this.state.examplesStatus, items: this.state.examples, open: this.state.examplesOpen, anchorAt: this.state.anchorAt,
          onToggle: () => this.setState(({examplesOpen}) => ({examplesOpen: !examplesOpen})), onRetry: this.loadExamples, onSelect: this.selectExample}}/>}

      {screen === 'loading' && <LoadingPanel onCancel={this.close}/>}

      {screen === 'moment' && (moment || this.state.reply) && <MomentPanel moment={moment} text={moment ? undefined : this.state.reply} question={this.state.asked} error={error} onDismiss={this.dismiss} onMore={() => this.setState({screen: 'more'})} accessibility={a11y}
        notice={story.ingestion && moment?.grounding.evidence_ids.some(id => id.startsWith('frame-')) ? 'Sampled image; details may be inaccurate.' : undefined}/>}

      {screen === 'more' && <Sheet label="This moment">
        <SheetHead title="This moment" accessibility={a11y}><Control preferred icon="back" label="Back" onPress={this.goBack} accessibility={a11y}/></SheetHead>
        <Actions>
          {!paused && <Control label="Pause playback" onPress={() => {this.film?.pause(); this.setState({choice: 'pause_to_explore', screen: 'moment'});}} accessibility={a11y}/>}
          <Control label="Explain on phone" onPress={() => {if (mirror) this.setState({screen: 'pair'}); else void this.openMirror();}} accessibility={a11y}/>
          <Control label={paused ? 'Close, stay paused' : 'Dismiss'} onPress={this.dismiss} accessibility={a11y}/>
        </Actions>
      </Sheet>}

      {screen === 'preferences' && <Sheet label="Playback">
        <SheetHead title="Playback" accessibility={a11y}><Control icon="close" accessibilityLabel="Close playback" preferred onPress={this.goBack} accessibility={a11y}/></SheetHead>
        <Actions>
          <Control label="−10s" accessibilityLabel="Back 10 seconds" onPress={() => this.seek(-10)} accessibility={a11y}/>
          <Control label={ended ? 'Replay' : paused ? 'Play' : 'Pause'} onPress={() => {
            if (ended && this.film) this.film.currentTime = 0;
            if (ended || paused) this.play(); else this.film?.pause();
          }} accessibility={a11y}/>
          <Control label="+10s" accessibilityLabel="Forward 10 seconds" onPress={() => this.seek(10)} accessibility={a11y}/>
          <Control pressed={captions && story.transcript.length > 0} disabled={!story.transcript.length} onPress={this.toggleCaptions} accessibility={a11y}
            label={!story.transcript.length ? 'Captions unavailable' : captions ? 'Captions on' : 'Captions off'}/>
          {a11y.captions !== undefined && <Control label="Use TV caption setting" onPress={this.systemCaptions} accessibility={a11y}/>}
        </Actions>
        {captionStatus ? <P muted size={16} accessibility={a11y} style={styles.gapTop}>{captionStatus}</P> : null}
      </Sheet>}

      {screen === 'credits' && <Sheet label="Film credits">
        <SheetHead title="Film credits" accessibility={a11y}>{close('Close credits')}</SheetHead>
        <P accessibility={a11y}>{story.ingestion?.credit ?? story.subtitle}</P>
        {story.ingestion?.license_url ? <P muted size={16} accessibility={a11y} style={styles.gapTop}>License: {story.ingestion.license_url}</P> : null}
        {captionStatus ? <P muted size={16} accessibility={a11y} style={styles.gapTop}>{captionStatus}</P> : null}
        {story.ingestion?.evidence_notice ? <P muted size={16} accessibility={a11y} style={styles.gapTop}>{story.ingestion.evidence_notice}</P> : null}
      </Sheet>}

      {screen === 'exit' && <Sheet label="Leave SELENE?">
        <Text allowFontScaling={false} accessibilityRole="header" style={[styles.h2, fontScale(18, a11y, 1.3)]}>Leave SELENE?</Text>
        <P muted accessibility={a11y} style={styles.gapTop}>The story will stop. Press Back again to leave.</P>
        <Actions style={styles.gapTop}><Control preferred label="Stay here" onPress={() => this.setState({screen: 'watch', controls: true})} accessibility={a11y}/>
          <Control label="Leave SELENE" onPress={this.exit} accessibility={a11y}/></Actions>
      </Sheet>}

      {screen === 'error' && <Sheet label="This moment is unavailable">
        <Text allowFontScaling={false} accessibilityRole="header" style={[styles.h2, fontScale(18, a11y, 1.3)]}>This moment is unavailable</Text>
        <Alert accessibility={a11y}>{error}</Alert>
        <Actions style={styles.gapTop}><Control preferred label="Back to the story" onPress={this.close} accessibility={a11y}/>
          <Control label="Retry this moment" onPress={() => {if (this.lastInput) void this.deliver(this.lastInput, this.lastSeekTo); else if (this.state.asked) void this.askAssistant(this.state.asked);}} accessibility={a11y}/>
          <Control label="Edit request" onPress={() => this.setState({screen: 'ask', error: ''})} accessibility={a11y}/></Actions>
      </Sheet>}
    </View>;
  }

  // .media-import: sheet with labelled 18px inputs; the busy state is the loading square with a Cancel import action.
  private renderImport() {
    const a11y = this.props.accessibility;
    const {importing, importUrl, importTitle, error} = this.state;
    if (importing) return <LoadingPanel label="Cancel import" onCancel={this.cancelImport}/>;
    return <Sheet label="Import MP4">
      <SheetHead title="Import MP4" accessibility={a11y}>
        <Control preferred label="Cancel" onPress={() => this.state.bundle ? this.setState({screen: 'films', error: ''}) : this.props.onCompanion()} accessibility={a11y}/>
      </SheetHead>
      <P muted size={16} accessibility={a11y}>Imports the full video. Import only media you have permission to use. Storage and model costs apply.</P>
      <View style={styles.form}>
        <View style={styles.label}><P size={18} accessibility={a11y}>HTTPS MP4 URL</P>
          <Field label="HTTPS MP4 URL" value={importUrl} maxLength={2048} placeholder="https://publisher.example/film.mp4" onChange={value => this.setState({importUrl: value})} accessibility={a11y}/></View>
        <View style={styles.label}><P size={18} accessibility={a11y}>Title</P>
          <Field label="Title" value={importTitle} maxLength={500} placeholder="" onChange={value => this.setState({importTitle: value})} onSubmit={this.submitImport} accessibility={a11y}/></View>
        <P muted size={16} accessibility={a11y}>Without supplied or embedded captions, Selene can explain images but not dialogue.</P>
        <Control primary label="Import and open" onPress={() => {void this.submitImport();}} accessibility={a11y}/>
      </View>
      <Alert accessibility={a11y}>{error}</Alert>
    </Sheet>;
  }
}

// .quiet-control: 40px square at bottom/right 6%, surface #202228ed, the 24px crescent, accent saved-place dot.
function QuietControl({saved, onPress}: {saved: boolean; onPress: () => void}) {
  const [focused, setFocused] = React.useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Bring us back' : 'Selene'} hasTVPreferredFocus onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.quiet, focused && styles.quietFocused]}>
    {focused && <View pointerEvents="none" style={styles.quietRing}/>}
    <Wordmark size={px(24)} markOnly/>
    {saved && <View pointerEvents="none" style={styles.savedDot}/>}
  </Pressable>;
}

const fontScale = (cssSize: number, accessibility: AccessibilitySnapshot, lineHeight = 1.45) => {
  const size = px(cssSize) * (accessibility.textScale ?? 1);
  return {fontSize: size, lineHeight: size * lineHeight};
};

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: palette.page},
  startup: {justifyContent: 'center', padding: '5%', gap: px(16)},
  video: {position: 'absolute', left: 0, top: 0, right: 0, bottom: 0},
  welcome: {position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, padding: '5%', justifyContent: 'center', gap: px(32)},
  welcomeCopy: {width: px(640), maxWidth: '90%', padding: px(8)},
  welcomeTitle: {color: palette.ink, fontWeight: '600', letterSpacing: -0.025 * px(32)},
  welcomeLine: {marginTop: px(10)},
  welcomeActions: {marginTop: px(18), gap: px(12)},
  playbackApps: {marginTop: px(16)},
  quiet: {position: 'absolute', right: '6%', bottom: '6%', width: px(40), height: px(40), borderRadius: px(12), backgroundColor: 'rgba(32,34,40,0.93)', alignItems: 'center', justifyContent: 'center'},
  quietFocused: {backgroundColor: palette.ink},
  quietRing: {position: 'absolute', top: -px(4), bottom: -px(4), left: -px(4), right: -px(4), borderRadius: px(16), borderWidth: px(3), borderColor: palette.ink},
  savedDot: {position: 'absolute', right: px(2), top: px(2), width: px(6), height: px(6), borderRadius: px(3), backgroundColor: palette.accent},
  toolbar: {position: 'absolute', right: '5%', bottom: '5%', flexDirection: 'row', alignItems: 'center', gap: px(4), padding: px(6), borderRadius: px(12), backgroundColor: palette.surface},
  watchAlert: {position: 'absolute', right: '5%', bottom: '14%', maxWidth: px(560)},
  list: {gap: px(6), marginTop: px(8)},
  gapTop: {marginTop: px(12)},
  savedRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: px(8), marginTop: px(8)},
  pairCode: {color: palette.ink, letterSpacing: 0.14 * px(32), marginTop: px(12)},
  h2: {color: palette.ink, fontWeight: '500'},
  form: {gap: px(14), marginTop: px(16)},
  label: {gap: px(6)},
});
