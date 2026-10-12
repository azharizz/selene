import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getStory, createMemory, movieGraphEvidence} from '../server/context.mjs';
import {validPlayback, validHold, validPersonalAsk, validPersonalReturn} from '../server/contract.mjs';
import {validateMoment} from '../server/agent.mjs';
import {playerStory, recordPlayback, playbackSnapshot, requirePlayback, holdMoment, publicHold, personalContext, returnContext, guidedReturn, captionsVtt} from '../server/personal.mjs';

// Authored in the code-only phase. Do not mistake these checks for completed device/user validation.
test('personal time boundaries reject stale, reordered, changed-content and changed-position requests', () => {
  const story = getStory('the-red-kite');
  const content_version = playerStory(story).content_version;
  assert.equal(playerStory(story).facts, undefined);
  const session = {contentId: story.id, contentVersion: content_version, duration: story.duration, playback: null};
  const report = {content_id: story.id, content_version, sequence: 1, epoch: 0, at_seconds: 35, play_state: 'playing', playback_rate: 1};
  assert.ok(validPlayback(report));
  assert.equal(validPlayback({...report, playback_rate: 0}), false);
  assert.equal(validPlayback({...report, control: 'pause'}), false);
  assert.ok(recordPlayback(session, report, 1000));
  assert.equal(playbackSnapshot(session, 3000).at_seconds, 35, 'wall-clock time never exposes unseen evidence');
  assert.equal(recordPlayback(session, {...report, at_seconds: 5}, 3000), false, 'late reports cannot rewind the shared sample');
  assert.equal(session.playback.at_seconds, 35);
  assert.throws(() => requirePlayback(session, content_version, 0, 8000), /TV position is unavailable/);
  assert.throws(() => recordPlayback(session, {...report, sequence: 2, at_seconds: 200}, 3000), /outside/);
  assert.throws(() => recordPlayback(session, {...report, content_version: 'a'.repeat(64)}, 3000), /different film/);
  const input = {content_version, epoch: 0, sequence: 1, at_seconds: 35};
  assert.ok(validHold(input));
  assert.equal(validHold({...input, from_seconds: -1}), false);
  const before = structuredClone(session.playback);
  const hold = holdMoment(session, input, 3000);
  assert.deepEqual(session.playback, before, 'holding on the phone cannot change TV transport');
  assert.equal(hold.from_seconds, 35);
  assert.deepEqual(Object.keys(publicHold(hold)).sort(), ['content_version', 'epoch', 'from_seconds', 'id', 'question_at_seconds']);
  assert.throws(() => holdMoment(session, {...input, from_seconds: 36}, 3000), /already reached/);
  recordPlayback(session, {...report, sequence: 2, epoch: 1, at_seconds: 10}, 4000);
  assert.throws(() => requirePlayback(session, content_version, hold.epoch, 4000), /different point/);
  assert.equal(recordPlayback(session, {...report, sequence: 3}, 4000), false, 'an old seek generation stays invalid');
  const preferences = {need: 'Explain simply', language: 'English', recipient: 'everyone'};
  assert.ok(validPersonalAsk({branch_id: hold.id, request: 'Why?', at_seconds: 10, clarification: false, new_topic: true, ...preferences}));
  assert.equal(validPersonalAsk({branch_id: hold.id, request: 'Why?', at_seconds: 10, clarification: false, new_topic: true, ...preferences, session_id: 'TV authority'}), false);
  assert.ok(validPersonalReturn({branch_id: hold.id, content_version, epoch: 0, sequence: 1, from_seconds: 35, through_seconds: 35, ...preferences}));
});

