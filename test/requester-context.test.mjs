import test from 'node:test';
import assert from 'node:assert/strict';
import {requesterContext} from '../server/requester-context.mjs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequester, listRequesters} from '../server/requesters.mjs';
import {isDemoPreparedQuestion, demoThreadUpdate} from '../server/demo-fixtures.mjs';
import {explain} from '../server/agent.mjs';
import {createMemory} from '../server/context.mjs';

const defaults = {recipient: 'everyone', language: 'English', need: 'Show visually'};
const evidence = title => ({content_id: title, scene_id: 'arbitrary-scene', at_seconds: 12, source: 'licensed_local',
  transcript: [{id: 'local-caption', text: 'The bridge opens when the light turns green.', end: 10}],
  facts: [{id: 'local-fact', available_at: 8, text: 'A green lamp is beside the bridge.'}]});
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'selene-communication-'));
  const old = process.env.SELENE_REQUESTERS_FILE;
  process.env.SELENE_REQUESTERS_FILE = join(root, 'requesters.json');
  t.after(async () => {
    old === undefined ? delete process.env.SELENE_REQUESTERS_FILE : process.env.SELENE_REQUESTERS_FILE = old;
    await rm(root, {recursive: true, force: true});
  });
}

test('explicit self-identification changes communication but never original film evidence', async () => {
  const context = {content_id: 'film', at_seconds: 12, transcript: [{id: 'cue', text: 'Hello.', end: 10}], facts: []};
  const input = {request: "I'm grandma. What does this mean?", recipient: 'everyone', language: 'English', need: 'Show visually'};
  const result = await requesterContext(input, context);
  assert.equal(result.input.recipient, 'grandparent');
  assert.equal(result.context.requester.source, 'declaration');
  assert.deepEqual(result.context.transcript, context.transcript);
  assert.equal(result.context.at_seconds, 12);
  assert.equal(context.requester, undefined);
  assert.equal(input.recipient, 'everyone');
  const quoted = await requesterContext({...input, request: 'The character says "I am grandma". Who is she?'}, context);
  assert.equal(quoted.input.recipient, 'everyone');
  assert.equal(quoted.context.requester, undefined);
});

test('communication overrides preserve declared role provenance through same-question follow-ups', async () => {
  const context = evidence('unlisted-local-bridge');
  for (const overrides of [
    {need: 'Explain simply'},
    {communication_preferences: {style: 'detailed', language: 'Spanish', need: 'Slower answer voice'}},
  ]) {
    const declared = await requesterContext({request: 'I am grandma. Explain this.', ...defaults, ...overrides}, context);
    assert.equal(declared.input.recipient, 'grandparent');
    assert.equal(declared.context.requester.source, 'declaration');
    const followup = await requesterContext({request: 'And why?', ...defaults,
      communication_preferences: {style: 'standard', language: 'English', need: 'Show visually'}}, declared.context);
    assert.equal(followup.context.requester.role, 'grandparent');
    assert.equal(followup.context.requester.source, 'declaration');
    assert.equal(followup.context.requester.style, 'standard');
    const selected = await requesterContext({request: 'I am grandma. Explain again.', ...defaults,
      communication_preferences: {role: 'everyone'}}, followup.context);
    assert.equal(selected.context.requester.role, 'everyone');
    assert.equal(selected.context.requester.source, 'request');
  }
});

