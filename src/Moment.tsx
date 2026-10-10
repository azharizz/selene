// Ask / answer panels shared by the own player (Player.tsx) and real-playback moments (CompanionMoment.tsx).
// Layout ports web/style.css: .ask-sheet (480px, bottom-right) and .moment.compact (560px toast, top-right).
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {LayoutChangeEvent} from 'react-native';
import type {AccessibilitySnapshot} from './Accessibility';
import type {Corner, Example, Moment} from './api';
import {clock} from './api';
import {Alert, Control, Field, palette, px} from './ui';
import {Visual} from './Visual';

export const plain = (answer: string) => answer.replace(/—/g, ',');

export type Examples = {status: 'loading' | 'ready' | 'error'; items: Example[]; open: boolean; anchorAt: number;
  onToggle: () => void; onRetry: () => void; onSelect: (example: Example) => void};

export function AskPanel({clarification, request, onChange, onSubmit, onClose, error, examples, quick, turns, label, busy = false, placeholder = 'Ask about this moment…', accessibility, onVoiceLongPress, voiceStatus = 'idle'}: {
  clarification?: string; request: string; onChange: (value: string) => void; onSubmit: () => void; onClose: () => void; error?: string;
  examples?: Examples; quick?: {label: string; onPress: () => void}[]; turns?: {question: string; answer: string}[]; label?: string;
  busy?: boolean; placeholder?: string; accessibility?: AccessibilitySnapshot; onVoiceLongPress?: () => void; voiceStatus?: 'idle' | 'recording' | 'processing';
}) {
  return <View accessibilityLabel="Ask Selene" style={styles.ask}>
    <View style={styles.close}><Control variant="ask" square icon="close" accessibilityLabel="Close question" onPress={onClose} accessibility={accessibility}/></View>
    {label ? <Text allowFontScaling={false} style={[styles.label, scaled(12, accessibility)]}>{label}</Text> : null}
    {/* Recent turns keep follow-ups ("and why did he do that?") readable. */}
    {turns?.map((turn, i) => <View key={i} style={styles.turn}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.turnQuestion, scaled(14, accessibility)]}>{turn.question}</Text>
      <Text allowFontScaling={false} numberOfLines={2} style={[styles.note, scaled(14, accessibility)]}>{plain(turn.answer)}</Text>
    </View>)}
    {clarification ? <Text allowFontScaling={false} accessibilityRole="header" style={[styles.clarification, scaled(18, accessibility)]}>{clarification}</Text> : null}
    {error ? <Text allowFontScaling={false} accessibilityLiveRegion="assertive" style={[styles.hint, scaled(16, accessibility)]}>{error}</Text> : null}
    <View style={styles.question}>
      {/* On Vega, D-pad Down inside a focused field opens the keyboard, so focus starts on the first action unless an answer is needed. */}
      <Field style={styles.grow} preferred={Boolean(clarification)} label={clarification ? 'Your answer' : 'Your question'} value={request} onChange={onChange} onSubmit={() => {if (!busy) onSubmit();}}
        onLongPress={onVoiceLongPress} placeholder={voiceStatus === 'recording' ? 'Recording — long-press to finish' : voiceStatus === 'processing' ? 'Transcribing — please wait' : clarification ? 'Add the missing detail…' : placeholder} accessibility={accessibility}/>
      <Control variant="ask" primary icon="send" label={clarification ? 'Answer' : 'Ask'} disabled={busy || voiceStatus !== 'idle' || !request.trim()} onPress={onSubmit} accessibility={accessibility}/>
    </View>
    {onVoiceLongPress && <Text allowFontScaling={false} style={[styles.note, scaled(12, accessibility)]}>
      {voiceStatus === 'recording' ? 'Recording from the TV microphone. Long-press again to finish.' : voiceStatus === 'processing' ? 'Preparing a transcript for review…' : 'Long-press the question field to record; long-press again to finish.'}
    </Text>}
    {!clarification && (quick?.length || examples) ? <Text allowFontScaling={false} style={[styles.label, styles.gap, scaled(12, accessibility)]}>Try asking</Text> : null}
    {!clarification && <View style={styles.inlineRow}>
      {quick?.map((item, i) => <Control key={item.label} variant="ask" preferred={i === 0} disabled={busy} label={item.label} onPress={item.onPress} accessibility={accessibility}/>)}
      {examples?.status === 'ready' && examples.items.map(example => <Control key={example.id} variant="ask" disabled={busy} onPress={() => examples.onSelect(example)} accessibility={accessibility}
        label={`${example.at_seconds > examples.anchorAt ? `Jump to ${clock(example.at_seconds)} · ` : ''}${example.request}`}/>)}
    </View>}
    {!clarification && examples && examples.status !== 'ready' && <>
      <View style={styles.list}>
        {examples.status === 'loading' && <Text allowFontScaling={false} style={[styles.note, scaled(16, accessibility)]}>Loading prepared examples…</Text>}
        {examples.status === 'error' && <><Text allowFontScaling={false} style={[styles.note, scaled(16, accessibility)]}>Prepared examples could not load.</Text>
          <Control variant="ask" label="Retry examples" onPress={examples.onRetry} accessibility={accessibility}/></>}
      </View>
    </>}
  </View>;
}

