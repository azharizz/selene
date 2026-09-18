import {writeFile, mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {explain} from '../server/agent.mjs';
import {validResponse} from '../server/contract.mjs';

const base = {request: 'Why is this kite important to Arun? Use the scene context and any validated connection.', content_id: 'the-red-kite', at_seconds: 44, play_state: 'paused', playback_choice: 'pause_to_explore', need: 'Explain simply', language: 'English', session: 'family', recipient: 'everyone', life_connection: false};
const cases = [
  ['explanation', base],
  ['spoiler', {...base, request: 'Will Maya fly the kite at the end? Tell me only what we know so far.', at_seconds: 20}],
  ['life', {...base, request: 'Connect this moment to our own lives with one question for everyone.', at_seconds: 79, life_connection: true}],
  ['translation', {...base, request: 'Translate the most recent completed dialogue and explain it simply.', need: 'Translate', language: 'Indonesian'}],
];
await mkdir('artifacts', {recursive: true});
for (const [name, input] of cases) {
  const calls = []; const started = performance.now();
  const result = await explain(input, {onTools: name => calls.push(name)});
  assert.equal(validResponse(result), true);
  assert.equal(result.state, 'response'); assert.ok(result.answer.trim());
  if (name !== 'spoiler') assert.equal(result.visual.status, 'ready', `${name}: diagram did not pass validation`);
  if (name === 'life') assert.equal(result.life_connection.offered, true);
  if (name === 'spoiler') assert.ok(result.grounding.evidence_ids.every(id => !['f-history', 'f-value', 'f-new-memory', 't3', 't8'].includes(id)));
  await writeFile(`artifacts/live-${name}.json`, JSON.stringify(result, null, 2));
  console.info(JSON.stringify({case: name, seconds: Math.round((performance.now() - started) / 1000), tools: calls, visual: result.visual.status, answer: result.answer}));
}
