import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, readdir, rm, mkdir} from 'node:fs/promises';
import {existsSync, createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {parseCaptions, transcriptionCues, ingest, observeWindow} from '../scripts/ingest-video.mjs';
import {sceneContext} from '../server/context.mjs';

const graph = async story => ({version: 1, status: story.transcript.length ? 'ready' : 'unavailable', model: 'test-only', nodes: [], edges: []});
const importClip = (options, transcriber, transport, builder = graph) => ingest(options, transcriber, transport, builder);
const fixtureOptions = (root, video, id = 'test-clip') => ({id, title: 'Test clip', video, duration: 6, destination: root, permitted: true,
  source: 'https://example.org/source', license: 'https://example.org/license', credit: 'Generated test fixture', model: 'test-only'});
function ffmpegAvailable(t) {
  try {execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'}); return true;} catch {t.skip('FFmpeg required for media integration'); return false;}
}

test('SRT and WebVTT retain complete cues, markup text, precise times and the entire transcript', () => {
  const srt = '\uFEFF1\r\n00:01:00,125 --> 00:01:02,500\r\n<i>Hello</i> &amp; goodbye.\r\n\r\n2\r\n00:01:03,000 --> 00:01:05,000\r\nFuture words.';
  const cues = parseCaptions(srt, 60, 4);
  assert.equal(cues.length, 1); assert.equal(cues[0].start, 0.125); assert.equal(cues[0].end, 2.5); assert.equal(cues[0].text, 'Hello & goodbye.');
  assert.equal(parseCaptions('WEBVTT\n\nNOTE not evidence\nignored\n\ncue\n00:01.000 --> 00:03.000 align:center\n<v speaker>Hello</v>')[0].text, 'Hello');
  assert.throws(() => parseCaptions('1\n00:01:61,000 --> 00:02:03,000\nBad.'), /timestamp/);
  assert.throws(() => parseCaptions('1\n00:00:03,000 --> 00:00:02,000\nBad.'), /end/);
  assert.throws(() => parseCaptions(srt, 60.5, 1), /No complete/);
  assert.deepEqual(parseCaptions('WEBVTT\n\n', 0, 5, true), []);
  assert.throws(() => parseCaptions('Not timed captions.', 0, 5, true), /timestamp/);
  assert.equal(parseCaptions(Array.from({length: 2001}, (_, index) => `${index + 1}\n00:00:01,000 --> 00:00:02,000\nSource words.`).join('\n\n')).length, 2001);
  assert.throws(() => parseCaptions('x'.repeat(1048577)), /Invalid caption input/);
  assert.throws(() => parseCaptions(`1\n00:00:01,000 --> 00:00:02,000\n${'x'.repeat(1201)}`), /Caption text/);
  const generated = transcriptionCues({segments: [{start: 0.1, end: 2, text: 'Heard words.'}]}, 5);
  assert.equal(generated[0].source, 'machine_transcription'); assert.match(generated[0].verification, /provisional/);
  assert.throws(() => transcriptionCues({segments: [{start: 0, end: 6, text: 'Outside.'}]}, 5), /segment/);
});

test('real FFmpeg imports publish only poster/video plus the entire caption graph, atomically', async t => {
  if (!ffmpegAvailable(t)) return;
  const root = await mkdtemp(join(tmpdir(), 'selene-import-'));
  try {
    const video = join(root, 'input.mp4'); const captions = join(root, 'input.vtt');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    const captionsText = Array.from({length: 2001}, (_, index) => `${index + 1}\n00:00:00,100 --> 00:00:02,000\nCaption ${index + 1}.`).join('\n\n');
    await writeFile(captions, captionsText);
    const options = {...fixtureOptions(root, video), captions};
    let calls = 0;
    const result = await importClip(options, undefined, undefined, async (story, {signal}) => {
      calls++; assert.equal(story.transcript.length, 2001); assert.equal(story.transcript.at(-1).text, 'Caption 2001.');
      assert.deepEqual(story.facts, []); assert.equal(story.ingestion.frames, undefined);
      assert.equal(existsSync(join(root, 'content/test-clip.json')), false); signal?.throwIfAborted(); return graph(story);
    });
    assert.equal(calls, 1); assert.equal(result.movie_graph.status, 'ready'); assert.equal(result.scenes.at(-1).end, 6);
    assert.equal(result.ingestion.caption_source, 'supplied'); assert.equal(result.ingestion.sample_interval_seconds, undefined);
    assert.deepEqual(await readdir(join(root, 'assets/media/test-clip')), ['poster.jpg', 'video-v.mp4', 'video.mp4']);
    await assert.rejects(importClip(options), /already exists/);
    await assert.rejects(importClip({...options, id: '../escape'}), /safe ID/);
    await assert.rejects(importClip({...options, id: 'not-permitted', permitted: false}), /Permission/);
    await assert.rejects(importClip({...options, id: 'missing-license', license: undefined, credit: undefined}), /license\/credit/);
    for (const duration of [0, -1, Infinity, NaN]) await assert.rejects(importClip({...options, id: 'invalid-duration', duration}), /positive finite duration/);
    await assert.rejects(importClip({...options, id: 'beyond-source', duration: 6.001}), /actual video duration/);
    await assert.rejects(importClip({...options, id: 'failed'}, undefined, undefined, async () => {throw new Error('graph unavailable');}), /graph unavailable/);
    assert.equal(existsSync(join(root, 'content/failed.json')), false); assert.equal(existsSync(join(root, 'assets/media/failed')), false);
    await assert.rejects(importClip({...options, id: 'unsafe', video: undefined, captions: undefined, url: 'https://127.0.0.1/a.mp4'}), /private or special/);
    const silent = await importClip({...options, id: 'silent', captions: undefined, generateCaptions: true}, async () => {throw new Error('No audio: must not transcribe');});
    assert.deepEqual(silent.transcript, []); assert.deepEqual(silent.facts, []); assert.equal(silent.movie_graph.status, 'unavailable');
    assert.equal(silent.ingestion.caption_source, 'unavailable'); assert.match(silent.ingestion.evidence_notice, /dialogue is unavailable/);
    await writeFile(captions, 'WEBVTT\n\n00:01.100 --> 00:03.000\nEmbedded words.\n');
    const embeddedVideo = join(root, 'embedded.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-i', captions, '-map', '0:v:0', '-map', '1:0', '-c:v', 'copy', '-c:s', 'mov_text', embeddedVideo]);
    const embedded = await importClip({...options, id: 'embedded', video: embeddedVideo, captions: undefined, offset: 1, duration: 5});
    assert.equal(embedded.ingestion.caption_source, 'embedded'); assert.equal(embedded.transcript[0].start, 0.1); assert.equal(embedded.transcript[0].end, 2);
    const supplied = await importClip({...options, id: 'supplied', video: embeddedVideo, captions: undefined, captionsText: 'WEBVTT\n\n00:01.200 --> 00:02.000\nSupplied first.\n', offset: 1, duration: 5});
    assert.equal(supplied.ingestion.caption_source, 'supplied'); assert.equal(supplied.transcript[0].text, 'Supplied first.');
    const audioVideo = join(root, 'audio.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', audioVideo]);
    const generated = await importClip({...options, id: 'generated', video: audioVideo, captions: undefined, generateCaptions: true, offset: 1, duration: 5, source: 'https://example.org/source?token=secret'},
      async path => {assert.equal((await readFile(path)).toString('ascii', 0, 4), 'RIFF'); return {segments: [{start: 0.1, end: 1, text: 'Provisional words.'}]};});
    assert.equal(generated.transcript[0].start, 0.1); assert.equal(generated.ingestion.caption_source, 'generated');
    assert.equal(generated.ingestion.source_url, 'https://example.org/source'); assert.equal(generated.ingestion.caption_model, 'test-only');
    const uncaptioned = await importClip({...options, id: 'uncaptioned', video: audioVideo, captions: undefined}, async () => {throw new Error('Opt-in required');});
    assert.deepEqual(uncaptioned.transcript, []);
    await assert.rejects(importClip({...options, id: 'transcription-failed', video: audioVideo, captions: undefined, generateCaptions: true}, async () => {throw new Error('transcription unavailable');}), /transcription unavailable/);
    const controller = new AbortController();
    await assert.rejects(importClip({...options, id: 'canceled', signal: controller.signal}, undefined, undefined, async () => {controller.abort(); return graph(result);}), {name: 'AbortError'});
    const alreadyCanceled = new AbortController(); alreadyCanceled.abort();
    await assert.rejects(importClip({...options, id: 'never-started', signal: alreadyCanceled.signal}), {name: 'AbortError'});
    assert.equal((await readdir(join(root, 'assets/media'))).some(name => name.startsWith('.ingest-') || ['canceled', 'transcription-failed', 'never-started', 'unsafe'].includes(name)), false);
    assert.equal((await readdir(join(root, 'content'))).some(name => /canceled|transcription-failed|never-started/.test(name)), false);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('ten-frame source window preserves before/after VFR pixels, boundaries and cancellation without persisted history', async t => {
  if (!ffmpegAvailable(t)) return;
  const root = await mkdtemp(join(tmpdir(), 'selene-window-test-'));
  const previousTemp = process.env.TMPDIR;
  try {
    const video = join(root, 'input.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=12',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=12', '-filter_complex', "[0:v][1:v]concat=n=2:v=1:a=0,select='not(eq(n,120))'",
      '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    const story = await importClip({...fixtureOptions(root, video, 'window-clip'), duration: 24,
      captionsText: 'WEBVTT\n\n00:00.100 --> 00:01.000\nCompleted words.\n\n00:16.000 --> 00:17.000\nLater words.\n'});
    const original = JSON.stringify(story); const mediaBefore = await readdir(join(root, 'assets/media/window-clip'));
    const scratch = join(root, 'temporary'); await mkdir(scratch); process.env.TMPDIR = scratch;
    const pixel = frame => execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', 'scale=1:1', '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {input: Buffer.from(frame.image_url.url.split(',')[1], 'base64')});
    const window = await observeWindow(story, 12.05, undefined, root);
    assert.deepEqual(window.frame_window.frames.map(frame => frame.requested_at_seconds),
      [-10, -8, -6, -4, -2, 2, 4, 6, 8, 10].map(offset => 12.05 + offset));
    assert.deepEqual(window.frame_images.map(frame => frame.relation), [...Array(5).fill('before'), ...Array(5).fill('after')]);
    assert.equal(new Set(window.frame_images.map(frame => frame.frame_id)).size, 10);
    for (const frame of window.frame_images) {
      const color = pixel(frame);
      if (frame.relation === 'before') assert.ok(color[0] > 200 && color[2] < 50);
      else assert.ok(color[2] > 200 && color[0] < 50);
      assert.ok(frame.frame_at_seconds <= frame.requested_at_seconds);
    }
    assert.deepEqual(window.frame_window.missing_frames, []);
    assert.equal(JSON.stringify(window.frame_window).includes('base64'), false);
    const gap = await observeWindow(story, 10.05, undefined, root);
    const gapFrame = gap.frame_images.find(frame => frame.requested_at_seconds === 12.05);
    assert.equal(gapFrame.frame_at_seconds, 11.9); assert.equal(gapFrame.relation, 'after');
    assert.ok(pixel(gapFrame)[0] > 200, 'A missing frame at 12 seconds must not select the future blue frame');
    for (const at of [0, story.duration]) {
      const edge = await observeWindow(story, at, undefined, root);
      assert.equal(edge.frame_images.length, 5); assert.equal(edge.frame_window.missing_frames.length, 5);
      assert.ok(edge.frame_window.missing_frames.every(frame => frame.reason === 'out_of_range'));
      assert.ok(edge.frame_images.every(frame => frame.requested_at_seconds >= 0 && frame.requested_at_seconds <= story.duration));
    }
    assert.deepEqual(sceneContext(12.05, story).transcript.map(cue => cue.text), ['Completed words.']);
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), 5);
    try {await assert.rejects(observeWindow(story, 12.05, controller.signal, root), {name: 'AbortError'});}
    finally {clearTimeout(abort);}
    await assert.rejects(observeWindow({...story, video: 'https://example.org/video.mp4'}, 12, undefined, root), /published local/);
    await assert.rejects(observeWindow(story, 25, undefined, root), /valid timestamp/);
    assert.deepEqual(await readdir(scratch), []);
    assert.equal(JSON.stringify(story), original);
    assert.deepEqual(await readdir(join(root, 'assets/media/window-clip')), mediaBefore);
    assert.equal(JSON.stringify(JSON.parse(await readFile(join(root, 'content/window-clip.json'), 'utf8'))), original);
    assert.equal(original.includes('base64'), false);
  } finally {
    if (previousTemp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTemp;
    await rm(root, {recursive: true, force: true});
  }
});

