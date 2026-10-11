import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateConversationSchedule, closeConversationSchedule, currentConversation, interruptConversation} from '../server/conversation-scheduler.mjs';
import {session, invitations} from './fixtures/conversation.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(run) {
  let now = 100000, id = 0, runs = 0;
  const s = session(now), timers = new Map(), events = [], contexts = [];
  const hooks = {now: () => now, setTimer: (callback, delay) => {timers.set(++id, {at: now + delay, callback}); return id;}, clearTimer: key => timers.delete(key),
    publish: event => events.push(event), round: async (read, options) => {runs++; const context = read(); contexts.push(context); return run(context, options, runs);}};
  const report = (values = {}, advance = 0) => {
    now += advance; Object.assign(s.playback, values, {received_at: now, sequence: s.playback.sequence + 1});
    updateConversationSchedule(s, hooks);
  };
  const tick = async (advance, values, fresh = true) => {
    now += advance;
    Object.assign(s.playback, values, fresh ? {received_at: now} : {});
    const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
    for (const [key, timer] of due) {timers.delete(key); timer.callback();}
    await settle();
  };
  return {s, hooks, timers, events, contexts, report, tick, runs: () => runs,
    start: () => updateConversationSchedule(s, {...hooks, connected: true})};
}
const show = context => ({action: 'show', ...invitations(), content_id: context.content_id, content_version: context.playback.content_version,
  epoch: context.playback.epoch, at_seconds: context.playback.at_seconds});
const schedule = at_seconds => ({action: 'schedule', at_seconds, opportunity: 'ending', reason: 'Estimated end'});

test('one agent-selected wake-up, no heartbeat inference, fresh context at 90 minutes, later actual end', async () => {
  const h = harness((context, _, runs) => runs === 1 ? schedule(5400) : context.playback.play_state === 'ended'
    ? {...show(context), opportunity: 'ending', boundary_id: 'ended'} : schedule(5710));
  h.start(); await settle();
  for (let i = 0; i < 5; i++) h.report({at_seconds: 4200 + i});
  assert.equal(h.runs(), 1); assert.equal(h.timers.size, 1);
  await h.tick(1200000, {at_seconds: 5400});
  assert.equal(h.runs(), 2); assert.equal(h.contexts[1].transcript.at(-1).id, 'late-play');
  assert.equal(h.events.filter(event => event.conversation).length, 0, 'estimate did not manufacture full time');
  h.report({at_seconds: 5710, play_state: 'ended'}); await settle();
  assert.equal(h.runs(), 3); assert.equal(h.events.at(-1).conversation.opportunity, 'ending');
  for (let i = 0; i < 5; i++) h.report();
  assert.equal(h.runs(), 3);
  closeConversationSchedule(h.s); assert.equal(h.timers.size, 0);
});

test('pause, buffering and rate changes reassess without treating elapsed wall time as watched video', async () => {
  const h = harness(() => schedule(5400)); h.start(); await settle();
  h.report({play_state: 'paused'}); await settle();
  assert.equal(h.runs(), 2);
  await h.tick(1200000, {at_seconds: 4200});
  assert.equal(h.runs(), 2); assert.equal(h.timers.size, 0);
  h.report({play_state: 'buffering'}); await settle();
  await h.tick(30000, {}); assert.equal(h.runs(), 3);
  h.report({play_state: 'playing', playback_rate: 2}); await settle();
  await h.tick(600000, {at_seconds: 5400});
  assert.equal(h.runs(), 5);
  closeConversationSchedule(h.s);
});

test('stale reports cannot generate; next fresh report resumes a due check', async () => {
  const h = harness((context, _, runs) => runs === 1 ? schedule(5400) : show(context)); h.start(); await settle();
  await h.tick(1200000, {at_seconds: 5400}, false);
  assert.equal(h.runs(), 1); assert.equal(h.timers.size, 0);
  h.report(); await settle();
  assert.equal(h.runs(), 2); assert.ok(currentConversation(h.s, h.hooks.now()));
  assert.equal(currentConversation(h.s, h.hooks.now() + 6001), null);
  closeConversationSchedule(h.s);
});

