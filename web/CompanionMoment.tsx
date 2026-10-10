import React from 'react';
import {Visual, type VisualArtifact} from './Visual';
import {focusPanel, moveFocus} from './navigation';
import {Voice, type VoiceState} from './voice';
import {Brand, Icon, LoadingMark} from './Brand';
import {readPreferences, savePreferences, type Need, type Recipient, type Language, type Preferences} from './preferences';
import {accessibilitySettings, initialAccessibility, applyAccessibility, type AccessibilitySettings} from './accessibility';
import {audienceLabel, type Audience} from './personal';

type Snapshot = {package_id: string; session_id: number; catalog_name: string; content_id: string; title: string; provider_name: string; at_seconds: number};
type Playback = {state: 'playing' | 'paused' | 'unknown'; can_pause: boolean; can_play: boolean; revision: number; observing: boolean};
export type CompanionBootstrap = {snapshot: Snapshot; playback: Playback};
type Choice = 'unspecified' | 'keep_watching' | 'pause_to_explore';
type Moment = {
  state: 'quiet' | 'response' | 'clarification'; answer: string; visual: VisualArtifact;
  audience?: Audience;
  intervention: {playback: 'keep_watching' | 'offer_choice' | 'request_pause'; audio: 'silent'};
};
type Input = {
  snapshot: Snapshot; request: string; scene_detail: string; scene_answer: string; need: Need; language: Language; recipient: Recipient;
  session: 'family' | 'solo'; play_state: Playback['state']; playback_choice: Choice;
  continuation: {request: string; question: string; answer: string} | null;
  requester_id?: string;
};
type State = {
  screen: 'ask' | 'loading' | 'moment' | 'preferences' | 'more'; snapshot: Snapshot | null; request: string; sceneAnswer: string; need: Need; language: Language;
  recipient: Recipient; session: 'family' | 'solo'; playback: Playback; moment: Moment | null;
  accessibility: AccessibilitySettings;
  error: string; clarifying: boolean; choice: Choice; controlling: boolean; voice: VoiceState; mirror: {url: string} | null; mirrorAvailable: boolean;
};
const native = (window as Window & {ReactNativeWebView?: {postMessage: (data: string) => void}}).ReactNativeWebView;

export class CompanionMoment extends React.Component<{initial: CompanionBootstrap | null}, State> {
  state: State = {screen: 'ask', snapshot: this.props.initial?.snapshot ?? null, request: '', sceneAnswer: '', ...readPreferences(), playback: this.props.initial?.playback ?? {state: 'unknown', can_pause: false, can_play: false, revision: 0, observing: false}, moment: null,
    accessibility: initialAccessibility(), error: '', clarifying: false, choice: 'unspecified', controlling: false, voice: 'idle', mirror: null, mirrorAvailable: false};
  private root = React.createRef<HTMLElement>();
  private pending: AbortController | null = null;
  private control: {id: number; resolve: (value: Playback) => void; reject: (error: Error) => void} | null = null;
  private sequence = 0;
  private sessionId = '';
  private lastInput: Input | null = null;
  private requesterId: string | undefined;
  private mounted = false;
  private voice = new Voice(() => null,
    voice => {if (this.mounted) this.setState({voice});},
    error => {if (this.mounted) this.setState({error});});

  private preferences = (selection: Partial<Preferences>) => {
    const {need, language, recipient, session} = this.state;
    const preferences = {need, language, recipient, session, ...selection};
    savePreferences(preferences); this.setState(preferences);
  };

