import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable, PassThrough} from 'node:stream';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isPublicAddress, mediaUrl, resolveMediaAddress, downloadRemote} from '../scripts/remote-media.mjs';

const publicIP = {address: '93.184.216.34', family: 4};
const signal = () => AbortSignal.timeout(5000);
const lookup = async () => [publicIP];
function transport(reply, inspect = () => {}) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.setTimeout = milliseconds => assert.equal(milliseconds, 15000);
    req.end = () => queueMicrotask(() => {
      inspect(url, options);
      const response = reply(url);
      callback(response);
    });
    return req;
  };
}
function response(statusCode, headers = {}, text = '') {
  return Object.assign(Readable.from([Buffer.from(text)]), {statusCode, headers});
}

test('HTTPS validation rejects credentials and every private/special IPv4, IPv6 or mapped destination', async () => {
  for (const url of ['http://example.org/a.mp4', 'file:///tmp/a.mp4', 'https://user:secret@example.org/a', 'https://example.org/a#fragment']) assert.throws(() => mediaUrl(url), /HTTPS/);
  for (const address of ['0.0.0.0', '10.0.0.1', '100.64.1.1', '127.0.0.1', '169.254.169.254', '172.31.0.1', '192.168.1.1', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2001::1', '2001:db8::1', '2002:7f00:1::', '3fff::1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true); assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  for (const url of ['https://127.1/a', 'https://2130706433/a', 'https://[::ffff:7f00:1]/a']) await assert.rejects(resolveMediaAddress(url, signal(), lookup), /private or special/);
  await assert.rejects(resolveMediaAddress('https://example.org/a', signal(), async () => [publicIP, {address: '10.0.0.1', family: 4}]), /private or special/);
  const controller = new AbortController();
  const pending = resolveMediaAddress('https://example.org/a', controller.signal, () => new Promise(() => {}));
  controller.abort(); await assert.rejects(pending, {name: 'AbortError'});
});

test('download streams without a size cap, pins DNS, revalidates redirects and removes canceled/failed resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'selene-remote-'));
  const path = join(root, 'source.mp4');
  try {
    let resolutions = 0; let requests = 0;
    await downloadRemote('https://example.org/a?token=secret', path, {}, {
      lookup: async () => {resolutions++; return resolutions === 1 ? [publicIP] : [{address: '127.0.0.1', family: 4}];},
      request: transport(() => response(200, {}, 'MP4 bytes'), (url, options) => {
        requests++; assert.equal(url.hostname, 'example.org'); assert.equal(options.agent, false);
        options.lookup('example.org', {}, (error, address, family) => {assert.equal(error, null); assert.equal(address, publicIP.address); assert.equal(family, 4);});
        options.lookup('example.org', {all: true}, (error, addresses) => {assert.equal(error, null); assert.deepEqual(addresses, [publicIP]);});
      })
    });
    assert.equal(resolutions, 1); assert.equal(requests, 1); assert.equal(await readFile(path, 'utf8'), 'MP4 bytes');
    await rm(path);
    requests = 0;
    await assert.rejects(downloadRemote('https://example.org/a', path, {}, {lookup, request: transport(() => response(302, {location: 'https://127.0.0.1/private'}), () => {requests++;})}), /private or special/);
    assert.equal(requests, 1);
    resolutions = 0; requests = 0;
    await assert.rejects(downloadRemote('https://example.org/a', path, {}, {
      lookup: async () => {resolutions++; return resolutions === 1 ? [publicIP] : [{address: '10.0.0.1', family: 4}];},
      request: transport(() => response(302, {location: '/next'}), () => {requests++;})
    }), /private or special/);
    assert.equal(resolutions, 2); assert.equal(requests, 1);
    await assert.rejects(downloadRemote('https://example.org/a', path, {}, {lookup, request: transport(() => response(302, {location: 'http://example.org/a'}))}), /Unsafe media redirect/);
    requests = 0;
    await assert.rejects(downloadRemote('https://example.org/a', path, {}, {lookup, request: transport(() => response(302, {location: '/loop'}), () => {requests++;})}), /redirect limit/);
    assert.equal(requests, 4);
    await downloadRemote('https://example.org/a', path, {}, {lookup, request: transport(() => response(200, {'content-length': '536870913'}, 'complete MP4 bytes'))});
    assert.equal(await readFile(path, 'utf8'), 'complete MP4 bytes');
    await rm(path);
    await assert.rejects(downloadRemote('https://example.org/a', path, {}, {lookup, request: transport(() => response(200, {'content-encoding': 'gzip'}, 'encoded'))}), /unsupported encoding/);
    await assert.rejects(downloadRemote('https://example.org/a', path, {}, {lookup, request: transport(() => response(200))}), /empty/);
    const controller = new AbortController();
    const body = Object.assign(new PassThrough(), {statusCode: 200, headers: {}});
    const pending = downloadRemote('https://example.org/a', path, {signal: controller.signal}, {lookup, request: transport(() => {
      setImmediate(() => {body.write('partial'); setImmediate(() => controller.abort());}); return body;
    })});
    await assert.rejects(pending, {name: 'AbortError'});
    assert.deepEqual(await readdir(root), []);
  } finally {await rm(root, {recursive: true, force: true});}
});
