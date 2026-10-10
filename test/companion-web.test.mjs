import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {renderToStaticMarkup} from 'react-dom/server';
import {DOMParser} from '@xmldom/xmldom';

// Exercise component controllers in Node. No browser, WebView, or provider is launched.
const compiled = await build({stdin: {contents: "export {CompanionMoment} from './web/CompanionMoment'; export {PrivateMirror} from './web/PrivateMirror'; export {Visual} from './web/Visual'; export {App as OwnApp} from './web/App'; export {personalRequest} from './web/personal'; export {readPreferences,savePreferences} from './web/preferences';", resolveDir: process.cwd()},
  bundle: true, write: false, format: 'cjs', platform: 'node', loader: {'.css': 'empty'}, define: {'process.env.NODE_ENV': '"production"'}, plugins: [{name: 'react-boundary', setup(builder) {
    builder.onResolve({filter: /^react$/}, () => ({path: 'react', namespace: 'boundary'}));
    builder.onLoad({filter: /.*/, namespace: 'boundary'}, () => ({contents: 'class Component {constructor(props){this.props=props;} setState(next,done){this.state={...this.state,...(typeof next==="function"?next(this.state,this.props):next)};done?.();}} export default {Component,PureComponent:Component,createRef:()=>({current:null})};'}));
    builder.onResolve({filter: /^react-dom\/client$/}, () => ({path: 'react-dom', namespace: 'root-boundary'}));
    builder.onLoad({filter: /.*/, namespace: 'root-boundary'}, () => ({contents: 'export const createRoot=()=>({render(){}});'}));
  }}]});
const snapshot = {package_id: 'test.provider', session_id: 7, catalog_name: 'test', content_id: 'current', title: 'Code test', provider_name: 'Test', at_seconds: 125.5};
const playback = {state: 'paused', can_pause: true, can_play: true, revision: 1, observing: true};
const moment = {state: 'response', answer: 'From your description, the flag went up.', visual: {status: 'none', svg: '', animations: [], description: ''},
  grounding: {at_seconds: 125.5, evidence_ids: []},
  intervention: {playback: 'keep_watching', audio: 'silent'},};

function instance() {
  const messages = [], requests = [], streams = [];
  const window = {ReactNativeWebView: {postMessage: message => messages.push(JSON.parse(message))}, addEventListener() {}, removeEventListener() {}};
  const location = {origin: 'http://localhost', search: ''};
  const context = {module: {exports: {}}, window, location, AbortController, DOMException, Blob, URLSearchParams,
    setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
    document: {hidden: false, getElementById: () => ({}), documentElement: {style: {setProperty() {}}, dataset: {}}, addEventListener() {}, removeEventListener() {}}, navigator: {sendBeacon() {}},
    EventSource: class {constructor() {streams.push(this);} close() {this.closed = true;}},
    fetch: async (url, options) => {requests.push({url, input: JSON.parse(options.body)}); return {ok: true, json: async () => structuredClone(moment)};}};
  vm.runInNewContext(compiled.outputFiles[0].text, context);
  const app = new context.module.exports.CompanionMoment({initial: {snapshot: {...snapshot}, playback: {...playback}}});
  app.mounted = true; app.sessionId = 'test-session';
  const receive = data => app.receive({source: window, origin: location.origin, data});
  return {app, context, receive, requests, messages, streams};
}

test('rendered answer DOM shows only host-declared audience across web surfaces', () => {
  const {app: companion, context} = instance();
  const story = {id: 'test', title: 'Test', content_version: 'a'.repeat(64), duration: 100, video: '/media/test.mp4', transcript: [], scenes: []};
  const own = new context.module.exports.OwnApp({session_id: 'test-session', story});
  const phone = new context.module.exports.PrivateMirror({token: 'test'});
  own.state.started = true; phone.state.story = story;
  const badges = app => {
    const dom = new DOMParser().parseFromString(renderToStaticMarkup(app.render()), 'text/html');
    return Array.from(dom.getElementsByTagName('span')).filter(node => node.getAttribute('class') === 'audience-badge');
  };
  for (const audience of [undefined, {recipient: 'child', source: 'declaration'}, {recipient: 'grandparent', source: 'declaration'},
    {recipient: 'child', source: 'profile'}, {recipient: 'everyone', source: 'request'}]) {
    const answer = {...moment, answer: 'I am a grandparent. This text must not identify the audience.', ...(audience ? {audience} : {})};
    const bridge = {status: 'ready', from_seconds: 1, through_seconds: 2, moment: answer, evidence: []};
    companion.state.screen = 'moment'; companion.state.moment = answer;
    own.state.screen = 'moment'; own.state.moment = answer;
    phone.state.moment = answer; phone.state.bridge = null;
    const expected = audience ? `For ${audience.recipient} · ${{declaration: 'stated', profile: 'profile', request: 'selected'}[audience.source]}` : null;
    for (const surface of [companion, own, phone]) {
      const nodes = badges(surface);
      assert.equal(nodes.length, expected ? 1 : 0);
      if (expected) {assert.equal(nodes[0].textContent, expected); assert.equal(nodes[0].getAttribute('aria-label'), expected);}
    }
    own.state.screen = 'return'; own.state.returnResult = bridge;
    phone.state.bridge = bridge;
    for (const surface of [own, phone]) {
      const nodes = badges(surface);
      assert.equal(nodes.length, expected ? 1 : 0);
      if (expected) assert.equal(nodes[0].textContent, expected);
    }
    for (const status of ['unavailable', 'insufficient_evidence', 'no_gap']) {
      own.state.returnResult = {...bridge, status}; phone.state.bridge = {...bridge, status};
      assert.equal(badges(own).length, 0); assert.equal(badges(phone).length, 0);
    }
    own.state.returnResult = {...bridge, moment: null}; phone.state.moment = null;
    assert.equal(badges(own).length, 0); assert.equal(badges(phone).length, 0);
  }
});

