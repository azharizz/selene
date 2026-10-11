import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request} from 'node:http';
import {Readable} from 'node:stream';
import {session as fixtureSession, invitations, call} from './fixtures/conversation.mjs';

test('fixture relay automatically publishes only the phone conversation event and restores it on reconnect', async t => {
  const fixture = fixtureSession(), saved = {...process.env}, realFetch = globalThis.fetch;
  Object.assign(process.env, {SELENE_PORT: '0', SELENE_BIND: '127.0.0.1', SELENE_APP_URL: 'http://localhost:0', SELENE_PRIVATE_URL: 'https://phone.test.invalid',
    AGENT_PROVIDER_URL: 'https://conversation.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'fixture-only'});
  let generations = 0, lastContext;
  const localFetch = (url, options) => new Promise((resolve, reject) => {
    const req = request(url, options, res => resolve(new Response(Readable.toWeb(res), {status: res.statusCode, headers: res.headers})));
    req.on('error', reject); req.end(options.body);
  });
  globalThis.fetch = async (url, options) => {
    if (url !== process.env.AGENT_PROVIDER_URL) return realFetch(url, options);
    const body = JSON.parse(options.body);
    let message;
    if (body.response_format?.json_schema.name === 'selene_conversation_review') message = {content: '{"supported":true,"issue":""}'};
    else if (!body.messages.some(item => item.role === 'tool')) message = call('get_conversation_context');
    else {
      generations++; lastContext = JSON.parse(body.messages.at(-1).content);
      message = call('show_conversation_options', invitations());
    }
    return Response.json({choices: [{finish_reason: 'stop', message}]});
  };
  const {server} = await import('../server/index.mjs');
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {'Content-Type': 'application/json', Host: 'localhost:0'};
  const post = async (path, body, sessionId) => {
    const response = await localFetch(base + path, {method: 'POST', headers: {...headers, ...(sessionId ? {'X-Selene-Session': sessionId} : {})}, body: JSON.stringify(body)});
    assert.equal(response.ok, true, `${path}: ${response.status}`); return response.json();
  };
  let id; const readers = [];
  t.after(async () => {
    if (id) await post('/api/session/end', {session_id: id});
    for (const reader of readers) await reader.cancel();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  const open = await post('/api/session', {content_id: fixture.contentId}); id = open.session_id;
  const {received_at, ...playback} = fixture.playback;
  const state = await post('/api/playback', playback, id); assert.equal(state.command, undefined);
  const pairing = await post('/api/private/pair', {}, id);
  const token = new URL(pairing.url).searchParams.get('private');
  const stream = async () => {
    const response = await localFetch(`${base}/api/private/${token}`, {headers: {Host: 'phone.test.invalid'}, signal: AbortSignal.timeout(10000)});
    const reader = response.body.getReader(); readers.push(reader); let buffer = '';
    return async () => {
      while (true) {
        const index = buffer.indexOf('\n\n');
        if (index >= 0) {const value = buffer.slice(0, index); buffer = buffer.slice(index + 2); if (value.startsWith('data: ')) return JSON.parse(value.slice(6));}
        else {const part = await reader.read(); assert.equal(part.done, false); buffer += new TextDecoder().decode(part.value);}
      }
    };
  };
  const read = await stream();
  assert.equal((await read()).type, 'personal');
  const event = await read(); assert.equal(event.type, 'conversation'); assert.equal(event.conversation.options.length, 3);
  assert.equal(generations, 1); assert.equal(lastContext.playback.at_seconds, 4200);
  const unchanged = await post('/api/playback', {...playback, sequence: 2}, id);
  assert.equal(unchanged.command, undefined); assert.equal(unchanged.playback.play_state, 'playing');
  assert.equal((await read()).type, 'playback');
  const reconnected = await stream(); const bootstrap = await reconnected();
  assert.equal(bootstrap.conversation.id, event.conversation.id); assert.equal(generations, 1);
  await post('/api/playback', {...playback, sequence: 3, epoch: 1, at_seconds: 4100}, id);
  assert.equal((await read()).type, 'playback');
  assert.deepEqual(await read(), {type: 'conversation', conversation: null});
  await post('/api/private/close', {}, id);
  assert.equal((await read()).type, 'closed');
});
