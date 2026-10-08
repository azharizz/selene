import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {explain} from '../server/agent.mjs';
import {quietResponse} from '../server/contract.mjs';
import {createMemory, getStory, registerStory, sceneContext} from '../server/context.mjs';
import {inspectVisual} from '../server/visual-inspector.mjs';

const input = {request: 'Explain how an object is handed to a receiver.', content_id: 'the-red-kite', at_seconds: 44,
  play_state: 'playing', playback_choice: 'keep_watching', need: 'Explain simply', language: 'English', session: 'family', recipient: 'everyone'};
const context = () => ({...sceneContext(44, getStory(input.content_id)), source_only: true});
function draft(target = 'receiver') {
  const moment = {...quietResponse(input, context().scene_id), state: 'response', answer: 'In this general example, the ball moves to the stationary receiver.'};
  moment.grounding.evidence_ids = ['f-history'];
  moment.visual = {status: 'ready', description: 'A general transfer example, not a movie event.',
    svg: '<svg viewBox="0 0 960 540"><circle id="ball" cx="100" cy="270" r="8" fill="#ffad33"/><rect id="receiver" x="400" y="240" width="40" height="60" fill="#f1f1f1"/><line x1="112" y1="270" x2="390" y2="270" stroke="#f1f1f1" stroke-width="3"/><text x="100" y="315" font-size="20">ball</text><text x="400" y="330" font-size="20">receiver</text></svg>',
    animations: [{target_id: target, duration_ms: 2000, delay_ms: 0,
      keyframes: [{transform: 'none', opacity: 1}, {transform: 'translate(292px, 0px)', opacity: 1}]}]};
  return moment;
}
const keep = {action: 'keep', issue: '', response: null};
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lS8AAAAASUVORK5CYII=';
const inspection = () => ({viewport: {width: 1280, height: 720},
  frames: [{phase: 'static', at_ms: null, image_url: {url: png}}, ...[0, 1000, 1999].map(at_ms => ({phase: 'animation', at_ms, image_url: {url: png}}))], observations: []});
function provider(t, respond) {
  const keys = ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'configured-vision-model', AGENT_PROVIDER_API_KEY: 'test-only'});
  t.after(() => {for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];});
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'configured-vision-model');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.notEqual(body.response_format.json_schema.name, 'selene_grounding_review');
    const value = await respond(body, options);
    return Response.json({choices: [{finish_reason: 'stop', message: {content: typeof value === 'string' ? value : JSON.stringify(value)}}]});
  });
}
const feedbackPayload = body => JSON.parse(body.messages.findLast(message => message.role === 'user').content[0].text);

// Requires the same Chrome/Chromium prerequisite as production; only the provider is mocked.
test('actual WAAPI inspection reveals the executable wrong-object animation and drives revision', async t => {
  let generations = 0, feedbackTurns = 0, renders = 0;
  const replies = [], memory = createMemory();
  provider(t, body => {
    if (body.response_format.json_schema.name === 'selene_moment_response') {generations++; return draft();}
    assert.equal(body.response_format.json_schema.name, 'selene_visual_feedback');
    feedbackTurns++;
    const content = body.messages.findLast(message => message.role === 'user').content;
    const images = content.filter(part => part.type === 'image_url');
    assert.ok(images.length >= 4 && images.every(part => part.image_url.url.startsWith('data:image/png;base64,')));
    const payload = feedbackPayload(body), stages = payload.observations.filter(stage => stage.phase === 'animation');
    assert.ok(stages.length >= 3);
    const id = payload.response.visual.animations[0].target_id;
    const positions = stages.map(stage => stage.targets.find(target => target.id === id).x);
    assert.ok(Math.max(...positions) - Math.min(...positions) > 200, 'real rendered geometry travels visibly');
    if (id === 'receiver') return {action: 'revise', issue: 'The receiver moves while the ball stays still; transfer the ball instead.', response: draft('ball')};
    assert.equal(id, 'ball');
    return keep;
  });
  const answer = await explain(input, {context: context(), memory, onReply: reply => replies.push(reply),
    inspect: async (visual, options) => {renders++; return inspectVisual(visual, options);}});
  assert.deepEqual([generations, feedbackTurns, renders, replies.length], [1, 2, 2, 3]);
  assert.equal(answer.answer, draft().answer, 'supported explanatory wording survives visual correction');
  assert.equal(answer.visual.animations[0].target_id, 'ball');
  assert.deepEqual(memory.lastExplanation.visual_feedback.map(entry => entry.action), ['revise', 'keep']);
  assert.equal(memory.lastExplanation.request, input.request);
  answer.visual.svg = 'mutated by caller';
  assert.notEqual(memory.lastExplanation.visual.svg, answer.visual.svg);
});

