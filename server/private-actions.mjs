import {randomUUID} from 'node:crypto';
import {getStory, createMemory} from './context.mjs';
import {explain} from './agent.mjs';
import {validHold, validPersonalAsk, validPersonalReturn, validPersonalEnd, validPersonalThread, validThreadCheck} from './contract.mjs';
import {conflict, holdMoment, publicHold, requireHold, requirePlayback, requireSample, playbackSnapshot, personalContext, guidedReturn, evidenceFor, originalQuote} from './personal.mjs';
import {requesterContext} from './requester-context.mjs';
import {demoAudience, demoThreadUpdate, isDemoPreparedQuestion} from './demo-fixtures.mjs';

const validators = {hold: validHold, ask: validPersonalAsk, return: validPersonalReturn, end: validPersonalEnd, thread: validPersonalThread, 'thread-check': validThreadCheck};
export const THREAD_CHECK_MS = 15000;

export function validatePrivateAction(action, input) {
  if (!validators[action]?.(input)) throw conflict('Invalid private request', 400);
}

export function publicThread(thread) {
  if (!thread) return null;
  const {id, answer_id, question, help, revision, checked_through_seconds, content_version, epoch} = thread;
  return {id, answer_id, question, help, revision, checked_through_seconds, content_version, epoch};
}

export function privateState(session) {
  const mirror = session.mirror;
  return {hold: publicHold(mirror.hold), help: mirror.help ?? null, bridge: mirror.bridge ?? null, thread: publicThread(mirror.thread)};
}

const preferences = input => ({need: input.need, language: input.language, recipient: input.recipient,
  ...(input.answer_mode !== undefined ? {answer_mode: input.answer_mode} : {}),
  ...(input.communication_preferences !== undefined ? {communication_preferences: structuredClone(input.communication_preferences)} : {})});
const viewer = (story, at, request, prefs) => ({request, content_id: story.id, at_seconds: at, play_state: 'paused',
  playback_choice: 'keep_watching', ...prefs, session: 'solo', continuation: null});
const helpFor = (moment, context, request, id = randomUUID()) => ({id, request, at_seconds: context.at_seconds,
  moment, evidence: evidenceFor(moment, context), quote: originalQuote(moment, context)});

