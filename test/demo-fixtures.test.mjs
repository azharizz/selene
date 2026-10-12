import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getStory, registerStory} from '../server/context.mjs';
import {conversationContext, conversationRound} from '../server/conversation.mjs';
import {privateAction} from '../server/private-actions.mjs';
import {playerStory, recordPlayback} from '../server/personal.mjs';
import {createRequester} from '../server/requesters.mjs';
import {validateVisual} from '../server/visual.mjs';

if (!getStory('the-missing-crown'))
  registerStory(JSON.parse(readFileSync(new URL('../content/the-missing-crown.json', import.meta.url), 'utf8')));

function pairedSession(contentId, at, playState = 'playing') {
  const story = getStory(contentId), session = {contentId, contentVersion: playerStory(story).content_version,
    duration: story.duration, playback: null, mirror: {hold: null, thread: null}};
  const report = (seconds, state = 'playing') => {
    const sample = {content_id: story.id, content_version: session.contentVersion,
      sequence: (session.playback?.sequence ?? 0) + 1, epoch: 0, at_seconds: seconds,
      play_state: state, playback_rate: 1};
    recordPlayback(session, sample); return sample;
  };
  report(at, playState);
  return {session, story, report, sample: () => {
    const {content_version, epoch, sequence, at_seconds} = session.playback;
    return {content_version, epoch, sequence, at_seconds};
  }};
}

async function startPreparedThread(session, at, request, requesterId) {
  const sample = session.playback;
  const hold = (await privateAction(session, 'hold', {content_version: sample.content_version,
    epoch: sample.epoch, sequence: sample.sequence, at_seconds: at})).hold;
  const answer = await privateAction(session, 'ask', {branch_id: hold.id, request, at_seconds: at,
    new_topic: true, clarification: false, need: 'Show visually', language: 'English', recipient: 'everyone',
    ...(requesterId ? {requester_id: requesterId} : {})});
  await privateAction(session, 'thread', {enabled: true, answer_id: answer.id});
  return answer;
}

test('demo Follow thread uses caption-bounded grandparent and child fixtures without a model call', async t => {
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  t.mock.method(globalThis, 'fetch', () => {assert.fail('Demo thread fixtures must not call a model');});
  for (const [contentId, start, updateAt, question, expected] of [
    ['football-match', 15.6, 27.1, 'What is offside?', /Grandpa, what made a striker stand out/],
    ['the-missing-crown', 63, 90, 'Who is Alisson and why is he missing?', /met Captain Bren/],
  ]) {
    const {session, report, sample} = pairedSession(contentId, start);
    const answer = await startPreparedThread(session, start, question);
    assert.equal(answer.moment.audience.recipient, contentId === 'football-match' ? 'grandparent' : 'child');
    assert.equal(answer.moment.audience.source, 'fixture');
    report(updateAt);
    const first = await privateAction(session, 'thread-check', sample());
    assert.equal(first.updated, true);
    assert.match(first.thread.help.moment.answer, expected);
    assert.equal(first.thread.help.moment.audience.recipient, contentId === 'football-match' ? 'grandparent' : 'child');
    assert.ok(first.thread.help.moment.grounding.evidence_ids.some(id =>
      (contentId === 'football-match' ? ['caption-14', 'caption-15', 'caption-17'] : ['caption-42']).includes(id)));
    assert.equal(first.thread.revision, 1);
    assert.equal(answer.moment.visual.status, 'ready');

    if (contentId === 'the-missing-crown') {
      session.mirror.thread.checked_at = 0;
      report(110);
      const reveal = await privateAction(session, 'thread-check', sample());
      assert.equal(reveal.updated, true);
      assert.match(reveal.thread.help.moment.answer, /protected it all along/);
      assert.deepEqual(reveal.thread.help.moment.audience, {recipient: 'child', source: 'fixture'});
      assert.ok(reveal.thread.help.moment.grounding.evidence_ids.includes('caption-52'));
    }
  }
});

test('football no-flag follow-up animates a level run and is grounded in the replay captions', async t => {
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  t.mock.method(globalThis, 'fetch', () => {assert.fail('Prepared football follow-ups must not call a model');});
  const {session, report, sample} = pairedSession('football-match', 15.6);
  await startPreparedThread(session, 15.6, 'What is offside?');
  report(56.7);

  const followed = await privateAction(session, 'thread-check', sample());
  const moment = followed.thread.help.moment;
  assert.equal(followed.updated, true);
  assert.equal(moment.answer, 'A later run is different: the forward is level when the pass is played, then scores, so there is no offside. Grandpa, did the strikers you remember rely on timing like that?');
  assert.equal(moment.audience.recipient, 'grandparent');
  assert.equal(moment.visual.status, 'ready');
  assert.match(moment.visual.svg, /LEVEL AT PASS = ONSIDE/);
  assert.deepEqual(moment.visual.animations.map(animation => animation.target_id), ['forward-run', 'pass-ball']);
  validateVisual(moment.visual);
  assert.deepEqual(moment.grounding.evidence_ids, ['caption-11', 'caption-31', 'caption-32', 'caption-33', 'caption-34', 'caption-35', 'caption-36']);
});