test('two revisions terminate without a subjective veto and the final revision is rendered', async t => {
  let turns = 0;
  const rendered = [], memory = createMemory();
  provider(t, body => body.response_format.json_schema.name === 'selene_moment_response' ? draft()
    : {action: 'revise', issue: `Concrete visual correction ${++turns}`, response: draft(turns === 1 ? 'ball' : 'receiver')});
  const answer = await explain(input, {context: context(), memory,
    inspect: async visual => {rendered.push(visual.animations[0].target_id); return inspection();}});
  assert.deepEqual(rendered, ['receiver', 'ball', 'receiver']);
  assert.equal(turns, 2);
  assert.equal(answer.visual.animations[0].target_id, rendered.at(-1));
  assert.deepEqual(memory.lastExplanation.visual_feedback.map(entry => entry.action), ['revise', 'revise', 'limit']);
});

test('invalid feedback and revisions fail at their own trust boundary, not draft repair', async t => {
  for (const [value, stage, code] of [
    ['{invalid', 'visual_feedback', 'invalid_json'],
    [{...keep, injected: true}, 'visual_feedback', 'schema'],
    [{action: 'keep', issue: '', response: draft()}, 'visual_feedback', 'schema'],
    [{action: 'revise', issue: 'Move the ball.', response: {...draft('ball'), grounding: {...draft().grounding, evidence_ids: ['invented']}}}, 'visual_revision', 'unavailable_evidence'],
    [{action: 'revise', issue: 'Move the ball.', response: {...draft('ball'), visual: {...draft('ball').visual, svg: '<script/>'}}}, 'visual_revision', 'visual'],
  ]) {
    await t.test(`${stage}/${code}`, async t => {
      let generations = 0, renders = 0;
      provider(t, body => body.response_format.json_schema.name === 'selene_moment_response' ? (generations++, draft()) : value);
      await assert.rejects(explain(input, {context: context(), inspect: async () => {renders++; return inspection();}}),
        error => error.agentFailure?.stage === stage && error.agentFailure?.code === code);
      assert.deepEqual([generations, renders], [1, 1], 'invalid replacement is neither rendered nor regenerated as an unrelated draft');
    });
  }
});

test('render and feedback-provider failures stay explicit and are not structural repairs', async t => {
  for (const failure of ['render', 'provider', 'abort']) await t.test(failure, async t => {
    let generations = 0, feedback = 0;
    const controller = new AbortController(), memory = createMemory();
    provider(t, body => {
      if (body.response_format.json_schema.name === 'selene_moment_response') {generations++; return draft();}
      feedback++; throw new TypeError('fixture provider unavailable');
    });
    await assert.rejects(explain(input, {context: context(), memory, signal: controller.signal,
      inspect: async (_visual, {signal}) => {
        if (failure === 'render') throw new Error('fixture renderer unavailable');
        if (failure === 'abort') {controller.abort(); signal.throwIfAborted();}
        return inspection();
      }}), error => error.agentFailure?.stage === (failure === 'provider' ? 'visual_feedback_provider' : 'visual_render')
        && error.agentFailure?.code === (failure === 'provider' ? 'network' : failure === 'abort' ? 'cancelled' : 'render_failed'));
    assert.deepEqual([generations, feedback], [1, failure === 'provider' ? 1 : 0]);
    assert.equal(memory.lastExplanation, null);
    assert.equal(memory.responses.size, 0);
  });
});

