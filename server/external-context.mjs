import {createHash} from 'node:crypto';

const MAX_TRANSCRIPT = 40;
const MAX_FACTS = 40;
const MAX_BYTES = 131072;

function localOrHttps(value) {
  const url = new URL(value);
  return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
}

function boundedText(value, max) {return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : null;}
function boundedTime(value) {return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;}
function id(prefix, value) {return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;}

function normalize(payload, snapshot) {
  if (!payload || payload.verified !== true || payload.provider_content_id !== snapshot.content_id ||
    payload.provider_package_id !== snapshot.package_id || payload.provider_catalog_name !== snapshot.catalog_name ||
    payload.at_seconds !== snapshot.at_seconds) throw new Error('Licensed scene context identity and time were not verified');
  const source = boundedText(payload.source, 160);
  if (!source) throw new Error('Licensed scene context did not identify its source');
  const at = snapshot.at_seconds;
  const scene = payload.scene && boundedText(payload.scene.id, 120) && boundedText(payload.scene.label, 240) && boundedTime(payload.scene.start) !== null && boundedTime(payload.scene.end) !== null && payload.scene.start <= at && at < payload.scene.end
    ? {id: id('licensed-scene', `${source}:${payload.scene.id}`), label: payload.scene.label, start: payload.scene.start, end: payload.scene.end}
    : null;
  const transcript = Array.isArray(payload.transcript) ? payload.transcript.slice(0, MAX_TRANSCRIPT).flatMap((line, index) => {
    const start = boundedTime(line?.start); const end = boundedTime(line?.end); const text = boundedText(line?.text, 1200);
    if (start === null || end === null || end <= start || end > at || !text) return [];
    const speaker = boundedText(line?.speaker, 120);
    return [{id: id('licensed-transcript', `${source}:${line.id ?? index}:${start}:${end}:${text}`), start, end, text, source: 'licensed_scene', ...(speaker ? {speaker} : {})}];
  }) : [];
  const facts = Array.isArray(payload.facts) ? payload.facts.slice(0, MAX_FACTS).flatMap((fact, index) => {
    const availableAt = boundedTime(fact?.available_at); const text = boundedText(fact?.text, 1200);
    if (availableAt === null || availableAt > at || !text) return [];
    return [{id: id('licensed-fact', `${source}:${fact.id ?? index}:${availableAt}:${text}`), available_at: availableAt, text, source: 'licensed_scene'}];
  }) : [];
  return {scene, transcript, facts, scene_source: 'licensed_scene', scene_source_name: source};
}

export async function enrichCompanionContext(context, snapshot, signal) {
  const endpoint = process.env.SELENE_SCENE_CONTEXT_URL;
  if (!endpoint) return context;
  if (!localOrHttps(endpoint)) throw new Error('SELENE_SCENE_CONTEXT_URL must use HTTPS or loopback HTTP');
  const headers = {'Content-Type': 'application/json', Accept: 'application/json'};
  if (process.env.SELENE_SCENE_CONTEXT_TOKEN) headers.Authorization = `Bearer ${process.env.SELENE_SCENE_CONTEXT_TOKEN}`;
  const response = await fetch(endpoint, {
    method: 'POST', signal, redirect: 'error', headers,
    body: JSON.stringify({provider: snapshot, at_seconds: snapshot.at_seconds}),
  });
  if (!response.ok) throw new Error(`Licensed scene context returned HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('Licensed scene context did not return JSON');
  // A configured service is still a network trust boundary; bound bytes before parsing JSON.
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('Licensed scene context exceeded its payload limit');
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const external = normalize(payload, snapshot);
  return {...context, ...external, scene_id: external.scene?.id ?? context.scene_id, facts: [...context.facts, ...external.facts], transcript: external.transcript};
}