test('arbitrary titles resolve consented profiles, current overrides and same-question continuity without changing sources', async t => {
  await store(t);
  const profile = await createRequester({label: 'Private viewer', role: 'parent', style: 'simple', language: 'Spanish', consent: true});
  const other = await createRequester({label: 'Other viewer', role: 'adult', style: 'detailed', language: 'Indonesian', consent: true});
  for (const title of ['unlisted-local-bridge', 'another-original-film']) {
    const context = evidence(title), before = structuredClone(context);
    const first = await requesterContext({request: 'Why did it open?', requester_id: profile.id, ...defaults}, context);
    assert.equal(first.input.recipient, 'parent');
    assert.equal(first.input.language, 'Spanish');
    assert.equal(first.input.need, 'Explain simply');
    assert.equal(first.context.requester.style, 'simple');
    assert.equal(first.context.requester.source, 'profile');
    assert.deepEqual(context, before);
    assert.strictEqual(first.context.transcript, context.transcript);
    assert.strictEqual(first.context.facts, context.facts);
    for (const privateKey of ['id', 'label', 'voice_samples', 'embedding']) assert.equal(privateKey in first.context.requester, false);
    const restyled = await requesterContext({request: 'Explain in more detail.', ...defaults,
      communication_preferences: {style: 'detailed', language: 'English', need: 'Show visually'}}, first.context);
    assert.equal(restyled.context.requester.role, 'parent');
    assert.equal(restyled.context.requester.source, 'profile', 'communication overrides do not relabel the enrolled role');
    assert.equal(restyled.context.requester.style, 'detailed');

    const current = await requesterContext({request: 'Explain the mechanism.', ...defaults,
      communication_preferences: {role: 'adult', style: 'detailed', language: 'English', need: 'Show visually'}}, first.context);
    assert.equal(current.input.recipient, 'adult');
    assert.equal(current.input.language, 'English', 'an explicit neutral language overrides Spanish');
    assert.equal(current.input.need, 'Show visually', 'an explicit neutral need overrides profile simplicity');
    assert.equal(current.context.requester.style, 'detailed');
    assert.equal(current.context.requester.source, 'request');
    const followup = await requesterContext({request: 'And what changes next?', ...defaults}, current.context);
    assert.deepEqual(followup.context.requester, current.context.requester);
    assert.equal(followup.input.language, 'English');
    const swapped = await requesterContext({request: 'What is the green light?', requester_id: other.id, ...defaults}, current.context);
    assert.equal(swapped.input.recipient, 'adult');
    assert.equal(swapped.input.language, 'Indonesian');
    assert.equal(swapped.context.requester.style, 'detailed');
    const newQuestion = await requesterContext({request: 'What is this?', ...defaults}, context);
    assert.equal(newQuestion.context.requester, undefined, 'new question contexts do not inherit household identity');
    assert.deepEqual(newQuestion.input, {request: 'What is this?', ...defaults});
    assert.deepEqual(current.context.transcript, before.transcript);
    assert.deepEqual(current.context.facts, before.facts);
    assert.equal(current.context.content_id, title);
    assert.equal(current.context.at_seconds, 12);
  }
  assert.deepEqual((await listRequesters()).find(value => value.id === profile.id), profile, 'turn overrides never mutate a saved profile');
});

test('role, language and communication needs are current declarations, not age or quoted-character inference', async t => {
  await store(t);
  const context = evidence('uncatalogued-video');
  const explicit = await requesterContext({request: "I'm grandma. Explain the light.", ...defaults,
    language: 'Indonesian', need: 'Slower answer voice', communication_preferences: {role: 'child', style: 'standard'}}, context);
  assert.equal(explicit.input.recipient, 'child', 'explicit current control wins over a role declaration');
  assert.equal(explicit.input.language, 'Indonesian');
  assert.equal(explicit.input.need, 'Slower answer voice');
  assert.equal(explicit.context.requester.style, 'standard');
  assert.equal(explicit.context.requester.source, 'request');
  for (const request of ['I am 72. What happened?', 'My child asks why.', 'The character says I am grandma.', 'I am grandma in this film.']) {
    const result = await requesterContext({request, ...defaults}, context);
    assert.equal(result.context.requester, undefined, request);
    assert.equal(result.input.recipient, 'everyone');
  }
  const plain = await requesterContext({request: 'Why?', ...defaults,
    communication_preferences: {need: 'Explain simply'}}, context);
  assert.equal(plain.context.requester.style, 'simple');
  assert.equal(plain.input.need, 'Explain simply');
  for (const communication_preferences of [{age: 72}, {style: 'elderly'}, {language: 'Klingon'}, {role: 'unknown'}, []])
    await assert.rejects(requesterContext({request: 'Why?', ...defaults, communication_preferences}, context), {status: 400});
  await assert.rejects(createRequester({label: 'Child', role: 'child', style: 'simple', language: 'English', consent: true}), /Guardian consent/);
  const child = await createRequester({label: 'Child', role: 'child', style: 'simple', language: 'English', consent: true, guardian_consent: true});
  assert.equal((await requesterContext({request: 'Why?', requester_id: child.id, ...defaults}, context)).input.recipient, 'child');
});

