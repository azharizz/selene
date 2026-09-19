import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {companionContext} from '../server/context.mjs';
import {enrichCompanionContext} from '../server/external-context.mjs';

test('scene service HTTP boundary enforces exact identity, spoiler time, cancellation and bounded bytes', async t => {
  const snapshot = {package_id: 'test.provider', catalog_name: 'test', content_id: 'episode', session_id: 1, title: 'Code test', at_seconds: 10};
  const context = companionContext(snapshot, 'Viewer account.');
  const payload = {verified: true, provider_package_id: snapshot.package_id, provider_catalog_name: snapshot.catalog_name,
    provider_content_id: snapshot.content_id, at_seconds: 10, source: 'Test fixture',
    transcript: [{start: 0, end: 8, text: 'Completed line'}, {start: 9, end: 12, text: 'Future line'}],
    facts: [{available_at: 5, text: 'Known fact'}, {available_at: 11, text: 'Future fact'}]};
  let next = payload; let received;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(next));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const previous = process.env.SELENE_SCENE_CONTEXT_URL;
  process.env.SELENE_SCENE_CONTEXT_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {if (previous === undefined) delete process.env.SELENE_SCENE_CONTEXT_URL; else process.env.SELENE_SCENE_CONTEXT_URL = previous; server.closeAllConnections(); server.close();});
  const enriched = await enrichCompanionContext(context, snapshot);
  assert.deepEqual(received.provider, snapshot);
  assert.equal(enriched.transcript.length, 1);
  assert.equal(enriched.transcript[0].source, 'licensed_scene');
  assert.ok(enriched.facts.some(fact => fact.source === 'viewer'));
  assert.equal(JSON.stringify(enriched).includes('Future'), false);
  for (const wrong of [{provider_package_id: 'another.app'}, {provider_catalog_name: 'another.catalog'}, {provider_content_id: 'another.episode'}, {at_seconds: 11}, {verified: false}]) {
    next = {...payload, ...wrong}; await assert.rejects(enrichCompanionContext(context, snapshot), /identity and time/);
  }
  next = {...payload, ignored: 'x'.repeat(131073)};
  await assert.rejects(enrichCompanionContext(context, snapshot), /payload limit/);
  await assert.rejects(enrichCompanionContext(context, snapshot, AbortSignal.abort()), {name: 'AbortError'});
});
