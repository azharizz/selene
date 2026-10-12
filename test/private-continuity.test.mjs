import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequester} from '../server/requesters.mjs';
import {getStory, movieGraphEvidence} from '../server/context.mjs';
import {playerStory, recordPlayback, requireSample, personalContext, originalQuote} from '../server/personal.mjs';
import {privateAction, privateState, THREAD_CHECK_MS} from '../server/private-actions.mjs';

const preferences = {need: 'Show visually', language: 'English', recipient: 'everyone'};
function setup(t, storyId = 'the-red-kite') {
  // Browser startup must not age these explicit playback samples; stale-time checks advance their own clock.
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
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
  const calls = [], behavior = {quiet: false, clarification: false, unavailable: false, future: false, generating: null};
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://model.test.invalid');
    const body = JSON.parse(options.body);
    if (behavior.unavailable) throw new Error('fixture unavailable');
    if (body.tool_choice === 'required')
      return Response.json({choices: [{message: {role: 'assistant', tool_calls: [{id: 'context', type: 'function', function: {name: 'get_scene_context', arguments: '{}'}}]}}]});
    if (body.response_format.json_schema.name === 'selene_grounding_review') {
      return Response.json({choices: [{message: {content: JSON.stringify({supported: true, issue: '', pause_requested: false})}}]});
    }
    if (body.response_format.json_schema.name === 'selene_visual_feedback')
      return Response.json({choices: [{message: {content: JSON.stringify({action: 'keep', issue: '', response: null})}}]});
    const content = body.messages.find(item => item.role === 'user').content;
    const text = Array.isArray(content) ? content.find(part => part.type === 'text' && part.text.includes('runtime data:\n')).text : content;
    const runtime = JSON.parse(text.split('runtime data:\n')[1]);
    // Imported questions include bounded multimodal evidence inline; other phone requests retrieve it through the tool.
    const tool = body.messages.find(item => item.role === 'tool');
    const context = tool ? JSON.parse(tool.content) : runtime.playback_context;
    assert.ok(Array.isArray(context.transcript) && Array.isArray(context.facts), 'generation uses supplied bounded evidence');
    calls.push(runtime);
    await behavior.generating?.(runtime);
    const quiet = behavior.quiet && context.follow_thread;
    const id = behavior.future ? 'unseen-future' : context.follow_thread?.new_evidence_ids[0] ?? context.return_window?.interval_evidence_ids[0]
      ?? context.transcript.at(-1)?.id ?? context.facts.at(-1).id;
    const result = {version: '1.0', state: quiet ? 'quiet' : behavior.clarification ? 'clarification' : 'response', answer: quiet ? '' : `Supported explanation at ${context.at_seconds}.`,
      visual: behavior.clarification || context.return_window || context.follow_thread ? {status: 'none', svg: '', description: '', animations: []}
        : {status: 'ready', description: 'Two connected story elements.',
          svg: '<svg viewBox="0 0 960 540"><g id="diagram"><circle cx="280" cy="270" r="90" fill="#ffad33"/><rect x="590" y="180" width="180" height="180" fill="#f1f1f1"/><line x1="370" y1="270" x2="590" y2="270" stroke="#ffad33" stroke-width="22"/></g></svg>',
          animations: [{target_id: 'diagram', duration_ms: 1600, delay_ms: 0, keyframes: [{opacity: 0.4, transform: 'none'}, {opacity: 1, transform: 'none'}]}]},
      intervention: {playback: 'keep_watching', audio: 'silent'},
      grounding: {content_id: story.id, scene_id: context.scene_id, at_seconds: context.at_seconds, evidence_ids: quiet ? [] : [id], graph_ids: []}};
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
  const first = await ask(held, 20);
  assert.equal(session.mirror.hold.from_seconds, 35);
  assert.equal(session.mirror.hold.question_at_seconds, 20);
  report(45);
  await ask(held, 20, 'Can you explain that word?', false);
  assert.equal(calls.at(-1).playback_context.at_seconds, 20);
  assert.match(calls.at(-1).playback_context.initial_request, /grandma/);
  assert.deepEqual(calls.at(-1).playback_context.previous_help.visual, first.moment.visual);
  assert.deepEqual(calls.at(-1).playback_context.previous_help.visual_feedback, [{action: 'keep', issue: ''}]);
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

test('quotes stay verbatim and completed; private contexts have no general or prior-answer graph memory', async t => {
  const {session, story, report, hold, ask, calls} = setup(t);
  report(35); const held = await hold(); const answer = await ask(held, 20);
  assert.equal(answer.quote.text, story.transcript[1].text);
  assert.notEqual(answer.quote.text, answer.moment.answer);
  const context = personalContext(story, 32);
  assert.equal(originalQuote({grounding: {evidence_ids: ['t3']}}, context)?.id, 't2', 'unfinished t3 is never quoted');
  assert.deepEqual(movieGraphEvidence(context), []);
  assert.equal(context.references, undefined);
  await ask(held, 20, 'Who is Arun?', false);
  assert.equal(calls.at(-1).playback_context.references, undefined);
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
  assert.equal(calls.at(-1).playback_context.previous_help, undefined);
  assert.equal(calls.at(-1).playback_context.initial_request, 'Explain another topic at this point');
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

test('matched requester belongs to one question through clarification, follow-ups, recap and followed thread', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'selene-private-requester-'));
  const oldFile = process.env.SELENE_REQUESTERS_FILE;
  process.env.SELENE_REQUESTERS_FILE = join(directory, 'requesters.json');
  t.after(async () => {
    oldFile === undefined ? delete process.env.SELENE_REQUESTERS_FILE : process.env.SELENE_REQUESTERS_FILE = oldFile;
    await rm(directory, {recursive: true, force: true});
  });
  const profile = await createRequester({label: 'Parent', role: 'parent', style: 'simple', language: 'Spanish', consent: true});
  const {session, report, sample, hold, calls, behavior} = setup(t);
  report(35); const held = await hold();
  const input = {branch_id: held.id, at_seconds: 35, request: 'What happened?', new_topic: true,
    clarification: false, requester_id: profile.id, ...preferences};
  await assert.rejects(privateAction(session, 'ask', {...input, requester_id: 'not-a-uuid'}), {status: 400});
  await assert.rejects(privateAction(session, 'ask', {...input, requester_id: '-'.repeat(36)}), {status: 400});
  behavior.clarification = true;
  const clarification = await privateAction(session, 'ask', input);
  assert.equal(clarification.moment.state, 'clarification');
  assert.deepEqual(clarification.moment.audience, {recipient: 'parent', source: 'profile'});
  assert.equal(calls.at(-1).language, 'Spanish'); assert.equal(calls.at(-1).need, 'Explain simply');
  behavior.clarification = false;
  const answered = await privateAction(session, 'ask', {...input, request: 'The kite.', clarification: true, new_topic: false});
  assert.deepEqual(answered.moment.audience, {recipient: 'parent', source: 'profile'},
    'raw phone preferences do not invalidate a personalized clarification');
  const declared = await privateAction(session, 'ask', {...input, request: 'I am grandma. Explain that again.', new_topic: false});
  assert.deepEqual(declared.moment.audience, {recipient: 'grandparent', source: 'declaration'});
  const followup = await privateAction(session, 'ask', {...input, request: 'Why does that matter?', new_topic: false});
  assert.deepEqual(followup.moment.audience, {recipient: 'grandparent', source: 'declaration'});
  assert.equal(calls.at(-1).language, 'Spanish', 'role override preserves the enrolled communication preferences');
  await privateAction(session, 'thread', {enabled: true, answer_id: followup.id});
  report(45);
  const updated = await privateAction(session, 'thread-check', sample());
  assert.equal(updated.updated, true);
  assert.deepEqual(updated.thread.help.moment.audience, {recipient: 'grandparent', source: 'declaration'});
  assert.equal('requester' in updated.thread, false, 'private public state has no profile record');
  const returned = await privateAction(session, 'return', {branch_id: held.id, from_seconds: 35,
    through_seconds: 45, content_version: sample().content_version, epoch: 0, sequence: sample().sequence,
    requester_id: profile.id, ...preferences});
  assert.deepEqual(returned.moment.audience, {recipient: 'grandparent', source: 'declaration'});
  const next = await hold();
  await privateAction(session, 'ask', {...input, branch_id: next.id, at_seconds: 45});
  const {requester_id, ...unmatched} = input;
  const newTopic = await privateAction(session, 'ask', {...unmatched, branch_id: next.id, at_seconds: 45, request: 'Explain another topic.'});
  assert.deepEqual(newTopic.moment.audience, {recipient: 'everyone', source: 'request'});
  assert.equal(calls.at(-1).playback_context.requester, undefined, 'new topics do not reuse a previous acoustic match');
  assert.equal(session.mirror.thread, null);
});

