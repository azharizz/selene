import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildMovieGraph, movieGraphAt, validateMovieGraph} from './movie-graph.mjs';

const contentRoot = process.env.SELENE_CONTENT_ROOT || fileURLToPath(new URL('../content/', import.meta.url));
const storyFiles = readdirSync(contentRoot).filter(name => name.endsWith('.json')).sort();
export const stories = storyFiles.map(name => JSON.parse(readFileSync(join(contentRoot, name), 'utf8')));
export const story = stories[0];
export function getStory(id = story.id) {return stories.find(value => value.id === id) ?? null;}
const revision = () => createHash('sha256').update(JSON.stringify(stories)).digest('hex');
export let contentRevision = revision();
const graphRequests = new WeakMap();

export async function ensureMovieGraph(selectedStory, {signal} = {}) {
  if (selectedStory.movie_graph) return validateMovieGraph(selectedStory, selectedStory.movie_graph);
  if (!graphRequests.has(selectedStory)) {
    const request = (async () => {
      const graph = await buildMovieGraph(selectedStory, {signal});
      signal?.throwIfAborted();
      selectedStory.movie_graph = graph;
      contentRevision = revision();
      return graph;
    })().finally(() => graphRequests.delete(selectedStory));
    graphRequests.set(selectedStory, request);
  }
  return graphRequests.get(selectedStory);
}

export function registerStory(value) {
  if (getStory(value.id)) throw new Error('Film already exists');
  if (value.movie_graph) validateMovieGraph(value, value.movie_graph);
  stories.push(value);
  contentRevision = revision();
}

export function createMemory() {return {responses: new Map(), lastExplanation: null};}
export function movieGraphEvidence(context) {return [...(context.movie_graph?.nodes ?? []), ...(context.movie_graph?.edges ?? [])];}

export function sceneContext(at, selectedStory = story) {
  const scene = selectedStory.scenes.find(s => at >= s.start && at < s.end) ?? selectedStory.scenes.at(-1);
  return {
    content_id: selectedStory.id, title: selectedStory.title, scene_id: scene.id, scene: {label: scene.label, start: scene.start, end: scene.end}, at_seconds: at,
    // Every completed cue from the movie start is retained; there is no recency/count truncation.
    transcript: selectedStory.transcript.filter(t => t.end <= at),
    facts: selectedStory.facts.filter(f => f.source !== 'model_observation' && f.available_at <= at),
    movie_graph: movieGraphAt(selectedStory, at),
    ...(selectedStory.ingestion ? {source: 'automatic_ingestion',
      evidence_notice: 'All completed captions from the movie start to this captured question time, with a caption-backed per-movie AI graph. Fresh visual evidence is limited to the explicitly authorized ten-second before/after window.',
      ingestion: {caption_source: selectedStory.ingestion.caption_source ?? 'supplied'},
    } : {source: 'authored_demo'}),
  };
}

export function companionContext(snapshot, detail = '', sceneAnswer = '') {
  const contentId = `external-${createHash('sha256').update(JSON.stringify([snapshot.package_id, snapshot.catalog_name, snapshot.content_id])).digest('hex')}`;
  const sceneId = `moment-${createHash('sha256').update(JSON.stringify([snapshot.session_id, snapshot.at_seconds])).digest('hex').slice(0, 24)}`;
  return {
    content_id: contentId, title: snapshot.title, scene_id: sceneId, at_seconds: snapshot.at_seconds,
    source: 'vega_media_controls', scene_source: 'viewer', scene: null, transcript: [],
    movie_graph: {version: 1, status: 'unavailable', model: '', nodes: [], edges: []},
    provider: {package_id: snapshot.package_id, session_id: snapshot.session_id, catalog_name: snapshot.catalog_name, content_id: snapshot.content_id, name: snapshot.provider_name || ''},
    facts: [
      {id: 'provider-metadata', source: 'provider', text: `The selected provider${snapshot.provider_name ? ` ${JSON.stringify(snapshot.provider_name)}` : ''} reports title ${JSON.stringify(snapshot.title || 'not supplied')} at sampled playback position ${snapshot.at_seconds} seconds. This metadata snapshot does not include scene or dialogue text.`},
      ...(detail.trim() ? [{id: 'viewer-scene-detail', source: 'viewer', text: detail.trim()}] : []),
      ...(sceneAnswer.trim() ? [{id: 'viewer-scene-answer', source: 'viewer', text: sceneAnswer.trim()}] : []),
    ],
  };
}

export const tools = [
  {type: 'function', function: {name: 'get_scene_context', description: 'Get all completed captions from the movie start, visible facts and caption-backed per-movie graph up to the host captured time. Only explicitly labelled frame-window observations may look ahead by ten seconds.', strict: true, parameters: {type: 'object', properties: {}, required: [], additionalProperties: false}}},
];

export function callTool(name, args, at, memory, context = sceneContext(at)) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid model tool arguments');
  if (name === 'get_scene_context' && Object.keys(args).length === 0) return context;
  throw new Error('Invalid model tool call');
}
