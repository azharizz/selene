import * as React from 'react';
import {render, waitFor} from '@testing-library/react-native';
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
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  BackHandler: {exitApp: jest.fn()},
}));

describe('App', () => {
  it('keeps the companion available when the native SDK is unavailable in Jest', async () => {
    const {getByText} = render(<App />);
    await waitFor(() => expect(getByText(/Shared playback discovery is unavailable in this Vega runtime/)).toBeTruthy());
  });
});
