import React from 'react';
import {Visual, type VisualArtifact} from './Visual';
import {focusPanel, moveFocus} from './navigation';
import {Voice, type VoiceState} from './voice';
import {Brand, Icon} from './Brand';
import {needs, recipients, readPreferences, savePreferences, type Need, type Recipient, type Language, type Preferences} from './preferences';

type Snapshot = {package_id: string; session_id: number; catalog_name: string; content_id: string; title: string; provider_name: string; at_seconds: number};
type Playback = {state: 'playing' | 'paused' | 'unknown'; can_pause: boolean; can_play: boolean; revision: number; observing: boolean};
export type CompanionBootstrap = {snapshot: Snapshot; playback: Playback};
type Choice = 'unspecified' | 'keep_watching' | 'pause_to_explore';
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
  screen: 'ask' | 'loading' | 'moment' | 'life' | 'preferences' | 'more'; snapshot: Snapshot | null; request: string; sceneAnswer: string; need: Need; language: Language;
  recipient: Recipient; session: 'family' | 'solo'; playback: Playback; moment: Moment | null;
  error: string; clarifying: boolean; lifeStarted: boolean; choice: Choice; controlling: boolean; voice: VoiceState; mirror: {url: string} | null; mirrorAvailable: boolean;
};
const name = (value: string) => value[0].toUpperCase() + value.slice(1);
const clock = (at: number) => `${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`;
const native = (window as Window & {ReactNativeWebView?: {postMessage: (data: string) => void}}).ReactNativeWebView;

export class CompanionMoment extends React.Component<{initial: CompanionBootstrap | null}, State> {
  state: State = {screen: 'ask', snapshot: this.props.initial?.snapshot ?? null, request: '', sceneAnswer: '', ...readPreferences(), playback: this.props.initial?.playback ?? {state: 'unknown', can_pause: false, can_play: false, revision: 0, observing: false}, moment: null,
    error: '', clarifying: false, lifeStarted: false, choice: 'unspecified', controlling: false, voice: 'idle', mirror: null, mirrorAvailable: false};
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

