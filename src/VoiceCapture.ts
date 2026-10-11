import {AudioChannelMask, AudioSampleFormat, AudioSampleRate, AudioSource} from '@amazon-devices/keplerscript-audio-lib';
import AudioRecordStreamBuilder from '@amazon-devices/keplerscript-audio-lib/dist/AudioRecordStreamBuilder';
import type AudioRecordStream from '@amazon-devices/keplerscript-audio-lib/dist/AudioRecordStream';
import {SecurityManager, PrivilegeState} from '@amazon-devices/security-manager-lib';
import {fromByteArray} from 'base64-js';

const MICROPHONE = 'com.amazon.audio.privilege.microphone.access';
const RATE = AudioSampleRate.SAMPLE_RATE_16_KHZ;
const MAX_DATA = 16_000 * 2 * 20;

export class VoiceCapture {
  private stream: AudioRecordStream | null = null;
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private stopped = true;
  private opening: Promise<void> | null = null;
  private reading: Promise<void> | null = null;
  private failed: Error | null = null;
  private closing: Promise<void> | null = null;
  private onLimit?: () => void;

  start(onLimit: () => void, onError: (error: Error) => void, onPermissionRequest: () => Promise<boolean>) {
    if (!this.stopped || this.opening || this.reading || this.closing) throw new Error('Recording is already active or still closing.');
    this.stopped = false;
    this.chunks = []; this.bytes = 0; this.failed = null; this.onLimit = onLimit;
    this.opening = this.open(onError, onPermissionRequest);
    return this.opening;
  }

  private async open(onError: (error: Error) => void, onPermissionRequest: () => Promise<boolean>) {
    const state = await SecurityManager.getPrivilegeState(MICROPHONE);
    if (this.stopped) return;
    if (state !== PrivilegeState.ALLOW && !await onPermissionRequest()) throw new Error('Microphone access was not granted.');
    if (this.stopped) return;
    if (state !== PrivilegeState.ALLOW && await SecurityManager.requestPrivilege(MICROPHONE) !== PrivilegeState.ALLOW) throw new Error('Microphone access was not granted.');
    if (this.stopped) return;
    const builder = new AudioRecordStreamBuilder();
    builder.setAudioConfig({sampleRate: RATE, channelMask: AudioChannelMask.CHANNEL_MONO, format: AudioSampleFormat.FORMAT_PCM_16_BIT});
    builder.setAudioSource(AudioSource.VOICE_RECOGNITION);
    const stream = await builder.buildAsync();
    if (this.stopped) {await AudioRecordStreamBuilder.destroyAsync(stream); return;}
    this.stream = stream;
    const size = await stream.getMinBufferSizeInBytesAsync();
    if (this.stopped) return;
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error('The microphone could not start recording.');
    this.reading = this.read(stream, size, onError);
  }

  private async read(stream: AudioRecordStream, size: number, onError: (error: Error) => void) {
    try {
      while (!this.stopped) {
        const chunk = new Uint8Array(await stream.readAsync(size));
        if (this.stopped) break;
        const count = Math.floor(Math.min(chunk.byteLength, MAX_DATA - this.bytes) / 2) * 2;
        if (count > 0) {this.chunks.push(chunk.slice(0, count)); this.bytes += count;}
        if (count < chunk.byteLength || this.bytes >= MAX_DATA) {
          this.stopped = true;
          this.onLimit?.();
          break;
        }
      }
    } catch (error) {
      if (!this.stopped) {
        this.failed = error instanceof Error ? error : new Error('The microphone recording failed.');
        this.stopped = true;
        onError(this.failed);
      }
    }
  }

  async stop() {
    await this.opening;
    const stream = this.stream; this.stream = null; this.stopped = true;
    if (stream) await AudioRecordStreamBuilder.destroyAsync(stream).catch(() => undefined);
    await this.reading?.catch(() => undefined);
    if (this.failed) {const error = this.failed; this.discard(); throw error;}
    if (this.bytes < RATE * 2 * 2) {this.discard(); throw new Error('Record at least two seconds of clear speech.');}
    const dataLength = this.bytes, wav = new Uint8Array(44 + dataLength), view = new DataView(wav.buffer);
    wav.set([82, 73, 70, 70], 0); view.setUint32(4, 36 + dataLength, true); wav.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    wav.set([100, 97, 116, 97], 36); view.setUint32(40, dataLength, true);
    let offset = 44;
    for (const chunk of this.chunks) {wav.set(chunk, offset); offset += chunk.byteLength;}
    this.discard();
    return fromByteArray(wav);
  }

  cancel() {
    if (this.closing) return this.closing;
    this.stopped = true;
    const closing = this.close().finally(() => {this.closing = null;});
    this.closing = closing;
    return closing;
  }

  private async close() {
    await this.opening?.catch(() => undefined);
    const stream = this.stream; this.stream = null;
    if (stream) await AudioRecordStreamBuilder.destroyAsync(stream).catch(() => undefined);
    await this.reading?.catch(() => undefined);
    this.discard();
  }

  private discard() {
    this.chunks = []; this.bytes = 0; this.failed = null; this.opening = null; this.reading = null; this.onLimit = undefined;
  }
}
