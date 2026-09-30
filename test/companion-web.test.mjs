import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';

// Exercise component controllers in Node. No browser, WebView, or provider is launched.
const compiled = await build({stdin: {contents: "export {CompanionMoment} from './web/CompanionMoment'; export {PrivateMirror} from './web/PrivateMirror'; export {Visual} from './web/Visual'; export {App as OwnApp} from './web/App'; export {readPreferences,savePreferences} from './web/preferences';", resolveDir: process.cwd()},
  bundle: true, write: false, format: 'cjs', platform: 'node', loader: {'.css': 'empty'}, define: {'process.env.NODE_ENV': '"production"'}, plugins: [{name: 'react-boundary', setup(builder) {
    builder.onResolve({filter: /^react$/}, () => ({path: 'react', namespace: 'boundary'}));
    builder.onLoad({filter: /.*/, namespace: 'boundary'}, () => ({contents: 'class Component {constructor(props){this.props=props;} setState(next,done){this.state={...this.state,...next};done?.();}} export default {Component,PureComponent:Component,createRef:()=>({current:null})};'}));
    builder.onResolve({filter: /^react-dom\/client$/}, () => ({path: 'react-dom', namespace: 'root-boundary'}));
    builder.onLoad({filter: /.*/, namespace: 'root-boundary'}, () => ({contents: 'export const createRoot=()=>({render(){}});'}));
  }}]});
const snapshot = {package_id: 'test.provider', session_id: 7, catalog_name: 'test', content_id: 'current', title: 'Code test', provider_name: 'Test', at_seconds: 125.5};
const playback = {state: 'paused', can_pause: true, can_play: true, revision: 1, observing: true};
const moment = {state: 'response', answer: 'From your description, the flag went up.', visual: {status: 'none', svg: '', animations: [], description: ''},
  grounding: {at_seconds: 125.5, evidence_ids: []},
  intervention: {playback: 'keep_watching', audio: 'silent'}, life_connection: {offered: false, question: '', recipient: 'everyone'}};

function instance() {
  const messages = [], requests = [], streams = [];
  const window = {ReactNativeWebView: {postMessage: message => messages.push(JSON.parse(message))}, addEventListener() {}, removeEventListener() {}};
  const location = {origin: 'http://localhost', search: ''};
  const context = {module: {exports: {}}, window, location, AbortController, DOMException, Blob, URLSearchParams,
    document: {hidden: false, getElementById: () => ({}), documentElement: {style: {setProperty() {}}, dataset: {}}, addEventListener() {}, removeEventListener() {}}, navigator: {sendBeacon() {}},
    EventSource: class {constructor() {streams.push(this);} close() {this.closed = true;}},
    fetch: async (url, options) => {requests.push({url, input: JSON.parse(options.body)}); return {ok: true, json: async () => structuredClone(moment)};}};
  vm.runInNewContext(compiled.outputFiles[0].text, context);
  const app = new context.module.exports.CompanionMoment({initial: {snapshot: {...snapshot}, playback: {...playback}}});
  app.mounted = true; app.sessionId = 'test-session';
  const receive = data => app.receive({source: window, origin: location.origin, data});
  return {app, context, receive, requests, messages, streams};
}

test('transport refresh keeps the selected moment fixed through clarification and Life Connection', async () => {
  const {app, receive, requests} = instance();
  app.command = async action => {
    receive({type: 'selene:provider', playback, snapshot: {...snapshot, at_seconds: 500}});
    return action === 'play' ? {...playback, state: 'playing'} : playback;
  };
  app.state.request = 'A forward pass. Why did the flag go up?';
  await app.ask('keep_watching');
  app.state.moment = {...moment, state: 'clarification', answer: 'Where was the attacker at the pass?'};
  app.state.clarifying = true; app.state.request = 'Beyond the second-last opponent.';
  await app.ask('keep_watching');
  await app.ask('pause_to_explore', true);
  const inputs = requests.filter(request => request.url === '/api/companion/moment').map(request => request.input);
  assert.equal(inputs.length, 3);
  assert.equal(inputs[0].scene_detail, 'A forward pass. Why did the flag go up?');
  assert.equal(inputs[1].scene_detail, inputs[0].scene_detail);
  assert.ok(inputs.every(input => input.snapshot.at_seconds === 125.5));
  assert.equal(inputs[1].continuation.question, 'Where was the attacker at the pass?');
  assert.equal(inputs[2].scene_answer, 'Beyond the second-last opponent.');
  assert.equal(app.state.snapshot.at_seconds, 125.5);
});

