// Native renderer for the server-validated answer SVG (server/visual.mjs whitelist) and its looping
// keyframe animations, mirroring server/visual-page.mjs: ease-out, fill both, initial delay, infinite,
// evenly spaced keyframes, CSS transform (origin 0 0) replacing the element's own transform.
import React from 'react';
import {AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View} from 'react-native';
import Svg, {Circle, Ellipse, G, Line, Path, Polygon, Polyline, Rect, Text as SvgText, TSpan} from 'react-native-svg';
import {DOMParser} from '@xmldom/xmldom';
import type {Animation, VisualArtifact} from './api';
import {palette, px} from './ui';

const AnimatedG = Animated.createAnimatedComponent(G);
const components: Record<string, React.ComponentType<any>> = {
  g: G, rect: Rect, circle: Circle, ellipse: Ellipse, line: Line, polyline: Polyline, polygon: Polygon, path: Path, text: SvgText, tspan: TSpan,
};
const camel = (name: string) => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

type Pose = {opacity: number; translateX: number; translateY: number; scaleX: number; scaleY: number; rotation: number};
export function pose(keyframe: {opacity?: number; transform?: string}): Pose {
  const result: Pose = {opacity: keyframe.opacity ?? 1, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0};
  for (const [, name, a, unit, b] of (keyframe.transform ?? '').matchAll(/(translate|scale|rotate)\(\s*([-+.\d e]+)(px|deg|rad|turn)?\s*(?:,\s*([-+.\d e]+)(?:px)?\s*)?\)/g)) {
    const first = Number(a), second = b === undefined ? undefined : Number(b);
    if (name === 'translate') {result.translateX += first; result.translateY += second ?? 0;}
    if (name === 'scale') {result.scaleX *= first; result.scaleY *= second ?? first;}
    if (name === 'rotate') result.rotation += unit === 'rad' ? first * 180 / Math.PI : unit === 'turn' ? first * 360 : first;
  }
  // ponytail: skewX/skewY keyframes render unskewed; add a matrix prop if generated visuals start relying on skew.
  return result;
}

function KeyframeGroup({animation, children}: {animation: Animation; children: React.ReactNode}) {
  const t = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const motion = Animated.sequence([Animated.delay(animation.delay_ms),
      Animated.loop(Animated.timing(t, {toValue: 1, duration: animation.duration_ms, easing: Easing.bezier(0, 0, 0.58, 1), useNativeDriver: false}))]);
    motion.start();
    return () => motion.stop();
  }, [animation, t]);
  const poses = animation.keyframes.map(pose);
  const inputRange = poses.map((_, i) => poses.length > 1 ? i / (poses.length - 1) : 0);
  const track = (key: keyof Pose) => poses.length > 1 ? t.interpolate({inputRange, outputRange: poses.map(value => value[key])}) : poses[0][key];
  return <AnimatedG opacity={track('opacity')} translateX={track('translateX')} translateY={track('translateY')}
    scaleX={track('scaleX')} scaleY={track('scaleY')} rotation={track('rotation')}>{children}</AnimatedG>;
}

function build(node: Element, animations: Map<string, Animation>, key: string): React.ReactNode {
  const tag = node.nodeName;
  const Component = components[tag];
  if (!Component) return null;
  const id = node.getAttribute('id') ?? '';
  const animation = animations.get(id);
  const props: Record<string, string> = {};
  for (let i = 0; i < node.attributes.length; i++) {
    const {name, value} = node.attributes[i];
    if (['id', 'role', 'aria-label', 'xmlns'].includes(name) || (animation && name === 'transform')) continue;
    props[camel(name)] = value;
  }
  const children: React.ReactNode[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 1) children.push(build(child as Element, animations, `${key}.${i}`));
    else if (child.nodeType === 3 && (tag === 'text' || tag === 'tspan') && child.nodeValue?.trim()) children.push(child.nodeValue);
  }
  const element = <Component key={key} {...props}>{children}</Component>;
  return animation ? <KeyframeGroup key={key} animation={animation}>{element}</KeyframeGroup> : element;
}

export function parseVisual(visual: VisualArtifact, animate: boolean) {
  const root = new DOMParser().parseFromString(visual.svg, 'image/svg+xml').documentElement;
  if (!root || root.nodeName !== 'svg') return null;
  const animations = new Map(animate ? visual.animations.map(animation => [animation.target_id, animation]) : []);
  const children: React.ReactNode[] = [];
  for (let i = 0; i < root.childNodes.length; i++) if (root.childNodes[i].nodeType === 1) children.push(build(root.childNodes[i] as Element, animations, String(i)));
  return {viewBox: root.getAttribute('viewBox') ?? '0 0 160 90', children};
}

// .moment.compact .visual: 160x90 CSS px; the fallback is 14px muted text.
export function Visual({visual, width = px(160), onInteract}: {visual: VisualArtifact; width?: number; onInteract?: () => void}) {
  const [play, setPlay] = React.useState(0);
  const [still, setStill] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    void Promise.resolve().then(() => AccessibilityInfo.isReduceMotionEnabled()).then(reduce => setStill(Boolean(reduce)), () => undefined);
  }, []);
  const parsed = React.useMemo(() => {
    if (visual.status !== 'ready') return null;
    try {return parseVisual(visual, !still);} catch {return null;}
  }, [visual, still]);
  if (!parsed) return <View style={[styles.fallback, {width}]}>
    <Text style={styles.fallbackText}>{visual.description || 'The explanation is ready in words.'}</Text>
    {visual.status !== 'none' && <Text style={styles.small}>Visual unavailable</Text>}
  </View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Replay explanation animation. ${visual.description}`} onPress={() => {onInteract?.(); setPlay(value => value + 1);}}
    onFocus={() => {setFocused(true); onInteract?.();}} onBlur={() => setFocused(false)} style={[styles.frame, {width, height: width * 9 / 16}, focused && styles.focused]}>
    <Svg key={play} width="100%" height="100%" viewBox={parsed.viewBox}>{parsed.children}</Svg>
    <Text style={styles.replay}>↻</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  frame: {backgroundColor: palette.surface, borderRadius: px(6), overflow: 'hidden', borderWidth: px(2), borderColor: 'transparent'},
  focused: {borderColor: palette.ink},
  replay: {position: 'absolute', right: 0, bottom: 0, color: palette.ink, backgroundColor: palette.surface, fontSize: px(18), lineHeight: px(18), padding: px(3), borderRadius: px(4)},
  fallback: {gap: px(4)},
  fallbackText: {color: palette.muted, fontSize: px(14), lineHeight: px(14) * 1.4},
  small: {color: palette.muted, fontSize: px(14)},
});