test('seek or unpair while generation runs discards results and aborts without touching viewer state', async () => {
  let finish, signal;
  const h = harness((context, options) => {signal = options.signal; return new Promise(resolve => {finish = () => resolve(show(context));});});
  h.start(); const pending = finish;
  h.s.memory.lastExplanation = {answer: 'Keep my answer'};
  h.report({epoch: 1, at_seconds: 4300});
  assert.equal(signal.aborted, true); pending(); await settle();
  assert.equal(h.events.filter(event => event.conversation).length, 0);
  await h.tick(1, {}); assert.equal(h.runs(), 2);
  closeConversationSchedule(h.s); assert.equal(signal.aborted, true);
  finish(); await settle();
  assert.equal(h.events.filter(event => event.conversation).length, 0);
  assert.deepEqual(h.s.memory.lastExplanation, {answer: 'Keep my answer'});
  assert.equal(h.s.pendingCommand, undefined); assert.equal(h.timers.size, 0);
});

test('viewer priority and bounded retry do not cause model polling', async () => {
  const h = harness(() => {throw new Error('provider unavailable');});
  h.s.controller = new AbortController(); h.start(); await settle();
  assert.equal(h.runs(), 0);
  h.s.controller = null; await h.tick(30000, {}); assert.equal(h.runs(), 1);
  await h.tick(60000, {}); assert.equal(h.runs(), 2);
  await h.tick(60000, {}); h.report(); assert.equal(h.runs(), 2);
  h.report({at_seconds: 5400}); await settle(); assert.equal(h.runs(), 3, 'new evidence permits another attempt');
  closeConversationSchedule(h.s);
});

test('interrupted background round yields and retries without cancelling foreground work', async () => {
  const h = harness((_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))));
  h.start(); interruptConversation(h.s); await settle();
  assert.equal(h.s.mirror.conversation.controller, null);
  assert.equal(h.timers.size, 1); assert.equal(h.runs(), 1);
  closeConversationSchedule(h.s);
});

test('cooldown and same-boundary deduplication survive heartbeat and stream reconnect', async () => {
  const h = harness(context => show(context)); h.start(); await settle();
  assert.equal(h.events.filter(event => event.conversation).length, 1);
  h.start(); h.report({at_seconds: 5400}); await settle();
  assert.equal(h.runs(), 1);
  await h.tick(600000, {}); assert.equal(h.runs(), 2);
  assert.equal(h.events.filter(event => event.conversation).length, 1);
  closeConversationSchedule(h.s);
});

test('unopened pairing, companion sessions, and exhausted concurrency never start background work', () => {
  const h = harness(() => {throw new Error('must not run');});
  h.report(); assert.equal(h.runs(), 0);
  h.s.contentId = null; h.start(); assert.equal(h.runs(), 0);
  h.s.contentId = 'conversation-test';
  updateConversationSchedule(h.s, {...h.hooks, connected: true, acquire: () => null});
  assert.equal(h.runs(), 0); assert.equal(h.timers.size, 1);
  closeConversationSchedule(h.s);
});

test('a newly completed break hint brings an estimated check forward for agent assessment', async () => {
  const h = harness((context, _, runs) => runs === 1 ? schedule(7000) : {action: 'quiet'});
  h.start(); await settle();
  h.report({at_seconds: 5710}, 1510000); await settle();
  assert.equal(h.runs(), 2, 'the existing final-whistle cue caused reassessment before target 7000');
  assert.equal(h.contexts[1].transcript.at(-1).id, 'whistle');
  assert.equal(h.events.filter(event => event.conversation).length, 0, 'a hint alone never publishes an invitation');
  closeConversationSchedule(h.s);
});