test('generated demo-matching questions forward current communication choices into diagrams, follow-ups and thread updates', async t => {
  const {session, report, sample, hold, calls} = setup(t, 'football-match');
  report(18); const held = await hold();
  const input = {branch_id: held.id, at_seconds: 18, request: 'What is offside?', new_topic: true, clarification: false,
    answer_mode: 'generate', ...preferences,
    communication_preferences: {role: 'adult', style: 'detailed', language: 'Spanish', need: 'Slower answer voice'}};
  const answer = await privateAction(session, 'ask', input);
  assert.equal(calls.length, 1, 'matching an authored question still invokes generation when requested');
  assert.equal(answer.moment.provenance.kind, 'generated');
  assert.deepEqual(answer.moment.audience, {recipient: 'adult', source: 'request'});
  assert.equal(answer.moment.visual.status, 'ready');
  assert.equal(calls.at(-1).language, 'Spanish');
  assert.equal(calls.at(-1).need, 'Slower answer voice');
  assert.equal(calls.at(-1).playback_context.requester.style, 'detailed',
    'the same effective requester reaches answer and SVG generation, not an authored title lookup');
  const cited = answer.moment.grounding.evidence_ids;
  assert.ok(cited.every(id => getStory('football-match').transcript.some(cue => cue.id === id && cue.end <= 18)
    || getStory('football-match').facts.some(fact => fact.id === id && fact.available_at <= 18)));
  const followup = await privateAction(session, 'ask', {...input, request: 'Why does that rule matter?', new_topic: false,
    communication_preferences: {style: 'simple', language: 'English', need: 'Explain simply'}});
  assert.equal(followup.moment.audience.recipient, 'adult');
  assert.equal(calls.at(-1).language, 'English');
  assert.equal(calls.at(-1).need, 'Explain simply');
  assert.equal(calls.at(-1).playback_context.requester.style, 'simple');
  await privateAction(session, 'thread', {enabled: true, answer_id: followup.id});
  report(60);
  const update = await privateAction(session, 'thread-check', sample());
  assert.equal(update.updated, true);
  assert.equal(calls.length, 3, 'a generated followed question cannot switch to authored updates');
  assert.equal(calls.at(-1).answer_mode, 'generate');
  assert.equal(calls.at(-1).language, 'English');
  assert.equal(calls.at(-1).playback_context.requester.role, 'adult');
  assert.equal(calls.at(-1).playback_context.requester.style, 'simple');
  assert.equal(update.thread.help.moment.provenance.kind, 'generated');
  assert.equal(session.playback.play_state, 'playing');
});
