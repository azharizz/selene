import type {VisualArtifact} from './Visual';
import type {Recipient} from './preferences';

export type PersonalStory = {
  id: string; content_version: string; title: string; subtitle: string; duration: number; video: string; poster: string;
  scenes: {id: string; start: number; end: number; label: string}[];
  transcript: {id: string; start: number; end: number; text: string}[];
  ingestion?: {credit: string; license_url: string};
};
export type Playback = {content_id: string; content_version: string; epoch: number; sequence: number; at_seconds: number;
  play_state: 'playing' | 'paused' | 'buffering' | 'ended'; playback_rate: number; age_ms: number; fresh: boolean};
export type PersonalHold = {id: string; from_seconds: number; content_version: string; epoch: number};
export type PersonalMoment = {state: 'quiet' | 'response' | 'clarification'; answer: string; visual: VisualArtifact;
  intervention: {playback: 'keep_watching' | 'offer_choice' | 'request_pause'; audio: 'silent'};
  life_connection: {offered: boolean; question: string; recipient: Recipient};
  grounding: {content_id: string; scene_id: string; at_seconds: number; evidence_ids: string[]}};
export type Evidence = {id: string; at_seconds: number; text: string; source: string};
export type ReturnResult = {status: 'ready' | 'no_gap' | 'insufficient_evidence' | 'unavailable'; from_seconds: number; through_seconds: number;
  content_version: string; epoch: number; moment: PersonalMoment | null; evidence: Evidence[]};
export type Pairing = {url: string; code: string; join_url: string; expires_at: number};
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// Bound the complete request, including its body, without aborting the caller's controller.
// Callers can then distinguish a timeout (show Retry) from cancellation (stay silent).
export async function personalRequest(url: string, options: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener('abort', cancel, {once: true});
  const timeout = setTimeout(() => controller.abort(new DOMException('The connection took too long. Try again.', 'TimeoutError')), timeoutMs);
  try {
    const response = await fetch(url, {...options, signal: controller.signal});
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'This action could not finish. Try again.'), {status: response.status});
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
