/* global globalThis, AbortSignal */
import * as React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import {BackHandler} from 'react-native';
import {App} from '../src/App';
import {Player} from '../src/Player';

let mockPlayer: {currentTime: number; paused: boolean; emit: (event: string) => void};

jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  VideoPlayer: class {
    currentTime = 0; paused = true; ended = false; seeking = false; duration = 60; error = null;
    listeners: Record<string, () => void> = {};
    constructor() {mockPlayer = this;}
    emit(event: string) {this.listeners[event]?.();}
    initialize() {return Promise.resolve();}
    deinitialize() {return Promise.resolve();}
    addEventListener(event: string, listener: () => void) {this.listeners[event] = listener;}
    setSurfaceHandle() {}
    clearSurfaceHandle() {}
    play() {this.paused = false; this.emit('play'); return Promise.resolve();}
    pause() {this.paused = true; this.emit('pause');}
  },
  MediaSource: class {addEventListener() {}},
  KeplerVideoSurfaceView: 'KeplerVideoSurfaceView',
}));
jest.mock('@amazon-devices/react-native-svg', () => ({
  __esModule: true, default: 'Svg', Defs: 'Defs', LinearGradient: 'LinearGradient', Stop: 'Stop', Circle: 'Circle', Ellipse: 'Ellipse', G: 'G', Line: 'Line', Path: 'Path', Polygon: 'Polygon', Polyline: 'Polyline', Rect: 'Rect', Text: 'SvgText', TSpan: 'TSpan',
}));
jest.mock('@amazon-devices/react-native-async-storage__async-storage', () => ({
  __esModule: true, default: {getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined)},
}));
jest.mock('@amazon-devices/react-native-kepler', () => ({
  LogBox: {ignoreLogs: jest.fn()},
  usePreventHideSplashScreen: jest.fn(),
  useHideSplashScreenCallback: jest.fn(() => jest.fn()),
  StyleSheet: {create: (styles: unknown) => styles, flatten: (styles: unknown) => Object.assign({}, ...[styles].flat(Infinity)), absoluteFill: {}},
  AppState: {addEventListener: () => ({remove: jest.fn()})},
  View: 'View',
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  Animated: jest.requireActual('@amazon-devices/react-native-kepler').Animated,
  Easing: jest.requireActual('@amazon-devices/react-native-kepler').Easing,
  AccessibilityInfo: {isReduceMotionEnabled: () => Promise.resolve(true)},
  useWindowDimensions: () => ({width: 640, height: 360}),
  BackHandler: {exitApp: jest.fn(), addEventListener: jest.fn(() => ({remove: jest.fn()}))},
}));

const story = {id: 'football-match', content_version: 'a'.repeat(64), title: 'Football Match', subtitle: 'Captioned 3D match commentary', duration: 60,
  video: '/media/football-match/video.mp4', poster: '/media/football-match/poster.jpg', scenes: [], transcript: []};
const respond = (status: number, body: unknown) => Promise.resolve({ok: status < 400, status, json: async () => body});
const latestBack = () => {const calls = (BackHandler.addEventListener as jest.Mock).mock.calls; return calls[calls.length - 1][1] as () => boolean;};

