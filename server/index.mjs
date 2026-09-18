import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {validRequest, validCompanionRequest} from './contract.mjs';
import {explain} from './agent.mjs';
import {story, stories, getStory, createMemory, companionContext, sceneContext} from './context.mjs';
import {enrichCompanionContext} from './external-context.mjs';

const root = fileURLToPath(new URL('../assets/', import.meta.url));
const port = Number(process.env.SELENE_PORT ?? 4519);
const hostname = process.env.SELENE_BIND ?? '127.0.0.1';
const appUrl = process.env.SELENE_APP_URL ?? `http://127.0.0.1:${port}`;
const allowedHosts = new Set([new URL(appUrl).host, `localhost:${port}`]);
if (process.env.SELENE_PRIVATE_URL) allowedHosts.add(new URL(process.env.SELENE_PRIVATE_URL).host);
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'};
// Sessions and viewer answers are ephemeral. Only model-reviewed general graph concepts use the separate bounded graph store.
const active = new Set();
const sessions = new Map();
function endSession(id) {
  const session = sessions.get(id);
  session?.controller?.abort();
  if (session) {
    session.memory.responses.clear(); session.memory.connections.length = 0;
    for (const client of session.mirror?.clients ?? []) client.end();
    session.mirror = null; session.latestMoment = null; session.latestLanguage = 'English'; session.lifeVisible = false;
  }
  sessions.delete(id);
}

function send(res, status, body) {res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(body));}
function privateUrl(token) {
  const base = (process.env.SELENE_PRIVATE_URL ?? process.env.SELENE_APP_URL ?? `http://${hostname}:${port}`).replace(/\/$/, '');
  return `${base}/?private=${encodeURIComponent(token)}`;
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
  const visibleEvent = mirrorEvent(session, event);
  session.mirror.latest = visibleEvent;
  const payload = `data: ${JSON.stringify(visibleEvent).replace(/\u2028|\u2029/g, '')}\n\n`;
  for (const client of session.mirror.clients) client.write(payload);
}