test('follow-ups use same-content past help only as continuity and explicit previous_help wins', async t => {
  const prior = {request: 'Prior request', answer: 'Previously explained transfer.', content_id: input.content_id, at_seconds: 40,
    visual: draft('ball').visual, visual_feedback: [{action: 'keep', issue: ''}]};
  for (const [name, previous, explicit, expected] of [
    ['past', prior, undefined, prior],
    ['future', {...prior, at_seconds: 45}, undefined, undefined],
    ['other content', {...prior, content_id: 'other-title'}, undefined, undefined],
    ['unknown time', {...prior, at_seconds: NaN}, undefined, undefined],
    ['explicit', prior, {answer: 'Caller selected continuity', at_seconds: 42}, {answer: 'Caller selected continuity', at_seconds: 42}],
  ]) await t.test(name, async t => {
    const memory = createMemory(); memory.lastExplanation = previous;
    provider(t, body => {
      if (body.response_format.json_schema.name !== 'selene_moment_response') return keep;
      const runtime = JSON.parse(body.messages.find(message => message.role === 'user').content.split('runtime data:\n')[1]);
      assert.deepEqual(runtime.playback_context.previous_help, expected);
      assert.ok(runtime.playback_context.facts.every(fact => fact.id !== 'previous_help'), 'prior generated answer never becomes evidence');
      return draft('ball');
    });
    await explain(input, {memory, context: {...context(), ...(explicit === undefined ? {} : {previous_help: explicit})}, inspect: async () => inspection()});
    assert.equal(memory.lastExplanation.at_seconds, input.at_seconds);
    assert.equal(memory.lastExplanation.answer, draft().answer);
  });
});

test('cache partitions continuity and cached successes preserve feedback without replaying rendering', async t => {
  let generations = 0, renders = 0;
  const memory = createMemory();
  provider(t, body => body.response_format.json_schema.name === 'selene_moment_response' ? (generations++, draft('ball')) : keep);
  const options = previous_help => ({memory, context: {...context(), previous_help}, inspect: async () => {renders++; return inspection();}});
  const first = {answer: 'first', at_seconds: 40}, second = {answer: 'second', at_seconds: 40};
  await explain(input, options(first));
  await explain(input, options(second));
  const cached = await explain(input, options(first));
  assert.deepEqual([generations, renders, memory.responses.size], [2, 2, 2]);
  assert.equal(cached.visual.status, 'ready');
  assert.deepEqual(memory.lastExplanation.visual_feedback, [keep].map(({action, issue}) => ({action, issue})));
});

test('clarifications skip visual feedback and do not replace the last successful explanation', async t => {
  const memory = createMemory(), previous = {content_id: 'other-title', at_seconds: 0, answer: 'saved'};
  memory.lastExplanation = previous;
  provider(t, () => ({...quietResponse(input, context().scene_id), state: 'clarification', answer: 'Which object do you mean?'}));
  const answer = await explain(input, {context: context(), memory, inspect: async () => {assert.fail('Clarifications do not render');}});
  assert.equal(answer.state, 'clarification');
  assert.equal(memory.lastExplanation, previous);
});

test('prepared successes retain isolated continuity without rendering or provider calls', async t => {
  const {entries} = JSON.parse(readFileSync(new URL('../server/preloaded-answers.json', import.meta.url), 'utf8'));
  const entry = entries[0];
  if (!getStory(entry.content_id)) registerStory(JSON.parse(readFileSync(new URL(`../content/${entry.content_id}.json`, import.meta.url), 'utf8')));
  const preparedInput = {...input, content_id: entry.content_id, at_seconds: entry.from_seconds,
    request: entry.requests[0], need: 'Show visually'};
  const memory = createMemory();
  t.mock.method(globalThis, 'fetch', () => {assert.fail('Prepared hits do not call a provider');});
  const answer = await explain(preparedInput, {memory, context: sceneContext(entry.from_seconds, getStory(entry.content_id)),
    inspect: async () => {assert.fail('Prepared hits skip generation and visual feedback');}});
  assert.equal(memory.lastExplanation.answer, answer.answer);
  assert.equal(memory.lastExplanation.content_id, entry.content_id);
  assert.equal(memory.lastExplanation.request, preparedInput.request);
  assert.deepEqual(memory.lastExplanation.visual_feedback, []);
  assert.equal((await explain(preparedInput, {memory, context: sceneContext(entry.from_seconds, getStory(entry.content_id)),
    inspect: async () => {assert.fail('Retained memory must not disable a prepared hit');}})).answer, answer.answer);
  answer.visual.svg = 'caller mutation';
  assert.notEqual(memory.lastExplanation.visual.svg, answer.visual.svg);
});