test('football no-flag follow-up survives staggered thread checks inside the AI cooldown', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', () => {assert.fail('Prepared football follow-ups must not call a model');});
  const {session, report, sample} = pairedSession('football-match', 15.6);
  await startPreparedThread(session, 15.6, 'What is offside?');

  report(27.1);
  const first = await privateAction(session, 'thread-check', sample());
  assert.match(first.thread.help.moment.answer, /flag was right/);
  now += 5000; report(53);
  assert.equal((await privateAction(session, 'thread-check', sample())).updated, false);
  now += 5000; report(56.7);
  const later = await privateAction(session, 'thread-check', sample());
  assert.equal(later.updated, true);
  assert.equal(later.thread.help.moment.visual.status, 'ready');
  assert.match(later.thread.help.moment.answer, /A later run is different/);
});

test('Missing Crown prepared answer, child match and Follow thread work from early and arbitrary safe positions', async t => {
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  t.mock.method(globalThis, 'fetch', () => {assert.fail('Prepared demo questions and updates must not call a model');});
  const question = 'Who is Alisson and why is he missing?';
  for (const [start, update, evidence] of [[5, 15.6, 'caption-9'], [20, 63, 'caption-33'], [90, 105, 'caption-49']]) {
    const {session, report, sample} = pairedSession('the-missing-crown', start);
    const answer = await startPreparedThread(session, start, question);
    assert.equal(answer.moment.state, 'response');
    assert.equal(answer.moment.visual.status, 'ready');
    assert.equal(answer.moment.audience.recipient, 'child');
    assert.equal(answer.moment.audience.source, 'fixture');
    report(update);
    const followed = await privateAction(session, 'thread-check', sample());
    assert.equal(followed.updated, true);
    assert.equal(followed.thread.help.moment.visual.status, 'ready');
    assert.equal(followed.thread.help.moment.audience.recipient, 'child');
    assert.ok(followed.thread.help.moment.grounding.evidence_ids.includes(evidence));
  }
});

test('prepared demo question bypasses the enrolled profile and keeps its authored persona', async t => {
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  t.mock.method(globalThis, 'fetch', () => {assert.fail('Prepared demo questions must not call a model');});
  const directory = await mkdtemp(join(tmpdir(), 'selene-demo-requester-'));
  const oldFile = process.env.SELENE_REQUESTERS_FILE;
  process.env.SELENE_REQUESTERS_FILE = join(directory, 'requesters.json');
  t.after(async () => {
    oldFile === undefined ? delete process.env.SELENE_REQUESTERS_FILE : process.env.SELENE_REQUESTERS_FILE = oldFile;
    await rm(directory, {recursive: true, force: true});
  });
  const profile = await createRequester({label: 'Parent', role: 'parent', style: 'standard', language: 'English', consent: true});
  const {session, report, sample} = pairedSession('football-match', 15.6);
  const answer = await startPreparedThread(session, 15.6, 'What is offside?', profile.id);
  assert.deepEqual(answer.moment.audience, {recipient: 'grandparent', source: 'fixture'});
  assert.deepEqual(session.mirror.hold.requester, {role: 'grandparent', source: 'fixture'});
  assert.equal(session.mirror.hold.requester_id, null);
  report(27.1);
  const follow = await privateAction(session, 'thread-check', sample());
  assert.match(follow.thread.help.moment.answer, /Grandpa, what made a striker stand out/);
});

test('a prepared Missing Crown question starts a fresh answer from an existing phone thread', async t => {
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  t.mock.method(globalThis, 'fetch', () => {assert.fail('Prepared phone questions must not call a model');});
  const question = 'Who is Alisson and why is he missing?';
  const {session} = pairedSession('the-missing-crown', 63);
  const first = await startPreparedThread(session, 63, question);
  const next = await privateAction(session, 'ask', {branch_id: first.hold.id, request: question, at_seconds: 63,
    new_topic: false, clarification: false, need: 'Show visually', language: 'English', recipient: 'everyone'});
  assert.equal(next.moment.state, 'response');
  assert.equal(next.moment.visual.status, 'ready');
  assert.match(next.moment.visual.svg, /empty-seat/);
  assert.equal(next.thread, null);
  assert.equal(session.mirror.hold.initial_request, question);
});

test('automatic demo invitations wait for actual video end and carry group questions with completed citations', async t => {
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  for (const [contentId, duration, expected] of [
    ['football-match', 60, /Grandpa/], ['the-missing-crown', 120, /Lyra/],
  ]) {
    const playing = pairedSession(contentId, duration - 1).session;
    const beforeEnd = await conversationRound(() => conversationContext(playing), {
      complete: async () => {assert.fail('Authored demo timing is deterministic');},
    });
    assert.deepEqual(beforeEnd, {action: 'schedule', at_seconds: duration, opportunity: 'ending',
      reason: 'Recheck at the authored demo video end.'});

    const ended = pairedSession(contentId, duration, 'ended').session;
    const shown = await conversationRound(() => conversationContext(ended), {
      complete: async () => {assert.fail('Authored demo invitations are deterministic');},
    });
    assert.equal(shown.action, 'show');
    assert.equal(shown.boundary_id, 'ended');
    assert.ok(shown.options.length >= 2 && shown.options.length <= 3);
    assert.ok(shown.options.some(option => expected.test(option.question)));
    const evidenceIds = new Set(getStory(contentId).transcript.map(cue => cue.id));
    for (const option of shown.options) {
      assert.equal(option.recipient, 'everyone');
      assert.ok(option.question.includes('?'));
      assert.ok(option.evidence_ids.length > 0);
      assert.ok(option.evidence_ids.every(id => evidenceIds.has(id)));
    }
  }
});
