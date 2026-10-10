// Shared native TV building blocks. Player screens port web/style.css on main: the WebView laid out at the
// device's 1280x720 CSS pixels, while native Vega lays out 640x360 density-independent units, so every CSS
// length goes through px() (CSS px / 2). The landing keeps its own animated Button.
import React from 'react';
import {Animated, DeviceEventEmitter, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useCanvas as useWindowDimensions} from './canvas';
import type {StyleProp, TextStyle, ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, Path, Rect, Stop} from 'react-native-svg';
import type {AccessibilitySnapshot} from './Accessibility';
import type {Line} from './api';
import {useFocusMotion} from './Motion';

export const px = (cssPixels: number) => cssPixels / 2;
export const palette = {page: '#101114', surface: '#202228', control: '#303238', field: '#191b20', border: '#737986', pressed: '#4c505a', pressedBorder: '#bcc1ce',
  ink: '#f1f1f1', muted: '#b9bdc6', accent: '#ffad33', orange: '#ff9900', alert: '#ffb5a7'};

export function accessibleText(style: TextStyle, settings?: AccessibilitySnapshot): TextStyle {
  const scale = settings?.textScale ?? 1;
  return {...style, fontSize: style.fontSize === undefined ? undefined : style.fontSize * scale,
    lineHeight: style.lineHeight === undefined ? undefined : style.lineHeight * scale,
    color: settings?.highContrast ? '#ffffff' : style.color};
}

// Landing-page button (src/Companion.tsx): spring lift and a warm light sweep on focus.
type ButtonProps = {label: string; detail?: string; onPress: () => void; disabled?: boolean; preferred?: boolean; tile?: boolean; accessibility?: AccessibilitySnapshot};
export function Button({label, detail, onPress, disabled = false, preferred = false, tile = false, accessibility}: ButtonProps) {
  const [focused, setFocused] = React.useState(false);
  const [width, setWidth] = React.useState(200);
  const {lift, sweep, focus} = useFocusMotion();
  return <Animated.View style={[tile ? styles.tileBox : styles.buttonBox, {transform: [{scale: lift.interpolate({inputRange: [0, 1], outputRange: [1, tile ? 1.04 : 1.07]})}]}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label} accessibilityState={{disabled}} disabled={disabled} hasTVPreferredFocus={preferred && !disabled}
      onFocus={() => {setFocused(true); focus(true);}} onBlur={() => {setFocused(false); focus(false);}} onPress={onPress} onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[styles.button, tile && styles.tile, focused && styles.focused, disabled && styles.disabled]}>
      {focused && <Animated.View pointerEvents="none" style={[styles.sheen, {transform: [{translateX: sweep.interpolate({inputRange: [0, 1], outputRange: [-48, width + 24]})}, {skewX: '-20deg'}]}]}/>}
      <Text allowFontScaling={false} numberOfLines={2} style={[accessibleText(tile ? styles.tileTitle : styles.buttonText, accessibility), focused && styles.focusedText]}>{label}</Text>
      {detail && <Text allowFontScaling={false} numberOfLines={2} style={[accessibleText(styles.tileDetail, accessibility), focused && styles.focusedText]}>{detail}</Text>}
    </Pressable>
  </Animated.View>;
}

// web/Brand.tsx Icon: 24-unit stroke icons drawn in the current text colour.
const iconPaths = {back: 'm15 5-7 7 7 7M8 12h13', settings: 'M4 7h16M4 17h16M9 4v6m6 4v6', send: 'm9 4 8 8-8 8M3 12h14', more: 'M4 6h16M4 12h16M4 18h16',
  play: 'm8 4 12 8-12 8Z', pause: 'M8 4v16M16 4v16', close: 'm6 6 12 12M18 6 6 18'};
export type IconName = keyof typeof iconPaths;
export function Icon({name, size, color}: {name: IconName; size: number; color: string}) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={iconPaths[name]} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></Svg>;
}
export function Mark({size}: {size: number}) {
  return <Svg width={size} height={size} viewBox="0 0 48 48"><Path d="M36 36A20 20 0 1 1 36 8 17 17 0 1 0 36 36Z" fill={palette.orange}/></Svg>;
}
// .wordmark: mark + lowercase name, gap .22em, weight 600, letter-spacing -.03em.
export function Wordmark({size, markOnly = false}: {size: number; markOnly?: boolean}) {
  return <View accessible accessibilityLabel="SELENE" style={[styles.row, {gap: size * 0.22}]}>
    <Mark size={size}/>{!markOnly && <Text allowFontScaling={false} style={[styles.wordmark, {fontSize: size, lineHeight: size * 1.15, letterSpacing: -0.03 * size}]}>selene</Text>}
  </View>;
}

