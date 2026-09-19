import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';

// Exercise component controllers in Node. No browser, WebView, or provider is launched.
const compiled = await build({stdin: {contents: "export {CompanionMoment} from './web/CompanionMoment'; export {PrivateMirror} from './web/PrivateMirror';", resolveDir: process.cwd()},
  bundle: true, write: false, format: 'cjs', platform: 'node', define: {'process.env.NODE_ENV': '"production"'}, plugins: [{name: 'react-boundary', setup(builder) {
    builder.onResolve({filter: /^react$/}, () => ({path: 'react', namespace: 'boundary'}));
    builder.onLoad({filter: /.*/, namespace: 'boundary'}, () => ({contents: 'class Component {constructor(props){this.props=props;} setState(next,done){this.state={...this.state,...next};done?.();}} export default {Component,PureComponent:Component,createRef:()=>({current:null})};'}));
  }}]});
const snapshot = {package_id: 'test.provider', session_id: 7, catalog_name: 'test', content_id: 'current', title: 'Code test', provider_name: 'Test', at_seconds: 125.5};
const playback = {state: 'paused', can_pause: true, can_play: true, revision: 1, observing: true};
const moment = {state: 'response', answer: 'From your description, the flag went up.', visual: {status: 'none', svg: '', animations: [], description: ''},
  intervention: {playback: 'keep_watching', audio: 'silent'}, life_connection: {offered: false, question: '', recipient: 'everyone'}};

function instance() {
  const messages = [], requests = [], streams = [];
  const window = {ReactNativeWebView: {postMessage: message => messages.push(JSON.parse(message))}, addEventListener() {}, removeEventListener() {}};
  const location = {origin: 'http://localhost'};
  const context = {module: {exports: {}}, window, location, AbortController, DOMException, Blob,
    document: {hidden: false, addEventListener() {}, removeEventListener() {}}, navigator: {sendBeacon() {}},
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
  app.command = async () => {
    receive({type: 'selene:provider', playback, snapshot: {...snapshot, at_seconds: 500}});
    return playback;
  };
  app.state.request = 'Why did the flag go up?'; app.state.detail = 'A forward pass.';
  await app.ask('keep_watching');
  app.state.moment = {...moment, state: 'clarification', answer: 'Where was the attacker at the pass?'};
  app.state.clarifying = true; app.state.request = 'Beyond the second-last opponent.';
  await app.ask('keep_watching');
  await app.ask('pause_to_explore', true);
  const inputs = requests.filter(request => request.url === '/api/companion/moment').map(request => request.input);
  assert.equal(inputs.length, 3);
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
