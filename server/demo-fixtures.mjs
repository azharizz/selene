import {getStory, sceneContext} from './context.mjs';
import {preloadedAnswer, preparedAnswer} from './preloaded-answers.mjs';

const normalize = value => value?.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").trim().replace(/[.!?]+$/u, '').replace(/\s+/gu, ' ');
const fixtures = {
  'football-match': {anchor: 'caption-11', from: 15.485, until: 19.47, recipient: 'grandparent',
    questions: ['What is offside?', 'Explain the offside rule simply.', 'Explain offside to my child.', 'Offside Rules explain']},
  'the-missing-crown': {anchor: 'caption-33', from: 62.678, until: 83.92, recipient: 'child',
    questions: ['Who is Alisson and why is he missing?', 'Who is Alisson and Why now he is missing?', 'Who is Alisson?', 'Why is Alisson missing?']},
};
const footballNoFlagVisual = {
  status: 'ready',
  description: 'At the pass, the forward is level with the second-last defender and behind the ball. He runs onto the pass and scores; there is no offside.',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#202228"/><g font-family="Arial, sans-serif" stroke-linecap="round" stroke-linejoin="round"><text x="480" y="76" font-size="46" fill="#a5ddc5" text-anchor="middle" font-weight="600">LEVEL AT PASS = ONSIDE</text><rect x="48" y="118" width="864" height="330" rx="14" fill="#253337" stroke="#809c95" stroke-width="3"/><path d="M90 118V448M870 118V448M870 206H820V360H870M870 250H892V316H870" fill="none" stroke="#809c95" stroke-width="3"/><path d="M520 132V430" fill="none" stroke="#96c9ee" stroke-width="4" stroke-dasharray="10 10"/><text x="520" y="166" font-size="27" fill="#96c9ee" text-anchor="middle" font-weight="500">SECOND-LAST DEFENDER</text><rect x="502" y="354" width="36" height="36" rx="5" fill="#96c9ee"/><circle cx="410" cy="358" r="18" fill="#96c9ee"/><circle cx="842" cy="281" r="17" fill="#96c9ee"/><path d="M340 316C495 280 650 276 820 281" fill="none" stroke="#ffad33" stroke-width="5" stroke-dasharray="10 12"/><path d="M800 267L824 281L799 295" fill="none" stroke="#ffad33" stroke-width="5"/><circle cx="282" cy="322" r="19" fill="#ffad33"/><text x="282" y="374" font-size="30" fill="#f1f1f1" text-anchor="middle">PASSER</text><g id="forward-run"><circle cx="520" cy="286" r="20" fill="#ffad33"/><path d="M520 308V340M520 316L499 332M520 316L541 330M520 340L503 359M520 340L538 358" fill="none" stroke="#ffad33" stroke-width="9"/><circle cx="520" cy="286" r="31" fill="none" stroke="#a5ddc5" stroke-width="3"/></g><g id="pass-ball"><circle cx="326" cy="316" r="12" fill="#f1f1f1" stroke="#202228" stroke-width="3"/><path d="M321 312L328 311L332 317L326 322L320 318Z" fill="#202228"/></g><text x="874" y="178" font-size="30" fill="#f1f1f1" text-anchor="middle">GOAL</text><circle cx="74" cy="494" r="12" fill="#ffad33"/><text x="99" y="507" font-size="34" fill="#f1f1f1">Forward</text><rect x="284" y="482" width="24" height="24" rx="4" fill="#96c9ee"/><text x="320" y="507" font-size="34" fill="#f1f1f1">Defender</text><path d="M586 494H642" stroke="#ffad33" stroke-width="5" stroke-dasharray="9 10"/><text x="660" y="507" font-size="34" fill="#f1f1f1">Pass and run</text></g></svg>',
  animations: [
    {target_id: 'forward-run', duration_ms: 3600, delay_ms: 0, keyframes: [
      {opacity: 1, transform: 'translate(0px, 0px)'}, {opacity: 1, transform: 'translate(0px, 0px)'},
      {opacity: 1, transform: 'translate(205px, -20px)'}, {opacity: 1, transform: 'translate(205px, -20px)'},
    ]},
    {target_id: 'pass-ball', duration_ms: 3600, delay_ms: 0, keyframes: [
      {opacity: 1, transform: 'translate(0px, 0px)'}, {opacity: 1, transform: 'translate(0px, 0px)'},
      {opacity: 1, transform: 'translate(554px, -35px)'}, {opacity: 1, transform: 'translate(554px, -35px)'},
    ]},
  ],
};

