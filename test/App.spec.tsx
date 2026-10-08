/* global globalThis */
import * as React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import {BackHandler} from 'react-native';
import {App} from '../src/App';

jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  VideoPlayer: class {
    currentTime = 0; paused = true; ended = false; seeking = false; duration = 60; error = null;
    initialize() {return Promise.resolve();}
    deinitialize() {return Promise.resolve();}
    addEventListener() {}
    setSurfaceHandle() {}
    clearSurfaceHandle() {}
    play() {return Promise.resolve();}
    pause() {}
  },
  MediaSource: class {addEventListener() {}},
  KeplerVideoSurfaceView: 'KeplerVideoSurfaceView',
}));
jest.mock('@amazon-devices/react-native-svg', () => ({
  __esModule: true, default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', G: 'G', Line: 'Line', Path: 'Path', Polygon: 'Polygon', Polyline: 'Polyline', Rect: 'Rect', Text: 'SvgText', TSpan: 'TSpan',
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