test('a provider resume stops voice and withdraws Life Connection from the private mirror', () => {
  const {app, receive} = instance();
  let stopped = 0, hidden = false;
  app.voice = {stop: () => stopped++}; app.setMirrorLife = async visible => {hidden = !visible;};
  app.state.lifeStarted = true;
  receive({type: 'selene:provider', playback: {...playback, state: 'playing'}});
  assert.equal(stopped, 1); assert.equal(hidden, true); assert.equal(app.state.lifeStarted, false);
});

test('voice rechecks provider state and requires live notifications before starting', async () => {
  const {app} = instance(); let starts = 0;
  app.voice = {stop() {}, listen: () => starts++, speak: () => starts++}; app.state.moment = moment;
  for (const state of [{...playback, state: 'playing'}, {...playback, observing: false}]) {
    app.command = async () => state;
    await app.listen(); await app.readAloud();
  }
  assert.equal(starts, 0);
  app.command = async () => playback;
  await app.listen(); await app.readAloud();
  assert.equal(starts, 2);
});

test('native screen reader owns spoken output, including during a pending playback check', async () => {
  const {app, receive} = instance(); let speaks = 0, stopped = 0;
  app.voice = {stop: () => stopped++, speak: () => speaks++}; app.state.moment = moment;
  app.state.voice = 'speaking'; receive({type: 'selene:accessibility', settings: {screenReader: true}});
  assert.equal(stopped, 1); await app.readAloud(); assert.equal(speaks, 0);
  receive({type: 'selene:accessibility', settings: {screenReader: false}}); app.state.voice = 'idle';
  app.command = async () => {receive({type: 'selene:accessibility', settings: {screenReader: true}}); return playback;};
  await app.readAloud(); assert.equal(speaks, 0);
  app.state.voice = 'listening'; receive({type: 'selene:accessibility', settings: {screenReader: true}});
  assert.equal(stopped, 1, 'screen reader settings must not silently cancel explicit dictation');
});

test('private read aloud uses the selected slower-answer setting', () => {
  const {context, streams} = instance(); const app = new context.module.exports.PrivateMirror({token: 'test'});
  let spoken; app.voice = {stop() {}, speak: (...args) => {spoken = args;}}; app.componentDidMount();
  streams[0].onmessage({data: JSON.stringify({type: 'moment', moment, language: 'English', slower_answer_voice: true})});
  app.readAloud(); assert.equal(spoken[2], true); app.componentWillUnmount();
});

test('own-player follows native captions until explicitly overridden and rejects foreign settings', () => {
  const {context} = instance(); const storage = new Map();
  context.localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)};
  const app = new context.module.exports.OwnApp({session_id: 'test', story: {id: 'test'}});
  app.mounted = true; let stopped = 0, spoken = 0; app.voice = {stop: () => stopped++, speak: () => spoken++};
  const packet = settings => ({source: context.window, origin: context.location.origin, data: {type: 'selene:accessibility', settings}});
  app.nativeMessage(packet({captions: false})); assert.equal(app.state.captions, false);
  app.toggleCaptions(); app.nativeMessage(packet({captions: false})); assert.equal(app.state.captions, true);
  app.systemCaptions(); assert.equal(app.state.captions, false); assert.equal(storage.has('selene.captions'), false);
  app.nativeMessage({...packet({captions: true}), origin: 'https://foreign.invalid'}); assert.equal(app.state.captions, false);
  app.state.voice = 'speaking'; app.nativeMessage(packet({captions: false, screenReader: true})); assert.equal(stopped, 1);
  app.state.moment = moment; app.readAloud(); assert.equal(spoken, 0);
});

