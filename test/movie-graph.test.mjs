import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildMovieGraph, validateMovieGraph, movieGraphAt} from '../server/movie-graph.mjs';
import {sceneContext, movieGraphEvidence, createMemory, getStory} from '../server/context.mjs';
import {quietResponse} from '../server/contract.mjs';
import {validateMoment, explain} from '../server/agent.mjs';
import {playerStory, personalContext} from '../server/personal.mjs';

const story = () => ({id: 'graph-test-film', title: 'Graph test', duration: 100, video: '/media/graph-test-film/video.mp4',
  ingestion: {model: 'caption-model'}, scenes: [{id: 'all', start: 0, end: 100, label: 'Entire film'}], facts: [],
  transcript: [{id: 'c1', start: 1, end: 3, text: 'Good night, Scales.', source: 'imported_caption'},
    {id: 'c2', start: 20, end: 23, text: 'Scales brings the key.', source: 'imported_caption'},
    {id: 'c3', start: 80, end: 83, text: 'Scales?', source: 'imported_caption'}]});
const graph = () => ({nodes: [{id: 'scales', label: 'Scales', evidence_ids: ['c1']},
  {id: 'repeat', label: 'scales', evidence_ids: ['c3']}, {id: 'key', label: 'key', evidence_ids: ['c2']}],
  edges: [{id: 'bringing', subject_id: 'repeat', relation: 'brings', object_id: 'key', explanation: 'Scales brings the key.', evidence_ids: ['c2']}]});

test('merged movie graph keeps earliest established labels and filters all future nodes and edges', () => {
  const film = story(); film.movie_graph = validateMovieGraph(film, graph());
  assert.equal(film.movie_graph.nodes.length, 2);
  assert.equal(film.movie_graph.nodes[0].available_at, 3, 'later mentions do not hide a known label');
  assert.equal(film.movie_graph.edges[0].subject_id, 'scales');
  assert.equal(film.movie_graph.edges[0].available_at, 23);
  assert.deepEqual(movieGraphAt(film, 2.99).nodes, []);
  assert.deepEqual(movieGraphAt(film, 3).nodes.map(node => node.label), ['Scales']);
  assert.deepEqual(movieGraphAt(film, 22).edges, []);
  assert.equal(movieGraphAt(film, 23).edges.length, 1);
  const late = {...graph(), nodes: [...graph().nodes, {id: 'late', label: 'Scales?', evidence_ids: ['c3']}]};
  film.movie_graph = validateMovieGraph(film, late);
  assert.equal(sceneContext(23, film).movie_graph.nodes.some(node => node.id === 'late'), false);
  assert.deepEqual(sceneContext(23, film).transcript.map(cue => cue.id), ['c1', 'c2']);
  assert.equal(playerStory(film).movie_graph, undefined, 'full graph labels never leak in player catalog');
});

test('graph validation rejects unknown captions, endpoints, duplicated IDs and fabricated labels', () => {
  const film = story();
  assert.throws(() => validateMovieGraph(film, {...graph(), nodes: [{id: 'x', label: 'Scales', evidence_ids: ['future-unknown']}]}), /unknown caption/);
  assert.throws(() => validateMovieGraph(film, {...graph(), edges: [{...graph().edges[0], object_id: 'missing'}]}), /unknown nodes/);
  assert.throws(() => validateMovieGraph(film, {...graph(), nodes: [...graph().nodes, graph().nodes[0]]}), /unique/);
  assert.throws(() => validateMovieGraph(film, {...graph(), nodes: [{id: 'x', label: 'Invented identity', evidence_ids: ['c1']}]}), /label is absent/);
});

test('caption graph labels may span consecutive cues only with every source word cited and completed', () => {
  const film = story();
  film.transcript = [{id: 'c1', start: 1, end: 2, text: 'Someone in a green'},
    {id: 'c2', start: 2.1, end: 3, text: 'cloak was following him.'},
    {id: 'c3', start: 4, end: 5, text: 'A stranger wears green.'},
    {id: 'c4', start: 6, end: 7, text: 'Other words intervene.'},
    {id: 'c5', start: 8, end: 9, text: 'cloak'}];
  const value = evidence_ids => ({nodes: [{id: 'cloak', label: 'green cloak', evidence_ids}], edges: []});
  film.movie_graph = validateMovieGraph(film, value(['c2', 'c1']));
  assert.equal(film.movie_graph.nodes[0].available_at, 3);
  assert.deepEqual(movieGraphAt(film, 2.99).nodes, []);
  assert.equal(movieGraphAt(film, 3).nodes[0].label, 'green cloak');
  assert.throws(() => validateMovieGraph(film, value(['c1'])), /label is absent/);
  assert.throws(() => validateMovieGraph(film, value(['c3', 'c5'])), /label is absent/);
});