test('generated demo-matching requests never acquire authored audience or authored thread updates', async () => {
  const input = {request: 'What is offside?', at_seconds: 16, answer_mode: 'generate', ...defaults};
  const context = {content_id: 'football-match', source: 'authored_demo', requester: {role: 'grandparent', source: 'fixture'}};
  assert.equal(isDemoPreparedQuestion(input, context), false);
  const resolved = await requesterContext(input, context);
  assert.equal(resolved.input.recipient, 'everyone');
  assert.equal(resolved.context.requester, undefined);
  assert.equal(demoThreadUpdate({preferences: {answer_mode: 'generate'}}, context, []), null);
  assert.equal(demoThreadUpdate({help: {moment: {provenance: {kind: 'generated'}}}}, context, []), null);
});

test('unlisted local evidence and resolved preferences reach the same generated wording and diagram request', async t => {
  await store(t);
  const saved = Object.fromEntries(['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY'].map(key => [key, process.env[key]]));
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://local-generation.test.invalid', AGENT_PROVIDER_MODEL: 'offline-test', AGENT_PROVIDER_API_KEY: 'test-only'});
  t.after(() => {for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;});
  const context = {...evidence('unlisted-local-bridge'), source_only: true, output: 'personal',
    movie_graph: {version: 1, status: 'unavailable', nodes: [], edges: []}};
  const profile = await createRequester({label: 'Viewer', role: 'adult', style: 'detailed', language: 'Spanish', consent: true});
  const resolved = await requesterContext({request: 'Why did the bridge open?', content_id: context.content_id,
    at_seconds: context.at_seconds, playback_choice: 'keep_watching', play_state: 'playing', session: 'solo', continuation: null,
    answer_mode: 'generate', requester_id: profile.id, ...defaults}, context);
  let generated = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://local-generation.test.invalid');
    const body = JSON.parse(options.body);
    if (body.tool_choice === 'required') return Response.json({choices: [{message: {role: 'assistant', tool_calls: [
      {id: 'evidence', type: 'function', function: {name: 'get_scene_context', arguments: '{}'}},
    ]}}]});
    if (body.response_format.json_schema.name === 'selene_grounding_review')
      return Response.json({choices: [{message: {content: JSON.stringify({supported: true, issue: '', pause_requested: false})}}]});
    if (body.response_format.json_schema.name === 'selene_visual_feedback')
      return Response.json({choices: [{message: {content: JSON.stringify({action: 'keep', issue: '', response: null})}}]});
    const runtime = JSON.parse(body.messages.find(item => item.role === 'user').content.split('runtime data:\n')[1]);
    const source = JSON.parse(body.messages.find(item => item.role === 'tool').content);
    generated++;
    assert.equal(runtime.language, 'Spanish');
    assert.equal(runtime.recipient, 'adult');
    assert.equal(runtime.playback_context.requester.style, 'detailed');
    assert.deepEqual(source.transcript, context.transcript);
    assert.deepEqual(source.facts, context.facts);
    return Response.json({choices: [{message: {content: JSON.stringify({version: '1.0', state: 'response',
      answer: 'La luz verde indica que el puente puede abrirse.',
      visual: {status: 'ready', description: 'La luz verde y el puente abierto.',
        svg: '<svg viewBox="0 0 960 540"><circle id="lamp" cx="220" cy="240" r="60" fill="#ffad33"/><text x="150" y="350" fill="#f1f1f1">Luz verde</text><rect x="500" y="210" width="200" height="60" fill="#f1f1f1"/><text x="500" y="350" fill="#f1f1f1">Puente</text></svg>',
        animations: [{target_id: 'lamp', duration_ms: 1600, delay_ms: 0, keyframes: [{opacity: 0.4, transform: 'none'}, {opacity: 1, transform: 'none'}]}]},
      intervention: {playback: 'keep_watching', audio: 'silent'},
      grounding: {content_id: context.content_id, scene_id: context.scene_id, at_seconds: context.at_seconds, evidence_ids: ['local-caption'], graph_ids: []},
    })}}]});
  });
  const moment = await explain(resolved.input, {context: resolved.context, memory: createMemory()});
  assert.equal(generated, 1);
  assert.equal(moment.provenance.kind, 'generated');
  assert.deepEqual(moment.audience, {recipient: 'adult', source: 'profile'});
  assert.equal(moment.answer, 'La luz verde indica que el puente puede abrirse.');
  assert.match(moment.visual.svg, /Luz verde/);
  assert.deepEqual(moment.grounding.evidence_ids, ['local-caption']);
});
