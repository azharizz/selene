import React from 'react';
import {Visual} from './Visual';
import {Voice, type VoiceState} from './voice';
import {Brand, Icon} from './Brand';
import {languages, needs, recipients, readPreferences, savePreferences, type Preferences, type Need, type Language, type Recipient} from './preferences';
import {clock, personalRequest, type PersonalStory, type Playback, type PersonalHold, type PersonalMoment, type ReturnResult, type Evidence} from './personal';

const locale = {English: 'en-US', Indonesian: 'id-ID', Spanish: 'es-ES'};
const clean = (text: string) => text.replace(/\u2014/g, ',');
type State = {
  story: PersonalStory | null; playback: Playback | null; hold: PersonalHold | null;
  moment: PersonalMoment | null; bridge: ReturnResult | null; evidence: Evidence[];
  request: string; error: string; notice: string; busy: '' | 'hold' | 'ask' | 'return' | 'end';
  connection: 'connecting' | 'connected' | 'disconnected' | 'closed'; mirrorOnly: boolean;
  position: number; playing: boolean; muted: boolean; speed: number; now: number; receivedAt: number;
  preferences: Preferences; voice: VoiceState;
};

export class PrivateMirror extends React.Component<{token: string}, State> {
  state: State = {story: null, playback: null, hold: null, moment: null, bridge: null, evidence: [], request: '', error: '', notice: '', busy: '',
    connection: 'connecting', mirrorOnly: false, position: 0, playing: false, muted: true, speed: 1, now: Date.now(), receivedAt: 0,
    preferences: readPreferences(), voice: 'idle'};
  private player = React.createRef<HTMLVideoElement>();
  private stream: EventSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: AbortController | null = null;
  private held: PersonalHold | null = null;
  private answerLanguage: Language = 'English';
  private slowerAnswer = false;
  private mounted = false;
  private voice = new Voice(() => this.player.current,
    voice => {if (this.mounted) this.setState({voice});},
    error => {if (this.mounted) this.setState({error});});
  private endpoint = (action = '') => `/api/private/${encodeURIComponent(this.props.token)}${action ? `/${action}` : ''}`;
  private fresh = () => this.state.connection === 'connected' && !!this.state.playback?.fresh && Date.now() - this.state.receivedAt <= 6000;

