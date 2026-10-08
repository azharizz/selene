import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getStory, registerStory, createMemory, sceneContext} from '../server/context.mjs';
import {personalContext, playerStory, recordPlayback} from '../server/personal.mjs';
import {privateAction} from '../server/private-actions.mjs';
import {explain, validateMoment} from '../server/agent.mjs';
import {preloadedAnswer, preparedExamples} from '../server/preloaded-answers.mjs';

const {entries} = JSON.parse(readFileSync(new URL('../server/preloaded-answers.json', import.meta.url), 'utf8'));
for (const id of new Set(entries.map(entry => entry.content_id))) {
  if (!getStory(id)) registerStory(JSON.parse(readFileSync(new URL(`../content/${id}.json`, import.meta.url), 'utf8')));
}
function request(entry, at = entry.from_seconds, text = entry.requests[0]) {
  const input = {request: text, content_id: entry.content_id, at_seconds: at, play_state: 'paused',
    playback_choice: 'keep_watching', need: 'Show visually', language: 'English', recipient: 'everyone',
    session: 'solo', continuation: null};
  return {input, context: personalContext(getStory(entry.content_id), at, null, text)};
}

test('prepared imported answers stay source-bound, isolated and available without model calls', async t => {
  t.mock.method(globalThis, 'fetch', () => {assert.fail('A prepared hit must not call a model');});
  for (const entry of entries) {
    for (const text of entry.requests) {
      const {input, context} = request(entry, entry.from_seconds + 0.0001, text.toUpperCase() + '!?');
      const answer = await explain(input, {context, memory: createMemory()});
      assert.equal(answer.answer, entry.answer);
      assert.equal(answer.grounding.at_seconds, input.at_seconds);
      assert.equal(answer.grounding.scene_id, context.scene_id);
      assert.equal(validateMoment(answer, input, context, createMemory(), false).visual.status, 'ready');
      assert.equal(answer.intervention.audio, 'silent');
      answer.visual.svg = 'changed by caller';
      assert.notEqual(preloadedAnswer(input, context).visual.svg, answer.visual.svg);
    }
    const {input, context} = request(entry, Math.min(entry.until_seconds - 0.0001, getStory(entry.content_id).duration));
    assert.ok(preloadedAnswer(input, context));
    const listed = preparedExamples(input.content_id, input.at_seconds);
    assert.ok(listed.some(example => example.id === entry.id));
    const tv = await explain({...input, playback_choice: 'unspecified'}, {context: sceneContext(input.at_seconds, getStory(input.content_id))});
    assert.equal(tv.answer, entry.tv_answer ?? entry.answer);
    assert.equal(tv.intervention.playback, 'offer_choice');
    assert.equal(tv.visual.status, 'ready');
  }
});

test('each prepared title offers its next source-valid demo before the first boundary without answering early', async t => {
  t.mock.method(globalThis, 'fetch', () => {assert.fail('A selected prepared demo must not call a model');});
  for (const contentId of new Set(entries.map(entry => entry.content_id))) {
    const entry = entries.filter(item => item.content_id === contentId).sort((a, b) => a.from_seconds - b.from_seconds)[0];
    for (const at of [0, entry.from_seconds - 0.001]) {
      const [example] = preparedExamples(contentId, at);
      assert.equal(example.id, entry.id);
      assert.equal(example.at_seconds, entry.from_seconds);
      const early = request(entry, at, example.request);
      assert.equal(preloadedAnswer(early.input, early.context), null);
      const selected = request(entry, example.at_seconds, example.request);
      const answer = await explain(selected.input, {context: selected.context, memory: createMemory()});
      assert.equal(answer.answer, entry.answer);
      assert.equal(answer.grounding.at_seconds, example.at_seconds);
    }
    const at = entry.from_seconds + 0.001;
    assert.equal(preparedExamples(contentId, at)[0].at_seconds, at, 'an available demo stays at the current moment');
  }
});

