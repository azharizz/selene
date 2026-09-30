import React from 'react';
import {createRoot} from 'react-dom/client';
import {Visual, type VisualArtifact} from './Visual';
import {Voice, type VoiceState} from './voice';
import {CompanionMoment, type CompanionBootstrap} from './CompanionMoment';
import {PrivateMirror} from './PrivateMirror';
import {focusPanel, moveFocus} from './navigation';
import './style.css';
import {Brand, Icon} from './Brand';
import {needs, recipients, readPreferences, savePreferences, type Need, type Recipient, type Language, type Preferences} from './preferences';

type Choice = 'unspecified' | 'keep_watching' | 'pause_to_explore';
type Story = {id: string; title: string; subtitle: string; duration: number; video: string; poster: string; scenes: {id: string; start: number; end: number; label: string}[]; transcript: {id: string; start: number; end: number; text: string}[]};
type CatalogStory = {id: string; title: string; subtitle: string; duration: number; poster: string};
type Moment = {
  state: 'quiet' | 'response' | 'clarification'; answer: string; visual: VisualArtifact;
  intervention: {playback: 'keep_watching' | 'offer_choice' | 'request_pause'; audio: 'silent'};
  life_connection: {offered: boolean; question: string; recipient: Recipient};
  grounding: {content_id: string; scene_id: string; at_seconds: number};
};
type Input = {
  request: string; content_id: string; at_seconds: number; play_state: 'playing' | 'paused' | 'ended';
  playback_choice: Choice; need: Need; language: Language; session: 'family' | 'solo'; recipient: Recipient; life_connection: boolean;
  continuation: {request: string; question: string; answer: string} | null;
};
type Screen = 'watch' | 'ask' | 'loading' | 'moment' | 'life' | 'preferences' | 'more' | 'exit' | 'error';
type State = {
  started: boolean; session: 'family' | 'solo'; screen: Screen; need: Need; language: Language; recipient: Recipient;
  request: string; moment: Moment | null; position: number; paused: boolean; captions: boolean; controls: boolean;
  error: string; voice: VoiceState; lifeStarted: boolean; anchorAt: number; clarifying: boolean; choice: Choice; background: boolean; mirror: {url: string} | null; returnScreen: 'watch' | 'ask';
};
type Bundle = {session_id: string; private_mirror_available?: boolean; story: Story; catalog?: CatalogStory[]};
const locale: Record<Language, string> = {English: 'en-US', Indonesian: 'id-ID', Spanish: 'es-ES'};
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const name = (value: string) => value[0].toUpperCase() + value.slice(1);
const native = (window as Window & {ReactNativeWebView?: {postMessage: (message: string) => void}}).ReactNativeWebView;

