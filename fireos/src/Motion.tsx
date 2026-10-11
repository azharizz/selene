import React from 'react';
import {AccessibilityInfo, Animated, Easing, StyleSheet, View} from 'react-native';
import {useCanvas as useWindowDimensions} from './canvas';
import type {StyleProp, TextStyle, ViewStyle} from 'react-native';

// Landing-page motion uses shared native-driver loops for ambient effects and small one-shot intro animations.
export const orange = '#ff9900';
const ink = '#f1f1f1';
const out = Easing.out(Easing.cubic);
const N = 24;
const steps = Array.from({length: N + 1}, (_, i) => i / N);
// Piecewise-linear sampling of a periodic curve, so the native driver can follow it.
const curve = (fn: (angle: number) => number) => ({inputRange: steps, outputRange: steps.map(s => fn(s * Math.PI * 2))});

let reduced: Promise<boolean> | null = null;
// Vega may not implement the query; absence means full motion.
function reduceMotion() {
  if (!reduced) reduced = Promise.resolve().then(() => AccessibilityInfo.isReduceMotionEnabled()).then(Boolean, () => false);
  return reduced;
}

function useDriver(run: (value: Animated.Value) => Animated.CompositeAnimation) {
  const value = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    let alive = true;
    const animation = run(value);
    void reduceMotion().then(reduce => {
      if (!alive) return;
      if (reduce) value.setValue(1); else animation.start();
    });
    return () => {alive = false; animation.stop();};
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}
const once = (delay: number, duration: number, easing = out) => (v: Animated.Value) => Animated.timing(v, {toValue: 1, delay, duration, easing, useNativeDriver: true});
const loop = (duration: number) => (v: Animated.Value) => Animated.loop(Animated.timing(v, {toValue: 1, duration, easing: Easing.linear, useNativeDriver: true}));
const lerp = (v: Animated.Value | Animated.AnimatedInterpolation<number>, from: number, to: number) => v.interpolate({inputRange: [0, 1], outputRange: [from, to]});

export function Reveal({delay = 0, duration = 700, dy = 18, style, children}: {delay?: number; duration?: number; dy?: number; style?: StyleProp<ViewStyle>; children: React.ReactNode}) {
  const t = useDriver(once(delay, duration));
  return <Animated.View style={[style, {opacity: t, transform: [{translateY: lerp(t, dy, 0)}]}]}>{children}</Animated.View>;
}

// Words rise one after another; the group still reads as one header.
export function Words({text, delay = 0, style}: {text: string; delay?: number; style: TextStyle}) {
  return <View accessible accessibilityRole="header" accessibilityLabel={text} style={styles.words}>
    {text.split(' ').map((word, i) => <Reveal key={i} delay={delay + i * 110} duration={760} dy={(style.fontSize ?? 32) * 0.6}>
      <Animated.Text allowFontScaling={false} style={[style, {marginRight: (style.fontSize ?? 32) * 0.26}]}>{word}</Animated.Text>
    </Reveal>)}
  </View>;
}

export function Rule({delay = 0}: {delay?: number}) {
  const t = useDriver(once(delay, 900));
  return <Animated.View style={[styles.rule, {opacity: t, transform: [{translateX: lerp(t, -20, 0)}, {scaleX: t}]}]}/>;
}

export function Pulse({active}: {active: boolean}) {
  return active ? <PulseDot/> : <View style={[styles.dot, styles.idleDot]}/>;
}
function PulseDot() {
  const t = useDriver(loop(1400));
  return <View style={styles.dotBox}>
    <Animated.View style={[styles.dot, styles.ping, {opacity: lerp(t, 0.7, 0), transform: [{scale: lerp(t, 1, 2.8)}]}]}/>
    <View style={styles.dot}/>
  </View>;
}

// Deterministic stars animate as three shared twinkle groups.
const rand = (i: number, salt: number) => {const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x);};
// Most stars sit right of the text column; the rest in the top and bottom margins, so none read as specks on type.
const STARS = Array.from({length: 42}, (_, i) => ({left: `${i % 4 ? 52 + rand(i, 1) * 48 : rand(i, 1) * 100}%` as const,
  top: `${i % 4 ? rand(i, 2) * 100 : i % 8 ? rand(i, 2) * 6 : 94 + rand(i, 2) * 6}%` as const,
  size: rand(i, 3) > 0.85 ? 2 : rand(i, 3) > 0.45 ? 1.5 : 1, opacity: 0.25 + rand(i, 4) * 0.6, group: i % 3}));
const TWINKLE = [[1, 0.35, 1, 0.6, 1, 0.3, 1], [0.4, 1, 0.5, 1, 0.35, 1, 0.4], [0.7, 0.5, 1, 0.3, 0.9, 1, 0.7]];

