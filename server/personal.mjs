import {createHash, randomUUID} from 'node:crypto';
import {createMemory, sceneContext} from './context.mjs';
import {explain} from './agent.mjs';

export const PLAYBACK_FRESH_MS = 6000;
const versions = new WeakMap();
export function playerStory(story) {
  // Derived graphs do not change playback identity or expose future labels in the player catalog.
  const {movie_graph, ...original} = story;
  const {facts, ...player} = original;
  if (!versions.has(story)) versions.set(story, createHash('sha256').update(JSON.stringify(original)).digest('hex'));
  return {...player, content_version: versions.get(story)};
}
export function conflict(message, status = 409) {return Object.assign(new Error(message), {status});}

export function recordPlayback(session, input, now = Date.now()) {
  if (session.contentId !== input.content_id || session.contentVersion !== input.content_version) throw conflict('The TV is showing a different film. Pair again.');
  if (input.at_seconds > session.duration) throw conflict('The TV position is outside this film.', 400);
  const previous = session.playback;
  if (previous && input.sequence <= previous.sequence) return false;
  if (previous && input.epoch < previous.epoch) return false;
  session.playback = {...input, received_at: now};
  // ponytail: retain 32 recent reports for validating phone tap samples, not a playback log.
  session.playbackHistory = [...(session.playbackHistory ?? []).filter(sample => sample.epoch === input.epoch && now - sample.received_at <= PLAYBACK_FRESH_MS), session.playback].slice(-32);
  return true;
}

export function playbackSnapshot(session, now = Date.now()) {
  if (!session.playback) return null;
  const {received_at, ...snapshot} = session.playback;
  return {...snapshot, age_ms: Math.max(0, now - received_at), fresh: now - received_at <= PLAYBACK_FRESH_MS};
}

export function requirePlayback(session, version, epoch, now = Date.now()) {
  const snapshot = playbackSnapshot(session, now);
  if (!snapshot?.fresh) throw conflict('The TV position is unavailable. Keep Selene open on the TV and try again.');
  if (snapshot.content_version !== version || snapshot.epoch !== epoch) throw conflict('The TV moved to a different point. Choose a moment and ask again.');
  // Use the last observed position, never advance the evidence boundary using a wall clock.
  return snapshot;
}

export function requireSample(session, input, at, now = Date.now()) {
  requirePlayback(session, input.content_version, input.epoch, now);
  const sample = session.playbackHistory?.find(value => value.sequence === input.sequence);
  if (!sample || sample.content_version !== input.content_version || sample.epoch !== input.epoch || sample.at_seconds !== at
    || now - sample.received_at > PLAYBACK_FRESH_MS) throw conflict('That TV sample is no longer available. Wait for the live time and try again.');
  return {...sample};
}

export function holdMoment(session, input, now = Date.now()) {
  const playback = requireSample(session, input, input.at_seconds, now);
  const from = input.from_seconds ?? playback.at_seconds;
  if (!Number.isFinite(from) || from < 0 || from > playback.at_seconds) throw conflict('Choose a moment already reached on the TV.', 400);
  return {id: randomUUID(), from_seconds: from, content_version: playback.content_version, epoch: playback.epoch,
    question: '', initial_request: '', question_at_seconds: null, previous: null, clarification: null, memory: createMemory()};
}

export function publicHold(hold) {
  if (!hold) return null;
  const {id, from_seconds, content_version, epoch, question_at_seconds} = hold;
  return {id, from_seconds, content_version, epoch, question_at_seconds};
}

export function requireHold(session, id) {
  const hold = session.mirror?.hold;
  if (!hold || hold.id !== id) throw conflict('That saved moment has ended. Choose a moment and ask again.');
  requirePlayback(session, hold.content_version, hold.epoch);
  return hold;
}

export function personalContext(story, at, previous = null, initialRequest = '') {
  return {...sceneContext(at, story), source_only: true, output: 'personal',
    ...(initialRequest ? {initial_request: initialRequest} : {}),
    ...(previous && previous.at_seconds <= at ? {previous_help: previous} : {})};
}

