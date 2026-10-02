import Ajv from 'ajv';
import {getStory} from './context.mjs';

const object = properties => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false});
const text = (maxLength = 800) => ({type: 'string', maxLength});
const choice = values => ({type: 'string', enum: values});
const list = (items, maxItems = 12) => ({type: 'array', items, maxItems});
export const requestSchema = object({
  request: text(600), content_id: {...text(100), minLength: 1},
  at_seconds: {type: 'number', minimum: 0, maximum: 86400},
  play_state: choice(['playing', 'paused', 'ended']),
  playback_choice: choice(['unspecified', 'keep_watching', 'pause_to_explore']),
  need: choice(['Explain simply', 'Slower answer voice', 'Translate', 'Show visually']),
  language: choice(['English', 'Indonesian', 'Spanish']),
  session: choice(['family', 'solo']),
  recipient: choice(['grandparent', 'parent', 'child', 'adult', 'everyone']),
  life_connection: {type: 'boolean'},
});
// One clarification belongs to the same moment, not an open conversation history.
requestSchema.properties.continuation = {anyOf: [{type: 'null'}, object({request: text(600), question: text(560), answer: text(600)})]};

export const companionRequestSchema = object({
  ...Object.fromEntries(Object.entries(requestSchema.properties).filter(([key]) => !['content_id', 'at_seconds', 'play_state', 'continuation'].includes(key))),
  snapshot: object({
    package_id: {...text(240), minLength: 1}, session_id: {type: 'integer', minimum: 0},
    catalog_name: {...text(240), minLength: 1}, content_id: {...text(500), minLength: 1}, title: text(500), provider_name: text(240),
    at_seconds: {type: 'number', minimum: 0},
  }),
  play_state: choice(['playing', 'paused', 'unknown']),
  scene_detail: text(1200), scene_answer: text(600),
  continuation: requestSchema.properties.continuation,
});

export const responseSchema = object({
  version: choice(['1.0']),
  state: choice(['quiet', 'response', 'clarification']),
  answer: {...text(560), description: 'The actual short explanation or clarification question, visible to the viewer. Must be nonempty for response or clarification. Only quiet may have an empty answer. SVG labels cannot replace this answer.'},
  visual: object({
    status: choice(['ready', 'fallback', 'none']), svg: text(24000), description: text(240),
    animations: list(object({
      target_id: {type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,40}$'},
      duration_ms: {type: 'integer', minimum: 300, maximum: 4000},
      delay_ms: {type: 'integer', minimum: 0, maximum: 1000},
      keyframes: list(object({
        opacity: {type: 'number', minimum: 0.35, maximum: 1},
        transform: {type: 'string', maxLength: 80},
      }), 2),
    }), 4),
  }),
  intervention: object({
    playback: choice(['keep_watching', 'offer_choice', 'request_pause']),
    audio: choice(['silent']),
  }),
  life_connection: object({
    offered: {type: 'boolean'}, question: text(200),
    recipient: choice(['grandparent', 'parent', 'child', 'adult', 'everyone']),
  }),
  grounding: object({
    content_id: {...text(100), minLength: 1}, scene_id: text(80),
    at_seconds: {type: 'number', minimum: 0},
    evidence_ids: {...list(text(80), 20), description: 'Exact IDs of the supporting scene facts, completed transcript lines or validated graph connections supplied by the host or returned by tools. Never invent IDs.'},
    graph_ids: {...list(text(80)), description: 'IDs of validated graph connections used, or an empty array.'},
  }),
  new_connections: list(object({
    scope: choice(['scene', 'title', 'general']), subject: text(100), relation: choice(['explains', 'causes', 'resembles', 'connects to']),
    object: text(100), explanation: text(300), evidence_ids: list(text(80)),
  }), 2),
});

export const reviewSchema = object({
  issue: {...text(400), description: 'First identify any unsupported scene assertion or premature personal question. Give a correction, or an empty string if none.'}, supported: {type: 'boolean'},
  pause_requested: {type: 'boolean'}, life_requested: {type: 'boolean'},
});

const ajv = new Ajv({allErrors: true});
const version = {type: 'string', pattern: '^[a-f0-9]{64}$'};
const epoch = {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
const position = {type: 'number', minimum: 0, maximum: 86400};
const personalPreferences = Object.fromEntries(['need', 'language', 'recipient'].map(key => [key, requestSchema.properties[key]]));
export const validPlayback = ajv.compile(object({content_id: text(100), content_version: version, epoch, sequence: epoch,
  at_seconds: position, play_state: choice(['playing', 'paused', 'buffering', 'ended']), playback_rate: {type: 'number', minimum: 0.25, maximum: 4}}));
const holdSchema = object({content_version: version, epoch});
holdSchema.properties.from_seconds = position;
export const validHold = ajv.compile(holdSchema);
export const validPersonalAsk = ajv.compile(object({branch_id: {...text(36), minLength: 36}, request: {...text(600), minLength: 1},
  at_seconds: position, clarification: {type: 'boolean'}, ...personalPreferences}));
const returnProperties = {content_version: version, epoch, from_seconds: position, ...personalPreferences};
export const validReturn = ajv.compile(object(returnProperties));
export const validPersonalReturn = ajv.compile(object({...returnProperties, branch_id: {...text(36), minLength: 36}}));
export const validPersonalEnd = ajv.compile(object({branch_id: {...text(36), minLength: 36}}));
const validRequestShape = ajv.compile(requestSchema);
export function validRequest(input) {if (!validRequestShape(input)) return false; const selected = getStory(input.content_id); return Boolean(selected && input.at_seconds <= selected.duration);}
export const validCompanionRequest = ajv.compile(companionRequestSchema);
export const validResponse = ajv.compile(responseSchema);
export const validReview = ajv.compile(reviewSchema);

export function quietResponse(input, sceneId) {
  return {
    version: '1.0', state: 'quiet', answer: '',
    visual: {status: 'none', svg: '', description: '', animations: []},
    intervention: {playback: 'keep_watching', audio: 'silent'},
    life_connection: {offered: false, question: '', recipient: input.recipient},
    grounding: {content_id: input.content_id, scene_id: sceneId, at_seconds: input.at_seconds, evidence_ids: [], graph_ids: []},
    new_connections: [],
  };
}