function Meteor({t, width}: {t: Animated.Value; width: number}) {
  return <Animated.View style={[styles.meteor, {opacity: t.interpolate({inputRange: [0, 0.6, 0.62, 0.68, 0.71, 1], outputRange: [0, 0, 1, 1, 0, 0]}),
    transform: [{rotate: '16deg'}, {translateX: t.interpolate({inputRange: [0, 0.6, 0.71, 1], outputRange: [0, 0, width * 0.26, width * 0.26]})}]}]}>
    <View style={[styles.trail, {width: 40, opacity: 0.12}]}/><View style={[styles.trail, {width: 28, opacity: 0.35}]}/><View style={[styles.trail, {width: 14, opacity: 0.9}]}/>
  </Animated.View>;
}

export function Backdrop({busy}: {busy: boolean}) {
  const {width, height} = useWindowDimensions();
  const intro = useDriver(once(0, 2600, Easing.linear));
  const ambient = useDriver(loop(9000));
  const drift = useDriver(loop(14000));
  // Satellites keep a single eased lap; background drift uses its own shared loop.
  const spin = useDriver(once(1800, 6000, Easing.inOut(Easing.cubic)));
  const D = Math.round(Math.min(height * 0.3, width * 0.17));
  const S = D * 3.4;
  const at = (start: number, end: number, from: number, to: number) => intro.interpolate({inputRange: [start, end], outputRange: [from, to], extrapolate: 'clamp'});
  // Intro timeline (0..1 over 2.6s): stars, new-moon eclipse ring, waxing crescent, halo, orbits.
  const phase = intro.interpolate({inputRange: [0, 0.12, 0.25, 0.4, 0.55, 0.7], outputRange: [0, 0, 0.18, 0.55, 0.88, 1], extrapolate: 'clamp'});
  const circle = (size: number): ViewStyle => ({position: 'absolute', left: (S - size) / 2, top: (S - size) / 2, width: size, height: size, borderRadius: size / 2});
  const orbit = (w: number, flat: number, tilt: string, front: boolean) => <View style={[circle(w), {borderRadius: 0, transform: [{rotate: tilt}]}]}>
    <View style={front ? {position: 'absolute', left: 0, top: w / 2, width: w, height: w / 2, overflow: 'hidden'} : StyleSheet.absoluteFill}>
      <View style={{position: 'absolute', left: 0, top: front ? -w / 2 : 0, width: w, height: w, borderRadius: w / 2, borderWidth: 1.5, borderColor: 'rgba(241,241,241,0.16)', transform: [{scaleY: flat}]}}/>
    </View>
  </View>;
  const satellite = (w: number, flat: number, tilt: string, size: number, offset: number, reverse = false) => {
    const angle = (a: number) => (reverse ? -a : a) + offset;
    const depth = (a: number) => (Math.sin(angle(a)) + 1) / 2;
    return <View style={[circle(w), {borderRadius: 0, transform: [{rotate: tilt}]}]}>
      <Animated.View style={{position: 'absolute', left: w / 2 - size / 2, top: w / 2 - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: ink,
        opacity: spin.interpolate(curve(a => Math.max(0, Math.min(1, (Math.sin(angle(a)) + 0.55) / 1.2)))),
        transform: [{translateX: spin.interpolate(curve(a => Math.cos(angle(a)) * w / 2))}, {translateY: spin.interpolate(curve(a => Math.sin(angle(a)) * w / 2 * flat))},
          {scale: spin.interpolate(curve(a => 0.6 + depth(a) * 0.6))}]}}/>
    </View>;
  };
  const orbits = at(0.35, 0.75, 0, 1);
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Animated.View style={[StyleSheet.absoluteFill, {opacity: at(0, 0.3, 0, 1), transform: [{translateX: drift.interpolate({inputRange: [0, 0.5, 1], outputRange: [0, -12, 0]})}]}]}>
      {[0, 1, 2].map(group => <Animated.View key={group} style={[StyleSheet.absoluteFill, {opacity: ambient.interpolate({inputRange: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1], outputRange: TWINKLE[group]})}]}>
        {STARS.filter(star => star.group === group).map((star, i) => <View key={i} style={{position: 'absolute', left: star.left, top: star.top, width: star.size, height: star.size, borderRadius: star.size, backgroundColor: ink, opacity: star.opacity}}/>)}
      </Animated.View>)}
      <Meteor t={ambient} width={width}/>
    </Animated.View>
    <Animated.View style={{position: 'absolute', left: width * 0.75 - S / 2, top: height * 0.5 - S / 2, width: S, height: S,
      transform: [{translateY: drift.interpolate(curve(a => Math.sin(a * 2) * 3))}]}}>
      <Animated.View style={[StyleSheet.absoluteFill, {opacity: at(0.2, 0.7, 0, 1), transform: [{scale: at(0.2, 0.8, 0.55, 1)}, {scale: ambient.interpolate(curve(a => 1 + Math.sin(a) * 0.04))}]}]}>
        {[[3.2, 0.025], [2.6, 0.035], [2, 0.05], [1.5, 0.07]].map(([k, alpha], i) => <View key={i} style={[circle(D * k), {backgroundColor: orange, opacity: alpha}]}/>)}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, {opacity: orbits, transform: [{scale: at(0.35, 0.8, 0.85, 1)}]}]}>
        {orbit(D * 2.5, 0.24, '-14deg', false)}{orbit(D * 2.95, 0.18, '9deg', false)}
      </Animated.View>
      <Animated.View style={[circle(D), styles.moon, {opacity: at(0, 0.18, 0, 1), transform: [{scale: at(0, 0.6, 0.82, 1)}]}]}>
        <View style={{position: 'absolute', left: -D * 0.1, top: -D * 0.08, width: D * 0.9, height: D * 0.9, borderRadius: D, backgroundColor: '#ffa726'}}/>
        {[[0.16, 0.38, 0.13], [0.3, 0.64, 0.09], [0.12, 0.6, 0.06]].map(([x, y, r], i) => <View key={i} style={{position: 'absolute', left: D * x, top: D * y, width: D * r, height: D * r, borderRadius: D * r, backgroundColor: '#e07f00', opacity: 0.55}}/>)}
        <Animated.View style={{position: 'absolute', left: D * 0.015, top: D * 0.015, width: D * 0.97, height: D * 0.97, borderRadius: D, backgroundColor: '#17181d',
          transform: [{translateX: lerp(phase, 0, D * 0.3)}, {translateY: lerp(phase, 0, -D * 0.07)}]}}/>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, {opacity: orbits}]}>
        {orbit(D * 2.5, 0.24, '-14deg', true)}{orbit(D * 2.95, 0.18, '9deg', true)}
        {satellite(D * 2.5, 0.24, '-14deg', 5, 0.6)}{satellite(D * 2.95, 0.18, '9deg', 4, 2.8, true)}
      </Animated.View>
      {busy && <Scan size={D} style={circle(D * 1.36)}/>}
    </Animated.View>
  </View>;
}

