// Live, model-free check that the served UI's hold request matches the deployed server.
import assert from 'node:assert/strict';
const base = new URL(process.argv[2] || 'http://127.0.0.1:4519');
let session;
const post = async (path, body, id) => {
  const response = await fetch(new URL(path, base), {method: 'POST', signal: AbortSignal.timeout(15000),
    headers: {'Content-Type': 'application/json', ...(id ? {'X-Selene-Session': id} : {})}, body: JSON.stringify(body)});
  const result = await response.json();
  assert(response.ok, `${path.replace(/[0-9a-f-]{36}/g, 'viewer')}: ${result.error || response.status}`);
  return result;
};
try {
  session = await post('/api/session', {content_id: 'the-missing-crown'});
  const {story, session_id: id} = session;
  const sample = {content_version: story.content_version, epoch: 0, sequence: 1, at_seconds: story.duration};
  await post('/api/playback', {...sample, content_id: story.id, play_state: 'ended', playback_rate: 1}, id);
  const pairing = await post('/api/private/pair', {}, id);
  const {token} = await post('/api/private/join', {code: pairing.code});
  const {hold} = await post(`/api/private/${token}/hold`, {...sample, from_seconds: sample.at_seconds});
  assert.equal(hold.from_seconds, story.duration);
  await post(`/api/private/${token}/end`, {branch_id: hold.id});
  console.info('PASS: pairing, ended-film saved moment and branch close. No model request.');
} finally {
  if (session) await post('/api/session/end', {session_id: session.session_id});
}
