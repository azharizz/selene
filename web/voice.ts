type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: {results: {transcript: string}[][]}) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type VoiceAction = {stop: () => void; restore: () => void; finish?: () => void};
const browser = window as Window & {SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition};
export type VoiceState = 'idle' | 'listening' | 'speaking';

// Own one explicit voice action. Late speech events must never restore a newer action's audio.
export class Voice {
  readonly Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  readonly canSpeak = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  private active: VoiceAction | null = null;
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

  listen(language: string, accept: (text: string) => void) {
    if (!this.Recognition) return;
    const recognition = new this.Recognition();
    recognition.lang = language; recognition.continuous = false; recognition.interimResults = false;
    const action = this.begin(() => {
      recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.abort();
    }, 'listening');
    action.finish = () => recognition.stop();
    recognition.onresult = event => {
      if (this.active === action && event.results[0]?.[0]?.transcript) accept(event.results[0][0].transcript.slice(0, 600));
    };
    recognition.onend = () => {if (this.active === action) this.stop();};
    recognition.onerror = () => {
      if (this.active !== action) return;
      this.stop(); this.failed('Voice input is unavailable. Choose a request or enter it with the keyboard.');
    };
    try {recognition.start();} catch {
      this.stop(); this.failed('The microphone could not start. Choose a request or use the keyboard.');
    }
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
