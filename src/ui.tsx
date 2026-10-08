// Shared native TV building blocks: buttons, panels, text fields, captions and the loading mark.
import React from 'react';
import {Animated, Easing, Image, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import type {StyleProp, TextStyle, ViewStyle} from 'react-native';
import type {AccessibilitySnapshot} from './Accessibility';
import type {Line} from './api';
import {useFocusMotion} from './Motion';

export const palette = {page: '#101114', surface: '#202228', control: '#303238', ink: '#f1f1f1', muted: '#b9bdc6', orange: '#ff9900'};

export function accessibleText(style: TextStyle, settings?: AccessibilitySnapshot): TextStyle {
  const scale = settings?.textScale ?? 1;
  return {...style, fontSize: style.fontSize === undefined ? undefined : style.fontSize * scale,
    lineHeight: style.lineHeight === undefined ? undefined : style.lineHeight * scale,
    color: settings?.highContrast ? '#ffffff' : style.color};
}

type ButtonProps = {label: string; detail?: string; onPress: () => void; disabled?: boolean; preferred?: boolean; tile?: boolean; primary?: boolean; small?: boolean;
  pressed?: boolean; mark?: boolean; accessibilityLabel?: string; accessibility?: AccessibilitySnapshot};
export function Button({label, detail, onPress, disabled = false, preferred = false, tile = false, primary = false, small = false, pressed, mark = false, accessibilityLabel, accessibility}: ButtonProps) {
  const [focused, setFocused] = React.useState(false);
  const [width, setWidth] = React.useState(200);
  const {lift, sweep, focus} = useFocusMotion();
  const text = tile ? styles.tileTitle : small ? styles.smallText : styles.buttonText;
  return <Animated.View style={[tile ? styles.tileBox : styles.buttonBox, {transform: [{scale: lift.interpolate({inputRange: [0, 1], outputRange: [1, tile ? 1.04 : 1.07]})}]}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (detail ? `${label}, ${detail}` : label)}
      accessibilityState={{disabled, ...(pressed === undefined ? {} : {selected: pressed})}} disabled={disabled} hasTVPreferredFocus={preferred && !disabled}
      onFocus={() => {setFocused(true); focus(true);}} onBlur={() => {setFocused(false); focus(false);}} onPress={onPress} onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[styles.button, small && styles.small, tile && styles.tile, (primary || pressed) && styles.primary, focused && styles.focused, disabled && styles.disabled]}>
      {focused && <Animated.View pointerEvents="none" style={[styles.sheen, {transform: [{translateX: sweep.interpolate({inputRange: [0, 1], outputRange: [-48, width + 24]})}, {skewX: '-20deg'}]}]}/>}
      {mark ? <View style={styles.markRow}><Image source={require('../assets/selene-mark.png')} style={styles.mark}/>{label ? <Text allowFontScaling={false} style={[accessibleText(text, accessibility), focused && styles.focusedText]}>{label}</Text> : null}</View>
        : <Text allowFontScaling={false} numberOfLines={2} style={[accessibleText(text, accessibility), (focused || primary || pressed) && styles.focusedText]}>{label}</Text>}
      {detail && <Text allowFontScaling={false} numberOfLines={2} style={[accessibleText(styles.tileDetail, accessibility), (focused || primary) && styles.focusedText]}>{detail}</Text>}
    </Pressable>
  </Animated.View>;
}

// A TV panel. `place` positions it over the film: side sheet, top-right answer toast, or centred dialog.
export function Panel({place = 'side', label, children, style}: {place?: 'side' | 'toast' | 'center'; label?: string; children: React.ReactNode; style?: StyleProp<ViewStyle>}) {
  return <View accessibilityLabel={label} style={[styles.panel, place === 'side' ? styles.side : place === 'toast' ? styles.toast : styles.center, style]}>{children}</View>;
}

export function Heading({children, accessibility}: {children: React.ReactNode; accessibility?: AccessibilitySnapshot}) {
  return <Text allowFontScaling={false} accessibilityRole="header" style={accessibleText(styles.heading, accessibility)}>{children}</Text>;
}
export function Body({children, muted = false, small = false, compact = false, accessibility, live}: {children: React.ReactNode; muted?: boolean; small?: boolean; compact?: boolean; accessibility?: AccessibilitySnapshot; live?: boolean}) {
  return <Text allowFontScaling={false} accessibilityLiveRegion={live ? 'polite' : undefined}
    style={accessibleText(small ? styles.small_ : muted ? styles.muted : compact ? styles.compact : styles.body, accessibility)}>{children}</Text>;
}
export function Row({children}: {children: React.ReactNode}) {return <View style={styles.row}>{children}</View>;}

export function Field({value, onChange, placeholder, onSubmit, preferred, label, editable = true, maxLength = 600, accessibility}: {value: string; onChange: (value: string) => void; placeholder: string;
  onSubmit?: () => void; preferred?: boolean; label: string; editable?: boolean; maxLength?: number; accessibility?: AccessibilitySnapshot}) {
  const [focused, setFocused] = React.useState(false);
  return <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#8a8f99" maxLength={maxLength}
    editable={editable} hasTVPreferredFocus={preferred} returnKeyType="send" onSubmitEditing={onSubmit} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    allowFontScaling={false} style={[accessibleText(styles.field, accessibility), focused && styles.fieldFocused]}/>;
}

export function Brand({size = 22}: {size?: number}) {
  return <View style={styles.brandRow}><Image source={require('../assets/selene-mark.png')} style={{width: size, height: size}}/>
    <Text allowFontScaling={false} style={[styles.brand, {fontSize: size * 0.9}]}>selene</Text></View>;
}

export function LoadingMark({onCancel, label = 'Cancel answer'}: {onCancel: () => void; label?: string}) {
  const spin = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const motion = Animated.loop(Animated.timing(spin, {toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true}));
    motion.start();
    return () => motion.stop();
  }, [spin]);
  const [focused, setFocused] = React.useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} hasTVPreferredFocus onPress={onCancel} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[styles.loading, focused && styles.loadingFocused]}>
    <Animated.Image source={require('../assets/selene-mark.png')} style={[styles.loadingMark, {transform: [{rotate: spin.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]}]}/>
  </Pressable>;
}

