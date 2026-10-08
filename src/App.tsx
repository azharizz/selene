import {WebView} from '@amazon-devices/webview';
import React from 'react';
import {BackHandler, ScrollView, View, Text, StyleSheet} from 'react-native';
import {useHideSplashScreenCallback, usePreventHideSplashScreen} from '@amazon-devices/react-native-kepler';
import {Button, Companion, accessibleText} from './Companion';
import {appUrl} from './config.json';
import {OwnPlayerSession, type BrowserPlayerState} from './OwnPlayerSession';
import {Accessibility, type AccessibilitySnapshot} from './Accessibility';

function isOwnPlayerUrl(value: string) {
  try {
    const target = new URL(value) as unknown as {origin: string; pathname: string};
    const base = new URL(appUrl) as unknown as {origin: string};
    return target.origin === base.origin && target.pathname === '/';
  }
  catch {return false;}
}

export const App = () => {
  usePreventHideSplashScreen();
  const hideSplash = useHideSplashScreenCallback();
  return <SessionApp onReady={hideSplash} />;
};

class SessionApp extends React.Component<{onReady: () => void}, {screen: 'companion' | 'demo' | 'import'; accessibility: AccessibilitySnapshot}> {
  state = {screen: 'companion' as 'companion' | 'demo' | 'import', accessibility: {} as AccessibilitySnapshot};
  private mounted = false;
  private settings = new Accessibility(accessibility => {if (this.mounted) this.setState({accessibility});});
  componentDidMount() {this.mounted = true; void this.settings.start();}
  componentWillUnmount() {this.mounted = false; this.settings.stop();}
  render() {
    return this.state.screen !== 'companion' ? <OwnPlayer importMp4={this.state.screen === 'import'} onReady={this.props.onReady} accessibility={this.state.accessibility} onCompanion={() => this.setState({screen: 'companion'})} />
      : <Companion onReady={this.props.onReady} accessibility={this.state.accessibility} onDemo={() => this.setState({screen: 'demo'})} onImport={() => this.setState({screen: 'import'})} />;
  }
}

class OwnPlayer extends React.Component<{onReady: () => void; onCompanion: () => void; accessibility: AccessibilitySnapshot; importMp4: boolean}, {failed: boolean; attempt: number}> {
  state = {failed: false, attempt: 0};
  private frame = React.createRef<React.ElementRef<typeof WebView>>();
  private loadedUrl: string | null = null;
  private backSubscription: {remove: () => void} | null = null;
  private player = new OwnPlayerSession(message => {
    this.frame.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:${JSON.stringify(message).replace(/</g, '\\u003c')}}));true;`);
  });

  componentDidMount() {
    this.player.start();
    this.backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (this.state.failed) {this.props.onCompanion(); return true;}
      this.frame.current?.injectJavaScript("window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{type:'selene:native-player',action:'back'}}));true;");
      return true;
    });
  }
  componentWillUnmount() {
    this.backSubscription?.remove();
    this.player.stop();
  }
  componentDidUpdate(previous: Readonly<OwnPlayer['props']>) {if (previous.accessibility !== this.props.accessibility) this.publishAccessibility();}
  private publishAccessibility = () => {
    this.frame.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:${JSON.stringify({type: 'selene:accessibility', settings: this.props.accessibility}).replace(/</g, '\\u003c')}}));true;`);
  };
  private loadError = (event?: {nativeEvent: {url?: string; code?: number}}) => {
    const error = event?.nativeEvent;
    const resource = Boolean(error?.url && !isOwnPlayerUrl(error.url));
    const cancelled = error?.code === -3; // Chromium ERR_ABORTED is a cancelled request, not lost connectivity.
    console.info('[SELENE_WEBVIEW_ERROR]', JSON.stringify({code: error?.code ?? null, resource, cancelled}));
    if (resource || cancelled) return;
    this.loadedUrl = null; this.props.onReady(); this.setState({failed: true});
  };
  private message = (event: {nativeEvent: {url?: string; data: string}}) => {
    // Vega 0.24 omits url on message events. Only a completed, trusted native
    // navigation can supply the fallback; an explicit foreign source still fails.
    const source = event.nativeEvent.url ?? this.loadedUrl;
    if (!source || !isOwnPlayerUrl(source)) return;
    const data = event.nativeEvent.data;
    if (data === 'selene:companion') return this.props.onCompanion();
    if (data === 'selene:exit') return BackHandler.exitApp();
    try {
      const message = JSON.parse(data) as {type?: string; state?: BrowserPlayerState; focused?: boolean};
      if (message.type === 'selene:player-state' && message.state) this.player.update(message.state);
      if (message.type === 'selene:audio-focus') this.player.setAudioFocus(Boolean(message.focused));
      if (message.type === 'selene:media-diagnostic' && data.length <= 4096) console.info('[SELENE_MEDIA]', data);
    } catch { /* only JSON bridge messages carry player state */ }
  };
  render() {
    const {failed, attempt} = this.state;
    return <View style={styles.container}>
      <WebView ref={this.frame} key={attempt} style={styles.webview} source={{uri: this.props.importMp4 ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}import=mp4` : appUrl}}
        hasTVPreferredFocus allowsDefaultMediaControl javaScriptEnabled domStorageEnabled
        mediaPlaybackRequiresUserAction mixedContentMode="never"
        injectedJavaScriptBeforeContentLoaded={`window.__SELENE_A11Y__=${JSON.stringify(this.props.accessibility).replace(/</g, '\\u003c')};true;`}
        onShouldStartLoadWithRequest={event => isOwnPlayerUrl(event.url) || event.url === 'about:blank' || event.url === 'about:srcdoc'}
        onMessage={this.message}
        onLoadStart={() => {this.loadedUrl = null;}}
        onCloseWindow={() => {console.info('[SELENE_WEBVIEW_CLOSED]'); this.loadedUrl = null; this.setState({failed: true});}}
        onLoad={event => {this.loadedUrl = isOwnPlayerUrl(event.nativeEvent.url) ? event.nativeEvent.url : null; this.props.onReady(); this.player.requestState(); this.publishAccessibility();}}
        onError={this.loadError}
        onHttpError={event => {if (event.nativeEvent.isMainFrame) {this.loadedUrl = null; this.props.onReady(); this.setState({failed: true});}}}
      />
      {failed && <ScrollView style={styles.error} contentContainerStyle={styles.errorContent}>
        <Text allowFontScaling={false} style={accessibleText(styles.title, this.props.accessibility)}>SELENE could not connect</Text>
        <Text allowFontScaling={false} style={accessibleText(styles.copy, this.props.accessibility)}>Start the SELENE service and connect this device, then try again.</Text>
        <Button accessibility={this.props.accessibility} label="Try again" preferred onPress={() => this.setState({failed: false, attempt: attempt + 1})} />
        <Button accessibility={this.props.accessibility} label="Back to playback apps" onPress={this.props.onCompanion} />
      </ScrollView>}
    </View>;
  }
}
const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#101114'},
  webview: {flex: 1, backgroundColor: '#101114'},
  error: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#101114'},
  errorContent: {flexGrow: 1, padding: 48, justifyContent: 'center', gap: 16},
  title: {fontSize: 28, color: '#f1f1f1'},
  copy: {fontSize: 18, color: '#b9bdc6'},
});
