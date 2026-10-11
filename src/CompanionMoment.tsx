/* global AbortSignal */
// Native "ask about this moment" for real playback apps. Port of web/CompanionMoment.tsx; playback commands
// go straight to Companion.tsx instead of through a WebView bridge.
import React from 'react';
import {Alert as NativeAlert, AppState, BackHandler} from 'react-native';
import type {NativeEventSubscription} from 'react-native';
import type {AccessibilitySnapshot} from './Accessibility';
import {endSession, openSession, request, RelayError} from './api';
import type {Choice, Moment} from './api';
import {AskPanel, MomentPanel} from './Moment';
import {VoiceCapture} from './VoiceCapture';
import {Actions, Alert, Control, LoadingPanel, P, Sheet, SheetHead} from './ui';

export type Snapshot = {package_id: string; session_id: number; catalog_name: string; content_id: string; title: string; provider_name: string; at_seconds: number};
export type Playback = {state: 'playing' | 'paused' | 'unknown'; can_pause: boolean; can_play: boolean; revision: number; observing: boolean};
type Input = {
  snapshot: Snapshot; request: string; scene_detail: string; scene_answer: string; need: 'Show visually'; language: 'English'; recipient: 'everyone';
  session: 'family'; play_state: Playback['state']; playback_choice: Choice; continuation: {request: string; question: string; answer: string} | null; requester_id?: string;
};
type Props = {snapshot: Snapshot; playback: Playback; command: (action: 'play' | 'pause' | 'refresh', expectedRevision?: number) => Promise<Playback>;
  onClose: () => void; accessibility: AccessibilitySnapshot};
type State = {screen: 'ask' | 'loading' | 'moment' | 'more'; request: string; sceneAnswer: string; moment: Moment | null; error: string; clarifying: boolean;
  controlling: boolean; mirror: {url: string} | null; mirrorAvailable: boolean; voice: 'idle' | 'recording' | 'processing'};

export class CompanionMoment extends React.Component<Props, State> {
  state: State = {screen: 'ask', request: '', sceneAnswer: '', moment: null, error: '', clarifying: false, controlling: false, mirror: null, mirrorAvailable: false, voice: 'idle'};
  private pending: AbortController | null = null;
  private sessionId = '';
  private lastInput: Input | null = null;
  private mounted = false;
  private back?: NativeEventSubscription;
  private voiceCapture = new VoiceCapture();
  private voiceRequest: AbortController | null = null;
  private voiceRequesterId?: string;
  private appState?: NativeEventSubscription;

  componentDidMount() {
    this.mounted = true;
    this.back = BackHandler.addEventListener('hardwareBackPress', () => {this.goBack(); return true;});
    this.appState = AppState.addEventListener('change', state => {if (state !== 'active') this.close();});
  }
  componentWillUnmount() {this.mounted = false; this.cancelVoice(); this.back?.remove(); this.appState?.remove(); this.end();}

