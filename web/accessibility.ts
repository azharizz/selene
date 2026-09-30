import type {CSSProperties} from 'react';

export type AccessibilitySettings = {captions?: boolean; screenReader?: boolean; highContrast?: boolean; audioDescription?: boolean; textScale?: number; captionPreferences?: Record<string, string>};
export function accessibilitySettings(value: unknown): AccessibilitySettings {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>; const result: AccessibilitySettings = {};
  for (const key of ['captions', 'screenReader', 'highContrast', 'audioDescription'] as const) if (typeof input[key] === 'boolean') result[key] = input[key];
  if (typeof input.textScale === 'number' && Number.isFinite(input.textScale) && input.textScale >= 0.5 && input.textScale <= 4) result.textScale = input.textScale;
  if (input.captionPreferences && typeof input.captionPreferences === 'object') result.captionPreferences = Object.fromEntries(Object.entries(input.captionPreferences).filter(([key, val]) => ['textSize', 'textColor', 'textFont', 'textOpacity', 'textEdgeStyle', 'backgroundColor', 'backgroundOpacity', 'windowBackgroundColor', 'windowBackgroundOpacity'].includes(key) && typeof val === 'string' && val.length < 40)) as Record<string, string>;
  return result;
}
export function initialAccessibility() {return accessibilitySettings((window as Window & {__SELENE_A11Y__?: unknown}).__SELENE_A11Y__);}
export function applyAccessibility(value: AccessibilitySettings) {
  document.documentElement.style.setProperty('--selene-text-scale', String(value.textScale ?? 1));
  document.documentElement.dataset.highContrast = String(value.highContrast === true);
}
export function captionChoice(system?: boolean) {
  try {const explicit = localStorage.getItem('selene.captions'); if (explicit === 'true' || explicit === 'false') return explicit === 'true';} catch { /* storage may be disabled */ }
  return system ?? true;
}
export function saveCaptionChoice(value: boolean | null) {
  try {if (value === null) localStorage.removeItem('selene.captions'); else localStorage.setItem('selene.captions', String(value));} catch { /* the current choice still works */ }
}
export function captionStyle(settings: AccessibilitySettings): CSSProperties {
  const p = settings.captionPreferences ?? {};
  const lookup = <T,>(table: Record<string, T>, key: string, fallback?: T) => Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
  const sizes: Record<string, number> = {very_small: 0.75, small: 0.875, normal: 1, large: 1.25, very_large: 1.5};
  const colors: Record<string, string> = {white: '#ffffff', black: '#000000', red: '#ff0000', green: '#00ff00', blue: '#0000ff', yellow: '#ffff00', magenta: '#ff00ff', cyan: '#00ffff'};
  const fonts: Record<string, string> = {casual: 'sans-serif', cursive: 'cursive', monospace_sans: 'monospace', monospace_serif: 'monospace', sans_serif: 'sans-serif', serif: 'serif', small_capitals: 'sans-serif'};
  const opacity = (key: string) => lookup({percent_25: 0.25, percent_50: 0.5, percent_75: 0.75, percent_100: 1}, key, 1)!;
  const shadows: Record<string, string> = {none: 'none', uniform: '1px 1px #000, -1px -1px #000', drop_shadowed: '2px 2px 3px #000', raised: '-1px -1px #fff, 1px 1px #000', depressed: '1px 1px #fff, -1px -1px #000'};
  const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;
  return {fontSize: `calc(clamp(26px, 2.2vw, 42px) * var(--selene-text-scale, 1) * ${lookup(sizes, p.textSize, 1)})`,
    color: rgba(lookup(colors, p.textColor, '#ffffff')!, opacity(p.textOpacity)), fontFamily: lookup(fonts, p.textFont), fontVariant: p.textFont === 'small_capitals' ? 'small-caps' : undefined,
    backgroundColor: rgba(lookup(colors, p.backgroundColor, '#101114')!, opacity(p.backgroundOpacity)), textShadow: lookup(shadows, p.textEdgeStyle)};
}
