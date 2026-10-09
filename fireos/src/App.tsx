import React from 'react';
import {StyleSheet, View, useWindowDimensions} from 'react-native';
import {Companion} from './Companion';
import {Player} from './Player';
import {Accessibility, type AccessibilitySnapshot} from './Accessibility';
import {CANVAS} from './canvas';

// The UI is the native-vega-tv layout (640x360 units, CSS px / 2). A Fire TV window is 960x540 dp at 1080p,
// so the whole app renders in that canvas scaled to the window: every CSS length lands at css * width / 1280.
export const App = () => {
  const {width, height} = useWindowDimensions();
  const scale = Math.min(width / CANVAS.width, height / CANVAS.height);
  return <View style={styles.root}>
    <View style={[styles.canvas, {left: (width - CANVAS.width) / 2, top: (height - CANVAS.height) / 2, transform: [{scale}]}]}>
      <SessionApp/>
    </View>
  </View>;
};

class SessionApp extends React.Component<object, {screen: 'companion' | 'demo' | 'import'; accessibility: AccessibilitySnapshot}> {
  state = {screen: 'companion' as 'companion' | 'demo' | 'import', accessibility: {} as AccessibilitySnapshot};
  private mounted = false;
  private settings = new Accessibility(accessibility => {if (this.mounted) this.setState({accessibility});});
  componentDidMount() {this.mounted = true; void this.settings.start();}
  componentWillUnmount() {this.mounted = false; this.settings.stop();}
  render() {
    const ready = () => undefined;
    return this.state.screen !== 'companion'
      ? <Player importMp4={this.state.screen === 'import'} onReady={ready} accessibility={this.state.accessibility} onCompanion={() => this.setState({screen: 'companion'})} />
      : <Companion onReady={ready} accessibility={this.state.accessibility} onDemo={() => this.setState({screen: 'demo'})} onImport={() => this.setState({screen: 'import'})} />;
  }
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#101114', overflow: 'hidden'},
  canvas: {position: 'absolute', width: CANVAS.width, height: CANVAS.height, overflow: 'hidden'},
});
