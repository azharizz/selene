import type {KeplerA11ySettingsInterface as Settings} from '@amazon-devices/kepler-a11y-settings-interface-turbo';
import type {CaptioningProps} from '@amazon-devices/kepler-a11y-settings-interface-turbo';

export type AccessibilitySnapshot = {captions?: boolean; captionPreferences?: CaptioningProps; screenReader?: boolean; highContrast?: boolean; audioDescription?: boolean; textScale?: number};

// One owner lives for the root app's lifetime: the SDK has one listener per setting.
export class Accessibility {
  private active = false;
  private snapshot: AccessibilitySnapshot = {};
  private removals: (() => Promise<void>)[] = [];
  constructor(private readonly publish: (settings: AccessibilitySnapshot) => void) {}

  async start(api?: typeof Settings) {
    if (this.active) return;
    this.active = true;
    try {
      const settings = api ?? (await import('@amazon-devices/kepler-a11y-settings-interface-turbo')).KeplerA11ySettingsInterface;
      if (!this.active) return;
      const watch = async <K extends keyof AccessibilitySnapshot>(key: K, read: () => Promise<AccessibilitySnapshot[K]>,
        add: (listener: (value: AccessibilitySnapshot[K]) => void) => Promise<boolean>, remove: () => Promise<void>) => {
        let revision = 0;
        const update = (value: AccessibilitySnapshot[K]) => {
          revision++;
          if (!this.active) return;
          this.snapshot = {...this.snapshot, [key]: value}; this.publish({...this.snapshot});
        };
        let registered = false;
        try {registered = await add(update);} catch { /* a getter can still work without a listener */ }
        if (!this.active) {if (registered) await remove().catch(() => undefined); return;}
        if (registered) this.removals.push(remove);
        const current = revision;
        try {const value = await read(); if (this.active && current === revision) update(value);} catch { /* absence stays unknown */ }
      };
      let scaleRevision = 0;
      const readScale = async () => {
        const revision = ++scaleRevision;
        const value = await settings.getScalingMultiplier(32, {itemType: 'text'});
        if (revision !== scaleRevision) throw new Error('Superseded scale read');
        return value;
      };
      await Promise.allSettled([
        watch('captions', () => settings.isClosedCaptioningEnabled(), listener => settings.addClosedCaptioningStateListener(listener), () => settings.removeClosedCaptioningStateListener()),
        watch('captionPreferences', () => settings.getCaptionPreferences(), listener => settings.addCaptioningPreferencesListener(listener), () => settings.removeCaptioningPreferencesListener()),
        watch('screenReader', () => settings.isScreenReaderEnabled(), listener => settings.addScreenReaderStateListener(listener), () => settings.removeScreenReaderStateListener()),
        watch('highContrast', () => settings.isHighContrastTextEnabled(), listener => settings.addHighContrastTextStateListener(listener), () => settings.removeHighContrastTextStateListener()),
        watch('audioDescription', () => settings.isAudioDescriptionPreferred(), listener => settings.addAudioDescriptionStateListener(listener), () => settings.removeAudioDescriptionStateListener()),
        watch('textScale', readScale, listener => settings.addUiScaleSettingListener(() => {
          void readScale().then(listener).catch(() => undefined);
        }), () => settings.removeUiScaleSettingListener()),
      ]);
    } catch { /* Browser/unsupported runtime keeps explicit local preferences. */ }
  }
  stop() {
    this.active = false;
    for (const remove of this.removals.splice(0)) void remove().catch(() => undefined);
  }
}