test('transport refresh keeps the selected moment fixed through clarification and explicit pause', async () => {
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
  await app.ask('pause_to_explore');
  const inputs = requests.filter(request => request.url === '/api/companion/moment').map(request => request.input);
  assert.equal(inputs.length, 3);
  assert.equal(inputs[0].scene_detail, 'A forward pass. Why did the flag go up?');
  assert.equal(inputs[1].scene_detail, inputs[0].scene_detail);
  assert.ok(inputs.every(input => input.snapshot.at_seconds === 125.5));
  assert.equal(inputs[1].continuation.question, 'Where was the attacker at the pass?');
  assert.equal(inputs[2].scene_answer, 'Beyond the second-last opponent.');
  assert.equal(app.state.snapshot.at_seconds, 125.5);
});

test('a provider resume stops voice without changing the explanation', () => {
  const {app, receive} = instance();
  let stopped = 0;
  app.voice = {stop: () => stopped++};
  receive({type: 'selene:provider', playback: {...playback, state: 'playing'}});
  assert.equal(stopped, 1); assert.equal(app.state.playback.state, 'playing');
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
  app.readAloud(); assert.equal(spoken[2], true);
  streams[0].onmessage({data: JSON.stringify({type: 'moment', moment, language: 'Spanish', slower_answer_voice: false})});
  app.readAloud(); assert.equal(spoken[1], 'es-ES'); app.componentWillUnmount();
});

test('phone explains live and selected moments without a video, preference menus or TV transport', async () => {
  const {context, streams, messages} = instance();
  const story = {id: 'test', title: 'Test', content_version: 'a'.repeat(64), duration: 100, video: '/media/test.mp4', transcript: [], scenes: []};
  const report = {content_id: story.id, content_version: story.content_version, epoch: 0, sequence: 1, at_seconds: 35, play_state: 'playing', playback_rate: 1, age_ms: 0, fresh: true};
  const hold = {id: '12345678-1234-1234-1234-123456789abc', content_version: story.content_version, epoch: 0, from_seconds: 35};
  const pair = {code: '123456', url: 'https://relay.invalid/?private=token', join_url: 'https://relay.invalid/?join=1', expires_at: Date.now() + 300000};
  const calls = [];
  context.fetch = async (url, options) => {
    const input = JSON.parse(options.body); calls.push({url, input});
    const result = url === '/api/private/pair' ? pair : url.endsWith('/hold') ? {hold: {...hold, from_seconds: input.from_seconds}, playback: report}
      : url.endsWith('/ask') ? {moment: {...moment, grounding: {...moment.grounding, at_seconds: input.at_seconds}}, evidence: []}
        : url.endsWith('/return') || url === '/api/return' ? {status: 'ready', from_seconds: input.from_seconds, through_seconds: 45, moment, evidence: []} : {closed: true};
    return {ok: true, json: async () => result};
  };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const button = (app, label) => {
    const match = nodes(app.render()).find(node => node.type === 'button' && (node.props.children === label || node.props['aria-label'] === label));
    assert.ok(match, `Missing UI action: ${label}`); assert.equal(Boolean(match.props.disabled), false); return match;
  };
  let tvTransport = 0;
  const tv = new context.module.exports.OwnApp({session_id: 'test-session', story, private_mirror_available: true});
  tv.mounted = true; tv.state.started = true;
  tv.video.current = {currentTime: 35, readyState: 4, playbackRate: 1, paused: false, pause: () => tvTransport++, play: async () => tvTransport++};
  button(tv, 'Selene tools').props.onClick(); button(tv, 'Hold our place').props.onClick();
  assert.equal(tv.state.savedPlace.at_seconds, 35);
  tv.video.current.currentTime = 45; await button(tv, 'Bring us back').props.onClick();
  assert.equal(tv.state.screen, 'return'); assert.equal(tv.state.returnResult.through_seconds, 45);
  button(tv, 'Close return').props.onClick(); button(tv, 'Selene').props.onClick(); button(tv, 'Selene tools').props.onClick();
  await button(tv, 'Pair phone').props.onClick(); assert.equal(tv.state.mirror.code, pair.code);

  const beforePhoneMessages = messages.length;
  const phone = new context.module.exports.PrivateMirror({token: 'token'});
  phone.componentDidMount();
  streams[0].onmessage({data: JSON.stringify({type: 'personal', story, playback: report, hold: null})});
  assert.equal(nodes(phone.render()).some(node => ['video', 'select'].includes(node.type)), false);
  phone.state.request = "I'm grandma. Explain that simply.";
  await nodes(phone.render()).find(node => node.type === 'form').props.onSubmit({preventDefault() {}});
  assert.equal(phone.state.moment.grounding.at_seconds, 35);
  const first = calls.find(call => call.url.endsWith('/ask')).input;
  assert.equal(first.request, "I'm grandma. Explain that simply.");
  assert.equal(first.need, 'Show visually'); assert.equal(first.language, 'English'); assert.equal(first.recipient, 'everyone');
  assert.equal(phone.state.hold.from_seconds, 35, 'asking saves the moment without a separate pause button');

  button(phone, 'Choose a moment').props.onClick();
  nodes(phone.render()).find(node => node.type === 'input').props.onChange({target: {value: '20'}});
  phone.state.request = 'What did that mean?'; await phone.ask();
  assert.equal(phone.state.moment.grounding.at_seconds, 20);
  assert.equal(phone.state.hold.from_seconds, 35, 'an earlier question never moves the help interval before Send');
  let spoken; phone.voice = {stop() {}, speak: (...args) => {spoken = args;}};
  phone.readAloud(); assert.equal(spoken[1], 'en-US');
  const pending = new AbortController(); phone.pending = pending; phone.state.busy = 'ask';
  phone.chooseMoment(18); assert.equal(pending.signal.aborted, true); assert.equal(phone.state.moment, null);
  phone.receivePlayback({...report, sequence: 2, at_seconds: 45});
  await button(phone, 'Catch me up').props.onClick();
  assert.equal(phone.state.bridge.from_seconds, 35); assert.equal(phone.state.bridge.through_seconds, 45);
  button(phone, 'Choose a moment').props.onClick(); await button(phone, 'Follow TV').props.onClick();
  assert.equal(phone.state.hold, null); assert.equal(phone.state.selected, null);
  assert.equal(tvTransport, 0); assert.equal(messages.length, beforePhoneMessages, 'the phone never sends native transport commands');
  phone.componentWillUnmount();
});

