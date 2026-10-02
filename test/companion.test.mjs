import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const compiled = await build({entryPoints: ['src/Companion.tsx'], bundle: true, write: false, format: 'cjs', platform: 'node', loader: {'.png': 'dataurl'}, plugins: [{
  name: 'native-test-boundary', setup(builder) {
    builder.onResolve({filter: /^(react|react-native|@amazon-devices\/(kepler-media-controls|webview))$/}, args => ({path: args.path, namespace: 'boundary'}));
    builder.onLoad({filter: /.*/, namespace: 'boundary'}, ({path}) => ({contents: path === 'react' ? 'export default {createElement:(type,props,...children)=>({type,props:{...props,children}}),createRef:()=>({current:null}), Component: class {constructor(props){this.props=props;} setState(next,done){this.state={...this.state,...next};done?.();}}};' : path === 'react-native' ? 'export const StyleSheet={create: x=>x}; export const AppState={addEventListener:()=>({remove(){}})}; export const Pressable=0,ScrollView=0,Text=0,View=0,Image=0; export const BackHandler={addEventListener:()=>({remove(){}})};' : path === '@amazon-devices/webview' ? 'export const WebView=0;' : 'export const MediaControlComponentAsync={makeMediaControlEndpointLocator:()=>globalThis.locator}; export const Action={PLAY:{name:"PLAY"},PAUSE:{name:"PAUSE"}};'}));
  },
}]});
function instance(locator) {
  const context = {module: {exports: {}}, locator, console: {log() {}, warn() {}}};
  vm.runInNewContext(compiled.outputFiles[0].text, context);
  const app = new context.module.exports.Companion({onReady() {}, onDemo() {}});
  app.mounted = true;
  return app;
}
function endpoint() {
  const calls = [];
  let listener;
  let state = {id: {id: 7}, mediaInfo: {id: {contentId: 'current', catalogName: 'test'}}, playbackState: {playbackStatus: 'PLAYING', position: {position: {seconds: 125, nanoseconds: 500000000}}}, capabilities: {actions: [{name: 'PLAY'}, {name: 'PAUSE'}]}, controls: []};
  return {calls, notify: () => listener?.onStateChanged([state]), change: () => {state = {...state, mediaInfo: {id: {contentId: 'changed', catalogName: 'test'}}};}, client: {
    getEndpointPackageId: () => ({id: 'test.provider'}),
    getSessionState: async id => {calls.push(['read', id?.id]); return [state];},
    getMetadata: async () => ({title: 'Current title', mediaProviderInfo: {name: 'Test Provider'}, description: 'Future story details are deliberately ignored'}),
    addListener: async value => {listener = value; return {unsubscribe: () => calls.push(['unsubscribe'])};},
    pause: async id => {calls.push(['pause', id.id]); state = {...state, playbackState: {playbackStatus: 'PAUSED'}};},
    play: async id => calls.push(['play', id.id]), destroy: () => calls.push(['destroy']),
  }};
}
test('native discovery is read-only; commands target selected session and report actual state', async () => {
  const provider = endpoint();
  const app = instance({getMediaControlEndpoints: async () => [provider.client]});
  await app.scan();
  assert.equal(app.state.sessions.length, 1);
  assert.equal(provider.calls.some(([action]) => action === 'pause' || action === 'play'), false);
  await app.select(app.state.sessions[0]);
  assert.equal(app.state.title, 'Current title');
  assert.equal(JSON.stringify(app.state).includes('Future story details'), false);
  await app.command('pause');
  assert.equal(provider.calls.filter(([action, id]) => action === 'pause' && id === 7).length, 1);
  assert.equal(app.state.selected.state.playbackState.playbackStatus, 'PAUSED');
  provider.change();
  await app.command('play');
  assert.equal(provider.calls.some(([action]) => action === 'play'), false);
  assert.equal(app.state.selected, null);
  app.componentWillUnmount();
  assert.equal(provider.calls.at(-1)[0], 'destroy');
});

test('provider notifications during a command do not discard its bridge reply', async () => {
  const provider = endpoint();
  const app = instance({getMediaControlEndpoints: async () => [provider.client]});
  await app.scan(); await app.select(app.state.sessions[0]); await app.openMoment();
  await new Promise(resolve => setImmediate(resolve));
  const replies = []; app.publish = message => replies.push(message);
  const read = provider.client.getSessionState;
  provider.client.getSessionState = async id => {provider.notify(); return read(id);};
  const {appUrl} = JSON.parse(await readFile('src/config.json', 'utf8'));
  await app.bridge(JSON.stringify({id: 1, action: 'refresh'}), `${appUrl.replace(/\/$/, '')}/?companion=1`);
  assert.equal(replies.filter(message => message.type === 'selene:playback' && message.id === 1).length, 1);
  app.componentWillUnmount();
});