// Native caption overlay following the Vega caption preferences, like web/accessibility.ts captionStyle.
export function Captions({line, accessibility}: {line: Line | undefined; accessibility?: AccessibilitySnapshot}) {
  if (!line) return null;
  const p = (accessibility?.captionPreferences ?? {}) as Record<string, string>;
  const sizes: Record<string, number> = {very_small: 0.75, small: 0.875, normal: 1, large: 1.25, very_large: 1.5};
  const colors: Record<string, string> = {white: '#ffffff', black: '#000000', red: '#ff0000', green: '#00ff00', blue: '#0000ff', yellow: '#ffff00', magenta: '#ff00ff', cyan: '#00ffff'};
  const opacity = (key: string) => ({percent_25: 0.25, percent_50: 0.5, percent_75: 0.75} as Record<string, number>)[key] ?? 1;
  const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;
  const size = 20 * (accessibility?.textScale ?? 1) * (sizes[p.textSize] ?? 1);
  return <View pointerEvents="none" style={styles.captionBox}>
    {/* eslint-disable-next-line react-native/no-inline-styles -- follows the viewer's live Vega caption preferences */}
    <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={[styles.caption, {fontSize: size, lineHeight: size * 1.3,
      color: rgba(colors[p.textColor] ?? '#ffffff', opacity(p.textOpacity)), backgroundColor: rgba(colors[p.backgroundColor] ?? '#101114', opacity(p.backgroundOpacity)),
      fontFamily: p.textFont?.startsWith('monospace') ? 'monospace' : p.textFont === 'serif' ? 'serif' : undefined}]}>{line.text}</Text>
  </View>;
}

export const styles = StyleSheet.create({
  buttonBox: {alignSelf: 'flex-start', maxWidth: '100%'}, tileBox: {flex: 1, minWidth: 160},
  button: {overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', borderRadius: 10, backgroundColor: palette.control, paddingVertical: 12, paddingHorizontal: 22},
  small: {paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8},
  primary: {backgroundColor: palette.ink},
  sheen: {position: 'absolute', top: -12, bottom: -12, left: 0, width: 30, backgroundColor: 'rgba(255,153,0,0.24)'},
  tile: {flexGrow: 1, minHeight: 84, justifyContent: 'space-between', padding: 16, gap: 12}, tileTitle: {fontSize: 22, fontWeight: '600', color: palette.ink}, tileDetail: {fontSize: 16, color: palette.muted},
  focused: {borderColor: palette.ink, backgroundColor: palette.ink}, focusedText: {color: palette.page}, disabled: {opacity: 0.45},
  buttonText: {fontSize: 18, color: palette.ink, fontWeight: '500'}, smallText: {fontSize: 15, color: palette.ink, fontWeight: '500'},
  panel: {position: 'absolute', backgroundColor: 'rgba(32,34,40,0.96)', borderRadius: 14, padding: 18, gap: 12},
  side: {right: '5%', top: '7%', bottom: '7%', width: 360},
  toast: {right: '5%', top: '7%', width: 460},
  center: {left: '25%', right: '25%', top: '25%'},
  heading: {fontSize: 22, lineHeight: 28, fontWeight: '700', color: palette.ink},
  body: {fontSize: 16, lineHeight: 22, color: palette.ink}, compact: {fontSize: 14, lineHeight: 20, color: palette.ink},
  muted: {fontSize: 15, lineHeight: 21, color: palette.muted},
  small_: {fontSize: 13, lineHeight: 18, color: palette.muted},
  row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10},
  field: {fontSize: 17, color: palette.ink, backgroundColor: palette.page, borderRadius: 10, borderWidth: 2, borderColor: palette.control, paddingHorizontal: 14, paddingVertical: 10},
  fieldFocused: {borderColor: palette.ink},
  brandRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  markRow: {flexDirection: 'row', alignItems: 'center', gap: 6}, mark: {width: 24, height: 24},
  brand: {fontWeight: '600', color: palette.ink, letterSpacing: 0.5},
  loading: {alignSelf: 'center', padding: 14, borderRadius: 40, borderWidth: 2, borderColor: 'transparent', backgroundColor: 'rgba(32,34,40,0.9)'},
  loadingFocused: {borderColor: palette.ink},
  loadingMark: {width: 40, height: 40},
  captionBox: {position: 'absolute', left: '17%', right: '17%', bottom: '8%', alignItems: 'center'},
  caption: {textAlign: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6, overflow: 'hidden'},
});
