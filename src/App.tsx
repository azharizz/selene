import {WebView} from '@amazon-devices/webview';
import React, {useState} from 'react';
import {BackHandler, View, Text, StyleSheet} from 'react-native';
import {useHideSplashScreenCallback, usePreventHideSplashScreen} from '@amazon-devices/react-native-kepler';
import {Button, Companion} from './Companion';
import {appUrl} from './config.json';
import {OwnPlayerSession, type BrowserPlayerState} from './OwnPlayerSession';

function isOwnPlayerUrl(value: string) {
  try {const target = new URL(value); const base = new URL(appUrl); return target.origin === base.origin && target.pathname === '/';}
  catch {return false;}
}

export const App = () => {
  const [demo, setDemo] = useState(false);
  usePreventHideSplashScreen();
  const hideSplash = useHideSplashScreenCallback();
  if (!demo) return <Companion onReady={hideSplash} onDemo={() => setDemo(true)} />;
  return <OwnPlayer onReady={hideSplash} onCompanion={() => setDemo(false)} />;
};

class OwnPlayer extends React.Component<{onReady: () => void; onCompanion: () => void}, {failed: boolean; attempt: number}> {
  state = {failed: false, attempt: 0};
  private frame = React.createRef<React.ElementRef<typeof WebView>>();
  private player = new OwnPlayerSession(message => {
    this.frame.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:${JSON.stringify(message).replace(/</g, '\\u003c')}}));true;`);
  });

  componentDidMount() {this.player.start();}
  componentWillUnmount() {this.player.stop();}
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
      {failed ? <View style={styles.error}>
        <Text style={styles.title}>SELENE could not connect</Text>
        <Text style={styles.copy}>Start the SELENE service and connect this device, then try again.</Text>
        <Button label="Try again" preferred onPress={() => this.setState({failed: false, attempt: attempt + 1})} />
        <Button label="Back to playback apps" onPress={this.props.onCompanion} />
      </View> : <WebView ref={this.frame} key={attempt} style={styles.webview} source={{uri: appUrl}}
        hasTVPreferredFocus allowSystemKeyEvents allowsDefaultMediaControl javaScriptEnabled
        mediaPlaybackRequiresUserAction mixedContentMode="never"
        onShouldStartLoadWithRequest={event => isOwnPlayerUrl(event.url) || event.url === 'about:blank' || event.url === 'about:srcdoc'}
        onMessage={this.message}
        onCloseWindow={() => BackHandler.exitApp()}
        onLoad={() => {this.props.onReady(); this.player.requestState();}}
        onError={() => {this.props.onReady(); this.setState({failed: true});}}
        onHttpError={event => {if (event.nativeEvent.isMainFrame) {this.props.onReady(); this.setState({failed: true});}}}
      />}
    </View>;
  }
}
const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#101714'},
  webview: {flex: 1, backgroundColor: '#101714'},
  error: {flex: 1, padding: 96, justifyContent: 'center', gap: 32},
  title: {fontSize: 48, color: '#f6f2e9'},
  copy: {fontSize: 32, color: '#c5ccc6'},
});
