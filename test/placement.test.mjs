import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validPlacement, chooseCorner, placePopup} from '../server/placement.mjs';

const request = {content_id: 'pixel-clip', at_seconds: 0, duration_seconds: 10,
  width_fraction: 0.35, height_fraction: 0.35, captions: false};

test('placement uses actual rectangle pixels, lookahead motion and caption exclusion, never invalid inputs', async t => {
  assert.equal(validPlacement(request), true);
  for (const patch of [{width_fraction: NaN}, {height_fraction: Infinity}, {width_fraction: 0},
    {height_fraction: 0.91}, {at_seconds: -1}, {duration_seconds: 11}, {captions: 'true'},
    {play_state: 'unknown'}, {content_id: '../escape'}, {extra: true}]) {
    assert.equal(validPlacement({...request, ...patch}), false);
  }
  const quiet = Buffer.alloc(160 * 90), busy = Buffer.from(quiet);
  for (let y = 8; y < 32; y++) for (let x = 110; x < 144; x++) busy[y * 160 + x] = 255;
  assert.equal(chooseCorner([quiet], request), 'top-right', 'A genuine pixel-score tie has deterministic placement');
  assert.equal(chooseCorner([quiet, busy], {...request, captions: true}), 'top-left', 'Later salient pixels must influence placement');
  assert.equal(chooseCorner([busy], {...request, captions: true}), 'top-left');
  assert.equal(chooseCorner([quiet], {...request, captions: true, height_fraction: 0.77}), 'top-right');
  assert.throws(() => chooseCorner([], request), /Invalid placement/);
  assert.throws(() => chooseCorner([Buffer.alloc(1)], request), /Invalid placement/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(placePopup(null, request, {signal: aborted.signal}), {name: 'AbortError'});

  try {execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'});} catch {t.diagnostic('FFmpeg unavailable; source-pixel integration not exercised'); return;}
  const root = await mkdtemp(join(tmpdir(), 'selene-placement-test-'));
  try {
    const media = join(root, 'assets/media/pixel-clip'); await mkdir(media, {recursive: true});
    const video = join(media, 'video.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=12',
      '-vf', 'drawbox=x=110:y=8:w=34:h=24:color=white:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    const story = {id: request.content_id, duration: 12, video: '/media/pixel-clip/video.mp4'};
    assert.deepEqual(await placePopup(story, {...request, captions: true}, {destination: root}),
      {corner: 'top-left', at_seconds: 0, duration_seconds: 10});
    assert.deepEqual(await placePopup(story, {...request, at_seconds: 12, captions: true, play_state: 'ended'}, {destination: root}),
      {corner: 'top-left', at_seconds: 12, duration_seconds: 10});
    await assert.rejects(placePopup(story, {...request, at_seconds: 12.1}, {destination: root}), /valid timestamp/);
    await assert.rejects(placePopup({...story, video: 'https://example.org/film.mp4'}, request, {destination: root}), /published local/);
    const link = join(media, 'link.mp4'); await symlink(video, link);
    await assert.rejects(placePopup({...story, video: '/media/pixel-clip/link.mp4'}, request, {destination: root}), /published local/);
  } finally {await rm(root, {recursive: true, force: true});}
});