// The phone and optional MCP experiment share these actions and the same capability-scoped state.
export async function privateAction(session, action, input, {signal} = {}) {
  validatePrivateAction(action, input);
  if (!session.mirror) throw conflict('This phone connection has ended. Pair again on the TV.', 410);
  if (!session.contentId) throw conflict('This player only shares answers. Private questions need a permitted film source.');
  const mirror = session.mirror, story = getStory(session.contentId);
  const stillPaired = () => {
    signal?.throwIfAborted();
    if (session.mirror !== mirror) throw conflict('This phone connection has ended. Pair again on the TV.', 410);
  };
  if (action === 'hold') {
    const hold = holdMoment(session, input);
    mirror.controller?.abort(); mirror.hold = hold; mirror.bridge = null; mirror.help = null;
    return {hold: publicHold(hold), playback: playbackSnapshot(session)};
  }
  if (action === 'end') {
    if (mirror.hold && mirror.hold.id !== input.branch_id) throw conflict('That saved moment changed. Reconnect before closing it.');
    mirror.controller?.abort(); mirror.hold = null; mirror.help = null; mirror.bridge = null; mirror.thread = null;
    return {closed: true};
  }
  if (action === 'thread') {
    if (!input.enabled) {
      if (mirror.thread && mirror.thread.answer_id !== input.answer_id) throw conflict('The followed question changed. Reconnect and try again.');
      mirror.thread = null;
      return {thread: null};
    }
    const help = mirror.help;
    if (!help || help.id !== input.answer_id || help.moment.state !== 'response') throw conflict('Ask a question before following its explanation.');
    const playback = requirePlayback(session, session.contentVersion, session.playback?.epoch);
    if (mirror.thread?.answer_id === help.id) return {thread: publicThread(mirror.thread)};
    mirror.thread = {id: randomUUID(), answer_id: help.id, question: help.request, initial_request: mirror.hold?.initial_request ?? help.request,
      help, anchor_at_seconds: help.at_seconds, anchor_evidence_ids: [...help.moment.grounding.evidence_ids],
      checked_through_seconds: help.at_seconds, revision: 0, checked_at: 0, content_version: playback.content_version,
      requester: structuredClone(mirror.hold?.requester ?? null), preferences: mirror.hold?.requester?.source === 'fixture'
        ? mirror.hold.preferences : mirror.hold?.current_preferences ?? mirror.hold?.preferences ?? {need: 'Show visually', language: 'English', recipient: 'everyone'},
      epoch: playback.epoch, memory: {...createMemory(), lastExplanation: structuredClone(mirror.hold?.memory.lastExplanation ?? null)}};
    return {thread: publicThread(mirror.thread)};
  }
  if (action === 'thread-check') {
    const playback = requireSample(session, input, input.at_seconds), thread = mirror.thread;
    if (!thread) return {thread: null, updated: false};
    if (thread.content_version !== playback.content_version || thread.epoch !== playback.epoch) {
      mirror.thread = null; return {thread: null, updated: false};
    }
    if (playback.at_seconds <= thread.checked_through_seconds) return {thread: publicThread(thread), updated: false};
    const context = personalContext(story, playback.at_seconds,
      {...thread.memory.lastExplanation, request: thread.question, answer: thread.help.moment.answer, at_seconds: thread.help.at_seconds,
        visual: thread.help.moment.visual}, thread.initial_request);
    const freshIds = [...context.transcript.filter(cue => cue.end > thread.checked_through_seconds),
      ...context.facts.filter(fact => fact.available_at > thread.checked_through_seconds)].map(item => item.id);
    const coolingDown = Date.now() - thread.checked_at < THREAD_CHECK_MS;
    if (!freshIds.length) {
      if (!coolingDown) thread.checked_through_seconds = playback.at_seconds;
      return {thread: publicThread(thread), updated: false};
    }
    const demo = thread.preferences.answer_mode === 'generate' ? null : demoThreadUpdate(thread, context, freshIds);
    if (demo) {
      thread.checked_at = Date.now();
      thread.checked_through_seconds = playback.at_seconds;
      if (!demo.moment) return {thread: publicThread(thread), updated: false};
      demo.moment.audience ??= thread.help.moment.audience;
      thread.help = helpFor(demo.moment, context, thread.question, thread.answer_id); thread.revision++;
      return {thread: publicThread(thread), updated: true};
    }
    if (coolingDown) return {thread: publicThread(thread), updated: false};
    thread.checked_at = Date.now();
    context.follow_thread = {question: thread.question, new_evidence_ids: freshIds};
    const preference = await requesterContext(viewer(story, playback.at_seconds, '',
      thread.preferences), {...context, ...(thread.requester ? {requester: thread.requester} : {})});
    const moment = await explain({...preference.input, request: thread.question, answer_mode: 'generate'}, {signal, memory: thread.memory, context: preference.context});
    stillPaired(); requirePlayback(session, thread.content_version, thread.epoch);
    if (mirror.thread !== thread) throw conflict('That followed question has ended.');
    thread.checked_through_seconds = playback.at_seconds;
    if (moment.state !== 'response' || moment.answer === thread.help.moment.answer) return {thread: publicThread(thread), updated: false};
    thread.help = helpFor(moment, context, thread.question, thread.answer_id); thread.revision++;
    return {thread: publicThread(thread), updated: true};
  }

  // Retain one completed return for an identical retry after a lost HTTP response.
  if (action === 'return' && mirror.bridge?.branch_id === input.branch_id) {
    requirePlayback(session, input.content_version, input.epoch);
    if (mirror.bridge.from_seconds !== input.from_seconds || mirror.bridge.through_seconds !== input.through_seconds
      || mirror.bridge.sequence !== input.sequence) throw conflict('That return is complete. Send a new question to start another interval.');
    return mirror.bridge;
  }
  const hold = requireHold(session, input.branch_id);
  const playback = requirePlayback(session, hold.content_version, hold.epoch);
  if (action === 'return') {
    if (input.content_version !== hold.content_version || input.epoch !== hold.epoch || input.from_seconds !== hold.from_seconds)
      throw conflict('The saved starting point changed. Try Catch me up again.');
    const endpoint = requireSample(session, input, input.through_seconds);
    const preference = await requesterContext({request: hold.requester ? '' : hold.initial_request, ...preferences(input),
      answer_mode: input.answer_mode ?? hold.preferences?.answer_mode,
      ...(input.requester_id && input.requester_id !== hold.requester_id ? {requester_id: input.requester_id} : {})},
    hold.requester ? {requester: hold.requester} : {});
    const result = await guidedReturn(story, hold.from_seconds, endpoint, preference.input, {signal, memory: hold.memory, question: hold.question, initialRequest: hold.initial_request, requester: preference.context.requester});
    stillPaired(); requireHold(session, hold.id);
    if (['ready', 'no_gap'].includes(result.status)) {
      mirror.bridge = {...result, branch_id: hold.id, sequence: input.sequence};
      mirror.hold = null; mirror.help = null;
      return mirror.bridge;
    }
    return result;
  }
  if (!input.request.trim() || input.at_seconds > playback.at_seconds) throw conflict('Ask about a moment already reached on the TV.', 400);
  const followingUpdate = !input.new_topic && mirror.thread?.help.at_seconds === input.at_seconds && input.at_seconds !== hold.question_at_seconds;
  if (!input.new_topic && !followingUpdate && hold.question_at_seconds !== null && input.at_seconds !== hold.question_at_seconds)
    throw conflict('This conversation is about its original moment. Choose another moment to change it.');
  if (input.new_topic && input.clarification) throw conflict('A clarification must keep its original moment.', 400);
  const previous = followingUpdate ? {...mirror.thread.memory.lastExplanation, request: mirror.thread.question,
    answer: mirror.thread.help.moment.answer, at_seconds: input.at_seconds, visual: mirror.thread.help.moment.visual}
    : input.new_topic ? null : hold.previous;
  let memory = input.new_topic ? createMemory() : hold.memory;
  let initialRequest = input.new_topic ? input.request.trim() : hold.initial_request || input.request.trim();
  let context = personalContext(story, input.at_seconds, previous, initialRequest);
  let request = viewer(story, input.at_seconds, input.request.trim(), {...preferences(input),
    ...(!input.new_topic && input.answer_mode === undefined && hold.preferences?.answer_mode ? {answer_mode: hold.preferences.answer_mode} : {})});
  if (!input.new_topic && hold.requester) context.requester = hold.requester;
  if (input.requester_id && (input.new_topic || input.requester_id !== hold.requester_id)) request.requester_id = input.requester_id;
  const demoPrepared = !input.clarification && request.answer_mode !== 'generate' && isDemoPreparedQuestion(request, context);
  if (input.clarification) {
    const old = hold.clarification;
    if (!old || input.at_seconds !== old.input.at_seconds || input.need !== old.preferences.need || input.language !== old.preferences.language || input.recipient !== old.preferences.recipient
      || (input.answer_mode !== undefined && input.answer_mode !== old.input.answer_mode))
      throw conflict('That clarification changed. Ask the question again.');
    context = structuredClone(old.context);
    request = {...old.input, continuation: {request: old.input.request, question: old.question, answer: input.request.trim()}};
    if (input.communication_preferences !== undefined) {
      const personalized = await requesterContext({...request, request: input.request.trim(), communication_preferences: input.communication_preferences}, context);
      request = {...personalized.input, request: old.input.request}; context = personalized.context;
    }
  }
  if (!input.clarification && demoPrepared) {
    initialRequest = input.request.trim(); memory = createMemory();
    context = personalContext(story, input.at_seconds, null, initialRequest);
    context.requester = {role: demoAudience(story.id), source: 'fixture'};
    request = viewer(story, input.at_seconds, input.request.trim(), preferences(input));
    request = {...request, need: 'Show visually', language: 'English', recipient: 'everyone'};
    delete request.requester_id;
  } else if (!input.clarification) ({input: request, context} = await requesterContext(request, context));
  const moment = await explain(request, {signal, memory, context});
  stillPaired(); requireHold(session, hold.id);
  hold.memory = memory; hold.initial_request = initialRequest;
  hold.requester = context.requester ?? null;
  hold.requester_id = input.clarification ? hold.requester_id : demoPrepared ? null : input.new_topic ? input.requester_id : input.requester_id ?? hold.requester_id;
  hold.preferences = preferences(request);
  hold.current_preferences = {...preferences(input), ...(request.answer_mode !== undefined ? {answer_mode: request.answer_mode} : {})};
  hold.question = request.request; hold.question_at_seconds = request.at_seconds;
  hold.previous = {request: request.request, answer: moment.answer, content_id: story.id, at_seconds: request.at_seconds,
    visual: structuredClone(moment.visual), visual_feedback: moment.state === 'response' ? structuredClone(memory.lastExplanation?.visual_feedback ?? []) : []};
  hold.clarification = moment.state === 'clarification' ? {input: request, preferences: preferences(input), context, question: moment.answer} : null;
  if (input.new_topic || demoPrepared) mirror.thread = null;
  mirror.help = helpFor(moment, context, request.request); mirror.bridge = null;
  return {...mirror.help, hold: publicHold(hold), thread: publicThread(mirror.thread)};
}