test('source-only responses may use this movie graph only with all original supporting completed captions', () => {
  const film = story(); film.movie_graph = validateMovieGraph(film, graph());
  const context = {...sceneContext(23, film), source_only: true};
  const input = {request: 'What does Scales bring?', content_id: film.id, at_seconds: 23, play_state: 'playing', playback_choice: 'keep_watching'};
  const moment = {...quietResponse(input, 'all'), state: 'response', answer: 'Scales brings the key.'};
  moment.grounding.evidence_ids = ['c1', 'c2']; moment.grounding.graph_ids = ['bringing'];
  assert.equal(validateMoment(moment, input, context).answer, 'Scales brings the key.');
  assert.equal(movieGraphEvidence(context).length, 3);
  moment.grounding.evidence_ids = ['c2'];
  assert.throws(() => validateMoment(moment, input, context), /original supporting captions/);
  moment.grounding.evidence_ids = ['c1', 'c2']; moment.grounding.graph_ids = ['another-title'];
  assert.throws(() => validateMoment(moment, input, context), /unavailable evidence/);
});

test('graph generation submits the entire transcript once and surfaces context/output failures', async t => {
  const saved = {...process.env};
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_API_KEY: 'test-only', AGENT_PROVIDER_MODEL: 'full-caption-model'});
  t.after(() => {for (const key of ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_API_KEY', 'AGENT_PROVIDER_MODEL']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];});
  const film = story();
  film.transcript = Array.from({length: 1600}, (_, index) => ({id: `caption-${index}`, start: index * 2, end: index * 2 + 1, text: `Line ${index} contains all original words.`, source: 'imported_caption'}));
  let calls = 0, failure = false;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++; const body = JSON.parse(options.body);
    assert.equal(body.model, 'full-caption-model');
    assert.deepEqual(JSON.parse(body.messages[1].content).transcript, film.transcript);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.ok(options.signal);
    if (failure) return new Response('context too large', {status: 413});
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({nodes: [], edges: []})}}]});
  });
  assert.equal((await buildMovieGraph(film)).status, 'ready'); assert.equal(calls, 1);
  failure = true;
  await assert.rejects(buildMovieGraph(film), /HTTP 413.*entire transcript.*without truncation/);
  assert.equal(calls, 2, 'no truncation retry or invented fallback');
  assert.deepEqual(await buildMovieGraph({...film, transcript: []}), {version: 1, status: 'unavailable', model: '', nodes: [], edges: []});
  assert.equal(calls, 2, 'no captions explicitly produce an empty unavailable graph');
});

test('ordinary imported answers receive ten raw images without a reviewer veto or cached image bytes', async t => {
  const film = getStory('sintel-excerpt'), saved = {...process.env}, previousGraph = film.movie_graph;
  delete film.movie_graph;
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_API_KEY: 'test-only',
    AGENT_PROVIDER_MODEL: 'vision-answer-model'});
  t.after(() => {
    previousGraph === undefined ? delete film.movie_graph : film.movie_graph = previousGraph;
    for (const key of ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_API_KEY', 'AGENT_PROVIDER_MODEL']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
  });
  let graphCalls = 0, answers = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body), name = body.response_format.json_schema.name;
    let value;
    if (name === 'selene_movie_caption_graph') {
      graphCalls++;
      assert.deepEqual(JSON.parse(body.messages[1].content).transcript, film.transcript);
      value = {nodes: [], edges: []};
    } else if (name === 'selene_visual_feedback') {
      const source = body.messages.find(message => message.role === 'user').content;
      assert.equal(source.filter(part => part.type === 'image_url').length, 10, 'feedback retains original fresh source images');
      assert.equal(body.model, 'vision-answer-model', 'the configured generation model also inspects its diagram');
      value = {action: 'keep', issue: '', response: null};
    } else if (name === 'selene_window_observations') {
      assert.fail('Fresh source images go directly to generation without a preliminary observation-model pass');
    } else {
      const content = body.messages.findLast(message => message.role === 'user').content;
      assert.ok(Array.isArray(content), 'generation must actually be multimodal');
      const images = content.filter(part => part.type === 'image_url').map(part => part.image_url.url);
      assert.equal(images.length, 10);
      assert.ok(images.every(url => url.startsWith('data:image/jpeg;base64,')));
      assert.equal(content[0].text.includes('data:image'), false, 'image bytes stay outside runtime JSON');
      assert.notEqual(name, 'selene_grounding_review', 'ordinary explanations have no second-model veto');
      answers++;
      const context = JSON.parse(content[0].text.split('runtime data:\n')[1]).playback_context;
      assert.deepEqual(context.transcript, film.transcript.filter(cue => cue.end <= 75));
      assert.equal(context.frame_images, undefined);
      const after = context.facts.find(fact => fact.source === 'source_frame' && fact.relation === 'after');
      assert.ok(after && after.frame_at_seconds <= 85);
      value = {...quietResponse({content_id: film.id, at_seconds: 75}, context.scene_id), state: 'response',
        answer: 'After the question, the sampled frames suggest a figure.',
        visual: {status: 'ready', description: 'A figure is revealed.',
          svg: '<svg viewBox="0 0 960 540"><g id="figure" fill="#ffad33"><circle cx="480" cy="180" r="60"/><rect x="420" y="260" width="120" height="170"/></g></svg>',
          animations: [{target_id: 'figure', duration_ms: 1600, delay_ms: 0, keyframes: [{opacity: 0.4, transform: 'none'}, {opacity: 1, transform: 'none'}]}]}};
      value.grounding.evidence_ids = [after.id];
    }
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(value)}}]});
  });
  const memory = createMemory();
  const input = {request: 'What appears around this question?', content_id: film.id, at_seconds: 75, play_state: 'playing',
    playback_choice: 'keep_watching', need: 'Show visually', language: 'English', session: 'family', recipient: 'everyone'};
  for (let call = 0; call < 2; call++) assert.equal((await explain(input, {memory,
    inspect: async () => ({viewport: {width: 1280, height: 720}, frames: [], observations: []}),
  })).state, 'response');
  assert.deepEqual([graphCalls, answers], [1, 2], 'graph is movie-local once, but each ordinary question freshly captures and generates');
  assert.equal(memory.responses.size, 0, 'fresh imported answers are not replayed from an earlier capture');
});

