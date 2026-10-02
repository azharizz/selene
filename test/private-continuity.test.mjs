import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getStory, personalReferences, connections, createMemory} from '../server/context.mjs';
import {playerStory, recordPlayback, requireSample, personalContext, originalQuote} from '../server/personal.mjs';
import {privateAction, privateState, THREAD_CHECK_MS} from '../server/private-actions.mjs';

const preferences = {need: 'Show visually', language: 'English', recipient: 'everyone'};
function setup(t, storyId = 'the-red-kite') {
  const story = getStory(storyId), session = {contentId: story.id, contentVersion: playerStory(story).content_version, duration: story.duration,
    playback: null, mirror: {hold: null, thread: null}};
  const report = (at, epoch = 0) => {
    const input = {content_id: story.id, content_version: session.contentVersion, sequence: (session.playback?.sequence ?? 0) + 1,
      epoch, at_seconds: at, play_state: 'playing', playback_rate: 1};
    recordPlayback(session, input); return input;
  };
  const sample = () => {
    const {content_version, epoch, sequence, at_seconds} = session.playback;
    return {content_version, epoch, sequence, at_seconds};
  };
  const saved = Object.fromEntries(['AGENT_PROVIDER_URL', 'AGENT_PROVIDER_MODEL', 'AGENT_PROVIDER_API_KEY'].map(key => [key, process.env[key]]));
  Object.assign(process.env, {AGENT_PROVIDER_URL: 'https://model.test.invalid', AGENT_PROVIDER_MODEL: 'test', AGENT_PROVIDER_API_KEY: 'test-only'});
  t.after(() => {for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;});
  const calls = [], behavior = {quiet: false, unavailable: false, future: false, generating: null};
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://model.test.invalid');
    const body = JSON.parse(options.body);
    if (behavior.unavailable) throw new Error('fixture unavailable');
    if (body.response_format.json_schema.name === 'selene_grounding_review') {
      const payload = JSON.parse(body.messages.at(-1).content);
      if (payload.context.follow_thread) assert.match(body.messages.map(item => item.content).join('\n'), /rephrasing the same fact is not an update/);
      return Response.json({choices: [{message: {content: JSON.stringify({supported: true, issue: '', pause_requested: false})}}]});
    }
    const runtime = JSON.parse(body.messages.find(item => item.role === 'user').content.split('runtime data:\n')[1]);
    const context = runtime.playback_context; calls.push(runtime);
    await behavior.generating?.(runtime);
    const quiet = behavior.quiet && context.follow_thread;
    const id = behavior.future ? 'unseen-future' : context.follow_thread?.new_evidence_ids[0] ?? context.return_window?.interval_evidence_ids[0]
      ?? context.references?.[0]?.id ?? context.transcript.at(-1)?.id ?? context.facts.at(-1).id;
    const result = {version: '1.0', state: quiet ? 'quiet' : 'response', answer: quiet ? '' : `Supported explanation at ${context.at_seconds}.`,
      visual: {status: 'none', svg: '', description: '', animations: []}, intervention: {playback: 'keep_watching', audio: 'silent'},
      grounding: {content_id: story.id, scene_id: context.scene_id, at_seconds: context.at_seconds, evidence_ids: quiet ? [] : [id], graph_ids: []}, new_connections: []};
    return Response.json({choices: [{message: {content: JSON.stringify(result)}}]});
  });
  const hold = async from => (await privateAction(session, 'hold', {...sample(), ...(from === undefined ? {} : {from_seconds: from})})).hold;
  const ask = (held, at, request = 'I am grandma. Explain this simply.', newTopic = true) => privateAction(session, 'ask', {
    branch_id: held.id, at_seconds: at, request, new_topic: newTopic, clarification: false, ...preferences});
  return {session, story, report, sample, calls, behavior, hold, ask};
}

