import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, randomInt} from 'node:crypto';
import {validRequest, validCompanionRequest, validPlayback, validHold, validPersonalAsk, validReturn, validPersonalReturn, validPersonalEnd} from './contract.mjs';
import {explain} from './agent.mjs';
import {story, stories, getStory, createMemory, companionContext, sceneContext} from './context.mjs';
import {enrichCompanionContext} from './external-context.mjs';
import {playerStory, conflict, recordPlayback, playbackSnapshot, requirePlayback, holdMoment, publicHold, requireHold, personalContext, guidedReturn, evidenceFor, captionsVtt} from './personal.mjs';

const root = fileURLToPath(new URL('../assets/', import.meta.url));
const port = Number(process.env.SELENE_PORT ?? 4519);
const hostname = process.env.SELENE_BIND ?? '127.0.0.1';
const appUrl = process.env.SELENE_APP_URL ?? `http://127.0.0.1:${port}`;
const mediaOrigin = process.env.SELENE_MEDIA_ORIGIN ? new URL(process.env.SELENE_MEDIA_ORIGIN).origin : '';
if (mediaOrigin && new URL(mediaOrigin).protocol !== 'https:') throw new Error('SELENE_MEDIA_ORIGIN must use HTTPS');
const deviceHosts = new Set([new URL(appUrl).host, `localhost:${port}`]);
const allowedHosts = new Set(deviceHosts);
if (mediaOrigin) allowedHosts.add(new URL(mediaOrigin).host);
const phoneHost = process.env.SELENE_PRIVATE_URL ? new URL(process.env.SELENE_PRIVATE_URL).host : '';
if (phoneHost) allowedHosts.add(phoneHost);
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'};
// Sessions and viewer answers are ephemeral. Only model-reviewed general graph concepts use the separate bounded graph store.
const active = new Set();
const sessions = new Map();
const joinAttempts = new Map();
function closeMirror(session) {
  session?.mirror?.controller?.abort();
  for (const client of session?.mirror?.clients ?? []) client.end('data: {"type":"closed"}\n\n');
  if (session) session.mirror = null;
}
function endSession(id) {
  const session = sessions.get(id);
  session?.controller?.abort();
  if (session) {
    session.memory.responses.clear(); session.memory.connections.length = 0;
    closeMirror(session);
    session.latestMoment = null; session.latestLanguage = 'English'; session.latestSlowerVoice = false; session.lifeVisible = false;
  }
  sessions.delete(id);
}

function send(res, status, body) {res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(body));}
function servedStory(story, publicMedia = false) {
  const result = playerStory(story);
  if (publicMedia && mediaOrigin) result.video = new URL(result.video, mediaOrigin).href;
  return result;
}
function privateUrl(token) {
  const base = process.env.SELENE_PRIVATE_URL ?? process.env.SELENE_APP_URL;
  if (!base) return null;
  const url = new URL(base);
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
  return `${url.origin}/?private=${encodeURIComponent(token)}`;
}
function mirrorMoment(session, moment) {
  if (session.lifeVisible || !moment?.life_connection) return moment;
  return {...moment, life_connection: {...moment.life_connection, offered: false, question: ''}};
}
function mirrorEvent(session, event) {
  return event.type === 'moment' && event.moment ? {...event, moment: mirrorMoment(session, event.moment)} : event;
}
function publishMirror(session, event) {
  if (!session?.mirror) return;
  // Own-player phone requests are independent; shared TV answers never replace private help.
  if (session.contentId && event.type !== 'playback') return;
  const visibleEvent = mirrorEvent(session, event);
  if (event.type !== 'playback') session.mirror.latest = visibleEvent;
  const payload = `data: ${JSON.stringify(visibleEvent).replace(/\u2028|\u2029/g, '')}\n\n`;
  for (const client of session.mirror.clients) client.write(payload);
}
function startRequest(owner, res) {
  if (owner.controller) {owner.controller.abort(); active.delete(owner.controller);}
  if (active.size >= 3) throw conflict('Another answer is being prepared. Try again in a moment.', 429);
  const controller = new AbortController(); active.add(controller); owner.controller = controller;
  res.on('close', () => {if (!res.writableEnded) controller.abort();});
  return controller;
}
function finishRequest(owner, controller) {
  active.delete(controller);
  if (owner.controller === controller) owner.controller = null;
}
function personalBootstrap(session) {
  return {type: 'personal', story: servedStory(getStory(session.contentId), true), playback: playbackSnapshot(session), hold: publicHold(session.mirror.hold)};
}

