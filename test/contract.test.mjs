import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validRequest, validCompanionRequest, validResponse, quietResponse} from '../server/contract.mjs';
import {sceneContext, companionContext, movieGraphEvidence, callTool, story, createMemory} from '../server/context.mjs';
import {validateVisual} from '../server/visual.mjs';
import {validateMoment, explain} from '../server/agent.mjs';

const request = {request: 'Why does he keep the kite?', content_id: 'the-red-kite', at_seconds: 44, play_state: 'playing', playback_choice: 'keep_watching', need: 'Explain simply', language: 'English', session: 'family', recipient: 'everyone',};
const animation = {target_id: 'connection', duration_ms: 1500, delay_ms: 0, keyframes: [{opacity: 0.4, transform: 'translate(0px, 8px)'}, {opacity: 1, transform: 'translate(0px, 0px)'}]};
const visual = {status: 'ready', description: 'The kite connects two generations.', animations: [animation], svg: '<svg viewBox="0 0 960 540"><rect width="960" height="540" fill="#182421"/><text id="label" x="60" y="120" font-size="48" fill="#f6f2e9">Made together</text><line id="connection" x1="80" y1="220" x2="700" y2="220" stroke="#e8bb70" stroke-width="18"/></svg>'};
const result = () => ({...quietResponse(request, 'made-together'), state: 'response', answer: 'Arun made this kite with Maya’s mother.', visual: structuredClone(visual), grounding: {content_id: story.id, scene_id: 'made-together', at_seconds: 44, evidence_ids: ['f-history'], graph_ids: []}});

test('request trust boundary rejects unknown fields, future times and inferred preferences', () => {
  assert.equal(validRequest(request), true);
  for (const altered of [{...request, at_seconds: 100}, {...request, request: 'x'.repeat(601)}, {...request, recipient: 'probably old'}, {...request, provider_url: 'https://evil.invalid'}, {...request, obsolete_option: 'yes'}]) assert.equal(validRequest(altered), false);
});
test('every moment excludes future facts, unfinished dialogue and future graph relationships', () => {
  for (let at = 0; at <= story.duration; at += 0.25) {
    const context = sceneContext(at);
    assert.ok(context.transcript.every(t => t.end <= at));
    assert.ok(context.facts.every(f => f.available_at <= at));
    assert.ok(movieGraphEvidence(context).every(g => g.available_at <= at));
  }
  assert.equal(sceneContext(32.99).facts.some(f => f.id === 'f-history'), false);
  assert.equal(sceneContext(33).facts.some(f => f.id === 'f-history'), true);
  assert.deepEqual(movieGraphEvidence(sceneContext(32)), []);
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
    '<g id="a"/><g id="a"/>',
    '<use href="#label"/>', '<rect xmlns="http://www.w3.org/1999/xhtml"/>',
  ];
  for (const markup of bad) assert.throws(() => validateVisual({...visual, svg: visual.svg.replace('</svg>', `${markup}</svg>`)}), markup);
  assert.throws(() => validateVisual({...visual, svg: '<!DOCTYPE svg><svg viewBox="0 0 960 540"/>'}));
  assert.throws(() => validateVisual({...visual, svg: '<svg viewBox="0 0 960 540"><g></svg>'}));
});
test('animation schema permits free motion and counts while requiring finite timing and known targets', () => {
  assert.equal(validResponse({...result(), visual: {...visual, animations: []}}), false);
  assert.equal(validateVisual({...visual, animations: [animation]}).animations.length, 1);
  assert.throws(() => validateVisual({...visual, animations: [{...animation, target_id: 'missing'}]}), /Animation target "missing" needs a matching id attribute/);
  for (const a of [{...animation, target_id: 'label'}, {...animation, target_id: 'missing'}, {...animation, duration_ms: 1499}, {...animation, keyframes: [{opacity: 1, transform: 'rotate(var(--angle))'}, {opacity: 1, transform: 'none'}]}]) assert.throws(() => validateVisual({...visual, animations: [a]}));
  const free = {...animation, duration_ms: 5000, delay_ms: 8000, keyframes: [{opacity: 0.4, transform: 'translate(1000px, 2000px) scale(5)'}, {opacity: 0.5, transform: 'rotate(3000deg)'}, {opacity: 1, transform: 'none'}]};
  const response = {...result(), visual: {...visual, animations: Array.from({length: 5}, () => structuredClone(free))}};
  assert.equal(validResponse(response), true);
  assert.equal(validateVisual(response.visual).animations.length, 5);
  for (const changes of [{duration_ms: 1499}, {delay_ms: -1}, {duration_ms: Number.MAX_SAFE_INTEGER + 1}, {keyframes: [{opacity: 1, transform: 'none'}]}, {keyframes: [{opacity: -0.1, transform: 'none'}, {opacity: 1, transform: 'none'}]}]) {
    assert.equal(validResponse({...result(), visual: {...visual, animations: [{...animation, ...changes}]}}), false);
  }
});
test('answer memory has no graph connection or cached-visual tool paths', () => {
  assert.throws(() => callTool('get_cached_visual', {connection_id: 'old'}, 44), /Invalid model tool call/);
  assert.throws(() => callTool('lookup_connections', {query: 'kite'}, 44), /Invalid model tool call/);
});
test('host policy wins and unsafe visual becomes answer-only fallback', () => {
  const moment = result(); moment.intervention.playback = 'request_pause'; moment.visual.svg = '<script/>';
  assert.throws(() => validateMoment(structuredClone(moment), request, undefined, undefined, false), /Repair the visual/);
  const checked = validateMoment(moment, request);
  assert.equal(checked.intervention.playback, 'keep_watching');
  assert.equal(checked.visual.status, 'fallback'); assert.equal(checked.visual.svg, '');
  assert.ok(checked.answer); assert.equal(validResponse(checked), true);
  const oversized = result(); oversized.visual.description = 'x'.repeat(241);
  assert.equal(validateMoment(oversized, request).visual.status, 'fallback');
});
test('fabricated citations, changed recipients and stale context fail closed', () => {
  const oversized = result(); oversized.answer = 'x'.repeat(561);
  assert.throws(() => validateMoment(oversized, request), /\/answer must NOT have more than 560 characters/);
  const future = result(); future.grounding.evidence_ids = ['f-new-memory'];
  assert.throws(() => validateMoment(future, request));
  const stale = result(); stale.grounding.at_seconds = 90;
  assert.throws(() => validateMoment(stale, request));
});
test('no request is quiet and never requires an agent call', async () => {
  const quiet = await explain({...request, request: ''});
  assert.equal(quiet.state, 'quiet'); assert.equal(quiet.answer, '');
  assert.equal(quiet.visual.status, 'none');
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
  assert.deepEqual(movieGraphEvidence(context), []);
  const normalized = {...preferences, content_id: context.content_id, at_seconds: snapshot.at_seconds};
  const response = {...quietResponse(normalized, context.scene_id), state: 'response', answer: 'From your description, the flag went up after a forward pass.'};
  response.grounding.evidence_ids = ['viewer-scene-detail'];
  assert.doesNotThrow(() => validateMoment(response, normalized, context));
  response.grounding.graph_ids = ['g-soccer-offside'];
  assert.throws(() => validateMoment(response, normalized, context), /unavailable evidence/);
  response.grounding.graph_ids = [];
  response.grounding.evidence_ids = ['f-history'];
  assert.throws(() => validateMoment(response, normalized, context));
  const other = companionContext({...snapshot, package_id: 'another.provider'}, input.scene_detail);
  assert.notEqual(other.content_id, context.content_id);
});


