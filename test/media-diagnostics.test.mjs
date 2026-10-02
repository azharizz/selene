import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ui, returnWindow, verifyServedBuild} from '../scripts/vega-feature.mjs';

const compiled = await build({entryPoints: ['web/mediaDiagnostics.ts'], bundle: true, write: false, format: 'cjs', platform: 'node'});
test('startup failure is observable before playback, safe for logs, and listeners detach', () => {
  const records = [], messages = [];
  const context = {module: {exports: {}}, console: {info: (_, json) => records.push(JSON.parse(json))},
    window: {ReactNativeWebView: {postMessage: value => messages.push(value)}}};
  vm.runInNewContext(compiled.outputFiles[0].text, context);
  const player = new EventTarget();
  Object.assign(player, {currentTime: 0, duration: NaN, paused: true, ended: false, seeking: false,
    readyState: 0, networkState: 3, error: {code: 4, message: 'https://private.example/video?token=secret'}, canPlayType: () => 'maybe',
    buffered: {length: 1, start: () => 0, end: () => 96}, videoWidth: 960, videoHeight: 540, playbackRate: 1,
    getVideoPlaybackQuality: () => ({totalVideoFrames: 75, droppedVideoFrames: 2})});
  const stop = context.module.exports.observeMedia(player, 'offside-rule');
  player.dispatchEvent(new Event('error'));
  assert.equal(records[0].errorCode, 4);
  assert.equal(records[0].currentTime, 0);
  assert.equal(records[0].duration, null);
  assert.equal(records[0].contentId, 'offside-rule');
  assert.equal(records[0].mp4Support, 'maybe');
  assert.deepEqual(records[0].buffered, [[0, 96]]);
  assert.equal(records[0].totalVideoFrames, 75);
  assert.equal(records[0].droppedVideoFrames, 2);
  assert.equal(records[0].videoWidth, 960);
  assert.equal(messages.length, 1);
  assert(!messages[0].includes('secret'));
  context.module.exports.reportMedia(player, 'offside-rule', 'control', 'player-session:pause');
  assert.equal(records[1].detail, 'player-session:pause');
  stop(); player.dispatchEvent(new Event('playing'));
  assert.equal(records.length, 2);
  context.window.ReactNativeWebView.postMessage = () => {throw new Error('bridge disconnected');};
  assert.doesNotThrow(() => context.module.exports.reportMedia(player, 'offside-rule', 'control', 'keyboard:toggle'));
});

test('device-flow assertions distinguish recap time from fallback text and resolve actual buttons', () => {
  const state = ui('<root><child clickable="true" id="outer"><child clickable="true" id="save"><text>Hold our place</text></child></child><child><text>Covers 0:14 to 1:11 · TV 1:26</text></child></root>');
  assert.equal(state.button('Hold our place').getAttribute('id'), 'save');
  assert.deepEqual(returnWindow(state.labels), {from: 14, through: 71, tv: 86});
  assert.deepEqual(returnWindow(['Covers 0:07 to 0:26 · TV 0:31', 'Covers', '0:07', ' to ', '0:26', ' · TV 0:46']),
    {from: 7, through: 26, tv: 46});
  assert.equal(returnWindow(['Requested 0:03 to 0:03', 'There was no gap at the sampled TV moment.']), null);
  assert.equal(returnWindow(['The recap could not be prepared.']), null);
});

test('feature preflight rejects stale relay catalogs and mismatched served assets', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {globalThis.fetch = originalFetch;});
  const sha = value => createHash('sha256').update(value).digest('hex');
  const story = {id: 'test', video: '/media/test.mp4'};
  const current = {...story, content_version: sha(JSON.stringify(story))};
  let served = current;
  const assets = {'/app.js': 'web build', '/app.css': 'styles', '/media/test.mp4': 'clip bytes'};
  const expected = {webSha256: sha(assets['/app.js']), cssSha256: sha(assets['/app.css']), mediaSha256: sha(assets[story.video])};
  globalThis.fetch = async url => url.pathname === '/api/story' ? Response.json(served) : new Response(assets[url.pathname]);
  await verifyServedBuild('http://localhost', story, expected);
  served = {...current, content_version: 'previous relay version'};
  await assert.rejects(verifyServedBuild('http://localhost', story, expected), /Restart the relay/);
  served = current;
  for (const path of Object.keys(assets)) {
    const before = assets[path]; assets[path] = 'different bytes';
    await assert.rejects(verifyServedBuild('http://localhost', story, expected), /differs from the recorded local build/);
    assets[path] = before;
  }
});

test('console observation catches a startup error while paused without issuing playback commands', () => {
  const player = new EventTarget();
  Object.assign(player, {paused: true, ended: false, seeking: false, readyState: 0, networkState: 2,
    currentTime: 0, error: null, canPlayType: () => 'maybe'});
  const errors = [], timers = new Set();
  vm.runInNewContext(readFileSync('scripts/measure-playback.js', 'utf8'), {
    document: {hidden: false, querySelector: () => player},
    console: {info() {}, error: (...args) => errors.push(args)},
    setTimeout: fn => {timers.add(fn); return fn;}, clearTimeout: fn => timers.delete(fn),
  });
  player.error = {code: 3, message: 'Decode failed'};
  player.dispatchEvent(new Event('error'));
  assert.equal(errors[0][1].code, 3);
  assert.equal(errors[0][1].currentTime, 0);
  assert.equal(timers.size, 0);
  player.dispatchEvent(new Event('error'));
  assert.equal(errors.length, 1, 'completed observers detach');
});

test('device preflight terminates only an actually running Selene component', async () => {
  const {applicationRunning} = await import('../scripts/vega-feature.mjs');
  assert.equal(applicationRunning('application type pid id state\ncom.amazon.keplerlauncherapp.main I 1 9 VISIBLE', 'com.selene.tv.main'), false);
  assert.equal(applicationRunning('com.selene.tv.main I 2 10 BACKGROUND', 'com.selene.tv.main'), true);
  assert.equal(applicationRunning('com.selene.tv.main.other I 2 10 VISIBLE', 'com.selene.tv.main'), false);
});
