import {timingSafeEqual} from 'node:crypto';

// Scheduled wake-up for Follow thread and "Something to talk about".
// infra/aws: Amazon EventBridge Scheduler -> AWS Lambda -> POST /api/wake (Bearer SELENE_WAKE_TOKEN).
// The relay keeps its own in-process timers; this sweep re-runs any due check through the same logic
// when the phone is asleep (Follow thread is otherwise phone-polled) or a relay timer was lost on restart.

export function wakeAuthorized(header, token) {
  if (!token) return false;
  const given = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, '')), want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function wakeSessions(sessions, {snapshot, threadCheck, schedule}) {
  let threads = 0, conversations = 0;
  for (const session of sessions.values()) {
    const mirror = session.mirror, playback = snapshot(session);
    if (!mirror || !playback?.fresh) continue;  // a stale TV position is never an evidence boundary
    if (mirror.thread && !mirror.controller && playback.at_seconds > mirror.thread.checked_through_seconds) {
      const {content_version, epoch, sequence, at_seconds} = playback;
      try { await threadCheck(session, {content_version, epoch, sequence, at_seconds}); threads++; } catch { /* the next sweep or phone poll retries */ }
    }
    if (mirror.conversation && !mirror.conversation.controller) { schedule(session); conversations++; }
  }
  return {threads, conversations};
}
