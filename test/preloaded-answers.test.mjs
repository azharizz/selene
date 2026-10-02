import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getStory, createMemory, personalReferences} from '../server/context.mjs';
import {personalContext, originalQuote, playerStory, recordPlayback} from '../server/personal.mjs';
import {privateAction} from '../server/private-actions.mjs';
import {explain, validateMoment} from '../server/agent.mjs';
import {preloadedAnswer, preparedExamples} from '../server/preloaded-answers.mjs';

const {entries} = JSON.parse(readFileSync(new URL('../server/preloaded-answers.json', import.meta.url), 'utf8'));
function request(entry, at = entry.from_seconds, text = entry.requests[0]) {
  const input = {request: text, content_id: entry.content_id, at_seconds: at, play_state: 'paused',
    playback_choice: 'keep_watching', need: 'Show visually', language: 'English', recipient: 'everyone',
    session: 'solo', continuation: null};
  const context = personalContext(getStory(entry.content_id), at, null, text);
  context.references = personalReferences(text);
  return {input, context};
}

test('prepared examples supply real source-bound text and finite SVG animations without a provider call', async t => {
  assert.equal(entries.length, 6);
  t.mock.method(globalThis, 'fetch', () => {assert.fail('A prepared hit must not call a model');});
  for (const entry of entries) {
    for (const text of entry.requests) {
      const {input, context} = request(entry, entry.from_seconds + 0.125, text.toUpperCase() + '!?');
      const answer = await explain(input, {context, memory: createMemory()});
      assert.equal(answer.answer, entry.answer);
      assert.equal(answer.grounding.at_seconds, input.at_seconds, 'use the observed question time, never a cached timestamp');
      assert.equal(answer.grounding.scene_id, context.scene_id);
      assert.equal(validateMoment(answer, input, context, createMemory(), false).visual.status, 'ready');
      assert.ok(answer.visual.animations.length > 0);
      assert.equal(answer.intervention.audio, 'silent');
      const quoted = originalQuote(answer, context);
      if (quoted) assert.equal(quoted.text, getStory(entry.content_id).transcript.find(cue => cue.id === quoted.id).text);
      answer.visual.svg = 'changed by caller';
      assert.notEqual(preloadedAnswer(input, context).visual.svg, answer.visual.svg, 'hits cannot mutate the shared prepared file');
    }
    const {input, context} = request(entry, Math.min(entry.until_seconds - 0.001, getStory(entry.content_id).duration));
    assert.ok(preloadedAnswer(input, context), 'the complete permitted window remains usable');
    assert.equal(preloadedAnswer({...input, at_seconds: entry.from_seconds - 0.001}, {...context, at_seconds: entry.from_seconds - 0.001}), null);
    assert.equal(preloadedAnswer({...input, at_seconds: entry.until_seconds}, {...context, at_seconds: entry.until_seconds}), null);
  }
  const story = getStory('the-red-kite'), session = {contentId: story.id, contentVersion: playerStory(story).content_version,
    duration: story.duration, mirror: {hold: null}};
  const sample = {content_id: story.id, content_version: session.contentVersion, epoch: 0, sequence: 1,
    at_seconds: 35, play_state: 'playing', playback_rate: 1};
  recordPlayback(session, sample);
  const {hold} = await privateAction(session, 'hold', {content_version: sample.content_version, epoch: 0, sequence: 1, at_seconds: 35});
  const entry = entries.find(item => item.id === 'missed-moment');
  const result = await privateAction(session, 'ask', {branch_id: hold.id, request: entry.requests[0], at_seconds: 33,
    new_topic: true, clarification: false, need: 'Show visually', language: 'English', recipient: 'everyone'});
  assert.equal(result.moment.answer, entry.answer); assert.equal(result.hold.from_seconds, 35);
  assert.equal(result.quote.text, story.transcript.find(cue => cue.id === 't3').text);
  assert.equal(session.playback.play_state, 'playing');
});