  componentDidMount() {
    this.mounted = true; this.connect();
    this.timer = setInterval(() => {
      if (!this.fresh()) this.player.current?.pause();
      this.setState({now: Date.now()});
    }, 1000);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.suspend);
  }
  componentWillUnmount() {
    this.mounted = false; this.cancel(); this.stream?.close();
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.suspend);
  }
  private cancel = () => {this.pending?.abort(); this.pending = null; this.voice.stop();};
  private suspend = () => {this.cancel(); this.player.current?.pause(); if (this.mounted) this.setState({busy: ''});};
  private visibility = () => {
    if (document.hidden) this.suspend();
    else if (this.state.connection !== 'closed') this.connect();
  };
  private connect = () => {
    this.suspend();
    this.setState({connection: 'connecting'});
    this.stream?.close();
    const stream = new EventSource(this.endpoint()); this.stream = stream;
    stream.onmessage = event => {
      if (!this.mounted || this.stream !== stream) return;
      try {
        const value = JSON.parse(event.data) as {type: string; story?: PersonalStory; playback?: Playback | null; hold?: PersonalHold | null;
          moment?: PersonalMoment; language?: Language; slower_answer_voice?: boolean};
        if (value.type === 'closed') {
          this.cancel(); this.player.current?.pause(); stream.close(); this.held = null;
          this.setState({connection: 'closed', story: null, hold: null, moment: null, bridge: null, busy: '', error: 'This phone connection ended. Pair again from the TV.'});
          return;
        }
        this.setState({connection: 'connected'});
        if (value.type === 'personal' && value.story) {
          const sameHold = value.hold?.id === this.held?.id;
          if (!sameHold) {this.cancel(); this.player.current?.pause();}
          this.held = value.hold ?? null;
          if (sameHold) this.setState({story: value.story, mirrorOnly: false, hold: this.held});
          else this.setState({story: value.story, mirrorOnly: false, hold: this.held, moment: null, bridge: null, evidence: [], request: '', busy: '', muted: true,
            position: this.held?.from_seconds ?? 0}, () => {if (this.held && this.player.current?.readyState) this.player.current.currentTime = this.held.from_seconds;});
          if (value.playback) this.receivePlayback(value.playback);
        }
        if (value.type === 'playback' && value.playback) this.receivePlayback(value.playback);
        if (value.type === 'ready') this.setState({mirrorOnly: true, moment: null, error: ''});
        if (value.type === 'moment' && value.moment) {
          this.voice.stop();
          this.answerLanguage = value.language ?? 'English'; this.slowerAnswer = Boolean(value.slower_answer_voice);
          this.setState({mirrorOnly: true, moment: value.moment, error: '', preferences: {...this.state.preferences,
            language: value.language ?? 'English', need: value.slower_answer_voice ? 'Slower answer voice' : 'Explain simply'}});
        }
      } catch {this.setState({error: 'The phone received an unreadable update. Reconnect and try again.'});}
    };
    stream.onerror = () => {
      if (!this.mounted || this.stream !== stream) return;
      this.suspend();
      if (this.state.mirrorOnly || stream.readyState === EventSource.CLOSED) {
        stream.close();
        this.held = null;
        this.setState({connection: 'closed', story: null, hold: null, moment: null, bridge: null, error: 'This phone connection is unavailable. Pair again from the TV.'});
      } else this.setState({connection: 'disconnected'});
      // EventSource reconnects and receives a complete snapshot. Never resume personal audio on reconnection.
    };
  };
  private receivePlayback = (playback: Playback) => {
    if (this.state.playback && playback.sequence < this.state.playback.sequence) return;
    if (this.held && (playback.epoch !== this.held.epoch || playback.content_version !== this.held.content_version)) {
      this.cancel(); this.player.current?.pause(); this.held = null;
      this.setState({hold: null, moment: null, bridge: null, evidence: [], request: '', busy: '', notice: 'The TV moved to a different point. Choose Pause for me again.'});
    }
    this.setState({playback, receivedAt: Date.now() - playback.age_ms, now: Date.now()}, this.enforceBoundary);
  };
  private preferences = (selection: Partial<Preferences>) => {
    this.voice.stop();
    const preferences = {...this.state.preferences, ...selection};
    savePreferences(preferences);
    // A changed recipient/language starts a new request, not a mismatched frozen clarification.
    if (this.state.moment?.state === 'clarification') this.setState({preferences, moment: null});
    else this.setState({preferences});
  };
  private post = async (action: string, body: object, pending: AbortController) => {
    const result = await personalRequest(this.endpoint(action), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: pending.signal},
      action === 'ask' || action === 'return' ? 45000 : 15000);
    if (!this.mounted || this.pending !== pending || pending.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return result;
  };
  private begin = (busy: State['busy']) => {
    this.cancel(); this.player.current?.pause();
    const pending = new AbortController(); this.pending = pending;
    this.setState({busy, error: '', notice: ''});
    return pending;
  };
  private failed = (error: unknown, pending: AbortController) => {
    if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
    // A lost response may still have committed a hold/end. Recover the server's actual branch.
    const reconcile = this.state.busy === 'hold' || this.state.busy === 'end' || [409, 410].includes((error as {status?: number})?.status ?? 0);
    this.pending = null;
    this.setState({busy: '', error: error instanceof Error ? error.message : 'The connection failed. Try again.'});
    if (reconcile) this.connect();
  };
  private hold = async (from?: number) => {
    const playback = this.state.playback;
    if (!playback || !this.fresh()) return;
    const pending = this.begin('hold');
    try {
      const result = await this.post('hold', {content_version: playback.content_version, epoch: playback.epoch,
        ...(from === undefined ? {} : {from_seconds: from})}, pending) as {hold: PersonalHold; playback: Playback};
      if (this.state.playback && (this.state.playback.epoch !== result.hold.epoch || this.state.playback.content_version !== result.hold.content_version)) throw new Error('The TV moved while holding your place. Try Pause for me again.');
      this.held = result.hold; this.pending = null;
      this.setState({hold: result.hold, moment: null, bridge: null, evidence: [], request: '', busy: '', muted: true, position: result.hold.from_seconds}, () => {
        this.receivePlayback(result.playback);
        if (this.player.current?.readyState) this.player.current.currentTime = result.hold.from_seconds;
      });
    } catch (error) {this.failed(error, pending);}
  };
  private ask = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!this.held || !this.state.request.trim() || !this.fresh()) return;
    const {request, preferences, moment} = this.state;
    const clarification = !this.state.bridge && moment?.state === 'clarification';
    const at = clarification ? moment.grounding.at_seconds : this.player.current?.currentTime ?? this.state.position;
    const pending = this.begin('ask');
    try {
      const result = await this.post('ask', {branch_id: this.held.id, request: request.trim(), at_seconds: at,
        clarification, need: preferences.need, language: preferences.language, recipient: preferences.recipient}, pending) as {moment: PersonalMoment; evidence: Evidence[]};
      this.pending = null;
      this.answerLanguage = preferences.need === 'Translate' ? preferences.language : 'English';
      this.slowerAnswer = preferences.need === 'Slower answer voice';
      this.setState({moment: result.moment, evidence: result.evidence, bridge: null, request: '', busy: ''});
    } catch (error) {this.failed(error, pending);}
  };
  private bringBack = async () => {
    if (!this.held || !this.fresh()) return;
    const hold = this.held, {need, language, recipient} = this.state.preferences;
    const pending = this.begin('return');
    try {
      const result = await this.post('return', {branch_id: hold.id, content_version: hold.content_version, epoch: hold.epoch,
        from_seconds: hold.from_seconds, need, language, recipient}, pending) as ReturnResult;
      this.pending = null;
      this.answerLanguage = need === 'Translate' ? language : 'English'; this.slowerAnswer = need === 'Slower answer voice';
      this.setState({bridge: result, moment: result.moment, evidence: result.evidence, busy: ''});
    } catch (error) {this.failed(error, pending);}
  };
  private backToTV = async () => {
    if (!this.held) return;
    const id = this.held.id;
    const pending = this.begin('end');
    if (this.player.current) this.player.current.muted = true;
    try {
      await this.post('end', {branch_id: id}, pending);
      this.held = null; this.pending = null;
      this.setState({hold: null, moment: null, bridge: null, evidence: [], request: '', busy: '', muted: true,
        notice: 'Look back at the TV. Pause for me is here whenever you need it.'});
    } catch (error) {this.failed(error, pending);}
  };
  private enforceBoundary = () => {
    const player = this.player.current, playback = this.state.playback;
    if (!player || !playback) return;
    if (!this.fresh() || document.hidden) player.pause();
    if (player.currentTime > playback.at_seconds) {player.pause(); player.currentTime = playback.at_seconds;}
  };
  private replayChanged = () => {
    if (this.state.busy === 'hold' || this.state.busy === 'end') this.player.current?.pause();
    else {
      this.cancel();
      this.setState({busy: '', moment: null, bridge: null, evidence: [], request: ''});
    }
    this.enforceBoundary();
    this.setState({position: this.player.current?.currentTime ?? 0, playing: !this.player.current?.paused});
  };
  private replay = (at: number) => {
    const player = this.player.current;
    if (!player || !this.fresh()) return;
    this.cancel(); this.setState({busy: '', error: '', notice: ''});
    player.currentTime = Math.max(0, Math.min(this.state.playback!.at_seconds, at));
    player.play().catch(() => {if (this.mounted) this.setState({error: 'Tap Play in the video controls to start replay.'});});
  };
  private readAloud = () => {
    if (this.state.voice === 'speaking') return this.voice.stop();
    const {moment} = this.state;
    if (!moment) return;
    this.player.current?.pause();
    this.voice.speak(moment.life_connection.offered ? moment.life_connection.question : moment.answer,
      locale[this.answerLanguage], this.slowerAnswer);
  };
  private listen = () => {
    if (this.state.voice === 'listening') return this.voice.finishListening();
    this.player.current?.pause();
    this.voice.listen(locale[this.state.preferences.language], request => {if (this.mounted) this.setState({request});});
  };

  render() {
    const {story, playback, hold, moment, bridge, evidence, request, busy, error, notice, connection, mirrorOnly, position, playing, muted, speed, preferences, voice} = this.state;
    const fresh = this.fresh();
    const lastLine = story?.transcript.filter(line => line.end <= position).at(-1);
    const activeCaption = story?.transcript.some(line => line.start <= position && line.end > position);
    const status = connection === 'closed' ? 'Connection ended' : !fresh && !mirrorOnly ? 'Waiting for the TV' : playback ? `TV ${clock(playback.at_seconds)}${playback.play_state === 'paused' ? ' · Paused' : playback.play_state === 'ended' ? ' · Ended' : playback.play_state === 'buffering' ? ' · Loading' : ''}` : 'Private answers';
    const lag = bridge && playback ? Math.max(0, playback.at_seconds - bridge.through_seconds) : 0;
    return <main className="personal-app">
      <header className="personal-heading"><Brand/><span>{status}</span></header>
      {story && <p className="personal-title">{clean(story.title)}</p>}
      {connection === 'disconnected' && <p className="personal-note" role="status">Reconnecting. Personal playback is held.</p>}
      {!fresh && connection === 'connected' && !mirrorOnly && <p className="personal-note" role="status">Keep Selene open on the TV to update its position.</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p className="personal-note" role="status">{notice}</p>}
      {story && !hold && <section className="personal-start">
        <h1>Take a moment.</h1><p>Replay or ask here while everyone keeps watching.</p>
        <button className="primary" disabled={!fresh || !!busy} onClick={() => this.hold()}>{busy ? 'Holding…' : 'Pause for me'}</button>
        <p className="personal-note">Starts silent with captions. Audio is your choice.</p>
      </section>}
      {hold && story && <>
        <div className="personal-video">
          <video ref={this.player} src={story.video} controls playsInline muted={muted} preload="metadata" disableRemotePlayback aria-label={`${story.title} personal replay`}
            onLoadedMetadata={() => {if (this.player.current && this.held) {this.player.current.currentTime = this.held.from_seconds; this.player.current.playbackRate = speed;}}}
            onTimeUpdate={() => {this.enforceBoundary(); this.setState({position: this.player.current?.currentTime ?? 0});}}
            onSeeking={this.replayChanged} onPlay={this.replayChanged}
            onPause={() => this.setState({playing: false})} onRateChange={() => this.setState({speed: this.player.current?.playbackRate ?? 1})}
            onVolumeChange={() => this.setState({muted: this.player.current?.muted ?? true})}
            onError={() => this.setState({error: 'This video could not load. Keep the phone and TV connected to the Selene relay.'})}>
            <track key={story.content_version} kind="captions" label="Original captions" src={this.endpoint('captions')} default/>
          </video>
        </div>
        <div className="personal-position"><span>Your replay {clock(position)}</span><button className="text-button" disabled={!fresh || !!busy} onClick={() => this.replay(lastLine?.start ?? position - 10)}>{lastLine ? 'Replay last line' : 'Replay 10s'}</button></div>
        {!playing && !activeCaption && lastLine && <p className="personal-caption"><span>{clock(lastLine.start)}</span> {lastLine.text}</p>}
        {busy && <div className="personal-working" role="status"><span>{busy === 'return' ? 'Finding your way back…' : busy === 'ask' ? 'Preparing your answer…' : 'One moment…'}</span>{(busy === 'ask' || busy === 'return') && <button aria-label="Cancel request" onClick={() => {this.cancel(); this.setState({busy: ''});}}><Icon name="close"/></button>}</div>}
        {!busy && bridge && <p className="personal-note">{bridge.status === 'ready' ? 'Return covers' : 'Requested'} {clock(bridge.from_seconds)} to {clock(bridge.through_seconds)}{lag >= 2 ? `. TV is ${Math.floor(lag)}s further on.` : '.'}</p>}
        {!busy && !bridge && moment && <p className="personal-note">About your moment at {clock(moment.grounding.at_seconds)}</p>}
        {!busy && moment && <section className="personal-answer" aria-label={bridge ? 'Guided return' : 'Your answer'} aria-live="polite">
          {moment.visual.status === 'ready' && <div className="visual"><Visual compact key={moment.visual.svg + moment.visual.description} visual={moment.visual}/></div>}
          <p>{clean(moment.answer)}</p>
          {this.voice.canSpeak && <button className="text-button" onClick={this.readAloud} aria-label={voice === 'speaking' ? 'Stop reading' : 'Read answer aloud on this device'}>{voice === 'speaking' ? 'Stop' : 'Read'}</button>}
        </section>}
        {!busy && bridge?.status === 'unavailable' && <p>The recap could not be prepared. Replay the original from your saved place.</p>}
        {!busy && bridge?.status === 'no_gap' && <p>There was no gap at the sampled TV moment.</p>}
        {!busy && bridge?.status === 'insufficient_evidence' && !moment && <p>The available sources cannot explain this gap. Replay the original or ask someone watching with you.</p>}
        {!bridge && <form className="personal-question" onSubmit={this.ask}>
          <label className="sr-only" htmlFor="personal-question">{moment?.state === 'clarification' ? 'Answer the clarification' : 'Ask about your replay'}</label>
          <textarea id="personal-question" rows={1} maxLength={600} value={request} disabled={!!busy || voice === 'listening'} onChange={event => this.setState({request: event.target.value})} placeholder={moment?.state === 'clarification' ? 'Add the missing detail…' : 'Ask about this moment…'}/>
          <button className="primary" type="submit" disabled={!!busy || !fresh || !request.trim() || voice === 'listening'} aria-label="Send question"><Icon name="send"/></button>
          {this.voice.Recognition && <button type="button" disabled={!!busy} onClick={this.listen} aria-label={voice === 'listening' ? 'Finish listening' : 'Use voice'}><Icon name="mic"/></button>}
        </form>}
        {voice === 'listening' && <p className="personal-note" role="status">Listening. Review your words before sending.</p>}
        <div className="personal-actions">
          {bridge ? <><button className="primary" disabled={!!busy} onClick={this.backToTV}>Back to TV</button><button disabled={!fresh || !!busy} onClick={() => {const at = bridge.status === 'ready' ? bridge.through_seconds : hold.from_seconds; this.setState({bridge: null, moment: null, evidence: []}, () => this.replay(at));}}>Replay from here</button></>
            : <button className="primary" disabled={!fresh || !!busy} onClick={this.bringBack}>Bring me back</button>}
        </div>
        <details className="personal-options"><summary>Your pace and preferences</summary>
          <label>Replay speed<select value={speed} onChange={event => {if (this.player.current) this.player.current.playbackRate = Number(event.target.value);}}>{[0.75, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
          <p className="personal-note">Use the video's audio control for original sound. Headphones keep it personal. Slower replay can leave you further behind.</p>
          <label>Answer style<select disabled={!!busy} value={preferences.need} onChange={event => this.preferences({need: event.target.value as Need})}>{needs.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Language<select disabled={!!busy} value={preferences.language} onChange={event => this.preferences({language: event.target.value as Language})}>{languages.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Explain for<select disabled={!!busy} value={preferences.recipient} onChange={event => this.preferences({recipient: event.target.value as Recipient})}>{recipients.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <p className="personal-note">Last followed: {clock(hold.from_seconds)}. Choose the point you understood; replay alone does not change it.</p>
          <button disabled={!fresh || !!busy} onClick={() => this.hold(this.player.current?.currentTime ?? position)}>I followed up to {clock(position)}</button>
          <button disabled={!!busy} onClick={this.backToTV}>Close personal replay</button>
        </details>
        {!!evidence.length && <details className="personal-sources"><summary>Sources for this answer</summary>{evidence.map(item => <p key={item.id}><span>{clock(item.at_seconds)} · {item.source === 'model_observation' ? 'Sampled image, may be inaccurate' : item.source === 'authored_demo' ? 'Authored demo fact' : 'Original caption'}</span>{item.text}</p>)}</details>}
        {story.ingestion && <p className="personal-credit">{story.ingestion.credit}</p>}
      </>}
      {mirrorOnly && <section className="personal-start">
        {moment ? <><div className="personal-answer">{moment.visual.status === 'ready' && <div className="visual"><Visual compact visual={moment.visual}/></div>}<p>{clean(moment.life_connection.offered ? moment.life_connection.question : moment.answer)}</p></div>{this.voice.canSpeak && <button onClick={this.readAloud}>{voice === 'speaking' ? 'Stop reading' : 'Read aloud'}</button>}</> : <p>Selected TV answers appear here.</p>}
        <p className="personal-note">This connected player shares answers only. Personal replay needs an available film source.</p>
      </section>}
      {connection === 'closed' && <a href="/?join=1">Enter a new TV code</a>}
    </main>;
  }
}

export function JoinPhone() {
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const pending = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => pending.current?.abort(), []);
  const join = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError('');
    try {
      const result = await personalRequest('/api/private/join', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: code.replace(/\s/g, '')}), signal: controller.signal});
      if (!controller.signal.aborted) window.location.replace(`/?private=${encodeURIComponent(result.token)}`);
    } catch (failure) {if (!controller.signal.aborted) {setError(failure instanceof Error ? failure.message : 'The connection failed. Try again.'); setBusy(false);}}
  };
  return <main className="personal-app"><header className="personal-heading"><Brand/></header><section className="personal-start"><h1>Your own pace.</h1><p>On the TV, open Selene tools, then Pair phone.</p>
    <form className="personal-join" onSubmit={join}><label htmlFor="tv-code">TV code</label><input autoFocus id="tv-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code} onChange={event => setCode(event.target.value)} placeholder="123 456"/><button className="primary" disabled={busy || !/^\d{6}$/.test(code.replace(/\s/g, ''))}>{busy ? 'Connecting…' : 'Connect'}</button></form>
    {error && <p role="alert">{error}</p>}</section></main>;
}