async function openSession(contentId: string | null, signal?: AbortSignal): Promise<Bundle> {
  const response = await fetch('/api/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(contentId ? {content_id: contentId} : {}), signal});
  if (!response.ok) throw new Error('The story service is unavailable. Try again.');
  return response.json();
}

class App extends React.Component<Bundle, State> {
  state: State = {
    started: false, screen: 'watch', ...readPreferences(),
    request: '', moment: null, position: 0, paused: true, captions: true, controls: true, error: '', voice: 'idle',
    lifeStarted: false, anchorAt: 0, clarifying: false, choice: 'unspecified', background: document.hidden, mirror: null, returnScreen: 'watch',
  };
  private video = React.createRef<HTMLVideoElement>();
  private surface = React.createRef<HTMLElement>();
  private pending: AbortController | null = null;
  private sessionId = this.props.session_id;
  private lastInput: Input | null = null;
  private resumeAt = 0;
  private playbackRevision = 0;
  private lastNativeStateAt = 0;
  private mounted = false;
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
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.endSession);
    window.addEventListener('keydown', this.key);
    window.addEventListener('message', this.nativeMessage);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({title: this.props.story.title, artist: 'SELENE'});
      navigator.mediaSession.setActionHandler('play', this.play);
      navigator.mediaSession.setActionHandler('pause', () => this.video.current?.pause());
      navigator.mediaSession.setActionHandler('seekbackward', details => this.seek(-(details.seekOffset ?? 10)));
      navigator.mediaSession.setActionHandler('seekforward', details => this.seek(details.seekOffset ?? 10));
    }
  }
  componentDidUpdate() {
    const surface = this.surface.current;
    if (surface && (!surface.contains(document.activeElement) || document.activeElement?.matches(':disabled'))) this.focusPanel(surface.querySelector<HTMLElement>('[data-panel]') ?? surface);
  }
  componentWillUnmount() {
    this.mounted = false;
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
  private endSession = () => {
    this.cancel();
    if (this.sessionId) navigator.sendBeacon('/api/session/end', new Blob([JSON.stringify({session_id: this.sessionId})], {type: 'application/json'}));
    this.sessionId = '';
  };
  private visibility = () => {
    if (document.hidden) {
      this.resumeAt = this.video.current?.currentTime ?? this.state.position;
      this.video.current?.pause(); this.cancel();
      void this.stopMirror();
      this.lastInput = null;
      this.setState({background: true, started: false, screen: 'watch', moment: null, lifeStarted: false, controls: true, paused: true, request: ''});
    } else this.setState({background: false});
  };
  private focusPanel = focusPanel;
  private close = () => {
    this.cancel(); this.lastInput = null; void this.stopMirror();
    this.setState({screen: 'watch', moment: null, lifeStarted: false, controls: true, request: '', error: '', clarifying: false, choice: 'unspecified'});
  };
  private play = () => {
    if (document.hidden) return;
    this.voice.stop();
    if (this.state.lifeStarted) this.close();
    this.video.current?.play().catch(() => {
      if (this.mounted) this.setState({error: 'Playback could not start. Press Play to try again.', controls: true});
    });
  };
  private postPlayerState = (force = false) => {
    const player = this.video.current;
    if (!player || !native) return;
    if (!force && Date.now() - this.lastNativeStateAt < 1000) return;
    this.lastNativeStateAt = Date.now();
    native.postMessage(JSON.stringify({type: 'selene:player-state', state: {
      state: player.ended ? 'stopped' : player.readyState < 3 ? 'buffering' : player.paused ? 'paused' : 'playing',
      position_ms: Number.isFinite(player.currentTime) ? player.currentTime * 1000 : 0,
      duration_ms: Number.isFinite(player.duration) ? player.duration * 1000 : 0,
      muted: player.muted, volume: player.volume,
    }}));
  };
  private nativeMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = typeof event.data === 'string' ? (() => {try {return JSON.parse(event.data);} catch {return null;}})() : event.data;
    if (!message || message.type !== 'selene:native-player') return;
    const player = this.video.current;
    if (!player) return;
    if (message.action === 'back') {this.back(); return;}
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
  private start = (session: 'family' | 'solo') => {
    this.setState({session, started: true, controls: false, error: ''}, this.play);
  };
  private openAsk = () => {
    this.voice.stop();
    this.setState({screen: 'ask', anchorAt: this.video.current?.currentTime ?? this.state.position, request: '', clarifying: false, lifeStarted: false, error: '', choice: 'unspecified'});
  };
  private back = () => {
    const {screen, voice, started, controls, clarifying} = this.state;
    if (voice !== 'idle') return this.voice.stop();
    if (screen === 'exit') return this.exit();
    if (screen === 'preferences') return this.setState({screen: this.state.returnScreen});
    if (screen === 'more') return this.setState({screen: 'moment'});
    if (screen === 'life' || (screen === 'ask' && clarifying)) {
      if (screen === 'life') void this.setMirrorLife(false);
      return this.setState({screen: 'moment', clarifying: false, lifeStarted: false, error: ''});
    }
    if (screen !== 'watch') return this.close();
    if (started && controls) return this.setState({controls: false});
    this.setState({screen: 'exit'});
  };
  private exit = () => {
    this.video.current?.pause(); this.endSession();
    if (native) native.postMessage('selene:exit');
    else this.setState({started: false, screen: 'watch', moment: null, controls: true, request: '', error: '', lifeStarted: false});
  };
  private companion = () => {this.video.current?.pause(); this.endSession(); native?.postMessage('selene:companion');};
  private chooseStory = (id: string) => {
    if (id === this.props.story.id) return;
    this.video.current?.pause(); this.endSession();
    window.location.assign(`/?story=${encodeURIComponent(id)}`);
  };

  private ask = (choice: Choice, life = false, quickRequest?: string) => {
    const player = this.video.current;
    if (!player) return;
    const {need, language, recipient, session, moment, clarifying, request, anchorAt} = this.state;
    if (!life && !quickRequest && !request.trim()) {this.setState({error: 'Type a question or choose a quick question.'}); return;}
    const input: Input = {
      request: life ? 'Help us connect this moment to our own life with one specific question for the selected recipient.' : clarifying && this.lastInput ? this.lastInput.request : quickRequest ?? request.trim(),
      content_id: this.props.story.id, at_seconds: life && moment ? moment.grounding.at_seconds : anchorAt,
      play_state: player.ended ? 'ended' : player.paused ? 'paused' : 'playing',
      playback_choice: choice, need, language, recipient, session, life_connection: life || Boolean(clarifying && this.lastInput?.life_connection),
      continuation: clarifying && moment && this.lastInput ? {request: this.lastInput.request, question: moment.answer, answer: request.trim()} : null,
    };
    this.deliver(input);
  };
  private deliver = async (input: Input) => {
    const player = this.video.current;
    if (!player) return;
    const choice = input.playback_choice, life = input.life_connection;
    if (choice === 'pause_to_explore') player.pause();
    input = {...input, play_state: player.ended ? 'ended' : player.paused ? 'paused' : 'playing'};
    this.lastInput = input;
    this.cancel();
    const pending = new AbortController(); this.pending = pending;
    const playbackRevision = this.playbackRevision;
    this.setState({screen: 'loading', error: '', choice, lifeStarted: false, anchorAt: input.at_seconds});
    try {
      if (!this.sessionId) this.sessionId = (await openSession(this.props.story.id, pending.signal)).session_id;
      let response = await this.send(input, pending.signal);
      if (response.status === 410) {
        this.sessionId = (await openSession(this.props.story.id, pending.signal)).session_id;
        response = await this.send(input, pending.signal);
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'This moment could not be prepared. Please try again.');
      if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
      this.pending = null;
      if (result.state === 'quiet') return this.close();
      if (result.intervention.playback === 'request_pause') {
        if (playbackRevision === this.playbackRevision) player.pause();
        else result.intervention.playback = 'keep_watching';
      }
      const lifeVisible = player.paused && result.life_connection.offered && (life || choice === 'pause_to_explore' || result.intervention.playback === 'request_pause');
      this.setState({moment: result, screen: result.state === 'clarification' ? 'ask' : 'moment', clarifying: result.state === 'clarification', request: result.state === 'clarification' ? '' : this.state.request,
        choice: result.intervention.playback === 'request_pause' ? 'pause_to_explore' : choice,
        lifeStarted: lifeVisible,
      }, () => {if (lifeVisible) void this.setMirrorLife(true);});
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
    if (!this.sessionId || !this.state.moment) return;
    try {
      const response = await fetch('/api/private/pair', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': this.sessionId}, body: '{}'});
      const result = await response.json();
      if (!response.ok || typeof result.url !== 'string') throw new Error(result.error || 'Private mirroring is unavailable.');
      this.setState({mirror: {url: result.url}}, () => {if (this.state.lifeStarted) void this.setMirrorLife(true);});
    } catch (error) {this.setState({error: error instanceof Error ? error.message : 'Private mirroring is unavailable.'});}
  };
  private setMirrorLife = async (visible: boolean) => {
    if (!this.sessionId) return;
    await fetch('/api/private/life', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': this.sessionId}, body: JSON.stringify({visible})}).catch(() => undefined);
  };
  private stopMirror = async () => {
    if (!this.state.mirror || !this.sessionId) {if (this.state.mirror) this.setState({mirror: null}); return;}
    this.setState({mirror: null});
    await fetch('/api/private/close', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': this.sessionId}, body: '{}'}).catch(() => undefined);
  };
  private connect = () => {this.voice.stop(); this.setState({screen: 'life', error: ''});};
  private explore = () => {
    this.voice.stop(); this.video.current?.pause();
    this.setState({choice: 'pause_to_explore', lifeStarted: Boolean(this.state.moment?.life_connection.offered)});
  };
  private confirmLife = () => {
    const {moment, recipient} = this.state;
    if (moment?.life_connection.offered && moment.life_connection.recipient === recipient) {
      this.voice.stop(); this.video.current?.pause();
      this.setState({screen: 'moment', lifeStarted: true, choice: 'pause_to_explore'}, () => {void this.setMirrorLife(true);});
    } else this.ask('pause_to_explore', true);
  };
  private readAloud = () => {
    const {moment, lifeStarted, need, language, voice} = this.state;
    if (voice === 'speaking') return this.voice.stop();
    if (!this.state.paused) {this.setState({error: 'Pause the film before reading the answer aloud.'}); return;}
    if (moment) this.voice.speak(lifeStarted ? moment.life_connection.question : moment.answer, locale[need === 'Translate' ? language : 'English'], need === 'Easy to hear');
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
      if (target.matches('textarea,select')) {this.surface.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus(); return;}
      this.back(); return;
    }
    if (event.key === 'MediaPlayPause' || (event.key === ' ' && target === this.surface.current)) {
      event.preventDefault(); this.video.current?.paused ? this.play() : this.video.current?.pause(); return;
    }
    if (!event.key.startsWith('Arrow') || target.matches('textarea,input,select')) return;
    event.preventDefault();
    if (this.state.screen === 'watch' && !this.state.controls && this.state.started) {this.setState({controls: true}); return;}
    moveFocus(event, this.surface.current);
  };

  render() {
    const {story} = this.props;
    const {started, screen, session, need, language, recipient, request, moment, position, paused, captions, controls, error, voice, lifeStarted, anchorAt, clarifying, choice, background, mirror} = this.state;
    const caption = story.transcript.find(line => position >= line.start && position < line.end);
    const scene = story.scenes.find(item => position >= item.start && position < item.end) ?? story.scenes.at(-1);
    const full = paused && screen === 'moment';
    const needsChoice = moment?.intervention.playback === 'offer_choice' && choice === 'unspecified';
    return <main ref={this.surface} tabIndex={-1} className={`app ${full ? 'exploring' : ''}`}>
      <video ref={this.video} src={started && !background ? story.video : undefined} poster={story.poster} playsInline preload="metadata" disableRemotePlayback
        onLoadedMetadata={() => {if (this.video.current && this.resumeAt > 0) {this.video.current.currentTime = this.resumeAt; this.resumeAt = 0;} this.postPlayerState(true);}}
        onTimeUpdate={() => {this.setState({position: this.video.current?.currentTime ?? 0}); this.postPlayerState();}}
        onPlay={() => {this.playbackRevision++; this.setState({paused: false, started: true}); this.postPlayerState(true); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';}}
        onPause={() => {this.playbackRevision++; this.setState({paused: true}); this.postPlayerState(true); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';}}
        onEnded={() => {this.voice.stop(); this.setState({paused: true, controls: true}); this.postPlayerState(true); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';}}
        onSeeking={() => {if (this.pending || screen !== 'watch') this.close();}}
        onError={() => {if (!background) this.setState({error: 'The film could not load. Check the SELENE service, then reload the film.', controls: true});}} />

      {!started && screen === 'watch' && <section className="welcome" data-panel ref={this.focusPanel}>
        <Brand />
        <div className="welcome-copy"><h1>{story.title}</h1>
          <p className="muted">{story.subtitle} · {clock(story.duration)}</p>
          <div className="actions"><button data-initial className="primary" onClick={() => this.start(session)}><Icon name="play"/>{position > 0 ? 'Continue watching' : 'Watch demo'}</button><button onClick={() => this.setState({screen: 'preferences', returnScreen: 'watch'})}><Icon name="settings"/>Preferences</button></div>
          {(this.props.catalog ?? []).length > 1 && <div className="story-picker" aria-label="Choose a story"><p className="eyebrow">Choose a story</p>{(this.props.catalog ?? []).filter(item => item.id !== story.id).map(item => <button key={item.id} className="secondary" onClick={() => this.chooseStory(item.id)}>Open {item.title}</button>)}</div>}
          {native && <button className="secondary" onClick={this.companion}>Connect to another playback app</button>}
          {error && <p role="alert">{error}</p>}
        </div>
      </section>}

      {started && captions && caption && !full && ['watch', 'loading', 'moment'].includes(screen) && <div className={`captions ${controls ? 'raised' : ''} ${screen !== 'watch' ? 'over-intervention' : ''}`} aria-label="Captions">{caption.text}</div>}

      {started && screen === 'watch' && <>
        {!controls && <button autoFocus className="quiet-control" onClick={() => this.setState({controls: true})}>SELECT · Controls</button>}
        {controls && <section className="player-controls" data-panel ref={this.focusPanel} aria-label="Player controls">
          <div className="player-heading"><div><Brand /><h2>{story.title}</h2></div><span>{session === 'family' ? 'Family View' : 'Solo View'} · {scene?.label}</span></div>
          <div className="progress" role="progressbar" aria-label="Film position" aria-valuenow={Math.round(position)} aria-valuemin={0} aria-valuemax={story.duration}><span style={{width: `${Math.min(100, position / story.duration * 100)}%`}} /></div>
          <div className="transport"><span className="time">{clock(position)} / {clock(story.duration)}</span><div className="actions">
            <button onClick={() => this.seek(-10)} aria-label="Back 10 seconds">−10s</button>
            <button onClick={() => {if (this.video.current?.ended) this.video.current.currentTime = 0; paused ? this.play() : this.video.current?.pause();}}>{this.video.current?.ended ? 'Replay' : paused ? 'Play' : 'Pause'}</button>
            <button onClick={() => this.seek(10)} aria-label="Forward 10 seconds">+10s</button>
            <button data-initial className="primary" onClick={this.openAsk}>Ask SELENE</button>
            <button aria-pressed={captions} onClick={() => this.setState({captions: !captions})}>Captions {captions ? 'on' : 'off'}</button>
            <button onClick={() => this.setState({screen: 'preferences', returnScreen: 'watch'})}>Preferences</button>
            <button onClick={() => this.setState({controls: false})}>Hide controls</button>
          </div></div>
          {error && <div className="actions"><p role="alert">{error}</p><button onClick={() => {this.resumeAt = position; this.video.current?.load(); this.setState({error: ''});}}>Reload film</button></div>}
        </section>}
      </>}

      {screen === 'ask' && <section className="sheet ask-sheet" data-panel ref={this.focusPanel} aria-labelledby="ask-title">
        <div className="sheet-head"><h1 id="ask-title">{clarifying && moment ? moment.answer : 'What would you like to know?'}</h1><button className="text-button" onClick={this.back}><Icon name="back"/>Back</button></div>
        <p className="request-hint" role={error ? 'alert' : undefined}>{error || `${story.title} · ${clock(anchorAt)}`}</p>
        <form onSubmit={event => {event.preventDefault(); this.ask('unspecified');}}><label className="sr-only" htmlFor="request">{clarifying ? 'Your answer' : 'Your question'}</label>
          <div className="question-input"><textarea data-initial={clarifying || undefined} id="request" rows={2} maxLength={600} disabled={voice === 'listening'} value={request} onChange={event => this.setState({request: event.target.value})} placeholder={clarifying ? 'Add the missing detail…' : 'Ask about what you saw or heard…'} onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault(); this.ask('unspecified');}}}/><button className="primary" data-submit disabled={voice === 'listening' || !request.trim()}><Icon name="send"/>{clarifying ? 'Answer' : 'Ask SELENE'}</button></div>
        </form>
        {!clarifying && <div className="quick-questions" role="group" aria-label="Quick questions"><button data-initial onClick={() => this.ask('unspecified', false, 'Explain what just happened in this moment.')}>What happened?</button><button onClick={() => this.ask('unspecified', false, 'Who are the people in this moment?')}>Who is that?</button><button onClick={() => this.ask('unspecified', false, 'I missed that. Explain the last completed dialogue simply.')}>I missed that</button></div>}
        <div className="request-options"><button className="text-button" onClick={() => this.setState({screen: 'preferences', returnScreen: 'ask'})}><Icon name="settings"/>Preferences</button><span className="small">{need}{need === 'Translate' ? ` · ${language}` : ''} · {session === 'solo' ? 'Solo' : name(recipient)}</span>{this.voice.Recognition && <button className="text-button" onClick={this.listen}><Icon name="mic"/>{voice === 'listening' ? 'Stop listening' : 'Use voice'}</button>}</div>
        <p className="privacy-note small">{voice === 'listening' ? 'Listening. Film sound is muted. Review before sending.' : 'Shown silently on this TV. Playback stays in your control.'}</p>
      </section>}

      {screen === 'loading' && <section className="loading-panel" data-panel ref={this.focusPanel} role="status"><div><h2>Finding a little clarity…</h2><p>At {clock(this.lastInput?.at_seconds ?? anchorAt)} · {paused ? 'The film is paused. Resume whenever you choose.' : 'The film keeps playing.'}</p></div><button data-initial onClick={this.close}>Cancel</button></section>}

      {screen === 'moment' && moment && <section className={`moment ${full ? 'full' : 'compact'} ${moment.visual.status === 'none' ? 'answer-only' : ''}`} data-panel ref={this.focusPanel} aria-label="Moment Response">
        <header><Brand /><span>{story.title} · At {clock(moment.grounding.at_seconds)}</span><span>{this.video.current?.ended ? 'Ended' : paused ? 'Paused' : 'Still playing'}</span></header>
        <div className="moment-content"><div className="answer">
          {lifeStarted && paused && moment.life_connection.offered ? <div className="life-question"><h2>{moment.life_connection.question}</h2><p className="small">Life Connection · {name(moment.life_connection.recipient)}</p><p className="small">Take your time. Nothing is recorded.</p></div> : <h2>{moment.answer}</h2>}
        </div>{moment.visual.status !== 'none' && <div className="visual"><Visual key={String(full) + moment.visual.svg + moment.visual.description} visual={moment.visual} /></div>}</div>
        <footer className="actions">
          {needsChoice ? <><button data-initial onClick={() => this.setState({choice: 'keep_watching'})}>Keep watching</button><button className="primary" onClick={this.explore}>Pause to explore</button></>
            : <button data-initial className="primary" onClick={() => {this.close(); if (paused) this.play();}}>{this.video.current?.ended ? 'Replay the story' : paused ? 'Resume the story' : 'Close'}</button>}
          {!paused && !needsChoice && <button onClick={this.explore}>Pause to explore</button>}
          {!lifeStarted && moment.state === 'response' && <button onClick={this.connect}>Life Connection</button>}
          <button onClick={() => this.setState({screen: 'more'})}><Icon name="more"/>More</button>
        </footer>
        {voice === 'speaking' && <button onClick={() => this.voice.stop()}>Stop reading</button>}
        {error && <p role="alert">{error}</p>}
      </section>}

      {screen === 'more' && <section className="sheet options-sheet" data-panel ref={this.focusPanel}><div className="sheet-head"><h1>This moment</h1><button data-initial onClick={this.back}><Icon name="back"/>Back</button></div><div className="option-list">
        {this.voice.canSpeak && paused && <button onClick={this.readAloud}>{voice === 'speaking' ? 'Stop reading' : 'Read aloud'}</button>}
        {this.props.private_mirror_available && <button onClick={mirror ? this.stopMirror : this.openMirror}>{mirror ? 'Stop phone mirror' : 'Mirror on phone'}</button>}
        <button onClick={this.close}>{paused ? 'Close, stay paused' : 'Close moment'}</button>
      </div>{mirror && <div className="mirror-panel"><p>Open on your phone:</p><code>{mirror.url}</code></div>}{error && <p role="alert">{error}</p>}</section>}

      {screen === 'life' && <section className="sheet life-sheet" data-panel ref={this.focusPanel}>
        <div className="sheet-head"><h1>Bring it back to your life</h1><button onClick={this.back}><Icon name="back"/>Back</button></div><p>One question for a conversation of your own.</p>
        <label className="preference-select">Who’s it for?<select value={recipient} onChange={event => this.preferences({recipient: event.target.value as Recipient})}>{recipients.map(value => <option key={value} value={value}>{name(value)}</option>)}</select></label>
        <div className="actions"><button data-initial data-submit className="primary" onClick={this.confirmLife}>{paused ? 'Start conversation' : 'Pause and connect'}</button><span className="small">Microphone off. Resume when you choose.</span></div>
      </section>}

      {screen === 'preferences' && <section className="sheet preferences-sheet" data-panel ref={this.focusPanel}>
        <div className="sheet-head"><h1>How can we help?</h1><button data-initial data-submit className="primary" onClick={this.back}>Done</button></div>
        <div className="preference-group"><h2>Answer style</h2><div className="need-row">{needs.map(value => <button key={value} aria-pressed={need === value} onClick={() => this.preferences({need: value})}>{value}</button>)}</div></div>
        {need === 'Translate' && <label className="preference-select">Translate into<select value={language} onChange={event => this.preferences({language: event.target.value as Language})}>{Object.keys(locale).map(value => <option key={value}>{value}</option>)}</select></label>}
        <div className="preference-group"><h2>Watching with</h2><div className="need-row"><button aria-pressed={session === 'family'} onClick={() => this.preferences({session: 'family', recipient: 'everyone'})}>Family</button><button aria-pressed={session === 'solo'} onClick={() => this.preferences({session: 'solo', recipient: 'adult'})}>Just me</button><button aria-pressed={captions} onClick={() => this.setState({captions: !captions})}>Captions {captions ? 'on' : 'off'}</button></div></div>
        {session === 'family' && <label className="preference-select">Who is the answer for?<select value={recipient} onChange={event => this.preferences({recipient: event.target.value as Recipient})}>{recipients.map(value => <option key={value} value={value}>{name(value)}</option>)}</select></label>}
      </section>}

      {screen === 'exit' && <section className="sheet" data-panel ref={this.focusPanel}><h2>Leave SELENE?</h2><p>The story will stop. Press Back again to leave.</p><div className="actions"><button data-initial onClick={() => this.setState({screen: 'watch', controls: true})}>Stay here</button><button onClick={this.exit}>Leave SELENE</button></div></section>}
      {screen === 'error' && <section className="sheet" data-panel ref={this.focusPanel}><h2>This moment is unavailable</h2><p role="alert">{error}</p><div className="actions"><button data-initial onClick={this.close}>Back to the story</button><button onClick={() => {if (this.lastInput) this.deliver(this.lastInput);}}>Retry this moment</button><button onClick={() => this.setState({screen: 'ask', error: ''})}>Edit request</button></div></section>}
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
createRoot(document.getElementById('root')!).render(privateToken ? <PrivateMirror token={privateToken} /> : companion ? <CompanionMoment initial={bootstrap ?? null} /> : <Startup />);