test('returns use source evidence from the declared interval without future or generated graph facts', async () => {
  const story = getStory('the-red-kite');
  const playback = {at_seconds: 45, content_version: playerStory(story).content_version, epoch: 0};
  const context = returnContext(story, 34, playback, 'Why keep the kite?');
  assert.deepEqual(context.return_window.interval_evidence_ids, ['t4', 'f-value']);
  assert.ok(context.facts.some(fact => fact.id === 'f-history'), 'an earlier original source can explain the connection');
  assert.equal(context.facts.some(fact => fact.available_at > 45), false);
  assert.equal(context.transcript.some(line => line.end > 45), false);
  const activeCue = returnContext(story, 7.72, {at_seconds: 14.98}, '');
  assert.equal(activeCue.transcript.some(line => line.id === 't2'), false, 'unfinished narration must not leak beyond the sample');
  assert.deepEqual(activeCue.return_window.interval_evidence_ids, ['t1', 'f-family']);
  const captionBoundary = returnContext(story, 8, {at_seconds: 22}, '');
  assert.deepEqual(captionBoundary.return_window.interval_evidence_ids, ['t1', 't2', 'f-family', 'f-found']);
  assert.equal(captionBoundary.transcript.some(line => line.id === 't3'), false);
  assert.deepEqual(movieGraphEvidence(context), []);
  assert.equal(personalContext(story, 20, {at_seconds: 45, answer: 'Later answer'}).previous_help, undefined);
  assert.throws(() => returnContext(story, 46, playback), /before your saved place/);
  const preferences = {need: 'Explain simply', language: 'English', recipient: 'everyone'};
  assert.equal((await guidedReturn(story, 45, playback, preferences)).status, 'no_gap');
  assert.equal((await guidedReturn(story, 44.5, playback, preferences)).status, 'insufficient_evidence');
  const vtt = captionsVtt({transcript: [{start: 61.025, end: 65.9, text: '<script>\n\nSTYLE --> &'}]});
  assert.match(vtt, /00:01:01\.025 --> 00:01:05\.900/);
  assert.match(vtt, /&lt;script&gt; STYLE --&gt; &amp;/);
  assert.equal(vtt.includes('<script>'), false);
});

test('shared-TV Guided Return enforces its 26-word limit', () => {
  const story = getStory('football-match'), context = returnContext(story, 6, {at_seconds: 23}, '', 'shared_tv');
  const input = {request: 'Summarize the missed interval.', content_id: story.id, at_seconds: 23, play_state: 'playing', playback_choice: 'keep_watching',
    need: 'Explain simply', language: 'English', session: 'family', recipient: 'everyone', continuation: null};
  const makeMoment = answer => ({version: '1.0', state: 'response', answer, visual: {status: 'none', svg: '', description: '', animations: []},
    intervention: {playback: 'keep_watching', audio: 'silent'},
    grounding: {content_id: story.id, scene_id: context.scene_id, at_seconds: 23, evidence_ids: [context.return_window.interval_evidence_ids[0]], graph_ids: []}});
  validateMoment(makeMoment('word '.repeat(26).trim()), input, context);
  assert.throws(() => validateMoment(makeMoment('word '.repeat(27).trim()), input, context), /at most 26 words/);
});

test('provider failure is explicit and never masquerades as a completed recap', async () => {
  const story = getStory('the-red-kite');
  const playback = {at_seconds: 22, content_version: playerStory(story).content_version, epoch: 0, play_state: 'playing'};
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => {throw new TypeError('model unavailable');};
  try {
    const result = await guidedReturn(story, 8, playback, {need: 'Explain simply', language: 'English', recipient: 'everyone'}, {output: 'shared_tv', memory: createMemory()});
    assert.equal(result.status, 'unavailable');
    assert.equal(result.moment, null);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(guidedReturn(story, 8, playback, {need: 'Explain simply', language: 'English', recipient: 'everyone'}, {signal: controller.signal}), {name: 'AbortError'});
  } finally {globalThis.fetch = fetch;}
});