  private preferences = (selection: Partial<Preferences>) => {
    const {need, language, recipient, session} = this.state;
    const preferences = {need, language, recipient, session, ...selection};
    savePreferences(preferences); this.setState(preferences);
  };

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
    this.setState({mirrorAvailable: session.private_mirror_available === true});
  };
  private ask = (choice: Choice, life = false, quickRequest?: string) => {
    const {request, need, language, recipient, session, playback, clarifying, moment} = this.state;
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    if (!life && !quickRequest && !request.trim()) {this.setState({error: 'Type a question or choose a quick question.'}); return;}
    const previous = clarifying ? this.lastInput : null;
    const input: Input = {
      snapshot,
      request: previous?.request ?? (life ? 'Help us connect this selected moment to our own lives with one question for the selected person.' : quickRequest ?? request.trim()),
      scene_detail: previous?.scene_detail ?? (life ? this.lastInput?.scene_detail ?? '' : request.trim()), scene_answer: this.state.sceneAnswer, need, language, recipient, session, play_state: playback.state,
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
      this.setState({screen: moment.state === 'clarification' ? 'ask' : 'moment', moment, clarifying: moment.state === 'clarification', request: moment.state === 'clarification' ? '' : this.state.request, sceneAnswer: input.continuation?.answer ?? this.state.sceneAnswer,
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
    if (this.state.screen === 'preferences') {this.setState({screen: 'ask', error: ''}); return;}
    if (this.state.screen === 'more') {this.setState({screen: 'moment', error: ''}); return;}
    if (this.state.screen === 'life' || (this.state.screen === 'ask' && this.state.clarifying)) {
      if (this.state.screen === 'life') void this.setMirrorLife(false);
      if (this.state.clarifying) {this.close(); return;}
      this.cancel(); this.setState({screen: 'moment', clarifying: false, lifeStarted: false, error: ''}); return;
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
    const {screen, snapshot, request, need, language, recipient, session, playback, moment, error, clarifying, lifeStarted, choice, controlling, voice, mirror, mirrorAvailable} = this.state;
    if (!snapshot || !native) return <main className="app companion-app" ref={this.root}><header className="companion-heading"><Brand /></header><section className="sheet empty-sheet"><h1>Choose a playback app</h1><p>Open SELENE on your Fire TV to select what you’re watching.</p>{native && <button data-initial onClick={this.close}><Icon name="back"/>Back</button>}</section></main>;
    const paused = playback.state === 'paused';
    const needsChoice = moment?.intervention.playback === 'offer_choice' && choice === 'unspecified';
    const canVoice = Boolean(this.voice.Recognition) && playback.observing;
    return <main className="app companion-app" ref={this.root} tabIndex={-1}>
      <header className="companion-heading"><Brand /><span className="playback-context"><strong>{snapshot.title || snapshot.provider_name || 'Selected playback'}</strong><span>{snapshot.provider_name || 'Playback app'} · {clock(snapshot.at_seconds)}</span></span><span className="playback-status">{paused ? 'Paused' : playback.state === 'playing' ? 'Playing' : 'Playback unconfirmed'}</span></header>
      {screen === 'ask' && <section className="sheet ask-sheet" data-panel ref={focusPanel} aria-labelledby="ask-title">
        <div className="sheet-head"><h1 id="ask-title">{clarifying && moment ? moment.answer : 'What would you like to know?'}</h1><button className="text-button" onClick={this.back}><Icon name="back"/>Back</button></div>
        <p className="request-hint" id="request-hint" role={error ? 'alert' : undefined}>{error || (clarifying ? 'One detail to help explain this moment.' : 'Ask about what you saw or heard. Include a line of dialogue if it helps.')}</p>
        <form onSubmit={event => {event.preventDefault(); this.ask('unspecified');}}>
          <label className="sr-only" htmlFor="companion-request">{clarifying ? 'Your answer' : 'Your question'}</label>
          <div className="question-input"><textarea data-initial={clarifying || undefined} id="companion-request" rows={2} maxLength={600} disabled={voice === 'listening'} aria-describedby="request-hint" value={request} onChange={event => this.setState({request: event.target.value})} placeholder={clarifying ? 'Add the missing detail…' : 'Why did that happen?'} onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault(); this.ask('unspecified');}}}/><button data-submit className="primary" type="submit" disabled={controlling || voice === 'listening' || !request.trim()}><Icon name="send"/>{clarifying ? 'Answer' : 'Ask SELENE'}</button></div>
        </form>
        {!clarifying && <div className="quick-questions" role="group" aria-label="Quick questions"><button data-initial disabled={controlling} onClick={() => this.ask('unspecified', false, 'Explain what just happened in this moment.')}>What happened?</button><button disabled={controlling} onClick={() => this.ask('unspecified', false, 'Who are the people in this moment?')}>Who is that?</button><button disabled={controlling} onClick={() => this.ask('unspecified', false, 'I missed that. Explain the last completed dialogue simply.')}>I missed that</button></div>}
        <div className="request-options"><button className="text-button" onClick={() => this.setState({screen: 'preferences', error: ''})}><Icon name="settings"/>Preferences</button><span className="small">{need}{need === 'Translate' ? ` · ${language}` : ''} · {session === 'solo' ? 'Solo' : name(recipient)}</span>
          {canVoice && <button className="text-button" disabled={controlling || (!paused && !playback.can_pause)} onClick={async () => {if (!paused) {try {await this.pause();} catch (failure) {this.failed(failure); return;}} await this.listen();}}><Icon name="mic"/>{voice === 'listening' ? 'Stop listening' : paused ? 'Use voice' : 'Pause & use voice'}</button>}
        </div>
        <p className="privacy-note small">{voice === 'listening' ? 'Listening. Review your words before sending.' : 'Shown silently on this TV. Playback stays in your control.'}</p>
      </section>}
      {screen === 'preferences' && <section className="sheet preferences-sheet" data-panel ref={focusPanel}>
        <div className="sheet-head"><h1>How can we help?</h1><button data-initial data-submit className="primary" onClick={this.back}>Done</button></div>
        <div className="preference-group"><h2>Answer style</h2><div className="need-row">{needs.map(value => <button key={value} aria-pressed={need === value} onClick={() => this.preferences({need: value})}>{value}</button>)}</div></div>
        {need === 'Translate' && <label className="preference-select">Translate into<select value={language} onChange={event => this.preferences({language: event.target.value as Language})}>{['English', 'Indonesian', 'Spanish'].map(value => <option key={value}>{value}</option>)}</select></label>}
        <div className="preference-group"><h2>Watching with</h2><div className="need-row"><button aria-pressed={session === 'family'} onClick={() => this.preferences({session: 'family', recipient: 'everyone'})}>Family</button><button aria-pressed={session === 'solo'} onClick={() => this.preferences({session: 'solo', recipient: 'adult'})}>Just me</button></div></div>
        {session === 'family' && <label className="preference-select">Who is the answer for?<select value={recipient} onChange={event => this.preferences({recipient: event.target.value as Recipient})}>{recipients.map(value => <option key={value} value={value}>{name(value)}</option>)}</select></label>}
      </section>}
      {screen === 'loading' && <section className="loading-panel" data-panel ref={focusPanel}><div><h2>Finding a little clarity…</h2><p role="status">{controlling ? 'Checking playback' : `About the moment at ${clock(snapshot.at_seconds)}`}</p></div><button data-initial onClick={this.back}>Cancel</button></section>}
      {screen === 'moment' && moment && <section className={`moment ${paused && choice === 'pause_to_explore' ? 'full' : 'compact'} ${moment.visual.status === 'none' ? 'answer-only' : ''}`} data-panel ref={focusPanel} aria-label="Moment Response">
        <div className="moment-content"><div className="answer">
          {lifeStarted && paused && moment.life_connection.offered ? <div className="life-question"><h2>{moment.life_connection.question}</h2><p className="small">Life Connection · {name(moment.life_connection.recipient)}</p><p className="small">Take your time. Nothing is recorded.</p></div> : <h2>{moment.answer}</h2>}
        </div>{moment.visual.status !== 'none' && <div className="visual"><Visual key={String(paused) + moment.visual.svg} visual={moment.visual} /></div>}</div>
        <footer className="actions">
          {needsChoice ? <><button data-initial disabled={controlling} onClick={() => this.setState({choice: 'keep_watching'})}>Keep watching</button><button className="primary" disabled={controlling || (!paused && !playback.can_pause)} onClick={this.choosePause}><Icon name="pause"/>Pause to explore</button></> : <button data-initial className="primary" disabled={controlling} onClick={paused && playback.can_play ? this.resume : this.close}>{paused && playback.can_play ? 'Resume playback' : 'Done'}</button>}
          {moment.state === 'response' && !lifeStarted && <button disabled={controlling || (!paused && !playback.can_pause)} onClick={() => {this.voice.stop(); this.setState({screen: 'life', error: ''});}}>Life Connection</button>}
          <button onClick={() => this.setState({screen: 'more', error: ''})}><Icon name="more"/>More</button>
        </footer>
        {controlling && <p role="status" className="small">Waiting for the playback app…</p>}
        {voice === 'speaking' && <button onClick={() => this.voice.stop()}>Stop reading</button>}
        {error && <p role="alert">{error}</p>}
      </section>}
      {screen === 'more' && <section className="sheet options-sheet" data-panel ref={focusPanel}>
        <div className="sheet-head"><h1>This moment</h1><button data-initial onClick={this.back}><Icon name="back"/>Back</button></div>
        <div className="option-list">
          {!paused && playback.can_pause && <button disabled={controlling} onClick={async () => {await this.choosePause(); if (this.state.playback.state === 'paused') this.setState({screen: 'moment'});}}>Pause to explore</button>}
          {this.voice.canSpeak && paused && playback.observing && <button disabled={controlling} onClick={this.readAloud}>{voice === 'speaking' ? 'Stop reading' : 'Read aloud'}</button>}
          {mirrorAvailable && <button onClick={mirror ? this.stopMirror : this.openMirror}>{mirror ? 'Stop phone mirror' : 'Mirror on phone'}</button>}
          <button onClick={this.close}>{paused ? 'Close, stay paused' : 'Close moment'}</button>
        </div>
        {mirror && <div className="mirror-panel"><p>Open on your phone:</p><code>{mirror.url}</code></div>}
        {error && <p role="alert">{error}</p>}
      </section>}
      {screen === 'life' && <section className="sheet life-sheet" data-panel ref={focusPanel}>
        <div className="sheet-head"><h1>Bring it back to your life</h1><button onClick={this.back}><Icon name="back"/>Back</button></div>
        <p>One question for a conversation of your own.</p><label className="preference-select">Who’s it for?<select value={recipient} onChange={event => this.preferences({recipient: event.target.value as Recipient})}>{recipients.map(value => <option key={value} value={value}>{name(value)}</option>)}</select></label>
        <div className="actions"><button data-initial data-submit className="primary" disabled={controlling || (!paused && !playback.can_pause)} onClick={this.confirmLife}>{paused ? 'Start conversation' : 'Pause and connect'}</button><span className="small">Microphone off. Resume when you choose.</span></div>
        {error && <p role="alert">{error}</p>}
      </section>}
    </main>;
  }
}
