import React from 'react';
import {Visual, type VisualArtifact} from './Visual';
import {focusPanel, moveFocus} from './navigation';
import {Voice, type VoiceState} from './voice';

type Snapshot = {package_id: string; session_id: number; catalog_name: string; content_id: string; title: string; provider_name: string; at_seconds: number};
type Playback = {state: 'playing' | 'paused' | 'unknown'; can_pause: boolean; can_play: boolean; revision: number; observing: boolean};
export type CompanionBootstrap = {snapshot: Snapshot; playback: Playback};
type Choice = 'unspecified' | 'keep_watching' | 'pause_to_explore';
type Recipient = 'everyone' | 'grandparent' | 'parent' | 'child' | 'adult';
type Need = 'Explain simply' | 'Easy to hear' | 'Translate' | 'Show visually';
type Language = 'English' | 'Indonesian' | 'Spanish';
type Moment = {
  state: 'quiet' | 'response' | 'clarification'; answer: string; visual: VisualArtifact;
  intervention: {playback: 'keep_watching' | 'offer_choice' | 'request_pause'; audio: 'silent'};
  life_connection: {offered: boolean; question: string; recipient: Recipient};
};
type Input = {
  snapshot: Snapshot; request: string; scene_detail: string; scene_answer: string; need: Need; language: Language; recipient: Recipient;
  session: 'family' | 'solo'; play_state: Playback['state']; playback_choice: Choice; life_connection: boolean;
  continuation: {request: string; question: string; answer: string} | null;
};
type State = {
  screen: 'ask' | 'loading' | 'moment' | 'life'; snapshot: Snapshot | null; request: string; detail: string; sceneAnswer: string; need: Need; language: Language;
  recipient: Recipient; session: 'family' | 'solo'; playback: Playback; moment: Moment | null;
  error: string; clarifying: boolean; lifeStarted: boolean; choice: Choice; controlling: boolean; voice: VoiceState; mirror: {url: string} | null;
};
const recipients: Recipient[] = ['everyone', 'grandparent', 'parent', 'child', 'adult'];
const needs: Need[] = ['Explain simply', 'Easy to hear', 'Translate', 'Show visually'];
const name = (value: string) => value[0].toUpperCase() + value.slice(1);
const clock = (at: number) => `${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`;
const native = (window as Window & {ReactNativeWebView?: {postMessage: (data: string) => void}}).ReactNativeWebView;

export class CompanionMoment extends React.Component<{initial: CompanionBootstrap | null}, State> {
  state: State = {screen: 'ask', snapshot: this.props.initial?.snapshot ?? null, request: '', detail: '', sceneAnswer: '', need: 'Explain simply', language: 'English', recipient: 'everyone',
    session: 'family', playback: this.props.initial?.playback ?? {state: 'unknown', can_pause: false, can_play: false, revision: 0, observing: false}, moment: null,
    error: '', clarifying: false, lifeStarted: false, choice: 'unspecified', controlling: false, voice: 'idle', mirror: null};
  private root = React.createRef<HTMLElement>();
  private pending: AbortController | null = null;
  private control: {id: number; resolve: (value: Playback) => void; reject: (error: Error) => void} | null = null;
  private sequence = 0;
  private sessionId = '';
  private lastInput: Input | null = null;
  private mounted = false;
  private voice = new Voice(() => null,
    voice => {if (this.mounted) this.setState({voice});},
    error => {if (this.mounted) this.setState({error});});

