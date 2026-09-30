import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from '../scripts/evaluate.mjs';

// Synthetic arithmetic fixtures, never household findings.
const available_support = {captions: 'available', rewind: 'available', family_help: 'available', native_assistance: 'unavailable'};
const baseline = {trial_id: 'test-a', participant_id: 'test-person', pair_id: 'test-pair', clip_id: 'clip-a', condition: 'usual_help', order: 1,
  correct: 1, questions: 3, available_support, voluntary_reuse: null, interruptions: [{seconds: 10, scope: 'shared', causes: ['rewind', 'family_help']}]};
const selene = {...baseline, trial_id: 'test-b', clip_id: 'clip-b', condition: 'usual_help_plus_selene', order: 2, correct: 3, voluntary_reuse: true,
  interruptions: [{seconds: 4, scope: 'viewer', causes: ['selene']}, {seconds: 3, scope: 'shared', causes: ['family_help']}]};
test('collaborative evaluation measures comprehension, shared interruptions and observed reuse separately', () => {
  const result = summarize([baseline, selene]);
  assert.equal(result.observations, 2); assert.equal(result.paired.length, 1);
  assert.equal(result.paired[0].shared_interruption_seconds_change, -7);
  assert.equal(result.paired[0].viewer_attention_seconds_change, -3);
  assert.equal(result.by_condition[1].family_help_events, 1);
  assert.equal(result.by_condition[1].voluntary_reuse_percent, 100);
  assert.equal(result.by_condition[0].voluntary_reuse_percent, null);
  assert.equal(summarize([]).by_condition[0].comprehension_percent, null);
});
test('incomparable pairs are excluded; invalid scores, duplicate records and baseline AI use fail', () => {
  assert.equal(summarize([baseline]).excluded_pairs.length, 1);
  assert.equal(summarize([baseline, {...selene, available_support: {...available_support, family_help: 'unavailable'}}]).paired.length, 0);
  assert.throws(() => summarize([{...baseline, correct: 4}]), /Invalid trial/);
  assert.throws(() => summarize([baseline, baseline]), /Duplicate trial/);
  assert.throws(() => summarize([{...baseline, interruptions: [{seconds: 1, scope: 'shared', causes: ['selene']}]}]), /Invalid interruption/);
  assert.throws(() => summarize([{...baseline, voluntary_reuse: undefined}]), /Invalid trial/);
  assert.throws(() => summarize([{...baseline, voluntary_reuse: true}]), /Invalid trial/);
  assert.throws(() => summarize([{...baseline, available_support: {...available_support, notes: 'unknown'}}]), /Invalid trial/);
});