test('phone clarification stays frozen; stale samples and TV seeks cannot generate or retain an old answer', async () => {
  const {context, streams, requests} = instance();
  const phone = new context.module.exports.PrivateMirror({token: 'test'}); phone.componentDidMount();
  const playback = {content_version: 'a'.repeat(64), epoch: 0, sequence: 1, at_seconds: 35, age_ms: 0, fresh: true};
  const hold = {id: 'branch', content_version: playback.content_version, epoch: 0, from_seconds: 20};
  streams[0].onmessage({data: JSON.stringify({type: 'personal', story: {id: 'test'}, playback, hold})});
  phone.state.moment = {...moment, state: 'clarification', grounding: {...moment.grounding, at_seconds: 20}};
  phone.state.request = 'The person on the left.';
  phone.receivePlayback({...playback, sequence: 2, at_seconds: 45}); await phone.ask();
  assert.equal(requests.at(-1).input.at_seconds, 20); assert.equal(requests.at(-1).input.clarification, true);
  phone.state.request = 'Another question'; phone.state.receivedAt = Date.now() - 7000;
  const count = requests.length; await phone.ask(); assert.equal(requests.length, count);
  const pending = new AbortController(); phone.pending = pending; phone.state.selected = 20;
  phone.receivePlayback({...playback, sequence: 3, epoch: 1, at_seconds: 10});
  assert.equal(pending.signal.aborted, true); assert.equal(phone.state.moment, null); assert.equal(phone.state.selected, null);
  phone.componentWillUnmount();
});

test('TV Guided Return resumes before showing its notification and fails closed if playback cannot resume', async () => {
  for (const resumes of [true, false]) {
    const {context} = instance();
    const story = {id: 'test', title: 'Test', content_version: 'a'.repeat(64), duration: 100, video: '/media/test.mp4', transcript: [], scenes: []};
    context.fetch = async () => ({ok: true, json: async () => ({status: 'ready', from_seconds: 30, through_seconds: 40,
      moment: {...moment, answer: 'The pass happened before the flag.'}})});
    const tv = new context.module.exports.OwnApp({session_id: 'test-session', story});
    tv.mounted = true; tv.sessionId = 'test-session'; tv.state.savedPlace = {at_seconds: 30, epoch: 0};
    tv.publishPlayback = async () => {};
    let playCalls = 0;
    tv.video.current = {paused: true, currentTime: 40, play: async () => {
      playCalls++;
      assert.equal(tv.state.screen, 'loading', 'do not show the return card before playback resumes');
      if (resumes) tv.video.current.paused = false;
    }};
    if (!resumes) tv.video.current.play = async () => {playCalls++; throw new Error('autoplay rejected');};
    await tv.bringUsBack();
    assert.equal(playCalls, 1);
    assert.equal(tv.state.screen, resumes ? 'return' : 'tools');
    assert.equal(tv.state.returnResult?.status ?? null, resumes ? 'ready' : null);
    if (!resumes) assert.ok(tv.state.error, 'show a recoverable message when playback cannot resume');
  }
});

test('personal requests bound response bodies and preserve caller cancellation and HTTP status', async () => {
  const {context} = instance();
  const request = context.module.exports.personalRequest;
  let expire, cleared = 0, responseStarted;
  context.setTimeout = callback => {expire = callback; return 1;};
  context.clearTimeout = () => cleared++;
  context.fetch = async (_url, options) => ({ok: true, json: () => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true});
    responseStarted();
  })});
  const caller = new AbortController();
  const bodyStarted = new Promise(resolve => {responseStarted = resolve;});
  const response = request('/api/private/join', {signal: caller.signal});
  const timedOut = assert.rejects(response, {name: 'TimeoutError'});
  await bodyStarted; expire(); await timedOut;
  assert.equal(caller.signal.aborted, false, 'a timeout must reach the UI error handler, not its silent-cancel branch');
  assert.equal(cleared, 1);
  const cancelledBody = new Promise(resolve => {responseStarted = resolve;});
  const cancelled = request('/api/private/join', {signal: caller.signal});
  const aborted = assert.rejects(cancelled, {name: 'AbortError'});
  await cancelledBody; caller.abort(); await aborted;
  context.fetch = async () => ({ok: false, status: 410, json: async () => ({error: 'Pair again'})});
  await assert.rejects(request('/api/private/close', {}), error => error.status === 410 && error.message === 'Pair again');
  assert.equal(cleared, 3);
});

test('missing HTTPS pairing stays discoverable and media events preserve truthful state', async () => {
  const {context} = instance();
  const tv = new context.module.exports.OwnApp({session_id: 'test', private_mirror_available: false,
    story: {id: 'test', duration: 100, transcript: [], scenes: []}});
  tv.mounted = true; tv.state.started = true; tv.state.screen = 'tools';
  tv.video.current = {currentTime: 35, paused: false, ended: false, playbackRate: 1};
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const pair = nodes(tv.render()).find(node => node.type === 'button' && node.props.children === 'Pair phone');
  assert.ok(pair, 'do not silently hide Personal Pause when relay configuration is missing');
  context.fetch = async url => url === '/api/playback' ? {ok: true, json: async () => ({})}
    : {ok: false, status: 503, json: async () => ({error: 'Phone pairing needs a reachable HTTPS relay address.'})};
  await pair.props.onClick();
  assert.equal(tv.state.pairing, false); assert.match(tv.state.error, /HTTPS/);
  tv.postPlayerState = () => {};
  const video = nodes(tv.render()).find(node => node.type === 'video');
  video.props.onWaiting(); video.props.onTimeUpdate();
  assert.equal(tv.playbackState(), 'buffering', 'timeupdate can occur while buffering');
  video.props.onPlaying(); assert.equal(tv.playbackState(), 'playing');
  tv.video.current.paused = true; tv.video.current.ended = true;
  assert.equal(tv.playbackState(), 'stopped', 'an ended video is also paused');
});