test('Alisson revelations switch only at completed caption boundaries', () => {
  const stages = entries.filter(entry => entry.content_id === 'the-missing-crown');
  assert.deepEqual(preparedExamples('the-missing-crown', stages[0].from_seconds - 0.001),
    [{id: stages[0].id, request: stages[0].requests[0], at_seconds: stages[0].from_seconds}]);
  for (let i = 0; i < stages.length; i++) {
    const entry = stages[i], {input, context} = request(entry);
    assert.equal(preloadedAnswer(input, context).answer, entry.answer);
    assert.ok(entry.evidence_ids.every(id => context.transcript.some(cue => cue.id === id && cue.end <= input.at_seconds)));
    if (i) {
      const before = request(entry, entry.from_seconds - 0.001);
      assert.equal(preloadedAnswer(before.input, before.context).answer, stages[i - 1].answer);
    }
  }
  assert.deepEqual(preparedExamples('unknown', 10), []);
  assert.deepEqual(preparedExamples('football-match', NaN), []);
});

test('prepared answers reject mismatched context, changed evidence, future sources and cancellation', async () => {
  const entry = entries.find(item => item.content_id === 'the-missing-crown'), {input, context} = request(entry);
  for (const [changedInput, changedContext] of [
    [{...input, request: 'What happens next?'}, context],
    [{...input, language: 'Spanish'}, context],
    [{...input, need: 'Translate'}, context],
    [{...input, recipient: 'child'}, context],
    [{...input, continuation: {request: input.request, question: 'Who?', answer: 'Alisson'}}, context],
    [input, {...context, content_id: 'other-film'}],
    [input, {...context, source: 'vega_media_controls'}],
    [input, {...context, initial_request: 'A different question'}],
    [input, {...context, previous_help: {answer: 'Earlier answer'}}],
    [input, {...context, follow_thread: {question: input.request}}],
    [input, {...context, return_window: {from_seconds: 20, through_seconds: 33}}],
    [input, {...context, transcript: []}],
    [input, {...context, transcript: context.transcript.map(cue => ({...cue, text: 'Changed evidence'}))}],
  ]) assert.equal(preloadedAnswer(changedInput, changedContext), null);
  const story = getStory(entry.content_id), duration = story.duration;
  try {
    story.duration++;
    assert.equal(preloadedAnswer(input, context), null);
    assert.deepEqual(preparedExamples(story.id, 0), [], 'a future demo must pass the same content-version guard');
  }
  finally {story.duration = duration;}
  const controller = new AbortController(); controller.abort();
  await assert.rejects(explain(input, {context, signal: controller.signal}), {name: 'AbortError'});
});

test('private prepared explanation leaves the shared film playing', async t => {
  t.mock.method(globalThis, 'fetch', () => {assert.fail('Prepared private answer must not call a model');});
  const entry = entries.find(item => item.content_id === 'the-missing-crown');
  const story = getStory(entry.content_id), at = entry.from_seconds + 0.1;
  const session = {contentId: story.id, contentVersion: playerStory(story).content_version,
    duration: story.duration, mirror: {hold: null}};
  const sample = {content_id: story.id, content_version: session.contentVersion, epoch: 0, sequence: 1,
    at_seconds: at, play_state: 'playing', playback_rate: 1};
  recordPlayback(session, sample);
  const {hold} = await privateAction(session, 'hold', {content_version: sample.content_version, epoch: 0, sequence: 1, at_seconds: at});
  const result = await privateAction(session, 'ask', {branch_id: hold.id, request: entry.requests[0], at_seconds: at,
    new_topic: true, clarification: false, need: 'Show visually', language: 'English', recipient: 'everyone'});
  assert.equal(result.moment.answer, entry.answer);
  assert.equal(result.hold.from_seconds, at);
  assert.equal(session.playback.play_state, 'playing');
});