test('metadata finishing after cancellation cannot reopen a moment', async () => {
  const provider = endpoint();
  const app = instance({getMediaControlEndpoints: async () => [provider.client]});
  await app.scan(); await app.select(app.state.sessions[0]);
  const read = provider.client.getMetadata;
  let finish;
  provider.client.getMetadata = () => new Promise(resolve => {finish = resolve;});
  const opening = app.openMoment();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  app.disconnect(); finish(await read()); await opening;
  assert.equal(app.state.snapshot, null);
});

test('late notifications from a closed provider cannot invalidate a new provider with the same session number', async () => {
  const old = endpoint(), next = endpoint();
  next.client.getEndpointPackageId = () => ({id: 'another.provider'});
  const app = instance({getMediaControlEndpoints: async () => [old.client, next.client]});
  await app.scan(); await app.select(app.state.sessions[0]); await app.openMoment();
  await new Promise(resolve => setImmediate(resolve));
  app.closeMoment(); await app.select(app.state.sessions[1]); await app.openMoment();
  old.change(); old.notify();
  assert.equal(app.state.snapshot.package_id, 'another.provider');
  app.componentWillUnmount();
});

test('own-player native transport and audio focus preserve buffering and explicit voice priority', async () => {
  let callbacks;
  const messages = [], states = [];
  const code = await build({entryPoints: ['src/OwnPlayerSession.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{name: 'player-session-boundary', setup(builder) {
    builder.onResolve({filter: /^@amazon-devices\/react-native-kepler$/}, () => ({path: 'player', namespace: 'boundary'}));
    builder.onLoad({filter: /.*/, namespace: 'boundary'}, () => ({contents: 'export const PlayerSession=globalThis.player; export const AudioFocusMode={AUDIO_FOCUS_NONE:0}; export const ErrorCode={},PlayerMediaOps={},PlayerState={},PlayerTrackRating={},PlayerRepeatMode={},PlayerShuffleMode={};'}));
  }}]});
  const context = {module: {exports: {}}, player: {create: () => true, setPlayerSessionCallback: value => {callbacks = value;}, setPlaybackState: value => states.push(value), destroy() {}}};
  vm.runInNewContext(code.outputFiles[0].text, context);
  const player = new context.module.exports.OwnPlayerSession(message => messages.push(message));
  player.start(); callbacks.onRewind(10); callbacks.onFastForward(20);
  assert.equal(messages[1].position_ms, -10000); assert.equal(messages[1].relative, true);
  assert.equal(messages[2].position_ms, 20000); assert.equal(messages[2].relative, true);
  const report = {position_ms: 1000, duration_ms: 96000, muted: false, volume: 1};
  player.update({...report, state: 'playing'});
  const primary = states.at(-1).audioFocus;
  assert.equal(primary, 'AudioFocusPrimary');
  player.update({...report, state: 'buffering'});
  assert.equal(states.at(-1).audioFocus, primary);
  assert.equal(states.at(-1).state, 'PlayerStateBuffering');
  player.setAudioFocus(true);
  const voiceFocus = states.at(-1).audioFocus;
  assert.equal(voiceFocus, 'AudioFocusPausedOrUnMixable');
  player.update({...report, state: 'playing'});
  player.update({...report, state: 'buffering'});
  assert.equal(states.at(-1).audioFocus, voiceFocus);
  player.setAudioFocus(false);
  assert.equal(states.at(-1).audioFocus, primary);
  for (const state of ['paused', 'stopped']) {
    player.update({...report, state});
    assert.equal(states.at(-1).audioFocus, 'AudioFocusNone');
  }
  player.stop();
});
test('empty endpoints and failed discovery are distinct; late clients are destroyed', async () => {
  const empty = instance({getMediaControlEndpoints: async () => []});
  await empty.scan();
  assert.match(empty.state.message, /No shared playback/);
  const failed = instance({getMediaControlEndpoints: async () => {throw new Error('Denied');}});
  await failed.scan();
  assert.match(failed.state.message, /discovery is unavailable/);
  let resolve;
  const late = instance({getMediaControlEndpoints: () => new Promise(done => {resolve = done;})});
  const pending = late.scan();
  while (!resolve) await new Promise(done => setImmediate(done));
  late.componentWillUnmount();
  const provider = endpoint(); resolve([provider.client]); await pending;
  assert.deepEqual(provider.calls, [['destroy']]);
});
test('application React code has no effect hooks', async () => {
  for (const path of ['src/App.tsx', 'src/Companion.tsx', 'web/App.tsx', 'web/CompanionMoment.tsx', 'web/Visual.tsx']) {
    assert.doesNotMatch(await readFile(path, 'utf8'), /\buse(?:Layout|Insertion)?Effect\b/);
  }
});

