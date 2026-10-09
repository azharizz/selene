// Fire TV remote media keys. Vega delivered these through PlayerSession; on Fire OS the play/pause,
// fast-forward and rewind keys arrive as react-native-tvos TV events. Player.tsx keeps the same API.
import {TVEventHandler} from 'react-native';

export type BrowserPlayerState = {state: 'playing' | 'paused' | 'buffering' | 'stopped'; position_ms: number; duration_ms: number; muted: boolean; volume: number};
type Bridge = (message: {type: string; action: string; position_ms?: number; relative?: boolean}) => void;

export class OwnPlayerSession {
  private latest: BrowserPlayerState['state'] = 'paused';
  private subscription: {remove: () => void} | null = null;
  constructor(private readonly bridge: Bridge) {}

  start() {
    if (this.subscription) return;
    this.subscription = TVEventHandler.addListener(event => {
      const send = (action: string, extra: object = {}) => this.bridge({type: 'selene:native-player', action, ...extra});
      if (event?.eventType === 'playPause') send(this.latest === 'playing' || this.latest === 'buffering' ? 'pause' : 'play');
      if (event?.eventType === 'play') send('play');
      if (event?.eventType === 'pause') send('pause');
      if (event?.eventType === 'fastForward') send('seek', {position_ms: 10000, relative: true});
      if (event?.eventType === 'rewind') send('seek', {position_ms: -10000, relative: true});
    }) ?? null;
  }
  stop() {this.subscription?.remove(); this.subscription = null;}
  update(state: BrowserPlayerState) {this.latest = state.state;}
}
