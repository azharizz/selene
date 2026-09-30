import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {Readable} from 'node:stream';

test('real relay routes preserve clarification evidence, reject invalid input and revoke private streams', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'selene-relay-'));
  const saved = {...process.env};
  Object.assign(process.env, {SELENE_PORT: '0', SELENE_BIND: '127.0.0.1', SELENE_APP_URL: 'http://localhost:0',
    SELENE_GRAPH_PATH: join(temporary, 'graph.json'), AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'test-only',
    SELENE_SCENE_CONTEXT_URL: 'https://scene.test.invalid'});
  delete process.env.SELENE_PRIVATE_URL;
  const realFetch = globalThis.fetch;
  let sceneReads = 0, modelReads = 0, nextState = 'clarification', offerLife = false, sceneUnavailable = false, modelUnavailable = false, reviewIssue = '';
  // Only remote network boundaries are fixtures. Routing, tools, schema, review and policy are real code.
  globalThis.fetch = async (url, options) => {
    if (url === 'https://scene.test.invalid') {
      sceneReads++;
      if (sceneUnavailable) throw new TypeError('Scene service unavailable');
      const {provider} = JSON.parse(options.body);
      return Response.json({verified: true, provider_package_id: provider.package_id, provider_catalog_name: provider.catalog_name,
        provider_content_id: provider.content_id, at_seconds: provider.at_seconds, source: 'HTTP test fixture',
        scene: {id: 'test-scene', label: 'A test moment', start: 0, end: 200}, transcript: [{start: 0, end: 5, text: 'Known dialogue'}]});
    }
    if (url !== 'https://model.test.invalid') return new Promise((resolve, reject) => {
      const req = request(url, options, res => resolve(new Response(Readable.toWeb(res), {status: res.statusCode, headers: res.headers})));
      req.on('error', reject); req.end(options?.body);
    });
    modelReads++;
    if (modelUnavailable) throw new TypeError('Private upstream failure details');
    const body = JSON.parse(options.body);
    const message = body.tool_choice === 'required'
      ? {role: 'assistant', tool_calls: [{id: 'context', type: 'function', function: {name: 'get_scene_context', arguments: '{}'}}]}
      : body.response_format.json_schema.name === 'selene_grounding_review'
        ? {content: JSON.stringify({supported: true, issue: reviewIssue, pause_requested: false, life_requested: offerLife})}
        : (() => {
          const context = JSON.parse(body.messages.find(message => message.role === 'tool').content);
          return {content: JSON.stringify({version: '1.0', state: nextState, answer: nextState === 'clarification' ? 'Which person do you mean?' : 'From your description, you mean the passer.',
            visual: {status: 'none', svg: '', animations: [], description: ''}, intervention: {playback: 'keep_watching', audio: 'silent'},
            life_connection: {offered: offerLife, question: offerLife ? 'Have you tried this yourself?' : '', recipient: 'everyone'},
            grounding: {content_id: context.content_id, scene_id: context.scene_id, at_seconds: context.at_seconds, evidence_ids: [context.facts.at(-1).id], graph_ids: []}, new_connections: []})};
        })();
    return Response.json({choices: [{finish_reason: 'stop', message}]});
  };
  const {server} = await import('../server/index.mjs');
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    globalThis.fetch = realFetch;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved); await rm(temporary, {recursive: true, force: true});
  });
  const post = (path, input, session, extra = {}) => fetch(`${base}${path}`, {method: 'POST', headers: {Host: 'localhost:0', 'Content-Type': 'application/json', ...(session ? {'X-Selene-Session': session} : {}), ...extra}, body: JSON.stringify(input)});
  const sessionResponse = await post('/api/session', {mode: 'companion'});
  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json();
  assert.deepEqual(Object.keys(session), ['session_id', 'private_mirror_available'], 'companion sessions do not receive demo story or dialogue');
  const {session_id} = session;
  const input = {snapshot: {package_id: 'test.provider', session_id: 7, content_id: 'test-title', catalog_name: 'test', title: 'Test title', provider_name: 'Test', at_seconds: 10},
    request: 'Who is that?', scene_detail: '', scene_answer: '', continuation: null, play_state: 'playing', playback_choice: 'keep_watching',
    need: 'Explain simply', language: 'English', session: 'family', recipient: 'everyone', life_connection: false};
  assert.equal((await post('/api/private/life', {visible: true}, session_id)).status, 409);
  assert.equal((await post('/api/companion/moment', {...input, guessed_age: 80}, session_id)).status, 400);
  assert.equal((await post('/api/companion/moment', input, session_id, {Origin: 'https://another.invalid'})).status, 403);
  assert.equal((await post('/api/companion/moment', {...input, scene_detail: 'x'.repeat(32769)}, session_id)).status, 413);
  assert.equal(modelReads, 0);
  const own = await (await post('/api/session', {})).json();
  assert.equal((await post('/api/companion/moment', input, own.session_id)).status, 409);
  const first = await post('/api/companion/moment', input, session_id);
  assert.equal(first.status, 200); const question = await first.json();
  assert.equal(question.state, 'clarification'); assert.equal(sceneReads, 1);
  const followup = {...input, continuation: {request: input.request, question: question.answer, answer: 'The passer'}};
  assert.equal((await post('/api/companion/moment', {...followup, snapshot: {...input.snapshot, at_seconds: 11}}, session_id)).status, 409);
  assert.equal((await post('/api/companion/moment', {...followup, snapshot: {...input.snapshot, session_id: 8}}, session_id)).status, 409);
  nextState = 'response';
  const second = await post('/api/companion/moment', followup, session_id);
  assert.equal(second.status, 200); const answer = await second.json();
  assert.equal(answer.grounding.at_seconds, 10); assert.equal(answer.grounding.scene_id, question.grounding.scene_id);
  assert.equal(sceneReads, 1, 'clarification must reuse the original evidence');
  assert.ok(answer.grounding.evidence_ids.includes('viewer-clarification'));
  assert.equal((await post('/api/private/pair', {}, session_id)).status, 503, 'loopback is not a phone address');

  process.env.SELENE_PRIVATE_URL = 'https://mirror.test.invalid'; offerLife = true;
  assert.equal((await post('/api/companion/moment', {...input, need: 'Slower answer voice', life_connection: true}, session_id)).status, 200);
  const pairing = await (await post('/api/private/pair', {}, session_id)).json();
  const token = new URL(pairing.url).searchParams.get('private');
  const stream = await fetch(`${base}/api/private/${token}`, {headers: {Host: 'localhost:0'}});
  const reader = stream.body.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  assert.match(initial, /"slower_answer_voice":true/);
  assert.equal(initial.includes('Have you tried'), false, 'unconfirmed personal question stays on the TV');
  await post('/api/private/life', {visible: true}, session_id);
  assert.match(new TextDecoder().decode((await reader.read()).value), /Have you tried/);
  await post('/api/private/close', {}, session_id);
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"closed"/);
  assert.equal((await reader.read()).done, true);
  assert.equal((await fetch(`${base}/api/private/${token}`, {headers: {Host: 'localhost:0'}})).status, 404);
  sceneUnavailable = true; offerLife = false;
  const fallback = await post('/api/companion/moment', {...input, scene_detail: 'I mean the passer.'}, session_id);
  assert.equal(fallback.status, 200);
  assert.ok((await fallback.json()).grounding.evidence_ids.includes('viewer-scene-detail'));
  nextState = 'clarification';
  const fresh = await post('/api/companion/moment', {...input, request: 'Which person are you asking about?'}, session_id);
  assert.equal(fresh.status, 200); const freshQuestion = await fresh.json();
  modelUnavailable = true;
  const unavailable = await post('/api/companion/moment', {...input, request: 'Explain the pass.'}, session_id);
  assert.equal(unavailable.status, 502);
  assert.equal((await unavailable.text()).includes('Private upstream'), false);
  modelUnavailable = false;
  const stale = {...input, request: 'Which person are you asking about?', continuation: {request: 'Which person are you asking about?', question: freshQuestion.answer, answer: 'An old answer'}};
  assert.equal((await post('/api/companion/moment', stale, session_id)).status, 409);
  reviewIssue = 'The answer includes an unsupported scene detail.';
  const readsBeforeRejection = modelReads;
  assert.equal((await post('/api/companion/moment', {...input, request: 'A new question for review.'}, session_id)).status, 502, 'a contradictory approval cannot release a flagged response');
  assert.equal(modelReads - readsBeforeRejection, 5, 'one evidence call, two drafts and two reviews; no retry loop');
  await post('/api/session/end', {session_id});
  assert.equal((await post('/api/companion/moment', input, session_id)).status, 410);
});
