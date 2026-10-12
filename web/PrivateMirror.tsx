import React from 'react';
import {Visual} from './Visual';
import {Voice, type VoiceState} from './voice';
import {Brand, Icon} from './Brand';
import type {Language} from './preferences';
import {clock, audienceLabel, personalRequest, type PersonalStory, type Playback, type PersonalHold, type PersonalMoment, type ReturnResult, type PersonalHelp, type FollowedThread, type ConversationOptions} from './personal';

const locale = {English: 'en-US', Indonesian: 'id-ID', Spanish: 'es-ES'};
const clean = (text: string) => text.replace(/\u2014/g, ',');
const THREAD_POLL_MS = 5000;
// The question carries any explicitly volunteered audience or style needs.
const explanation = {need: 'Show visually', language: 'English', recipient: 'everyone'};
type State = {
  story: PersonalStory | null; playback: Playback | null; hold: PersonalHold | null;
  moment: PersonalMoment | null; bridge: ReturnResult | null;
  help: PersonalHelp | null; thread: FollowedThread | null; threadNotice: string;
  request: string; error: string; notice: string; busy: '' | 'ask' | 'return' | 'end' | 'follow';
  connection: 'connecting' | 'connected' | 'disconnected' | 'closed'; mirrorOnly: boolean;
  selected: number | null; pickingTime: boolean; now: number; receivedAt: number; voice: VoiceState;
  reply: {tool: string; text: string} | null;
  conversation: ConversationOptions | null;
};
// The simulated Alexa+ orchestrator answers quick skills directly; explanations stay on this private path.
type AssistantResult = {tool: string; text: string; delegate?: boolean};

export class PrivateMirror extends React.Component<{token: string}, State> {
  state: State = {story: null, playback: null, hold: null, moment: null, bridge: null, help: null, thread: null, threadNotice: '', request: '', error: '', notice: '', busy: '',
    connection: 'connecting', mirrorOnly: false, selected: null, pickingTime: false, now: Date.now(), receivedAt: 0, voice: 'idle', reply: null, conversation: null};
  private stream: EventSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: AbortController | null = null;
  private threadPending: AbortController | null = null;
  private queuedThread: FollowedThread | null = null;
  private queuedConversation: ConversationOptions | null = null;
  private dismissedConversation: string | null = null;
  private nextThreadCheck = 0;
  private editing = false;
  private questionAt: number | null = null;
  private requesterId: string | undefined;
  private newTopic = false;
  private held: PersonalHold | null = null;
  private answerLanguage: Language = 'English';
  private slowerAnswer = false;
  private mounted = false;
  private voice = new Voice(() => null,
    voice => {if (this.mounted) this.setState({voice}, this.flushThread);},
    error => {if (this.mounted) this.setState({error});});
  private endpoint = (action = '') => `/api/private/${encodeURIComponent(this.props.token)}${action ? `/${action}` : ''}`;
  private fresh = () => this.state.connection === 'connected' && !!this.state.playback?.fresh && Date.now() - this.state.receivedAt <= 6000;

