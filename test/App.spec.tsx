import * as React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import {BackHandler} from 'react-native';
import {WebView} from '@amazon-devices/webview';
import {App} from '../src/App';

jest.mock('@amazon-devices/webview', () => ({
  WebView: 'WebView',
}));

jest.mock('@amazon-devices/react-native-kepler', () => ({
  usePreventHideSplashScreen: jest.fn(),
  useHideSplashScreenCallback: jest.fn(() => jest.fn()),
  StyleSheet: {create: (styles: unknown) => styles, flatten: (styles: unknown) => Object.assign({}, ...[styles].flat(Infinity))},
  AppState: {addEventListener: () => ({remove: jest.fn()})},
  View: 'View',
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  BackHandler: {exitApp: jest.fn(), addEventListener: jest.fn(() => ({remove: jest.fn()}))},
}));

describe('App', () => {
  it('keeps the companion available when the native SDK is unavailable in Jest', async () => {
    const {getByText} = render(<App />);
    await waitFor(() => expect(getByText(/Playback discovery is unavailable on this device/)).toBeTruthy());
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
});
