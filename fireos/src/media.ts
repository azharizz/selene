// Fire OS film playback: expo-video (ExoPlayer) streams the progressive MP4 directly. Vega needed MSE
// because its URL mode could not reach the loopback relay; ExoPlayer can, so the same NativeFilm surface
// (play/pause/seek/currentTime + HTML-like events) wraps a plain player here.
import {createVideoPlayer} from 'expo-video';
import type {VideoPlayer} from 'expo-video';
import {mediaUrl} from './api';

const offlineDemos: Record<string, number> = {
  'football-match': require('../assets/offline/football-match.mp4'),
  'the-missing-crown': require('../assets/offline/the-missing-crown.mp4'),
};

export type FilmEvent = 'loadedmetadata' | 'play' | 'pause' | 'playing' | 'waiting' | 'seeking' | 'seeked' | 'ended' | 'timeupdate' | 'error';

export class NativeFilm {
  readonly player: VideoPlayer = createVideoPlayer(null);
  private loaded = false;
  private finished = false;
  private subscriptions: {remove: () => void}[];

  constructor(private readonly emit: (event: FilmEvent) => void, private readonly fail: (message: string) => void) {
    const player = this.player;
    player.timeUpdateEventInterval = 0.25;
    this.subscriptions = [
      player.addListener('statusChange', ({status, error}) => {
        if (status === 'loading') emit('waiting');
        if (status === 'readyToPlay' && !this.loaded) {this.loaded = true; emit('loadedmetadata');}
        if (status === 'readyToPlay' && player.playing) emit('playing');
        if (status === 'error') fail(error?.message ? `The film could not load: ${error.message}` : 'The film could not load. Check the SELENE service, then reload the film.');
      }),
      player.addListener('playingChange', ({isPlaying}) => {
        if (!isPlaying && this.finished) return; // ExoPlayer stops after playToEnd; that is the end, not a pause.
        if (isPlaying) this.finished = false;
        emit(isPlaying ? 'play' : 'pause');
        if (isPlaying) emit('playing');
      }),
      player.addListener('timeUpdate', () => emit('timeupdate')),
      player.addListener('playToEnd', () => {if (!this.loaded) return; this.finished = true; emit('ended');}), // ignore the empty player's end at load
    ];
  }

  get currentTime() {return Number.isFinite(this.player.currentTime) ? this.player.currentTime : 0;}
  set currentTime(value: number) {this.finished = false; this.emit('seeking'); this.player.currentTime = value; this.emit('seeked');}
  get paused() {return !this.player.playing;}
  get ended() {return this.finished;}
  get seeking() {return false;}
  get duration() {return this.player.duration;}
  get errorCode() {return this.player.status === 'error' ? 1 : 0;}

  load(video: string, contentId: string) {
    this.loaded = false; this.finished = false;
    this.player.replace(offlineDemos[contentId] ?? {uri: mediaUrl(video)}, true);
  }

  // Resolves once ExoPlayer reports playing (callers check `paused` right after), or after 3s.
  play() {
    this.player.play();
    if (this.player.playing) return Promise.resolve();
    return new Promise<void>(resolve => {
      const done = () => {clearTimeout(timer); subscription.remove(); resolve();};
      const subscription = this.player.addListener('playingChange', ({isPlaying}) => {if (isPlaying) done();});
      const timer = setTimeout(done, 3000);
    });
  }
  pause() {this.player.pause();}

  destroy() {
    this.subscriptions.forEach(subscription => subscription.remove());
    this.player.release();
  }
}