test('Follow thread on an ingested film sends the ten fresh frames and can return a diagram', async t => {
  const film = getStory('football-match'), saved = {...process.env};
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_API_KEY: 'test-only', AGENT_PROVIDER_MODEL: 'vision-answer-model'});
  t.after(() => {for (const key of ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_API_KEY', 'AGENT_PROVIDER_MODEL']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];});
  const cue = film.transcript.filter(line => line.end <= 30).at(-1);
  const context = {...personalContext(film, 30, null, 'Who is she?'), follow_thread: {question: 'Who is she?', new_evidence_ids: [cue.id]}};
  const imageCount = message => (Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image_url').length;
  const seen = {tool: 0, generation: 0, review: 0};
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body), name = body.response_format?.json_schema.name;
    if (body.tool_choice === 'required') {
      seen.tool++;
      return Response.json({choices: [{finish_reason: 'tool_calls', message: {role: 'assistant', tool_calls: [{id: 'context', type: 'function', function: {name: 'get_scene_context', arguments: '{}'}}]}}]});
    }
    if (name === 'selene_movie_caption_graph') return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({nodes: [], edges: []})}}]});
    if (name === 'selene_grounding_review') {
      seen.review++;
      assert.equal(body.messages.reduce((sum, message) => sum + imageCount(message), 0), 10, 'the reviewer sees the same frames');
      return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({supported: true, issue: '', pause_requested: false})}}]});
    }
    seen.generation++;
    assert.equal(imageCount(body.messages.find(message => message.role === 'user')), 10, 'Follow thread is multimodal');
    const value = {...quietResponse({content_id: film.id, at_seconds: 30}, context.scene_id), state: 'response', answer: 'A new caption answers who she is.',
      visual: {status: 'ready', description: 'A figure is revealed.',
        svg: '<svg viewBox="0 0 960 540"><g id="figure" fill="#ffad33"><circle cx="480" cy="180" r="60"/><rect x="420" y="260" width="120" height="170"/></g></svg>',
        animations: [{target_id: 'figure', duration_ms: 1600, delay_ms: 0, keyframes: [{opacity: 0.4, transform: 'none'}, {opacity: 1, transform: 'none'}]}]}};
    value.grounding.evidence_ids = [cue.id];
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(value)}}]});
  });
  const input = {request: 'Who is she?', content_id: film.id, at_seconds: 30, play_state: 'playing', playback_choice: 'keep_watching',
    need: 'Show visually', language: 'English', session: 'family', recipient: 'everyone'};
  const moment = await explain(input, {memory: createMemory(), context});
  assert.deepEqual(seen, {tool: 1, generation: 1, review: 1});
  assert.equal(moment.visual.status, 'ready', 'a thread update keeps its diagram for the phone to draw');
});