  componentDidMount() {
    this.mounted = true;
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
    if (playback.state !== 'paused' && this.state.lifeStarted) void this.setMirrorLife(false);
    this.setState({playback, lifeStarted: playback.state === 'paused' ? this.state.lifeStarted : false});
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
      if (this.mounted) this.setState({choice: 'pause_to_explore', lifeStarted: Boolean(this.state.moment?.life_connection.offered), error: ''}, () => {if (this.state.lifeStarted) void this.setMirrorLife(true);});
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
    try {
      const playback = await this.command('refresh');
      if (playback.state !== 'paused' || !playback.observing) throw new Error('Voice needs a confirmed pause and live playback updates. Use the remote or keyboard for this session.');
      if (!this.mounted) return;
      this.setState({error: ''});
      this.voice.listen(this.state.language === 'Indonesian' ? 'id-ID' : this.state.language === 'Spanish' ? 'es-ES' : 'en-US', request => {
        if (this.mounted) this.setState({request});
      });
    } catch (error) {this.failed(error);}
  };
  private readAloud = async () => {
    if (this.state.voice === 'speaking') return this.voice.stop();
    try {
      const playback = await this.command('refresh');
      if (playback.state !== 'paused' || !playback.observing) throw new Error('Read aloud needs a confirmed pause and live playback updates. The answer remains on screen.');
      const {moment, lifeStarted, need, language} = this.state;
      if (!this.mounted || !moment) return;
      this.voice.speak(lifeStarted ? moment.life_connection.question : moment.answer,
        need === 'Translate' ? (language === 'Indonesian' ? 'id-ID' : language === 'Spanish' ? 'es-ES' : 'en-US') : 'en-US', need === 'Easy to hear');
    } catch (error) {this.failed(error);}
  };
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
  private openSession = async (signal: AbortSignal) => {
    const response = await fetch('/api/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({mode: 'companion'}), signal});
    if (!response.ok) throw new Error('The SELENE service could not start a viewing session. Try again.');
    const session = await response.json();
    signal.throwIfAborted();
    this.sessionId = session.session_id;
  };
  private ask = (choice: Choice, life = false) => {
    const {request, detail, need, language, recipient, session, playback, clarifying, moment} = this.state;
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    if (clarifying && !request.trim()) {this.setState({error: 'Add the missing detail before sending.'}); return;}
    const previous = clarifying ? this.lastInput : null;
    const input: Input = {
      snapshot,
      request: previous?.request ?? (life ? 'Help us connect this selected moment to our own lives with one question for the selected person.' : request.trim() || 'Help me understand this selected moment.'),
      scene_detail: previous?.scene_detail ?? detail.trim(), scene_answer: this.state.sceneAnswer, need, language, recipient, session, play_state: playback.state,
      playback_choice: choice, life_connection: previous?.life_connection ?? life,
      continuation: previous && moment ? {request: previous.request, question: moment.answer, answer: request.trim()} : null,
    };
    return this.deliver(input);
  };
  private deliver = async (input: Input) => {
    this.cancel();
    const pending = new AbortController(); this.pending = pending;
    this.lastInput = input;
    this.setState({screen: 'loading', error: '', lifeStarted: false, choice: input.playback_choice});
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
      if (moment.intervention.playback === 'request_pause' && current.state !== 'paused') {
        // A newer reported transport change wins. Without notifications, request a fresh button press.
        if (!state.observing || !current.observing || state.revision !== current.revision) moment.intervention.playback = 'offer_choice';
        else {current = await this.pause(current.revision); pending.signal.throwIfAborted();}
      }
      if (!this.mounted || this.pending !== pending) return;
      this.pending = null;
      if (moment.state === 'quiet') return this.close();
      const lifeVisible = current.state === 'paused' && moment.life_connection.offered && (input.life_connection || input.playback_choice === 'pause_to_explore' || moment.intervention.playback === 'request_pause');
      this.setState({screen: 'moment', moment, clarifying: false, sceneAnswer: input.continuation?.answer ?? this.state.sceneAnswer,
        choice: moment.intervention.playback === 'request_pause' ? 'pause_to_explore' : input.playback_choice,
        lifeStarted: lifeVisible,
      }, () => {if (lifeVisible) void this.setMirrorLife(true);});
    } catch (error) {
      if (pending.signal.aborted || !this.mounted) return;
      this.pending = null; this.setState({screen: 'ask'}); this.failed(error);
    }
  };
  private confirmLife = async () => {
    const {moment, recipient} = this.state;
    if (!moment?.life_connection.offered || moment.life_connection.recipient !== recipient) {this.ask('pause_to_explore', true); return;}
    try {await this.pause(); if (this.mounted) this.setState({screen: 'moment', lifeStarted: true, choice: 'pause_to_explore', error: ''}, () => {void this.setMirrorLife(true);});}
    catch (error) {this.failed(error);}
  };
  private back = () => {
    if (this.state.voice !== 'idle') return this.voice.stop();
    if (this.state.screen === 'loading') {this.cancel(); this.setState({screen: 'ask', error: 'Request cancelled. A playback command already sent may still finish.'}); return;}
    if (this.state.screen === 'life' || (this.state.screen === 'ask' && this.state.clarifying)) {
      if (this.state.screen === 'life') void this.setMirrorLife(false);
      this.cancel(); this.setState({screen: 'moment', clarifying: false, lifeStarted: false, error: ''}); return;
    }
    this.close();
  };
  private key = (event: KeyboardEvent) => {
    if (['Escape', 'BrowserBack', 'GoBack'].includes(event.key) || event.keyCode === 27) {
      event.preventDefault();
      if (event.target instanceof HTMLElement && event.target.matches('textarea,select')) {this.root.current?.querySelector<HTMLElement>('[data-submit]')?.focus(); return;}
      this.back(); return;
    }
    moveFocus(event, this.root.current);
  };