export function demoAudience(contentId) {
  return fixtures[contentId]?.recipient ?? null;
}

function hasPreparedAnchor(contentId, fixture, request = fixture.questions[0]) {
  const story = getStory(contentId), at_seconds = fixture.from;
  if (!story) return false;
  const context = {...sceneContext(at_seconds, story), source_only: true, output: 'personal', initial_request: request};
  return Boolean(preloadedAnswer({request, content_id: contentId, at_seconds, playback_choice: 'keep_watching',
    need: 'Show visually', language: 'English', recipient: 'everyone'}, context)?.grounding.evidence_ids.includes(fixture.anchor));
}

export function isDemoPreparedQuestion(input, context) {
  if (input.answer_mode === 'generate') return false;
  const fixture = fixtures[context.content_id];
  if (!fixture || !['authored_demo', 'automatic_ingestion'].includes(context.source)
    || !fixture.questions.some(question => normalize(question) === normalize(input.request))) return false;
  const at_seconds = input.at_seconds;
  const preparedContext = {...sceneContext(at_seconds, getStory(context.content_id)), source_only: true, output: 'personal', initial_request: input.request};
  return Boolean(preloadedAnswer({...input, content_id: context.content_id, at_seconds, playback_choice: 'keep_watching',
    need: 'Show visually', language: 'English', recipient: 'everyone'}, preparedContext));
}

export function demoThreadUpdate(thread, context, freshIds) {
  if (thread.preferences?.answer_mode === 'generate' || thread.help?.moment.provenance?.kind === 'generated') return null;
  const fixture = fixtures[context.content_id];
  const anchorAt = thread.anchor_at_seconds ?? thread.help.at_seconds;
  const anchorEvidence = thread.anchor_evidence_ids ?? thread.help.moment.grounding.evidence_ids;
  if (!['authored_demo', 'automatic_ingestion'].includes(context.source) || !fixture
    || !fixture.questions.some(question => normalize(question) === normalize(thread.initial_request))) return null;
  const story = getStory(context.content_id);
  const anchorContext = {...sceneContext(anchorAt, story), source_only: true, output: 'personal', initial_request: thread.initial_request};
  const anchor = preparedAnswer({request: thread.question, content_id: context.content_id, at_seconds: anchorAt,
    playback_choice: 'keep_watching', ...thread.preferences}, anchorContext);
  const anchorMoment = anchor?.moment;
  if (!anchorMoment || !anchorMoment.grounding.evidence_ids.every(id => anchorEvidence.includes(id))) return null;

  if (context.content_id === 'football-match') {
    const cues = context.transcript;
    const stages = [
      {ids: ['caption-14', 'caption-15', 'caption-17'], answer: 'The replay shows the striker was beyond the last defender when the pass was played, so the flag was right. Grandpa, what made a striker stand out in the football you watched?'},
      {ids: ['caption-31', 'caption-32', 'caption-33', 'caption-34', 'caption-35', 'caption-36'], answer: 'A later run is different: the forward is level when the pass is played, then scores, so there is no offside. Grandpa, did the strikers you remember rely on timing like that?', visual: footballNoFlagVisual},
    ];
    const shown = new Set(thread.help.moment.grounding.evidence_ids);
    const stage = stages.findLast(value => value.ids.every(id => cues.some(cue => cue.id === id))
      && !value.ids.every(id => shown.has(id)));
    if (!stage) return {matched: true};
    const availableAt = value => Math.max(...value.ids.map(id => story.transcript.find(cue => cue.id === id).end));
    const next = stages[stages.indexOf(stage) + 1];
    return {matched: true, moment: {...thread.help.moment, answer: stage.answer,
      visual: structuredClone(stage.visual ?? thread.help.moment.visual),
      provenance: {...anchor.provenance, example_id: `football-thread-${stage.ids.at(-1)}`,
        at_seconds: context.at_seconds, from_seconds: availableAt(stage), until_seconds: next ? availableAt(next) : story.duration},
      grounding: {content_id: context.content_id, scene_id: context.scene_id, at_seconds: context.at_seconds,
        evidence_ids: [...new Set([fixture.anchor, ...stage.ids])], graph_ids: []}}};
  }

  const answerContext = {...sceneContext(context.at_seconds, story), source_only: true, output: 'personal', initial_request: thread.initial_request};
  const prepared = preparedAnswer({request: thread.question, content_id: context.content_id, at_seconds: context.at_seconds,
    playback_choice: 'keep_watching', ...thread.preferences}, answerContext);
  if (!prepared) return {matched: true};
  const moment = {...prepared.moment, provenance: {...prepared.provenance, example_id: `${prepared.provenance.example_id}-thread`}};
  if (moment.answer === thread.help.moment.answer || !moment.grounding.evidence_ids.some(id => freshIds.includes(id))) return {matched: true};
  if (context.at_seconds >= 107.297)
    moment.answer = 'Alisson came back carrying the true crown. The story now explains why he left: he had protected it all along.';
  else if (context.at_seconds >= 101.728)
    moment.answer = 'Alisson came back carrying the true crown, but the story has not explained why he left.';
  else if (context.at_seconds >= 83.92)
    moment.answer = 'Alisson met Captain Bren, gave him a note, and pointed to Voss’s tower. The story has not explained their plan yet.';
  moment.audience = thread.help.moment.audience;
  return {matched: true, moment};
}