  private questionChanged = (value: string) => {
    if (value !== this.state.request) this.voiceRequesterId = undefined;
    this.setState({request: value});
  };
  private voiceLongPress = () => {
    if (this.state.voice === 'recording') {void this.finishVoice(); return;}
    if (this.state.voice !== 'idle' || this.state.screen !== 'ask' || this.state.clarifying) return;
    NativeAlert.alert('Record your question', 'Your voice recording will be sent to Selene’s relay for transcription and local matching against existing profiles. The transcript will be shown for review before you submit it.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Continue', onPress: () => this.confirmVoicePermission()},
    ]);
  };
  private confirmVoicePermission = () => {
    NativeAlert.alert('Allow microphone access', 'Selene needs microphone access to record your question. The recording will be sent to Selene’s relay for transcription and existing-profile matching. Review the transcript before submitting.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Allow', onPress: () => {void this.startVoice();}},
    ]);
  };
  private startVoice = async () => {
    if (this.state.voice !== 'idle' || this.state.screen !== 'ask' || this.state.clarifying) return;
    this.voiceRequesterId = undefined; this.setState({voice: 'recording', request: '', error: ''});
    try {
      await this.voiceCapture.start(() => {
        if (this.mounted && this.state.voice === 'recording') this.setState({error: 'Recording limit reached. Long-press the question field to finish and review.'});
      }, error => {
        if (this.mounted && this.state.voice === 'recording') this.setState({voice: 'idle', error: error.message});
      }, async () => await new Promise<boolean>(resolve => NativeAlert.alert('Microphone permission', 'The system will ask whether Selene may use the microphone for this recording.', [
        {text: 'Cancel', style: 'cancel', onPress: () => resolve(false)},
        {text: 'Continue', onPress: () => resolve(true)},
      ])));
      if (!this.mounted || (this.state.voice as State['voice']) !== 'recording') await this.voiceCapture.cancel();
    } catch (error) {
      await this.voiceCapture.cancel();
      if (this.mounted) this.setState({voice: 'idle', error: error instanceof Error ? error.message : 'Microphone recording could not start.'});
    }
  };
  private finishVoice = async () => {
    if (this.state.voice !== 'recording') return;
    this.setState({voice: 'processing', error: ''});
    const controller = new AbortController(); this.voiceRequest = controller;
    try {
      const audio = await this.voiceCapture.stop();
      if (!this.mounted || this.voiceRequest !== controller || controller.signal.aborted || this.state.screen !== 'ask') return;
      const result = await request<{transcript: string; requester?: {id: string} | null; match: 'matched' | 'unknown'}>('/api/voice', {
        method: 'POST', session: this.sessionId, signal: controller.signal, timeoutMs: 120000,
        body: {audio, format: 'wav', action: 'question', consent: true},
      });
      if (!this.mounted || this.voiceRequest !== controller || controller.signal.aborted) return;
      this.voiceRequest = null; this.voiceRequesterId = result.match === 'matched' && result.requester?.id ? result.requester.id : undefined;
      this.setState({voice: 'idle', request: result.transcript, error: result.transcript ? '' : 'No clear speech was recognized. Try again or type your question.'});
    } catch (error) {
      await this.voiceCapture.cancel();
      if (!this.mounted || this.voiceRequest !== controller || controller.signal.aborted) return;
      this.voiceRequest = null; this.voiceRequesterId = undefined;
      this.setState({voice: 'idle', error: error instanceof Error ? error.message : 'Voice transcription failed. Try again or type your question.'});
    }
  };
  private cancelVoice = () => {
    this.voiceRequest?.abort(); this.voiceRequest = null; this.voiceRequesterId = undefined;
    if (this.mounted && this.state.voice !== 'idle') this.setState({voice: 'idle'});
    void this.voiceCapture.cancel();
  };
  private cancel = () => {this.pending?.abort(); this.pending = null;};
  private end = () => {this.cancel(); endSession(this.sessionId); this.sessionId = '';};
  private close = () => {this.cancelVoice(); void this.stopMirror(); this.end(); this.props.onClose();};
  private failed(error: unknown) {
    if (this.mounted && !(error instanceof Error && error.name === 'AbortError')) this.setState({error: error instanceof Error ? error.message : 'This moment is unavailable. Please try again.'});
  }
  private command = async (action: 'play' | 'pause' | 'refresh', expectedRevision?: number) => {
    if (this.state.controlling) throw new Error('Playback control is unavailable. Close this moment and check the app.');
    this.setState({controlling: true});
    try {return await this.props.command(action, expectedRevision);}
    finally {if (this.mounted) this.setState({controlling: false});}
  };
  private pause = async (expectedRevision?: number) => {
    const state = await this.command('pause', expectedRevision);
    if (state.state !== 'paused') throw new Error('The viewing app has not confirmed a pause. Explore after it reports paused.');
    return state;
  };
  private resume = async () => {
    try {
      const state = await this.command('play');
      if (state.state !== 'playing') throw new Error('The viewing app has not confirmed playback. Check that app before continuing.');
      if (this.mounted) this.close();
    } catch (error) {this.failed(error);}
  };
  private openMirror = async () => {
    if (!this.sessionId || !this.state.moment) return;
    try {
      const result = await request<{url: string}>('/api/private/pair', {method: 'POST', session: this.sessionId, body: {}});
      if (typeof result.url !== 'string') throw new Error('Private mirroring is unavailable.');
      this.setState({mirror: {url: result.url}});
    } catch (error) {this.setState({error: error instanceof Error ? error.message : 'Private mirroring is unavailable.'});}
  };
  private stopMirror = async () => {
    if (!this.state.mirror) return;
    if (this.mounted) this.setState({mirror: null});
    if (this.sessionId) await request('/api/private/close', {method: 'POST', session: this.sessionId, body: {}}).catch(() => undefined);
  };
  private open = async (signal: AbortSignal) => {
    const session = await openSession({mode: 'companion'}, signal);
    this.sessionId = session.session_id;
    if (this.mounted) this.setState({mirrorAvailable: session.private_mirror_available === true});
  };
  private ask = (choice: Choice, quickRequest?: string) => {
    const {request: text, clarifying, moment, sceneAnswer} = this.state;
    if (!quickRequest && !text.trim()) {this.setState({error: 'Type a question or choose a quick question.'}); return;}
    const previous = clarifying ? this.lastInput : null;
    void this.deliver({snapshot: this.props.snapshot, request: previous?.request ?? (quickRequest ?? text.trim()), scene_detail: previous?.scene_detail ?? text.trim(),
      scene_answer: sceneAnswer, need: 'Show visually', language: 'English', recipient: 'everyone', session: 'family', play_state: this.props.playback.state,
      playback_choice: choice, continuation: previous && moment ? {request: previous.request, question: moment.answer, answer: text.trim()} : null,
      ...(previous?.requester_id ?? this.voiceRequesterId ? {requester_id: previous?.requester_id ?? this.voiceRequesterId} : {})});
  };
  private deliver = async (input: Input) => {
    this.cancel();
    const pending = new AbortController(); this.pending = pending;
    this.lastInput = input;
    this.setState({screen: 'loading', error: ''});
    const aborted = () => {if (pending.signal.aborted) throw Object.assign(new Error('Cancelled'), {name: 'AbortError'});};
    try {
      const state = input.playback_choice === 'pause_to_explore' ? await this.pause() : await this.command('refresh');
      aborted();
      // Refresh transport without moving the question's spoiler boundary.
      input = {...input, play_state: state.state}; this.lastInput = input;
      if (!this.sessionId) await this.open(pending.signal);
      const send = () => request<Moment>('/api/companion/moment', {method: 'POST', session: this.sessionId, body: input, signal: pending.signal, timeoutMs: 0});
      let moment: Moment;
      try {moment = await send();}
      catch (error) {if ((error as RelayError).status !== 410) throw error; await this.open(pending.signal); moment = await send();}
      aborted();
      // Re-read the selected session before showing a delayed answer. Identity is checked natively.
      let current = await this.command('refresh');
      aborted();
      if (moment.state === 'response') {
        if (current.state !== 'playing') {
          if (!current.can_play) throw new Error('The playback app cannot resume. Resume it there, then ask again.');
          current = await this.command('play', current.revision);
          aborted();
          if (current.state !== 'playing') throw new Error('The playback app has not confirmed resumed playback.');
        }
        moment.intervention.playback = 'keep_watching';
      } else if (moment.intervention.playback === 'request_pause' && current.state !== 'paused') {
        // A newer reported transport change wins. Without notifications, offer the choice instead.
        if (!state.observing || !current.observing || state.revision !== current.revision) moment.intervention.playback = 'offer_choice';
        else {await this.pause(current.revision); aborted();}
      }
      if (!this.mounted || this.pending !== pending) return;
      this.pending = null;
      if (moment.state === 'quiet') return this.close();
      if (moment.state !== 'clarification') this.voiceRequesterId = undefined;
      this.setState({screen: moment.state === 'clarification' ? 'ask' : 'moment', moment, clarifying: moment.state === 'clarification',
        request: moment.state === 'clarification' ? '' : this.state.request, sceneAnswer: input.continuation?.answer ?? this.state.sceneAnswer});
    } catch (error) {
      if (pending.signal.aborted || !this.mounted) return;
      this.pending = null; this.setState({screen: 'ask'}); this.failed(error);
    }
  };
  private goBack = () => {
    const {screen, clarifying} = this.state;
    if (screen === 'loading') {this.cancel(); this.setState({screen: 'ask', error: 'Request cancelled. A playback command already sent may still finish.'}); return;}
    if (screen === 'more') {this.setState({screen: 'moment', error: ''}); return;}
    if (screen === 'ask' && clarifying) {this.close(); return;}
    this.close();
  };

  render() {
    const {screen, request: text, moment, error, clarifying, controlling, mirror, mirrorAvailable} = this.state;
    const {playback, accessibility: a11y} = this.props;
    const paused = playback.state === 'paused';
    return <>
      {screen === 'ask' && <AskPanel clarification={clarifying && moment ? moment.answer.replace(/—/g, ',') : undefined} request={text} onChange={this.questionChanged}
        onVoiceLongPress={clarifying ? undefined : this.voiceLongPress} voiceStatus={this.state.voice} busy={controlling || this.state.voice !== 'idle'} onSubmit={() => this.ask('unspecified')} onClose={this.goBack} error={error} placeholder="Why did that happen?" accessibility={a11y}
        quick={[{label: 'Explain scene', onPress: () => {this.voiceRequesterId = undefined; this.ask('unspecified', 'Explain what just happened in this moment.');}},
          {label: 'Explain dialogue', onPress: () => {this.voiceRequesterId = undefined; this.ask('unspecified', 'I missed that. Explain the last completed dialogue simply.');}}]}/>}
      {screen === 'loading' && <LoadingPanel onCancel={this.goBack}/>}
      {screen === 'moment' && moment && <MomentPanel moment={moment} waiting={controlling} error={error} onDismiss={this.close} onMore={() => this.setState({screen: 'more', error: ''})} accessibility={a11y}/>}
      {screen === 'more' && <Sheet label="This moment">
        <SheetHead title="This moment" accessibility={a11y}><Control preferred icon="back" label="Back" onPress={this.goBack} accessibility={a11y}/></SheetHead>
        <Actions>
          {!paused && playback.can_pause && <Control disabled={controlling} label="Pause playback" onPress={() => {
            void this.pause().then(() => this.mounted && this.setState({screen: 'moment', error: ''}), failure => this.failed(failure));
          }} accessibility={a11y}/>}
          {paused && playback.can_play && <Control disabled={controlling} label="Resume playback" onPress={() => {void this.resume();}} accessibility={a11y}/>}
          {mirrorAvailable && <Control label={mirror ? 'Stop phone mirror' : 'Mirror on phone'} onPress={() => {void (mirror ? this.stopMirror() : this.openMirror());}} accessibility={a11y}/>}
          <Control label={paused ? 'Close, stay paused' : 'Close moment'} onPress={this.close} accessibility={a11y}/>
        </Actions>
        {mirror && <P muted size={16} accessibility={a11y}>Open on your phone: {mirror.url}</P>}
        <Alert accessibility={a11y}>{error}</Alert>
      </Sheet>}
    </>;
  }
}