test('a malformed grounding review retries the review without regenerating its recap', async () => {
  const story = getStory('the-red-kite'), saved = {...process.env}, fetch = globalThis.fetch;
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'test-only'});
  let generations = 0, reviews = 0, toolRounds = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.tool_choice === 'required') {
      toolRounds++;
      return Response.json({choices: [{finish_reason: 'tool_calls', message: {role: 'assistant', tool_calls: [{id: 'context', type: 'function', function: {name: 'get_scene_context', arguments: '{}'}}]}}]});
    }
    if (body.response_format.json_schema.name === 'selene_grounding_review') {
      reviews++;
      const content = reviews === 1 ? '{invalid' : JSON.stringify({supported: true, issue: '', pause_requested: false});
      return Response.json({choices: [{finish_reason: 'stop', message: {content}}]});
    }
    generations++;
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({
      version: '1.0', state: 'response', answer: 'Maya brings a torn red kite to her grandfather’s table.',
      visual: {status: 'none', svg: '', description: '', animations: []},
      intervention: {playback: 'keep_watching', audio: 'silent'},
      grounding: {content_id: story.id, scene_id: 'the-cupboard', at_seconds: 14, evidence_ids: ['t1', 'f-family'], graph_ids: []},
    })}}]});
  };
  try {
    const result = await guidedReturn(story, 6, {at_seconds: 14, content_version: playerStory(story).content_version, epoch: 0, play_state: 'playing'},
      {need: 'Explain simply', language: 'English', recipient: 'everyone'});
    assert.equal(result.status, 'ready');
    assert.equal(toolRounds, 1, 'phone catch-up retrieves its evidence through the tool round');
    assert.equal(generations, 1, 'a malformed reviewer response must not regenerate the answer');
    assert.equal(reviews, 2, 'retry only the malformed review once');
  } finally {
    globalThis.fetch = fetch;
    for (const key of ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
  }
});

test('caption-led Guided Return never reuses removed historical frame observations', async () => {
  const story = getStory('sintel-excerpt'), saved = {...process.env}, fetch = globalThis.fetch;
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'test-only'});
  const playback = {at_seconds: 36, content_version: playerStory(story).content_version, epoch: 0, play_state: 'playing'};
  const source = returnContext(story, 20, playback, '', 'shared_tv');
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.response_format.json_schema.name === 'selene_grounding_review') {
      const review = JSON.parse(body.messages.at(-1).content);
      assert.deepEqual(review.context.return_window.interval_evidence_ids, ['caption-1', 'caption-2']);
      assert.equal(review.context.facts.some(fact => fact.source === 'model_observation'), false);
      return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({supported: true, issue: '', pause_requested: false})}}]});
    }
    const runtime = JSON.parse(body.messages.at(-1).content.split('\n').at(-1));
    assert.equal(runtime.answer_mode, 'generate', 'recaps must not inherit a prepared-example question mode');
    assert.deepEqual(runtime.playback_context.return_window.interval_evidence_ids, source.return_window.interval_evidence_ids);
    assert.equal(runtime.playback_context.facts.some(fact => fact.source === 'model_observation'), false, 'historical visual observations are not interval evidence');
    const moment = {version: '1.0', state: 'response', answer: 'Someone says they are nearly done, then tells someone to sit still.',
      visual: {status: 'none', svg: '', description: '', animations: []}, intervention: {playback: 'keep_watching', audio: 'silent'},
      grounding: {content_id: story.id, scene_id: source.scene_id, at_seconds: 36, evidence_ids: ['caption-1', 'caption-2'], graph_ids: []}};
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(moment)}}]});
  };
  try {
    const result = await guidedReturn(story, 20, playback, {answer_mode: 'prepared', need: 'Explain simply', language: 'English', recipient: 'everyone'}, {output: 'shared_tv'});
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.evidence.map(item => item.id), ['caption-1', 'caption-2']);
  } finally {
    globalThis.fetch = fetch;
    for (const key of ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
  }
});

test('Guided Return keeps a useful later caption instead of requiring every cue', async () => {
  const story = getStory('sintel-excerpt'), saved = {...process.env}, fetch = globalThis.fetch;
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'test-only'});
  const playback = {at_seconds: 78, content_version: playerStory(story).content_version, epoch: 0, play_state: 'playing'};
  const source = returnContext(story, 20, playback, '', 'shared_tv');
  let drafts = 0, reviews = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.response_format.json_schema.name === 'selene_grounding_review') {
      reviews++;
      const verdict = reviews === 1
        ? {supported: false, issue: 'Include the earlier “Good night, Scales” cue.', pause_requested: false}
        : {supported: true, issue: '', pause_requested: false};
      return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(verdict)}}]});
    }
    drafts++;
    const moment = {version: '1.0', state: 'response',
      answer: drafts === 1
        ? 'The captions say “We’re almost done” and “sit still”; later, “Get him, Scales! Come on!”'
        : 'The captions say “sit still,” then “Good night, Scales”; later, “Get him, Scales! Come on!”',
      visual: {status: 'none', svg: '', description: '', animations: []}, intervention: {playback: 'keep_watching', audio: 'silent'},
      grounding: {content_id: story.id, scene_id: source.scene_id, at_seconds: 78,
        evidence_ids: drafts === 1 ? ['caption-1', 'caption-2', 'caption-4'] : ['caption-2', 'caption-3', 'caption-4'], graph_ids: []}};
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(moment)}}]});
  };
  try {
    const result = await guidedReturn(story, 20, playback, {need: 'Explain simply', language: 'English', recipient: 'everyone'}, {output: 'shared_tv'});
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.evidence.map(item => item.id), ['caption-2', 'caption-3', 'caption-4']);
    assert.equal(drafts, 2);
    assert.equal(reviews, 2);
  } finally {
    globalThis.fetch = fetch;
    for (const key of ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
  }
});