describe('App', () => {
  afterEach(() => {delete (globalThis as {fetch?: unknown}).fetch;});

  it('keeps the companion available when the native SDK is unavailable in Jest', async () => {
    const {getByText} = render(<App />);
    await waitFor(() => expect(getByText(/Playback discovery is unavailable/)).toBeTruthy());
  });

  it('Try the demo opens the native player for the relay story, without a WebView', async () => {
    const fetch = jest.fn(() => respond(201, {session_id: 's1', story, catalog: [story]}));
    (globalThis as {fetch?: unknown}).fetch = fetch;
    const app = render(<App />);
    await waitFor(() => expect(app.getByText(/Playback discovery is unavailable/)).toBeTruthy());
    fireEvent.press(app.getByText('Try the demo'));
    await waitFor(() => expect(app.getByText('Watch demo')).toBeTruthy());
    expect(app.getByText('Football Match')).toBeTruthy();
    expect((fetch.mock.calls[0] as unknown[])[0]).toMatch(/\/api\/session$/);
    expect(app.UNSAFE_queryAllByType('WebView' as never)).toHaveLength(0);
  });

  it('a relay failure offers retry and a way back to playback apps', async () => {
    (globalThis as {fetch?: unknown}).fetch = jest.fn(() => Promise.reject(new Error('offline')));
    const app = render(<App />);
    await waitFor(() => expect(app.getByText(/Playback discovery is unavailable/)).toBeTruthy());
    fireEvent.press(app.getByText('Try the demo'));
    await waitFor(() => expect(app.getByText(/The story could not load/)).toBeTruthy());
    fireEvent.press(app.getByLabelText('Connect to another playback app'));
    await waitFor(() => expect(app.getByText(/Playback discovery is unavailable/)).toBeTruthy());
  });

  it('Back on the welcome screen asks before leaving', async () => {
    (globalThis as {fetch?: unknown}).fetch = jest.fn(() => respond(201, {session_id: 's1', story, catalog: [story]}));
    const app = render(<App />);
    await waitFor(() => expect(app.getByText(/Playback discovery is unavailable/)).toBeTruthy());
    fireEvent.press(app.getByText('Try the demo'));
    await waitFor(() => expect(app.getByText('Watch demo')).toBeTruthy());
    act(() => {expect(latestBack()()).toBe(true);});
    expect(app.getByText('Leave SELENE?')).toBeTruthy();
  });
});