test('companion help uses the selected provider position and releases its foreground listener', async () => {
  const provider = endpoint();
  const app = instance({getMediaControlEndpoints: async () => [provider.client]});
  await app.scan();
  await app.select(app.state.sessions[0]);
  await app.openMoment();
  assert.equal(app.state.snapshot.at_seconds, 125.5);
  assert.equal(app.state.snapshot.content_id, 'current');
  assert.equal(app.state.snapshot.package_id, 'test.provider');
  assert.equal(app.state.snapshot.provider_name, 'Test Provider');
  assert.equal(JSON.stringify(app.state.snapshot).includes('Future story details'), false);
  assert.equal(provider.calls.some(([action]) => action === 'pause' || action === 'play'), false);
  app.closeMoment();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.state.snapshot, null);
  assert.equal(provider.calls.filter(([action]) => action === 'unsubscribe').length, 1);
  app.componentWillUnmount();
});

test('leaving a pending command suppresses playback; stale reads cannot replace a newer scan', async () => {
  const provider = endpoint();
  const app = instance({getMediaControlEndpoints: async () => [provider.client]});
  await app.scan();
  await app.select(app.state.sessions[0]);
  const readState = provider.client.getSessionState;
  let finishRead;
  provider.client.getSessionState = () => new Promise(resolve => {finishRead = resolve;});
  const pending = app.command('pause');
  while (!finishRead) await new Promise(resolve => setImmediate(resolve));
  app.disconnect();
  finishRead(await readState({id: 7}));
  await pending;
  assert.equal(provider.calls.some(([action]) => action === 'pause'), false);
  assert.equal(app.state.selected, null);

  let finishDiscovery;
  let calls = 0;
  const next = endpoint();
  const racing = instance({getMediaControlEndpoints: () => ++calls === 1
    ? new Promise(resolve => {finishDiscovery = resolve;}) : Promise.resolve([next.client])});
  const oldScan = racing.scan();
  while (!finishDiscovery) await new Promise(resolve => setImmediate(resolve));
  racing.disconnect();
  await racing.scan();
  finishDiscovery([provider.client]);
  await oldScan;
  assert.equal(racing.state.sessions[0].client, next.client);
  assert.equal(racing.state.busy, false);
  assert.equal(provider.calls.at(-1)[0], 'destroy');
  racing.componentWillUnmount();
});


test('readable playback tiles are paged and open a fresh moment in one selection', async () => {
  const providers = Array.from({length: 8}, () => endpoint());
  providers.forEach((provider, index) => {provider.client.getEndpointPackageId = () => ({id: `test.provider.${index}`});});
  const app = instance({getMediaControlEndpoints: async () => providers.map(value => value.client)});
  await app.scan();
  const collect = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(collect)];
  for (const [page, count] of [[0, 3], [1, 3], [2, 2]]) {
    app.setState({page});
    const tiles = collect(app.render()).filter(node => node.props?.tile);
    assert.equal(tiles.length, count);
    assert.ok(tiles.every(node => node.props.label === 'Current title' && node.props.detail.includes('Test Provider')));
  }
  app.props.accessibility = {textScale: 1.5, highContrast: true};
  const copy = collect(app.render()).find(node => node.props?.accessibilityLiveRegion === 'polite');
  assert.equal(copy.props.style.fontSize, 45); assert.equal(copy.props.style.lineHeight, 63); assert.equal(copy.props.style.color, '#ffffff');
  await app.openMoment(app.state.sessions[7]);
  assert.equal(app.state.snapshot.package_id, 'test.provider.7');
  assert.equal(providers[7].calls.some(([action]) => action === 'pause' || action === 'play'), false);
  app.componentWillUnmount();
});