  componentDidMount() {
    this.mounted = true; this.connect();
    this.timer = setInterval(() => {this.setState({now: Date.now()}); this.flushThread(); this.flushConversation(); void this.checkThread();}, 1000);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.suspend);
  }
  componentWillUnmount() {
    this.mounted = false; this.cancel(); this.stream?.close();
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.suspend);
  }
  private cancelThreadCheck = () => {this.threadPending?.abort(); this.threadPending = null;};
  private cancel = () => {this.pending?.abort(); this.pending = null; this.cancelThreadCheck(); this.voice.stop();};
  private suspend = () => {this.cancel(); if (this.mounted) this.setState({busy: ''});};
  private visibility = () => {
    if (document.hidden) this.suspend();
    else if (this.state.connection !== 'closed') this.connect();
  };
  private connect = () => {
    this.queuedThread = null; this.queuedConversation = null;
    this.suspend(); this.setState({connection: 'connecting'}); this.stream?.close();
    const stream = new EventSource(this.endpoint()); this.stream = stream;
    stream.onmessage = event => {
      if (!this.mounted || this.stream !== stream) return;
      try {
        const value = JSON.parse(event.data) as {type: string; story?: PersonalStory; playback?: Playback | null; hold?: PersonalHold | null;
          moment?: PersonalMoment; language?: Language; slower_answer_voice?: boolean;
          help?: PersonalHelp | null; bridge?: ReturnResult | null; thread?: FollowedThread | null; conversation?: ConversationOptions | null};
        if (value.type === 'closed') {
          this.queuedThread = null; this.queuedConversation = null; this.cancel(); stream.close(); this.held = null; this.questionAt = null;
          this.requesterId = undefined;
          this.setState({connection: 'closed', conversation: null, story: null, playback: null, hold: null, moment: null, bridge: null, help: null, thread: null, threadNotice: '', busy: '',
            error: 'This phone connection ended. Pair again from the TV.'});
          return;
        }
        this.setState({connection: 'connected'});
        if (value.type === 'personal' && value.story) {
          const sameHold = value.hold?.id === this.held?.id;
          const preserveRequest = sameHold && !!this.pending;
          const deferThread = sameHold && !!value.thread && value.thread.id === this.state.thread?.id
            && value.thread.revision > this.state.thread.revision && !this.threadCanDisplay();
          if (!sameHold) this.cancel();
          this.held = value.hold ?? null;
          if (sameHold) this.setState({story: value.story, mirrorOnly: false, hold: this.held});
          else this.setState({story: value.story, mirrorOnly: false, hold: this.held, moment: null, bridge: null, busy: '', selected: null, pickingTime: false});
          if (!preserveRequest && !deferThread) {
            this.questionAt = this.held?.question_at_seconds ?? value.help?.at_seconds ?? null;
            this.newTopic = false; this.queuedThread = null;
          }
          if (deferThread) this.queuedThread = value.thread!;
          if ('help' in value && !preserveRequest && !deferThread) {
            const help = value.thread && (!value.help || value.thread.help.at_seconds > value.help.at_seconds) ? value.thread.help : value.help;
            if (!value.bridge && help) {this.questionAt = help.at_seconds; this.newTopic = !value.thread && this.held?.question_at_seconds !== help.at_seconds;}
            this.setState({help: value.bridge ? null : help ?? null, bridge: value.bridge ?? null, thread: value.thread ?? null,
              moment: value.bridge?.moment ?? help?.moment ?? null, threadNotice: '', busy: ''});
          }
          if (value.playback) this.receivePlayback(value.playback);
          this.receiveConversation(value.conversation ?? null);
        }
        if (value.type === 'conversation') this.receiveConversation(value.conversation ?? null);
        if (value.type === 'playback' && value.playback) this.receivePlayback(value.playback);
        if (value.type === 'ready') this.setState({mirrorOnly: true, moment: null, error: ''});
        if (value.type === 'moment' && value.moment) {
          this.voice.stop(); this.answerLanguage = value.language ?? 'English'; this.slowerAnswer = Boolean(value.slower_answer_voice);
          this.setState({mirrorOnly: true, moment: value.moment, error: ''});
        }
      } catch {this.setState({error: 'The phone received an unreadable update. Reconnect and try again.'});}
    };
    stream.onerror = () => {
      if (!this.mounted || this.stream !== stream) return;
      this.suspend();
      if (this.state.mirrorOnly || stream.readyState === EventSource.CLOSED) {
        stream.close(); this.held = null; this.queuedConversation = null;
        this.queuedThread = null; this.questionAt = null;
        this.setState({connection: 'closed', conversation: null, story: null, playback: null, hold: null, moment: null, bridge: null, help: null, thread: null, threadNotice: '',
          error: 'This phone connection is unavailable. Pair again from the TV.'});
      } else this.setState({connection: 'disconnected'});
      // EventSource reconnects with the actual branch and latest sampled position.
    };
  };
  private receivePlayback = (playback: Playback) => {
    const previous = this.state.playback;
    if (previous && playback.sequence < previous.sequence) return;
    if ((previous && (playback.epoch !== previous.epoch || playback.content_version !== previous.content_version)) ||
        (this.held && (playback.epoch !== this.held.epoch || playback.content_version !== this.held.content_version)) ||
        (this.state.thread && (playback.epoch !== this.state.thread.epoch || playback.content_version !== this.state.thread.content_version))) {
      this.requesterId = undefined;
      this.queuedConversation = null; this.dismissedConversation = null;
      this.queuedThread = null; this.cancel(); this.held = null; this.questionAt = null; this.newTopic = false;
      this.setState({conversation: null, hold: null, moment: null, bridge: null, help: null, thread: null, threadNotice: '', selected: null, pickingTime: false, busy: '',
        notice: 'The TV moved. Your next question will use its current moment.'});
    }
    this.setState({playback, receivedAt: Date.now() - playback.age_ms, now: Date.now()});
  };
  private receiveConversation = (conversation: ConversationOptions | null) => {
    if (!conversation) {this.queuedConversation = null; this.setState({conversation: null}); return;}
    if (conversation.id === this.dismissedConversation || conversation.id === this.state.conversation?.id) return;
    this.queuedConversation = conversation;
    // Flush on the next tick, after React has applied the accompanying playback/bootstrap state.
  };
  private flushConversation = () => {
    const next = this.queuedConversation, playback = this.state.playback;
    if (!next || !playback || !this.fresh()) return;
    if (next.content_id !== playback.content_id || next.content_version !== playback.content_version || next.epoch !== playback.epoch) {
      this.queuedConversation = null; return;
    }
    if (document.hidden || this.pending || this.threadPending || this.state.busy || this.editing || this.state.request.trim()
      || this.state.voice !== 'idle' || this.state.pickingTime || this.state.selected !== null) return;
    this.queuedConversation = null;
    this.setState({conversation: next});
  };
  private chooseMoment = (selected: number | null) => {
    this.requesterId = undefined;
    this.queuedThread = null; this.cancel(); this.questionAt = selected; this.newTopic = true;
    this.setState({selected: selected === null ? null : Math.max(0, Math.min(this.state.playback?.at_seconds ?? 0, selected)),
      moment: null, help: null, bridge: null, busy: '', error: '', notice: ''});
  };
  private post = async (action: string, body: object, pending: AbortController) => {
    const result = await personalRequest(this.endpoint(action), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: pending.signal},
      action === 'ask' ? 195000 : action === 'return' ? 45000 : 15000);
    if (!this.mounted || this.pending !== pending || pending.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return result;
  };
  private begin = (busy: State['busy']) => {
    this.pending?.abort(); this.cancelThreadCheck();
    const pending = new AbortController(); this.pending = pending;
    this.setState({busy, error: '', notice: '', pickingTime: false});
    this.voice.stop(); return pending;
  };
  private failed = (error: unknown, pending: AbortController) => {
    if (!this.mounted || this.pending !== pending || pending.signal.aborted) return;
    const reconcile = !this.held || ['end', 'return', 'follow'].includes(this.state.busy) || [409, 410].includes((error as {status?: number})?.status ?? 0);
    this.pending = null; this.setState({busy: '', error: error instanceof Error ? error.message : 'The connection failed. Try again.'});
    if (reconcile) this.connect();
  };
  private sample = (playback: Playback) => ({content_version: playback.content_version, epoch: playback.epoch, sequence: playback.sequence, at_seconds: playback.at_seconds});
  private ensureHold = async (playback: Playback, pending: AbortController, from = playback.at_seconds) => {
    if (this.held) return this.held;
    const result = await this.post('hold', {...this.sample(playback), from_seconds: from}, pending) as {hold: PersonalHold; playback: Playback};
    if (!this.state.playback || this.state.playback.epoch !== result.hold.epoch || this.state.playback.content_version !== result.hold.content_version)
      throw new Error('The TV moved while saving this moment. Ask again.');
    this.held = result.hold; this.setState({hold: result.hold}); this.receivePlayback(result.playback);
    return result.hold;
  };
  private ask = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!this.state.request.trim() || !this.fresh() || this.state.busy || this.state.voice === 'listening' || this.state.voice === 'processing') return;
    const {request, moment, selected, playback} = this.state;
    const clarification = !this.state.bridge && moment?.state === 'clarification';
    // Use an observed position. Wall-clock time never extends the source boundary.
    const at = clarification ? moment.grounding.at_seconds : selected ?? this.questionAt ?? playback!.at_seconds;
    const newTopic = !clarification && (this.newTopic || this.questionAt === null);
    const pending = this.begin('ask');
    try {
      if (!clarification && selected === null) {
        // If the orchestrator is unavailable, the question still gets the private explanation below.
        const routed = await this.post('assistant', {request: request.trim(), requester_id: this.requesterId}, pending)
          .catch(error => {if (pending.signal.aborted || this.pending !== pending) throw error; return null;}) as AssistantResult | null;
        if (routed?.tool && !routed.delegate) {this.pending = null; this.requesterId = undefined; this.setState({busy: '', request: '', reply: {tool: routed.tool, text: routed.text}}); return;}
      }
      const hold = await this.ensureHold(playback!, pending);
      const result = await this.post('ask', {branch_id: hold.id, request: request.trim(), requester_id: this.requesterId, at_seconds: at, clarification, new_topic: newTopic, ...explanation}, pending) as PersonalHelp & {hold: PersonalHold; thread: FollowedThread | null};
      this.pending = null; this.requesterId = undefined; this.answerLanguage = 'English'; this.slowerAnswer = false;
      this.held = result.hold ?? {...hold, question_at_seconds: at}; this.questionAt = at; this.newTopic = false; this.queuedThread = null;
      this.setState({moment: result.moment, help: result, hold: this.held, thread: result.thread ?? null, threadNotice: '', bridge: null, mirrorOnly: false, request: '', busy: '', reply: null});
    } catch (error) {this.failed(error, pending);}
  };
  private bringBack = async () => {
    if (!this.fresh() || this.state.busy) return;
    const playback = this.state.playback!;
    const from = this.held?.from_seconds ?? this.state.selected ?? playback.at_seconds;
    const pending = this.begin('return');
    try {
      const hold = await this.ensureHold(playback, pending, from);
      const result = await this.post('return', {branch_id: hold.id, content_version: hold.content_version, epoch: hold.epoch,
        from_seconds: hold.from_seconds, sequence: playback.sequence, through_seconds: playback.at_seconds, ...explanation}, pending) as ReturnResult;
      this.pending = null; this.answerLanguage = 'English'; this.slowerAnswer = false;
      const complete = ['ready', 'no_gap'].includes(result.status);
      if (complete) {this.held = null; this.questionAt = null; this.newTopic = false; this.queuedThread = null;}
      this.setState({bridge: result, moment: result.moment, help: null, busy: '', hold: this.held, selected: complete ? null : this.state.selected});
    } catch (error) {this.failed(error, pending);}
  };
  private backToTV = async () => {
    if (!this.held) {
      if (this.state.thread) {await this.toggleThread(); if (this.state.thread) return;}
      this.chooseMoment(null); this.setState({pickingTime: false}); return;
    }
    const id = this.held.id, pending = this.begin('end');
    try {
      await this.post('end', {branch_id: id}, pending);
      this.held = null; this.pending = null; this.questionAt = null; this.newTopic = false; this.queuedThread = null;
      this.setState({hold: null, moment: null, bridge: null, help: null, thread: null, threadNotice: '', selected: null, request: '', busy: ''});
    } catch (error) {this.failed(error, pending);}
  };
  private readAloud = () => {
    if (this.state.voice === 'speaking') return this.voice.stop();
    const {moment} = this.state;
    if (moment) this.voice.speak([moment.answer, moment.visual.status === 'ready' ? moment.visual.description : ''].filter(Boolean).join(' '), locale[this.answerLanguage], this.slowerAnswer);
  };
  private listen = () => {
    if (this.state.voice === 'listening') return this.voice.finishListening();
    if (this.state.voice === 'processing' || this.state.busy || !this.fresh()) return;
    this.requesterId = undefined; this.setState({error: ''});
    this.voice.listen(this.endpoint('voice'), {}, result => {
      if (!this.mounted || !this.fresh()) return;
      this.requesterId = result.match === 'matched' ? result.requester?.id : undefined;
      this.setState({request: result.transcript});
    });
  };

  private toggleThread = async () => {
    if (this.state.busy || (!this.state.thread && !this.fresh())) return;
    const answerId = this.state.thread?.answer_id ?? this.state.help?.id;
    if (!answerId) return;
    const enabled = !this.state.thread, pending = this.begin('follow');
    try {
      const result = await this.post('thread', {enabled, answer_id: answerId}, pending) as {thread: FollowedThread | null};
      this.pending = null; this.queuedThread = null; this.nextThreadCheck = 0;
      this.setState({thread: result.thread, threadNotice: '', busy: '', selected: enabled ? null : this.state.selected, pickingTime: enabled ? false : this.state.pickingTime});
    } catch (error) {this.failed(error, pending);}
  };

  private threadCanDisplay = () => !document.hidden && this.fresh() && !this.pending && !this.state.busy && !this.editing
    && !this.state.request.trim() && this.state.voice === 'idle' && !this.state.pickingTime && this.state.selected === null && !this.state.bridge;
  private flushThread = () => {
    const next = this.queuedThread;
    if (!next || next.id !== this.state.thread?.id || !this.threadCanDisplay()) return;
    this.queuedThread = null; this.questionAt = next.help.at_seconds; this.newTopic = false;
    this.setState({thread: next, moment: next.help.moment, help: next.help, threadNotice: ''});
  };
  private checkThread = async () => {
    const {thread, playback} = this.state;
    if (!thread || !playback || this.threadPending || !this.threadCanDisplay() || (this.newTopic && !this.state.help) || Date.now() < this.nextThreadCheck
      || playback.at_seconds <= thread.checked_through_seconds) return;
    const pending = new AbortController(); this.threadPending = pending; this.nextThreadCheck = Date.now() + THREAD_POLL_MS;
    try {
      const result = await personalRequest(this.endpoint('thread-check'), {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(this.sample(playback)), signal: pending.signal}, 185000) as {thread: FollowedThread | null; updated: boolean};
      if (!this.mounted || pending.signal.aborted || this.threadPending !== pending || this.state.thread?.id !== thread.id) return;
      this.threadPending = null;
      if (!result.thread) {this.queuedThread = null; this.setState({thread: null, threadNotice: ''}); return;}
      if (result.thread.revision > this.state.thread.revision) {this.queuedThread = result.thread; this.flushThread();}
      else this.setState({thread: result.thread, threadNotice: ''});
    } catch (error) {
      if (this.mounted && !pending.signal.aborted && this.threadPending === pending) {
        this.threadPending = null;
        if ([409, 410].includes((error as {status?: number})?.status ?? 0)) this.connect();
        else this.setState({threadNotice: 'Thread update unavailable. Will retry while you follow.'});
      }
    }
  };

  render() {
    const {story, playback, hold, moment, bridge, help, thread, threadNotice, request, busy, error, notice, connection, mirrorOnly, selected, pickingTime, voice} = this.state;
    const fresh = this.fresh();
    const at = selected ?? playback?.at_seconds ?? moment?.grounding.at_seconds;
    const state = connection === 'closed' ? 'Connection ended' : connection === 'connecting' ? 'Connecting to TV' : !fresh && !mirrorOnly ? 'Waiting for TV' :
      playback?.play_state === 'ended' ? 'Film ended' : playback?.play_state === 'paused' ? 'TV paused' : playback?.play_state === 'buffering' ? 'TV buffering' : mirrorOnly ? 'Shared from TV' : 'Following TV';
    const from = hold?.from_seconds ?? selected;
    const canReturn = from !== undefined && from !== null && playback && playback.at_seconds - from >= .25;
    return <main className="personal-app personal-viewing">
      <header className="personal-heading"><Brand/>{story && <p className="personal-title">{clean(story.title)}</p>}</header>
      <section className="personal-time" aria-label="TV moment">
        <div className="personal-playback">
          <p>{selected !== null ? `Selected moment · TV ${clock(playback?.at_seconds ?? 0)}` : state}</p>
          <button className="personal-clock" disabled={!story || !!busy || !fresh || mirrorOnly} aria-label="Choose a moment" aria-expanded={pickingTime}
            onClick={() => this.setState({pickingTime: !pickingTime})}>
            <span>{at === undefined ? '0:00' : clock(at)}</span>
            {story && fresh && !mirrorOnly && <span className="time-hint">Look back</span>}
          </button>
        </div>
        {pickingTime && playback && <div className="personal-time-picker">
          <label className="sr-only" htmlFor="personal-time">Moment to explain</label>
          <input id="personal-time" type="range" min="0" max={playback.at_seconds} step="1" value={selected ?? playback.at_seconds}
            onChange={event => this.chooseMoment(Number(event.target.value))}/>
          <div><span>0:00</span><button type="button" className="text-button" onClick={this.backToTV}>Follow TV</button><span>{clock(playback.at_seconds)}</span></div>
        </div>}
      </section>
      {connection === 'disconnected' && <p className="personal-note" role="status">Reconnecting to the TV. Please wait.</p>}
      {!fresh && connection === 'connected' && !mirrorOnly && <p className="personal-note" role="status">Keep Selene open on the TV to update this moment.</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p className="personal-note" role="status">{notice}</p>}
      {this.state.conversation && fresh && !mirrorOnly && <section className="personal-conversation" aria-labelledby="conversation-heading">
        <div className="conversation-heading"><div><h2 id="conversation-heading">Something to talk about</h2>
          <p className="personal-note">From the moment at {clock(this.state.conversation.at_seconds)}</p></div>
          <button type="button" className="text-button" aria-label="Dismiss conversation ideas" onClick={() => {
            this.dismissedConversation = this.state.conversation!.id; this.setState({conversation: null});
          }}><Icon name="close"/></button></div>
        <ul>{this.state.conversation.options.map(option => <li key={option.id}>
          <h3>{option.angle}</h3><p>{option.question}</p>
        </li>)}</ul>
      </section>}
      {busy && <div className="personal-working" role="status"><span>{busy === 'return' ? 'Catching you up…' : busy === 'ask' ? 'Explaining this moment…' : busy === 'follow' ? 'Updating followed question…' : 'Following the TV…'}</span>
        <button aria-label="Cancel request" onClick={this.connect}><Icon name="close"/></button></div>}
      {moment && (!busy || busy === 'follow') && <section className="personal-answer" aria-label={bridge ? 'Guided return' : 'Your explanation'}>
        {moment.visual.status === 'ready' && <div className="visual"><Visual personal key={moment.visual.svg + moment.grounding.at_seconds} visual={moment.visual}/></div>}
        {help?.quote && <blockquote className="personal-quote"><p>{help.quote.text}</p><cite>Original caption · {clock(help.quote.at_seconds)}</cite></blockquote>}
        <p className="personal-answer-text" aria-live="polite">{clean(moment.answer)}</p>
        {moment.audience && (!bridge || bridge.status === 'ready') && <span className="audience-badge" aria-label={audienceLabel(moment.audience)}>{audienceLabel(moment.audience)}</span>}
        <div className="personal-answer-meta"><span>{bridge ? `${clock(bridge.from_seconds)} to ${clock(bridge.through_seconds)}` : `Explained at ${clock(moment.grounding.at_seconds)}`}</span></div>
        <div className="personal-answer-actions">
          {this.voice.canSpeak && <button type="button" className="personal-read" onClick={this.readAloud} aria-label={voice === 'speaking' ? 'Stop reading' : 'Read explanation aloud'}><Icon name="volume"/>{voice === 'speaking' ? 'Stop reading' : 'Read aloud'}</button>}
          {!mirrorOnly && (thread || (!bridge && help?.id && moment.state === 'response' && fresh)) && <button type="button" className="personal-follow"
            disabled={!!busy} aria-pressed={!!thread} aria-label={thread ? 'Stop following this thread' : 'Follow this thread'} onClick={this.toggleThread}><Icon name="follow"/>{thread ? bridge ? 'Thread paused' : 'Following thread' : 'Follow thread'}</button>}
        </div>
        {help?.evidence.filter(item => item.source === 'reference' && item.source_url).map(item => <p className="personal-reference" key={item.id}>
          General reference: <a href={item.source_url} target="_blank" rel="noopener noreferrer">{new URL(item.source_url!).hostname}</a></p>)}
      </section>}
      {this.state.reply && !busy && <section className="personal-answer" aria-label="Selene"><p className="personal-answer-text" aria-live="polite">{clean(this.state.reply.text)}</p></section>}
      {threadNotice && <p className="personal-note" role="status">{threadNotice}</p>}
      {!busy && bridge?.quote && <blockquote className="personal-quote"><p>{bridge.quote.text}</p><cite>Original caption · {clock(bridge.quote.at_seconds)}</cite></blockquote>}
      {!busy && bridge && bridge.status !== 'ready' && <p className="personal-note" role="status">{bridge.status === 'no_gap' ? 'No time has passed since that moment.' : bridge.status === 'unavailable' ? 'The recap could not be prepared. Try Catch me up again.' : 'There is not enough evidence to explain this gap. Ask about a specific moment.'}</p>}
      {story && connection !== 'closed' && <>
        {!moment && !busy && !bridge && !this.state.reply && <div className="personal-empty"><h1>What would you like explained?</h1><p>Ask in your own words, or try: Who is this? · What did I miss? · Pause the TV.</p></div>}
        <form className="personal-question" onSubmit={this.ask}>
          <label className="sr-only" htmlFor="personal-question">{moment?.state === 'clarification' ? 'Answer the clarification' : 'Ask about this moment'}</label>
          <textarea id="personal-question" rows={2} maxLength={600} value={request} disabled={!!busy || voice === 'listening' || voice === 'processing'}
            onFocus={() => {this.editing = true;}} onBlur={() => {this.editing = false; this.flushThread();}}
            onChange={event => {this.requesterId = undefined; this.setState({request: event.target.value});}}
            placeholder={moment?.state === 'clarification' ? 'Add the missing detail…' : 'Ask about this moment…'}/>
          <div className="personal-send">{this.voice.canListen && <button type="button" disabled={!!busy || !fresh || voice === 'processing'} onClick={this.listen} aria-label={voice === 'listening' ? 'Finish listening' : voice === 'processing' ? 'Processing voice' : 'Use voice'} aria-pressed={voice === 'listening'}><Icon name="mic"/></button>}
            <button className="primary" type="submit" disabled={!!busy || !fresh || !request.trim() || voice === 'listening' || voice === 'processing'} aria-label="Send question"><Icon name="send"/></button></div>
        </form>
        {(voice === 'listening' || voice === 'processing') && <p className="personal-note" role="status">{voice === 'processing' ? 'Transcribing and checking enrolled profiles…' : 'Listening. Review your words before sending.'}</p>}
        <p className="personal-note">Selene · simulated Alexa+ experience</p>
        {canReturn && <div className="personal-actions"><button type="button" className="text-button" disabled={!fresh || !!busy} onClick={this.bringBack}>Catch me up</button><span>From {clock(from!)}</span></div>}
        {story.ingestion && <footer className="personal-credit">{story.ingestion.credit}</footer>}
      </>}
      {mirrorOnly && !moment && <p className="personal-note">Answers you send from the TV appear here.</p>}
      {connection === 'closed' && <a className="personal-reconnect" href="/?join=1">Enter a new TV code</a>}
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
  return <main className="personal-app"><header className="personal-heading"><Brand/></header><section className="personal-start"><h1>Explain on your phone.</h1><p>On the TV, open Selene tools, then Pair phone.</p>
    <form className="personal-join" onSubmit={join}><label htmlFor="tv-code">TV code</label><input autoFocus id="tv-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code} onChange={event => setCode(event.target.value)} placeholder="123 456"/><button className="primary" disabled={busy || !/^\d{6}$/.test(code.replace(/\s/g, ''))}>{busy ? 'Connecting…' : 'Connect'}</button></form>
    {error && <p role="alert">{error}</p>}</section></main>;
}
