import React from 'react';
import {useHideSplashScreenCallback, usePreventHideSplashScreen} from '@amazon-devices/react-native-kepler';
import {Companion} from './Companion';
import {Player} from './Player';
import {Accessibility, type AccessibilitySnapshot} from './Accessibility';

export const App = () => {
  usePreventHideSplashScreen();
  const hideSplash = useHideSplashScreenCallback();
  return <SessionApp onReady={hideSplash} />;
};

// Fully native: Companion discovers real playback apps; Player hosts the demo films and imports.
class SessionApp extends React.Component<{onReady: () => void}, {screen: 'companion' | 'demo' | 'import'; accessibility: AccessibilitySnapshot}> {
  state = {screen: 'companion' as 'companion' | 'demo' | 'import', accessibility: {} as AccessibilitySnapshot};
  private mounted = false;
  private settings = new Accessibility(accessibility => {if (this.mounted) this.setState({accessibility});});
  componentDidMount() {this.mounted = true; void this.settings.start();}
  componentWillUnmount() {this.mounted = false; this.settings.stop();}
  render() {
    return this.state.screen !== 'companion'
      ? <Player importMp4={this.state.screen === 'import'} onReady={this.props.onReady} accessibility={this.state.accessibility} onCompanion={() => this.setState({screen: 'companion'})} />
      : <Companion onReady={this.props.onReady} accessibility={this.state.accessibility} onDemo={() => this.setState({screen: 'demo'})} onImport={() => this.setState({screen: 'import'})} />;
  }
}
