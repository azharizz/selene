import * as React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import {BackHandler} from 'react-native';
import {WebView} from '@amazon-devices/webview';
import {App} from '../src/App';
import {appUrl} from '../src/config.json';

jest.mock('@amazon-devices/webview', () => ({
  WebView: 'WebView',
}));

jest.mock('@amazon-devices/react-native-kepler', () => ({
  LogBox: {ignoreLogs: jest.fn()},
  usePreventHideSplashScreen: jest.fn(),
  useHideSplashScreenCallback: jest.fn(() => jest.fn()),
  StyleSheet: {create: (styles: unknown) => styles, flatten: (styles: unknown) => Object.assign({}, ...[styles].flat(Infinity))},
  AppState: {addEventListener: () => ({remove: jest.fn()})},
  View: 'View',
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  Animated: jest.requireActual('@amazon-devices/react-native-kepler').Animated,
  Easing: jest.requireActual('@amazon-devices/react-native-kepler').Easing,
  AccessibilityInfo: {isReduceMotionEnabled: () => Promise.resolve(true)},
  useWindowDimensions: () => ({width: 1920, height: 1080}),
  BackHandler: {exitApp: jest.fn(), addEventListener: jest.fn(() => ({remove: jest.fn()}))},
}));

describe('App', () => {
  it('keeps the companion available when the native SDK is unavailable in Jest', async () => {
    const {getByText} = render(<App />);
    await waitFor(() => expect(getByText(/Playback discovery is unavailable/)).toBeTruthy());
  });
  it('Back leaves a failed demo WebView instead of sending input into it', async () => {
    const app = render(<App />);
    await waitFor(() => expect(app.getByText(/Playback discovery is unavailable/)).toBeTruthy());
    fireEvent.press(app.getByText('Try the demo'));
    fireEvent(app.UNSAFE_getByType(WebView), 'error');
    expect(app.getByText('SELENE could not connect')).toBeTruthy();
    const calls = (BackHandler.addEventListener as jest.Mock).mock.calls;
    act(() => {expect(calls[calls.length - 1][1]()).toBe(true);});
    await waitFor(() => expect(app.getByText(/Playback discovery is unavailable/)).toBeTruthy());
  });
  it('resource failures and cancelled loads do not cover the functioning player with a connection error', async () => {
    const app = render(<App />);
    await waitFor(() => expect(app.getByText(/Playback discovery is unavailable/)).toBeTruthy());
    fireEvent.press(app.getByText('Try the demo'));
    const frame = () => app.UNSAFE_getByType(WebView);
    fireEvent(frame(), 'load', {nativeEvent: {url: `${appUrl}/`}});
    for (const error of [{url: `${appUrl}/media/the-red-kite.mp4`, code: -2}, {url: 'about:srcdoc', code: -2}, {url: `${appUrl}/`, code: -3}]) {
      fireEvent(frame(), 'error', {nativeEvent: error});
      expect(app.queryByText('SELENE could not connect')).toBeNull();
    }
    fireEvent(frame(), 'loadStart');
    fireEvent(frame(), 'error', {nativeEvent: {url: `${appUrl}/`, code: -105}});
    expect(app.getByText('SELENE could not connect')).toBeTruthy();
  });
  it('accepts a missing Vega message URL only after a trusted load, and clears trust on navigation', async () => {
    const app = render(<App />);
    await waitFor(() => expect(app.getByText(/Playback discovery is unavailable/)).toBeTruthy());
    fireEvent.press(app.getByText('Try the demo'));
    const frame = () => app.UNSAFE_getByType(WebView);
    expect(frame().props.domStorageEnabled).toBe(true);
    const send = (url?: string) => fireEvent(frame(), 'message', {nativeEvent: {data: 'selene:companion', ...(url !== undefined ? {url} : {})}});
    send(); expect(frame()).toBeTruthy();
    fireEvent(frame(), 'load', {nativeEvent: {url: `${appUrl}/`}});
    send('https://untrusted.example/'); expect(frame()).toBeTruthy();
    fireEvent(frame(), 'loadStart'); send(); expect(frame()).toBeTruthy();
    fireEvent(frame(), 'load', {nativeEvent: {url: `${appUrl}/?story=sintel-excerpt`}});
    send();
    await waitFor(() => expect(app.getByText(/Playback discovery is unavailable/)).toBeTruthy());
  });
});
