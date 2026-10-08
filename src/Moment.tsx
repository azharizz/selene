// Ask / loading / answer panels shared by the own player (Player.tsx) and real-playback moments (CompanionMoment.tsx).
import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import type {AccessibilitySnapshot} from './Accessibility';
import type {Example, Moment} from './api';
import {Body, Button, Field, Heading, LoadingMark, Panel, Row} from './ui';
import {Visual} from './Visual';

export const plain = (answer: string) => answer.replace(/\s*—\s*/g, ', ');

export type Examples = {status: 'loading' | 'ready' | 'error'; items: Example[]; open: boolean; anchorAt: number;
  onToggle: () => void; onRetry: () => void; onSelect: (example: Example) => void};

export function AskPanel({clarification, request, onChange, onSubmit, onClose, error, examples, quick, placeholder = 'Ask about this moment…', extra, accessibility}: {
  clarification?: string; request: string; onChange: (value: string) => void; onSubmit: () => void; onClose: () => void; error?: string;
  examples?: Examples; quick?: {label: string; onPress: () => void}[]; placeholder?: string; extra?: React.ReactNode; accessibility?: AccessibilitySnapshot;
}) {
  return <Panel label="Ask Selene">
    <Row><View style={styles.grow}><Heading accessibility={accessibility}>{clarification ?? 'Ask Selene'}</Heading></View>
      <Button small label="Close" accessibilityLabel="Close question" onPress={onClose} accessibility={accessibility}/></Row>
    {error ? <Body muted live accessibility={accessibility}>{error}</Body> : null}
    {/* On Vega, D-pad Down inside a focused field opens the keyboard, so focus starts on the first action instead. */}
    <Field preferred={Boolean(clarification)} label={clarification ? 'Add the missing detail' : 'Question'} value={request} onChange={onChange} onSubmit={onSubmit}
      placeholder={clarification ? 'Add the missing detail…' : placeholder} accessibility={accessibility}/>
    <Row>
      <Button small primary label={clarification ? 'Answer' : 'Ask'} disabled={!request.trim()} onPress={onSubmit} accessibility={accessibility}/>
      {!clarification && quick?.map((item, i) => <Button key={item.label} small preferred={i === 0} label={item.label} onPress={item.onPress} accessibility={accessibility}/>)}
      {!clarification && examples && <Button small preferred={!quick?.length} label="Prepared examples" pressed={examples.open} onPress={examples.onToggle} accessibility={accessibility}/>}
    </Row>
    {!clarification && examples?.open && <View style={styles.list}>
      {examples.status === 'loading' && <Body muted accessibility={accessibility}>Loading prepared examples…</Body>}
      {examples.status === 'error' && <><Body muted accessibility={accessibility}>Prepared examples could not load.</Body>
        <Button small label="Retry examples" onPress={examples.onRetry} accessibility={accessibility}/></>}
      {examples.status === 'ready' && !examples.items.length && <Body muted accessibility={accessibility}>No supported prepared example for this film. Ask in your own words.</Body>}
      {examples.status === 'ready' && examples.items.map(example => <Button key={example.id} small onPress={() => examples.onSelect(example)} accessibility={accessibility}
        label={`${example.at_seconds > examples.anchorAt ? `Jump to ${example.at_seconds.toFixed(3)}s · ` : ''}${example.request}`}/>)}
    </View>}
    {extra}
  </Panel>;
}

export function LoadingPanel({onCancel, label}: {onCancel: () => void; label?: string}) {
  return <Panel place="toast" label="Preparing the answer"><LoadingMark onCancel={onCancel} label={label}/></Panel>;
}

export function MomentPanel({moment, notice, waiting, error, onDismiss, onMore, accessibility}: {moment: Moment; notice?: string; waiting?: boolean; error?: string;
  onDismiss: () => void; onMore: () => void; accessibility?: AccessibilitySnapshot}) {
  return <Panel place="toast" label="Moment Response">
    <View style={styles.answerRow}>
      {moment.visual.status !== 'none' && <Visual visual={moment.visual} width={200}/>}
      <ScrollView style={styles.answer} contentContainerStyle={styles.answerContent}>
        <Body small={false} compact accessibility={accessibility} live>{plain(moment.answer)}</Body>
        {notice ? <Body small accessibility={accessibility}>{notice}</Body> : null}
      </ScrollView>
    </View>
    {waiting && <Body muted live accessibility={accessibility}>Waiting for the playback app…</Body>}
    {error ? <Body muted live accessibility={accessibility}>{error}</Body> : null}
    <Row>
      <Button small preferred label="Dismiss" accessibilityLabel="Dismiss answer" onPress={onDismiss} accessibility={accessibility}/>
      <Button small label="More" accessibilityLabel="More options" onPress={onMore} accessibility={accessibility}/>
    </Row>
  </Panel>;
}

const styles = StyleSheet.create({grow: {flex: 1}, list: {gap: 8}, answerRow: {flexDirection: 'row', gap: 12, alignItems: 'flex-start'},
  answer: {flex: 1, maxHeight: 150}, answerContent: {gap: 6}});