export const server = createServer(async (req, res) => {
  const nonce = randomUUID();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'self'; frame-src 'self' about:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
  const host = req.headers.host;
  if (!allowedHosts.has(host)) return send(res, 403, {error: 'Unrecognized host'});
  try {
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, {status: 'ok', provider_configured: Boolean(process.env.AGENT_PROVIDER_URL && process.env.AGENT_PROVIDER_MODEL && process.env.AGENT_PROVIDER_API_KEY), scene_context_configured: Boolean(process.env.SELENE_SCENE_CONTEXT_URL)});
    if (url.pathname === '/api/catalog' && req.method === 'GET') {
      return send(res, 200, {stories: stories.map(({id, title, subtitle, duration, poster}) => ({id, title, subtitle, duration, poster}))});
    }
    if (url.pathname === '/api/story' && req.method === 'GET') {
      // Captions belong to the player; facts and graph remain server-side.
      const selectedStory = getStory(url.searchParams.get('id') ?? undefined);
      if (!selectedStory) return send(res, 404, {error: 'Story not found'});
      const {facts, ...playerStory} = selectedStory;
      return send(res, 200, playerStory);
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
        // ponytail: a local TV relay keeps eight ephemeral sessions; an evicted client can start a fresh session.
        if (sessions.size >= 8) endSession(sessions.keys().next().value);
        const selectedStory = input?.content_id === undefined ? story : getStory(input.content_id);
        if (!selectedStory) return send(res, 400, {error: 'Unknown story'});
        const id = randomUUID();
        sessions.set(id, {contentId: selectedStory.id, memory: createMemory(), controller: null, clarification: null, mirror: null, latestMoment: null, latestLanguage: 'English', lifeVisible: false});
        const {facts, ...playerStory} = selectedStory;
        return send(res, 201, {session_id: id, story: playerStory, catalog: stories.map(({id: content_id, title, subtitle, duration, poster}) => ({id: content_id, title, subtitle, duration, poster}))});
      }
      if (url.pathname === '/api/session/end') {
        if (!input || typeof input.session_id !== 'string') return send(res, 400, {error: 'Session required'});
        endSession(input.session_id);
        return send(res, 200, {closed: true});
      }
      if (url.pathname === '/api/private/pair') {
        const session = sessions.get(req.headers['x-selene-session']);
        if (!session) return send(res, 410, {error: 'This viewing session has ended. Start a new session to continue.'});
        for (const client of session.mirror?.clients ?? []) client.end();
        const token = randomUUID();
        session.mirror = {token, clients: new Set(), latest: session.latestMoment ? mirrorEvent(session, {type: 'moment', moment: session.latestMoment, language: session.latestLanguage}) : null};
        return send(res, 201, {url: privateUrl(token)});
      }
      if (url.pathname === '/api/private/close') {
        const session = sessions.get(req.headers['x-selene-session']);
        if (!session) return send(res, 410, {error: 'This viewing session has ended.'});
        for (const client of session.mirror?.clients ?? []) client.end();
        session.mirror = null;
        return send(res, 200, {closed: true});
      }
      if (url.pathname === '/api/private/life') {
        const session = sessions.get(req.headers['x-selene-session']);
        if (!session) return send(res, 410, {error: 'This viewing session has ended.'});
        if (!input || typeof input.visible !== 'boolean') return send(res, 400, {error: 'Life Connection visibility required'});
        session.lifeVisible = input.visible;
        if (session.latestMoment) publishMirror(session, {type: 'moment', moment: session.latestMoment, language: session.latestLanguage});
        return send(res, 200, {visible: session.lifeVisible});
      }
      const companion = url.pathname === '/api/companion/moment';
      if (!companion && url.pathname !== '/api/moment') return send(res, 404, {error: 'Not found'});
      if (!(companion ? validCompanionRequest(input) : validRequest(input))) return send(res, 400, {error: 'Invalid moment request'});
      const session = sessions.get(req.headers['x-selene-session']);
      if (!session) return send(res, 410, {error: 'This viewing session has ended. Start a new session to continue.'});
      const selectedStory = companion ? null : getStory(input.content_id);
      if (!companion && !selectedStory) return send(res, 400, {error: 'Unknown story'});
      if (!companion && session.contentId !== input.content_id) return send(res, 409, {error: 'This story is not the active viewing session.'});
      if (session.controller) {session.controller.abort(); active.delete(session.controller);}
      if (active.size >= 3) return send(res, 429, {error: 'Another moment is still being prepared. Please try again.'});
      const controller = new AbortController(); active.add(controller);
      session.controller = controller;
      session.lifeVisible = false;
      if (session.latestMoment) publishMirror(session, {type: 'moment', moment: session.latestMoment, language: session.latestLanguage});
      res.on('close', () => {if (!res.writableEnded) controller.abort();});
      try {
        let context = companion ? companionContext(input.snapshot, input.scene_detail, input.scene_answer) : sceneContext(input.at_seconds, selectedStory);
        if (companion && process.env.SELENE_SCENE_CONTEXT_URL) {
          try {context = await enrichCompanionContext(context, input.snapshot, controller.signal);} catch {context = {...context, scene_source: 'viewer'};}
        }
        if (companion) {
          const {snapshot, scene_detail, scene_answer, ...request} = input;
          input = {...request, content_id: context.content_id, at_seconds: context.at_seconds};
        }
        if (input.continuation && (!session.clarification || input.request !== session.clarification.request || input.continuation.request !== input.request || input.continuation.question !== session.clarification.question || context.content_id !== session.clarification.content_id || context.scene_id !== session.clarification.scene_id || input.at_seconds !== session.clarification.at_seconds)) return send(res, 409, {error: 'That clarification has ended. Close this response and ask about the moment again.'});
        if (companion && input.continuation) context.facts.push({id: 'viewer-clarification', source: 'viewer', text: input.continuation.answer});
        const moment = await explain(input, {signal: controller.signal, memory: session.memory, context});
        if (!controller.signal.aborted) {
          session.latestMoment = moment; session.latestLanguage = input.language; session.lifeVisible = false;
          publishMirror(session, {type: 'moment', moment, language: input.language});
          session.clarification = moment.state === 'clarification' ? {request: input.request, question: moment.answer, content_id: context.content_id, scene_id: context.scene_id, at_seconds: input.at_seconds} : null;
          send(res, 200, moment);
        }
      } finally { active.delete(controller); if (session.controller === controller) session.controller = null; }
      return;
    }
    const privateMatch = /^\/api\/private\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (privateMatch && req.method === 'GET') {
      const session = [...sessions.values()].find(candidate => candidate.mirror?.token === privateMatch[1]);
      if (!session?.mirror) return send(res, 404, {error: 'This private mirror is closed.'});
      res.writeHead(200, {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff'});
      res.write(`data: ${JSON.stringify(session.mirror.latest ?? {type: 'ready'})}\n\n`);
      session.mirror.clients.add(res);
      req.on('close', () => session.mirror?.clients.delete(res));
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
    if (error.code === 'ENOENT') return send(res, 404, {error: 'Not found'});
    // Never return upstream response bodies, credentials, prompts or family requests.
    console.error(`SELENE request failed: ${error.name === 'AbortError' ? 'cancelled' : 'service unavailable'}`);
    if (!res.headersSent) send(res, 502, {error: 'This moment could not be prepared. Your player controls are still available. Please try again.'});
  }
});

server.requestTimeout = 0; // No application deadline; the viewer can cancel the provider request.
server.on('error', error => {console.error(error.code === 'EADDRINUSE' ? `SELENE port ${port} is already in use. Set SELENE_PORT in the parent .env and rebuild.` : 'SELENE could not start.'); process.exitCode = 1;});
server.listen(port, hostname, () => console.info(`SELENE ready at http://${hostname}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {for (const c of active) c.abort(); server.close();});