test('Send and catch-up tap use independent confirmed samples; a completed interval never leaks into the next conversation', async t => {
  const {session, report, sample, hold, ask, calls, behavior} = setup(t);
  report(35); const held = await hold();
  await ask(held, 20);
  assert.equal(session.mirror.hold.from_seconds, 35);
  assert.equal(session.mirror.hold.question_at_seconds, 20);
  report(45);
  await ask(held, 20, 'Can you explain that word?', false);
  assert.equal(calls.at(-1).playback_context.at_seconds, 20);
  assert.match(calls.at(-1).playback_context.initial_request, /grandma/);
  await assert.rejects(ask(held, 45, 'Why?', false), /original moment/);
  const tapped = sample(); report(46);
  behavior.generating = () => {report(50);};
  const input = {branch_id: held.id, content_version: tapped.content_version, epoch: tapped.epoch, sequence: tapped.sequence,
    from_seconds: 35, through_seconds: 45, ...preferences};
  const result = await privateAction(session, 'return', input);
  assert.equal(result.status, 'ready'); assert.equal(result.through_seconds, 45);
  assert.equal(calls.at(-1).playback_context.at_seconds, 45);
  assert.match(calls.at(-1).playback_context.initial_request, /grandma/);
  assert.equal(session.playback.at_seconds, 50); assert.equal(session.playback.play_state, 'playing');
  assert.equal(session.mirror.hold, null);
  assert.equal(privateState(session).bridge.through_seconds, 45, 'reconnect can recover a lost successful response');
  const count = calls.length;
  assert.deepEqual(await privateAction(session, 'return', input), result);
  assert.equal(calls.length, count, 'identical retry cannot regenerate or move the endpoint');
  behavior.generating = null; report(53); const next = await hold();
  await ask(next, 53, 'What does this mean?');
  assert.equal(next.from_seconds, 53); assert.notEqual(next.id, held.id);
  await assert.rejects(privateAction(session, 'end', {branch_id: held.id}), /changed/);
});

test('tap validation rejects invented, stale and previous-seek samples; earlier catch-up remains explicit', async t => {
  const {session, report, sample, hold} = setup(t);
  report(35); const captured = sample(); report(45);
  assert.equal(requireSample(session, captured, 35).at_seconds, 35);
  assert.throws(() => requireSample(session, captured, 36), /sample/);
  assert.throws(() => requireSample(session, {...captured, sequence: 500}, 35), /sample/);
  assert.throws(() => requireSample(session, captured, 35, Date.now() + 7000), /unavailable/);
  const earlier = await hold(10); assert.equal(earlier.from_seconds, 10);
  report(10, 1); assert.throws(() => requireSample(session, captured, 35), /different point/);
});

test('failed and insufficient catch-up keep the original interval for retry', async t => {
  const {session, report, sample, hold, behavior} = setup(t);
  report(35); const held = await hold(); report(36);
  const returning = () => privateAction(session, 'return', {branch_id: held.id, from_seconds: 35,
    through_seconds: session.playback.at_seconds, content_version: sample().content_version, epoch: 0, sequence: sample().sequence, ...preferences});
  assert.equal((await returning()).status, 'insufficient_evidence'); assert.equal(session.mirror.hold.id, held.id);
  report(45); behavior.unavailable = true;
  assert.equal((await returning()).status, 'unavailable'); assert.equal(session.mirror.hold.id, held.id);
  behavior.unavailable = false; assert.equal((await returning()).status, 'ready'); assert.equal(session.mirror.hold, null);
});

test('quotes stay verbatim and completed; private references exclude generated memory and title relationships', async t => {
  const {session, story, report, hold, ask, calls} = setup(t);
  report(35); const held = await hold(); const answer = await ask(held, 20);
  assert.equal(answer.quote.text, story.transcript[1].text);
  assert.notEqual(answer.quote.text, answer.moment.answer);
  const context = personalContext(story, 32);
  assert.equal(originalQuote({grounding: {evidence_ids: ['t3']}}, context)?.id, 't2', 'unfinished t3 is never quoted');
  const refs = personalReferences('Explain the offside rule');
  assert.deepEqual(refs.map(ref => ref.id), ['g-soccer-offside']); assert.equal(refs[0].source, 'reference');
  assert.match(refs[0].source_url, /theifab.com/);
  assert.deepEqual(personalReferences('Who is Arun?'), []);
  assert.deepEqual(personalReferences('What happened when she plays with that ball?'), [], 'generic words cannot select an unrelated rule');
  const memory = createMemory(); memory.connections.push({id: 'generated', scope: 'general', title_id: '*', validated: true});
  assert.deepEqual(connections(35, '', memory, {...context, references: refs}), refs);
  const rule = await ask(held, 20, 'Explain the offside rule', false);
  assert.equal(calls.at(-1).playback_context.references[0].id, 'g-soccer-offside');
  assert.equal(rule.evidence[0].source, 'reference'); assert.match(rule.evidence[0].source_url, /theifab.com/);
  assert.equal(session.playback.play_state, 'playing');
});

