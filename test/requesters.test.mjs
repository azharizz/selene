import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequester, deleteRequester, listRequesters, resolveRequester, enrollRequesterVoice, matchRequesterVoice, chooseVoiceMatch} from '../server/requesters.mjs';

const base = {label: 'Grandma', role: 'grandparent', style: 'detailed', language: 'Spanish', consent: true};
const vector = (x = 1, y = 0) => [x, y, ...Array(190).fill(0)];
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'selene-requesters-test-'));
  const old = process.env.SELENE_REQUESTERS_FILE;
  process.env.SELENE_REQUESTERS_FILE = join(root, 'private', 'requesters.json');
  t.after(async () => {old === undefined ? delete process.env.SELENE_REQUESTERS_FILE : process.env.SELENE_REQUESTERS_FILE = old; await rm(root, {recursive: true, force: true});});
  return {root, path: process.env.SELENE_REQUESTERS_FILE};
}

test('profiles validate consent and preferences, persist atomically with private permissions, and delete embeddings', async t => {
  const {path} = await store(t);
  await assert.rejects(createRequester({...base, consent: false}), {status: 400});
  await assert.rejects(createRequester({...base, role: 'child'}), /Guardian consent/);
  await assert.rejects(createRequester({...base, style: 'elderly'}), /Invalid requester/);
  await assert.rejects(createRequester({...base, embedding: vector()}), /Invalid requester fields/);
  await assert.rejects(createRequester({...base, label: 'bad\nlabel'}), /Invalid requester/);
  const profile = await createRequester(base);
  assert.match(profile.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.deepEqual(await listRequesters(), [profile]);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(path, '..'))).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(join(path, '..')), ['requesters.json']);
  const once = await enrollRequesterVoice(profile.id, vector());
  assert.equal(once.voice_samples, 1);
  assert.equal(await matchRequesterVoice(vector()), null, 'one clip is not enrollment');
  await assert.rejects(enrollRequesterVoice(profile.id, vector()), /second independent utterance/);
  await assert.rejects(enrollRequesterVoice(profile.id, vector(0, 1)), /do not confidently match/);
  const twice = await enrollRequesterVoice(profile.id, vector(0.98, 0.2));
  assert.equal(twice.voice_samples, 2);
  assert.equal('embedding' in twice, false);
  assert.equal((await matchRequesterVoice(vector())).id, profile.id);
  const stored = JSON.parse(await readFile(path, 'utf8')).profiles[0];
  assert.ok(Math.abs(Math.hypot(...stored.embedding) - 1) < 1e-10);
  assert.deepEqual(await deleteRequester(profile.id), {deleted: true});
  assert.deepEqual(await listRequesters(), []);
  assert.equal((await readFile(path, 'utf8')).includes(profile.id), false);
  const second = vector(0.98, 0.2), secondNorm = Math.hypot(...second);
  const average = second.map((value, index) => (value / secondNorm + vector()[index]) / 2);
  const averageNorm = Math.hypot(...average);
  assert.ok(stored.embedding.every((value, index) => Math.abs(value - average[index] / averageNorm) < 1e-10));
  await assert.rejects(deleteRequester('bad-id'), {status: 400});
  await assert.rejects(deleteRequester(profile.id), {status: 404});
});

test('first-person declarations override only role for one turn, never infer style or quote characters', async t => {
  await store(t);
  const profile = await createRequester({...base, role: 'parent'});
  for (const phrase of ["I'm grandma", 'Im grandmother', 'I am grandpa', 'I’m grandfather']) {
    const result = await resolveRequester({request: `${phrase}, explain this movie`, requester_id: profile.id});
    assert.equal(result.role, 'grandparent'); assert.equal(result.source, 'declaration');
    assert.equal(result.style, 'detailed'); assert.equal(result.language, 'Spanish');
  }
  for (const [word, role] of [['dad', 'parent'], ['father', 'parent'], ['mom', 'parent'], ['mother', 'parent'], ['kid', 'child'], ['child', 'child'], ['adult', 'adult']]) {
    assert.equal((await resolveRequester(`I am ${word}. What happened?`)).role, role);
  }
  for (const phrase of ['"Im grandma" is the line', 'The character says I am grandma', "I'm grandma's friend", 'I am grandma in the movie', 'I am grandmother from that film']) {
    assert.equal((await resolveRequester(phrase)).source, 'none', phrase);
  }
  assert.equal((await resolveRequester('Im grandma')).style, null);
  assert.equal((await resolveRequester('What happened?', profile.id)).role, 'parent');
  assert.equal((await listRequesters())[0].role, 'parent');
  await assert.rejects(resolveRequester('Im grandma', randomUUID()), {status: 404});
  await assert.rejects(resolveRequester('Hi', 'invalid'), {status: 400});
});

test('single writer enforces eight profiles and guardian enrollment consent; cancellation never stores a clip', async t => {
  await store(t);
  const results = await Promise.allSettled(Array.from({length: 9}, (_, index) => createRequester({...base, label: `Person ${index}`})));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 8);
  assert.equal((await listRequesters()).length, 8);
  for (const profile of await listRequesters()) await deleteRequester(profile.id);
  const child = await createRequester({...base, role: 'child', guardian_consent: true});
  await assert.rejects(enrollRequesterVoice(child.id, vector()), /Guardian consent/);
  const signal = AbortSignal.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(enrollRequesterVoice(child.id, vector(), {signal, guardianConsent: true}), {name: 'AbortError'});
  assert.equal((await listRequesters())[0].voice_samples, 0);
});

test('speaker matching preserves unknown below threshold, within winner margin, or without two clips', () => {
  const profile = (score, axis = 1) => ({...base, id: randomUUID(), voice_samples: 2,
    embedding: Array.from({length: 192}, (_, index) => index === 0 ? score : index === axis ? Math.sqrt(1 - score ** 2) : 0)});
  const winner = profile(0.8), close = profile(0.66, 2), far = profile(0.64, 2);
  assert.equal(chooseVoiceMatch(vector(), []), null);
  assert.equal(chooseVoiceMatch(vector(), [profile(0.64)]), null);
  assert.equal(chooseVoiceMatch(vector(), [{...winner, voice_samples: 1}]), null);
  assert.equal(chooseVoiceMatch(vector(), [winner, close]), null);
  assert.equal(chooseVoiceMatch(vector(), [winner, far]).id, winner.id);
  assert.equal('embedding' in chooseVoiceMatch(vector(), [winner]), false);
});