// Button variants from web/style.css (sizes in CSS px): font, min-height, padding, radius, focus-ring offset, focus scale.
const variants = {
  sheet: {font: 16, height: 36, padV: 6, padH: 10, radius: 12, offset: 5, scale: 1.02},
  welcome: {font: 18, height: 40, padV: 8, padH: 12, radius: 8, offset: 5, scale: 1.02},
  ask: {font: 16, height: 34, padV: 5, padH: 8, radius: 6, offset: 1, scale: 1},
  toolbar: {font: 18, height: 36, padV: 6, padH: 10, radius: 12, offset: 1, scale: 1},
  toast: {font: 16, height: 32, padV: 5, padH: 5, radius: 8, offset: 1, scale: 1},
};
type ControlProps = {label?: string; icon?: IconName; detail?: string; onPress: () => void; variant?: keyof typeof variants; primary?: boolean; text?: boolean; pressed?: boolean;
  disabled?: boolean; preferred?: boolean; block?: boolean; square?: boolean; accessibilityLabel?: string; accessibility?: AccessibilitySnapshot; onFocus?: () => void};
export function Control({label, icon, detail, onPress, variant = 'sheet', primary = false, text = false, pressed, disabled = false, preferred = false, block = false, square = false,
  accessibilityLabel, accessibility, onFocus}: ControlProps) {
  const [focused, setFocused] = React.useState(false);
  const v = variants[variant];
  const font = px(v.font) * (accessibility?.textScale ?? 1);
  const color = focused || primary ? palette.page : text ? palette.muted : palette.ink;
  const background = focused ? palette.ink : primary ? palette.ink : pressed ? palette.pressed : text || square ? 'transparent' : palette.control;
  const box: ViewStyle = {minHeight: px(v.height), paddingVertical: px(v.padV), paddingHorizontal: px(square ? v.padV : v.padH), borderRadius: px(v.radius), backgroundColor: background,
    borderColor: pressed && !focused ? palette.pressedBorder : 'transparent', justifyContent: detail ? 'space-between' : 'center', ...(square ? {width: px(v.height)} : {})};
  return <View style={[block ? styles.block : styles.inline, {transform: [{scale: focused ? v.scale : 1}]}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? [label, detail].filter(Boolean).join(', ')}
      accessibilityState={{disabled, ...(pressed === undefined ? {} : {selected: pressed})}} disabled={disabled} hasTVPreferredFocus={preferred && !disabled}
      onFocus={() => {setFocused(true); onFocus?.();}} onBlur={() => setFocused(false)} onPress={onPress}
      style={[styles.control, box, disabled && styles.disabled]}>
      {focused && <View pointerEvents="none" style={[styles.ring, {top: -px(v.offset + 3), bottom: -px(v.offset + 3), left: -px(v.offset + 3), right: -px(v.offset + 3), borderRadius: px(v.radius + v.offset + 3)}]}/>}
      {icon && <Icon name={icon} size={font} color={color}/>}
      {label ? <Text allowFontScaling={false} numberOfLines={2} style={[styles.controlText, {fontSize: font, lineHeight: font * 1.3, color}]}>{label}</Text> : null}
      {detail ? <Text allowFontScaling={false} style={[styles.controlText, {fontSize: font, lineHeight: font * 1.3, color: focused ? palette.page : palette.muted}]}>{detail}</Text> : null}
    </Pressable>
  </View>;
}

// .app .sheet:not(.ask-sheet): bottom-right, width min(560px, 90%), padding 16px, radius 12px, surface.
export function Sheet({width = 560, padding = 16, label, children}: {width?: number; padding?: number; label?: string; children: React.ReactNode}) {
  return <View accessibilityLabel={label} style={[styles.sheet, {width: px(width)}]}>
    <ScrollView contentContainerStyle={{padding: px(padding)}}>{children}</ScrollView>
  </View>;
}
// .sheet-head: title left (h1 24px), actions right, gap 12px, margin-bottom 12px.
export function SheetHead({title, children, accessibility}: {title: string; children?: React.ReactNode; accessibility?: AccessibilitySnapshot}) {
  return <View style={styles.sheetHead}>
    <Text allowFontScaling={false} accessibilityRole="header" style={[accessibleText(styles.h1, accessibility), styles.grow]}>{title}</Text>
    <View style={styles.actions}>{children}</View>
  </View>;
}
export function Actions({children, style}: {children: React.ReactNode; style?: StyleProp<ViewStyle>}) {return <View style={[styles.actions, style]}>{children}</View>;}

// Text roles: p 18px, small 16px muted, h2 18px, alert.
export function P({children, muted = false, size = 18, style, accessibility, live}: {children: React.ReactNode; muted?: boolean; size?: number; style?: StyleProp<TextStyle>;
  accessibility?: AccessibilitySnapshot; live?: boolean}) {
  const font = px(size);
  return <Text allowFontScaling={false} accessibilityLiveRegion={live ? 'polite' : undefined}
    style={[accessibleText({fontSize: font, lineHeight: font * 1.45, color: muted ? palette.muted : palette.ink}, accessibility), style]}>{children}</Text>;
}
export function Alert({children, accessibility}: {children: React.ReactNode; accessibility?: AccessibilitySnapshot}) {
  return children ? <Text allowFontScaling={false} accessibilityLiveRegion="assertive" style={[accessibleText(styles.alert, accessibility)]}>{children}</Text> : null;
}

// textarea / input: #191b20, 2px #737986 border, radius 6px, padding 8px, 18px text; focus outline 3px offset 4px.
export function Field({value, onChange, placeholder, onSubmit, onLongPress, preferred, label, maxLength = 600, style, accessibility}: {value: string; onChange: (value: string) => void; placeholder: string;
  onSubmit?: () => void; onLongPress?: () => void; preferred?: boolean; label: string; maxLength?: number; style?: StyleProp<ViewStyle>; accessibility?: AccessibilitySnapshot}) {
  const [focused, setFocused] = React.useState(false);
  const pressTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (!onLongPress) return;
    const subscription = DeviceEventEmitter.addListener('SeleneQuestionLongPress', onLongPress);
    return () => {subscription.remove(); clearTimeout(pressTimer.current);};
  }, [onLongPress]);
  const font = px(18);
  return <View style={[styles.fieldBox, style]}>
    {focused && <View pointerEvents="none" style={styles.fieldRing}/>}
    <TextInput nativeID={onLongPress ? 'selene-voice-question' : undefined} accessibilityLabel={label}
      accessibilityHint={onLongPress ? 'Hold Select for voice recording; hold again to finish. Short Select opens the keyboard.' : undefined}
      accessibilityActions={onLongPress ? [{name: 'longpress', label: 'Start or finish voice recording'}] : undefined}
      onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'longpress') onLongPress?.();}}
      onPressIn={() => {if (onLongPress) pressTimer.current = setTimeout(onLongPress, 600);}}
      onPressOut={() => {clearTimeout(pressTimer.current); pressTimer.current = undefined;}}
      value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={palette.muted} maxLength={maxLength}
      hasTVPreferredFocus={preferred} returnKeyType="send" onSubmitEditing={onSubmit} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} allowFontScaling={false}
      style={[accessibleText({fontSize: font, lineHeight: font * 1.35, color: palette.ink}, accessibility), styles.field, focused && styles.fieldFocused]}/>
  </View>;
}