test('a misleading optional return diagram is dropped while the reviewed recap survives', async () => {
  const story = getStory('the-red-kite'), saved = {...process.env}, fetch = globalThis.fetch;
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'test-only'});
  let reviews = 0, drafts = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.response_format.json_schema.name === 'selene_grounding_review') {
      reviews++;
      const verdict = reviews < 3
        ? {supported: false, issue: 'A connector invents an unshown repair.', pause_requested: false}
        : {supported: true, issue: '', pause_requested: false};
      return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(verdict)}}]});
    }
    drafts++;
    const moment = {
      version: '1.0', state: 'response', answer: 'Maya asks for another kite. Arun made this one with her mother at Maya’s age.',
      visual: {status: 'ready', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect x="40" y="40" width="880" height="460" fill="#202228"/><circle cx="300" cy="270" r="90" fill="#ffad33"/><rect x="570" y="180" width="180" height="180" fill="none" stroke="#f1f1f1" stroke-width="22"/><line id="connector" x1="410" y1="270" x2="530" y2="270" stroke="#ffad33" stroke-width="22"/></svg>', description: 'Two events in the story.', animations: [{target_id: 'connector', duration_ms: 1500, delay_ms: 0, keyframes: [{opacity: 0.4, transform: 'none'}, {opacity: 1, transform: 'none'}]}]},
      intervention: {playback: 'keep_watching', audio: 'silent'},
      grounding: {content_id: story.id, scene_id: 'made-together', at_seconds: 36, evidence_ids: ['t3', 'f-history'], graph_ids: []},
    };
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(moment)}}]});
  };
  try {
    const result = await guidedReturn(story, 20, {at_seconds: 36, content_version: playerStory(story).content_version, epoch: 0, play_state: 'playing'},
      {need: 'Explain simply', language: 'English', recipient: 'everyone'}, {output: 'shared_tv'});
    assert.equal(result.status, 'ready');
    assert.match(result.moment.answer, /Maya asks.*Arun made this one/);
    assert.equal(result.moment.visual.status, 'none');
    assert.equal(result.moment.intervention.playback, 'keep_watching');
    assert.equal(drafts, 2, 'give the model one chance to correct the answer or diagram before dropping the optional visual');
    assert.equal(reviews, 3, 'review the corrected result and recheck its text after an optional visual is removed');
  } finally {
    globalThis.fetch = fetch;
    for (const key of ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
  }
});

test('an early return requests bounded text without SVG and still reviews an invalid visual fallback', async () => {
  const story = getStory('the-red-kite'), saved = {...process.env}, fetch = globalThis.fetch;
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'test-only'});
  let drafts = 0, reviews = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.response_format.json_schema.name === 'selene_grounding_review') {
      reviews++;
      const {response, context} = JSON.parse(body.messages.at(-1).content);
      assert.equal(response.visual.status, 'none');
      assert.equal(context.transcript.some(cue => cue.id === 't2'), false);
      return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({supported: true, issue: '', pause_requested: false})}}]});
    }
    drafts++;
    assert.match(body.messages[0].content, /Do not generate an SVG/);
    assert.equal(body.max_tokens, 1024);
    assert.deepEqual(body.response_format.json_schema.schema.properties.visual.properties.status.enum, ['none']);
    assert.doesNotMatch(body.messages[0].content, /Renderer: for a response, generate one grounded schematic SVG/);
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({
      version: '1.0', state: 'response', answer: 'Maya brings a torn red kite to her grandfather Arun’s kitchen table.',
      visual: {status: 'ready', svg: '<svg><script>invalid()</script></svg>', description: 'A kite.', animations: []},
      intervention: {playback: 'keep_watching', audio: 'silent'},
      grounding: {content_id: story.id, scene_id: 'the-cupboard', at_seconds: 14, evidence_ids: ['t1', 'f-family'], graph_ids: []},
    })}}]});
  };
  try {
    const result = await guidedReturn(story, 6, {at_seconds: 14, content_version: playerStory(story).content_version, epoch: 0, play_state: 'playing'},
      {need: 'Explain simply', language: 'English', recipient: 'everyone'}, {output: 'shared_tv'});
    assert.equal(result.status, 'ready');
    assert.equal(result.moment.visual.status, 'none');
    assert.deepEqual(result.evidence.map(item => item.id), ['t1', 'f-family']);
    assert.equal(drafts, 1, 'an optional invalid SVG must not consume the only answer repair');
    assert.equal(reviews, 1, 'the retained text must still pass semantic review');
  } finally {
    globalThis.fetch = fetch;
    for (const key of ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
  }
});