export function demoConversation(context) {
  if (!context) return null;
  const fixture = fixtures[context.content_id];
  if (!['authored_demo', 'automatic_ingestion'].includes(context.source) || !fixture || !hasPreparedAnchor(context.content_id, fixture)) return null;
  if (context.playback.play_state === 'ended') {
    const football = context.content_id === 'football-match';
    return {action: 'show', opportunity: 'ending', boundary_id: 'ended', options: football ? [
      {id: 'striker-memories', angle: 'Then and now', question: 'Grandpa, if you feel like sharing, what made a striker memorable in the football you watched? Everyone else, what stood out in this goal?', recipient: 'everyone', evidence_ids: ['caption-26', 'caption-31', 'caption-32', 'caption-33', 'caption-36']},
      {id: 'compare-runs', angle: 'Compare the runs', question: 'What changed between the flagged run and the later level run? Did the strikers Grandpa remembers use similar timing?', recipient: 'everyone', evidence_ids: ['caption-14', 'caption-15', 'caption-26', 'caption-31', 'caption-33']},
      {id: 'trade-perspectives', angle: 'Share perspectives', question: 'What could each generation teach the other about making a run at the right moment?', recipient: 'everyone', evidence_ids: ['caption-14', 'caption-15', 'caption-26', 'caption-31', 'caption-33']},
    ] : [
      {id: 'protect-the-crown', angle: 'Plan together', question: 'If you were Lyra, what clue would you follow first to protect the crown, and why?', recipient: 'everyone', evidence_ids: ['caption-49', 'caption-52']},
      {id: 'help-lyra', angle: 'Imagine a next move', question: 'What one move would you suggest to help Lyra after Alisson returned with the crown?', recipient: 'everyone', evidence_ids: ['caption-49', 'caption-52', 'caption-53']},
      {id: 'secret-mission', angle: 'Work as a team', question: 'What would make each person a helpful teammate on a secret mission like Alisson’s?', recipient: 'everyone', evidence_ids: ['caption-40', 'caption-41', 'caption-42', 'caption-52']},
    ]};
  }
  return context.playback.at_seconds < context.duration
    ? {action: 'schedule', at_seconds: context.duration, opportunity: 'ending', reason: 'Recheck at the authored demo video end.'}
    : {action: 'quiet'};
}
