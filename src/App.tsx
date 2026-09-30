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

class SessionApp extends React.Component<{onReady: () => void}, {demo: boolean; accessibility: AccessibilitySnapshot}> {
  state = {demo: false, accessibility: {} as AccessibilitySnapshot};
  private mounted = false;
  private settings = new Accessibility(accessibility => {if (this.mounted) this.setState({accessibility});});
  componentDidMount() {this.mounted = true; void this.settings.start();}
  componentWillUnmount() {this.mounted = false; this.settings.stop();}
  render() {
    return this.state.demo ? <OwnPlayer onReady={this.props.onReady} accessibility={this.state.accessibility} onCompanion={() => this.setState({demo: false})} />
      : <Companion onReady={this.props.onReady} accessibility={this.state.accessibility} onDemo={() => this.setState({demo: true})} />;
  }
}

class OwnPlayer extends React.Component<{onReady: () => void; onCompanion: () => void; accessibility: AccessibilitySnapshot}, {failed: boolean; attempt: number}> {
  state = {failed: false, attempt: 0};
  private frame = React.createRef<React.ElementRef<typeof WebView>>();
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
  private message = (event: {nativeEvent: {url: string; data: string}}) => {
    if (!isOwnPlayerUrl(event.nativeEvent.url)) return;
    const data = event.nativeEvent.data;
    if (data === 'selene:companion') return this.props.onCompanion();
    if (data === 'selene:exit') return BackHandler.exitApp();
    try {
      const message = JSON.parse(data) as {type?: string; state?: BrowserPlayerState; focused?: boolean};
      if (message.type === 'selene:player-state' && message.state) this.player.update(message.state);
      if (message.type === 'selene:audio-focus') this.player.setAudioFocus(Boolean(message.focused));
    } catch { /* only JSON bridge messages carry player state */ }
  };
  render() {
    const {failed, attempt} = this.state;
    return <View style={styles.container}>
      <WebView ref={this.frame} key={attempt} style={styles.webview} source={{uri: appUrl}}
        hasTVPreferredFocus allowsDefaultMediaControl javaScriptEnabled
        mediaPlaybackRequiresUserAction mixedContentMode="never"
        injectedJavaScriptBeforeContentLoaded={`window.__SELENE_A11Y__=${JSON.stringify(this.props.accessibility).replace(/</g, '\\u003c')};true;`}
        onShouldStartLoadWithRequest={event => isOwnPlayerUrl(event.url) || event.url === 'about:blank' || event.url === 'about:srcdoc'}
        onMessage={this.message}
        onCloseWindow={() => this.setState({failed: true})}
        onLoad={() => {this.props.onReady(); this.player.requestState(); this.publishAccessibility();}}
        onError={() => {this.props.onReady(); this.setState({failed: true});}}
        onHttpError={event => {if (event.nativeEvent.isMainFrame) {this.props.onReady(); this.setState({failed: true});}}}
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
  errorContent: {flexGrow: 1, padding: 96, justifyContent: 'center', gap: 32},
  title: {fontSize: 48, color: '#f1f1f1'},
  copy: {fontSize: 32, color: '#b9bdc6'},
});
