/* global AbortSignal */
// Native film playback without a WebView: Vega's W3C VideoPlayer fed through MSE.
// URL mode cannot fetch the loopback relay (media error 4), and the WebView decoder stalls after a
// few frames on the VVD, so the app fetches fragmented video/audio tracks (`video-v.mp4`, `video-a.mp4`,
// written beside each `video.mp4` by ingest) and appends them itself.
import {MediaSource, VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import type {SourceBuffer} from '@amazon-devices/react-native-w3cmedia';
import {mediaUrl} from './api';

const CHUNK = 4 * 1024 * 1024;
const AHEAD_SECONDS = 90;
const EVENTS = ['loadedmetadata', 'play', 'pause', 'playing', 'waiting', 'seeking', 'seeked', 'ended', 'timeupdate', 'error'] as const;
export type FilmEvent = typeof EVENTS[number];

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const settled = (buffer: SourceBuffer) => buffer.updating ? new Promise<void>(resolve => {
  const done = () => {buffer.removeEventListener('updateend', done); resolve();};
  buffer.addEventListener('updateend', done);
}) : Promise.resolve();

// RFC 6381 codec string from the avcC box of the init segment, e.g. avc1.64001f.
export function avcCodec(bytes: Uint8Array) {
  for (let i = 0; i + 8 < bytes.length; i++) {
    if (bytes[i] === 0x61 && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x63 && bytes[i + 3] === 0x43) {
      return `avc1.${[bytes[i + 5], bytes[i + 6], bytes[i + 7]].map(value => value.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return null;
}

async function chunk(url: string, start: number, signal: AbortSignal) {
  const response = await fetch(url, {headers: {Range: `bytes=${start}-${start + CHUNK - 1}`}, signal});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Media request failed (${response.status})`);
  const total = Number(response.headers.get('content-range')?.split('/')[1]);
  const data = await response.arrayBuffer();
  return {data, total: Number.isFinite(total) ? total : start + data.byteLength};
}

export class NativeFilm {
  readonly player = new VideoPlayer();
  private ready: Promise<void>;
  private surface: string | null = null;
  private feeding = new AbortController();
  private destroyed = false;

  constructor(private readonly emit: (event: FilmEvent) => void, private readonly fail: (message: string) => void) {
    for (const event of EVENTS) {
      try {this.player.addEventListener(event, () => this.emit(event));} catch { /* an unsupported event only loses that notification */ }
    }
    this.ready = this.player.initialize();
  }

  get currentTime() {return Number.isFinite(this.player.currentTime) ? this.player.currentTime : 0;}
  set currentTime(value: number) {this.player.currentTime = value;}
  get paused() {return this.player.paused;}
  get ended() {return this.player.ended;}
  get seeking() {return this.player.seeking;}
  get duration() {return this.player.duration;}
  get errorCode() {return this.player.error?.code ?? 0;}

  attach(handle: string) {
    this.surface = handle;
    void this.ready.then(() => {if (!this.destroyed && this.surface === handle) this.player.setSurfaceHandle(handle);});
  }
  detach(handle: string) {
    if (this.surface === handle) this.surface = null;
    try {this.player.clearSurfaceHandle(handle);} catch { /* surface already gone */ }
  }

  async load(video: string) {
    await this.ready;
    if (this.destroyed) return;
    this.feeding.abort(); this.feeding = new AbortController();
    const signal = this.feeding.signal;
    const source = new MediaSource();
    source.addEventListener('sourceopen', () => {void this.feed(source, mediaUrl(video).replace(/\.mp4$/, ''), signal).catch(error => {
      if (!signal.aborted) this.fail(error instanceof Error ? error.message : 'The film could not load.');
    });});
    this.player.srcObject = source;
  }

  private async feed(source: MediaSource, stem: string, signal: AbortSignal) {
    const [video, audio] = await Promise.all([chunk(`${stem}-v.mp4`, 0, signal), chunk(`${stem}-a.mp4`, 0, signal)]);
    if (!video) throw new Error('This film has no native playback stream. Re-import it, then try again.');
    const codec = avcCodec(new Uint8Array(video.data));
    if (!codec) throw new Error('This film uses an unsupported video format.');
    const tracks = [{buffer: source.addSourceBuffer(`video/mp4; codecs="${codec}"`), url: `${stem}-v.mp4`, first: video}];
    // ponytail: assumes AAC-LC audio (what ingest and the catalog produce); sniff esds if HE-AAC sources appear.
    if (audio) tracks.push({buffer: source.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"'), url: `${stem}-a.mp4`, first: audio});
    await Promise.all(tracks.map(track => this.append(track.buffer, track.url, track.first, signal)));
    if (!signal.aborted && source.readyState === 'open') source.endOfStream();
  }

  private async append(buffer: SourceBuffer, url: string, first: {data: ArrayBuffer; total: number}, signal: AbortSignal) {
    let next: {data: ArrayBuffer; total: number} | null = first;
    let offset = 0;
    while (next && !signal.aborted) {
      // Keep a bounded lead over the playhead; short catalog films load completely.
      while (!signal.aborted && this.bufferedEnd(buffer) - this.currentTime > AHEAD_SECONDS) await wait(1000);
      await settled(buffer);
      try {buffer.appendBuffer(next.data);}
      catch (error) {
        if ((error as Error)?.name !== 'QuotaExceededError') throw error;
        // ponytail: frees played media and retries; rewinding far into freed media refetches nothing (re-open the film).
        buffer.remove(0, Math.max(0, this.currentTime - 30)); await settled(buffer); await wait(1000); continue;
      }
      await settled(buffer);
      offset += next.data.byteLength;
      next = offset < next.total ? await chunk(url, offset, signal) : null;
    }
  }

  private bufferedEnd(buffer: SourceBuffer) {
    try {const ranges = buffer.buffered; return ranges.length ? ranges.end(ranges.length - 1) : 0;} catch {return 0;}
  }

  play() {return this.player.play();}
  pause() {this.player.pause();}

  destroy() {
    this.destroyed = true;
    this.feeding.abort();
    void this.ready.then(() => this.player.deinitialize()).catch(() => undefined);
  }
}
