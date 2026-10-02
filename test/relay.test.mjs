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
    SELENE_MEDIA_ORIGIN: 'https://media.test.invalid',
    SELENE_GRAPH_PATH: join(temporary, 'graph.json'), AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'test-only',
    SELENE_SCENE_CONTEXT_URL: 'https://scene.test.invalid'});
  process.env.SELENE_PRIVATE_URL = 'http://mirror.test.invalid'; // Host configured, but pairing requires HTTPS.
  const realFetch = globalThis.fetch;
  let sceneReads = 0, modelReads = 0, nextState = 'clarification', offerLife = false, sceneUnavailable = false, modelUnavailable = false, reviewIssue = '';
  let reviewedPlayback;
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
    if (body.response_format?.json_schema.name === 'selene_grounding_review') reviewedPlayback = JSON.parse(body.messages.at(-1).content).viewer.play_state;
    const message = body.tool_choice === 'required'
      ? {role: 'assistant', tool_calls: [{id: 'context', type: 'function', function: {name: 'get_scene_context', arguments: '{}'}}]}
      : body.response_format.json_schema.name === 'selene_grounding_review'
        ? {content: JSON.stringify({supported: true, issue: reviewIssue, pause_requested: false, life_requested: offerLife})}
        : (() => {
          const tool = body.messages.find(message => message.role === 'tool');
          const context = tool ? JSON.parse(tool.content) : JSON.parse(body.messages.find(message => message.role === 'user').content.split('runtime data:\n')[1]).playback_context;
          return {content: JSON.stringify({version: '1.0', state: nextState, answer: nextState === 'clarification' ? 'Which person do you mean?' : 'From your description, you mean the passer.',
            visual: {status: 'none', svg: '', animations: [], description: ''}, intervention: {playback: 'keep_watching', audio: 'silent'},
            life_connection: {offered: offerLife, question: offerLife ? 'Have you tried this yourself?' : '', recipient: 'everyone'},
            grounding: {content_id: context.content_id, scene_id: context.scene_id, at_seconds: context.at_seconds, evidence_ids: [context.return_window?.interval_evidence_ids[0] ?? context.facts.at(-1).id], graph_ids: []}, new_connections: []})};
        })();
    return Response.json({choices: [{finish_reason: 'stop', message}]});
  };
  const {server} = await import('../server/index.mjs');
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/health`, {headers: {Host: '10.0.0.2:4519'}})).status, 200, 'container health checks may use the node IP as Host');
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
  assert.match(own.story.video, /^\/media\//, 'the TV plays from its same-origin relay');
  const storyResponse = await fetch(`${base}/api/story`, {headers: {Host: 'localhost:0'}});
  assert.match((await storyResponse.json()).video, /^\/media\//);
  const mediaResponse = await fetch(`${base}/media/the-red-kite.mp4`, {headers: {Host: 'media.test.invalid', Range: 'bytes=0-31'}});
  assert.equal(mediaResponse.status, 206, 'the secure media origin can fetch a video range');
  assert.equal(mediaResponse.headers.get('content-range')?.startsWith('bytes 0-31/'), true);
  assert.equal((await mediaResponse.arrayBuffer()).byteLength, 32);
  assert.equal((await fetch(`${base}/media/the-red-kite.mp4`, {headers: {Host: 'other.test.invalid'}})).status, 403, 'unknown hosts stay blocked');
  const appResponse = await fetch(base, {headers: {Host: 'localhost:0'}});
  assert.match(appResponse.headers.get('content-security-policy'), /media-src 'self' https:\/\/media\.test\.invalid/);
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
  assert.equal((await post('/api/private/pair', {}, session_id)).status, 503, 'a phone address requires HTTPS');

  process.env.SELENE_PRIVATE_URL = 'https://mirror.test.invalid'; offerLife = true;
  assert.equal((await post('/api/companion/moment', {...input, need: 'Slower answer voice', life_connection: true}, session_id)).status, 200);
  for (const host of ['mirror.test.invalid', 'media.test.invalid']) {
    const headers = {Host: host, 'Content-Type': 'application/json'};
    for (const path of ['/api/session', '/api/playback', '/api/return', '/api/private/pair', '/api/session/end']) {
      const blocked = await fetch(`${base}${path}`, {method: 'POST', headers, body: '{}'});
      assert.equal(blocked.status, 403, 'public phone/media addresses must not expose TV-owner routes');
    }
    assert.equal((await fetch(`${base}/?join=1`, {headers})).status, 200);
    assert.equal((await fetch(`${base}/api/private/join`, {method: 'POST', headers, body: JSON.stringify({code: 'bad'})})).status, 400, 'the code exchange remains reachable');
  }
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
  // Private playback uses a separate lane and the same permitted source, never TV transport commands.
  reviewIssue = ''; offerLife = false; nextState = 'response';
  const version = own.story.content_version;
  const playback = {content_id: own.story.id, content_version: version, sequence: 1, epoch: 0, at_seconds: 35, play_state: 'playing', playback_rate: 1};
  assert.equal((await post('/api/playback', playback, session_id)).status, 409, 'a companion session cannot publish an own-player timeline');
  assert.equal((await post('/api/playback', {...playback, at_seconds: -1}, own.session_id)).status, 400);
  assert.equal((await post('/api/playback', playback, own.session_id)).status, 200);
  const personalPair = await (await post('/api/private/pair', {}, own.session_id)).json();
  assert.match(personalPair.code, /^\d{6}$/);
  const joined = await post('/api/private/join', {code: personalPair.code});
  assert.equal(joined.status, 200);
  const personalToken = (await joined.json()).token;
  assert.equal((await post('/api/private/join', {code: personalPair.code})).status, 404, 'the code is single-use');
  const personalPath = `/api/private/${personalToken}`;
  const personalStream = await fetch(`${base}${personalPath}`, {headers: {Host: 'mirror.test.invalid'}});
  const personalReader = personalStream.body.getReader();
  let eventBuffer = '';
  const decoder = new TextDecoder();
  const readEvent = async () => {
    while (true) {
      const separator = eventBuffer.indexOf('\n\n');
      if (separator >= 0) {
        const packet = eventBuffer.slice(0, separator); eventBuffer = eventBuffer.slice(separator + 2);
        const data = packet.split('\n').find(line => line.startsWith('data: '));
        if (data) return JSON.parse(data.slice(6));
      } else {
        const chunk = await personalReader.read();
        assert.equal(chunk.done, false, 'the stream should deliver the expected event before closing');
        eventBuffer += decoder.decode(chunk.value, {stream: true});
      }
    }
  };
  const bootstrap = await readEvent();
  assert.equal(bootstrap.type, 'personal');
  assert.equal(bootstrap.story.id, own.story.id);
  assert.equal(bootstrap.story.facts, undefined);
  assert.match(bootstrap.story.video, /^https:\/\/media\.test\.invalid\//, 'the private phone replay uses HTTPS media');
  const pause = await post(`${personalPath}/hold`, {content_version: version, epoch: 0});
  assert.equal(pause.status, 201);
  const held = await pause.json();
  assert.equal(held.playback.play_state, 'playing');
  const preferences = {need: 'Explain simply', language: 'English', recipient: 'everyone'};
  const privateQuestion = {branch_id: held.hold.id, request: 'Explain this line.', at_seconds: 35, clarification: false, ...preferences};
  assert.equal((await post(`${personalPath}/ask`, {...privateQuestion, at_seconds: 50})).status, 400, 'future evidence is unavailable');
  const privateAnswer = await post(`${personalPath}/ask`, privateQuestion);
  assert.equal(privateAnswer.status, 200);
  assert.equal((await privateAnswer.json()).moment.grounding.at_seconds, 35);
  const advanced = {...playback, sequence: 2, at_seconds: 45};
  await post('/api/playback', advanced, own.session_id);
  assert.equal((await readEvent()).type, 'playback', 'private questions do not publish a shared response');
  const returnInput = {content_version: version, epoch: 0, from_seconds: held.hold.from_seconds, ...preferences};
  const beforeReturn = modelReads;
  const bridge = await post(`${personalPath}/return`, {...returnInput, branch_id: held.hold.id});
  assert.equal(bridge.status, 200);
  assert.equal(modelReads - beforeReturn, 2, 'private return supplies evidence directly: one draft and one grounding review');
  const returned = await bridge.json();
  assert.equal(returned.through_seconds, 45);
  assert.equal(returned.from_seconds, 35);
  assert.ok(returned.evidence.length);
  await post('/api/playback', {...advanced, sequence: 3, play_state: 'paused'}, own.session_id);
  await readEvent();
  assert.equal((await post('/api/return', returnInput, own.session_id)).status, 200, 'family recovery uses the same return operation');
  assert.equal(reviewedPlayback, 'paused', 'a shared return must tell the model about a deliberate family pause');
  const captions = await fetch(`${base}${personalPath}/captions`, {headers: {Host: 'mirror.test.invalid'}});
  assert.match(captions.headers.get('content-type'), /text\/vtt/);
  assert.match(await captions.text(), /^WEBVTT/);
  const endPersonal = {branch_id: held.hold.id};
  assert.equal((await post(`${personalPath}/end`, endPersonal)).status, 200);
  assert.equal((await post(`${personalPath}/end`, endPersonal)).status, 200, 'a lost close response is safe to retry');
  const replacement = await (await post(`${personalPath}/hold`, {content_version: version, epoch: 0})).json();
  assert.equal((await post(`${personalPath}/end`, endPersonal)).status, 409, 'a stale close must not delete a newer branch');
  await post('/api/playback', {...playback, sequence: 4, epoch: 1, at_seconds: 10}, own.session_id);
  await readEvent();
  assert.equal((await post(`${personalPath}/ask`, {...privateQuestion, branch_id: replacement.hold.id})).status, 409, 'seeking the TV invalidates the saved phone branch');
  await post('/api/private/pair', {}, own.session_id);
  assert.equal((await readEvent()).type, 'closed');
  assert.equal((await post(`${personalPath}/hold`, {content_version: version, epoch: 1})).status, 410, 're-pairing revokes the previous token');
  await post('/api/session/end', {session_id: own.session_id});

  await post('/api/session/end', {session_id});
  assert.equal((await post('/api/companion/moment', input, session_id)).status, 410);
});
