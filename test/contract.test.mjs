import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validRequest, validCompanionRequest, validResponse, quietResponse} from '../server/contract.mjs';
import {sceneContext, companionContext, connections, callTool, story, createMemory, remember} from '../server/context.mjs';
import {validateVisual} from '../server/visual.mjs';
import {validateMoment, explain} from '../server/agent.mjs';

const request = {request: 'Why does he keep the kite?', content_id: 'the-red-kite', at_seconds: 44, play_state: 'playing', playback_choice: 'keep_watching', need: 'Explain simply', language: 'English', session: 'family', recipient: 'everyone', life_connection: false};
const visual = {status: 'ready', description: 'The kite connects two generations.', animations: [], svg: '<svg viewBox="0 0 960 540"><rect width="960" height="540" fill="#182421"/><text id="label" x="60" y="120" font-size="48" fill="#f6f2e9">Made together</text><line id="connection" x1="80" y1="220" x2="700" y2="220" stroke="#e8bb70" stroke-width="6"/></svg>'};
const result = () => ({...quietResponse(request, 'made-together'), state: 'response', answer: 'Arun made this kite with Maya’s mother.', visual: structuredClone(visual), grounding: {content_id: story.id, scene_id: 'made-together', at_seconds: 44, evidence_ids: ['f-history'], graph_ids: ['g-kite-history']}});

test('request trust boundary rejects unknown fields, future times and inferred preferences', () => {
  assert.equal(validRequest(request), true);
  for (const altered of [{...request, at_seconds: 100}, {...request, request: 'x'.repeat(601)}, {...request, recipient: 'probably old'}, {...request, provider_url: 'https://evil.invalid'}, {...request, life_connection: 'yes'}]) assert.equal(validRequest(altered), false);
});
test('every moment excludes future facts, unfinished dialogue and future graph relationships', () => {
  for (let at = 0; at <= story.duration; at += 0.25) {
    const context = sceneContext(at);
    assert.ok(context.transcript.every(t => t.end <= at));
    assert.ok(context.facts.every(f => f.available_at <= at));
    assert.ok(connections(at).every(g => g.available_at <= at));
  }
  assert.equal(sceneContext(32.99).facts.some(f => f.id === 'f-history'), false);
  assert.equal(sceneContext(33).facts.some(f => f.id === 'f-history'), true);
  assert.equal(connections(32).some(g => g.id === 'g-kite-history'), false);
});
test('tools use the host boundary, not model-supplied time', () => {
  assert.deepEqual(callTool('get_scene_context', {}, 9), sceneContext(9));
  assert.throws(() => callTool('get_scene_context', {at_seconds: 96}, 9));
  assert.throws(() => callTool('pause_playback', {}, 9));
  assert.throws(() => callTool('lookup_connections', {query: {}}, 9));
});
test('safe SVG remains renderable; active and remote content is rejected', () => {
  assert.match(validateVisual(visual).svg, /role="img"/);
  const bad = [
    '<script>alert(1)</script>', '<foreignObject><div>html</div></foreignObject>',
    '<image href="https://evil.invalid/image"/>', '<g onclick="alert(1)"></g>',
    '<path fill="url(https://evil.invalid)"/>', '<style>body{display:none}</style>',
    '<animate attributeName="opacity" repeatCount="indefinite"/>',
    '<text font-size="12">Too small</text>', '<g id="a"/><g id="a"/>',
    '<use href="#label"/>', '<rect xmlns="http://www.w3.org/1999/xhtml"/>',
  ];
  for (const markup of bad) assert.throws(() => validateVisual({...visual, svg: `<svg viewBox="0 0 960 540">${markup}</svg>`}), markup);
  assert.throws(() => validateVisual({...visual, svg: '<!DOCTYPE svg><svg viewBox="0 0 960 540"/>'}));
  assert.throws(() => validateVisual({...visual, svg: '<svg viewBox="0 0 960 540"><g></svg>'}));
});
test('animation is finite data, with known target and conservative keyframes', () => {
  const animation = {target_id: 'connection', duration_ms: 600, delay_ms: 0, keyframes: [{opacity: 0.4, transform: 'translate(0px, 8px)'}, {opacity: 1, transform: 'translate(0px, 0px)'}]};
  assert.equal(validateVisual({...visual, animations: [animation]}).animations.length, 1);
  for (const a of [{...animation, target_id: 'label'}, {...animation, target_id: 'missing'}, {...animation, duration_ms: 4000, delay_ms: 1000}, {...animation, keyframes: [{opacity: 1, transform: 'rotate(3000deg)'}, {opacity: 1, transform: 'none'}]}]) assert.throws(() => validateVisual({...visual, animations: [a]}));
});
test('reviewed visual reuse stays in its viewing session, scene and spoiler boundary', () => {
  const memory = createMemory();
  const moment = result();
  moment.visual = validateVisual({...visual, description: 'Arun & Maya’s mother made the kite together.'});
  remember(memory, moment);
  const connection = memory.connections[0];
  assert.equal(connection.scene_id, 'made-together');
  assert.equal(connection.available_at, 44);
  assert.equal(callTool('get_cached_visual', {connection_id: connection.id}, 43, memory).available, false);
  assert.equal(callTool('get_cached_visual', {connection_id: connection.id}, 60, memory).available, false);
  assert.equal(callTool('get_cached_visual', {connection_id: connection.id}, 44, createMemory()).available, false);
  const cached = callTool('get_cached_visual', {connection_id: connection.id}, 44, memory);
  assert.equal(cached.visual.status, 'ready');
  assert.doesNotThrow(() => validateVisual(cached.visual));
  remember(memory, moment);
  assert.equal(memory.connections.length, 1);
});
test('host policy wins and unsafe visual becomes answer-only fallback', () => {
  const moment = result(); moment.intervention.playback = 'request_pause'; moment.visual.svg = '<script/>';
  const checked = validateMoment(moment, request);
  assert.equal(checked.intervention.playback, 'keep_watching');
  assert.equal(checked.visual.status, 'fallback'); assert.equal(checked.visual.svg, '');
  assert.ok(checked.answer); assert.equal(validResponse(checked), true);
});
test('fabricated citations, changed recipients and stale context fail closed', () => {
  const future = result(); future.grounding.evidence_ids = ['f-new-memory'];
  assert.throws(() => validateMoment(future, request));
  const stale = result(); stale.grounding.at_seconds = 90;
  assert.throws(() => validateMoment(stale, request));
  const recipient = result(); recipient.life_connection.recipient = 'child';
  assert.throws(() => validateMoment(recipient, request));
});
test('no request is quiet and never requires an agent call', async () => {
  const quiet = await explain({...request, request: ''});
  assert.equal(quiet.state, 'quiet'); assert.equal(quiet.answer, '');
  assert.equal(quiet.visual.status, 'none'); assert.equal(quiet.life_connection.offered, false);
  assert.equal(validResponse(quiet), true);
});

