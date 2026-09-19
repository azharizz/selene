import React from 'react';
import {createRoot} from 'react-dom/client';
import {Visual, type VisualArtifact} from './Visual';
import {Voice, type VoiceState} from './voice';
import {CompanionMoment, type CompanionBootstrap} from './CompanionMoment';
import {PrivateMirror} from './PrivateMirror';
import {focusPanel, moveFocus} from './navigation';
import './style.css';

type Need = 'Explain simply' | 'Easy to hear' | 'Translate' | 'Show visually';
type Recipient = 'grandparent' | 'parent' | 'child' | 'adult' | 'everyone';
type Language = 'English' | 'Indonesian' | 'Spanish';
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
type Screen = 'watch' | 'ask' | 'loading' | 'moment' | 'life' | 'preferences' | 'exit' | 'error';
type State = {
  started: boolean; session: 'family' | 'solo'; screen: Screen; need: Need; language: Language; recipient: Recipient;
  request: string; moment: Moment | null; position: number; paused: boolean; captions: boolean; controls: boolean;
  error: string; voice: VoiceState; lifeStarted: boolean; anchorAt: number; clarifying: boolean; choice: Choice; background: boolean; mirror: {url: string} | null;
};
type Bundle = {session_id: string; story: Story; catalog?: CatalogStory[]};
const needs: Need[] = ['Explain simply', 'Easy to hear', 'Translate', 'Show visually'];
const recipients: Recipient[] = ['everyone', 'grandparent', 'parent', 'child', 'adult'];
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
    started: false, session: 'family', screen: 'watch', need: 'Explain simply', language: 'English', recipient: 'everyone',
    request: '', moment: null, position: 0, paused: true, captions: true, controls: true, error: '', voice: 'idle',
    lifeStarted: false, anchorAt: 0, clarifying: false, choice: 'unspecified', background: document.hidden, mirror: null,
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

  private ask = (choice: Choice, life = false) => {
    const player = this.video.current;
    if (!player) return;
    const {need, language, recipient, session, moment, clarifying, request, anchorAt} = this.state;
    if (clarifying && !request.trim()) {this.setState({error: 'Enter your answer to the question.'}); return;}
    const input: Input = {
      request: life ? 'Help us connect this moment to our own life with one specific question for the selected recipient.' : clarifying && this.lastInput ? this.lastInput.request : request.trim() || 'Help me understand what is happening in this moment.',
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
      this.setState({moment: result, screen: 'moment', clarifying: false,
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
      if (target.matches('textarea,select')) {this.surface.current?.querySelector<HTMLElement>('[data-submit]')?.focus(); return;}
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
        <div className="wordmark">SELENE</div>
        <div className="welcome-copy"><p className="eyebrow">A story to share</p><h1>{story.title}</h1>
          <p>{story.id === 'offside-practice' ? 'See the pass, the defender, and the rule together.' : 'A worn kite. Something worth keeping.'}</p><p className="muted">{story.subtitle} · {clock(story.duration)}</p>
          <div className="actions"><button data-initial onClick={() => this.start('family')}>{position > 0 ? 'Continue' : 'Watch'} in Family View</button><button onClick={() => this.start('solo')}>{position > 0 ? 'Continue' : 'Watch'} in Solo View</button></div>
          <p className="small">The show stays in your hands. Answers appear silently on this TV.</p>
          {(this.props.catalog ?? []).length > 1 && <div className="story-picker" aria-label="Choose a story"><p className="eyebrow">Choose a story</p>{(this.props.catalog ?? []).filter(item => item.id !== story.id).map(item => <button key={item.id} className="secondary" onClick={() => this.chooseStory(item.id)}>Open {item.title}</button>)}</div>}
          {native && <button className="secondary" onClick={this.companion}>Connect to another playback app</button>}
          {error && <p role="alert">{error}</p>}
        </div>
      </section>}

      {started && captions && caption && !full && ['watch', 'loading', 'moment'].includes(screen) && <div className={`captions ${controls ? 'raised' : ''} ${screen !== 'watch' ? 'over-intervention' : ''}`} aria-label="Captions">{caption.text}</div>}

      {started && screen === 'watch' && <>
        {!controls && <button autoFocus className="quiet-control" onClick={() => this.setState({controls: true})}>SELECT · Controls</button>}
        {controls && <section className="player-controls" data-panel ref={this.focusPanel} aria-label="Player controls">
          <div className="player-heading"><div><span className="wordmark">SELENE</span><h2>{story.title}</h2></div><span>{session === 'family' ? 'Family View' : 'Solo View'} · {scene?.label}</span></div>
          <div className="progress" role="progressbar" aria-label="Film position" aria-valuenow={Math.round(position)} aria-valuemin={0} aria-valuemax={story.duration}><span style={{width: `${Math.min(100, position / story.duration * 100)}%`}} /></div>
          <div className="transport"><span className="time">{clock(position)} / {clock(story.duration)}</span><div className="actions">
            <button onClick={() => this.seek(-10)} aria-label="Back 10 seconds">−10s</button>
            <button onClick={() => {if (this.video.current?.ended) this.video.current.currentTime = 0; paused ? this.play() : this.video.current?.pause();}}>{this.video.current?.ended ? 'Replay' : paused ? 'Play' : 'Pause'}</button>
            <button onClick={() => this.seek(10)} aria-label="Forward 10 seconds">+10s</button>
            <button data-initial className="primary" onClick={this.openAsk}>Help with this moment</button>
            <button aria-pressed={captions} onClick={() => this.setState({captions: !captions})}>Captions {captions ? 'on' : 'off'}</button>
            <button onClick={() => this.setState({screen: 'preferences'})}>Viewing preferences</button>
            <button onClick={() => this.setState({controls: false})}>Hide controls</button>
          </div></div>
          {error && <div className="actions"><p role="alert">{error}</p><button onClick={() => {this.resumeAt = position; this.video.current?.load(); this.setState({error: ''});}}>Reload film</button></div>}
        </section>}
      </>}

      {screen === 'ask' && <section className="sheet" data-panel ref={this.focusPanel} aria-labelledby="ask-title">
        <div className="sheet-head"><div><p className="eyebrow">{story.title} · At {clock(anchorAt)}</p><h2 id="ask-title">{clarifying && moment ? moment.answer : 'A little help with this moment'}</h2></div><button onClick={this.back}>Back</button></div>
        <div className="need-row" role="group" aria-label="How would you like help?">{needs.map(value => <button key={value} aria-pressed={need === value} onClick={() => this.setState({need: value})}>{value}</button>)}
          <label>For <select value={recipient} onChange={event => this.setState({recipient: event.target.value as Recipient})}>{recipients.map(value => <option key={value} value={value}>{name(value)}</option>)}</select></label>
          {need === 'Translate' && <label>Language <select value={language} onChange={event => this.setState({language: event.target.value as Language})}>{Object.keys(locale).map(value => <option key={value}>{value}</option>)}</select></label>}
        </div>
        <div className="request-row"><label htmlFor="request">{clarifying ? 'Your answer' : 'Your question'}</label><textarea id="request" rows={2} maxLength={600} disabled={voice === 'listening'} value={request} onChange={event => this.setState({request: event.target.value})} placeholder={clarifying ? 'Add the missing detail…' : 'Ask about the moment you selected…'} /></div>
        <div className="actions suggestions">
          {!clarifying && <><button disabled={voice === 'listening'} onClick={() => this.setState({request: 'Who are the people in this moment?'})}>Who is that?</button><button disabled={voice === 'listening'} onClick={() => this.setState({request: 'Explain what just happened in this moment.'})}>What happened?</button><button disabled={voice === 'listening'} onClick={() => this.setState({request: 'I missed that. Explain the last completed dialogue simply.'})}>I missed that</button></>}
          {this.voice.Recognition ? <button onClick={this.listen}>{voice === 'listening' ? 'Stop listening' : 'Use microphone'}</button> : <span className="small">Voice input is unavailable here. Use the remote or keyboard.</span>}
        </div>
        <div className="sheet-foot"><p>{voice === 'listening' ? 'Listening to your request. Film sound is muted. Review the text before sending it to SELENE.' : paused ? 'The film is paused. Choose how to show your answer.' : 'The film keeps playing. Your question stays with this selected moment.'}</p>
          <div className="actions"><button data-initial data-submit disabled={voice === 'listening'} onClick={() => this.ask('unspecified')}>Send request</button><button disabled={voice === 'listening'} onClick={() => this.ask('keep_watching')}>Keep watching</button><button className="primary" disabled={voice === 'listening'} onClick={() => this.ask('pause_to_explore')}>Pause to explore</button></div>
        </div>
        {error && <p role="alert">{error}</p>}
      </section>}

      {screen === 'loading' && <section className="loading-panel" data-panel ref={this.focusPanel} role="status"><div><h2>Preparing this moment</h2><p>At {clock(this.lastInput?.at_seconds ?? anchorAt)} · {paused ? 'The film is paused. Resume whenever you choose.' : 'The film keeps playing.'}</p></div><button data-initial onClick={this.close}>Cancel</button></section>}

      {screen === 'moment' && moment && <section className={`moment ${full ? 'full' : 'compact'}`} data-panel ref={this.focusPanel} aria-label="Moment Response">
        <header><span className="wordmark">SELENE</span><span>{story.title} · At {clock(moment.grounding.at_seconds)}</span><span>{this.video.current?.ended ? 'Ended' : paused ? 'Paused' : 'Still playing'}</span></header>
        <div className="moment-content"><div className="answer"><p className="eyebrow">{lifeStarted ? 'Life Connection' : need}</p><h2>{moment.answer}</h2>
          {lifeStarted && paused && moment.life_connection.offered && <div className="life-question"><p>For {name(moment.life_connection.recipient)}</p><h3>{moment.life_connection.question}</h3><p className="small">Take your time. Your conversation is not recorded.</p></div>}
        </div><div className="visual"><Visual key={String(full) + moment.visual.svg + moment.visual.description} visual={moment.visual} /></div></div>
        {needsChoice && <p className="choice-hint">Choose how you want to explore this moment.</p>}
        <footer className="actions">
          {needsChoice ? <><button data-initial onClick={() => this.setState({choice: 'keep_watching'})}>Keep watching</button><button className="primary" onClick={this.explore}>Pause to explore</button></>
            : <button data-initial className="primary" onClick={() => {this.close(); if (paused) this.play();}}>{this.video.current?.ended ? 'Replay the story' : paused ? 'Resume the story' : 'Close'}</button>}
          {!paused && !needsChoice && <button onClick={this.explore}>Pause to explore</button>}
          {!lifeStarted && moment.state === 'response' && <button onClick={this.connect}>Connect to life</button>}
          {moment.state === 'clarification' && <button onClick={() => this.setState({screen: 'ask', request: '', clarifying: true, anchorAt: moment.grounding.at_seconds})}>Answer the question</button>}
          {this.voice.canSpeak && <button disabled={voice !== 'speaking' && !paused} onClick={this.readAloud}>{voice === 'speaking' ? 'Stop reading' : 'Read aloud'}</button>}
          {moment.state === 'response' && <button onClick={mirror ? this.stopMirror : this.openMirror}>{mirror ? 'Stop private mirror' : 'Mirror on phone'}</button>}
          {(paused || needsChoice) && <button onClick={this.close}>{paused ? 'Close, stay paused' : 'Close'}</button>}
        </footer>
        {mirror && <div className="mirror-panel"><p>Open this address on a phone or tablet on the same network. The mirror stays private to this viewing session.</p><code>{mirror.url}</code><button onClick={this.stopMirror}>Stop private mirror</button></div>}
        {voice === 'speaking' && <p className="small audio-status">Reading aloud · Film sound is muted</p>}
        {error && <p role="alert">{error}</p>}
      </section>}

      {screen === 'life' && <section className="sheet life-sheet" data-panel ref={this.focusPanel}>
        <p className="eyebrow">Life Connection · At {clock(moment?.grounding.at_seconds ?? anchorAt)}</p><h2>Make room for your own story</h2><p>Choose who to invite. Pause for one question about this moment.</p>
        <div className="need-row" role="group" aria-label="Who is the question for?">{recipients.map(value => <button key={value} aria-pressed={recipient === value} onClick={() => this.setState({recipient: value})}>{name(value)}</button>)}</div>
        <p className="small">The microphone stays off. You decide when to close or resume.</p>
        <div className="actions"><button data-initial onClick={this.back}>Back</button><button className="primary" onClick={this.confirmLife}>Pause and connect</button></div>
      </section>}

      {screen === 'preferences' && <section className="sheet" data-panel ref={this.focusPanel}>
        <h2>Viewing preferences</h2><p className="muted">All answers appear on this TV. Choose the people you are watching with.</p>
        <div className="need-row"><button aria-pressed={session === 'family'} onClick={() => this.setState({session: 'family'})}>Family View</button><button aria-pressed={session === 'solo'} onClick={() => this.setState({session: 'solo'})}>Solo View</button><button aria-pressed={captions} onClick={() => this.setState({captions: !captions})}>Captions {captions ? 'on' : 'off'}</button></div>
        {(this.props.catalog ?? []).length > 1 && <div className="story-picker"><p className="eyebrow">Choose another story</p>{(this.props.catalog ?? []).filter(item => item.id !== story.id).map(item => <button key={item.id} className="secondary" onClick={() => this.chooseStory(item.id)}>Open {item.title}</button>)}</div>}
        <div className="actions"><button data-initial onClick={this.close}>Back to the story</button>{native && <button onClick={this.companion}>Connect to another playback app</button>}</div>
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
    return <main className="app"><section className="sheet"><h1>SELENE</h1><p role="status">{this.state.error || 'Loading the story…'}</p><div className="actions">{this.state.error && <button autoFocus onClick={this.load}>Try again</button>}{native && <button autoFocus={!this.state.error} onClick={() => native.postMessage('selene:companion')}>Connect to another playback app</button>}</div></section></main>;
  }
}
const params = new URLSearchParams(location.search);
const companion = params.get('companion') === '1';
const privateToken = params.get('private');
const bootstrap = (window as Window & {__SELENE_COMPANION__?: CompanionBootstrap}).__SELENE_COMPANION__;
createRoot(document.getElementById('root')!).render(privateToken ? <PrivateMirror token={privateToken} /> : companion ? <CompanionMoment initial={bootstrap ?? null} /> : <Startup />);