test('return failures identify the stage without exposing provider bodies or accepting rejected text', async () => {
  const story = getStory('the-red-kite'), saved = {...process.env}, fetch = globalThis.fetch, log = console.error;
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'private-key'});
  const draft = {version: '1.0', state: 'response', answer: 'Maya brings a torn red kite to her grandfather’s table.',
    visual: {status: 'none', svg: '', description: '', animations: []}, intervention: {playback: 'keep_watching', audio: 'silent'},
    grounding: {content_id: story.id, scene_id: 'the-cupboard', at_seconds: 14, evidence_ids: ['t1'], graph_ids: []}};
  const logs = [];
  console.error = value => logs.push(value);
  try {
    for (const [scenario, stage, code, expectedCalls] of [
      ['generation_http', 'generation_provider', 'http', 1],
      ['review_http', 'review_provider', 'http', 2],
      ['json', 'response_json', 'invalid_json', 2],
      ['schema', 'validation', 'schema', 2],
      ['long', 'validation', 'answer_word_limit', 2],
      ['grounding', 'grounding', 'unsupported_claim', 4],
    ]) {
      let calls = 0;
      logs.length = 0;
      globalThis.fetch = async (_url, options) => {
        calls++;
        const body = JSON.parse(options.body);
        const reviewing = body.response_format.json_schema.name === 'selene_grounding_review';
        if (scenario === 'generation_http' || (scenario === 'review_http' && reviewing)) return new Response('private upstream details', {status: 503});
        const result = reviewing ? {supported: false, issue: 'private viewer detail is not supported', pause_requested: false}
          : scenario === 'schema' ? {answer: 'private viewer detail'} : scenario === 'long' ? {...draft, answer: 'word '.repeat(27)} : draft;
        return Response.json({choices: [{finish_reason: 'stop', message: {content: scenario === 'json' ? 'private invalid JSON' : JSON.stringify(result)}}]});
      };
      const from = scenario === 'schema' ? 6 : 0;
      const result = await guidedReturn(story, from, {at_seconds: 14, content_version: playerStory(story).content_version, epoch: 0, play_state: 'playing'},
        {need: 'Explain simply', language: 'English', recipient: 'everyone'}, {output: 'shared_tv'});
      assert.equal(result.status, 'unavailable', scenario);
      assert.equal(result.moment, null, 'unreviewed text must never be passed off as a successful recap');
      const cue = story.transcript.filter(line => line.start >= from && line.end <= 14).at(-1);
      assert.deepEqual(result.quote, cue ? {id: cue.id, at_seconds: cue.start, text: cue.text} : null, 'failure quotes only completed original dialogue within the frozen interval');
      assert.equal(calls, expectedCalls, scenario);
      assert.equal(logs.length, 1);
      const diagnostic = JSON.parse(logs[0]);
      assert.equal(diagnostic.stage, stage, scenario); assert.equal(diagnostic.code, code, scenario);
      assert.equal(diagnostic.from_seconds, from); assert.equal(diagnostic.through_seconds, 14);
      assert.doesNotMatch(logs[0], /private|Authorization|Bearer/);
      if (scenario.endsWith('_http')) assert.equal(diagnostic.http_status, 503);
    }
  } finally {
    globalThis.fetch = fetch; console.error = log;
    for (const key of ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
  }
});
