/* global __dirname */
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercises the shipped capture client; physical microphone/remote coverage requires a device.
const source = ts.transpileModule(readFileSync(join(__dirname, 'voice.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;

function client({accept = true, permission = 'granted', result = {transcript: 'Who is this?', requester: null, match: 'unknown', voice_available: true}, record} = {}) {
  const calls = [], stages = [];
  let dialog;
  let rejectRecording;
  const native = {
    record: record || (() => new Promise((resolve, reject) => {rejectRecording = reject; calls.push({kind: 'record', resolve});})),
    stop: async () => {},
    cancel: async () => {calls.push({kind: 'cancel'}); rejectRecording?.(new Error('cancelled'));},
  };
  const exports = {};
  vm.runInNewContext(source, {exports, require: name => name === 'react-native' ? {
    Alert: {alert: (_title, _message, buttons) => {dialog = buttons; queueMicrotask(() => buttons[accept ? 1 : 0].onPress());}},
    NativeModules: {SeleneVoiceRecorder: native}, Platform: {OS: 'android'},
    PermissionsAndroid: {PERMISSIONS: {RECORD_AUDIO: 'record'}, RESULTS: {GRANTED: 'granted'}, request: async () => permission},
  } : name === './api' ? {request: async (path, options) => {calls.push({kind: 'upload', path, options}); return result;}} : (() => {throw new Error(`Unexpected import ${name}`);})()});
  return {api: exports, calls, stages, dialog: () => dialog};
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('native audio is uploaded for review, not automatically submitted as a question', async () => {
  const harness = client();
  const controller = new AbortController();
  const pending = harness.api.recordQuestion('session', controller.signal, stage => harness.stages.push(stage));
  await tick();
  harness.calls.find(call => call.kind === 'record').resolve({audio: 'fixture-audio', format: 'm4a'});
  const result = await pending;
  assert.equal(result.transcript, 'Who is this?');
  assert.equal(harness.stages.join(','), 'permission,recording,processing');
  const uploads = harness.calls.filter(call => call.kind === 'upload');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].path, '/api/voice');
  assert.equal(uploads[0].options.session, 'session');
  assert.equal(uploads[0].options.body.audio, 'fixture-audio');
  assert.equal(uploads[0].options.body.format, 'm4a');
  assert.equal(uploads[0].options.body.action, 'question');
  assert.equal(uploads[0].options.body.consent, true);
});

test('declined consent or permission cannot start capture or upload', async () => {
  for (const options of [{accept: false}, {permission: 'denied'}]) {
    const harness = client(options);
    const pending = harness.api.recordQuestion('session', new AbortController().signal, () => {});
    if (options.accept === false) assert.equal(await pending, null);
    else await assert.rejects(pending, /Microphone permission/);
    assert.equal(harness.calls.length, 0);
  }
});

test('cancel releases native recording and prevents late upload', async () => {
  const harness = client();
  const controller = new AbortController();
  const pending = harness.api.recordQuestion('session', controller.signal, () => {});
  await tick();
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(harness.calls.filter(call => call.kind === 'cancel').length, 1);
  assert.equal(harness.calls.filter(call => call.kind === 'upload').length, 0);
});

test('empty transcription cannot become a reviewed question', async () => {
  const harness = client({record: async () => ({audio: 'bytes', format: 'm4a'}), result: {transcript: '  ', requester: null, match: 'unknown'}});
  await assert.rejects(harness.api.recordQuestion('session', new AbortController().signal, () => {}), /No question was heard/);
});
