import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpsRequest} from 'node:https';
import {open, rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 31 && c === 196) || (b === 52 && c === 193) || (b === 88 && c === 99) || b === 168 || (b === 175 && c === 48))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6 || address.includes('%') || address.includes('.')) return false;
  const halves = address.toLowerCase().split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = (halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]).map(v => parseInt(v, 16));
  // Only global unicast; deny transition, benchmark, documentation and special-purpose prefixes.
  return words[0] >= 0x2000 && words[0] <= 0x3fff && words[0] !== 0x2002 &&
    !(words[0] === 0x2001 && (words[1] < 0x200 || words[1] === 0xdb8)) &&
    !(words[0] === 0x2620 && words[1] === 0x4f && words[2] === 0x8000) &&
    !(words[0] === 0x3fff && words[1] < 0x1000);
}

export function mediaUrl(value) {
  let url;
  try {url = new URL(value);} catch {throw new Error('A valid public HTTPS media URL is required');}
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash || url.href.length > 4096) throw new Error('A credential-free public HTTPS media URL is required');
  return url;
}

async function abortable(promise, signal) {
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason); signal.addEventListener('abort', abort, {once: true});
    })]);
  } finally {signal.removeEventListener('abort', abort);}
}

export async function resolveMediaAddress(value, signal, lookup = dnsLookup) {
  const url = mediaUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(hostname);
  let addresses;
  try {addresses = literal ? [{address: hostname, family: literal}] : await abortable(lookup(hostname, {all: true, verbatim: true}), signal);} catch (error) {
    signal.throwIfAborted(); throw new Error('Media host could not be resolved');
  }
  if (!addresses.length || addresses.some(({address, family}) => !isPublicAddress(address) || isIP(address) !== family)) throw new Error('Media host resolves to a private or special-use address');
  return {url, address: addresses[0]};
}

export function pinnedLookup({address, family}) {
  return (_hostname, options, callback) => {
    if (options?.all) callback(null, [{address, family}]);
    else callback(null, address, family);
  };
}

export async function downloadRemote(value, path, {signal} = {}, {lookup = dnsLookup, request = httpsRequest} = {}) {
  const active = signal ?? new AbortController().signal;
  let url = mediaUrl(value); let owned = false;
  try {
    for (let redirects = 0; ; redirects++) {
      active.throwIfAborted();
      const resolved = await resolveMediaAddress(url, active, lookup);
      const response = await new Promise((resolve, reject) => {
        const req = request(resolved.url, {method: 'GET', agent: false, lookup: pinnedLookup(resolved.address), signal: active,
          headers: {Accept: 'video/mp4, application/octet-stream', 'Accept-Encoding': 'identity'}}, incoming => {
            // An early reset can arrive while opening the output file; pipeline still rejects errored streams.
            incoming.on('error', () => {}); resolve(incoming);
          });
        req.on('error', () => reject(active.aborted ? active.reason : new Error('HTTPS media request failed')));
        req.setTimeout(15000, () => req.destroy(new Error('Media request timed out')));
        req.end();
      });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.destroy();
        if (redirects >= 3 || !response.headers.location) throw new Error('Media redirect limit or invalid redirect');
        try {url = mediaUrl(new URL(response.headers.location, url));} catch {throw new Error('Unsafe media redirect');}
        continue;
      }
      if (response.statusCode !== 200) {response.destroy(); throw new Error(`Media server returned HTTP ${response.statusCode}`);}
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy(); throw new Error('Media uses unsupported encoding');
      }
      let handle;
      try {
        handle = await open(path, 'wx'); owned = true;
        const output = handle.createWriteStream();
        await pipeline(response, output, {signal: active});
        if (!output.bytesWritten) throw new Error('Media response is empty');
      } finally {response.destroy(); await handle?.close();}
      return;
    }
  } catch (error) {
    if (owned) await rm(path, {force: true});
    active.throwIfAborted();
    // Transport error messages can contain signed URLs or credentials. Keep external failures generic.
    if (/^(Media |Unsafe media |A credential-free |A valid public |HTTPS media )/.test(error.message)) throw error;
    throw new Error('HTTPS media download failed');
  }
}