test('prepared example selection seeks and samples before sending, fixes demo preferences and leaves ordinary asks unchanged', async () => {
  const {context} = instance();
  const tv = new context.module.exports.OwnApp({session_id: 'test', story: {id: 'football-match', duration: 60, transcript: [], scenes: []}});
  tv.mounted = true;
  tv.state = {...tv.state, screen: 'ask', anchorAt: 2, need: 'Translate', language: 'Spanish', recipient: 'child', session: 'solo'};
  const events = new Map(), sent = [];
  let at = 2, seeks = 0;
  const player = {paused: false, ended: false, seeking: false,
    get currentTime() {return at;}, set currentTime(value) {at = value; seeks++; this.seeking = true; tv.playbackSeek();},
    addEventListener: (type, listener) => events.set(type, listener), removeEventListener: type => events.delete(type),
    play: async () => {player.paused = false;}};
  tv.video.current = player;
  tv.postPlayerState = () => {};
  tv.send = async input => {sent.push(input); return {ok: true, json: async () => ({...moment, grounding: {at_seconds: input.at_seconds}})};};
  const example = {id: 'offside-rule', request: 'Why was that offside?', at_seconds: 15.485};
  const selecting = tv.selectExample(example);
  assert.equal(seeks, 1); assert.equal(at, example.at_seconds); assert.equal(sent.length, 0);
  player.seeking = false; events.get('seeked')();
  await selecting;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].at_seconds, example.at_seconds);
  assert.equal(sent[0].need, 'Show visually'); assert.equal(sent[0].language, 'English'); assert.equal(sent[0].recipient, 'everyone');
  assert.equal(sent[0].session, 'solo'); assert.equal(sent[0].continuation, null);
  assert.equal(tv.state.moment.grounding.at_seconds, example.at_seconds);
  tv.playbackSeek();
  assert.equal(tv.state.screen, 'watch', 'an unrelated later seek still closes the answer');
  tv.state.anchorAt = 40; at = 55;
  await tv.selectExample({...example, at_seconds: 40});
  assert.equal(seeks, 1, 'a current example never seeks or jumps to the moving playback clock');
  assert.equal(sent[1].at_seconds, 40);
  let ordinary;
  tv.deliver = async input => {ordinary = input;};
  tv.state.request = 'Translate the line.';
  tv.ask('unspecified');
  assert.equal(ordinary.need, 'Translate'); assert.equal(ordinary.language, 'Spanish'); assert.equal(ordinary.recipient, 'child');
  assert.equal(ordinary.at_seconds, 40); assert.equal(ordinary.playback_choice, 'unspecified');
});

test('failed prepared seek sends nothing and retry still seeks instead of answering at the old playback moment', async () => {
  const {context} = instance();
  const tv = new context.module.exports.OwnApp({session_id: 'test', story: {id: 'the-missing-crown', duration: 120, transcript: [], scenes: []}});
  tv.mounted = true; tv.state = {...tv.state, screen: 'ask', anchorAt: 2};
  let at = 2, canSeek = false, seeks = 0, sent = 0;
  tv.video.current = {paused: false, ended: false, seeking: false,
    get currentTime() {return at;}, set currentTime(value) {seeks++; if (canSeek) at = value;},
    addEventListener() {}, removeEventListener() {}, play: async () => {}};
  tv.send = async input => {sent++; return {ok: true, json: async () => ({...moment, grounding: {at_seconds: input.at_seconds}})};};
  await tv.selectExample({id: 'alisson-empty-chair', request: 'Who is Alisson and why is he missing?', at_seconds: 62.678});
  assert.equal(sent, 0); assert.equal(tv.state.screen, 'error');
  assert.equal(tv.state.anchorAt, 2, 'a failed jump must not turn its future demo into a current-moment example');
  assert.equal(tv.lastSeekTo, 62.678);
  canSeek = true; await tv.deliver(tv.lastInput, tv.lastSeekTo);
  assert.equal(seeks, 2); assert.equal(sent, 1); assert.equal(tv.state.moment.grounding.at_seconds, 62.678);
});

test('prepared listing distinguishes pending, failed and successful empty requests and ignores superseded results', async () => {
  const {context} = instance();
  const tv = new context.module.exports.OwnApp({session_id: 'test', story: {id: 'football-match', duration: 60}});
  tv.mounted = true; tv.state.screen = 'ask';
  let resolve;
  context.fetch = () => new Promise(done => {resolve = done;});
  const first = tv.loadExamples();
  assert.equal(tv.state.examplesStatus, 'loading');
  context.fetch = async () => {throw new TypeError('Unavailable');};
  await tv.loadExamples();
  assert.equal(tv.state.examplesStatus, 'error');
  resolve({ok: true, json: async () => ({examples: [{id: 'stale', request: 'Old request', at_seconds: 0}]})});
  await first;
  assert.equal(tv.state.examplesStatus, 'error'); assert.equal(tv.state.examples.length, 0);
  context.fetch = async () => ({ok: true, json: async () => ({examples: []})});
  await tv.loadExamples();
  assert.equal(tv.state.examplesStatus, 'ready'); assert.equal(tv.state.examples.length, 0);
});

test('closing a failed shared return preserves its marker for retry', () => {
  const {context} = instance();
  const tv = new context.module.exports.OwnApp({session_id: 'test-session', story: {id: 'test', transcript: []}, private_mirror_available: true});
  const saved = {at_seconds: 8, epoch: 0};
  tv.state.screen = 'return';
  tv.state.returnResult = {status: 'unavailable', from_seconds: 8, through_seconds: 20, moment: null, quote: {at_seconds: 11, text: 'Exact source dialogue.'}};
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const card = nodes(tv.render());
  assert.equal(card.find(node => node.type === 'h2').props.children, '“Exact source dialogue.”');
  assert(card.some(node => node.type === 'p' && JSON.stringify(node.props.children).includes('Recap unavailable; close to retry.')));
  for (const status of ['unavailable', 'insufficient_evidence', 'ready', 'no_gap']) {
    tv.state.savedPlace = saved; tv.state.returnResult = {status}; tv.state.screen = 'return';
    tv.back();
    assert.equal(tv.state.savedPlace, ['ready', 'no_gap'].includes(status) ? null : saved);
    assert.equal(tv.state.screen, 'watch');
  }
});