test('misses and context changes retain the original live pipeline; source edits, future facts and cancellation cannot use a prepared answer', async t => {
  const entry = entries.find(item => item.id === 'missed-moment'), {input, context} = request(entry);
  for (const [changedInput, changedContext] of [
    [{...input, request: 'What did Arun just say about the future?'}, context],
    [{...input, language: 'Spanish'}, context],
    [{...input, need: 'Translate'}, context],
    [{...input, recipient: 'child'}, context],
    [input, {...context, content_id: 'other-film'}],
    [input, {...context, initial_request: 'I need a detailed answer.'}],
    [input, {...context, previous_help: {answer: 'An earlier answer'}}],
    [input, {...context, follow_thread: {question: input.request}}],
    [input, {...context, return_window: {from_seconds: 20, through_seconds: 33}}],
    [input, {...context, transcript: []}],
    [input, {...context, facts: context.facts.map(fact => ({...fact, text: 'Changed source'}))}],
  ]) assert.equal(preloadedAnswer(changedInput, changedContext), null);
  const story = getStory(entry.content_id), oldDuration = story.duration;
  try {story.duration++; assert.equal(preloadedAnswer(input, context), null, 'a changed source catalog invalidates the prepared entry');}
  finally {story.duration = oldDuration;}
  const fields = ['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY'];
  const saved = Object.fromEntries(fields.map(key => [key, process.env[key]]));
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'cache-fallback-test', AGENT_PROVIDER_API_KEY: 'test-only'});
  t.after(() => {for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;});
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://model.test.invalid'); calls++;
    const body = JSON.parse(options.body);
    if (body.response_format.json_schema.name === 'selene_grounding_review') return Response.json({choices: [{message: {content: JSON.stringify({supported: true, issue: '', pause_requested: false})}}]});
    const answer = preloadedAnswer(input, context);
    answer.answer = 'Arun says he made this kite with Maya’s mother.';
    return Response.json({choices: [{message: {content: JSON.stringify(answer)}}]});
  });
  const liveInput = {...input, request: 'Can you tell me what Arun said?'}, liveContext = {...context, initial_request: liveInput.request};
  const live = await explain(liveInput, {context: liveContext, memory: createMemory()});
  assert.equal(live.answer, 'Arun says he made this kite with Maya’s mother.');
  assert.equal(calls, 2, 'unmatched input still runs generation and grounding review');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(explain(input, {context, signal: controller.signal}), {name: 'AbortError'});
  assert.equal(calls, 2);
});

test('own-player TV offers only source-checked examples for its already revealed moment', async t => {
  t.mock.method(globalThis, 'fetch', () => {assert.fail('A prepared TV answer must not call a provider');});
  for (const entry of entries) {
    const {input, context} = request(entry, entry.from_seconds + 0.125);
    assert.ok(preparedExamples(input.content_id, input.at_seconds).some(example => example.id === entry.id));
    const answer = await explain({...input, playback_choice: 'unspecified'}, {context: {...context, output: 'shared_tv'}, memory: createMemory()});
    assert.equal(answer.answer, entry.tv_answer ?? entry.answer);
    assert.equal(answer.intervention.playback, 'offer_choice');
    assert.equal(answer.visual.status, 'ready');
    assert.ok(preloadedAnswer({...input, need: 'Slower answer voice'}, context), 'read-aloud pace does not change prepared evidence');
  }
  assert.deepEqual(preparedExamples('sintel-excerpt', 10), []);
  assert.ok(preparedExamples('sintel-excerpt', 33).every(example => example.id === 'missed-fast-dialogue'));
  assert.deepEqual(preparedExamples('unknown', 10), []);
  assert.deepEqual(preparedExamples('the-red-kite', NaN), []);
  const {input, context} = request(entries[1]);
  assert.equal(preloadedAnswer(input, {...context, source: 'vega_media_controls'}), null);
});
