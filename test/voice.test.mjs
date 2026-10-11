import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {processVoice, voiceAvailable, validateVoiceWav} from '../server/voice.mjs';

// Synthetic PCM is parser/provider transport data, never evidence that an acoustic identity matches.
function wav(seconds = 2, channels = 1) {
  const data = 16000 * seconds * channels * 2, audio = Buffer.alloc(44 + data);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVE', 8);
  audio.write('fmt ', 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(channels, 22); audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000 * channels, 28);
  audio.writeUInt16LE(2 * channels, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(data, 40);
  for (let index = 0; index < data / 2; index++) audio.writeInt16LE(Math.round(Math.sin(index / 12) * 12000), 44 + index * 2);
  return audio;
}
const input = () => ({audio: wav().toString('base64'), format: 'wav', action: 'question', consent: true});
const recordings = async () => (await readdir(tmpdir())).filter(name => name.startsWith('selene-voice-')).sort();
function environment(t) {
  const values = {SELENE_VOICE_PYTHON: '/nonexistent/selene-voice-test-python', AGENT_PROVIDER_URL: 'https://voice.test.invalid', AGENT_PROVIDER_API_KEY: 'private-test-key'};
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;});
}

test('WAV transport validates bounded duration, PCM16 mono and chunk lengths', () => {
  assert.deepEqual(validateVoiceWav(wav()), {duration: 2, sample_rate: 16000});
  assert.equal(validateVoiceWav(wav(20)).duration, 20);
  for (const audio of [Buffer.alloc(4), wav(1), wav(21), wav(2, 2)]) assert.throws(() => validateVoiceWav(audio), {status: 400});
  const broken = wav(); broken.writeUInt32LE(0xffffffff, 40);
  assert.throws(() => validateVoiceWav(broken), /WAV chunk/);
  const compressed = wav(); compressed.writeUInt16LE(3, 20);
  assert.throws(() => validateVoiceWav(compressed), /PCM16/);
});

test('missing real worker is explicitly unavailable, while configured WAV transcription remains reviewable', async t => {
  environment(t);
  const before = await recordings();
  assert.equal(await voiceAvailable(), false);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests++;
    assert.equal(url, 'https://voice.test.invalid');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'google/gemini-2.5-flash');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.provider.data_collection, 'deny');
    const audio = body.messages[1].content.find(part => part.type === 'input_audio').input_audio;
    assert.equal(audio.format, 'wav'); validateVoiceWav(Buffer.from(audio.data, 'base64'));
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({transcript: 'Im grandma, what happened?'})}}]});
  });
  assert.deepEqual(await processVoice(input()), {transcript: 'Im grandma, what happened?', requester: null, match: 'unknown', voice_available: false});
  assert.equal(requests, 1);
  assert.deepEqual(await recordings(), before, 'successful transcription leaves no raw recording');
});

test('voice rejects nonconsent, extra fields, malformed input and sanitizes provider errors with cleanup', async t => {
  environment(t);
  const before = await recordings();
  await assert.rejects(processVoice({...input(), consent: false}), {status: 400});
  await assert.rejects(processVoice({...input(), embeddings: []}), {status: 400});
  await assert.rejects(processVoice({...input(), profile_id: '../private'}), {status: 400});
  await assert.rejects(processVoice({...input(), audio: 'not-base64'}), {status: 400});
  await assert.rejects(processVoice({...input(), audio: wav(21).toString('base64')}), {status: 400});
  t.mock.method(globalThis, 'fetch', async () => new Response('private-test-key and recording contents', {status: 500}));
  await assert.rejects(processVoice(input()), error => error.status === 503 && error.message === 'Voice transcription service rejected the recording');
  assert.deepEqual(await recordings(), before, 'failed processing leaves no raw recording');
});

test('pre-aborted and in-flight canceled recordings never survive cancellation', async t => {
  environment(t);
  const before = await recordings();
  await assert.rejects(processVoice(input(), {signal: AbortSignal.abort(new DOMException('Cancelled', 'AbortError'))}), {name: 'AbortError'});
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const cancelled = new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true}));
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    return cancelled;
  });
  await assert.rejects(processVoice(input(), {signal: controller.signal}), {name: 'AbortError'});
  assert.deepEqual(await recordings(), before, 'cancelled processing leaves no raw recording');
});
