import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseCaptions, visualFacts, ingest} from '../scripts/ingest-video.mjs';
import {sceneContext} from '../server/context.mjs';
import {quietResponse} from '../server/contract.mjs';
import {validateMoment} from '../server/agent.mjs';

test('SRT and WebVTT captions retain complete excerpt cues, markup text and precise times', () => {
  const srt = '\uFEFF1\r\n00:01:00,125 --> 00:01:02,500\r\n<i>Hello</i> &amp; goodbye.\r\n\r\n2\r\n00:01:03,000 --> 00:01:05,000\r\nFuture words.';
  const cues = parseCaptions(srt, 60, 4);
  assert.equal(cues.length, 1); assert.equal(cues[0].start, 0.125); assert.equal(cues[0].end, 2.5); assert.equal(cues[0].text, 'Hello & goodbye.');
  assert.equal(parseCaptions('WEBVTT\n\nNOTE not evidence\nignored\n\ncue\n00:01.000 --> 00:03.000 align:center\n<v speaker>Hello</v>')[0].text, 'Hello');
  assert.throws(() => parseCaptions('1\n00:01:61,000 --> 00:02:03,000\nBad.'), /timestamp/);
  assert.throws(() => parseCaptions('1\n00:00:03,000 --> 00:00:02,000\nBad.'), /end/);
  assert.throws(() => parseCaptions(srt, 60.5, 1), /No complete/);
});

test('sampled evidence is provisional, time-bounded and never exposes a future cue/frame', () => {
  const facts = visualFacts({observations: ['A hand holds a paper.']}, 4, '/frame.jpg');
  const story = {id: 'new', title: 'New', ingestion: {sample_interval_seconds: 4}, scenes: [{id: 'one', label: 'Moment', start: 0, end: 10}], facts,
    transcript: [{id: 'line', start: 1, end: 5, text: 'Later words.'}]};
  assert.equal(sceneContext(3, story).facts.length, 0);
  assert.equal(sceneContext(4, story).facts[0].verification, 'unverified single-frame model observation');
  assert.equal(sceneContext(4, story).transcript.length, 0);
  assert.equal(sceneContext(5, story).transcript.length, 1);
  assert.equal(sceneContext(5, story).source, 'automatic_ingestion');
  const input = {content_id: 'new', at_seconds: 5, recipient: 'everyone', playback_choice: 'keep_watching', play_state: 'playing', life_connection: false};
  const moment = {...quietResponse(input, 'one'), state: 'response', answer: 'A hand is visible in the sampled image.'}; moment.grounding.evidence_ids = [facts[0].id];
  moment.new_connections = [{scope: 'general', subject: 'image', relation: 'explains', object: 'story', explanation: 'Must not enter memory.', evidence_ids: ['invented']}];
  validateMoment(moment, input, sceneContext(5, story)); assert.equal(moment.new_connections.length, 0);
  assert.throws(() => visualFacts({observations: ['x'.repeat(351)]}, 1, '/frame.jpg'), /text/);
});

test('real FFmpeg import publishes player-compatible media only after complete evidence; refuses replacement', async t => {
  try {execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'});} catch {t.skip('FFmpeg required for media integration'); return;}
  const root = await mkdtemp(join(tmpdir(), 'selene-import-'));
  try {
    const video = join(root, 'input.mp4'); const captions = join(root, 'input.vtt');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    await writeFile(captions, 'WEBVTT\n\n00:00.100 --> 00:02.000\nThis is a caption.\n');
    const options = {id: 'test-clip', title: 'Test clip', video, captions, duration: 6, interval: 5, destination: root, permitted: true,
      source: 'https://example.org/source', license: 'https://example.org/license', credit: 'Generated test fixture', model: 'test-only'};
    let calls = 0;
    const result = await ingest(options, async () => {calls++; return {observations: ['A red image.']};});
    assert.equal(calls, 2); assert.equal(result.transcript.length, 1); assert.equal(result.scenes.at(-1).end, 6);
    assert.equal(result.ingestion.frames.length, 2); assert.equal(result.facts[1].available_at, 5);
    await assert.rejects(ingest(options, async () => {throw new Error('must not call');}), /already exists/);
    await assert.rejects(ingest({...options, id: '../escape'}, async () => ({})), /safe ID/);
    await assert.rejects(ingest({...options, id: 'not-permitted', permitted: false}, async () => ({})), /Permission/);
    await assert.rejects(ingest({...options, id: 'failed'}, async () => {throw new Error('model unavailable');}), /model unavailable/);
    const {existsSync} = await import('node:fs'); assert.equal(existsSync(join(root, 'content/failed.json')), false); assert.equal(existsSync(join(root, 'assets/media/failed')), false);
  } finally {await rm(root, {recursive: true, force: true});}
});
