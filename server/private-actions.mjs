import {randomUUID} from 'node:crypto';
import {getStory, createMemory, personalReferences} from './context.mjs';
import {explain} from './agent.mjs';
import {validHold, validPersonalAsk, validPersonalReturn, validPersonalEnd, validPersonalThread, validThreadCheck} from './contract.mjs';
import {conflict, holdMoment, publicHold, requireHold, requirePlayback, requireSample, playbackSnapshot, personalContext, guidedReturn, evidenceFor, originalQuote} from './personal.mjs';

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

const preferences = input => ({need: input.need, language: input.language, recipient: input.recipient});
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
      help, checked_through_seconds: help.at_seconds, revision: 0, checked_at: 0, content_version: playback.content_version,
      epoch: playback.epoch, memory: createMemory()};
    return {thread: publicThread(mirror.thread)};
  }
  if (action === 'thread-check') {
    const playback = requireSample(session, input, input.at_seconds), thread = mirror.thread;
    if (!thread) return {thread: null, updated: false};
    if (thread.content_version !== playback.content_version || thread.epoch !== playback.epoch) {
      mirror.thread = null; return {thread: null, updated: false};
    }
    if (Date.now() - thread.checked_at < THREAD_CHECK_MS || playback.at_seconds <= thread.checked_through_seconds)
      return {thread: publicThread(thread), updated: false};
    const context = personalContext(story, playback.at_seconds,
      {request: thread.question, answer: thread.help.moment.answer, at_seconds: thread.help.at_seconds}, thread.initial_request);
    const freshIds = [...context.transcript.filter(cue => cue.end > thread.checked_through_seconds),
      ...context.facts.filter(fact => fact.available_at > thread.checked_through_seconds)].map(item => item.id);
    if (!freshIds.length) {thread.checked_through_seconds = playback.at_seconds; return {thread: publicThread(thread), updated: false};}
    thread.checked_at = Date.now();
    context.references = personalReferences(`${thread.question} ${thread.initial_request}`);
    context.follow_thread = {question: thread.question, new_evidence_ids: freshIds};
    const moment = await explain(viewer(story, playback.at_seconds, thread.question,
      {need: 'Show visually', language: 'English', recipient: 'everyone'}), {signal, memory: thread.memory, context});
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
    const result = await guidedReturn(story, hold.from_seconds, endpoint, preferences(input), {signal, memory: hold.memory, question: hold.question, initialRequest: hold.initial_request});
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
  const previous = followingUpdate ? {request: mirror.thread.question, answer: mirror.thread.help.moment.answer, at_seconds: input.at_seconds}
    : input.new_topic ? null : hold.previous;
  let context = personalContext(story, input.at_seconds, previous, hold.initial_request || input.request.trim());
  context.references = personalReferences(`${input.request} ${hold.initial_request} ${previous?.request ?? ''}`);
  let request = viewer(story, input.at_seconds, input.request.trim(), preferences(input));
  if (input.clarification) {
    const old = hold.clarification;
    if (!old || input.at_seconds !== old.input.at_seconds || input.need !== old.input.need || input.language !== old.input.language || input.recipient !== old.input.recipient)
      throw conflict('That clarification changed. Ask the question again.');
    context = structuredClone(old.context);
    request = {...old.input, continuation: {request: old.input.request, question: old.question, answer: input.request.trim()}};
  }
  const moment = await explain(request, {signal, memory: hold.memory, context});
  stillPaired(); requireHold(session, hold.id);
  hold.initial_request ||= input.request.trim();
  hold.question = request.request; hold.question_at_seconds = request.at_seconds;
  hold.previous = {request: request.request, answer: moment.answer, at_seconds: request.at_seconds};
  hold.clarification = moment.state === 'clarification' ? {input: request, context, question: moment.answer} : null;
  if (input.new_topic) mirror.thread = null;
  mirror.help = helpFor(moment, context, request.request); mirror.bridge = null;
  return {...mirror.help, hold: publicHold(hold), thread: publicThread(mirror.thread)};
}
