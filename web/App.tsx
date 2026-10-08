import React from 'react';
import {createRoot} from 'react-dom/client';
import {Visual} from './Visual';
import {Voice, type VoiceState} from './voice';
import {CompanionMoment, type CompanionBootstrap} from './CompanionMoment';
import {PrivateMirror, JoinPhone} from './PrivateMirror';
import {focusPanel, moveFocus} from './navigation';
import './style.css';
import {Brand, Icon, LoadingMark} from './Brand';
import {readPreferences, savePreferences, type Need, type Recipient, type Language, type Preferences} from './preferences';
import {accessibilitySettings, initialAccessibility, applyAccessibility, captionChoice, saveCaptionChoice, captionStyle, type AccessibilitySettings} from './accessibility';
import {clock, personalRequest, type PersonalStory, type PersonalMoment, type ReturnResult, type Pairing} from './personal';
import {observeMedia, reportMedia} from './mediaDiagnostics';
import {MediaImport} from './MediaImport';

type Choice = 'unspecified' | 'keep_watching' | 'pause_to_explore';
type Story = PersonalStory;
type CatalogStory = {id: string; title: string; subtitle: string; duration: number; poster: string};
type Moment = PersonalMoment;
type PreparedExample = {id: string; request: string; at_seconds: number};
type Input = {
  request: string; content_id: string; at_seconds: number; play_state: 'playing' | 'paused' | 'ended';
  playback_choice: Choice; need: Need; language: Language; session: 'family' | 'solo'; recipient: Recipient;
  continuation: {request: string; question: string; answer: string} | null;
};
type Screen = 'watch' | 'ask' | 'loading' | 'moment' | 'preferences' | 'more' | 'exit' | 'error' | 'tools' | 'pair' | 'return' | 'credits' | 'films' | 'import';
type State = {
  started: boolean; session: 'family' | 'solo'; screen: Screen; need: Need; language: Language; recipient: Recipient;
  request: string; moment: Moment | null; position: number; paused: boolean; captions: boolean; controls: boolean;
  accessibility: AccessibilitySettings;
  error: string; voice: VoiceState; anchorAt: number; clarifying: boolean; choice: Choice; background: boolean; mirror: Pairing | null; returnScreen: 'watch' | 'ask';
  savedPlace: {at_seconds: number; epoch: number} | null; returnResult: ReturnResult | null; preparingReturn: boolean; pairing: boolean; examples: PreparedExample[]; examplesOpen: boolean; examplesStatus: 'loading' | 'ready' | 'error';
};
type Bundle = {session_id: string; story: Story; catalog?: CatalogStory[]};
const locale: Record<Language, string> = {English: 'en-US', Indonesian: 'id-ID', Spanish: 'es-ES'};
const native = (window as Window & {ReactNativeWebView?: {postMessage: (message: string) => void}}).ReactNativeWebView;

