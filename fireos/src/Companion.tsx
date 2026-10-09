import React from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import type {AccessibilitySnapshot} from './Accessibility';
import {Backdrop, Pulse, Reveal, Rule, Words} from './Motion';
import {Button, accessibleText} from './ui';

export {Button, accessibleText};

// Landing. On Vega this discovered other apps' playback through Media Controls; Fire OS gives a regular app
// no access to other apps' media sessions, so after the same short check it reports discovery unavailable.
// ponytail: no session tiles or real-playback moments on Fire OS; port CompanionMoment from native-vega-tv
// if an Android notification-listener or partner integration ever exposes those sessions.
export class Companion extends React.Component<{onDemo: () => void; onImport: () => void; onReady: () => void; accessibility?: AccessibilitySnapshot}, {busy: boolean}> {
  state = {busy: true};
  private started = Date.now();
  private timer?: ReturnType<typeof setTimeout>;
  componentDidMount() {
    this.props.onReady();
    this.timer = setTimeout(() => this.setState({busy: false}), 900);
  }
  componentWillUnmount() {if (this.timer) clearTimeout(this.timer);}

  render() {
    const {busy} = this.state;
    const accessibility = this.props.accessibility;
    // A heading that changes mid-intro still lands on the intro's beat.
    const after = (ms: number) => Math.max(0, ms - (Date.now() - this.started));
    const heading = busy ? 'Checking playback' : 'Watch with Selene';
    return <View style={styles.page}>
      <Backdrop busy={busy}/>
      <ScrollView contentContainerStyle={styles.content}>
        <Reveal delay={150} dy={-14} style={styles.topbar}><View style={styles.logo}><Image source={require('../assets/selene-mark.png')} style={styles.mark}/><Text allowFontScaling={false} style={accessibleText(styles.brand, accessibility)}>selene</Text></View></Reveal>
        <View style={styles.main}>
          <Reveal delay={550} dy={10}><Text allowFontScaling={false} style={accessibleText(styles.eyebrow, accessibility)}>YOUR VIEWING COMPANION</Text></Reveal>
          <Words key={heading} text={heading} delay={after(750)} style={accessibleText(styles.heading, accessibility)}/>
          <Rule delay={1150}/>
          <Reveal delay={1300}><Text allowFontScaling={false} style={accessibleText(styles.tagline, accessibility)}>Ask about the moment you’re watching. Selene explains it, then steps aside.</Text></Reveal>
          <Reveal delay={1450} style={styles.status}><Pulse active={busy}/><Text allowFontScaling={false} style={accessibleText(styles.copy, accessibility)} accessibilityLiveRegion="polite">{busy ? 'Looking for shared playback.' : 'Playback discovery is unavailable. Watch a demo instead.'}</Text></Reveal>
          <View style={styles.actions}>
            <Reveal delay={1650}><Button accessibility={accessibility} label="Try the demo" preferred={!busy} onPress={this.props.onDemo}/></Reveal>
            <Reveal delay={1780}><Button accessibility={accessibility} label="Import MP4" onPress={this.props.onImport}/></Reveal>
          </View>
        </View>
      </ScrollView>
    </View>;
  }
}
const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#101114'}, content: {flexGrow: 1, paddingHorizontal: '6%', paddingVertical: '5%', gap: 12},
  topbar: {flexDirection: 'row', alignItems: 'center'}, logo: {flexDirection: 'row', alignItems: 'center', gap: 8}, mark: {width: 26, height: 26},
  brand: {fontSize: 24, fontWeight: '600', color: '#f1f1f1', letterSpacing: 0.5},
  main: {flex: 1, justifyContent: 'center', gap: 10},
  eyebrow: {fontSize: 11, lineHeight: 14, letterSpacing: 2.5, fontWeight: '600', color: '#b9bdc6'},
  heading: {fontSize: 34, lineHeight: 40, color: '#f1f1f1', fontWeight: '700', letterSpacing: -0.5},
  tagline: {fontSize: 16, lineHeight: 23, color: '#d6d9df', maxWidth: 330},
  status: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, maxWidth: 440},
  copy: {fontSize: 14, color: '#b9bdc6', lineHeight: 20, flexShrink: 1},
  actions: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14},
});
