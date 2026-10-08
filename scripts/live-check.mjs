import {writeFile, mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {explain} from '../server/agent.mjs';
import {validResponse} from '../server/contract.mjs';
import {companionContext, sceneContext, getStory, movieGraphEvidence} from '../server/context.mjs';

const base = {request: 'What has happened to the crown so far? Explain only what is known at this moment.', content_id: 'the-missing-crown', at_seconds: 27, play_state: 'paused', playback_choice: 'pause_to_explore', need: 'Explain simply', language: 'English', session: 'family', recipient: 'everyone',};
const cases = [
  ['explanation', base],
  ['spoiler', {...base, request: 'Who stole the crown, and will Lyra become queen? Tell me only what we know so far.', at_seconds: 27}],
  ['translation', {...base, request: 'Translate the most recent completed dialogue and explain it simply.', need: 'Translate', language: 'Indonesian'}],
];
// Synthetic playback input exercises the real model; it is never evidence of a real device/provider session.
const snapshot = {package_id: 'code-check.sports', session_id: 1, catalog_name: 'code-check', content_id: 'synthetic-play', title: 'Synthetic code-check moment', provider_name: 'Code check', at_seconds: 30};
const context = companionContext(snapshot, 'I saw an attacker beyond the second-last opponent in the opponents’ half when a teammate passed. I could not see whether the attacker touched the ball or interfered with anyone.');
const companion = {...base, content_id: context.content_id, at_seconds: snapshot.at_seconds, request: 'From my description, is the attacker’s position alone enough for an offside offence? Explain what else matters without claiming what happened in this play.', playback_choice: 'keep_watching'};
const ingested = process.argv.includes('--ingested');
const importedStory = ingested ? getStory('the-missing-crown') : null;
if (ingested) assert.ok(importedStory, 'Import the supplied The Missing Crown film first');
const visualQuality = process.argv.includes('--visual-quality');
if (visualQuality) assert.ok(getStory('football-match') && getStory('the-missing-crown'), 'Visual quality checks need Football Match and The Missing Crown');
const visualCases = [
  ['visual-concept', {...base, content_id: 'football-match', at_seconds: 20, request: 'What is offside in football?', need: 'Show visually'}],
  ['visual-movement', {...base, content_id: 'football-match', at_seconds: 20, request: 'What is a pass in football?', need: 'Show visually'}],
  ['visual-dialogue', {...base, at_seconds: 13, request: "What does 'On the eve of the coronation' mean here?", need: 'Show visually'}],
  ['visual-observation', {...base, at_seconds: 40.5, request: 'Describe the visible appearance around this moment without guessing identities or motives. Distinguish after-question frames from what was already known.', need: 'Show visually'}],
  ['visual-relationship', {...base, at_seconds: 16, request: 'How are King Aldric, Queen Mera, Princess Lyra and Alisson related according to the completed narration?', need: 'Show visually'}],
];
const selected = visualQuality ? visualCases : ingested ? [
  ['ingested-caption', {...base, content_id: importedStory.id, at_seconds: 13, recipient: 'child', request: "What does 'On the eve of the coronation' mean in this moment?"}, sceneContext(13, importedStory)],
  ['ingested-frame', {...base, content_id: importedStory.id, at_seconds: 40.5, request: 'Describe the fresh sampled frames around this question. Distinguish any after-question observations; do not invent events between samples.'}, sceneContext(40.5, importedStory)],
] : process.argv.includes('--companion') ? [
  ['companion', companion, context],
] : cases;
await mkdir('artifacts', {recursive: true});
for (const [name, input, context] of selected) {
  const artifactName = `${name}-${input.content_id}`;
  const calls = [], replies = []; const started = performance.now();
  console.info(JSON.stringify({case: name, model: process.env.AGENT_PROVIDER_MODEL, status: 'requesting configured model'}));
  let result;
  try {
    result = await explain(input, {context, signal: AbortSignal.timeout(180000), onTools: tool => {calls.push(tool); console.info(JSON.stringify({case: name, tool}));}, onReply: reply => replies.push(reply)});
  } catch (error) {
    // Only these supplied catalog/synthetic fixtures are saved, never live household requests or credentials.
    await writeFile(`artifacts/live-${artifactName}-failure.json`, JSON.stringify({input, replies, error: error.message}, null, 2));
    console.error(JSON.stringify({case: name, error: error.message}));
    process.exitCode = 1;
    continue;
  }
  assert.equal(validResponse(result), true);
  assert.equal(result.state, 'response'); assert.ok(result.answer.trim());
  if (name === 'ingested-caption') {
    assert.equal(result.visual.status, 'ready', 'caption meaning must include a grounded SVG');
    assert.ok(result.visual.animations.length > 0, 'the grounded caption SVG must animate');
  }
  if (name === 'ingested-frame') assert.ok(result.grounding.evidence_ids.some(id => id.startsWith(`source-frame-${input.content_id}-`)), 'sampled-frame answers must cite actual source frames');
  if (name === 'translation') assert.match(result.answer, /\b(mahkota|raja|kerajaan|pencuri|hilang)\b/i, 'the Indonesian translation must not silently remain English');
  if (context) assert.equal(result.grounding.content_id, context.content_id);
  if (name === 'spoiler') {
    const bounded = sceneContext(input.at_seconds, getStory(input.content_id));
    const eligible = new Set([...bounded.transcript, ...bounded.facts, ...movieGraphEvidence(bounded)].map(item => item.id));
    assert.ok(result.grounding.evidence_ids.every(id => eligible.has(id) || id.startsWith(`source-frame-${input.content_id}-`)), 'spoiler check must cite time-bounded evidence or explicitly authorized source frames');
  }
  await writeFile(`artifacts/live-${artifactName}.json`, JSON.stringify(result, null, 2));
  await writeFile(`artifacts/live-${artifactName}-replies.json`, JSON.stringify(replies, null, 2));
  console.info(JSON.stringify({case: name, seconds: Math.round((performance.now() - started) / 1000), tools: calls, visual: result.visual.status, answer: result.answer}));
}