  render() {
    const {screen, snapshot, request, detail, need, language, recipient, session, playback, moment, error, clarifying, lifeStarted, choice, controlling, voice, mirror} = this.state;
    if (!snapshot || !native) return <main className="app" ref={this.root}><section className="sheet"><h1>Open a playback session in SELENE</h1><p>This screen needs a selected viewing app and its reported playback position.</p>{native && <button data-initial onClick={this.close}>Back</button>}</section></main>;
    const paused = playback.state === 'paused';
    const needsChoice = moment?.intervention.playback === 'offer_choice' && choice === 'unspecified';
    return <main className="app companion-app" ref={this.root} tabIndex={-1}>
      <header className="companion-heading"><span className="wordmark">SELENE</span><span>{snapshot.provider_name || snapshot.package_id} · {snapshot.title || 'Title not supplied'} · At {clock(snapshot.at_seconds)}</span><span>Last reported: {playback.state}</span></header>
      {screen === 'ask' && <section className="sheet" data-panel ref={focusPanel}>
        <div className="sheet-head"><div><p className="eyebrow">This selected moment</p><h2>{clarifying && moment ? moment.answer : 'What would help you follow along?'}</h2></div><button onClick={this.back}>Back</button></div>
        <div className="need-row">{needs.map(value => <button key={value} aria-pressed={need === value} onClick={() => this.setState({need: value})}>{value}</button>)}
          <label>For <select value={recipient} onChange={event => this.setState({recipient: event.target.value as Recipient})}>{recipients.map(value => <option key={value} value={value}>{name(value)}</option>)}</select></label>
          <label>View <select value={session} onChange={event => this.setState({session: event.target.value as 'family' | 'solo'})}><option value="family">Family</option><option value="solo">Solo</option></select></label>
          {need === 'Translate' && <label>Language <select value={language} onChange={event => this.setState({language: event.target.value as Language})}>{['English', 'Indonesian', 'Spanish'].map(value => <option key={value}>{value}</option>)}</select></label>}
        </div>
        <div className="request-row"><label htmlFor="companion-request">{clarifying ? 'Your answer' : 'Your question'}</label><textarea id="companion-request" rows={2} maxLength={600} value={request} onChange={event => this.setState({request: event.target.value})} /></div>
        {!clarifying && <><p className="small context-note">Playback apps usually share identity and time, not scene dialogue. If no authorized scene source is available, add the words you heard or describe what you saw. Your question and these details go to SELENE when you send.</p>
          <div className="request-row"><label htmlFor="scene-detail">Scene detail</label><textarea id="scene-detail" rows={2} maxLength={1200} value={detail} onChange={event => this.setState({detail: event.target.value})} placeholder="Dialogue, people or action in this moment…" /></div></>}
        <div className="voice-row"><button disabled={controlling || !paused || !playback.observing || !this.voice.Recognition} onClick={this.listen}>{voice === 'listening' ? 'Stop listening' : 'Use microphone'}</button>{!this.voice.Recognition && <span className="small">Microphone unavailable in this WebView. Use the remote or keyboard.</span>}{this.voice.Recognition && !paused && <button disabled={controlling || !playback.can_pause} onClick={this.choosePause}>Pause for microphone</button>}{this.voice.Recognition && !playback.observing && <span className="small">Voice needs live playback updates. Use the remote or keyboard.</span>}</div>
        <div className="sheet-foot"><p>Answers appear silently on this TV. Your viewing app owns playback.</p><div className="actions">
          <button data-initial data-submit disabled={controlling} onClick={() => this.ask('unspecified')}>Send request</button>
          <button disabled={controlling} onClick={() => this.ask('keep_watching')}>Keep watching</button>
          <button className="primary" disabled={controlling || (!paused && !playback.can_pause)} onClick={() => this.ask('pause_to_explore')}>Pause to explore</button>
        </div></div>
        {error && <p role="alert">{error}</p>}
        {error && this.lastInput && <button onClick={() => this.deliver(this.lastInput!)}>Retry this request</button>}
      </section>}
      {screen === 'loading' && <section className="loading-panel" data-panel ref={focusPanel}><div><h2>Preparing this moment</h2><p role="status">{controlling ? 'Checking the selected playback session…' : 'Your question stays with the selected moment.'}</p></div><button data-initial onClick={this.back}>Cancel</button></section>}
      {screen === 'moment' && moment && <section className={`moment ${paused && choice === 'pause_to_explore' ? 'full' : 'compact'}`} data-panel ref={focusPanel}>
        <header><span>Selected playback moment</span><span>At {clock(snapshot.at_seconds)} · Last reported: {playback.state}</span></header>
        <div className="moment-content"><div className="answer"><p className="eyebrow">{lifeStarted ? 'Life Connection' : need}</p><h2>{moment.answer}</h2>
          {paused && lifeStarted && moment.life_connection.offered && <div className="life-question"><p>For {name(moment.life_connection.recipient)}</p><h3>{moment.life_connection.question}</h3><p className="small">Your conversation is not recorded. Close or resume when you choose.</p></div>}
        </div><div className="visual"><Visual key={String(paused) + moment.visual.svg} visual={moment.visual} /></div></div>
        <footer className="actions">
          {needsChoice && <button data-initial disabled={controlling} onClick={() => this.setState({choice: 'keep_watching'})}>Keep watching</button>}
          {(needsChoice || !paused) && <button disabled={controlling || (!paused && !playback.can_pause)} onClick={this.choosePause}>Pause to explore</button>}
          {paused && playback.can_play && <button className="primary" disabled={controlling} onClick={this.resume}>Resume playback</button>}
          {moment.state === 'clarification' && <button disabled={controlling} onClick={() => this.setState({screen: 'ask', request: '', clarifying: true, error: ''})}>Answer the question</button>}
          {moment.state === 'response' && !lifeStarted && <button disabled={controlling || (!paused && !playback.can_pause)} onClick={() => {this.voice.stop(); this.setState({screen: 'life', error: ''});}}>Connect to life</button>}
          {moment.state === 'response' && this.voice.canSpeak && <button disabled={controlling || voice === 'listening' || !paused || !playback.observing} onClick={this.readAloud}>{voice === 'speaking' ? 'Stop reading' : paused ? 'Read aloud' : 'Pause to read aloud'}</button>}
          {moment.state === 'response' && <button onClick={mirror ? this.stopMirror : this.openMirror}>{mirror ? 'Stop private mirror' : 'Mirror on phone'}</button>}
          <button data-initial={!needsChoice} onClick={this.close}>{paused ? 'Close, stay paused' : 'Close'}</button>
        </footer>
        {mirror && <div className="mirror-panel"><p>Open this address on a phone or tablet on the same network. The mirror stays private to this viewing session.</p><code>{mirror.url}</code><button onClick={this.stopMirror}>Stop private mirror</button></div>}
        {controlling && <p role="status" className="small">Waiting for the viewing app. Closing cancels further work; a command already sent may finish.</p>}
        {voice === 'speaking' && <p className="small audio-status">Reading aloud while the provider remains paused.</p>}
        {error && <p role="alert">{error}</p>}
      </section>}
      {screen === 'life' && <section className="sheet life-sheet" data-panel ref={focusPanel}><p className="eyebrow">Life Connection</p><h2>Invite your own perspective</h2><p>Choose who to invite. The viewing app must confirm a pause before the question opens.</p>
        <div className="need-row">{recipients.map(value => <button key={value} aria-pressed={recipient === value} onClick={() => this.setState({recipient: value})}>{name(value)}</button>)}</div>
        <p className="small">The microphone stays off. You decide when to finish.</p><div className="actions"><button data-initial onClick={this.back}>Back</button><button className="primary" disabled={controlling || (!paused && !playback.can_pause)} onClick={this.confirmLife}>Pause and connect</button></div>
        {error && <p role="alert">{error}</p>}
      </section>}
    </main>;
  }
}
