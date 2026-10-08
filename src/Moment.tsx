// Ask / answer panels shared by the own player (Player.tsx) and real-playback moments (CompanionMoment.tsx).
// Layout ports web/style.css: .ask-sheet (480px, bottom-right) and .moment.compact (560px toast, top-right).
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {AccessibilitySnapshot} from './Accessibility';
import type {Example, Moment} from './api';
import {Alert, Control, Field, palette, px} from './ui';
import {Visual} from './Visual';

export const plain = (answer: string) => answer.replace(/—/g, ',');

export type Examples = {status: 'loading' | 'ready' | 'error'; items: Example[]; open: boolean; anchorAt: number;
  onToggle: () => void; onRetry: () => void; onSelect: (example: Example) => void};

export function AskPanel({clarification, request, onChange, onSubmit, onClose, error, examples, quick, busy = false, placeholder = 'Ask about this moment…', accessibility}: {
  clarification?: string; request: string; onChange: (value: string) => void; onSubmit: () => void; onClose: () => void; error?: string;
  examples?: Examples; quick?: {label: string; onPress: () => void}[]; busy?: boolean; placeholder?: string; accessibility?: AccessibilitySnapshot;
}) {
  return <View accessibilityLabel="Ask Selene" style={styles.ask}>
    <View style={styles.close}><Control variant="ask" square icon="close" accessibilityLabel="Close question" onPress={onClose} accessibility={accessibility}/></View>
    {clarification ? <Text allowFontScaling={false} accessibilityRole="header" style={[styles.clarification, scaled(18, accessibility)]}>{clarification}</Text> : null}
    {error ? <Text allowFontScaling={false} accessibilityLiveRegion="assertive" style={[styles.hint, scaled(16, accessibility)]}>{error}</Text> : null}
    <View style={styles.question}>
      {/* On Vega, D-pad Down inside a focused field opens the keyboard, so focus starts on the first action unless an answer is needed. */}
      <Field style={styles.grow} preferred={Boolean(clarification)} label={clarification ? 'Your answer' : 'Your question'} value={request} onChange={onChange} onSubmit={onSubmit}
        placeholder={clarification ? 'Add the missing detail…' : placeholder} accessibility={accessibility}/>
      <Control variant="ask" primary icon="send" label={clarification ? 'Answer' : 'Ask'} disabled={busy || !request.trim()} onPress={onSubmit} accessibility={accessibility}/>
    </View>
    {!clarification && quick && <View style={styles.inlineRow}>
      {quick.map((item, i) => <Control key={item.label} variant="ask" preferred={i === 0} disabled={busy} label={item.label} onPress={item.onPress} accessibility={accessibility}/>)}
    </View>}
    {!clarification && examples && <>
      <View style={styles.inlineRow}><Control variant="ask" preferred={!quick?.length} label="Prepared examples" pressed={examples.open} onPress={examples.onToggle} accessibility={accessibility}/></View>
      {examples.open && <View style={styles.list}>
        {examples.status === 'loading' && <Text allowFontScaling={false} style={[styles.note, scaled(16, accessibility)]}>Loading prepared examples…</Text>}
        {examples.status === 'error' && <><Text allowFontScaling={false} style={[styles.note, scaled(16, accessibility)]}>Prepared examples could not load.</Text>
          <Control variant="ask" label="Retry examples" onPress={examples.onRetry} accessibility={accessibility}/></>}
        {examples.status === 'ready' && !examples.items.length && <Text allowFontScaling={false} style={[styles.note, scaled(16, accessibility)]}>No supported prepared example for this film. Ask in your own words.</Text>}
        {examples.status === 'ready' && examples.items.map(example => <Control key={example.id} variant="ask" block onPress={() => examples.onSelect(example)} accessibility={accessibility}
          label={`${example.at_seconds > examples.anchorAt ? `Jump to ${example.at_seconds.toFixed(3)}s · ` : ''}${example.request}`}/>)}
      </View>}
    </>}
  </View>;
}

// .moment.compact: visual (160x90) | answer (18px, weight 500) | icon column (close, more).
export function MomentPanel({moment, text, notice, lines, waiting, error, onDismiss, dismissLabel = 'Dismiss answer', onMore, accessibility}: {moment: Moment | null; text?: string;
  notice?: string; lines?: string[]; waiting?: boolean; error?: string; onDismiss: () => void; dismissLabel?: string; onMore?: () => void; accessibility?: AccessibilitySnapshot}) {
  return <View accessibilityLabel="Moment Response" style={styles.toast}>
    {moment && moment.visual.status !== 'none' && <Visual visual={moment.visual}/>}
    <ScrollView style={styles.answer}>
      <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={[styles.answerText, scaled(18, accessibility, 1.3)]}>{text ?? (moment ? plain(moment.answer) : '')}</Text>
      {notice ? <Text allowFontScaling={false} style={[styles.small, scaled(16, accessibility)]}>{notice}</Text> : null}
      {lines?.map(line => <Text key={line} allowFontScaling={false} style={[styles.small, scaled(14, accessibility)]}>{line}</Text>)}
      {waiting ? <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={[styles.small, scaled(16, accessibility)]}>Waiting for the playback app…</Text> : null}
      <Alert accessibility={accessibility}>{error}</Alert>
    </ScrollView>
    <View style={styles.footer}>
      <Control variant="toast" square preferred icon="close" accessibilityLabel={dismissLabel} disabled={waiting} onPress={onDismiss} accessibility={accessibility}/>
      {onMore && <Control variant="toast" square icon="more" accessibilityLabel="More options" onPress={onMore} accessibility={accessibility}/>}
    </View>
  </View>;
}

const scaled = (cssSize: number, accessibility?: AccessibilitySnapshot, lineHeight = 1.45) => {
  const size = px(cssSize) * (accessibility?.textScale ?? 1);
  return {fontSize: size, lineHeight: size * lineHeight, ...(accessibility?.highContrast ? {color: '#ffffff'} : {})};
};

const styles = StyleSheet.create({
  grow: {flex: 1, minWidth: 0},
  ask: {position: 'absolute', right: '5%', bottom: '5%', width: px(480), maxWidth: '90%', maxHeight: '80%', padding: px(12), backgroundColor: palette.surface, borderRadius: px(12)},
  close: {position: 'absolute', right: px(8), top: px(8), zIndex: 1},
  clarification: {color: palette.ink, fontWeight: '600', marginBottom: px(10), marginRight: px(32)},
  hint: {color: palette.alert, marginBottom: px(8), marginRight: px(28)},
  question: {flexDirection: 'row', alignItems: 'center', gap: px(6), paddingRight: px(28)},
  inlineRow: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: px(6), marginTop: px(8)},
  list: {gap: px(6), marginTop: px(8)},
  note: {color: palette.muted},
  toast: {position: 'absolute', right: '5%', top: '5%', width: px(560), maxWidth: '90%', maxHeight: '80%', padding: px(8), borderRadius: px(12), backgroundColor: palette.surface,
    flexDirection: 'row', alignItems: 'center', gap: px(8)},
  answer: {flex: 1, minWidth: 0},
  answerText: {color: palette.ink, fontWeight: '500'},
  small: {color: palette.muted, marginTop: px(6)},
  footer: {width: px(32), alignItems: 'center'},
});
