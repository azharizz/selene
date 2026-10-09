import {execFile} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const width = 160, height = 90, frameBytes = width * height;
const corners = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
const fields = ['content_id', 'at_seconds', 'duration_seconds', 'width_fraction', 'height_fraction', 'captions', 'play_state'];

export function validPlacement(input) {
  return !!input && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).every(key => fields.includes(key))
    && typeof input.content_id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.content_id)
    && Number.isFinite(input.at_seconds) && input.at_seconds >= 0 && input.duration_seconds === 10
    && [input.width_fraction, input.height_fraction].every(value => Number.isFinite(value) && value > 0 && value <= 0.9)
    && typeof input.captions === 'boolean'
    && (input.play_state === undefined || ['playing', 'paused', 'ended'].includes(input.play_state));
}

export function chooseCorner(frames, input) {
  if (!validPlacement(input) || !Array.isArray(frames) || !frames.length || frames.length > 6
    || frames.some(frame => !Buffer.isBuffer(frame) || frame.length !== frameBytes)) throw new Error('Invalid placement pixels or rectangle');
  const rectangles = corners.map(corner => {
    const x = corner.endsWith('right') ? 0.95 - input.width_fraction : 0.05;
    const y = corner.startsWith('bottom') ? 0.95 - input.height_fraction : 0.05;
    return {corner, x0: Math.floor(x * width), y0: Math.floor(y * height),
      x1: Math.ceil((x + input.width_fraction) * width), y1: Math.ceil((y + input.height_fraction) * height),
      captionOverlap: input.captions ? Math.max(0, y + input.height_fraction - Math.max(y, 0.82)) : 0};
  });
  // Hard-exclude the caption band where possible; oversized panels choose the least overlap first.
  const leastOverlap = Math.min(...rectangles.map(rectangle => rectangle.captionOverlap));
  const candidates = rectangles.filter(rectangle => rectangle.captionOverlap <= leastOverlap + 1e-9);
  let best = candidates[0].corner, bestScore = Infinity;
  // ponytail: pixel edges/contrast/motion approximate salience, not faces or narrative meaning;
  // a local semantic detector can replace this scorer if textured backgrounds dominate useful content.
  for (const rectangle of candidates) {
    let total = 0, peak = 0;
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index], previous = frames[index - 1];
      let score = 0;
      for (let y = rectangle.y0; y < rectangle.y1; y++) {
        for (let x = rectangle.x0; x < rectangle.x1; x++) {
          const p = y * width + x;
          const left = frame[y * width + Math.max(0, x - 1)], right = frame[y * width + Math.min(width - 1, x + 1)];
          const above = frame[Math.max(0, y - 1) * width + x], below = frame[Math.min(height - 1, y + 1) * width + x];
          score += Math.abs(right - left) + Math.abs(below - above)
            + Math.abs(frame[p] - (left + right + above + below) / 4)
            + (previous ? 2 * Math.abs(frame[p] - previous[p]) : 0);
        }
      }
      total += score; peak = Math.max(peak, score);
    }
    // A salient later sample cannot disappear into an otherwise quiet ten-second average.
    const score = total / frames.length + peak;
    if (score < bestScore) {bestScore = score; best = rectangle.corner;}
  }
  return best;
}

async function sourceFrames(story, input, signal, destination) {
  if (!story || story.id !== input.content_id || !Number.isFinite(story.duration) || story.duration <= 0
    || input.at_seconds > story.duration || typeof story.video !== 'string'
    || !(story.video === `/media/${story.id}.mp4`
      || new RegExp(`^/media/${story.id}/[a-zA-Z0-9][a-zA-Z0-9._-]*\\.mp4$`).test(story.video))) {
    throw new Error('Placement requires a published local video and valid timestamp');
  }
  const base = await realpath(join(destination, 'assets/media'));
  const video = join(base, story.video.slice('/media/'.length));
  if (await realpath(video) !== video) throw new Error('Placement requires the published local video');
  signal.throwIfAborted();
  const at = Math.min(input.at_seconds, Math.max(0, story.duration - 0.1));
  const playing = (input.play_state ?? 'playing') === 'playing';
  const count = playing ? 6 : 1;
  const horizon = playing ? Math.min(10.1, story.duration - at) : Math.min(0.1, story.duration - at);
  const pixels = await new Promise((resolve, reject) => {
    // Decode reference frames only: unlike keyframe-only sampling, this retains near-current pixels
    // while avoiding disposable B-frame work across the ten-second window.
    execFile('ffmpeg', ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-threads', '2',
      '-skip_frame', playing && horizon >= 2 ? 'noref' : 'default',
      '-ss', String(at), '-t', String(horizon), '-i', video, '-map', '0:v:0', '-an', '-sn', '-dn',
      '-filter_threads', '1', '-vf', "select=isnan(prev_selected_t)+gte(t-prev_selected_t\\,2),scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,format=gray",
      '-frames:v', String(count), '-fps_mode', 'vfr', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    {signal, maxBuffer: 6 * frameBytes, encoding: 'buffer'}, (error, stdout) => {
      if (signal.aborted) reject(signal.reason);
      else if (error) reject(new Error('Placement frame extraction failed'));
      else resolve(stdout);
    });
  });
  signal.throwIfAborted();
  if (!pixels.length || pixels.length % frameBytes || pixels.length > 6 * frameBytes) throw new Error('Placement source frames unavailable');
  return Array.from({length: pixels.length / frameBytes}, (_, index) => pixels.subarray(index * frameBytes, (index + 1) * frameBytes));
}

export async function placePopup(story, input, {signal, destination = root} = {}) {
  if (!validPlacement(input)) throw new Error('Invalid placement request');
  // Placement is local-only and time-sensitive: abort decoding instead of returning a stale choice.
  const stop = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(2000)]);
  stop.throwIfAborted();
  const frames = await sourceFrames(story, input, stop, destination);
  const corner = chooseCorner(frames, input);
  stop.throwIfAborted();
  return {corner, at_seconds: input.at_seconds, duration_seconds: 10};
}
