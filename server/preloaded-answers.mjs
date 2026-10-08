import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getStory, sceneContext} from './context.mjs';

let entries = [];
try {
  const data = JSON.parse(readFileSync(new URL('./preloaded-answers.json', import.meta.url), 'utf8'));
  if (data.version === 1 && Array.isArray(data.entries)) entries = data.entries;
} catch {console.warn('Prepared answers unavailable; using live answers.');}

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").trim().replace(/[.!?]+$/u, '').replace(/\s+/gu, ' ');

// ponytail: explicit question aliases only; add reviewed examples instead of fuzzy intent matching.
export function preloadedAnswer(input, context) {
  if ((!context.source_only && context.source !== 'authored_demo') || context.source === 'vega_media_controls' || context.return_window || context.follow_thread
    || context.previous_help || input.continuation || !['keep_watching', 'unspecified'].includes(input.playback_choice)
    || !['Show visually', 'Slower answer voice'].includes(input.need) || input.language !== 'English' || input.recipient !== 'everyone'
    || input.at_seconds !== context.at_seconds || input.content_id !== context.content_id) return null;
  try {
    const question = normalize(input.request);
    if (context.initial_request && normalize(context.initial_request) !== question) return null;
    const entry = entries.find(item => item.content_id === input.content_id && input.at_seconds >= item.from_seconds
      && input.at_seconds < item.until_seconds && item.requests.some(request => normalize(request) === question));
    if (!entry || hash(getStory(input.content_id)) !== entry.content_version) return null;
    const sources = [...context.transcript, ...context.facts];
    const evidence = entry.evidence_ids.map(id => sources.find(source => source.id === id));
    if (evidence.some(source => !source) || hash(evidence) !== entry.evidence_sha256) return null;
    return {
      version: '1.0', state: 'response', answer: context.output === 'personal' ? entry.answer : (entry.tv_answer ?? entry.answer), visual: structuredClone(entry.visual),
      intervention: {playback: input.playback_choice === 'unspecified' ? 'offer_choice' : 'keep_watching', audio: 'silent'},
      grounding: {content_id: input.content_id, scene_id: context.scene_id, at_seconds: input.at_seconds,
        evidence_ids: [...entry.evidence_ids], graph_ids: []},
    };
  } catch {return null;} // A broken prepared entry cannot disable the live question path.
}

export function preparedExamples(contentId, at) {
  const story = getStory(contentId);
  if (!story || !Number.isFinite(at) || at < 0 || at > story.duration) return [];
  const examplesAt = seconds => {
    const context = {...sceneContext(seconds, story), source_only: true, output: 'shared_tv'};
    return entries.filter(entry => entry.content_id === contentId && seconds >= entry.from_seconds && seconds < entry.until_seconds && preloadedAnswer({request: entry.requests[0], content_id: contentId,
      at_seconds: seconds, playback_choice: 'keep_watching', need: 'Show visually', language: 'English', recipient: 'everyone'}, context))
      .map(entry => ({id: entry.id, request: entry.requests[0], at_seconds: seconds}));
  };
  const current = examplesAt(at);
  if (current.length) return current;
  // Listing a future demo does not authorize its answer until the viewer chooses that jump.
  for (const seconds of [...new Set(entries.filter(entry => entry.content_id === contentId && entry.from_seconds > at
    && entry.from_seconds <= story.duration).map(entry => entry.from_seconds))].sort((a, b) => a - b)) {
    const next = examplesAt(seconds);
    if (next.length) return next;
  }
  return [];
}