function useSpin() {
  const spin = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const motion = Animated.loop(Animated.timing(spin, {toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true}));
    motion.start();
    return () => motion.stop();
  }, [spin]);
  return spin.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
}
// .loading-panel: 44px square at top-right, a 40px button holding the rotating 26px mark.
export function LoadingPanel({onCancel, label = 'Cancel answer', inline = false}: {onCancel: () => void; label?: string; inline?: boolean}) {
  const rotate = useSpin();
  const [focused, setFocused] = React.useState(false);
  return <View style={inline ? styles.loadingInline : styles.loadingPanel}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} hasTVPreferredFocus onPress={onCancel} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[styles.loadingButton, focused && styles.loadingFocused]}>
      <Animated.View style={{transform: [{rotate}]}}><Mark size={px(26)}/></Animated.View>
    </Pressable>
  </View>;
}

// .welcome background: linear-gradient(90deg, #101114fa 0%, #101114e6 35%, #10111433 80%, transparent).
// Sized from the window: a percentage-height Svg inside the padded welcome view stops short on Vega.
export function WelcomeShade() {
  const {width, height} = useWindowDimensions();
  return <Svg style={styles.shade} width={width} height={height} preserveAspectRatio="none" viewBox="0 0 100 100">
    <Defs><LinearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <Stop offset="0" stopColor={palette.page} stopOpacity={0.98}/><Stop offset="0.35" stopColor={palette.page} stopOpacity={0.9}/>
      <Stop offset="0.8" stopColor={palette.page} stopOpacity={0.2}/><Stop offset="1" stopColor={palette.page} stopOpacity={0}/>
    </LinearGradient></Defs>
    <Rect x="0" y="0" width="100" height="100" fill="url(#shade)"/>
  </Svg>;
}