test('TV position renders only on displayed seconds or cue changes, without rounding playback samples', () => {
  const {context, messages} = instance();
  const transcript = [{start: 0.25, end: 0.75, text: 'First'}, {start: 0.75, end: 1.5, text: 'Second'}];
  const tv = new context.module.exports.OwnApp({session_id: 'test', story: {id: 'test', duration: 100, transcript}});
  tv.video.current = {currentTime: 0, duration: 100, paused: false, ended: false, muted: false, volume: 1};
  tv.publishPlayback = async () => {};
  let renders = 0;
  const setState = tv.setState.bind(tv);
  tv.setState = next => {renders++; setState(next);};
  for (const [at, count] of [[0.1, 0], [0.25, 1], [0.4, 1], [0.75, 2], [0.9, 2], [1.1, 3], [1.2, 3], [1.5, 4], [1.3, 5]]) {
    tv.video.current.currentTime = at;
    tv.lastNativeStateAt = 0;
    tv.timeUpdate();
    assert.equal(renders, count, `UI update count at ${at}`);
    assert.equal(messages.at(-1).state.position_ms, at * 1000, 'bridge samples the video, not the displayed clock');
  }
  tv.video.current.currentTime = 1.375;
  tv.timeUpdate();
  tv.savePlace();
  assert.equal(tv.state.savedPlace.at_seconds, 1.375, 'Personal Pause keeps its precise marker');
});

test('lost branch responses reconcile, disconnect failure stays visible, and seeking is not published', async () => {
  const {context, streams, requests} = instance();
  const phone = new context.module.exports.PrivateMirror({token: 'test'});
  phone.componentDidMount();
  const hold = {id: '12345678-1234-1234-1234-123456789abc', content_version: 'a'.repeat(64), epoch: 0, from_seconds: 35};
  phone.held = hold; phone.state.hold = hold;
  context.fetch = async () => {throw new TypeError('Connection lost after closing');};
  await phone.backToTV();
  assert.equal(streams.length, 2, 'an uncertain mutation reloads authoritative state');
  assert.equal(phone.state.connection, 'connecting');
  streams[1].onmessage({data: JSON.stringify({type: 'personal', story: {id: 'test'}, playback: null, hold: null})});
  assert.equal(phone.state.hold, null, 'a committed close cannot leave the phone trapped on the old branch');

  const tv = new context.module.exports.OwnApp({session_id: 'test', story: {id: 'test', duration: 100}});
  tv.mounted = true; const pair = {code: '123456'}; tv.state.mirror = pair;
  await tv.stopMirror();
  assert.equal(tv.state.mirror, pair); assert.match(tv.state.error, /may still be connected/);
  context.fetch = async () => ({ok: false, status: 503, json: async () => ({error: 'Unavailable'})});
  await tv.stopMirror(); assert.equal(tv.state.mirror, pair, 'an HTTP failure cannot claim revocation');
  context.fetch = async () => ({ok: true, json: async () => ({closed: true})});
  await tv.stopMirror(); assert.equal(tv.state.mirror, null);
  tv.video.current = {currentTime: 50, seeking: true};
  await assert.rejects(tv.publishPlayback(), /finish seeking/);
  assert.equal(requests.length, 0);
  phone.componentWillUnmount();
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
  const response = {...moment, visual,};
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
  own.pauseMoment(); assert.equal(own.state.paused, true);
  app.command = async () => playback; await app.choosePause(); assert.equal(app.state.playback.state, 'paused');
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
  await app.ask('unspecified', 'Who are the people in this moment?');
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
  assert.equal(context.module.exports.readPreferences().language, 'English', 'obsolete language and audience selectors are reset');
  stored = '{broken';
  assert.equal(context.module.exports.readPreferences().need, 'Show visually');
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
    await app.ask('pause_to_explore', 'What does that mean?');
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
  await own.deliver({request: 'Explain',});
  assert.equal(played, true); assert.equal(own.state.screen, 'moment');
});


function iframeMotion({compact = false, reduced = false, missingTarget = false} = {}) {
  const {context} = instance(); context.document.querySelector = () => ({content: 'test-nonce'});
  const animation = {target_id: 'person', keyframes: [{opacity: 1, transform: 'translate(-3200px, 0px)'}, {opacity: 1, transform: 'none'}], duration_ms: 1500, delay_ms: 100};
  const renderer = new context.module.exports.Visual({compact, personal: !compact, visual: {status: 'ready', description: 'An object settles into place.',
    svg: '<svg viewBox="100 200 16000 9000"><rect x="100" y="200" width="16000" height="9000" fill="#202228"/><rect id="person" x="4000" y="2000" width="800" height="800" fill="#f1f1f1"/><circle cx="6000" cy="2400" r="400" fill="#ffad33"/><text x="15000" y="8800" font-size="12">Stay still</text></svg>', animations: [animation]}});
  const motions = [], messages = [], events = new Map(), frames = [], attributes = new Map();
  const background = {style: {}}, label = {style: {}};
  const target = {style: {}, getBoundingClientRect() {
    const motion = motions[0], elapsed = motion ? Math.max(0, motion.currentTime - motion.options.delay) : 0;
    const progress = !motion || motion.playState === 'idle' || motion.playState === 'finished' ? 1 : (elapsed % motion.options.duration) / motion.options.duration;
    const left = 4000 - 3200 * (1 - progress);
    return {left, top: 2000, right: left + 800, bottom: 2800};
  }, animate(keyframes, options) {
    const motion = {keyframes, options, currentTime: 0, playState: 'running', cancels: 0,
      cancel() {this.cancels++; this.playState = 'idle';}};
    motions.push(motion); return motion;
  }};
  const svg = {querySelectorAll: selector => selector === 'text' ? [label] : [background, target],
    setAttribute: (name, value) => attributes.set(name, value)};
  const preference = {matches: reduced, addEventListener: (type, fn) => events.set(`preference:${type}`, fn)};
  const rendered = renderer.render(), iframe = rendered.props.children[0], srcDoc = iframe.props.srcDoc;
  vm.runInNewContext(srcDoc.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)[1], {
    document: {querySelector: () => svg, getElementById: id => !missingTarget && id === 'person' ? target : null},
    parent: {postMessage: message => messages.push(message)},
    addEventListener: (type, fn) => events.set(type, fn), requestAnimationFrame: fn => frames.push(fn), matchMedia: () => preference,
  });
  return {renderer, rendered, iframe, srcDoc, motions, messages, attributes, background, label, target, events, frames, preference, animation,
    start() {events.get('load')(); frames.shift()(); frames.shift()();}};
}

