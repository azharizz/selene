import {randomUUID} from 'node:crypto';
import {getStory} from './context.mjs';
import {playbackSnapshot} from './personal.mjs';
import {conversationContext, conversationRound} from './conversation.mjs';

const MIN_CHECK_MS = 30000;
const COOLDOWN_MS = 10 * 60000;
const scopeOf = playback => `${playback.content_id}:${playback.content_version}:${playback.epoch}`;
const lifecycleOf = playback => `${playback.play_state}:${playback.playback_rate}`;
const evidenceAt = (session, playback) => {
  const story = getStory(session.contentId);
  return `${story?.transcript.filter(cue => cue.end <= playback.at_seconds).at(-1)?.id ?? ''}:${story?.facts.filter(fact => fact.available_at <= playback.at_seconds).at(-1)?.id ?? ''}`;
};
const breakHintAt = (session, playback) => {
  const story = getStory(session.contentId);
  // This only brings a check forward; the agent still verifies the break and its meaning.
  return [...(story?.transcript ?? []), ...(story?.facts ?? [])].filter(item =>
    (item.end ?? item.available_at) <= playback.at_seconds && /\b(?:half[ -]?time|full[ -]?time|final whistle|end of (?:the )?(?:first|second) half|closing credits)\b/i.test(item.text ?? item.explanation ?? '')).at(-1)?.id ?? null;
};

export function closeConversationSchedule(session) {
  const state = session.mirror?.conversation;
  if (!state) return;
  state.closed = true; state.controller?.abort(); state.clearTimer(state.timer);
  delete session.mirror.conversation;
}

export function interruptConversation(session) {
  const state = session.mirror?.conversation;
  if (!state?.controller) return;
  state.controller.abort(); state.due = state.now() + MIN_CHECK_MS; state.reason = 'viewer_finished';
}

export function currentConversation(session, now = Date.now()) {
  const state = session.mirror?.conversation, playback = playbackSnapshot(session, now);
  return state?.latest && playback?.fresh && state.scope === scopeOf(playback) ? state.latest : null;
}

// The relay owns one ephemeral timer per opened pairing, independent of browser suspension.
export function updateConversationSchedule(session, hooks = {}) {
  const {now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, round = conversationRound,
    publish = () => {}, acquire = () => () => {}} = hooks;
  const mirror = session.mirror, playback = playbackSnapshot(session, now());
  if (!session.contentId || !mirror) return;
  let state = mirror.conversation;
  if (!state && !hooks.connected) return;
  if (!state) {
    state = mirror.conversation = {scope: null, lifecycle: null, timer: null, controller: null, latest: null,
      due: now(), target: null, reason: 'initial', failures: 0, waitEvidence: null, shown: [], lastShown: null, breakHint: null,
      closed: false, now, clearTimer};
  }
  clearTimer(state.timer); state.timer = null;
  const valid = () => !state.closed && session.mirror === mirror && mirror.conversation === state;
  const wake = delay => {
    state.timer = setTimer(() => {state.timer = null; updateConversationSchedule(session, hooks);}, Math.max(1, delay));
    state.timer?.unref?.();
  };
  if (!playback?.fresh) return; // The next accepted TV report resumes a due check.
  const scope = scopeOf(playback), lifecycle = lifecycleOf(playback), evidence = evidenceAt(session, playback), breakHint = breakHintAt(session, playback);
  if (state.scope !== scope) {
    const hadOptions = state.latest !== null;
    state.controller?.abort(); state.scope = scope; state.lifecycle = lifecycle; state.breakHint = breakHint;
    state.latest = null; state.target = null; state.shown = []; state.lastShown = null;
    state.failures = 0; state.waitEvidence = null; state.due = now(); state.reason = 'timeline_changed';
    if (hadOptions) publish({type: 'conversation', conversation: null});
  } else if (state.lifecycle !== lifecycle) {
    state.controller?.abort(); state.lifecycle = lifecycle; state.target = null;
    state.failures = 0; state.waitEvidence = null; state.due = now(); state.reason = 'playback_changed';
  } else if (breakHint && breakHint !== state.breakHint) {
    state.controller?.abort();
    state.target = null; state.waitEvidence = null; state.failures = 0;
    state.due = Math.min(state.due, now() + MIN_CHECK_MS); state.reason = 'possible_break';
  }
  state.breakHint = breakHint;
  if (state.controller) return;
  if (state.waitEvidence !== null) {
    if (state.waitEvidence === evidence) return;
    state.waitEvidence = null; state.failures = 0;
  }
  if (state.shown.includes('ending:ended') && playback.play_state === 'ended') return;
  if (state.target !== null) {
    if (playback.at_seconds < state.target) {
      if (playback.play_state === 'playing') wake(Math.max(MIN_CHECK_MS, (state.target - playback.at_seconds) / playback.playback_rate * 1000));
      return;
    }
    state.target = null;
  }
  if (now() < state.due) {wake(state.due - now()); return;}
  if (session.controller || session.skillsInFlight || mirror.controller) {state.due = now() + MIN_CHECK_MS; wake(MIN_CHECK_MS); return;}
  const controller = new AbortController(), release = acquire(controller);
  if (!release) {state.due = now() + MIN_CHECK_MS; wake(MIN_CHECK_MS); return;}
  state.controller = controller;
  const current = () => {
    const latest = playbackSnapshot(session, now());
    return valid() && !controller.signal.aborted && latest?.fresh && scopeOf(latest) === scope && lifecycleOf(latest) === lifecycle;
  };
  const earliest = state.lastShown === null ? 0 : state.lastShown + COOLDOWN_MS;
  void (async () => {
    try {
      const result = await round(() => current() ? conversationContext(session, now()) : null,
        {signal: controller.signal, reason: state.reason, recentlyShown: [...state.shown], earliestShowAt: earliest});
      if (!current()) return;
      state.reason = 'scheduled_wake'; state.due = now() + MIN_CHECK_MS;
      if (result.action === 'schedule') {
        if (!Number.isFinite(result.at_seconds) || result.at_seconds > session.duration || result.at_seconds <= playback.at_seconds)
          throw new Error('Invalid wake target');
        state.target = result.at_seconds;
      } else if (result.action === 'show') {
        const key = `${result.opportunity}:${result.boundary_id}`;
        if (result.content_id !== playback.content_id || result.content_version !== playback.content_version || result.epoch !== playback.epoch)
          throw new Error('Changed invitation scope');
        if (!Number.isFinite(result.at_seconds) || result.at_seconds > session.playback.at_seconds) throw new Error('Future invitation');
        if (state.shown.includes(key) || (result.opportunity !== 'ending' && now() < earliest)) {
          state.due = Math.max(state.due, earliest); state.waitEvidence = evidence;
          return;
        }
        const {action, ...content} = result;
        state.latest = {id: randomUUID(), ...content};
        state.shown = [...state.shown, key].slice(-32); state.lastShown = now();
        state.due = now() + COOLDOWN_MS; state.waitEvidence = evidence;
        publish({type: 'conversation', conversation: state.latest});
      } else state.waitEvidence = evidence;
      state.failures = 0;
    } catch {
      if (current()) {
        state.failures++;
        state.due = now() + 60000;
        if (state.failures >= 2) state.waitEvidence = evidence;
      }
    } finally {
      release();
      if (state.controller === controller) state.controller = null;
      if (valid()) {
        // Re-enter on a later turn so an already-resolved provider cannot recurse synchronously.
        wake(Math.max(1, state.due - now()));
      }
    }
  })();
}
