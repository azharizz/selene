import Ajv from 'ajv';
import {getStory} from './context.mjs';

const object = properties => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false});
const text = (maxLength = 800) => ({type: 'string', maxLength});
const choice = values => ({type: 'string', enum: values});
const list = (items, maxItems = 12) => ({type: 'array', items, maxItems});
export const requestSchema = object({
  request: text(600), content_id: {...text(100), minLength: 1},
  at_seconds: {type: 'number', minimum: 0},
  play_state: choice(['playing', 'paused', 'ended']),
  playback_choice: choice(['unspecified', 'keep_watching', 'pause_to_explore']),
  need: choice(['Explain simply', 'Slower answer voice', 'Translate', 'Show visually']),
  language: choice(['English', 'Indonesian', 'Spanish']),
  session: choice(['family', 'solo']),
  recipient: choice(['grandparent', 'parent', 'child', 'adult', 'everyone']),
});
// One clarification belongs to the same moment, not an open conversation history.
requestSchema.properties.continuation = {anyOf: [{type: 'null'}, object({request: text(600), question: text(560), answer: text(600)})]};
// Optional for existing authored-demo clients; explicit generate always bypasses prepared answers and reuse.
export const answerModeSchema = choice(['prepared', 'generate']);
export const communicationPreferencesSchema = {...object({
  role: requestSchema.properties.recipient, style: choice(['simple', 'standard', 'detailed']),
  language: requestSchema.properties.language, need: requestSchema.properties.need,
}), required: []};
requestSchema.properties.answer_mode = answerModeSchema;
requestSchema.properties.communication_preferences = communicationPreferencesSchema;

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
companionRequestSchema.required = companionRequestSchema.required.filter(key => !['answer_mode', 'communication_preferences'].includes(key));
const requesterId = {...text(36), minLength: 36, pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
requestSchema.properties.requester_id = requesterId;
companionRequestSchema.properties.requester_id = requesterId;

const mediaImportSchema = object({
  url: {type: 'string', minLength: 1, maxLength: 2048, pattern: '^https://'},
  title: {type: 'string', minLength: 1, maxLength: 500},
});
mediaImportSchema.properties.captions = text(1048576);

export const responseSchema = object({
  version: choice(['1.0']),
  state: choice(['quiet', 'response', 'clarification']),
  answer: {...text(560), description: 'The actual short explanation or clarification question, visible to the viewer. Must be nonempty for response or clarification. Only quiet may have an empty answer. SVG labels cannot replace this answer.'},
  visual: object({
    status: choice(['ready', 'fallback', 'none']), svg: text(24000), description: text(240),
    animations: {type: 'array', items: object({
      target_id: {type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,40}$'},
      duration_ms: {type: 'integer', minimum: 1500, maximum: 5000},
      delay_ms: {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER},
      keyframes: {type: 'array', minItems: 2, items: object({
        opacity: {type: 'number', minimum: 0.4, maximum: 1},
        transform: {type: 'string'},
      })},
    })},
  }),
  intervention: object({
    playback: choice(['keep_watching', 'offer_choice', 'request_pause']),
    audio: choice(['silent']),
  }),
  grounding: object({
    content_id: {...text(100), minLength: 1}, scene_id: text(80),
    at_seconds: {type: 'number', minimum: 0},
    evidence_ids: {...list(text(80), 20), description: 'Exact IDs of supporting original facts or completed caption cues supplied by the host. For each cited movie-graph interpretation, include its original supporting caption IDs. Never invent IDs.'},
    graph_ids: {...list(text(80)), description: 'IDs of current movie caption-graph nodes/edges used, or an empty array. Graph interpretations are provisional, never independent evidence.'},
  }),
});
// Structured Outputs supports anyOf; use complete object branches rather than an unsupported if/then keyword.
const visualSchema = responseSchema.properties.visual;
responseSchema.properties.visual = {anyOf: [
  {...visualSchema, properties: {...visualSchema.properties, status: choice(['ready']),
    animations: {...visualSchema.properties.animations, minItems: 1}}},
  {...visualSchema, properties: {...visualSchema.properties, status: choice(['fallback', 'none']),
    svg: {...text(24000), maxLength: 0}, animations: {...visualSchema.properties.animations, maxItems: 0}}},
]};


export const reviewSchema = object({
  issue: {...text(400), description: 'First identify any unsupported scene assertion or premature personal question. Give a correction, or an empty string if none.'}, supported: {type: 'boolean'},
  pause_requested: {type: 'boolean'},
});

const ajv = new Ajv({allErrors: true});
export const validMediaImport = ajv.compile(mediaImportSchema);
const version = {type: 'string', pattern: '^[a-f0-9]{64}$'};
const epoch = {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
const position = {type: 'number', minimum: 0};
const personalPreferences = Object.fromEntries(['need', 'language', 'recipient'].map(key => [key, requestSchema.properties[key]]));
export const validPlayback = ajv.compile(object({content_id: text(100), content_version: version, epoch, sequence: epoch,
  at_seconds: position, play_state: choice(['playing', 'paused', 'buffering', 'ended']), playback_rate: {type: 'number', minimum: 0.25, maximum: 4}}));
export const sampleProperties = {content_version: version, epoch, sequence: epoch, at_seconds: position};
const holdSchema = object({...sampleProperties});
holdSchema.properties.from_seconds = position;
export const validHold = ajv.compile(holdSchema);
export const personalAskSchema = object({branch_id: {...text(36), minLength: 36}, request: {...text(600), minLength: 1},
  at_seconds: position, clarification: {type: 'boolean'}, new_topic: {type: 'boolean'}, ...personalPreferences});
personalAskSchema.properties.answer_mode = answerModeSchema;
personalAskSchema.properties.communication_preferences = communicationPreferencesSchema;
personalAskSchema.properties.requester_id = requesterId;
export const validPersonalAsk = ajv.compile(personalAskSchema);
const returnProperties = {content_version: version, epoch, from_seconds: position, ...personalPreferences};
const returnSchema = object({...returnProperties});
returnSchema.properties.communication_preferences = communicationPreferencesSchema;
returnSchema.properties.requester_id = requesterId;
export const validReturn = ajv.compile(returnSchema);
export const personalReturnSchema = object({...returnProperties, branch_id: {...text(36), minLength: 36}, sequence: epoch, through_seconds: position});
personalReturnSchema.properties.communication_preferences = communicationPreferencesSchema;
personalReturnSchema.properties.requester_id = requesterId;
export const validPersonalReturn = ajv.compile(personalReturnSchema);
export const validPersonalEnd = ajv.compile(object({branch_id: {...text(36), minLength: 36}}));
export const personalThreadSchema = object({enabled: {type: 'boolean'}, answer_id: {...text(36), minLength: 36}});
export const validPersonalThread = ajv.compile(personalThreadSchema);
export const validThreadCheck = ajv.compile(object(sampleProperties));
export {holdSchema};
const validRequestShape = ajv.compile(requestSchema);
export function validRequest(input) {if (!validRequestShape(input)) return false; const selected = getStory(input.content_id); return Boolean(selected && input.at_seconds <= selected.duration);}
export const validCompanionRequest = ajv.compile(companionRequestSchema);
export const validResponse = ajv.compile(responseSchema);
export const validReview = ajv.compile(reviewSchema);
export const validAssistantRequest = ajv.compile({...object({
  request: {...text(500), minLength: 1}, content_id: text(100), at_seconds: position,
  requester_id: requesterId, answer_mode: answerModeSchema, communication_preferences: communicationPreferencesSchema,
}), required: ['request', 'content_id', 'at_seconds']});

export function quietResponse(input, sceneId) {
  return {
    version: '1.0', state: 'quiet', answer: '',
    visual: {status: 'none', svg: '', description: '', animations: []},
    intervention: {playback: 'keep_watching', audio: 'silent'},
    grounding: {content_id: input.content_id, scene_id: sceneId, at_seconds: input.at_seconds, evidence_ids: [], graph_ids: []},
  };
}
