import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wakeAuthorized, wakeSessions} from '../server/wake.mjs';

test('wake endpoint auth needs the configured token', () => {
  assert.equal(wakeAuthorized('Bearer s3cret', ''), false);
  assert.equal(wakeAuthorized(undefined, 's3cret'), false);
  assert.equal(wakeAuthorized('Bearer nope', 's3cret'), false);
  assert.equal(wakeAuthorized('Bearer s3cret', 's3cret'), true);
});

test('wake sweep re-runs only due, fresh thread and conversation checks', async () => {
  const fresh = {fresh: true, content_version: 'v1', epoch: 2, sequence: 9, at_seconds: 40};
  const sessions = new Map([
    ['due', {mirror: {thread: {checked_through_seconds: 30}, conversation: {}}, pb: fresh}],
    ['busy', {mirror: {thread: {checked_through_seconds: 30}, controller: {}, conversation: {controller: {}}}, pb: fresh}],
    ['caught-up', {mirror: {thread: {checked_through_seconds: 40}}, pb: fresh}],
    ['stale', {mirror: {thread: {checked_through_seconds: 0}, conversation: {}}, pb: {...fresh, fresh: false}}],
    ['no-phone', {pb: fresh}],
  ]);
  const checked = [], scheduled = [];
  const result = await wakeSessions(sessions, {snapshot: s => s.pb,
    threadCheck: async (s, sample) => checked.push(sample), schedule: s => scheduled.push(s)});
  assert.deepEqual(result, {threads: 1, conversations: 1});
  assert.deepEqual(checked, [{content_version: 'v1', epoch: 2, sequence: 9, at_seconds: 40}]);
  assert.equal(scheduled[0], sessions.get('due'));
});