test('full remote imports retain multi-hour captions without sampled history and late window decoding stays bounded', async t => {
  if (!ffmpegAvailable(t)) return;
  const root = await mkdtemp(join(tmpdir(), 'selene-full-'));
  try {
    const video = join(root, 'long.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x18:r=2:d=10810',
      '-f', 'lavfi', '-i', 'color=c=blue:s=32x18:r=2:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    const captionsText = 'WEBVTT\n\n00:10:00.000 --> 00:10:01.000\nLate source words.\n\n03:00:10.100 --> 03:00:10.900\nEnd words.\n';
    const transport = {lookup: async () => [{address: '93.184.216.34', family: 4}], request: (url, options, callback) => {
      assert.equal(url.href, 'https://example.org/full.mp4'); assert.equal(options.agent, false);
      const req = new EventEmitter(); req.setTimeout = milliseconds => assert.equal(milliseconds, 15000);
      req.end = () => queueMicrotask(() => callback(Object.assign(createReadStream(video), {statusCode: 200, headers: {}}))); return req;
    }};
    const options = {id: 'full-remote', title: 'Full video', url: 'https://example.org/full.mp4', captionsText, offset: 1, permitted: true, model: 'test-only', destination: root};
    const story = await importClip(options, undefined, transport);
    assert.equal(story.duration, 10810); assert.equal(story.subtitle, 'Captioned video'); assert.equal(story.scenes.length, 1);
    assert.equal(story.ingestion.frames, undefined); assert.deepEqual(story.facts, []);
    assert.equal(story.transcript[0].start, 599); assert.equal(story.transcript[1].end, 10809.9);
    assert.deepEqual(await readdir(join(root, 'assets/media/full-remote')), ['poster.jpg', 'video-v.mp4', 'video.mp4']);
    const started = performance.now();
    const result = await observeWindow(story, 10807, AbortSignal.timeout(10000), root);
    assert.ok(performance.now() - started < 10000, 'Late window must not decode the whole film');
    assert.equal(result.frame_window.frames.length, 6); assert.equal(result.frame_window.missing_frames.length, 4);
    assert.equal(result.frame_window.frames.at(-1).requested_at_seconds, 10809);
    await assert.rejects(observeWindow(story, 10810.001, undefined, root), /valid timestamp/);
    const local = await importClip({...fixtureOptions(root, video, 'long-local'), duration: 610});
    assert.equal(local.duration, 610); assert.equal(local.scenes.at(-1).end, 610); assert.equal(local.ingestion.frames, undefined);
    assert.deepEqual(await readdir(join(root, 'assets/media/long-local')), ['poster.jpg', 'video-v.mp4', 'video.mp4']);
    await assert.rejects(importClip({...options, id: 'past-end', offset: 10812}, undefined, transport), /actual video duration/);
    assert.equal((await readdir(join(root, 'assets/media'))).some(name => name.startsWith('.ingest-') || name === 'past-end'), false);
  } finally {await rm(root, {recursive: true, force: true});}
});
