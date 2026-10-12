import {mkdir, open, readFile, rename, rm, chmod} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';

const roles = ['grandparent', 'parent', 'child', 'adult'];
const styles = ['simple', 'standard', 'detailed'];
const languages = ['English', 'Indonesian', 'Spanish'];
const storage = () => resolve(process.env.SELENE_REQUESTERS_FILE || join(homedir(), '.local/share/selene/requesters.json'));
// ponytail: one relay process owns this household file; use a database if multiple writers are needed.
let writer = Promise.resolve();
const publicProfile = ({id, label, role, style, language, voice_samples}) => ({id, label, role, style, language, voice_samples});
const fail = (message, status = 400) => {throw Object.assign(new Error(message), {status});};
const validId = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);

function preferences(input) {
  if (!input || typeof input !== 'object' || typeof input.label !== 'string' || !input.label.trim() ||
      input.label.trim().length > 60 || /[\x00-\x1f\x7f]/.test(input.label) || !roles.includes(input.role) ||
      !styles.includes(input.style) || !languages.includes(input.language)) fail('Invalid requester label, role, style or language');
  return {label: input.label.trim(), role: input.role, style: input.style, language: input.language};
}

export function normalizeEmbedding(value) {
  if (!Array.isArray(value) || value.length !== 192 || !value.every(Number.isFinite)) fail('Invalid speaker embedding');
  const norm = Math.hypot(...value);
  if (norm < 1e-8) fail('Invalid speaker embedding');
  return value.map(number => number / norm);
}

async function readProfiles(path) {
  let text;
  try {text = await readFile(path, 'utf8');} catch (error) {if (error.code === 'ENOENT') return []; throw error;}
  const value = JSON.parse(text);
  if (value?.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 8) fail('Invalid requester storage');
  const ids = new Set();
  for (const profile of value.profiles) {
    preferences(profile);
    if (!validId(profile.id) || ids.has(profile.id) ||
        ![0, 1, 2].includes(profile.voice_samples) || (profile.voice_samples === 0 ? profile.embedding !== null : !profile.embedding)) fail('Invalid requester storage');
    ids.add(profile.id);
    if (profile.embedding) normalizeEmbedding(profile.embedding);
  }
  await chmod(path, 0o600);
  return value.profiles;
}

function changeProfiles(change, signal) {
  const path = storage();
  const task = writer.then(async () => {
    signal?.throwIfAborted();
    const profiles = await readProfiles(path);
    const result = await change(profiles);
    await mkdir(dirname(path), {recursive: true, mode: 0o700});
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {await handle.writeFile(JSON.stringify({version: 1, profiles})); await handle.sync();} finally {await handle.close();}
      signal?.throwIfAborted();
      await rename(temporary, path);
    } finally {await rm(temporary, {force: true});}
    return result;
  });
  writer = task.catch(() => {});
  return task;
}

export async function listRequesters() {
  await writer;
  return (await readProfiles(storage())).map(publicProfile);
}

export async function createRequester(input) {
  const prefs = preferences(input);
  if (Object.keys(input).some(key => !['label', 'role', 'style', 'language', 'consent', 'guardian_consent'].includes(key)) ||
      (input.guardian_consent !== undefined && typeof input.guardian_consent !== 'boolean')) fail('Invalid requester fields');
  if (input.consent !== true) fail('Explicit requester storage consent is required');
  if (prefs.role === 'child' && input.guardian_consent !== true) fail('Guardian consent is required for a child profile');
  return changeProfiles(profiles => {
    if (profiles.length >= 8) fail('This household already has eight requester profiles');
    const profile = {id: randomUUID(), ...prefs, voice_samples: 0, embedding: null};
    profiles.push(profile);
    return publicProfile(profile);
  });
}

export async function deleteRequester(id) {
  if (!validId(id)) fail('Invalid requester ID');
  return changeProfiles(profiles => {
    const index = profiles.findIndex(profile => profile.id === id);
    if (index < 0) fail('Requester profile was not found', 404);
    profiles.splice(index, 1);
    return {deleted: true};
  });
}

export async function enrollRequesterVoice(id, embedding, {signal, guardianConsent = false} = {}) {
  if (!validId(id)) fail('Invalid requester ID');
  const normalized = normalizeEmbedding(embedding);
  return changeProfiles(profiles => {
    signal?.throwIfAborted();
    const profile = profiles.find(value => value.id === id);
    if (!profile) fail('Requester profile was not found', 404);
    if (profile.role === 'child' && guardianConsent !== true) fail('Guardian consent is required for child voice enrollment');
    if (profile.voice_samples >= 2) fail('Voice is already enrolled; delete the profile before enrolling again');
    if (profile.voice_samples === 1) {
      if (normalized.every((value, index) => Math.abs(value - profile.embedding[index]) < 1e-12)) fail('Record a second independent utterance, not the same recording');
      if (normalized.reduce((sum, value, index) => sum + value * profile.embedding[index], 0) < 0.65) fail('Enrollment clips do not confidently match; record the same person again');
      profile.embedding = normalizeEmbedding(normalized.map((value, index) => (value + profile.embedding[index]) / 2));
    } else profile.embedding = normalized;
    profile.voice_samples++;
    return publicProfile(profile);
  }, signal);
}

// Conservative, uncalibrated initial cutoffs: this is personalization, never authentication.
export function chooseVoiceMatch(embedding, profiles) {
  const query = normalizeEmbedding(embedding);
  const scores = profiles.filter(profile => profile.voice_samples === 2).map(profile => {
    const enrolled = normalizeEmbedding(profile.embedding);
    return {profile, score: query.reduce((sum, value, index) => sum + value * enrolled[index], 0)};
  }).sort((a, b) => b.score - a.score);
  if (!scores.length || scores[0].score < 0.65 || (scores.length > 1 && scores[0].score - scores[1].score < 0.15)) return null;
  return publicProfile(scores[0].profile);
}

export async function matchRequesterVoice(embedding) {
  await writer;
  return chooseVoiceMatch(embedding, await readProfiles(storage()));
}

export async function resolveRequester(request, requesterId) {
  const text = typeof request === 'string' ? request : request?.request;
  const id = requesterId ?? (typeof request === 'object' ? request?.requester_id : undefined);
  if (id !== undefined && !validId(id)) fail('Invalid requester ID');
  const profiles = id ? await listRequesters() : [];
  const selected = id ? profiles.find(profile => profile.id === id) : null;
  if (id && !selected) fail('Requester profile was not found', 404);
  const declaration = typeof text === 'string' && /^\s*(?:I[’']?m|I am)\s+(?:(?:a|the)\s+)?(grandma|grandmother|grandpa|grandfather|dad|father|mom|mother|kid|child|adult)(?=\s|[,.;!?]|$)/i.exec(text);
  const fictional = declaration && /^\s+(?:in|from|playing|as|character|says?|said|quotes?)\b/i.test(text.slice(declaration[0].length));
  const role = declaration && !fictional ? ({grandma: 'grandparent', grandmother: 'grandparent', grandpa: 'grandparent', grandfather: 'grandparent', dad: 'parent', father: 'parent', mom: 'parent', mother: 'parent', kid: 'child', child: 'child', adult: 'adult'})[declaration[1].toLowerCase()] : null;
  return {requester: selected ?? null, role: role ?? selected?.role ?? null,
    style: selected?.style ?? null, language: selected?.language ?? null, source: role ? 'declaration' : selected ? 'profile' : 'none'};
}