test('third-party evidence stays separate from the demo film and is identified as viewer-supplied', () => {
  const snapshot = {package_id: 'test.sports', session_id: 8, catalog_name: 'test', content_id: 'match-1', title: 'A live match', provider_name: 'Test Sports', at_seconds: 4500.25};
  const {content_id, at_seconds, ...preferences} = request;
  const input = {...preferences, snapshot, scene_detail: 'A player passed forward and the flag went up.', scene_answer: '', continuation: null};
  assert.equal(validCompanionRequest(input), true);
  assert.equal(validCompanionRequest({...input, snapshot: {...snapshot, at_seconds: null}}), false);
  const context = companionContext(snapshot, input.scene_detail);
  assert.equal(context.scene, null);
  assert.deepEqual(context.transcript, []);
  assert.equal(context.facts.find(fact => fact.id === 'viewer-scene-detail').source, 'viewer');
  assert.deepEqual(callTool('get_scene_context', {}, snapshot.at_seconds, createMemory(), context), context);
  assert.deepEqual(connections(snapshot.at_seconds, '', createMemory(), context), []);
  const normalized = {...preferences, content_id: context.content_id, at_seconds: snapshot.at_seconds};
  const response = {...quietResponse(normalized, context.scene_id), state: 'response', answer: 'From your description, the flag went up after a forward pass.'};
  response.grounding.evidence_ids = ['viewer-scene-detail'];
  assert.doesNotThrow(() => validateMoment(response, normalized, context));
  response.grounding.evidence_ids = ['f-history'];
  assert.throws(() => validateMoment(response, normalized, context));
  const other = companionContext({...snapshot, package_id: 'another.provider'}, input.scene_detail);
  assert.notEqual(other.content_id, context.content_id);
});
