/* global AbortSignal */
// Native relay client: the same contract the web player used (server/index.mjs).
import {appUrl} from './config.json';

export const base = appUrl.replace(/\/$/, '');
export const mediaUrl = (path: string) => /^https?:/.test(path) ? path : `${base}${path}`;
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export type Line = {id: string; start: number; end: number; text: string};
export type Story = {
  id: string; content_version: string; title: string; subtitle: string; duration: number; video: string; poster: string;
  scenes: {id: string; start: number; end: number; label: string}[]; transcript: Line[];
  ingestion?: {credit: string | null; license_url: string | null; caption_source?: 'supplied' | 'embedded' | 'generated' | 'unavailable'; evidence_notice?: string};
};
export type CatalogStory = {id: string; title: string; subtitle: string; duration: number; poster: string};
export type Animation = {target_id: string; duration_ms: number; delay_ms: number; keyframes: {opacity?: number; transform?: string}[]};
export type VisualArtifact = {status: 'ready' | 'fallback' | 'none'; svg: string; description: string; animations: Animation[]};
export type Moment = {state: 'quiet' | 'response' | 'clarification'; answer: string; visual: VisualArtifact;
  intervention: {playback: 'keep_watching' | 'offer_choice' | 'request_pause'; audio: 'silent'};
  grounding: {content_id: string; scene_id: string; at_seconds: number; evidence_ids: string[]}};
export type Evidence = {id: string; at_seconds: number; text: string; source: string};
export type ReturnResult = {status: 'ready' | 'no_gap' | 'insufficient_evidence' | 'unavailable'; from_seconds: number; through_seconds: number;
  content_version: string; epoch: number; moment: Moment | null; evidence: Evidence[]; quote?: {id: string; at_seconds: number; text: string} | null};
export type Pairing = {url: string; code: string; join_url: string; expires_at: number};
export type Example = {id: string; request: string; at_seconds: number};
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type Placement = {corner: Corner; at_seconds: number; duration_seconds: 10};
// One turn of the simulated Alexa+ orchestrator (/api/assistant).
export type AssistantReply = {tool: string; text: string; moment: Moment | null; label: string;
  command: {action: string; position_ms?: number; relative?: boolean} | null};
export type Choice = 'unspecified' | 'keep_watching' | 'pause_to_explore';
export type Need = 'Show visually' | 'Slower answer voice';
export type Input = {
  request: string; content_id: string; at_seconds: number; play_state: 'playing' | 'paused' | 'ended';
  playback_choice: Choice; need: Need; language: 'English'; session: 'family' | 'solo'; recipient: 'everyone';
  continuation: {request: string; question: string; answer: string} | null;
};
export type Bundle = {session_id: string; private_mirror_available?: boolean; story: Story; catalog?: CatalogStory[]};

export class RelayError extends Error {
  constructor(message: string, readonly status = 0) {super(message);}
}

// Bounds the whole request without aborting the caller's controller, so a timeout (retry) stays distinct from cancellation (silent).
export async function request<T>(path: string, {method = 'GET', body, session, signal, timeoutMs = 15000}: {method?: string; body?: unknown; session?: string; signal?: AbortSignal; timeoutMs?: number} = {}): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel);
  let timedOut = false;
  const timer = timeoutMs ? setTimeout(() => {timedOut = true; controller.abort();}, timeoutMs) : undefined;
  try {
    const response = await fetch(`${base}${path}`, {method, signal: controller.signal,
      headers: {'Content-Type': 'application/json', ...(session ? {'X-Selene-Session': session} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new RelayError(result.error || 'This action could not finish. Try again.', response.status);
    return result as T;
  } catch (error) {
    if (timedOut) throw new RelayError('The connection took too long. Try again.');
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export const openSession = (body: {content_id?: string} | {mode: 'companion'}, signal?: AbortSignal) =>
  request<Bundle>('/api/session', {method: 'POST', body, signal, timeoutMs: 0});
export function endSession(session: string) {
  if (session) void request('/api/session/end', {method: 'POST', body: {session_id: session}}).catch(() => undefined);
}