test('generated geometry waits for layout and repeats until its surface closes', () => {
  for (const compact of [false, true]) {
    const host = iframeMotion({compact});
    assert.equal(host.motions.length, 0);
    host.events.get('load')(); assert.equal(host.motions.length, 0);
    host.frames.shift()(); assert.equal(host.motions.length, 0);
    host.frames.shift()();
    assert.equal(host.motions.length, 1);
    const motion = host.motions[0];
    assert.deepEqual(JSON.parse(JSON.stringify(motion.keyframes)), host.animation.keyframes);
    assert.equal(motion.options.fill, 'both');
    assert.equal(motion.options.duration, 1500); assert.equal(motion.options.delay, 100);
    assert.equal(host.target.getBoundingClientRect().left, 800, 'first frame also applies during the delay');
    motion.currentTime = 850; assert.equal(host.target.getBoundingClientRect().left, 2400);
    motion.currentTime = 1600; assert.equal(host.target.getBoundingClientRect().left, 800, 'second pass restarts the motion');
    motion.currentTime = 2350; assert.equal(host.target.getBoundingClientRect().left, 2400);
    motion.currentTime = 3100; assert.equal(host.target.getBoundingClientRect().left, 800, 'third pass restarts the motion');
    motion.currentTime = 15100; assert.equal(host.target.getBoundingClientRect().left, 800, 'motion continues beyond three passes');
    host.events.get('pagehide')();
    assert.equal(motion.cancels, 1, 'closing the surface ends the repeated animation');
    assert.equal(host.messages.length, 0);
    assert.equal(host.background.style.display, undefined);
    assert.equal(host.label.style.display, undefined, 'labels stay visible in every layout');
    assert.equal(host.attributes.size, 0, 'the generated viewBox is never cropped or replaced');
    assert.ok(host.srcDoc.includes('viewBox="100 200 16000 9000"'));
  }
});

test('only the nonce-restricted host script is enabled, replay remounts the iframe and foreign failure messages are ignored', () => {
  const host = iframeMotion();
  assert.equal(host.iframe.props.sandbox, 'allow-scripts');
  assert.equal(host.iframe.props.tabIndex, -1);
  assert.equal(host.rendered.props['aria-label'], 'Replay explanation animation');
  assert.equal(host.srcDoc.match(/<script\b/g).length, 1);
  assert.match(host.srcDoc, /default-src 'none'/);
  assert.match(host.srcDoc, /script-src 'nonce-test-nonce';/);
  assert.match(host.srcDoc, /<script nonce="test-nonce">/);
  host.rendered.props.onClick();
  assert.equal(host.renderer.state.play, 1);
  assert.notEqual(host.renderer.render().props.children[0].key, host.iframe.key, 'replay starts a fresh finite animation');
  const frameWindow = {};
  host.renderer.frame.current = {contentWindow: frameWindow};
  host.renderer.receive({source: {}, data: 'selene:visual-invalid'});
  assert.equal(host.renderer.state.failed, false);
  host.renderer.receive({source: frameWindow, data: 'selene:visual-invalid'});
  assert.equal(host.renderer.render().props.className, 'visual-fallback');
});

test('reduced motion shows the static final diagram and cancels live motion without replay', () => {
  const staticHost = iframeMotion({reduced: true}); staticHost.start();
  assert.equal(staticHost.motions.length, 0); assert.equal(staticHost.target.getBoundingClientRect().left, 4000);
  assert.equal(staticHost.label.style.display, undefined);
  const host = iframeMotion(); host.start();
  host.preference.matches = true; host.events.get('preference:change')({matches: true});
  assert.equal(host.motions[0].cancels, 1); assert.equal(host.target.getBoundingClientRect().left, 4000);
  host.preference.matches = false; host.events.get('preference:change')({matches: false});
  assert.equal(host.motions.length, 1);
});

test('iframe removal cancels WAAPI, while invalid targets or script errors fail closed', () => {
  const host = iframeMotion(); host.start(); host.events.get('pagehide')();
  assert.equal(host.motions[0].cancels, 1);
  const missing = iframeMotion({missingTarget: true}); missing.start();
  assert.equal(missing.motions.length, 0); assert.deepEqual(missing.messages, ['selene:visual-invalid']);
  const error = iframeMotion(); error.start(); error.events.get('error')();
  assert.equal(error.motions[0].cancels, 1); assert.deepEqual(error.messages, ['selene:visual-invalid']);
});

test('watching launcher offers only Selene actions and question entry stays minimal', () => {
  const {context} = instance();
  const own = new context.module.exports.OwnApp({session_id: 'test', story: {id: 'test', duration: 200, transcript: [], scenes: []}});
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  own.state = {...own.state, started: true, screen: 'watch', controls: true};
  const launcher = nodes(own.render()).find(node => node.props?.['aria-label'] === 'Selene tools');
  const buttons = nodes(launcher).filter(node => node.type === 'button');
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map(node => node.props['aria-label'] || node.props.children), ['Ask Selene', 'Selene tools', 'Hide Selene']);
  own.state.screen = 'ask';
  const question = nodes(own.render()).find(node => node.type === 'textarea');
  assert.equal(question.props.rows, 1); assert.equal(question.props['data-initial'], true);
});

