import {writeFile, mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {explain} from '../server/agent.mjs';
import {validResponse} from '../server/contract.mjs';
import {companionContext} from '../server/context.mjs';

const base = {request: 'Why is this kite important to Arun? Use the scene context and any validated connection.', content_id: 'the-red-kite', at_seconds: 44, play_state: 'paused', playback_choice: 'pause_to_explore', need: 'Explain simply', language: 'English', session: 'family', recipient: 'everyone', life_connection: false};
const cases = [
  ['explanation', base],
  ['spoiler', {...base, request: 'Will Maya fly the kite at the end? Tell me only what we know so far.', at_seconds: 20}],
  ['life', {...base, request: 'Connect this moment to our own lives with one question for everyone.', at_seconds: 79, life_connection: true}],
  ['translation', {...base, request: 'Translate the most recent completed dialogue and explain it simply.', need: 'Translate', language: 'Indonesian'}],
];
// Synthetic playback input exercises the real model; it is never evidence of a real device/provider session.
const snapshot = {package_id: 'code-check.sports', session_id: 1, catalog_name: 'code-check', content_id: 'synthetic-play', title: 'Synthetic code-check moment', provider_name: 'Code check', at_seconds: 30};
const context = companionContext(snapshot, 'I saw an attacker beyond the second-last opponent in the opponents’ half when a teammate passed. I could not see whether the attacker touched the ball or interfered with anyone.');
const companion = {...base, content_id: context.content_id, at_seconds: snapshot.at_seconds, request: 'From my description, is the attacker’s position alone enough for an offside offence? Explain what else matters without claiming what happened in this play.', playback_choice: 'keep_watching'};
const selected = process.argv.includes('--companion') ? [
  ['companion', companion, context],
  ['companion-life', {...companion, request: 'Connect this moment to our own experiences of learning a sports rule, with one question for everyone.', life_connection: true, playback_choice: 'pause_to_explore'}, context],
] : cases;
await mkdir('artifacts', {recursive: true});
for (const [name, input, context] of selected) {
  const calls = [], replies = []; const started = performance.now();
  console.info(JSON.stringify({case: name, status: 'requesting configured model'}));
  let result;
  try {
    result = await explain(input, {context, onTools: tool => {calls.push(tool); console.info(JSON.stringify({case: name, tool}));}, onReply: reply => replies.push(reply)});
  } catch (error) {
    // Only these public/synthetic fixtures are saved, never live household requests or credentials.
    await writeFile(`artifacts/live-${name}-failure.json`, JSON.stringify({input, replies, error: error.message}, null, 2));
    throw error;
  }
  assert.equal(validResponse(result), true);
  assert.equal(result.state, 'response'); assert.ok(result.answer.trim());
  if (name !== 'spoiler') assert.equal(result.visual.status, 'ready', `${name}: diagram did not pass validation`);
  if (input.life_connection) assert.equal(result.life_connection.offered, true);
  if (context) {assert.equal(result.grounding.content_id, context.content_id); assert.equal(result.new_connections.length, 0);}
  if (name === 'spoiler') assert.ok(result.grounding.evidence_ids.every(id => !['f-history', 'f-value', 'f-new-memory', 't3', 't8'].includes(id)));
  await writeFile(`artifacts/live-${name}.json`, JSON.stringify(result, null, 2));
  console.info(JSON.stringify({case: name, seconds: Math.round((performance.now() - started) / 1000), tools: calls, visual: result.visual.status, answer: result.answer}));
}