describe('native answer placement lifecycle', () => {
  const answer = {state: 'response', answer: 'A grounded answer.', visual: {status: 'none', svg: '', description: '', animations: []},
    intervention: {playback: 'keep_watching', audio: 'silent'}, grounding: {content_id: story.id, scene_id: '', at_seconds: 2, evidence_ids: []}};
  const reply = {tool: 'explain', text: answer.answer, moment: answer, label: '', command: null};
  let fetch: jest.Mock;
  beforeEach(() => {
    jest.useFakeTimers();
    fetch = jest.fn((url: string) => {
      if (url.endsWith('/api/session')) return respond(201, {session_id: 's1', story: {...story, transcript: [{id: 'c1', start: 0, end: 60, text: 'Caption'}]}});
      if (url.includes('/api/examples?')) return respond(200, {examples: [{id: 'e1', request: 'Prepared question', at_seconds: 0}]});
      if (url.endsWith('/api/assistant')) return respond(200, reply);
      if (url.endsWith('/api/moment')) return respond(200, answer);
      if (url.endsWith('/api/placement')) return respond(200, {corner: 'top-left', at_seconds: mockPlayer.currentTime, duration_seconds: 10});
      return respond(200, {});
    });
    (globalThis as {fetch?: unknown}).fetch = fetch;
  });
  afterEach(() => {jest.useRealTimers(); delete (globalThis as {fetch?: unknown}).fetch;});

  async function watching(screenReader = false) {
    const app = render(<Player importMp4={false} accessibility={{screenReader}} onCompanion={() => undefined} onReady={() => undefined}/>);
    await act(async () => undefined);
    await act(async () => {fireEvent.press(app.getByText('Watch demo'));});
    await act(async () => {fireEvent.press(app.getByLabelText('Selene'));});
    await act(async () => {fireEvent.press(app.getByText('Ask Selene'));});
    return app;
  }
  async function answered(screenReader = false, prepared = false) {
    const app = await watching(screenReader);
    await act(async () => {fireEvent.press(app.getByText(prepared ? 'Prepared question' : 'Who is this?'));});
    return app;
  }
  function measure(app: {getByLabelText: (label: string) => unknown}, width = 280, height = 90) {
    fireEvent(app.getByLabelText('Moment Response') as never, 'layout', {nativeEvent: {layout: {x: 0, y: 0, width, height}}});
  }

  it('samples live playback after the answer arrives, uses measured bounds, settles once and dismisses ten seconds later', async () => {
    let finishPlacement!: (value: unknown) => void;
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation((url: string, options: unknown) => url.endsWith('/api/placement')
      ? new Promise(resolve => {finishPlacement = resolve;}) : original(url, options));
    const app = await answered();
    mockPlayer.currentTime = 24; mockPlayer.paused = true;
    await act(async () => {measure(app, 300, 100);});
    const call = fetch.mock.calls.find(([url]) => url.endsWith('/api/placement'));
    expect(JSON.parse(call![1].body)).toEqual({content_id: story.id, at_seconds: 24, duration_seconds: 10, width_fraction: 300 / 640,
      height_fraction: 100 / 360, captions: true, play_state: 'paused'});
    expect(call![1].headers['X-Selene-Session']).toBe('s1');
    expect(app.getByText(answer.answer)).toBeTruthy();
    await act(async () => {jest.advanceTimersByTime(2000);});
    await act(async () => {finishPlacement({ok: true, status: 200, json: async () => ({corner: 'bottom-left', at_seconds: 24, duration_seconds: 10})});});
    expect(app.getByLabelText('Moment Response').props.style).toContainEqual({left: '5%', bottom: '5%'});
    await act(async () => {measure(app, 300, 120); jest.advanceTimersByTime(9999);});
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/api/placement'))).toHaveLength(1);
    expect(app.getByText(answer.answer)).toBeTruthy();
    await act(async () => {jest.advanceTimersByTime(1);});
    expect(app.queryByText(answer.answer)).toBeNull();
  });

  it('places direct prepared answers and keeps More navigation open beyond the deadline', async () => {
    const app = await answered(false, true);
    await act(async () => {measure(app);});
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/api/moment'))).toBe(true);
    expect(app.getByLabelText('Moment Response').props.style).toContainEqual({left: '5%', top: '5%'});
    fireEvent.press(app.getByLabelText('More options'));
    await act(async () => {jest.advanceTimersByTime(15000);});
    expect(app.getByLabelText('This moment')).toBeTruthy();
    fireEvent.press(app.getByText('Back'));
    await act(async () => {jest.advanceTimersByTime(15000);});
    expect(app.getByText(answer.answer)).toBeTruthy();
    fireEvent.press(app.getByLabelText('Dismiss answer'));
    expect(app.queryByText(answer.answer)).toBeNull();
  });

  it('keeps the answer with explicit top-right fallback when placement fails', async () => {
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation((url: string, options: unknown) => url.endsWith('/api/placement') ? respond(503, {error: 'No frames'}) : original(url, options));
    const app = await answered();
    await act(async () => {measure(app);});
    expect(app.getByText(answer.answer)).toBeTruthy();
    expect(app.getByText('Placement unavailable; using the top-right corner.')).toBeTruthy();
    expect(app.getByLabelText('Moment Response').props.style).toContainEqual({right: '5%', top: '5%'});
    await act(async () => {jest.advanceTimersByTime(10000);});
    expect(app.queryByText(answer.answer)).toBeNull();
  });

  it('aborts placement on a seek and rejects late results without closing a newer answer', async () => {
    let finishPlacement!: (value: unknown) => void;
    let signal!: AbortSignal;
    const original = fetch.getMockImplementation()!;
    const app = await answered();
    fetch.mockImplementation((url: string, options: {signal: AbortSignal}) => url.endsWith('/api/placement')
      ? new Promise(resolve => {finishPlacement = resolve; signal = options.signal;}) : original(url, options));
    await act(async () => {measure(app);});
    act(() => {mockPlayer.emit('seeking');});
    expect(signal.aborted).toBe(true);
    expect(app.queryByText(answer.answer)).toBeNull();
    fetch.mockImplementation(original);
    await act(async () => {fireEvent.press(app.getByText('Ask Selene'));});
    await act(async () => {fireEvent.press(app.getByLabelText('Who is this?'));});
    await act(async () => {measure(app);});
    await act(async () => {finishPlacement({ok: true, status: 200, json: async () => ({corner: 'bottom-right', at_seconds: 0, duration_seconds: 10})});});
    expect(app.getByLabelText('Moment Response').props.style).toContainEqual({left: '5%', top: '5%'});
    await act(async () => {jest.advanceTimersByTime(9999);});
    expect(app.getByText(answer.answer)).toBeTruthy();
  });

  it.each([false, true])('does not time out interaction or screen-reader answers (screenReader=%s)', async screenReader => {
    const app = await answered(screenReader);
    await act(async () => {measure(app);});
    if (!screenReader) fireEvent(app.getByLabelText('More options'), 'focus');
    await act(async () => {jest.advanceTimersByTime(20000);});
    expect(app.getByText(answer.answer)).toBeTruthy();
    fireEvent.press(app.getByLabelText('Dismiss answer'));
    expect(app.queryByText(answer.answer)).toBeNull();
  });

  it('never places or auto-dismisses a clarification', async () => {
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation((url: string, options: unknown) => url.endsWith('/api/assistant')
      ? respond(200, {...reply, moment: {...answer, state: 'clarification', answer: 'Which player?'}}) : original(url, options));
    const app = await answered();
    await act(async () => {jest.advanceTimersByTime(20000);});
    expect(app.getByText('Which player?')).toBeTruthy();
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/api/placement'))).toBe(false);
  });

  it('keeps an assistant recap open without starting placement or a deadline', async () => {
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation((url: string, options: unknown) => url.endsWith('/api/assistant') ? respond(200, {...reply, tool: 'catch_me_up'}) : original(url, options));
    const app = await answered();
    await act(async () => {jest.advanceTimersByTime(20000);});
    expect(app.getByText(answer.answer)).toBeTruthy();
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/api/placement'))).toBe(false);
  });

  it('falls back to existing proportions without layout and expires playing placement within the sampled horizon', async () => {
    let finishPlacement!: (value: unknown) => void;
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation((url: string, options: unknown) => url.endsWith('/api/placement')
      ? new Promise(resolve => {finishPlacement = resolve;}) : original(url, options));
    const app = await answered();
    await act(async () => {jest.advanceTimersByTime(120);});
    const call = fetch.mock.calls.find(([url]) => url.endsWith('/api/placement'));
    expect(JSON.parse(call![1].body)).toMatchObject({width_fraction: 280 / 640, height_fraction: 0.75, play_state: 'playing'});
    mockPlayer.currentTime = 2;
    await act(async () => {jest.advanceTimersByTime(2000); finishPlacement({ok: true, status: 200, json: async () => ({corner: 'top-left', at_seconds: 0, duration_seconds: 10})});});
    await act(async () => {jest.advanceTimersByTime(7999);});
    expect(app.getByText(answer.answer)).toBeTruthy();
    await act(async () => {jest.advanceTimersByTime(1);});
    expect(app.queryByText(answer.answer)).toBeNull();
  });

  it.each(['close', 'unmount'])('aborts pending placement on %s', async action => {
    let signal!: AbortSignal;
    let finishPlacement!: (value: unknown) => void;
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation((url: string, options: {signal: AbortSignal}) => url.endsWith('/api/placement')
      ? new Promise(resolve => {signal = options.signal; finishPlacement = resolve;}) : original(url, options));
    const app = await answered();
    await act(async () => {measure(app);});
    act(() => {if (action === 'close') fireEvent.press(app.getByLabelText('Dismiss answer')); else app.unmount();});
    expect(signal.aborted).toBe(true);
    await act(async () => {finishPlacement({ok: true, status: 200, json: async () => ({corner: 'top-left', at_seconds: 0, duration_seconds: 10})});});
    if (action === 'close') expect(app.queryByText(answer.answer)).toBeNull();
  });

  it.each(['time', 'play-state'])('falls back rather than applying a stale %s sample', async changed => {
    let finishPlacement!: (value: unknown) => void;
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation((url: string, options: unknown) => url.endsWith('/api/placement')
      ? new Promise(resolve => {finishPlacement = resolve;}) : original(url, options));
    const app = await answered();
    await act(async () => {measure(app);});
    if (changed === 'time') mockPlayer.currentTime = 3; else mockPlayer.paused = true;
    await act(async () => {finishPlacement({ok: true, status: 200, json: async () => ({corner: 'bottom-left', at_seconds: 0, duration_seconds: 10})});});
    expect(app.getByLabelText('Moment Response').props.style).toContainEqual({right: '5%', top: '5%'});
    expect(app.getByText('Placement unavailable; using the top-right corner.')).toBeTruthy();
    expect(app.getByText(answer.answer)).toBeTruthy();
  });

  it('bounds a stalled placement fetch and retains the delivered answer', async () => {
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation((url: string, options: {signal: AbortSignal}) => url.endsWith('/api/placement')
      ? new Promise((_resolve, reject) => {options.signal.addEventListener('abort', () => reject(new Error('aborted')));}) : original(url, options));
    const app = await answered();
    await act(async () => {measure(app); jest.advanceTimersByTime(3000);});
    expect(app.getByText(answer.answer)).toBeTruthy();
    expect(app.getByText('Placement unavailable; using the top-right corner.')).toBeTruthy();
  });
});