test('phone Send and catch-up retain captured samples across delayed requests and restart after success', async () => {
  const {context, streams, messages} = instance(), calls = [];
  const phone = new context.module.exports.PrivateMirror({token: 'test'}); phone.componentDidMount();
  const story = {id: 'test', title: 'Test', transcript: [], scenes: []};
  let report = {content_version: 'a'.repeat(64), epoch: 0, sequence: 1, at_seconds: 35, age_ms: 0, fresh: true};
  const advance = at => {report = {...report, at_seconds: at, sequence: report.sequence + 1}; phone.receivePlayback(report);};
  let held, branches = 0;
  streams[0].onmessage({data: JSON.stringify({type: 'personal', story, playback: report, hold: null})});
  context.fetch = async (url, options) => {
    const input = JSON.parse(options.body); calls.push({url, input});
    let result;
    if (url.endsWith('/hold')) {
      held = {id: String(++branches).padStart(36, '0'), content_version: report.content_version, epoch: 0, from_seconds: input.from_seconds, question_at_seconds: null};
      if (branches === 1) advance(40);
      result = {hold: held, playback: report};
    } else if (url.endsWith('/ask')) {
      held = {...held, question_at_seconds: input.at_seconds};
      result = {id: 'answer', request: input.request, at_seconds: input.at_seconds, hold: held, thread: null, evidence: [], quote: null,
        moment: {...moment, grounding: {...moment.grounding, at_seconds: input.at_seconds}}};
    } else if (url.endsWith('/return')) {
      advance(70); result = {status: 'ready', from_seconds: held.from_seconds, through_seconds: input.through_seconds, moment, evidence: []};
    } else assert.fail(`Unexpected private request ${url}`);
    return {ok: true, json: async () => result};
  };
  phone.chooseMoment(20); phone.state.request = 'Explain the earlier line'; await phone.ask();
  assert.equal(calls[0].input.at_seconds, 35); assert.equal(calls[0].input.sequence, 1);
  assert.equal(calls[1].input.at_seconds, 20); assert.equal(phone.state.hold.from_seconds, 35);
  advance(50); phone.state.request = 'More simply please'; await phone.ask();
  assert.equal(calls.at(-1).input.at_seconds, 20); assert.equal(calls.at(-1).input.new_topic, false);
  advance(60); const tappedSequence = report.sequence; await phone.bringBack();
  assert.equal(calls.at(-1).input.through_seconds, 60); assert.equal(calls.at(-1).input.sequence, tappedSequence);
  assert.equal(phone.state.bridge.through_seconds, 60); assert.equal(phone.state.playback.at_seconds, 70);
  assert.equal(phone.state.hold, null); assert.equal(phone.state.selected, null);
  advance(72); phone.state.request = 'What just happened?'; await phone.ask();
  assert.equal(phone.state.hold.from_seconds, 72); assert.equal(calls.at(-1).input.at_seconds, 72);
  assert.equal(messages.length, 0, 'private help cannot issue a native transport action');
  phone.componentWillUnmount();
});

test('thread updates wait through typing and read-aloud, keep the marker, and can continue after a first update', async () => {
  const {context, streams} = instance();
  const phone = new context.module.exports.PrivateMirror({token: 'test'}); phone.componentDidMount();
  const playback = {content_version: 'a'.repeat(64), epoch: 0, sequence: 1, at_seconds: 35, age_ms: 0, fresh: true};
  const hold = {id: 'branch', content_version: playback.content_version, epoch: 0, from_seconds: 35, question_at_seconds: 35};
  const help = {id: 'answer', request: 'Why keep it?', at_seconds: 35, moment: {...moment, grounding: {...moment.grounding, at_seconds: 35}}, quote: null, evidence: []};
  const thread = {id: 'follow', answer_id: help.id, question: help.request, content_version: playback.content_version, epoch: 0,
    help, revision: 0, checked_through_seconds: 35};
  streams[0].onmessage({data: JSON.stringify({type: 'personal', story: {id: 'test'}, playback, hold, help, bridge: null, thread})});
  phone.receivePlayback({...playback, sequence: 2, at_seconds: 45});
  let finish, calls = 0;
  context.fetch = async () => {calls++; return new Promise(resolve => {finish = resolve;});};
  const checking = phone.checkThread(); phone.editing = true; phone.state.request = 'My draft';
  const updated = {...thread, revision: 1, checked_through_seconds: 45,
    help: {...help, at_seconds: 45, moment: {...help.moment, answer: 'A new supported development.', grounding: {...help.moment.grounding, at_seconds: 45},
      visual: {status: 'ready', description: 'A figure is revealed.', svg: '<svg viewBox="0 0 960 540"><g id="figure"><circle cx="480" cy="270" r="60" fill="#ffad33"/></g></svg>',
        animations: [{target_id: 'figure', duration_ms: 1600, delay_ms: 0, keyframes: [{opacity: 0.4, transform: 'none'}, {opacity: 1, transform: 'none'}]}]}}}};
  finish({ok: true, json: async () => ({thread: updated, updated: true})}); await checking;
  assert.equal(phone.state.moment.answer, help.moment.answer); assert.ok(phone.queuedThread);
  streams[0].onmessage({data: JSON.stringify({type: 'personal', story: {id: 'test'},
    playback: {...playback, sequence: 2, at_seconds: 45}, hold, help, bridge: null, thread: updated})});
  assert.equal(phone.state.moment.answer, help.moment.answer, 'automatic reconnect cannot replace a card during typing');
  assert.equal(phone.state.request, 'My draft'); assert.equal(phone.queuedThread.revision, 1);
  phone.editing = false; phone.state.request = ''; phone.state.voice = 'speaking'; phone.flushThread();
  assert.equal(phone.state.moment.answer, help.moment.answer, 'speech must finish before the card changes');
  phone.state.voice = 'idle';
  const oldSetState = phone.setState, deferred = [];
  phone.setState = (...args) => deferred.push(args);
  phone.begin('ask'); phone.flushThread();
  assert.equal(phone.state.moment.answer, help.moment.answer, 'a pending action blocks updates even before React commits busy state');
  phone.setState = oldSetState; deferred.forEach(args => phone.setState(...args));
  phone.pending = null; phone.state.busy = ''; phone.flushThread();
  assert.equal(phone.state.moment.answer, updated.help.moment.answer); assert.equal(phone.state.hold.from_seconds, 35);
  const drawn = (tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(tree => drawn(tree))]);
  phone.state.story = {...phone.state.story, title: 'Football Match'};
  const diagram = drawn(phone.render()).find(node => node.type === context.module.exports.Visual);
  assert.equal(diagram?.props.visual.svg, updated.help.moment.visual.svg, 'a Follow thread diagram is drawn on the phone');
  assert.equal(diagram.props.personal, true);
  phone.receivePlayback({...playback, sequence: 3, at_seconds: 60}); phone.nextThreadCheck = 0;
  context.document.hidden = true; await phone.checkThread(); assert.equal(calls, 1);
  context.document.hidden = false; const next = phone.checkThread();
  assert.equal(calls, 2, 'applying an update cannot disable subsequent thread checks');
  phone.receivePlayback({...playback, sequence: 4, epoch: 1, at_seconds: 10});
  finish({ok: true, json: async () => ({thread: {...updated, revision: 2}, updated: true})}); await next;
  assert.equal(phone.state.thread, null); assert.equal(phone.state.moment, null, 'a late result cannot survive a TV seek');
  phone.state.thread = updated; phone.state.playback.fresh = false;
  context.fetch = async (url, options) => {
    assert.ok(url.endsWith('/thread')); assert.equal(JSON.parse(options.body).enabled, false);
    return {ok: true, json: async () => ({thread: null})};
  };
  await phone.toggleThread();
  assert.equal(phone.state.thread, null, 'the viewer can opt out even while TV samples are stale');
  phone.componentWillUnmount();
});