// .captions: bottom 8%, left/right 17%, #101114ed, padding 14px 24px, radius 6px, clamp(26px, 2.2vw, 42px) = 28.16px at 1280, line-height 1.35.
// Vega caption preferences override colour, size, font and opacity like web/accessibility.ts captionStyle.
export function Captions({line, accessibility}: {line: Line | undefined; accessibility?: AccessibilitySnapshot}) {
  if (!line) return null;
  const p = (accessibility?.captionPreferences ?? {}) as Record<string, string>;
  const sizes: Record<string, number> = {very_small: 0.75, small: 0.875, normal: 1, large: 1.25, very_large: 1.5};
  const colors: Record<string, string> = {white: '#ffffff', black: '#000000', red: '#ff0000', green: '#00ff00', blue: '#0000ff', yellow: '#ffff00', magenta: '#ff00ff', cyan: '#00ffff'};
  const opacity = (key: string, fallback = 1) => ({percent_25: 0.25, percent_50: 0.5, percent_75: 0.75, percent_100: 1} as Record<string, number>)[key] ?? fallback;
  const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;
  const size = px(28.16) * (accessibility?.textScale ?? 1) * (sizes[p.textSize] ?? 1);
  const box = {backgroundColor: rgba(colors[p.backgroundColor] ?? palette.page, opacity(p.backgroundOpacity, 0.93))};
  const text = {fontSize: size, lineHeight: size * 1.35, color: rgba(colors[p.textColor] ?? '#ffffff', opacity(p.textOpacity)),
    fontFamily: p.textFont?.startsWith('monospace') ? 'monospace' : p.textFont === 'serif' ? 'serif' : undefined};
  return <View pointerEvents="none" style={[styles.captions, box]}>
    <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={[styles.captionText, text]}>{line.text}</Text>
  </View>;
}

export const styles = StyleSheet.create({
  buttonBox: {alignSelf: 'flex-start', maxWidth: '100%'}, tileBox: {flex: 1, minWidth: 160},
  button: {overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', borderRadius: 10, backgroundColor: palette.control, paddingVertical: 12, paddingHorizontal: 22},
  sheen: {position: 'absolute', top: -12, bottom: -12, left: 0, width: 30, backgroundColor: 'rgba(255,153,0,0.24)'},
  tile: {flexGrow: 1, minHeight: 84, justifyContent: 'space-between', padding: 16, gap: 12}, tileTitle: {fontSize: 22, fontWeight: '600', color: palette.ink}, tileDetail: {fontSize: 16, color: palette.muted},
  focused: {borderColor: palette.ink, backgroundColor: palette.ink}, focusedText: {color: palette.page}, disabled: {opacity: 0.42},
  buttonText: {fontSize: 18, color: palette.ink, fontWeight: '500'},
  row: {flexDirection: 'row', alignItems: 'center'},
  grow: {flex: 1},
  wordmark: {fontWeight: '600', color: palette.ink},
  inline: {alignSelf: 'flex-start', maxWidth: '100%'}, block: {alignSelf: 'stretch'},
  control: {flexDirection: 'row', alignItems: 'center', gap: px(8), borderWidth: px(2)},
  controlText: {fontWeight: '500', textAlign: 'center'},
  ring: {position: 'absolute', borderWidth: px(3), borderColor: palette.ink},
  sheet: {position: 'absolute', right: '5%', bottom: '5%', maxWidth: '90%', maxHeight: '78%', backgroundColor: palette.surface, borderRadius: px(12)},
  sheetHead: {flexDirection: 'row', alignItems: 'center', gap: px(12), marginBottom: px(12)},
  h1: {fontSize: px(24), lineHeight: px(24) * 1.14, fontWeight: '600', letterSpacing: -0.025 * px(24), color: palette.ink},
  actions: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: px(8)},
  alert: {fontSize: px(18), lineHeight: px(18) * 1.45, color: palette.alert, marginTop: px(11)},
  fieldBox: {position: 'relative'},
  fieldRing: {position: 'absolute', top: -px(7), bottom: -px(7), left: -px(7), right: -px(7), borderRadius: px(13), borderWidth: px(3), borderColor: palette.ink},
  field: {backgroundColor: palette.field, borderWidth: px(2), borderColor: palette.border, borderRadius: px(6), paddingHorizontal: px(8), paddingVertical: px(8)},
  fieldFocused: {borderColor: palette.ink},
  loadingPanel: {position: 'absolute', top: '5%', right: '5%', width: px(44), height: px(44), borderRadius: px(12), backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center'},
  loadingInline: {alignSelf: 'flex-start'},
  loadingButton: {width: px(40), height: px(40), borderRadius: px(12), alignItems: 'center', justifyContent: 'center', borderWidth: px(2), borderColor: 'transparent'},
  loadingFocused: {backgroundColor: palette.ink, borderColor: palette.ink},
  shade: {position: 'absolute', left: 0, top: 0},
  captions: {position: 'absolute', bottom: '8%', left: '17%', right: '17%', paddingVertical: px(14), paddingHorizontal: px(24), borderRadius: px(6)},
  captionText: {textAlign: 'center'},
});
