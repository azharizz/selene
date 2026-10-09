// Fire OS accessibility: React Native exposes the screen reader state (VoiceView/TalkBack). Caption
// preferences and system text scale are Vega-only settings, so captions follow the in-app choice.
import {AccessibilityInfo} from 'react-native';

export type AccessibilitySnapshot = {captions?: boolean; captionPreferences?: Record<string, string>; screenReader?: boolean; highContrast?: boolean; audioDescription?: boolean; textScale?: number};

export class Accessibility {
  private subscription: {remove: () => void} | null = null;
  constructor(private readonly publish: (settings: AccessibilitySnapshot) => void) {}
  async start() {
    this.subscription = AccessibilityInfo.addEventListener('screenReaderChanged', screenReader => this.publish({screenReader}));
    try {this.publish({screenReader: await AccessibilityInfo.isScreenReaderEnabled()});} catch { /* unknown stays default */ }
  }
  stop() {this.subscription?.remove(); this.subscription = null;}
}
