import {Alert, NativeModules, PermissionsAndroid, Platform} from 'react-native';
import {request} from './api';

export type VoiceResult = {transcript: string; requester: {id: string} | null; match: 'matched' | 'unknown'; voice_available: boolean};
export type VoiceStage = 'permission' | 'recording' | 'processing';
type Recording = {audio: string; format: 'm4a'};
type Recorder = {record(consent: boolean): Promise<Recording>; stop(): Promise<void>; cancel(): Promise<void>};
const recorder = NativeModules.SeleneVoiceRecorder as Recorder | undefined;

function consent(signal: AbortSignal) {
  return new Promise<boolean>(resolve => {
    const done = (accepted: boolean) => {signal.removeEventListener('abort', cancel); resolve(accepted && !signal.aborted);};
    const cancel = () => done(false);
    signal.addEventListener('abort', cancel, {once: true});
    if (signal.aborted) {cancel(); return;}
    Alert.alert('Use voice for this question?', 'Record up to 19 seconds. Audio goes to the relay and its external transcription provider, and is compared locally with existing consented speaker profiles. No enrollment is performed. Review the transcript before asking.',
      [{text: 'Cancel', style: 'cancel', onPress: cancel}, {text: 'Agree and record', onPress: () => done(true)}], {cancelable: true, onDismiss: cancel});
  });
}

export async function recordQuestion(session: string, signal: AbortSignal, onStage: (stage: VoiceStage) => void): Promise<VoiceResult | null> {
  if (Platform.OS !== 'android' || !recorder) throw new Error('Native microphone capture is unavailable in this build. Use the paired phone.');
  onStage('permission');
  if (!await consent(signal)) return null;
  const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (signal.aborted) throw new Error('Recording cancelled.');
  if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Microphone permission was not granted. Use typed questions or the paired phone.');
  const cancel = () => {void recorder.cancel().catch(() => undefined);};
  signal.addEventListener('abort', cancel, {once: true});
  try {
    if (signal.aborted) throw new Error('Recording cancelled.');
    onStage('recording');
    const recording = await recorder.record(true);
    if (signal.aborted) throw new Error('Recording cancelled.');
    onStage('processing');
    const result = await request<VoiceResult>('/api/voice', {method: 'POST', session, signal, timeoutMs: 125000,
      body: {...recording, action: 'question', consent: true}});
    if (signal.aborted) throw new Error('Recording cancelled.');
    if (typeof result.transcript !== 'string' || !result.transcript.trim() || result.transcript.length > 600) throw new Error('No question was heard. Record at least two seconds of clear speech, with the TV quiet.');
    return result;
  } finally {signal.removeEventListener('abort', cancel);}
}
export function finishRecording() {return recorder?.stop();}