test('paused answers stay notifications with their SVG; pause never opens a conversation', async () => {
  const {app, context} = instance();
  const visual = {status: 'ready', svg: '<svg/>', description: 'A supported relation.', animations: [{target_id: 'relation'}]};
  const response = {...moment, visual, life_connection: {offered: true, question: 'A private question.', recipient: 'everyone'}};
  const own = new context.module.exports.OwnApp({session_id: 'test', story: {id: 'test', title: 'Test', duration: 200, transcript: [], scenes: []}});
  own.mounted = true; own.state = {...own.state, screen: 'moment', started: true, paused: true, moment: response};
  let plays = 0; own.video.current = {pause() {}, play: () => {plays++; return Promise.resolve();}};
  const sections = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(sections)];
  for (const target of [own, app]) {
    target.state = {...target.state, screen: 'moment', moment: response, choice: 'pause_to_explore'};
    const panel = sections(target.render()).find(node => node.props?.['aria-label'] === 'Moment Response');
    assert.match(panel.props.className, /\bcompact\b/); assert.doesNotMatch(panel.props.className, /\bfull\b/);
    assert.ok(sections(panel).some(node => node.props?.visual === visual), 'preserve SVG and animation data in the notification');
    assert.equal(sections(panel).some(node => node.props?.children === 'Pause to explore'), false);
  }
  own.pauseMoment(); assert.equal(own.state.lifeStarted, false);
  app.command = async () => playback; await app.choosePause(); assert.equal(app.state.lifeStarted, false);
  own.back(); assert.equal(own.state.controls, false); assert.equal(plays, 0, 'Back dismisses without resuming playback');
});

test('closing or losing a private mirror clears private text and stops speech', () => {
  for (const closed of [true, false]) {
    const {context, streams} = instance();
    const app = new context.module.exports.PrivateMirror({token: 'test'});
    let stopped = 0; app.voice = {stop: () => stopped++};
    app.componentDidMount();
    streams[0].onmessage({data: JSON.stringify({type: 'moment', moment})});
    assert.ok(app.state.moment);
    if (closed) streams[0].onmessage({data: JSON.stringify({type: 'closed'})});
    else streams[0].onerror();
    assert.equal(app.state.moment, null); assert.equal(streams[0].closed, true); assert.ok(stopped >= 2);
    app.componentWillUnmount();
  }
});


test('one-click questions call the real request boundary; empty input stays local', async () => {
  const {app, requests} = instance();
  app.command = async () => playback;
  await app.ask('unspecified');
  assert.equal(requests.length, 0);
  await app.ask('unspecified', false, 'Who are the people in this moment?');
  assert.equal(requests[0].input.request, 'Who are the people in this moment?');
  assert.equal(requests[0].input.playback_choice, 'unspecified');
  assert.equal(requests[0].input.scene_detail, '');
});

test('clarification opens its answer field directly; preferences Back preserves the draft', async () => {
  const {app, context} = instance();
  app.command = async () => playback;
  context.fetch = async () => ({ok: true, json: async () => ({...moment, state: 'clarification', answer: 'Which person?'})});
  app.state.request = 'Who is that?';
  await app.ask('unspecified');
  assert.equal(app.state.screen, 'ask');
  assert.equal(app.state.clarifying, true);
  assert.equal(app.state.request, '');
  app.state.request = 'The person in the red shirt.';
  app.state.screen = 'preferences';
  app.back();
  assert.equal(app.state.screen, 'ask');
  assert.equal(app.state.request, 'The person in the red shirt.');
  assert.equal(app.lastInput.request, 'Who is that?');
});


test('only explicit preferences are remembered; invalid storage does not break asking', () => {
  const {context} = instance();
  let stored = null;
  context.localStorage = {getItem: () => stored, setItem: (_key, value) => {stored = value;}};
  context.module.exports.savePreferences({need: 'Translate', language: 'Indonesian', recipient: 'child', session: 'family', request: 'Private dialogue'});
  assert.equal(stored.includes('Private dialogue'), false);
  assert.equal(context.module.exports.readPreferences().language, 'Indonesian');
  stored = '{broken';
  assert.equal(context.module.exports.readPreferences().need, 'Explain simply');
  stored = JSON.stringify({need: 'Guess my age', language: 'Unknown', recipient: 'inferred'});
  assert.equal(context.module.exports.readPreferences().recipient, 'everyone');
});


