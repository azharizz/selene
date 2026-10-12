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
const crownQuestions = ['Who is Alisson and why is he missing?', 'Who is Alisson and Why now he is missing?', 'Who is Alisson?', 'Why is Alisson missing?'];
const earlyCrownStages = [
  {until: 14.018, evidence_ids: ['caption-1', 'caption-2'], answer: 'So far, we have only heard about the kingdom and the crown. The film has not introduced Alisson, so we cannot tell whether he is missing or why.', tv_answer: 'Alisson has not been introduced yet. We cannot tell whether he is missing or why.', description: 'The opening introduces a kingdom and a crown; Alisson has not appeared in the story yet.', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#202228"/><path d="M118 330L170 250L215 315L268 225L321 330Z" fill="#ffad33"/><text x="220" y="395" fill="#f1f1f1" font-size="42" text-anchor="middle">A kingdom</text><circle id="unknown-person" cx="700" cy="270" r="72" fill="#303238" stroke="#ffad33" stroke-width="8"/><text x="700" y="295" fill="#f1f1f1" font-size="82" text-anchor="middle">?</text><text x="700" y="395" fill="#f1f1f1" font-size="42" text-anchor="middle">Not introduced</text><path d="M360 270H530" stroke="#bec4cf" stroke-width="6" stroke-dasharray="12 16"/></svg>'},
  {from: 14.018, until: 15.590, evidence_ids: ['caption-4', 'caption-5', 'caption-6', 'caption-8'], answer: 'We know the King has a quiet brother, but the story has not named him or said that he is missing yet.', tv_answer: 'The King has a quiet brother, but his name is not stated and he has not been shown missing.', description: 'The King has a quiet brother, but the story has not named him yet.', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#202228"/><circle cx="250" cy="250" r="68" fill="#303c45" stroke="#bec4cf" stroke-width="5"/><text x="250" y="265" fill="#f1f1f1" font-size="38" text-anchor="middle">King</text><path d="M320 250H585" stroke="#bec4cf" stroke-width="5"/><circle id="unknown-brother" cx="690" cy="250" r="68" fill="#303238" stroke="#ffad33" stroke-width="7"/><text x="690" y="275" fill="#f1f1f1" font-size="66" text-anchor="middle">?</text><text x="480" y="390" fill="#f1f1f1" font-size="42" text-anchor="middle">Quiet brother · not named yet</text></svg>'},
  {from: 15.590, until: 60.785, evidence_ids: ['caption-4', 'caption-5', 'caption-6', 'caption-8', 'caption-9'], answer: 'Alisson is King Aldric’s brother and Lyra’s uncle. We saw him polishing the crown early on; the film has not said that he is missing or why.', tv_answer: 'Alisson is Aldric’s brother and Lyra’s uncle. He polished the crown; the film has not said he is missing.', description: 'Alisson is the King’s brother and Lyra’s uncle. He polished the crown; the story has not explained any absence.', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#202228"/><text x="480" y="95" fill="#ffad33" font-size="54" text-anchor="middle">Alisson</text><path d="M285 155H675" stroke="#bec4cf" stroke-width="5"/><text x="285" y="220" fill="#f1f1f1" font-size="42" text-anchor="middle">Aldric</text><text x="675" y="220" fill="#f1f1f1" font-size="42" text-anchor="middle">Lyra</text><text x="480" y="275" fill="#bec4cf" font-size="32" text-anchor="middle">brother · uncle</text><path d="M418 350L444 317L468 350L492 310L518 350L544 317L570 350V400H418Z" fill="#ffad33"/><circle id="unknown-reason" cx="480" cy="460" r="30" fill="#303238" stroke="#96c9ee" stroke-width="5"/><text x="480" y="475" fill="#f1f1f1" font-size="38" text-anchor="middle">?</text></svg>'},
  {from: 60.785, until: 62.678, evidence_ids: ['caption-4', 'caption-5', 'caption-6', 'caption-8', 'caption-9', 'caption-32'], answer: 'Alisson is Aldric’s brother and Lyra’s uncle. The King has just ordered them to find him; why he is away is still unknown.', tv_answer: 'Alisson is the King’s brother. The King has ordered them to find him, but the reason is unknown.', description: 'The King orders everyone to find Alisson. Why he is away is still unknown.', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#202228"/><text x="275" y="170" fill="#f1f1f1" font-size="48" text-anchor="middle">King</text><path d="M275 205V315H675" fill="none" stroke="#bec4cf" stroke-width="5"/><path d="M650 293L678 315L650 337" fill="none" stroke="#bec4cf" stroke-width="5"/><circle id="search-clue" cx="720" cy="315" r="58" fill="#303238" stroke="#ffad33" stroke-width="6"/><text x="720" y="338" fill="#f1f1f1" font-size="62" text-anchor="middle">?</text><text x="480" y="430" fill="#f1f1f1" font-size="46" text-anchor="middle">Find Alisson · reason unknown</text></svg>'},
];
const earlyAnimations = {
  'unknown-person': [{opacity: 0.45, transform: 'scale(0.9)'}, {opacity: 1, transform: 'none'}],
  'unknown-brother': [{opacity: 0.45, transform: 'scale(0.9)'}, {opacity: 1, transform: 'none'}],
  'unknown-reason': [{opacity: 0.45, transform: 'scale(0.8)'}, {opacity: 1, transform: 'none'}],
  'search-clue': [{opacity: 0.45, transform: 'scale(0.9)'}, {opacity: 1, transform: 'none'}],
};

// ponytail: explicit question aliases only; add reviewed examples instead of fuzzy intent matching.
export function preparedAnswer(input, context) {
  if (input.answer_mode === 'generate' || (!context.source_only && context.source !== 'authored_demo') || context.source === 'vega_media_controls' || context.return_window || context.follow_thread
    || context.previous_help || input.continuation || !['keep_watching', 'unspecified'].includes(input.playback_choice)
    || !['Show visually', 'Slower answer voice'].includes(input.need) || input.language !== 'English' || input.recipient !== 'everyone'
    || input.at_seconds !== context.at_seconds || input.content_id !== context.content_id) return null;
  try {
    const question = normalize(input.request);
    if (context.initial_request && normalize(context.initial_request) !== question) return null;
    if (input.content_id === 'the-missing-crown' && crownQuestions.some(request => normalize(request) === question)) {
      if (hash(getStory(input.content_id)) !== entries.find(item => item.content_id === input.content_id)?.content_version) return null;
      const stage = earlyCrownStages.find(item => (item.from ?? 4.410) <= input.at_seconds && input.at_seconds < item.until);
      if (stage) {
        const evidence = stage.evidence_ids.map(id => context.transcript.find(cue => cue.id === id));
        if (evidence.some(cue => !cue)) return null;
        const target = Object.keys(earlyAnimations).find(id => stage.svg.includes(`id="${id}"`));
        return {provenance: {kind: 'prepared', source: 'authored_example', example_id: `early-crown-${stage.until}`,
          content_id: input.content_id, content_version: hash(getStory(input.content_id)), at_seconds: input.at_seconds,
          from_seconds: stage.from ?? 4.410, until_seconds: stage.until}, moment: {version: '1.0', state: 'response', answer: context.output === 'personal' ? stage.answer : stage.tv_answer,
          visual: {status: 'ready', description: stage.description, svg: stage.svg,
            animations: [{target_id: target, duration_ms: 2200, delay_ms: 0, keyframes: earlyAnimations[target]}]},
          intervention: {playback: input.playback_choice === 'unspecified' ? 'offer_choice' : 'keep_watching', audio: 'silent'},
          grounding: {content_id: input.content_id, scene_id: context.scene_id, at_seconds: context.at_seconds,
            evidence_ids: [...stage.evidence_ids], graph_ids: []}}};
      }
    }
    const entry = entries.find(item => item.content_id === input.content_id && input.at_seconds >= item.from_seconds
      && input.at_seconds < item.until_seconds && item.requests.some(request => normalize(request) === question));
    if (!entry || hash(getStory(input.content_id)) !== entry.content_version) return null;
    const sources = [...context.transcript, ...context.facts];
    const evidence = entry.evidence_ids.map(id => sources.find(source => source.id === id));
    if (evidence.some(source => !source) || hash(evidence) !== entry.evidence_sha256) return null;
    return {provenance: {kind: 'prepared', source: 'authored_example', example_id: entry.id,
      content_id: input.content_id, content_version: entry.content_version, at_seconds: input.at_seconds,
      from_seconds: entry.from_seconds, until_seconds: entry.until_seconds}, moment: {
      version: '1.0', state: 'response', answer: context.output === 'personal' ? entry.answer : (entry.tv_answer ?? entry.answer), visual: structuredClone(entry.visual),
      intervention: {playback: input.playback_choice === 'unspecified' ? 'offer_choice' : 'keep_watching', audio: 'silent'},
      grounding: {content_id: input.content_id, scene_id: context.scene_id, at_seconds: input.at_seconds,
        evidence_ids: [...entry.evidence_ids], graph_ids: []},
    }};
  } catch {return null;} // A broken prepared entry cannot disable the live question path.
}

export const preloadedAnswer = (input, context) => preparedAnswer(input, context)?.moment ?? null;

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
