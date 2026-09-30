import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';

const native = await build({entryPoints: ['src/Accessibility.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', plugins: [{name: 'a11y-native-boundary', setup(builder) {
  builder.onResolve({filter: /^@amazon-devices\/kepler-a11y-settings-interface-turbo$/}, () => ({path: 'a11y', namespace: 'boundary'}));
  builder.onLoad({filter: /.*/, namespace: 'boundary'}, () => ({contents: 'export const KeplerA11ySettingsInterface=globalThis.api;'}));
}}]});
function settings() {
  const api = {}; const handlers = {}; const removed = [];
  for (const [key, get, prefix, value] of [
    ['captions', 'isClosedCaptioningEnabled', 'ClosedCaptioningState', false],
    ['captionPreferences', 'getCaptionPreferences', 'CaptioningPreferences', {textSize: 'large', textColor: 'yellow'}],
    ['screenReader', 'isScreenReaderEnabled', 'ScreenReaderState', true],
    ['highContrast', 'isHighContrastTextEnabled', 'HighContrastTextState', true],
    ['audioDescription', 'isAudioDescriptionPreferred', 'AudioDescriptionState', true],
    ['textScale', 'getScalingMultiplier', 'UiScaleSetting', 1.3],
  ]) {
    api[get] = async () => value;
    api[`add${prefix}Listener`] = async handler => {handlers[key] = handler; return true;};
    api[`remove${prefix}Listener`] = async () => {removed.push(key);};
  }
  return {api, handlers, removed};
}
function watcher(api) {
  const context = {module: {exports: {}}, api}; vm.runInNewContext(native.outputFiles[0].text, context);
  const snapshots = []; const owner = new context.module.exports.Accessibility(value => snapshots.push(JSON.parse(JSON.stringify(value))));
  return {owner, snapshots};
}
test('native named export reads/subscribes once, emits preferences and ignores events after cleanup', async () => {
  const {api, handlers, removed} = settings(); const {owner, snapshots} = watcher(api);
  await owner.start();
  assert.equal(snapshots.at(-1).captions, false); assert.equal(snapshots.at(-1).screenReader, true); assert.equal(snapshots.at(-1).textScale, 1.3);
  handlers.captions(true); assert.equal(snapshots.at(-1).captions, true);
  await owner.start(); const count = snapshots.length; owner.stop(); handlers.captions(false);
  assert.equal(snapshots.length, count); assert.equal(removed.length, 6);
});
test('late getters never overwrite a newer native setting; late registration is removed', async () => {
  const {api, handlers, removed} = settings(); let finish;
  api.isClosedCaptioningEnabled = () => new Promise(resolve => {finish = resolve;});
  const {owner, snapshots} = watcher(api); const pending = owner.start(api);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  handlers.captions(true); finish(false); await pending;
  assert.equal(snapshots.at(-1).captions, true); owner.stop();
  let register;
  api.addClosedCaptioningStateListener = () => new Promise(resolve => {register = resolve;});
  const next = watcher(api); const opening = next.owner.start(api);
  while (!register) await new Promise(resolve => setImmediate(resolve));
  next.owner.stop(); register(true); await opening;
  assert.equal(removed.filter(key => key === 'captions').length, 2);
});
test('out-of-order UI scale reads keep the latest system scale', async () => {
  const {api, handlers} = settings(); const {owner, snapshots} = watcher(api); await owner.start(api);
  const pending = []; api.getScalingMultiplier = () => new Promise(resolve => pending.push(resolve));
  handlers.textScale(2); handlers.textScale(3);
  pending[1](1.7); await new Promise(resolve => setImmediate(resolve));
  pending[0](1.4); await new Promise(resolve => setImmediate(resolve));
  assert.equal(snapshots.at(-1).textScale, 1.7); owner.stop();
});

const web = await build({stdin: {contents: "export * from './web/accessibility'; export * from './web/preferences';", resolveDir: process.cwd()}, bundle: true, write: false, format: 'cjs', platform: 'node'});
test('caption overrides, migration and validated style mapping preserve viewer control', () => {
  const storage = new Map(); const style = new Map();
  const context = {module: {exports: {}}, window: {}, document: {documentElement: {style: {setProperty: (key, value) => style.set(key, value)}, dataset: {}}},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)}};
  vm.runInNewContext(web.outputFiles[0].text, context); const a = context.module.exports;
  assert.equal(a.captionChoice(false), false); a.saveCaptionChoice(true); assert.equal(a.captionChoice(false), true);
  a.saveCaptionChoice(null); assert.equal(a.captionChoice(false), false);
  storage.set('selene.preferences', JSON.stringify({need: 'Easy to hear'})); assert.equal(a.readPreferences().need, 'Slower answer voice');
  const valid = a.accessibilitySettings({captions: false, screenReader: true, textScale: 1.3, captionPreferences: {textColor: 'yellow', textSize: 'large', textFont: 'serif', backgroundColor: 'black', backgroundOpacity: 'percent_50', evil: 'url(http://evil)'}});
  a.applyAccessibility(valid); assert.equal(style.get('--selene-text-scale'), '1.3');
  assert.equal(a.captionStyle(valid).fontFamily, 'serif'); assert.equal(a.captionStyle(valid).color, 'rgba(255,255,0,1)');
  assert.equal(a.captionStyle(valid).backgroundColor, 'rgba(0,0,0,0.5)'); assert.equal(valid.captionPreferences.evil, undefined);
  assert.equal(a.accessibilitySettings({textScale: NaN, captions: 'false'}).captions, undefined);
  assert.equal(a.accessibilitySettings({textScale: 20}).textScale, undefined);
  const unknown = a.captionStyle(a.accessibilitySettings({captionPreferences: {textColor: '__proto__', backgroundColor: 'constructor', textFont: 'toString', textSize: 'valueOf', textOpacity: '__proto__'}}));
  assert.equal(unknown.color, 'rgba(255,255,255,1)'); assert.equal(unknown.fontFamily, undefined);
});