test('one opted-in thread stays quiet without developments, is throttled, and updates separately from the help interval', async t => {
  const {session, report, sample, hold, ask, calls, behavior} = setup(t);
  report(35); const held = await hold(); const answer = await ask(held, 35, 'Why keep the kite?');
  const followed = await privateAction(session, 'thread', {enabled: true, answer_id: answer.id});
  const threadId = followed.thread.id;
  assert.equal((await privateAction(session, 'thread', {enabled: true, answer_id: answer.id})).thread.id, threadId, 'toggle retry is idempotent');
  const before = calls.length;
  report(36); assert.equal((await privateAction(session, 'thread-check', sample())).updated, false); assert.equal(calls.length, before);
  report(45); behavior.quiet = true;
  const quiet = await privateAction(session, 'thread-check', sample());
  assert.equal(quiet.updated, false); assert.equal(quiet.thread.revision, 0);
  assert.equal(quiet.thread.help.id, answer.id);
  report(60); behavior.quiet = false;
  const afterQuiet = calls.length;
  assert.equal((await privateAction(session, 'thread-check', sample())).updated, false);
  assert.equal(calls.length, afterQuiet, `repeat requests are bounded by ${THREAD_CHECK_MS}ms`);
  session.mirror.thread.checked_at = 0;
  const update = await privateAction(session, 'thread-check', sample());
  assert.equal(update.updated, true); assert.equal(update.thread.revision, 1); assert.equal(update.thread.help.at_seconds, 60);
  assert.ok(calls.at(-1).playback_context.follow_thread.new_evidence_ids.includes('t5'));
  assert.equal(session.mirror.hold.from_seconds, 35, 'an update is not a new help interval or a comprehension acknowledgement');
  assert.equal(session.playback.play_state, 'playing');
  const followup = await ask(held, 60, 'Why does that matter?', false);
  assert.equal(followup.hold.from_seconds, 35);
  assert.equal(calls.at(-1).playback_context.previous_help.at_seconds, 60);
  assert.equal(followup.thread.id, threadId, 'a follow-up to a displayed update retains the chosen thread');
  await privateAction(session, 'thread', {enabled: false, answer_id: answer.id});
  assert.equal((await privateAction(session, 'thread-check', sample())).thread, null);
  await privateAction(session, 'thread', {enabled: true, answer_id: followup.id});
  await ask(held, 60, 'Explain another topic at this point', true);
  assert.equal(session.mirror.thread, null, 'an explicit new topic cancels following even at the same timestamp');
});

test('thread results are discarded after opt-out or revocation and cannot cite future evidence', async t => {
  const {session, report, sample, hold, ask, behavior} = setup(t);
  report(35); const held = await hold(); const answer = await ask(held, 35, 'Why keep the kite?');
  await privateAction(session, 'thread', {enabled: true, answer_id: answer.id}); report(45);
  behavior.future = true;
  await assert.rejects(privateAction(session, 'thread-check', sample()), /unavailable evidence/);
  assert.equal(session.mirror.thread.revision, 0); assert.equal(session.mirror.thread.checked_through_seconds, 35);
  behavior.future = false; session.mirror.thread.checked_at = 0;
  behavior.generating = async () => {await privateAction(session, 'thread', {enabled: false, answer_id: answer.id});};
  await assert.rejects(privateAction(session, 'thread-check', sample()), /followed question has ended/);
  behavior.generating = null; await privateAction(session, 'thread', {enabled: true, answer_id: answer.id});
  behavior.generating = () => {session.mirror = null;};
  await assert.rejects(privateAction(session, 'thread-check', sample()), /connection has ended/);
});