export const server = createServer(async (req, res) => {
  const nonce = randomUUID();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self'; media-src 'self' ${mediaOrigin}; connect-src 'self'; frame-src 'self' about:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
  const host = req.headers.host;
  if (!allowedHosts.has(host) && !(req.method === 'GET' && req.url === '/api/health')) return send(res, 403, {error: 'Unrecognized host'});
  try {
    const url = new URL(req.url, `http://${host}`);
    if (!deviceHosts.has(host) && url.pathname.startsWith('/api/')
      && url.pathname !== '/api/health' && url.pathname !== '/api/private/join'
      && !/^\/api\/private\/[0-9a-f-]{36}(?:\/(?:captions|hold|ask|return|end))?$/.test(url.pathname)) {
      return send(res, 403, {error: 'This address is for paired phones only.'});
    }
    if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, {status: 'ok', provider_configured: Boolean(process.env.AGENT_PROVIDER_URL && process.env.AGENT_PROVIDER_MODEL && process.env.AGENT_PROVIDER_API_KEY), scene_context_configured: Boolean(process.env.SELENE_SCENE_CONTEXT_URL)});
    if (url.pathname === '/api/catalog' && req.method === 'GET') {
      return send(res, 200, {stories: stories.map(({id, title, subtitle, duration, poster}) => ({id, title, subtitle, duration, poster}))});
    }
    if (url.pathname === '/api/story' && req.method === 'GET') {
      // Captions belong to the player; facts and graph remain server-side.
      const selectedStory = getStory(url.searchParams.get('id') ?? undefined);
      if (!selectedStory) return send(res, 404, {error: 'Story not found'});
      return send(res, 200, servedStory(selectedStory));
    }
    if (url.pathname.startsWith('/api/') && req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}` && origin !== `https://${host}`) return send(res, 403, {error: 'Cross-origin request rejected'});
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res, 415, {error: 'JSON required'});
      let size = 0; const chunks = [];
      const maxBytes = url.pathname === '/api/companion/moment' ? 32768 : 8192;
      for await (const chunk of req) { size += chunk.length; if (size > maxBytes) return send(res, 413, {error: 'Request too large'}); chunks.push(chunk); }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(res, 400, {error: 'Invalid JSON'}); }
      if (url.pathname === '/api/session') {
        const companionSession = input?.mode === 'companion';
        if ((input?.mode !== undefined && !companionSession) || (companionSession && input.content_id !== undefined)) return send(res, 400, {error: 'Invalid session mode'});
        // ponytail: a local TV relay keeps eight ephemeral sessions; an evicted client can start a fresh session.
        if (sessions.size >= 8) endSession(sessions.keys().next().value);
        const selectedStory = companionSession ? null : input?.content_id === undefined ? story : getStory(input.content_id);
        if (!companionSession && !selectedStory) return send(res, 400, {error: 'Unknown story'});
        const id = randomUUID();
        sessions.set(id, {contentId: selectedStory?.id ?? null, contentVersion: selectedStory ? playerStory(selectedStory).content_version : null,
          duration: selectedStory?.duration ?? 0, playback: null, memory: createMemory(), controller: null, clarification: null, mirror: null, latestMoment: null, latestLanguage: 'English', latestSlowerVoice: false, lifeVisible: false});
        const private_mirror_available = Boolean(privateUrl('capability'));
        if (companionSession) return send(res, 201, {session_id: id, private_mirror_available});
        return send(res, 201, {session_id: id, private_mirror_available, story: servedStory(selectedStory), catalog: stories.map(({id: content_id, title, subtitle, duration, poster}) => ({id: content_id, title, subtitle, duration, poster}))});
      }
      if (url.pathname === '/api/session/end') {
        if (!input || typeof input.session_id !== 'string') return send(res, 400, {error: 'Session required'});
        endSession(input.session_id);
        return send(res, 200, {closed: true});
      }
      if (url.pathname === '/api/private/pair') {
        const session = sessions.get(req.headers['x-selene-session']);
        if (!session) return send(res, 410, {error: 'This viewing session has ended. Start a new session to continue.'});
        const token = randomUUID();
        const url = privateUrl(token);
        if (!url) return send(res, 503, {error: 'Phone pairing needs a reachable HTTPS relay address. Continue on this TV.'});
        closeMirror(session);
        let code;
        do {code = String(randomInt(100000, 1000000));} while ([...sessions.values()].some(candidate => candidate.mirror?.code === code));
        const expires_at = Date.now() + 5 * 60 * 1000;
        session.mirror = {token, code, expires_at, clients: new Set(), hold: null, controller: null,
          latest: !session.contentId && session.latestMoment ? mirrorEvent(session, {type: 'moment', moment: session.latestMoment, language: session.latestLanguage, slower_answer_voice: session.latestSlowerVoice}) : null};
        return send(res, 201, {url, code, expires_at, join_url: `${new URL(url).origin}/?join=1`});
      }
      if (url.pathname === '/api/private/join') {
        const now = Date.now();
        for (const [key, value] of joinAttempts) if (now - value.at > 60000) joinAttempts.delete(key);
        // ponytail: one relay, bounded in-memory attempt limits; shared storage if deployed across processes.
        const address = req.socket.remoteAddress;
        const attempts = joinAttempts.get(address) ?? {at: now, count: 0};
        if (attempts.count >= 8 || (!joinAttempts.has(address) && joinAttempts.size >= 100)) return send(res, 429, {error: 'Too many code attempts. Wait one minute and try again.'});
        attempts.count++; joinAttempts.set(address, attempts);
        if (!input || Object.keys(input).length !== 1 || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) return send(res, 400, {error: 'Enter the six-digit code shown on the TV.'});
        const session = [...sessions.values()].find(candidate => candidate.mirror?.code === input.code && candidate.mirror.expires_at > now);
        if (!session) return send(res, 404, {error: 'That code expired or was used. Create a new code on the TV.'});
        session.mirror.code = null; // One viewer. Replacing the pairing revokes the previous capability.
        return send(res, 200, {token: session.mirror.token});
      }
      if (url.pathname === '/api/playback') {
        const session = sessions.get(req.headers['x-selene-session']);
        if (!session) return send(res, 410, {error: 'This viewing session has ended.'});
        if (!validPlayback(input)) return send(res, 400, {error: 'Invalid playback position'});
        const changed = recordPlayback(session, input);
        if (changed) {
          if (session.mirror?.hold && session.mirror.hold.epoch !== input.epoch) {
            session.mirror.controller?.abort(); session.mirror.hold = null;
          }
          publishMirror(session, {type: 'playback', playback: playbackSnapshot(session)});
        }
        return send(res, 200, {playback: playbackSnapshot(session)});
      }
      if (url.pathname === '/api/return') {
        const session = sessions.get(req.headers['x-selene-session']);
        if (!session) return send(res, 410, {error: 'This viewing session has ended.'});
        if (!session.contentId) return send(res, 409, {error: 'Guided Return needs an available permitted film source.'});
        if (!validReturn(input)) return send(res, 400, {error: 'Invalid return interval'});
        const playback = requirePlayback(session, input.content_version, input.epoch);
        const controller = startRequest(session, res);
        try {
          const {need, language, recipient} = input;
          const result = await guidedReturn(getStory(session.contentId), input.from_seconds, playback, {need, language, recipient}, {signal: controller.signal, memory: session.memory, output: 'shared_tv'});
          controller.signal.throwIfAborted();
          requirePlayback(session, input.content_version, input.epoch);
          return send(res, 200, result);
        } finally {finishRequest(session, controller);}
      }
      const personalMatch = /^\/api\/private\/([0-9a-f-]{36})\/(hold|ask|return|end)$/.exec(url.pathname);
      if (personalMatch) {
        const session = [...sessions.values()].find(candidate => candidate.mirror?.token === personalMatch[1]);
        if (!session?.mirror) return send(res, 410, {error: 'This phone connection has ended. Pair again on the TV.'});
        if (!session.contentId) return send(res, 409, {error: 'This player only shares answers. Personal replay needs an available permitted film source.'});
        const mirror = session.mirror, action = personalMatch[2], selectedStory = getStory(session.contentId);
        if (action === 'hold') {
          if (!validHold(input)) return send(res, 400, {error: 'Invalid personal pause'});
          const hold = holdMoment(session, input);
          mirror.controller?.abort(); mirror.hold = hold;
          return send(res, 201, {hold: publicHold(hold), playback: playbackSnapshot(session)});
        }
        if (action === 'end') {
          if (!validPersonalEnd(input)) return send(res, 400, {error: 'Invalid personal pause'});
          if (mirror.hold && mirror.hold.id !== input.branch_id) return send(res, 409, {error: 'That personal pause has changed. Reconnect before closing it.'});
          mirror.controller?.abort(); mirror.hold = null;
          return send(res, 200, {closed: true});
        }
        if (!(action === 'ask' ? validPersonalAsk(input) : validPersonalReturn(input))) return send(res, 400, {error: 'Invalid personal request'});
        const hold = requireHold(session, input.branch_id);
        const playback = requirePlayback(session, hold.content_version, hold.epoch);
        if (action === 'return' && (input.content_version !== hold.content_version || input.epoch !== hold.epoch || input.from_seconds !== hold.from_seconds)) return send(res, 409, {error: 'The saved starting point changed. Try Bring me back again.'});
        if (action === 'ask' && (!input.request.trim() || input.at_seconds > playback.at_seconds)) return send(res, 400, {error: 'Ask about a moment already reached on the TV.'});
        const controller = startRequest(mirror, res);
        try {
          const {need, language, recipient} = input;
          let result;
          if (action === 'return') {
            result = await guidedReturn(selectedStory, hold.from_seconds, playback, {need, language, recipient}, {signal: controller.signal, memory: hold.memory, question: hold.question});
          } else {
            let context = personalContext(selectedStory, input.at_seconds, hold.previous);
            let request = {request: input.request.trim(), content_id: selectedStory.id, at_seconds: input.at_seconds,
              play_state: 'paused', playback_choice: 'keep_watching', need, language, recipient, session: 'solo', life_connection: false, continuation: null};
            if (input.clarification) {
              const previous = hold.clarification;
              if (!previous || input.at_seconds !== previous.input.at_seconds || need !== previous.input.need || language !== previous.input.language || recipient !== previous.input.recipient) throw conflict('That clarification changed. Ask the question again.');
              context = structuredClone(previous.context);
              request = {...previous.input, continuation: {request: previous.input.request, question: previous.question, answer: input.request.trim()}};
            } else hold.clarification = null;
            const moment = await explain(request, {signal: controller.signal, memory: hold.memory, context});
            controller.signal.throwIfAborted(); requireHold(session, input.branch_id);
            hold.question = request.request;
            hold.previous = {request: request.request, answer: moment.answer, at_seconds: request.at_seconds};
            hold.clarification = moment.state === 'clarification' ? {input: request, context, question: moment.answer} : null;
            result = {moment, evidence: evidenceFor(moment, context)};
          }
          controller.signal.throwIfAborted(); requireHold(session, input.branch_id);
          return send(res, 200, result);
        } finally {finishRequest(mirror, controller);}
      }
      if (url.pathname === '/api/private/close') {
        const session = sessions.get(req.headers['x-selene-session']);
        if (!session) return send(res, 410, {error: 'This viewing session has ended.'});
        closeMirror(session);
        return send(res, 200, {closed: true});
      }
      if (url.pathname === '/api/private/life') {
        const session = sessions.get(req.headers['x-selene-session']);
        if (!session) return send(res, 410, {error: 'This viewing session has ended.'});
        if (!session.mirror) return send(res, 409, {error: 'Pair a private mirror before changing its Life Connection visibility.'});
        if (!input || typeof input.visible !== 'boolean') return send(res, 400, {error: 'Life Connection visibility required'});
        session.lifeVisible = input.visible;
        if (session.latestMoment) publishMirror(session, {type: 'moment', moment: session.latestMoment, language: session.latestLanguage, slower_answer_voice: session.latestSlowerVoice});
        return send(res, 200, {visible: session.lifeVisible});
      }
      const companion = url.pathname === '/api/companion/moment';
      if (!companion && url.pathname !== '/api/moment') return send(res, 404, {error: 'Not found'});
      if (!(companion ? validCompanionRequest(input) : validRequest(input))) return send(res, 400, {error: 'Invalid moment request'});
      const session = sessions.get(req.headers['x-selene-session']);
      if (!session) return send(res, 410, {error: 'This viewing session has ended. Start a new session to continue.'});
      if (companion && session.contentId !== null) return send(res, 409, {error: 'Open a companion viewing session to ask about another app.'});
      const selectedStory = companion ? null : getStory(input.content_id);
      if (!companion && !selectedStory) return send(res, 400, {error: 'Unknown story'});
      if (!companion && session.contentId !== input.content_id) return send(res, 409, {error: 'This story is not the active viewing session.'});
      const controller = startRequest(session, res);
      session.lifeVisible = false;
      session.latestMoment = null;
      if (!input.continuation) session.clarification = null;
      publishMirror(session, {type: 'ready'});
      try {
        let context = companion ? companionContext(input.snapshot, input.scene_detail, input.scene_answer) : sceneContext(input.at_seconds, selectedStory);
        if (input.continuation) {
          const previous = session.clarification;
          if (!previous || input.request !== previous.request || input.continuation.request !== input.request || input.continuation.question !== previous.question || context.content_id !== previous.context.content_id || context.provider?.session_id !== previous.context.provider?.session_id || context.at_seconds !== previous.context.at_seconds) return send(res, 409, {error: 'That clarification has ended. Close this response and ask about the moment again.'});
          // The answer belongs to the original evidence, even if an external feed changes or fails later.
          context = structuredClone(previous.context);
        } else if (companion && process.env.SELENE_SCENE_CONTEXT_URL) {
          try {context = await enrichCompanionContext(context, input.snapshot, controller.signal);} catch {controller.signal.throwIfAborted(); context = {...context, scene_source: 'viewer'};}
        }
        if (companion) {
          const {snapshot, scene_detail, scene_answer, ...request} = input;
          input = {...request, content_id: context.content_id, at_seconds: context.at_seconds};
        }
        if (companion && input.continuation) context.facts.push({id: 'viewer-clarification', source: 'viewer', text: input.continuation.answer});
        const moment = await explain(input, {signal: controller.signal, memory: session.memory, context});
        if (!controller.signal.aborted) {
          session.latestMoment = moment; session.latestLanguage = input.language; session.latestSlowerVoice = input.need === 'Slower answer voice'; session.lifeVisible = false;
          publishMirror(session, {type: 'moment', moment, language: input.language, slower_answer_voice: session.latestSlowerVoice});
          session.clarification = moment.state === 'clarification' ? {request: input.request, question: moment.answer, context} : null;
          send(res, 200, moment);
        }
      } finally {finishRequest(session, controller);}
      return;
    }
    const privateMatch = /^\/api\/private\/([0-9a-f-]{36})(\/captions)?$/.exec(url.pathname);
    if (privateMatch && req.method === 'GET') {
      const session = [...sessions.values()].find(candidate => candidate.mirror?.token === privateMatch[1]);
      if (!session?.mirror) return send(res, 404, {error: 'This private mirror is closed.'});
      if (privateMatch[2]) {
        if (!session.contentId) return send(res, 404, {error: 'No permitted caption source is available.'});
        res.writeHead(200, {'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store'});
        return res.end(captionsVtt(getStory(session.contentId)));
      }
      res.writeHead(200, {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff'});
      res.write(`data: ${JSON.stringify(session.contentId ? personalBootstrap(session) : session.mirror.latest ?? {type: 'ready'})}\n\n`);
      const clients = session.mirror.clients;
      clients.add(res);
      const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
      res.on('close', () => {clearInterval(heartbeat); clients.delete(res);});
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, {error: 'Method not allowed'});
    const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(`${root.replace(/\/$/, '')}${sep}`)) return send(res, 403, {error: 'Forbidden'});
    const file = await stat(path);
    if (!file.isFile()) return send(res, 404, {error: 'Not found'});
    if (extname(path) === '.html') {
      // srcdoc inherits this document's CSP. Only the host renderer receives its nonce.
      const html = (await readFile(path, 'utf8')).replace('</head>', `<meta name="selene-renderer-nonce" content="${nonce}"></head>`);
      res.writeHead(200, {'Content-Type': mime['.html'], 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html)});
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    const headers = {'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes'};
    let start = 0; let end = file.size - 1; let status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {res.setHeader('Content-Range', `bytes */${file.size}`); return send(res, 416, {error: 'Invalid range'});}
      start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= file.size) {res.setHeader('Content-Range', `bytes */${file.size}`); return send(res, 416, {error: 'Invalid range'});}
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(path, {start, end});
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  } catch (error) {
    if (res.destroyed) return;
    if (error.status && !res.headersSent) return send(res, error.status, {error: error.message});
    if (error.code === 'ENOENT') return send(res, 404, {error: 'Not found'});
    // Never return upstream response bodies, credentials, prompts or family requests.
    console.error(`SELENE request failed: ${error.name === 'AbortError' ? 'cancelled' : 'service unavailable'}`);
    if (!res.headersSent) send(res, 502, {error: 'This moment could not be prepared. Your player controls are still available. Please try again.'});
  }
});

server.requestTimeout = 0; // Keep SSE open; model work has its own deadline and viewer cancellation.
server.on('error', error => {console.error(error.code === 'EADDRINUSE' ? `SELENE port ${port} is already in use. Set SELENE_PORT in the parent .env and rebuild.` : 'SELENE could not start.'); process.exitCode = 1;});
server.listen(port, hostname, () => console.info(`SELENE ready at http://${hostname}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {for (const id of sessions.keys()) endSession(id); server.close();});
