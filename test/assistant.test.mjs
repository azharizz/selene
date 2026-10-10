import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request} from 'node:http';
import {Readable} from 'node:stream';
import {whoIsOnScreen, triviaAt, playbackCommand, skillTools} from '../server/skills.mjs';
import {assist, route} from '../server/assistant.mjs';

const film = {id: 'demo', title: 'Demo', duration: 100,
  transcript: [{id: 'c1', start: 0, end: 5, text: 'Lyra smiled.'}, {id: 'c2', start: 40, end: 45, text: 'Voss whispered.'}],
  movie_graph: {nodes: [
    {id: 'lyra', label: 'Princess Lyra', evidence_ids: ['c1'], available_at: 5},
    {id: 'voss', label: 'Chancellor Voss', evidence_ids: ['c2'], available_at: 45}],
  edges: [{id: 'e1', subject_id: 'voss', relation: 'watched', object_id: 'lyra', available_at: 45}]},
  trivia: [{id: 't2', safe_after: 50, text: 'Later fact.'}, {id: 't1', safe_after: 0, text: 'Early fact.'}]};

test('who_is_on_screen never reveals people introduced after the TV position', () => {
  assert.deepEqual(whoIsOnScreen(film, 10).entities.map(entity => entity.id), ['lyra']);
  const later = whoIsOnScreen(film, 46);
  assert.deepEqual(later.entities.map(entity => entity.id), ['voss'], 'the recent window picks who is in this moment');
  assert.match(later.text, /Chancellor Voss watched Princess Lyra/);
  assert.equal(whoIsOnScreen(film, 2).text, 'Nobody has been introduced yet.');
  const named = {...film, transcript: [...film.transcript, {id: 'c3', start: 70, end: 72, text: 'Find Voss, the King said.'}],
    movie_graph: {...film.movie_graph, nodes: [...film.movie_graph.nodes, {id: 'lamp', label: 'a lantern', evidence_ids: ['c3'], available_at: 72}]}};
  assert.deepEqual(whoIsOnScreen(named, 75).entities.map(entity => entity.id), ['voss'], 'a name said again counts; people beat objects');
});

test('trivia is gated by safe_after and does not repeat', () => {
  assert.equal(triviaAt(film, 10).fact.id, 't1');
  assert.equal(triviaAt(film, 60).fact.id, 't2', 'the newest unlocked fact first');
  assert.equal(triviaAt(film, 60, ['t2']).fact.id, 't1');
  assert.equal(triviaAt(film, 10, ['t1']).fact, null);
});

test('control_playback returns a command for the TV, never moving it from the server', () => {
  assert.deepEqual(playbackCommand({action: 'skip_back', seconds: 10}).command, {action: 'seek', position_ms: -10000, relative: true}, 'back never moves forward');
  assert.deepEqual(playbackCommand({action: 'skip_forward', seconds: 30}).command, {action: 'seek', position_ms: 30000, relative: true});
  assert.deepEqual(playbackCommand({action: 'seek_to', seconds: 15.5}).command, {action: 'seek', position_ms: 15500, relative: false});
  assert.equal(playbackCommand({action: 'pause'}).text, 'Paused.');
  assert.throws(() => playbackCommand({action: 'seek_to'}), /Seek needs seconds/);
});

test('the router uses the model tool choice and falls back to the grounded explainer', async () => {
  const input = {request: 'Who is she?', at_seconds: 12}, story = {title: 'Demo'};
  const pick = name => async () => ({tool_calls: [{function: {name, arguments: '{"at_seconds": 99}'}}]});
  assert.equal((await route(skillTools, [], input, story, {complete: pick('who_is_on_screen')})).name, 'who_is_on_screen');
  assert.equal((await route(skillTools, [], input, story, {complete: pick('delete_everything')})).name, 'explain_moment');
  assert.equal((await route(skillTools, [], input, story, {complete: async () => {throw new Error('provider down');}})).name, 'explain_moment');
  let seen;
  await route(skillTools, [{user: 'Why offside?', assistant: 'He was beyond the defender.'}], input, story,
    {complete: async body => {seen = body; return {tool_calls: []};}});
  assert.equal(seen.tool_choice, 'required');
  assert.ok(!seen.tools.some(tool => tool.function.name === 'get_viewing_context'));
  assert.deepEqual(seen.messages.slice(1, 3).map(message => message.content), ['Why offside?', 'He was beyond the defender.'], 'earlier turns resolve follow-ups');
});

test('assistant turns retain the host playback position for later spoiler-safe context', async () => {
  const session = {contentId: 'football-match'};
  await assist(session, 'test-session', {request: 'Pause here', at_seconds: 30}, {
    client: {tools: skillTools, callTool: async () => ({structuredContent: {text: 'Paused.'}})},
    complete: async () => call('control_playback', {action: 'pause'}),
  });
  assert.equal(session.assistant.turns[0].at_seconds, 30);
});