export function returnContext(story, from, playback, question = '', output = 'personal') {
  if (!Number.isFinite(from) || from < 0 || from > playback.at_seconds) throw conflict('The TV is before your saved place. Choose a new starting point.');
  const context = {...personalContext(story, playback.at_seconds), output};
  const intervalIds = [
    ...context.transcript.filter(line => line.end > from).map(line => line.id),
    ...context.facts.filter(fact => fact.available_at > from).map(fact => fact.id),
  ];
  return {...context, return_window: {from_seconds: from, through_seconds: playback.at_seconds,
    interval_evidence_ids: intervalIds, unresolved_question: question}};
}

export function evidenceFor(moment, context) {
  const cited = new Set([...(moment?.grounding.evidence_ids ?? []), ...(moment?.grounding.graph_ids ?? [])]);
  return [...context.transcript, ...context.facts].filter(item => cited.has(item.id)).map(item => ({
    id: item.id, at_seconds: item.start ?? item.available_at, text: item.text ?? item.explanation,
    source: item.source ?? (item.end !== undefined ? 'caption' : 'authored_demo'),
    ...(item.source_url ? {source_url: item.source_url} : {}),
  }));
}

export function originalQuote(moment, context) {
  const cited = new Set(moment?.grounding.evidence_ids ?? []);
  const cue = context.transcript.filter(line => cited.has(line.id)).at(-1)
    ?? context.transcript.filter(line => context.at_seconds - line.end <= 12).at(-1);
  // Copy source text verbatim. Never ask the model to recreate the original dialogue.
  return cue ? {id: cue.id, at_seconds: cue.start, text: cue.text} : null;
}

export async function guidedReturn(story, from, playback, preferences, {signal, memory, question = '', initialRequest = '', output = 'personal', requester} = {}) {
  let context = returnContext(story, from, playback, question, output);
  if (initialRequest) context.initial_request = initialRequest;
  if (requester) context.requester = requester;
  const boundary = {from_seconds: from, through_seconds: playback.at_seconds, content_version: playback.content_version, epoch: playback.epoch};
  if (playback.at_seconds - from < 0.25) return {...boundary, status: 'no_gap', moment: null, evidence: []};
  if (!context.return_window.interval_evidence_ids.length) return {...boundary, status: 'insufficient_evidence', moment: null, evidence: []};
  const input = {...preferences,
    request: 'Summarize the missed interval using the supplied evidence so I can rejoin the story.',
    content_id: story.id, at_seconds: playback.at_seconds, play_state: ['paused', 'ended'].includes(playback.play_state) ? playback.play_state : 'playing', playback_choice: 'keep_watching',
    session: 'family', continuation: null};
  let moment;
  const started = performance.now();
  try {moment = await explain(input, {signal, memory, context});}
  catch (error) {
    signal?.throwIfAborted();
    // A provider failure is not missing source evidence or a successful recap.
    // Log only host-assigned categories, never provider bodies, prompts or family questions.
    const failure = error.agentFailure ?? {stage: 'unknown', code: error.name === 'TimeoutError' ? 'timeout' : 'unexpected_error'};
    console.error(JSON.stringify({event: 'selene_return_unavailable', content_id: story.id, from_seconds: from, through_seconds: playback.at_seconds,
      output, stage: failure.stage, code: failure.code, ...(failure.http_status ? {http_status: failure.http_status} : {}), elapsed_ms: Math.round(performance.now() - started)}));
    const cue = context.transcript.filter(line => line.start >= from && line.end <= playback.at_seconds).at(-1);
    // A verified source line remains useful; it is not an AI recap or a completed return.
    const quote = cue ? {id: cue.id, at_seconds: cue.start, text: cue.text} : null;
    return {...boundary, status: 'unavailable', moment: null, evidence: [], quote};
  }
  return {...boundary, status: moment.state === 'response' ? 'ready' : 'insufficient_evidence', moment, evidence: evidenceFor(moment, context)};
}

export function captionsVtt(story) {
  const timestamp = seconds => {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  // Imported caption text stays text, including tags, cue arrows and apparent VTT instructions.
  const plain = text => text.replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return 'WEBVTT\n\n' + story.transcript.map(line => `${timestamp(line.start)} --> ${timestamp(line.end)}\n${plain(line.text)}\n`).join('\n');
}