async function openSession(contentId: string | null, signal?: AbortSignal): Promise<Bundle> {
  const response = await fetch('/api/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(contentId ? {content_id: contentId} : {}), signal});
  if (!response.ok) throw new Error('The story service is unavailable. Try again.');
  return response.json();
}

export class App extends React.Component<Bundle, State> {
  state: State = {
    started: false, screen: new URLSearchParams(location.search).get('import') === 'mp4' ? 'import' : 'watch', ...readPreferences(),
    request: '', moment: null, position: 0, paused: true, captions: captionChoice(initialAccessibility().captions), accessibility: initialAccessibility(), controls: true, error: '', voice: 'idle',
    anchorAt: 0, clarifying: false, choice: 'unspecified', background: document.hidden, mirror: null, returnScreen: 'watch',
    savedPlace: null, returnResult: null, preparingReturn: false, pairing: false, examples: [], examplesOpen: false, examplesStatus: 'ready',
  };
  private video = React.createRef<HTMLVideoElement>();
  private surface = React.createRef<HTMLElement>();
  private pending: AbortController | null = null;
  private resumingResponse = false;
  private sessionId = this.props.session_id;
  private lastInput: Input | null = null;
  private lastSeekTo: number | undefined;
  private resumeAt = 0;
  private playbackRevision = 0;
  private lastNativeStateAt = 0;
  private relayTimer: ReturnType<typeof setInterval> | null = null;
  private relaySequence = 0;
  private playbackEpoch = 0;
  private pairingRequest: AbortController | null = null;
  private buffering = false;
  private examplesRequest: AbortController | null = null;
  private mounted = false;
  private stopMediaDiagnostics: (() => void) | null = null;
  private voice = new Voice(() => this.video.current,
    voice => {if (this.mounted) this.setState({voice});},
    error => {if (this.mounted) this.setState({error});},
    focused => {native?.postMessage(JSON.stringify({type: 'selene:audio-focus', focused}));});

  private preferences = (selection: Partial<Preferences>) => {
    const {need, language, recipient, session} = this.state;
    const preferences = {need, language, recipient, session, ...selection};
    savePreferences(preferences); this.setState(preferences);
  };

  componentDidMount() {
    this.mounted = true;
    if (this.video.current) this.stopMediaDiagnostics = observeMedia(this.video.current, this.props.story.id);
    applyAccessibility(this.state.accessibility);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.endSession);
    window.addEventListener('keydown', this.key);
    window.addEventListener('message', this.nativeMessage);
    this.relayTimer = setInterval(() => {if (this.state.started && !document.hidden) this.postPlayerState();}, 2000);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({title: this.props.story.title, artist: 'SELENE'});
      navigator.mediaSession.setActionHandler('play', () => {this.traceControl('media-session', 'play'); this.play();});
      navigator.mediaSession.setActionHandler('pause', () => {this.traceControl('media-session', 'pause'); this.video.current?.pause();});
      navigator.mediaSession.setActionHandler('seekbackward', details => {this.traceControl('media-session', 'seekbackward'); this.seek(-(details.seekOffset ?? 10));});
      navigator.mediaSession.setActionHandler('seekforward', details => {this.traceControl('media-session', 'seekforward'); this.seek(details.seekOffset ?? 10);});
    }
  }
  componentDidUpdate() {
    const surface = this.surface.current;
    if (surface && (!surface.contains(document.activeElement) || document.activeElement?.matches(':disabled'))) this.focusPanel(surface.querySelector<HTMLElement>('[data-panel]') ?? surface);
  }
  componentWillUnmount() {
    this.mounted = false;
    this.stopMediaDiagnostics?.();
    if (this.relayTimer) clearInterval(this.relayTimer);
    this.pairingRequest?.abort();
    this.examplesRequest?.abort();
    this.cancel(); this.endSession();
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.endSession);
    window.removeEventListener('keydown', this.key);
    window.removeEventListener('message', this.nativeMessage);
    if ('mediaSession' in navigator) {
      for (const action of ['play', 'pause', 'seekbackward', 'seekforward'] as const) navigator.mediaSession.setActionHandler(action, null);
      navigator.mediaSession.metadata = null;
    }
  }
  private cancel = () => {this.pending?.abort(); this.pending = null; this.voice.stop();};
  private traceControl = (route: string, action: string) => {
    if (this.video.current) reportMedia(this.video.current, this.props.story.id, 'control', `${route}:${action}`);
  };
  private playbackState = () => {
    const player = this.video.current;
    if (player?.ended) return 'stopped' as const;
    if (!player || player.paused) return 'paused' as const;
    return this.buffering ? 'buffering' as const : 'playing' as const;
  };
  private endSession = () => {
    this.cancel();
    this.pairingRequest?.abort();
    if (this.sessionId) navigator.sendBeacon('/api/session/end', new Blob([JSON.stringify({session_id: this.sessionId})], {type: 'application/json'}));
    this.sessionId = '';
  };
  private visibility = () => {
    if (document.hidden) {
      this.resumeAt = this.video.current?.currentTime ?? this.state.position;
      this.video.current?.pause(); this.cancel();
      void this.stopMirror();
      this.lastInput = null;
      this.setState({background: true, started: false, screen: 'watch', moment: null, controls: true, paused: true, request: ''});
    } else this.setState({background: false});
  };
  private focusPanel = focusPanel;
  private close = () => {
    this.cancel(); this.lastInput = null;
    this.setState({screen: 'watch', moment: null, controls: true, request: '', error: '', clarifying: false, choice: 'unspecified', returnResult: null, preparingReturn: false});
  };
  private dismiss = () => {this.close(); this.setState({controls: false});};
  private closeReturn = () => {
    if (['ready', 'no_gap'].includes(this.state.returnResult?.status ?? '')) this.setState({savedPlace: null});
    this.dismiss();
  };
  private play = () => {
    if (document.hidden || this.state.screen === 'import') return;
    this.voice.stop();
    this.video.current?.play().catch((error: unknown) => {
      if (this.video.current) reportMedia(this.video.current, this.props.story.id, 'play-rejected', error instanceof Error ? error.name : 'UnknownError');
      if (this.mounted) this.setState({error: 'Playback could not start. Press Play to try again.', controls: true});
    });
  };
  private postPlayerState = (force = false) => {
    const player = this.video.current;
    if (!player) return;
    if (!force && Date.now() - this.lastNativeStateAt < 1000) return;
    this.lastNativeStateAt = Date.now();
    native?.postMessage(JSON.stringify({type: 'selene:player-state', state: {
      state: this.playbackState(),
      position_ms: Number.isFinite(player.currentTime) ? player.currentTime * 1000 : 0,
      duration_ms: Number.isFinite(player.duration) ? player.duration * 1000 : 0,
      muted: player.muted, volume: player.volume,
    }}));
    void this.publishPlayback().catch(() => undefined); // A missing heartbeat makes phone help explicitly unavailable.
  };
  private captionAt = (position: number) => this.props.story.transcript.find(line => position >= line.start && position < line.end);
  private timeUpdate = () => {
    const position = this.video.current?.currentTime ?? 0;
    // Refresh the displayed second or cue, including fractional caption boundaries.
    // Native/phone reports and saved places still sample the exact video clock.
    if (Math.floor(position) !== Math.floor(this.state.position) || this.captionAt(position) !== this.captionAt(this.state.position)) {
      this.setState({position});
    }
    this.postPlayerState();
  };
  private publishPlayback = async (signal?: AbortSignal) => {
    const player = this.video.current;
    if (!player || !this.sessionId) throw new Error('Start the film before connecting a phone.');
    // currentTime changes before the seeking event advances the epoch. Never publish that intermediate sample.
    if (player.seeking) throw new Error('Wait for the TV to finish seeking, then try again.');
    await personalRequest('/api/playback', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': this.sessionId}, signal,
      body: JSON.stringify({content_id: this.props.story.id, content_version: this.props.story.content_version,
        sequence: ++this.relaySequence, epoch: this.playbackEpoch, at_seconds: Math.min(this.props.story.duration, Math.max(0, player.currentTime)),
        play_state: player.ended ? 'ended' : this.playbackState(), playback_rate: player.playbackRate})});
  };
  private playbackSeek = () => {
    this.playbackEpoch++;
    this.setState({savedPlace: null, returnResult: null});
    if (!this.resumingResponse && !(this.pending && this.lastSeekTo !== undefined) && (this.pending || this.state.screen !== 'watch')) this.close();
    this.postPlayerState(true);
  };
  private savePlace = () => {
    const player = this.video.current;
    if (!player) return;
    this.cancel();
    this.setState({savedPlace: {at_seconds: Math.min(this.props.story.duration, Math.max(0, player.currentTime)), epoch: this.playbackEpoch}, screen: 'watch', controls: false, error: ''});
  };
  private bringUsBack = async () => {
    const saved = this.state.savedPlace, player = this.video.current;
    if (!saved || !player) return;
    this.cancel(); this.lastInput = null;
    const pending = new AbortController(); this.pending = pending;
    this.setState({screen: 'loading', preparingReturn: true, returnResult: null, error: ''});
    try {
      await this.publishPlayback(pending.signal);
      const {need, language, recipient} = this.state;
      const result = await personalRequest('/api/return', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': this.sessionId}, signal: pending.signal,
        body: JSON.stringify({content_version: this.props.story.content_version, epoch: saved.epoch, from_seconds: saved.at_seconds, need, language, recipient})}, 45000);
      if (!this.mounted || this.pending !== pending || pending.signal.aborted || saved.epoch !== this.playbackEpoch) return;
      if (player.paused && !player.ended) {
        this.resumingResponse = true;
        try {await player.play();} finally {this.resumingResponse = false;}
      }
      if (player.paused && !player.ended) throw new Error('Playback could not resume. Close the recap and press Play to try again.');
      this.pending = null;
      this.setState({returnResult: result as ReturnResult, screen: 'return', preparingReturn: false});
    } catch (error) {
      if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
      this.pending = null; this.setState({screen: 'tools', preparingReturn: false, error: error instanceof Error ? error.message : 'This return is unavailable.'});
    }
  };
  private nativeMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = typeof event.data === 'string' ? (() => {try {return JSON.parse(event.data);} catch {return null;}})() : event.data;
    if (message?.type === 'selene:accessibility') {
      const accessibility = accessibilitySettings(message.settings);
      applyAccessibility(accessibility);
      if (accessibility.screenReader && this.state.voice === 'speaking') this.voice.stop();
      this.setState({accessibility, captions: captionChoice(accessibility.captions)});
      return;
    }
    if (!message || message.type !== 'selene:native-player') return;
    const player = this.video.current;
    if (!player) return;
    if (message.action === 'back') {this.back(); return;}
    if (this.state.screen === 'import') {if (message.action === 'request_state') this.postPlayerState(true); return;}
    if (['play', 'pause', 'stop', 'start_over', 'seek', 'set_mute', 'set_volume'].includes(message.action)) this.traceControl('player-session', message.action);
    if (message.action === 'play') this.play();
    if (message.action === 'pause') player.pause();
    if (message.action === 'stop') {player.pause(); player.currentTime = 0;}
    if (message.action === 'start_over') {player.currentTime = 0; this.play();}
    if (message.action === 'seek') {
      const target = message.relative ? player.currentTime * 1000 + Number(message.position_ms) : Number(message.position_ms ?? 0);
      player.currentTime = Math.max(0, Math.min(Number.isFinite(player.duration) ? player.duration : this.props.story.duration, target / 1000));
    }
    if (message.action === 'set_mute') player.muted = Boolean(message.muted);
    if (message.action === 'set_volume' && Number.isFinite(message.volume)) player.volume = Math.max(0, Math.min(1, Number(message.volume)));
    if (message.action === 'request_state' || ['play', 'pause', 'stop', 'start_over', 'seek', 'set_mute', 'set_volume'].includes(message.action)) this.postPlayerState(true);
  };
  private seek = (by: number) => {
    const player = this.video.current;
    if (!player) return;
    this.close();
    player.currentTime = Math.max(0, Math.min(this.props.story.duration, player.currentTime + by));
  };
  private toggleCaptions = () => {const captions = !this.state.captions; saveCaptionChoice(captions); this.setState({captions});};
  private systemCaptions = () => {saveCaptionChoice(null); this.setState({captions: captionChoice(this.state.accessibility.captions)});};
  private start = async (session: 'family' | 'solo') => {
    if (!this.sessionId) {
      this.cancel();
      const pending = new AbortController(); this.pending = pending;
      try {
        const bundle = await openSession(this.props.story.id, pending.signal);
        if (!this.mounted || pending.signal.aborted || this.pending !== pending) return;
        if (bundle.story.content_version !== this.props.story.content_version) {window.location.reload(); return;}
        this.sessionId = bundle.session_id; this.pending = null;
        this.setState({mirror: null, pairing: false, savedPlace: null, returnResult: null});
      } catch {
        if (this.mounted && !pending.signal.aborted) {this.pending = null; this.setState({error: 'The viewing session could not start. Try again.'});}
        return;
      }
    }
    this.setState({session, started: true, controls: false, error: ''}, this.play);
  };
  private openAsk = () => {
    this.voice.stop();
    const anchorAt = Math.min(this.props.story.duration, this.video.current?.currentTime ?? this.state.position);
    this.setState({screen: 'ask', anchorAt, request: '', clarifying: false, error: '', choice: 'unspecified', preparingReturn: false, examples: [], examplesOpen: false}, this.loadExamples);
  };
  private loadExamples = async () => {
    const {anchorAt} = this.state;
    const pending = new AbortController(); this.examplesRequest?.abort(); this.examplesRequest = pending;
    this.setState({examplesStatus: 'loading'});
    try {
      const result = await personalRequest(`/api/examples?content_id=${encodeURIComponent(this.props.story.id)}&at_seconds=${anchorAt}`, {method: 'GET', signal: pending.signal}, 5000);
      if (this.mounted && this.examplesRequest === pending && this.state.screen === 'ask' && this.state.anchorAt === anchorAt)
        this.setState({examples: result.examples, examplesStatus: 'ready'});
    } catch {
      if (this.mounted && !pending.signal.aborted && this.examplesRequest === pending && this.state.screen === 'ask' && this.state.anchorAt === anchorAt)
        this.setState({examplesStatus: 'error'});
    }
  };
  private back = () => {
    const {screen, voice, started, controls, clarifying} = this.state;
    if (voice !== 'idle') return this.voice.stop();
    if (screen === 'exit') return this.exit();
    if (screen === 'preferences') return this.setState({screen: this.state.returnScreen});
    if (screen === 'more') return this.setState({screen: 'moment'});
    if (screen === 'return') return this.closeReturn();
    if (screen === 'import') return this.setState({screen: 'films'});
    if (screen === 'ask' && clarifying) {
      return this.setState({screen: 'moment', clarifying: false, error: ''});
    }
    if (screen === 'moment') return this.dismiss();
    if (screen !== 'watch') return this.close();
    if (started && controls) return this.setState({controls: false});
    this.setState({screen: 'exit'});
  };
  private exit = () => {
    this.video.current?.pause(); this.endSession();
    if (native) native.postMessage('selene:exit');
    else this.setState({started: false, screen: 'watch', moment: null, controls: true, request: '', error: '', mirror: null, pairing: false, savedPlace: null, returnResult: null, preparingReturn: false});
  };
  private companion = () => {this.video.current?.pause(); this.endSession(); native?.postMessage('selene:companion');};
  private chooseStory = (id: string) => {
    if (id === this.props.story.id) return this.close();
    this.video.current?.pause(); this.endSession();
    window.location.assign(`/?story=${encodeURIComponent(id)}`);
  };
  private openImport = () => {
    this.video.current?.pause(); this.cancel();
    this.setState({screen: 'import', error: ''});
  };
  private importSession = async (signal: AbortSignal) => {
    if (!this.sessionId) {
      const bundle = await openSession(this.props.story.id, signal);
      if (signal.aborted || !this.mounted) throw new DOMException('Import cancelled', 'AbortError');
      this.sessionId = bundle.session_id;
      this.setState({mirror: null, pairing: false, savedPlace: null, returnResult: null});
    }
    return this.sessionId;
  };

  private ask = (choice: Choice) => {
    const player = this.video.current;
    if (!player) return;
    const {need, language, recipient, session, moment, clarifying, request, anchorAt} = this.state;
    if (!request.trim()) {this.setState({error: 'Type a question or choose an example.'}); return;}
    const input: Input = {
      request: clarifying && this.lastInput ? this.lastInput.request : request.trim(),
      content_id: this.props.story.id, at_seconds: anchorAt,
      play_state: player.ended ? 'ended' : player.paused ? 'paused' : 'playing',
      playback_choice: choice, need, language, recipient, session,
      continuation: clarifying && moment && this.lastInput ? {request: this.lastInput.request, question: moment.answer, answer: request.trim()} : null,
    };
    this.deliver(input);
  };
  private selectExample = (example: PreparedExample) => {
    const player = this.video.current;
    if (!player) return;
    // Prepared demos have a fixed presentation; ordinary questions keep the viewer's preferences.
    const input: Input = {request: example.request, content_id: this.props.story.id, at_seconds: example.at_seconds,
      play_state: player.ended ? 'ended' : player.paused ? 'paused' : 'playing', playback_choice: 'keep_watching',
      need: this.state.need === 'Slower answer voice' ? 'Slower answer voice' : 'Show visually', language: 'English',
      recipient: 'everyone', session: this.state.session, continuation: null};
    return this.deliver(input, example.at_seconds > this.state.anchorAt ? example.at_seconds : undefined);
  };
  private deliver = async (input: Input, seekTo?: number) => {
    const player = this.video.current;
    if (!player) return;
    const choice = input.playback_choice;
    if (choice === 'pause_to_explore') player.pause();
    input = {...input, play_state: player.ended ? 'ended' : player.paused ? 'paused' : 'playing'};
    this.lastInput = input;
    this.lastSeekTo = seekTo;
    this.cancel();
    const pending = new AbortController(); this.pending = pending;
    const playbackRevision = this.playbackRevision;
    this.setState({screen: 'loading', error: '', choice, anchorAt: seekTo === undefined ? input.at_seconds : this.state.anchorAt});
    try {
      if (seekTo !== undefined) {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timer); player.removeEventListener('seeked', sought); player.removeEventListener('error', failed);
            pending.signal.removeEventListener('abort', aborted);
            error ? reject(error) : resolve();
          };
          const sought = () => finish();
          const failed = () => finish(new Error('The prepared demo moment could not be loaded. Try again.'));
          const aborted = () => finish(pending.signal.reason);
          const timer = setTimeout(failed, 5000);
          player.addEventListener('seeked', sought, {once: true}); player.addEventListener('error', failed, {once: true});
          pending.signal.addEventListener('abort', aborted, {once: true});
          try {player.currentTime = seekTo; if (!player.seeking) finish();}
          catch (error) {finish(error instanceof Error ? error : new Error('The prepared demo moment could not be loaded.'));}
        });
        if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
        const at = Math.min(this.props.story.duration, player.currentTime);
        if (!Number.isFinite(at) || at < seekTo) throw new Error('The player did not reach the prepared demo moment. Try again.');
        input = {...input, at_seconds: at, play_state: player.ended ? 'ended' : player.paused ? 'paused' : 'playing'};
        this.lastInput = input; this.setState({anchorAt: at});
        this.lastSeekTo = undefined;
      }
      if (!this.sessionId) this.sessionId = (await openSession(this.props.story.id, pending.signal)).session_id;
      let response = await this.send(input, pending.signal);
      if (response.status === 410) {
        this.sessionId = (await openSession(this.props.story.id, pending.signal)).session_id;
        this.setState({mirror: null, pairing: false});
        response = await this.send(input, pending.signal);
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'This moment could not be prepared. Please try again.');
      if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
      if (result.state === 'quiet') return this.close();
      if (result.state === 'response') {
        if (!player.ended) {
          this.resumingResponse = true;
          try {await player.play();} finally {this.resumingResponse = false;}
        }
        if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
        if (player.paused && !player.ended) throw new Error('Playback could not resume. Press Play and try again.');
        result.intervention.playback = 'keep_watching';
      } else if (result.intervention.playback === 'request_pause') {
        if (playbackRevision === this.playbackRevision) player.pause();
        else result.intervention.playback = 'keep_watching';
      }
      this.pending = null;
      this.setState({moment: result, screen: result.state === 'clarification' ? 'ask' : 'moment', clarifying: result.state === 'clarification', request: result.state === 'clarification' ? '' : this.state.request,
        choice: result.intervention.playback === 'request_pause' ? 'pause_to_explore' : choice,
      });
    } catch (error) {
      if (pending.signal.aborted || !this.mounted) return;
      this.pending = null;
      this.setState({error: error instanceof Error ? error.message : 'This moment could not be prepared. Please try again.', screen: 'error'});
    }
  };
  private send(input: Input, signal: AbortSignal) {
    return fetch('/api/moment', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': this.sessionId}, body: JSON.stringify(input), signal});
  }
  private openMirror = async () => {
    if (!this.sessionId || this.state.pairing) return;
    this.setState({screen: 'pair', pairing: true, error: ''});
    const pending = new AbortController(); this.pairingRequest?.abort(); this.pairingRequest = pending;
    const sessionId = this.sessionId;
    try {
      await this.publishPlayback(pending.signal);
      const result = await personalRequest('/api/private/pair', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': sessionId}, body: '{}', signal: pending.signal});
      if (typeof result.code !== 'string') throw new Error('Phone pairing is unavailable.');
      if (this.mounted && !pending.signal.aborted && this.sessionId === sessionId) this.setState({mirror: result as Pairing});
    } catch (error) {if (this.mounted && !pending.signal.aborted) this.setState({error: error instanceof Error ? error.message : 'Phone pairing is unavailable.'});}
    finally {if (this.mounted && this.pairingRequest === pending) {this.pairingRequest = null; this.setState({pairing: false});}}
  };
  private stopMirror = async () => {
    this.pairingRequest?.abort();
    const pending = new AbortController(); this.pairingRequest = pending;
    const sessionId = this.sessionId;
    this.setState({pairing: true, error: ''});
    try {
      if (sessionId) {
        await personalRequest('/api/private/close', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': sessionId}, body: '{}', signal: pending.signal})
          .catch(error => {if (error.status !== 410) throw error;});
      }
      if (this.mounted && this.pairingRequest === pending && this.sessionId === sessionId) this.setState({mirror: null});
    } catch {
      if (this.mounted && this.pairingRequest === pending && !pending.signal.aborted) this.setState({error: 'The phone may still be connected. Try Disconnect phone again.'});
    } finally {
      if (this.mounted && this.pairingRequest === pending) {this.pairingRequest = null; this.setState({pairing: false});}
    }
  };
  private pauseMoment = () => {
    this.voice.stop(); this.video.current?.pause();
    this.setState({choice: 'pause_to_explore'});
  };
  private readAloud = () => {
    if (this.state.accessibility.screenReader) return;
    const {moment, need, language, voice} = this.state;
    if (voice === 'speaking') return this.voice.stop();
    if (!this.state.paused) {this.setState({error: 'Pause the film before reading the answer aloud.'}); return;}
    if (moment) this.voice.speak(moment.answer, locale[need === 'Translate' ? language : 'English'], need === 'Slower answer voice');
  };
  private listen = () => {
    if (this.state.voice === 'listening') return this.voice.finishListening();
    this.setState({error: ''});
    this.voice.listen(locale[this.state.language], request => {if (this.mounted) this.setState({request});});
  };
  private key = (event: KeyboardEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : this.surface.current;
    if (!target) return;
    if (['Escape', 'BrowserBack', 'GoBack'].includes(event.key) || event.keyCode === 27) {
      event.preventDefault();
      if (this.state.screen === 'import') {this.back(); return;}
      if (target.matches('textarea,select')) {this.surface.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus(); return;}
      this.back(); return;
    }
    if (event.key === 'MediaPlayPause' || (event.key === ' ' && target === this.surface.current)) {
      this.traceControl('keyboard', event.key === 'MediaPlayPause' ? 'toggle' : 'space');
      event.preventDefault(); this.video.current?.paused ? this.play() : this.video.current?.pause(); return;
    }
    if (!event.key.startsWith('Arrow') || target.matches('textarea,input,select')) return;
    event.preventDefault();
    if (this.state.screen === 'watch' && !this.state.controls && this.state.started) {this.setState({controls: true}); return;}
    moveFocus(event, this.surface.current);
  };

  render() {
    const {story} = this.props;
    const {started, screen, session, need, request, moment, position, paused, captions, controls, error, voice, clarifying, background, mirror, savedPlace, returnResult} = this.state;
    const caption = this.captionAt(position);
    const captionStatus = story.ingestion ? !story.transcript.length || story.ingestion.caption_source === 'unavailable'
      ? 'Captions unavailable · dialogue is not captured; help is visual-only.'
      : story.ingestion.caption_source === 'generated' ? 'Generated captions · automated transcription may be inaccurate.'
      : story.ingestion.caption_source === 'embedded' ? 'Embedded captions' : 'Supplied captions' : '';

    return <main ref={this.surface} tabIndex={-1} className="app">
      <video ref={this.video} src={started && !background ? story.video : undefined} poster={story.poster} playsInline preload="metadata" disableRemotePlayback
        onLoadedMetadata={() => {if (this.video.current && this.resumeAt > 0) {this.video.current.currentTime = this.resumeAt; this.resumeAt = 0;} this.postPlayerState(true);}}
        onTimeUpdate={this.timeUpdate}
        onPlay={() => {this.buffering = false; this.playbackRevision++; this.setState({paused: false, started: true}); this.postPlayerState(true); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';}}
        onPause={() => {this.buffering = false; this.playbackRevision++; this.setState({paused: true}); this.postPlayerState(true); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';}}
        onEnded={() => {this.voice.stop(); this.setState({paused: true, controls: true}); this.postPlayerState(true); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';}}
        onSeeking={this.playbackSeek} onSeeked={() => {this.buffering = false; this.postPlayerState(true);}}
        onWaiting={() => {this.buffering = true; this.postPlayerState(true);}}
        onPlaying={() => {this.buffering = false; this.postPlayerState(true);}}
        onRateChange={() => this.postPlayerState(true)}
        onError={() => {
          const player = this.video.current;
          const mediaError = player?.error;
          if (!background) this.setState({error: `The film could not load${mediaError?.code ? ` (media error ${mediaError.code})` : ''}. Check the SELENE service, then reload the film.`, controls: true});
        }} />

      {!started && screen === 'watch' && <section className="welcome" data-panel ref={this.focusPanel}>
        <Brand />
        <div className="welcome-copy"><h1>{story.title}</h1>
          <p className="muted">{story.subtitle} · {clock(story.duration)}</p>
          {captionStatus && <p className="small muted">{captionStatus}</p>}
          <div className="actions"><button data-initial className="primary" onClick={() => this.start(session)}><Icon name="play"/>{position > 0 ? 'Continue watching' : 'Watch demo'}</button>
            <button onClick={() => this.setState({screen: 'films'})}>Films</button></div>
          {native && <button className="text-button playback-apps" aria-label="Connect to another playback app" onClick={this.companion}><Icon name="back"/>Playback apps</button>}
          {error && <p role="alert">{error}</p>}
        </div>
      </section>}

      {started && captions && caption && ['watch', 'loading', 'moment', 'return', 'tools', 'pair'].includes(screen) && <div className="captions" style={captionStyle(this.state.accessibility)} aria-label="Captions">{caption.text}</div>}

      {started && screen === 'watch' && <>
        {!controls && <button autoFocus className="quiet-control" aria-label={savedPlace ? 'Bring us back' : 'Selene'} onClick={savedPlace ? this.bringUsBack : () => this.setState({controls: true})}><Brand markOnly/>{savedPlace && <span className="saved-dot"/>}</button>}
        {controls && <section className="selene-toolbar" data-panel ref={this.focusPanel} aria-label="Selene tools">
          <button data-initial className="primary" onClick={this.openAsk}>Ask Selene</button>
          <button aria-label="Selene tools" onClick={() => this.setState({screen: 'tools', error: ''})}><Icon name="more"/></button>
          <button aria-label="Hide Selene" onClick={() => this.setState({controls: false})}><Icon name="close"/></button>
        </section>}
      </>}

      {screen === 'films' && <section className="sheet films-sheet" data-panel ref={this.focusPanel} aria-label="Choose a film">
        <div className="sheet-head"><h1>Films</h1><button data-initial aria-label="Close films" onClick={this.close}><Icon name="close"/></button></div>
        <div className="film-list">{(this.props.catalog ?? []).map(item => <button key={item.id} aria-label={`Open ${item.title}`} aria-pressed={item.id === story.id} onClick={() => this.chooseStory(item.id)}>{item.title}<span className="small">{clock(item.duration)}</span></button>)}</div>
        <button onClick={this.openImport}>Import MP4</button>
        <button className="text-button" onClick={() => this.setState({screen: 'credits'})}>Film credits</button>
      </section>}
      {screen === 'import' && <MediaImport getSession={this.importSession} onImported={this.chooseStory} onCancel={() => this.setState({screen: 'films'})} />}

      {screen === 'tools' && <section className="sheet personal-tools" data-panel ref={this.focusPanel}>
        <div className="sheet-head"><h1>Watch together</h1><button aria-label="Change film" onClick={() => this.setState({screen: 'films'})}>Films</button><button data-initial aria-label="Close tools" onClick={this.close}><Icon name="close"/></button></div>
        <div className="option-list"><button className="primary" onClick={savedPlace ? this.bringUsBack : this.savePlace}>{savedPlace ? 'Bring us back' : 'Hold our place'}</button>
          <button onClick={() => {if (mirror) this.setState({screen: 'pair'}); else return this.openMirror();}}>{mirror ? 'Phone connection' : 'Pair phone'}</button>
          <button onClick={() => this.setState({screen: 'preferences', returnScreen: 'watch'})}>Playback</button></div>
        {savedPlace && <div className="saved-place-row"><span>Saved at {clock(savedPlace.at_seconds)}</span><button className="text-button" aria-label="Clear saved place" onClick={() => this.setState({savedPlace: null})}>Clear</button></div>}
        {error && <p role="alert">{error}</p>}
      </section>}

      {screen === 'pair' && <section className="sheet pair-sheet" data-panel ref={this.focusPanel}>
        <div className="sheet-head"><h1>Use your phone</h1><button data-initial aria-label="Close pairing" onClick={this.close}><Icon name="close"/></button></div>
        {mirror ? <><p>Open <span className="pair-address">{mirror.join_url}</span></p><p className="pair-code" aria-label={`Pairing code ${mirror.code.split('').join(' ')}`}>{mirror.code.slice(0, 3)} {mirror.code.slice(3)}</p>
          <p className="small">One phone. Code expires after five minutes. The TV keeps its own controls.</p>
          <div className="actions"><button disabled={this.state.pairing} onClick={this.openMirror}>New code</button><button disabled={this.state.pairing} onClick={this.stopMirror}>Disconnect phone</button></div></>
          : <><p role="status">{this.state.pairing ? 'Creating your code…' : 'Pair a phone for private explanations.'}</p>{!this.state.pairing && <button onClick={this.openMirror}>Create code</button>}</>}
        {error && <p role="alert">{error}</p>}
      </section>}

      {screen === 'return' && returnResult && <section className="moment compact return-toast" data-panel ref={this.focusPanel} aria-label="Guided return">
        {returnResult.moment?.visual.status === 'ready' && <div className="visual"><Visual compact visual={returnResult.moment.visual}/></div>}
        <div className="answer"><h2>{returnResult.quote ? `“${returnResult.quote.text}”` : returnResult.moment?.answer.replace(/\u2014/g, ',') || (returnResult.status === 'unavailable' ? 'The recap could not be prepared. Close to try again.' : returnResult.status === 'no_gap' ? 'There was no gap at the sampled TV moment.' : 'There is not enough evidence for this gap. Replay it or ask someone watching with you.')}</h2>
          {returnResult.quote && <p className="small">Original caption · {clock(returnResult.quote.at_seconds)} · Recap unavailable; close to retry.</p>}
          <p className="small">{returnResult.status === 'ready' ? 'Covers' : 'Requested'} {clock(returnResult.from_seconds)} to {clock(returnResult.through_seconds)}{position - returnResult.through_seconds >= 2 ? ` · TV ${clock(position)}` : ''}</p></div>
        <button data-initial aria-label="Close return" onClick={this.closeReturn}><Icon name="close"/></button>
      </section>}

      {screen === 'ask' && <section className="sheet ask-sheet" data-panel ref={this.focusPanel} aria-labelledby="ask-title">
        <div className="sheet-head"><h1 id="ask-title" className={clarifying ? '' : 'sr-only'}>{clarifying && moment ? moment.answer.replace(/\u2014/g, ',') : 'Ask Selene'}</h1><button className="ask-close" aria-label="Close question" onClick={this.back}><Icon name="close"/></button></div>
        <p className="request-hint" id="request-hint" role={error ? 'alert' : undefined}>{error}</p>
        <form onSubmit={event => {event.preventDefault(); this.ask('unspecified');}}><label className="sr-only" htmlFor="request">{clarifying ? 'Your answer' : 'Your question'}</label>
          <div className="question-input"><textarea data-initial id="request" rows={1} maxLength={600} disabled={voice === 'listening'} value={request} onChange={event => this.setState({request: event.target.value})} placeholder={clarifying ? 'Add the missing detail…' : 'Ask about this moment…'} onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault(); this.ask('unspecified');}}}/><button className="primary" data-submit disabled={voice === 'listening' || !request.trim()}><Icon name="send"/>{clarifying ? 'Answer' : 'Ask'}</button></div>
        </form>
        {!clarifying && <div className="quick-questions"><button aria-expanded={this.state.examplesOpen} onClick={() => this.setState({examplesOpen: !this.state.examplesOpen})}>Prepared examples</button></div>}
        {!clarifying && this.state.examplesOpen && <div className="example-list" role="group" aria-label="Prepared examples">
          {this.state.examplesStatus === 'loading' ? <p className="small" role="status">Loading prepared examples…</p>
            : this.state.examplesStatus === 'error' ? <><p className="small" role="alert">Prepared examples could not load.</p><button onClick={this.loadExamples}>Retry examples</button></>
            : this.state.examples.length ? this.state.examples.map(example => <button key={example.id} onClick={() => this.selectExample(example)}>
              {example.at_seconds > this.state.anchorAt && `Jump to ${example.at_seconds.toFixed(3)}s · `}{example.request}</button>)
            : <p className="small">No supported prepared example for this film. Ask in your own words.</p>}
        </div>}
        <div className="request-options">{this.voice.Recognition && <button className="text-button" onClick={this.listen}><Icon name="mic"/>{voice === 'listening' ? 'Stop listening' : 'Use voice'}</button>}</div>
        {voice === 'listening' && <p className="privacy-note small">Listening. Review before sending.</p>}
      </section>}

      {screen === 'loading' && <section className="loading-panel" data-panel ref={this.focusPanel}><button data-initial aria-label="Cancel answer" onClick={this.close}><LoadingMark/></button></section>}

      {screen === 'moment' && moment && <section className={`moment compact ${moment.visual.status === 'none' ? 'answer-only' : ''}`} data-panel ref={this.focusPanel} aria-label="Moment Response">
        <div className="moment-content"><div className="answer">
          <h2>{moment.answer.replace(/\u2014/g, ',')}</h2>
          {story.ingestion && moment.grounding.evidence_ids.some(id => id.startsWith('frame-')) && <p className="small">Sampled image; details may be inaccurate.</p>}
        </div>{moment.visual.status !== 'none' && <div className="visual"><Visual compact key={moment.visual.svg + moment.visual.description} visual={moment.visual} /></div>}</div>
        <footer className="actions">
          <button data-initial aria-label="Dismiss answer" onClick={this.dismiss}><Icon name="close"/></button>
          <button aria-label="More options" onClick={() => this.setState({screen: 'more'})}><Icon name="more"/></button>
        </footer>
        {voice === 'speaking' && <button onClick={() => this.voice.stop()}>Stop reading</button>}
        {error && <p role="alert">{error}</p>}
      </section>}

      {screen === 'more' && <section className="sheet options-sheet" data-panel ref={this.focusPanel}><div className="sheet-head"><h1>This moment</h1><button onClick={this.back}><Icon name="back"/>Back</button></div><div className="option-list">
        {!paused && <button onClick={() => {this.pauseMoment(); this.setState({screen: 'moment'});}}>Pause playback</button>}
        {this.voice.canSpeak && paused && !this.state.accessibility.screenReader && <button onClick={this.readAloud}>{voice === 'speaking' ? 'Stop reading' : 'Read aloud'}</button>}
        <button onClick={() => {if (mirror) this.setState({screen: 'pair'}); else return this.openMirror();}}>Explain on phone</button>
        <button onClick={this.dismiss}>{paused ? 'Close, stay paused' : 'Dismiss'}</button>
      </div>{error && <p role="alert">{error}</p>}</section>}


      {screen === 'preferences' && <section className="sheet preferences-sheet" data-panel ref={this.focusPanel}>
        <div className="sheet-head"><h1>Playback</h1><button data-initial aria-label="Close playback" onClick={this.back}><Icon name="close"/></button></div>
        <div className="actions">
          <button onClick={() => this.seek(-10)} aria-label="Back 10 seconds">−10s</button>
          <button onClick={() => {if (this.video.current?.ended) this.video.current.currentTime = 0; paused ? this.play() : this.video.current?.pause();}}>{this.video.current?.ended ? 'Replay' : paused ? 'Play' : 'Pause'}</button>
          <button onClick={() => this.seek(10)} aria-label="Forward 10 seconds">+10s</button>
          <button aria-pressed={captions} disabled={!story.transcript.length} onClick={this.toggleCaptions}>{story.transcript.length ? `Captions ${captions ? 'on' : 'off'}` : 'Captions unavailable'}</button>
          {this.state.accessibility.captions !== undefined && <button onClick={this.systemCaptions}>Use TV caption setting</button>}
        </div>
        {captionStatus && <p className="small muted">{captionStatus}</p>}
        {this.voice.canSpeak && !this.state.accessibility.screenReader && <button className="text-button" aria-pressed={need === 'Slower answer voice'} onClick={() => this.preferences({need: need === 'Slower answer voice' ? 'Show visually' : 'Slower answer voice'})}>Slower read-aloud</button>}
      </section>}
      {screen === 'credits' && <section className="sheet credits-sheet" data-panel ref={this.focusPanel}>
        <div className="sheet-head"><h1>Film credits</h1><button data-initial aria-label="Close credits" onClick={this.close}><Icon name="close"/></button></div>
        <p>{story.ingestion?.credit || story.subtitle}</p>
        {story.ingestion?.license_url && <p className="small">License: {story.ingestion.license_url}</p>}
        {captionStatus && <p className="small muted">{captionStatus}</p>}
        {story.ingestion?.evidence_notice && <p className="small muted">{story.ingestion.evidence_notice}</p>}
      </section>}

      {screen === 'exit' && <section className="sheet" data-panel ref={this.focusPanel}><h2>Leave SELENE?</h2><p>The story will stop. Press Back again to leave.</p><div className="actions"><button data-initial onClick={() => this.setState({screen: 'watch', controls: true})}>Stay here</button><button onClick={this.exit}>Leave SELENE</button></div></section>}
      {screen === 'error' && <section className="sheet" data-panel ref={this.focusPanel}><h2>This moment is unavailable</h2><p role="alert">{error}</p><div className="actions"><button data-initial onClick={this.close}>Back to the story</button><button onClick={() => {if (this.lastInput) this.deliver(this.lastInput, this.lastSeekTo);}}>Retry this moment</button><button onClick={() => this.setState({screen: 'ask', error: ''})}>Edit request</button></div></section>}
    </main>;
  }
}

class Startup extends React.Component<Record<string, never>, {bundle: Bundle | null; error: string}> {
  state = {bundle: null as Bundle | null, error: ''};
  private controller: AbortController | null = null;
  componentDidMount() {window.addEventListener('keydown', this.key); this.load();}
  componentWillUnmount() {window.removeEventListener('keydown', this.key); this.controller?.abort();}
  private key = (event: KeyboardEvent) => {
    if (this.state.bundle) return;
    if (event.key === 'Escape' || event.keyCode === 27) {event.preventDefault(); native?.postMessage('selene:exit');}
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
      buttons[(buttons.indexOf(document.activeElement as HTMLButtonElement) + direction + buttons.length) % buttons.length]?.focus();
    }
  };
  private load = async () => {
    this.controller?.abort();
    const controller = new AbortController(); this.controller = controller;
    this.setState({error: ''});
    try {const bundle = await openSession(new URLSearchParams(location.search).get('story'), controller.signal); if (!controller.signal.aborted) this.setState({bundle});}
    catch {if (!controller.signal.aborted) this.setState({error: 'The story could not load. Check the SELENE service and try again.'});}
  };
  render() {
    if (this.state.bundle) return <App {...this.state.bundle} />;
    return <main className="app"><section className="sheet"><Brand /><p role="status">{this.state.error || 'Loading the story…'}</p><div className="actions">{this.state.error && <button autoFocus onClick={this.load}>Try again</button>}{native && <button autoFocus={!this.state.error} onClick={() => native.postMessage('selene:companion')}>Connect to another playback app</button>}</div></section></main>;
  }
}
const params = new URLSearchParams(location.search);
const companion = params.get('companion') === '1';
const privateToken = params.get('private');
const bootstrap = (window as Window & {__SELENE_COMPANION__?: CompanionBootstrap}).__SELENE_COMPANION__;
createRoot(document.getElementById('root')!).render(privateToken ? <PrivateMirror token={privateToken} /> : params.get('join') === '1' ? <JoinPhone/> : companion ? <CompanionMoment initial={bootstrap ?? null} /> : <Startup />);