test('the real relay runs the simulated Alexa+ through its MCP skills endpoint', async t => {
  const saved = {...process.env};
  Object.assign(process.env, {SELENE_PORT: '0', SELENE_BIND: '127.0.0.1', SELENE_APP_URL: 'http://localhost:0',
    AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'test-only',
    SELENE_PRIVATE_URL: 'https://phone.test.invalid'});
  const realFetch = globalThis.fetch;
  let nextTool = 'who_is_on_screen', nextArgs = {};
  // Only the model is a fixture; relay, MCP client, MCP server and skills are real code.
  globalThis.fetch = async (url, options) => {
    if (url !== 'https://model.test.invalid') return new Promise((resolve, reject) => {
      const req = request(url, options, res => resolve(new Response(Readable.toWeb(res), {status: res.statusCode, headers: res.headers})));
      req.on('error', reject); req.end(options?.body);
    });
    return Response.json({choices: [{finish_reason: 'tool_calls', message: {role: 'assistant',
      tool_calls: [{id: 'route', type: 'function', function: {name: nextTool, arguments: JSON.stringify(nextArgs)}}]}}]});
  };
  const {server} = await import('../server/index.mjs');
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    globalThis.fetch = realFetch;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  const post = (path, body, session, extra = {}) => fetch(`${base}${path}`, {method: 'POST', body: JSON.stringify(body),
    headers: {Host: 'localhost:0', 'Content-Type': 'application/json', ...(session ? {'X-Selene-Session': session} : {}), ...extra}});
  const {session_id, story} = await (await post('/api/session', {content_id: 'football-match'})).json();
  assert.equal(story.trivia, undefined, 'trivia stays server-side like facts');

  const mcp = {Accept: 'application/json, text/event-stream'};
  assert.equal((await post('/api/skills/mcp', {jsonrpc: '2.0', id: 1, method: 'tools/list'}, session_id, mcp)).status, 200);
  const early = await (await post('/api/skills/mcp', {jsonrpc: '2.0', id: 1, method: 'tools/list'}, session_id, {...mcp, 'MCP-Protocol-Version': '2025-11-25'})).json();
  assert.match(early.error.message, /Initialize/, 'tools need an initialized MCP client');
  assert.equal((await post('/api/skills/mcp', {jsonrpc: '2.0', id: 1, method: 'tools/list'}, session_id, {Accept: 'application/json'})).status, 406);
  assert.equal((await post('/api/skills/mcp', {}, 'missing', mcp)).status, 410);

  const ask = async (request, at_seconds = 20) => {
    const response = await post('/api/assistant', {request, content_id: 'football-match', at_seconds}, session_id);
    return {status: response.status, body: await response.json()};
  };
  assert.equal((await post('/api/assistant', {request: 'hi', content_id: 'football-match', at_seconds: 20, extra: 1}, session_id)).status, 400);
  assert.equal((await post('/api/assistant', {request: 'hi', content_id: 'other', at_seconds: 20}, session_id)).status, 400);

  const who = await ask('Who is that?');
  assert.equal(who.status, 200);
  assert.equal(who.body.tool, 'who_is_on_screen');
  assert.equal(who.body.label, 'Simulated Alexa+ experience');
  assert.ok(who.body.entities.length > 0);

  nextTool = 'control_playback'; nextArgs = {action: 'skip_back', seconds: 10};
  const back = await ask('Go back ten seconds');
  assert.deepEqual(back.body.command, {action: 'seek', position_ms: -10000, relative: true});

  nextTool = 'trivia'; nextArgs = {at_seconds: 59};
  const fun = await ask('Tell me something fun', 20);
  assert.equal(fun.body.tool, 'trivia', 'the model cannot move the spoiler boundary; at_seconds is the TV position');

  // The paired phone uses the same orchestrator. Its playback requests reach the TV on the next heartbeat.
  const pairing = await (await post('/api/private/pair', {}, session_id)).json();
  const {token} = await (await post('/api/private/join', {code: pairing.code}, null, {Host: 'phone.test.invalid'})).json();
  const phone = body => post(`/api/private/${token}/assistant`, body, null, {Host: 'phone.test.invalid'});
  assert.equal((await phone({request: 'Pause'})).status, 409, 'phone requests need a fresh TV position');
  const playback = {content_id: 'football-match', content_version: story.content_version, sequence: 1, epoch: 0, at_seconds: 30, play_state: 'playing', playback_rate: 1};
  assert.equal((await (await post('/api/playback', playback, session_id)).json()).command, undefined);
  nextTool = 'control_playback'; nextArgs = {action: 'skip_back', seconds: 10};
  const phoneBack = await (await phone({request: 'Go back ten seconds'})).json();
  assert.deepEqual(phoneBack.command, {action: 'seek', position_ms: -10000, relative: true});
  const heartbeat = await (await post('/api/playback', {...playback, sequence: 2}, session_id)).json();
  assert.deepEqual(heartbeat.command, phoneBack.command, 'the TV receives the phone command');
  assert.equal((await (await post('/api/playback', {...playback, sequence: 3}, session_id)).json()).command, undefined, 'exactly once');
  nextTool = 'explain_moment'; nextArgs = {};
  const delegated = await (await phone({request: 'Why was it offside?'})).json();
  assert.equal(delegated.delegate, true, 'explanations stay on the private phone path');
  assert.equal((await post('/api/skills/mcp', {jsonrpc: '2.0', id: 1, method: 'initialize', params: {}}, session_id, {Host: 'phone.test.invalid', Accept: 'application/json, text/event-stream'})).status, 403,
    'skills are never reachable from a phone address');
});