test('compact label-free diagrams retain accessible descriptions and reject empty SVGs', () => {
  const icon = {...visual, svg: '<svg viewBox="0 0 960 540"><path id="connection" d="M200 270H760" stroke="#ffad33" stroke-width="20"/><polygon points="720,230 760,270 720,310" fill="#ffad33"/></svg>'};
  assert.match(validateVisual(icon).svg, /aria-label="The kite connects two generations."/);
  assert.throws(() => validateVisual({...icon, description: ''}));
  assert.match(validateVisual({...icon, svg: '<svg viewBox="0 0 960 540"><circle id="connection" cx="480" cy="270" r="70"/></svg>'}).svg, /circle/);
  assert.throws(() => validateVisual({...icon, svg: '<svg viewBox="0 0 960 540"/>'}));
});

test('ordinary explanations repair missing animation without a semantic veto or word-count gate', async t => {
  const keys = ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'test-only'});
  t.after(() => { for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; });
  let drafts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.response_format.json_schema.name === 'selene_visual_feedback')
      return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({action: 'keep', issue: '', response: null})}}]});
    assert.equal(body.response_format.json_schema.name, 'selene_moment_response', 'ordinary answers do not run grounding review');
    const moment = result();
    moment.answer = Array(36).fill('word').join(' ');
    moment.visual = drafts++ === 0 ? {status: 'none', svg: '', description: '', animations: []} : structuredClone(visual);
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(moment)}}]});
  });
  const moment = await explain({...request, request: 'Explain the visible connection, please.'}, {
    context: {...sceneContext(44), source_only: true},
    inspect: async () => ({viewport: {width: 1280, height: 720}, frames: [], observations: []}),
  });
  assert.equal(drafts, 2);
  assert.equal(moment.visual.status, 'ready');
  assert.equal(moment.visual.animations.length, 1);
  assert.equal(moment.answer.split(' ').length, 36);
});