test('phone reconciliation restores a completed return without resurrecting its old interval', () => {
  const {context, streams} = instance();
  const phone = new context.module.exports.PrivateMirror({token: 'test'}); phone.componentDidMount();
  const bridge = {status: 'ready', from_seconds: 35, through_seconds: 45, moment, evidence: []};
  streams[0].onmessage({data: JSON.stringify({type: 'personal', story: {id: 'test'},
    playback: {content_version: 'a'.repeat(64), epoch: 0, sequence: 3, at_seconds: 50, age_ms: 0, fresh: true}, hold: null, help: null, bridge, thread: null})});
  assert.equal(phone.state.bridge.through_seconds, 45); assert.equal(phone.state.hold, null); assert.equal(phone.questionAt, null);
  assert.equal(phone.state.moment.answer, moment.answer);
  phone.componentWillUnmount();
});


test('Guided Return at the film end shows its recap without restarting the film', async () => {
  const {context} = instance();
  const tv = new context.module.exports.OwnApp({session_id: 'test-session', story: {id: 'test', duration: 105}});
  tv.mounted = true; tv.state.savedPlace = {at_seconds: 40, epoch: 0};
  tv.publishPlayback = async () => {};
  context.fetch = async () => ({ok: true, json: async () => ({status: 'ready', from_seconds: 40, through_seconds: 105, moment})});
  let restarts = 0;
  tv.video.current = {paused: true, ended: true, currentTime: 105, play: async () => {restarts++;}};
  await tv.bringUsBack();
  assert.equal(restarts, 0); assert.equal(tv.state.screen, 'return');
  assert.equal(tv.state.returnResult.through_seconds, 105);
  tv.send = async () => ({ok: true, json: async () => moment});
  await tv.deliver({request: 'Explain that.', at_seconds: 105, playback_choice: 'keep_watching',});
  assert.equal(restarts, 0); assert.equal(tv.state.screen, 'moment');
});


test('conversation options arrive automatically, preserve private work, and queue while the viewer is busy', () => {
  const {context, streams, requests} = instance();
  const phone = new context.module.exports.PrivateMirror({token: 'conversation-test'});
  phone.mounted = true; phone.connect();
  const story = {id: 'test', title: 'Test', content_version: 'a'.repeat(64), duration: 100, scenes: [], transcript: []};
  const playback = {content_id: story.id, content_version: story.content_version, epoch: 0, sequence: 1, at_seconds: 90,
    play_state: 'playing', playback_rate: 1, age_ms: 0, fresh: true};
  const conversation = {id: 'options-one', content_id: story.id, content_version: story.content_version, epoch: 0, at_seconds: 90,
    opportunity: 'reflection', boundary_id: 'cue1', options: [
      {id: 'memory', angle: 'Remember together', question: 'Which game did you play growing up?', recipient: 'grandparent', evidence_ids: ['cue1']},
      {id: 'imagine', angle: 'Imagine together', question: 'What game would you invent?', recipient: 'child', evidence_ids: ['cue1']},
      {id: 'compare', angle: 'Compare experiences', question: '<script>not executable</script> What would you teach each other?', recipient: 'everyone', evidence_ids: ['cue1']},
    ]};
  const receive = value => streams.at(-1).onmessage({data: JSON.stringify(value)});
  receive({type: 'personal', story, playback});
  phone.state.request = 'My unsent question'; phone.state.moment = moment;
  receive({type: 'conversation', conversation}); phone.flushConversation();
  assert.equal(phone.state.conversation, null);
  assert.equal(phone.state.request, 'My unsent question'); assert.equal(phone.state.moment, moment);
  phone.state.request = '';
  for (const [field, value] of [['busy', 'ask'], ['voice', 'listening'], ['pickingTime', true], ['selected', 20]]) {
    const old = phone.state[field]; phone.state[field] = value; phone.flushConversation();
    assert.equal(phone.state.conversation, null, `defer while ${field}`); phone.state[field] = old;
  }
  phone.editing = true; phone.flushConversation(); assert.equal(phone.state.conversation, null); phone.editing = false;
  context.document.hidden = true; phone.flushConversation(); assert.equal(phone.state.conversation, null); context.document.hidden = false;
  phone.flushConversation(); assert.equal(phone.state.conversation.id, conversation.id);
  assert.equal(phone.state.moment, moment); assert.equal(requests.length, 0, 'no submit, voice or playback requests');
  const html = renderToStaticMarkup(phone.render());
  assert.match(html, /Which game did you play growing up/); assert.match(html, /What game would you invent/);
  assert.match(html, /&lt;script&gt;not executable/); assert.doesNotMatch(html, /<script>/);
  phone.dismissedConversation = conversation.id; phone.state.conversation = null;
  receive({type: 'personal', story, playback, conversation}); phone.flushConversation();
  assert.equal(phone.state.conversation, null, 'reconnect does not resurrect a dismissed set');
  receive({type: 'conversation', conversation: {...conversation, id: 'options-two'}}); phone.flushConversation();
  assert.equal(phone.state.conversation.id, 'options-two');
  receive({type: 'playback', playback: {...playback, sequence: 2, epoch: 1, at_seconds: 10}});
  assert.equal(phone.state.conversation, null, 'seek clears old options');
  receive({type: 'conversation', conversation}); phone.flushConversation(); assert.equal(phone.state.conversation, null);
  receive({type: 'closed'}); assert.equal(phone.queuedConversation, null); assert.equal(phone.state.conversation, null);
});