function Scan({size, style}: {size: number; style: ViewStyle}) {
  const t = useDriver(loop(1300));
  const fade = useDriver(once(0, 400));
  return <Animated.View style={[StyleSheet.absoluteFill, {opacity: fade}]}>
    <Animated.View style={[style, styles.arc, {transform: [{rotate: t.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]}]}/>
    <Animated.View style={[style, {borderWidth: 1.5, borderColor: orange, opacity: lerp(t, 0.5, 0), transform: [{scale: lerp(t, size / (style.width as number), 1.5)}]}]}/>
  </Animated.View>;
}

// TV focus: a spring lift plus one warm light sweep across the button.
export function useFocusMotion() {
  const lift = React.useRef(new Animated.Value(0)).current;
  const sweep = React.useRef(new Animated.Value(0)).current;
  const focus = React.useCallback((focused: boolean) => {
    Animated.spring(lift, {toValue: focused ? 1 : 0, friction: 6, tension: 140, useNativeDriver: true}).start();
    if (focused) {sweep.setValue(0); Animated.timing(sweep, {toValue: 1, duration: 650, delay: 80, easing: Easing.inOut(Easing.quad), useNativeDriver: true}).start();}
  }, [lift, sweep]);
  return {lift, sweep, focus};
}

const styles = StyleSheet.create({
  words: {flexDirection: 'row', flexWrap: 'wrap', maxWidth: 360},
  rule: {width: 40, height: 2, borderRadius: 1, backgroundColor: orange},
  dotBox: {width: 6, height: 6},
  dot: {width: 6, height: 6, borderRadius: 3, backgroundColor: orange},
  idleDot: {backgroundColor: '#6c707a'},
  ping: {position: 'absolute', left: 0, top: 0},
  meteor: {position: 'absolute', left: '50%', top: '4%', flexDirection: 'row', alignItems: 'center'},
  trail: {height: 1, backgroundColor: ink, borderRadius: 1},
  moon: {backgroundColor: orange, overflow: 'hidden'},
  arc: {borderWidth: 1.5, borderColor: 'transparent', borderTopColor: orange, borderRightColor: 'rgba(255,153,0,0.35)'},
});
