import {personalRequest} from './personal';

type VoiceAction = {stop: () => void; restore: () => void; finish?: () => void};
export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';
export type VoiceResult = {transcript: string; requester: {id: string} | null; match: 'matched' | 'unknown'; voice_available: boolean};

// Own one explicit voice action. Late events must never restore a newer action's audio.
export class Voice {
  readonly canListen = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof window.AudioContext === 'function' && typeof window.OfflineAudioContext === 'function';
  readonly canSpeak = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  private active: VoiceAction | null = null;
  private consented = false;
  constructor(private player: () => HTMLVideoElement | null, private changed: (state: VoiceState) => void, private failed: (message: string) => void, private focus?: (focused: boolean) => void) {}

  stop = () => {
    const active = this.active;
    this.active = null;
    if (active) {
      try {active.stop();}
      catch {this.failed('Voice control failed. Close SELENE if the microphone or speech continues.');}
      finally {active.restore(); this.changed('idle');}
    }
    this.focus?.(false);
  };
  finishListening = () => {
    const finish = this.active?.finish;
    if (this.active) this.active.finish = undefined;
    try {finish?.();}
    catch {this.stop(); this.failed('Voice input could not finish. Enter your request with the keyboard.');}
  };

  private begin(stop: () => void, mode: VoiceState) {
    this.stop();
    const player = this.player();
    const muted = player?.muted;
    if (player) player.muted = true;
    const action: VoiceAction = {stop, restore: () => {if (player && muted !== undefined) player.muted = muted;}};
    this.active = action;
    this.changed(mode);
    this.focus?.(true);
    return action;
  }

  listen(endpoint: string, headers: Record<string, string>, accept: (result: VoiceResult) => void) {
    if (!this.canListen || (!this.consented && !window.confirm('Record your question and compare your voice with consented, enrolled profiles? Audio is sent for transcription, then deleted. Review your words before sending. This does not enroll you.'))) return;
    this.consented = true;
    const controller = new AbortController();
    let stream: MediaStream | null = null, context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null, processor: ScriptProcessorNode | null = null, gain: GainNode | null = null;
    let timer = 0;
    const chunks: Float32Array[] = []; let samples = 0;
    const release = () => {
      clearTimeout(timer); timer = 0;
      if (processor) processor.onaudioprocess = null;
      source?.disconnect(); processor?.disconnect(); gain?.disconnect();
      source = null; processor = null; gain = null;
      stream?.getTracks().forEach(track => track.stop()); stream = null;
      if (context) {void context.close().catch(() => {}); context = null;}
    };
    const action = this.begin(() => {controller.abort(); release(); chunks.length = 0;}, 'listening');
    const failed = (error: unknown) => {
      if (this.active !== action || controller.signal.aborted) return;
      this.stop(); this.failed(error instanceof Error ? error.message : 'Voice input is unavailable. Use the keyboard.');
    };
    const finish = async () => {
      if (this.active !== action || !context) return;
      action.finish = undefined;
      const rate = context.sampleRate;
      release(); this.changed('processing');
      try {
        if (samples < rate * 2) throw new Error('Record at least two seconds of clear speech.');
        const offline = new OfflineAudioContext(1, Math.floor(samples * 16000 / rate), 16000);
        const buffer = offline.createBuffer(1, samples, rate), channel = buffer.getChannelData(0);
        let offset = 0;
        for (const chunk of chunks) {channel.set(chunk, offset); offset += chunk.length;}
        chunks.length = 0;
        const input = offline.createBufferSource(); input.buffer = buffer; input.connect(offline.destination); input.start();
        const pcm = (await offline.startRendering()).getChannelData(0);
        controller.signal.throwIfAborted();
        const bytes = new Uint8Array(44 + pcm.length * 2), view = new DataView(bytes.buffer);
        const text = (at: number, value: string) => {for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);};
        text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        text(36, 'data'); view.setUint32(40, pcm.length * 2, true);
        for (let i = 0; i < pcm.length; i++) {const value = Math.max(-1, Math.min(1, pcm[i])); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);}
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        const result = await personalRequest(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, signal: controller.signal,
          body: JSON.stringify({audio: btoa(binary), format: 'wav', action: 'question', consent: true})}, 150000) as VoiceResult;
        if (this.active !== action || controller.signal.aborted) return;
        if (typeof result.transcript !== 'string' || !result.transcript.trim() || result.transcript.length > 600) throw new Error('No clear speech was heard. Try again or type your question.');
        accept(result); this.stop();
      } catch (error) {failed(error);}
    };
    void (async () => {
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true}, video: false});
        if (this.active !== action) {acquired.getTracks().forEach(track => track.stop()); return;}
        stream = acquired; context = new AudioContext();
        source = context.createMediaStreamSource(stream);
        // ponytail: bounded 20-second capture; use AudioWorklet if main-thread dropouts become measurable.
        processor = context.createScriptProcessor(4096, 1, 1); gain = context.createGain(); gain.gain.value = 0;
        source.connect(processor); processor.connect(gain); gain.connect(context.destination);
        const maximum = Math.floor(context.sampleRate * 20);
        processor.onaudioprocess = event => {
          if (this.active !== action) return;
          const data = event.inputBuffer.getChannelData(0), count = Math.min(data.length, maximum - samples);
          if (count > 0) {chunks.push(data.slice(0, count)); samples += count;}
          if (samples === maximum) void finish();
        };
        action.finish = () => {void finish();};
        timer = window.setTimeout(() => {void finish();}, 20000);
        await context.resume();
      } catch (error) {failed(error);}
    })();
  }

  speak(text: string, language: string, slowerAnswer: boolean) {
    if (!this.canSpeak) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language; utterance.rate = slowerAnswer ? 0.85 : 1;
    const action = this.begin(() => {
      utterance.onend = null; utterance.onerror = null; window.speechSynthesis.cancel();
    }, 'speaking');
    utterance.onend = () => {if (this.active === action) this.stop();};
    utterance.onerror = () => {
      if (this.active !== action) return;
      this.stop(); this.failed('Read aloud is unavailable. The answer remains on screen.');
    };
    try {window.speechSynthesis.speak(utterance);} catch {
      this.stop(); this.failed('Read aloud could not start. The answer remains on screen.');
    }
  }
}
