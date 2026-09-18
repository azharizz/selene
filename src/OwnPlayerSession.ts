import {
  AudioFocusMode,
  ErrorCode,
  PlayerMediaOps,
  PlayerSession,
  PlayerState,
  PlayerTrackRating,
  PlayerRepeatMode,
  PlayerShuffleMode,
} from '@amazon-devices/react-native-kepler';

export type BrowserPlayerState = {
  state: 'playing' | 'paused' | 'buffering' | 'stopped';
  position_ms: number;
  duration_ms: number;
  muted: boolean;
  volume: number;
};
type Bridge = (message: object) => void;

const supportedMediaOps = PlayerMediaOps ? PlayerMediaOps.PLAYER_MEDIA_OP_PLAY |
  PlayerMediaOps.PLAYER_MEDIA_OP_PAUSE |
  PlayerMediaOps.PLAYER_MEDIA_OP_SEEK_TO |
  PlayerMediaOps.PLAYER_MEDIA_OP_REWIND |
  PlayerMediaOps.PLAYER_MEDIA_OP_FF |
  PlayerMediaOps.PLAYER_MEDIA_OP_STOP |
  PlayerMediaOps.PLAYER_MEDIA_OP_START_OVER |
  PlayerMediaOps.PLAYER_MEDIA_OP_SET_VOL : 0;

export class OwnPlayerSession {
  private active = false;
  private latest: BrowserPlayerState = {state: 'paused', position_ms: 0, duration_ms: 0, muted: false, volume: 1};
  private focus = AudioFocusMode.AUDIO_FOCUS_NONE;

  constructor(private readonly bridge: Bridge) {}

  start() {
    if (this.active) return;
    try {
      if (!PlayerSession.create()) throw new Error('Player session unavailable');
      PlayerSession.setPlayerSessionCallback({
        onPlay: () => this.bridge({type: 'selene:native-player', action: 'play'}),
        onPause: () => this.bridge({type: 'selene:native-player', action: 'pause'}),
        onStop: () => this.bridge({type: 'selene:native-player', action: 'stop'}),
        onRewind: seconds => this.bridge({type: 'selene:native-player', action: 'seek', by_ms: -Math.max(0, seconds) * 1000}),
        onFastForward: seconds => this.bridge({type: 'selene:native-player', action: 'seek', by_ms: Math.max(0, seconds) * 1000}),
        onStartOver: () => this.bridge({type: 'selene:native-player', action: 'start_over'}),
        onSeekTo: (positionMs, relative) => this.bridge({type: 'selene:native-player', action: 'seek', position_ms: positionMs, relative}),
        onRequestPlayerPlaybackStateInfo: () => this.bridge({type: 'selene:native-player', action: 'request_state'}),
        onSetVolume: volume => this.bridge({type: 'selene:native-player', action: 'set_volume', volume}),
        onSetMute: muted => this.bridge({type: 'selene:native-player', action: 'set_mute', muted}),
      });
      this.active = true;
      this.bridge({type: 'selene:native-player', action: 'available', available: true});
    } catch {
      this.bridge({type: 'selene:native-player', action: 'available', available: false});
    }
  }

  stop() {
    if (!this.active) return;
    try {PlayerSession.destroy();} finally {this.active = false;}
  }

  requestState() {if (this.active) this.bridge({type: 'selene:native-player', action: 'request_state'});}

  update(state: BrowserPlayerState) {
    this.latest = state;
    this.publish();
  }

  setAudioFocus(focused: boolean) {
    this.focus = focused ? AudioFocusMode.AUDIO_FOCUS_PAUSED_FOR_UNMIXABLE : this.audioFocusForPlayback();
    this.publish();
  }

  private audioFocusForPlayback() {return this.latest.state === 'playing' ? AudioFocusMode.AUDIO_FOCUS_PRIMARY : AudioFocusMode.AUDIO_FOCUS_NONE;}

  private publish() {
    if (!this.active) return;
    const state = this.latest.state === 'playing' ? PlayerState.PLAYER_STATE_PLAYING
      : this.latest.state === 'buffering' ? PlayerState.PLAYER_STATE_BUFFERING
        : this.latest.state === 'stopped' ? PlayerState.PLAYER_STATE_STOPPED : PlayerState.PLAYER_STATE_PAUSED;
    const position = Math.max(0, Math.round(this.latest.position_ms));
    const duration = Math.max(position, Math.round(this.latest.duration_ms));
    PlayerSession.setPlaybackState({
      state, supportedMediaOps, errorCode: ErrorCode.ERROR_APP_NONE, errorCodeString: '',
      timeRangeData: {minSeekMs: 0, maxSeekMs: duration, trackPositionMs: position},
      audioFocus: this.focus === AudioFocusMode.AUDIO_FOCUS_PAUSED_FOR_UNMIXABLE ? this.focus : this.audioFocusForPlayback(),
      currentPlaybackSpeed: 1, repeatMode: PlayerRepeatMode.PLAYER_REPEAT_MODE_NONE, shuffleMode: PlayerShuffleMode.PLAYER_SHUFFLE_MODE_PLAYLIST_OFF,
      trackRating: PlayerTrackRating.PLAYER_RATING_NONE, audioTrackAvailableLanguages: [], captionTrackInfo: [],
    });
  }
}
