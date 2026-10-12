import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validPlacement, chooseCorner, placePopup} from '../server/placement.mjs';
import {decodeYolox, detectObjects, semanticFrameBytes} from '../server/placement-semantic.mjs';

const request = {content_id: 'pixel-clip', at_seconds: 0, duration_seconds: 10,
  width_fraction: 0.35, height_fraction: 0.35, captions: false};
const center = {x0: 0.46, y0: 0.46, x1: 0.54, y1: 0.54, score: 0.9, classId: 0};
const topRight = {x0: 0.75, y0: 0.1, x1: 0.85, y1: 0.3, score: 0.9, classId: 0};

test('pixel ranking follows semantic exclusion across every sampled frame and hard caption exclusion', () => {
  assert.equal(validPlacement(request), true);
  for (const patch of [{width_fraction: NaN}, {height_fraction: Infinity}, {width_fraction: 0},
    {height_fraction: 0.91}, {at_seconds: -1}, {duration_seconds: 11}, {captions: 'true'},
    {play_state: 'unknown'}, {content_id: '../escape'}, {extra: true}]) assert.equal(validPlacement({...request, ...patch}), false);
  const quiet = Buffer.alloc(160 * 90), busy = Buffer.from(quiet);
  for (let y = 8; y < 32; y++) for (let x = 110; x < 144; x++) busy[y * 160 + x] = 255;
  assert.equal(chooseCorner([quiet], request, [[center]]), 'top-right');
  assert.equal(chooseCorner([quiet, busy], {...request, captions: true}, [[center], [center]]), 'top-left');
  assert.equal(chooseCorner([quiet, quiet], {...request, captions: true}, [[center], [topRight]]), 'top-left', 'A future player/face box blocks even a quiet corner');
  assert.equal(chooseCorner([quiet], request, [[{...center, classId: 32, x0: 0, y0: 0, x1: 1, y1: 1}]]), null, 'Relevant objects can block every corner');
  assert.equal(chooseCorner([quiet], {...request, captions: true, height_fraction: 0.78}, [[center]]), null, 'Oversized answers never overlap captions');
  for (const detections of [undefined, [], [[]], [[{...center, score: 0.4}]], [[{...center, x0: NaN}]]]) {
    assert.equal(chooseCorner([quiet], request, detections), null, 'Missing or unreliable semantics cannot be promoted to safe pixels');
  }
  assert.throws(() => chooseCorner([], request, [[center]]), /Invalid placement/);
  assert.throws(() => chooseCorner([Buffer.alloc(1)], request, [[center]]), /Invalid placement/);
});

test('official YOLOX raw stride output decoding preserves normalized person boxes and rejects bad tensors', () => {
  const data = new Float32Array(3549 * 85);
  data[0] = 10; data[1] = 10; data[2] = Math.log(4); data[3] = Math.log(6); data[4] = 0.9; data[5] = 0.9;
  const [box] = decodeYolox(data, [1, 3549, 85]);
  assert.equal(box.classId, 0); assert.ok(box.score > 0.8);
  assert.ok(Math.abs(box.x0 - 64 / 416) < 1e-6); assert.ok(Math.abs(box.y1 - 104 / 234) < 1e-6);
  assert.throws(() => decodeYolox(data, [1, 3549, 84]), /Unsupported/);
  data[5] = NaN; assert.throws(() => decodeYolox(data, [1, 3549, 85]), /Non-finite/);
});

test('local published frames, detector uncertainty/errors/deadline and cancellation retain the source trust boundary', async () => {
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(placePopup(null, request, {signal: aborted.signal}), {name: 'AbortError'});
  const root = await mkdtemp(join(tmpdir(), 'selene-placement-test-'));
  try {
    const media = join(root, 'assets/media/pixel-clip'); await mkdir(media, {recursive: true});
    const video = join(media, 'video.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=12',
      '-vf', 'drawbox=x=110:y=8:w=34:h=24:color=white:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    const story = {id: request.content_id, duration: 12, video: '/media/pixel-clip/video.mp4'};
    let sampled = 0;
    const detector = async frames => {sampled = frames.length; assert.ok(frames.every(frame => frame.length === semanticFrameBytes)); return frames.map(() => [center]);};
    const result = await placePopup(story, {...request, captions: true}, {destination: root, detector});
    assert.equal(sampled, 6); assert.equal(result.layout, 'overlay'); assert.equal(result.corner, 'top-left');
    assert.deepEqual(result.semantic, {model: 'yolox-nano', status: 'detected'});
    const ended = await placePopup(story, {...request, at_seconds: 12, captions: true, play_state: 'ended'}, {destination: root, detector});
    assert.equal(sampled, 1); assert.equal(ended.corner, 'top-left');
    for (const detector of [async frames => frames.map(() => []), async () => {throw new Error('Model missing');},
      (frames, {signal}) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}))]) {
      const start = Date.now();
      const fallback = await placePopup(story, {...request, play_state: 'paused'}, {destination: root, detector});
      assert.equal(fallback.layout, 'outside-video'); assert.equal(fallback.corner, null);
      assert.ok(Date.now() - start < 2600, 'Slow detection does not silently extend the two-second deadline');
    }
    const missingModel = await placePopup(story, {...request, play_state: 'paused'}, {destination: root,
      detector: (frames, options) => detectObjects(frames, {...options, modelPath: join(root, 'missing.onnx')})});
    assert.equal(missingModel.layout, 'outside-video'); assert.equal(missingModel.semantic.status, 'unavailable');
    await assert.rejects(placePopup(story, {...request, at_seconds: 12.1}, {destination: root, detector}), /valid timestamp/);
    await assert.rejects(placePopup({...story, video: 'https://example.org/film.mp4'}, request, {destination: root, detector}), /published local/);
    const link = join(media, 'link.mp4'); await symlink(video, link);
    await assert.rejects(placePopup({...story, video: '/media/pixel-clip/link.mp4'}, request, {destination: root, detector}), /published local/);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('installed local YOLOX model processes actual published football footage without remote inference', async () => {
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-ss', '2', '-i', 'assets/media/football-match/video.mp4',
    '-vf', 'scale=416:234:force_original_aspect_ratio=decrease,pad=416:234:(ow-iw)/2:(oh-ih)/2,format=bgr24',
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1']);
  const detections = await detectObjects([pixels], {signal: AbortSignal.timeout(2000)});
  assert.equal(detections.length, 1);
  assert.ok(detections[0].some(box => box.classId === 0 && box.score >= 0.5), 'Actual footage must detect a player/person; test is not a mocked detector');
});