  componentDidMount() {
    this.mounted = true;
    applyAccessibility(this.state.accessibility);
    window.addEventListener('message', this.receive);
    window.addEventListener('keydown', this.key);
    window.addEventListener('pagehide', this.end);
    document.addEventListener('visibilitychange', this.visibility);
    focusPanel(this.root.current);
  }
  componentDidUpdate() {
    const root = this.root.current;
    if (root && (!root.contains(document.activeElement) || document.activeElement?.matches(':disabled'))) focusPanel(root);
  }
  componentWillUnmount() {
    this.mounted = false; this.end();
    window.removeEventListener('message', this.receive);
    window.removeEventListener('keydown', this.key);
    window.removeEventListener('pagehide', this.end);
    document.removeEventListener('visibilitychange', this.visibility);
  }
  private cancel = () => {
    this.pending?.abort(); this.pending = null; this.voice.stop();
    const control = this.control; this.control = null;
    if (control) {native?.postMessage(JSON.stringify({action: 'cancel'})); control.reject(new DOMException('Cancelled', 'AbortError'));}
    if (this.mounted) this.setState({controlling: false});
  };
  private end = () => {
    this.cancel();
    if (this.sessionId) navigator.sendBeacon('/api/session/end', new Blob([JSON.stringify({session_id: this.sessionId})], {type: 'application/json'}));
    this.sessionId = '';
  };
  private close = () => {void this.stopMirror(); this.end(); native?.postMessage(JSON.stringify({action: 'close'}));};
  private visibility = () => {if (document.hidden) this.close();};
  private receive = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === 'selene:accessibility') {
      const accessibility = accessibilitySettings(event.data.settings); applyAccessibility(accessibility);
      if (accessibility.screenReader && this.state.voice === 'speaking') this.voice.stop();
      this.setState({accessibility}); return;
    }
    if (event.data?.type === 'selene:back') {this.back(); return;}
    if (event.data?.type === 'selene:provider' && event.data.playback) {
      this.reportPlayback(event.data.playback as Playback);
      return;
    }
    if (event.data?.type !== 'selene:playback' || event.data.id !== this.control?.id) return;
    const control = this.control!; this.control = null;
    this.setState({controlling: false});
    if (event.data.error || !event.data.playback) {control.reject(new Error(event.data.error || 'Playback could not be confirmed.')); return;}
    const playback = event.data.playback as Playback;
    this.reportPlayback(playback);
    control.resolve(playback);
  };
  private reportPlayback(playback: Playback) {
    if (playback.state !== 'paused' || !playback.observing) this.voice.stop();
    this.setState({playback});
  }
  private command = (action: 'play' | 'pause' | 'refresh', expectedRevision?: number): Promise<Playback> => {
    if (!native || this.control) return Promise.reject(new Error('Playback control is unavailable. Close this moment and check the app.'));
    this.setState({controlling: true});
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.control = {id, resolve, reject};
      native.postMessage(JSON.stringify({id, action, expected_revision: expectedRevision}));
    });
  };
  private pause = async (expectedRevision?: number) => {
    const state = await this.command('pause', expectedRevision);
    if (state.state !== 'paused') throw new Error('The viewing app has not confirmed a pause. Explore after it reports paused.');
    return state;
  };
  private choosePause = async () => {
    try {
      await this.pause();
      if (this.mounted) this.setState({choice: 'pause_to_explore', error: ''});
    } catch (error) {this.failed(error);}
  };
  private resume = async () => {
    try {
      const state = await this.command('play');
      if (state.state !== 'playing') throw new Error('The viewing app has not confirmed playback. Check that app before continuing.');
      if (this.mounted) this.close();
    } catch (error) {this.failed(error);}
  };
  private failed(error: unknown) {
    if (this.mounted && !(error instanceof DOMException && error.name === 'AbortError')) this.setState({error: error instanceof Error ? error.message : 'This moment is unavailable. Please try again.'});
  }
  private listen = async () => {
    if (this.state.voice === 'listening') return this.voice.finishListening();
    if (this.state.voice === 'processing') return;
    this.cancel();
    const pending = new AbortController(); this.pending = pending;
    try {
      const playback = await this.command('refresh');
      if (playback.state !== 'paused' || !playback.observing) throw new Error('Voice needs a confirmed pause and live playback updates. Use the remote or keyboard for this session.');
      if (!this.mounted || pending.signal.aborted || this.pending !== pending) return;
      this.requesterId = undefined; this.setState({error: ''});
      if (!this.sessionId) await this.openSession(pending.signal);
      if (!this.mounted || pending.signal.aborted || this.pending !== pending) return;
      if (this.state.playback.state !== 'paused' || !this.state.playback.observing) throw new Error('Playback changed. Pause before recording.');
      this.voice.listen('/api/voice', {'X-Selene-Session': this.sessionId}, result => {
        if (!this.mounted) return;
        this.requesterId = result.match === 'matched' ? result.requester?.id : undefined;
        this.setState({request: result.transcript});
      });
    } catch (error) {this.failed(error);}
  };
  private readAloud = async () => {
    if (this.state.accessibility.screenReader) return;
    if (this.state.voice === 'speaking') return this.voice.stop();
    try {
      const playback = await this.command('refresh');
      if (playback.state !== 'paused' || !playback.observing) throw new Error('Read aloud needs a confirmed pause and live playback updates. The answer remains on screen.');
      const {moment, need, language} = this.state;
      if (!this.mounted || !moment || this.state.accessibility.screenReader) return;
      this.voice.speak(moment.answer,
        need === 'Translate' ? (language === 'Indonesian' ? 'id-ID' : language === 'Spanish' ? 'es-ES' : 'en-US') : 'en-US', need === 'Slower answer voice');
    } catch (error) {this.failed(error);}
  };
  private openMirror = async () => {
    if (!this.sessionId || !this.state.moment) return;
    try {
      const response = await fetch('/api/private/pair', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': this.sessionId}, body: '{}'});
      const result = await response.json();
      if (!response.ok || typeof result.url !== 'string') throw new Error(result.error || 'Private mirroring is unavailable.');
      this.setState({mirror: {url: result.url}});
    } catch (error) {this.setState({error: error instanceof Error ? error.message : 'Private mirroring is unavailable.'});}
  };
  private stopMirror = async () => {
    if (!this.state.mirror || !this.sessionId) {if (this.state.mirror) this.setState({mirror: null}); return;}
    this.setState({mirror: null});
    await fetch('/api/private/close', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': this.sessionId}, body: '{}'}).catch(() => undefined);
  };
  private openSession = async (signal: AbortSignal) => {
    const response = await fetch('/api/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({mode: 'companion'}), signal});
    if (!response.ok) throw new Error('The SELENE service could not start a viewing session. Try again.');
    const session = await response.json();
    signal.throwIfAborted();
    this.sessionId = session.session_id;
    this.setState({mirrorAvailable: session.private_mirror_available === true});
  };
  private ask = (choice: Choice, quickRequest?: string) => {
    const {request, need, language, recipient, session, playback, clarifying, moment} = this.state;
    if (this.state.voice === 'listening' || this.state.voice === 'processing') return;
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    if (!quickRequest && !request.trim()) {this.setState({error: 'Type a question or choose a quick question.'}); return;}
    const previous = clarifying ? this.lastInput : null;
    const input: Input = {
      snapshot,
      request: previous?.request ?? (quickRequest ?? request.trim()),
      scene_detail: previous?.scene_detail ?? request.trim(), scene_answer: this.state.sceneAnswer, need, language, recipient, session, play_state: playback.state,
      playback_choice: choice,
      continuation: previous && moment ? {request: previous.request, question: moment.answer, answer: request.trim()} : null,
      requester_id: previous ? previous.requester_id : quickRequest ? undefined : this.requesterId,
    };
    return this.deliver(input);
  };
  private deliver = async (input: Input) => {
    this.cancel();
    const pending = new AbortController(); this.pending = pending;
    this.lastInput = input;
    this.setState({screen: 'loading', error: '', choice: input.playback_choice});
    try {
      const state = input.playback_choice === 'pause_to_explore' ? await this.pause() : await this.command('refresh');
      pending.signal.throwIfAborted();
      // Refresh transport and identity without moving the question's spoiler boundary.
      input = {...input, play_state: state.state}; this.lastInput = input;
      if (!this.sessionId) await this.openSession(pending.signal);
      const send = () => fetch('/api/companion/moment', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Selene-Session': this.sessionId}, body: JSON.stringify(input), signal: pending.signal});
      let response = await send();
      if (response.status === 410) {await this.openSession(pending.signal); response = await send();}
      const moment = await response.json();
      if (!response.ok) throw new Error(moment.error || 'This moment could not be prepared. Try again.');
      pending.signal.throwIfAborted();
      // Re-read the selected session before displaying a delayed answer. Identity is checked natively.
      let current = await this.command('refresh');
      pending.signal.throwIfAborted();
      if (moment.state === 'response') {
        if (current.state !== 'playing') {
          if (!current.can_play) throw new Error('The playback app cannot resume. Resume it there, then ask again.');
          current = await this.command('play', current.revision);
          pending.signal.throwIfAborted();
          if (current.state !== 'playing') throw new Error('The playback app has not confirmed resumed playback.');
        }
        moment.intervention.playback = 'keep_watching';
      } else if (moment.intervention.playback === 'request_pause' && current.state !== 'paused') {
        // A newer reported transport change wins. Without notifications, request a fresh button press.
        if (!state.observing || !current.observing || state.revision !== current.revision) moment.intervention.playback = 'offer_choice';
        else {current = await this.pause(current.revision); pending.signal.throwIfAborted();}
      }
      if (!this.mounted || this.pending !== pending) return;
      this.pending = null;
      if (moment.state === 'quiet') return this.close();
      this.setState({screen: moment.state === 'clarification' ? 'ask' : 'moment', moment, clarifying: moment.state === 'clarification', request: moment.state === 'clarification' ? '' : this.state.request, sceneAnswer: input.continuation?.answer ?? this.state.sceneAnswer,
        choice: moment.intervention.playback === 'request_pause' ? 'pause_to_explore' : input.playback_choice,
      });
    } catch (error) {
      if (pending.signal.aborted || !this.mounted) return;
      this.pending = null; this.setState({screen: 'ask'}); this.failed(error);
    }
  };
  private back = () => {
    if (this.state.voice !== 'idle') return this.voice.stop();
    if (this.state.screen === 'loading') {this.cancel(); this.setState({screen: 'ask', error: 'Request cancelled. A playback command already sent may still finish.'}); return;}
    if (this.state.screen === 'preferences') {this.setState({screen: 'ask', error: ''}); return;}
    if (this.state.screen === 'more') {this.setState({screen: 'moment', error: ''}); return;}
    if (this.state.screen === 'ask' && this.state.clarifying) {
      if (this.state.clarifying) {this.close(); return;}
      this.cancel(); this.setState({screen: 'moment', clarifying: false, error: ''}); return;
    }
    this.close();
  };
  private key = (event: KeyboardEvent) => {
    if (['Escape', 'BrowserBack', 'GoBack'].includes(event.key) || event.keyCode === 27) {
      event.preventDefault();
      if (event.target instanceof HTMLElement && event.target.matches('textarea,select')) {this.root.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus(); return;}
      this.back(); return;
    }
    moveFocus(event, this.root.current);
  };

  render() {
    const {screen, snapshot, request, need, playback, moment, error, clarifying, controlling, voice, mirror, mirrorAvailable} = this.state;
    if (!snapshot || !native) return <main className="app companion-app" ref={this.root}><header className="companion-heading"><Brand /></header><section className="sheet empty-sheet"><h1>Choose a playback app</h1><p>Open SELENE on your Fire TV to select what you’re watching.</p>{native && <button data-initial onClick={this.close}><Icon name="back"/>Back</button>}</section></main>;
    const paused = playback.state === 'paused';
    const canVoice = this.voice.canListen && playback.observing;
    return <main className="app companion-app" ref={this.root} tabIndex={-1}>

      {screen === 'ask' && <section className="sheet ask-sheet" data-panel ref={focusPanel} aria-labelledby="ask-title">
        <div className="sheet-head"><h1 id="ask-title" className={clarifying ? '' : 'sr-only'}>{clarifying && moment ? moment.answer.replace(/\u2014/g, ',') : 'Ask Selene'}</h1><button className="ask-close" aria-label="Close question" onClick={this.back}><Icon name="close"/></button></div>
        <p className="request-hint" id="request-hint" role={error ? 'alert' : undefined}>{error}</p>
        <form onSubmit={event => {event.preventDefault(); this.ask('unspecified');}}>
          <label className="sr-only" htmlFor="companion-request">{clarifying ? 'Your answer' : 'Your question'}</label>
          <div className="question-input"><textarea data-initial id="companion-request" rows={1} maxLength={600} disabled={voice === 'listening' || voice === 'processing'} aria-describedby="request-hint" value={request} onChange={event => {this.requesterId = undefined; this.setState({request: event.target.value});}} placeholder={clarifying ? 'Add the missing detail…' : 'Why did that happen?'} onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault(); this.ask('unspecified');}}}/><button data-submit className="primary" type="submit" disabled={controlling || voice === 'listening' || voice === 'processing' || !request.trim()}><Icon name="send"/>{clarifying ? 'Answer' : 'Ask'}</button></div>
        </form>
        {!clarifying && <div className="quick-questions" role="group" aria-label="Quick questions"><button disabled={controlling} onClick={() => this.ask('unspecified', 'Explain what just happened in this moment.')}>Explain scene</button><button disabled={controlling} onClick={() => this.ask('unspecified', 'I missed that. Explain the last completed dialogue simply.')}>Explain dialogue</button></div>}
        <div className="request-options">{this.voice.canSpeak && !this.state.accessibility.screenReader && <button className="text-button" aria-label="Read-aloud settings" onClick={() => this.setState({screen: 'preferences', error: ''})}><Icon name="settings"/></button>}
          {canVoice && <button className="text-button" disabled={controlling || voice === 'processing' || (!paused && !playback.can_pause)} onClick={async () => {if (!paused) {try {await this.pause();} catch (failure) {this.failed(failure); return;}} await this.listen();}}><Icon name="mic"/>{voice === 'listening' ? 'Stop listening' : voice === 'processing' ? 'Processing voice…' : paused ? 'Use voice' : 'Pause & use voice'}</button>}
        </div>
        {(voice === 'listening' || voice === 'processing') && <p className="privacy-note small" role="status">{voice === 'processing' ? 'Transcribing and checking enrolled profiles…' : 'Listening. Review before sending.'}</p>}
      </section>}
      {screen === 'preferences' && <section className="sheet preferences-sheet" data-panel ref={focusPanel}>
        <div className="sheet-head"><h1>Read aloud</h1><button data-initial aria-label="Close settings" onClick={this.back}><Icon name="close"/></button></div>
        <button aria-pressed={need === 'Slower answer voice'} onClick={() => this.preferences({need: need === 'Slower answer voice' ? 'Show visually' : 'Slower answer voice'})}>Slower read-aloud</button>
      </section>}
      {screen === 'loading' && <section className="loading-panel" data-panel ref={focusPanel}><button data-initial aria-label="Cancel answer" onClick={this.back}><LoadingMark/></button></section>}
      {screen === 'moment' && moment && <section className={`moment compact ${moment.visual.status === 'none' ? 'answer-only' : ''}`} data-panel ref={focusPanel} aria-label="Moment Response">
        <div className="moment-content"><div className="answer">
          <h2>{moment.answer.replace(/\u2014/g, ',')}</h2>
          {moment.audience && <span className="audience-badge" aria-label={audienceLabel(moment.audience)}>{audienceLabel(moment.audience)}</span>}
        </div>{moment.visual.status !== 'none' && <div className="visual"><Visual compact key={moment.visual.svg + moment.visual.description} visual={moment.visual} /></div>}</div>
        <footer className="actions">
          <button data-initial aria-label="Dismiss answer" disabled={controlling} onClick={this.close}><Icon name="close"/></button>
          <button aria-label="More options" onClick={() => this.setState({screen: 'more', error: ''})}><Icon name="more"/></button>
        </footer>
        {controlling && <p role="status" className="small">Waiting for the playback app…</p>}
        {voice === 'speaking' && <button onClick={() => this.voice.stop()}>Stop reading</button>}
        {error && <p role="alert">{error}</p>}
      </section>}
      {screen === 'more' && <section className="sheet options-sheet" data-panel ref={focusPanel}>
        <div className="sheet-head"><h1>This moment</h1><button data-initial onClick={this.back}><Icon name="back"/>Back</button></div>
        <div className="option-list">
          {!paused && playback.can_pause && <button disabled={controlling} onClick={async () => {await this.choosePause(); if (this.state.playback.state === 'paused') this.setState({screen: 'moment'});}}>Pause playback</button>}
          {paused && playback.can_play && <button disabled={controlling} onClick={this.resume}>Resume playback</button>}
          {this.voice.canSpeak && paused && playback.observing && !this.state.accessibility.screenReader && <button disabled={controlling} onClick={this.readAloud}>{voice === 'speaking' ? 'Stop reading' : 'Read aloud'}</button>}
          {mirrorAvailable && <button onClick={mirror ? this.stopMirror : this.openMirror}>{mirror ? 'Stop phone mirror' : 'Mirror on phone'}</button>}
          <button onClick={this.close}>{paused ? 'Close, stay paused' : 'Close moment'}</button>
        </div>
        {mirror && <div className="mirror-panel"><p>Open on your phone:</p><code>{mirror.url}</code></div>}
        {error && <p role="alert">{error}</p>}
      </section>}
    </main>;
  }
}