// .moment.compact: visual (160x90) | answer (18px, weight 500) | icon column (close, more).
export function MomentPanel({moment, audience = moment?.audience, text, question, notice, lines, waiting, error, onDismiss, dismissLabel = 'Dismiss answer', onMore, accessibility, corner = 'top-right', captions, onLayout, onInteract}: {moment: Moment | null; audience?: Moment['audience']; text?: string;
  question?: string; notice?: string; lines?: string[]; waiting?: boolean; error?: string; onDismiss: () => void; dismissLabel?: string; onMore?: () => void; accessibility?: AccessibilitySnapshot;
  corner?: Corner; captions?: boolean; onLayout?: (event: LayoutChangeEvent) => void; onInteract?: () => void}) {
  return <View accessibilityLabel="Moment Response" onLayout={onLayout} onTouchStart={onInteract} style={[styles.toast, styles[corner], captions && styles.captionSafe]}>
    {moment && moment.visual.status !== 'none' && <Visual visual={moment.visual} onInteract={onInteract}/>}
    <ScrollView style={styles.answer} onScroll={onInteract}>
      {question ? <Text allowFontScaling={false} numberOfLines={1} style={[styles.turnQuestion, scaled(14, accessibility)]}>{question}</Text> : null}
      <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={[styles.answerText, scaled(18, accessibility, 1.3)]}>{text ?? (moment ? plain(moment.answer) : '')}</Text>
      {audience ? <Text accessible allowFontScaling={false} style={[styles.audience, scaled(12, accessibility)]}>{`For ${audience.recipient} · ${{declaration: 'stated', profile: 'profile', request: 'selected'}[audience.source]}`}</Text> : null}
      {notice ? <Text allowFontScaling={false} style={[styles.small, scaled(16, accessibility)]}>{notice}</Text> : null}
      {lines?.map(line => <Text key={line} allowFontScaling={false} style={[styles.small, scaled(14, accessibility)]}>{line}</Text>)}
      {waiting ? <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={[styles.small, scaled(16, accessibility)]}>Waiting for the playback app…</Text> : null}
      <Alert accessibility={accessibility}>{error}</Alert>
    </ScrollView>
    <View style={styles.footer}>
      <Control variant="toast" square preferred icon="close" accessibilityLabel={dismissLabel} disabled={waiting} onPress={onDismiss} accessibility={accessibility}/>
      {onMore && <Control variant="toast" square icon="more" accessibilityLabel="More options" onPress={onMore} onFocus={onInteract} accessibility={accessibility}/>}
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
  label: {color: palette.muted, letterSpacing: px(0.6), marginRight: px(32), marginBottom: px(6)},
  gap: {marginTop: px(8), marginBottom: 0},
  turn: {marginBottom: px(8), marginRight: px(32)},
  turnQuestion: {color: palette.ink, fontWeight: '600'},
  toast: {position: 'absolute', width: px(560), maxWidth: '90%', maxHeight: '80%', padding: px(8), borderRadius: px(12), backgroundColor: palette.surface,
    flexDirection: 'row', alignItems: 'center', gap: px(8)},
  'top-left': {left: '5%', top: '5%'},
  'top-right': {right: '5%', top: '5%'},
  'bottom-left': {left: '5%', bottom: '5%'},
  'bottom-right': {right: '5%', bottom: '5%'},
  captionSafe: {maxHeight: '75%'},
  answer: {flex: 1, minWidth: 0},
  answerText: {color: palette.ink, fontWeight: '500'},
  audience: {color: palette.ink, alignSelf: 'flex-start', marginTop: px(6), paddingHorizontal: px(6), paddingVertical: px(2), borderWidth: 1, borderColor: palette.muted, borderRadius: px(6)},
  small: {color: palette.muted, marginTop: px(6)},
  footer: {width: px(32), alignItems: 'center'},
});