test('ordinary answers resume before appearing and failed resume never shows a notification', async () => {
  for (const succeeds of [true, false]) {
    const {app} = instance(); const actions = [];
    app.command = async action => {
      actions.push(action);
      assert.notEqual(app.state.screen, 'moment');
      return action === 'play' && succeeds ? {...playback, state: 'playing'} : playback;
    };
    await app.ask('pause_to_explore', false, 'What does that mean?');
    assert.ok(actions.includes('play'));
    assert.equal(app.state.screen === 'moment', succeeds);
    if (succeeds) assert.equal(app.state.moment.intervention.playback, 'keep_watching');
  }
  const {context} = instance();
  const own = new context.module.exports.OwnApp({session_id: 'test', story: {id: 'test', duration: 105, transcript: [], scenes: []}});
  own.mounted = true; own.sessionId = 'test'; own.voice = {stop() {}};
  let played = false;
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  own.video.current = {paused: true, play: async () => {
    played = true;
    nodes(own.render()).find(node => node.type === 'video').props.onSeeking();
    own.video.current.paused = false;
  }};
  await own.deliver({request: 'Explain', life_connection: false});
  assert.equal(played, true); assert.equal(own.state.screen, 'moment');
});


test('compact SVG reveals connector geometry once and honors reduced motion', () => {
  for (const reduced of [false, true]) {
    const {context} = instance();
    context.document.querySelector = () => ({content: 'test-nonce'});
    const renderer = new context.module.exports.Visual({compact: true, visual: {...moment.visual, status: 'ready', svg: '<svg/>', animations: []}});
    const page = renderer.render().props.srcDoc;
    const motions = [];
    const background = {style: {}, getAttribute: name => ({fill: '#202228', width: '880', height: '460'})[name]};
    const connector = {getTotalLength: () => 80, animate: (...args) => motions.push(args)};
    const svg = {querySelectorAll: selector => selector === 'rect' ? [background] : selector === 'path,line,polyline' ? [connector] : [], getScreenCTM: () => ({inverse: () => ({})}),
      getBBox: () => ({x: 400, y: 190, width: 160, height: 160}), setAttribute() {}, animate: (...args) => motions.push(args)};
    vm.runInNewContext(page.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)[1], {
      document: {querySelector: () => svg}, parent: {postMessage: () => assert.fail('Valid SVG rejected')},
      getComputedStyle: () => ({display: 'block', stroke: '#ffad33'}),
      addEventListener() {}, requestAnimationFrame: fn => fn(), matchMedia: () => ({matches: reduced}),
    });
    assert.equal(background.style.display, 'none', 'exclude the background before measuring the symbol');
    assert.equal(motions.length, reduced ? 0 : 1);
    if (!reduced) {assert.equal(motions[0][1].iterations, 1); assert.equal(motions[0][0][0].strokeDashoffset, '80'); assert.equal(motions[0][0][1].strokeDashoffset, '0');}
  }
});


test('watching launcher offers only Selene actions and question entry stays minimal', () => {
  const {context} = instance();
  const own = new context.module.exports.OwnApp({session_id: 'test', story: {id: 'test', duration: 200, transcript: [], scenes: []}});
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  own.state = {...own.state, started: true, screen: 'watch', controls: true};
  const launcher = nodes(own.render()).find(node => node.props?.['aria-label'] === 'Selene tools');
  const buttons = nodes(launcher).filter(node => node.type === 'button');
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map(node => node.props['aria-label'] || node.props.children), ['Ask Selene', 'Answer preferences', 'Hide Selene']);
  own.state.screen = 'ask';
  const question = nodes(own.render()).find(node => node.type === 'textarea');
  assert.equal(question.props.rows, 1); assert.equal(question.props['data-initial'], true);
});
