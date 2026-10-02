import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DOMParser} from '@xmldom/xmldom';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export async function fetchRelay(url, timeout = 30000) {
  try {
    return await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(timeout)});
  } catch (error) {
    try {
      const body = execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', String(timeout / 1000), String(url)],
        {maxBuffer: 32 * 1024 * 1024});
      return new Response(body);
    } catch {
      throw error;
    }
  }
}

// The relay caches its catalog at startup. Local hashes alone cannot establish
// which catalog, bundle or clip the TV actually receives from a running relay.
export async function verifyServedBuild(appUrl, story, build) {
  const get = async path => {
    const response = await fetchRelay(new URL(path, appUrl));
    assert(response.ok, `Relay did not serve ${path}`);
    return response;
  };
  const served = await (await get(`/api/story?id=${encodeURIComponent(story.id)}`)).json();
  const version = createHash('sha256').update(JSON.stringify(story)).digest('hex');
  assert(served.id === story.id && served.video === story.video && served.content_version === version,
    'Relay catalog differs from disk. Restart the relay before testing.');
  for (const [path, expected] of [['/app.js', build.webSha256], ['/app.css', build.cssSha256], [story.video, build.mediaSha256]]) {
    const hash = createHash('sha256');
    for await (const chunk of (await get(path)).body) hash.update(chunk);
    assert.equal(hash.digest('hex'), expected, `Served ${path} differs from the recorded local build`);
  }
}

export function ui(source) {
  const doc = new DOMParser().parseFromString(source, 'text/xml');
  const nodes = [...Array.from(doc.getElementsByTagName('child'))];
  const labels = Array.from(doc.getElementsByTagName('text')).map(node => node.textContent);
  const button = label => nodes.find(node => node.getAttribute('clickable') === 'true' &&
    Array.from(node.childNodes).some(child => child.nodeName === 'text' && child.textContent === label)) ??
    nodes.filter(node => node.getAttribute('clickable') === 'true' &&
      Array.from(node.getElementsByTagName('text')).some(child => child.textContent === label)).at(-1);
  return {labels, button};
}
const seconds = value => value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
export function returnWindow(labels) {
  const line = labels.find(label => /^Covers \d+:\d+ to \d+:\d+/.test(label));
  const match = line?.match(/^Covers (\d+:\d+) to (\d+:\d+)(?: · TV (\d+:\d+))?$/);
  if (!match) return null;
  const tv = labels.findLast(label => /^ · TV \d+:\d+$/.test(label))?.match(/TV (\d+:\d+)$/)?.[1] ?? match[3];
  return {from: seconds(match[1]), through: seconds(match[2]), tv: tv ? seconds(tv) : null};
}

// Appium performs all UI input. Read accessible text and take real VDA screenshots;
// never infer progress from a successful click or a generic "playing" flag.
export async function runFeature({command, screenshot, out, story, report, checkpoint = () => {}, pairOnly = false}) {
  // The driver's generic press_keycode holds for 1000 ms, which can repeat
  // Enter into the next screen. Send an actual short remote tap instead.
  const key = keycode => command('execute/sync', {script: 'jsonrpc: injectInputKeyEvent', args: [[{inputKeyEvent: String(keycode), holdDuration: 50}]]});
  const capture = async name => {
    const source = await command('source');
    writeFileSync(join(out, `${name}.xml`), source);
    await screenshot(name);
    return ui(source);
  };
  const waitFor = async (description, predicate, timeout = 15000) => {
    report.step = description;
    checkpoint();
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const state = ui(await command('source'));
      if (state.labels.includes('Open debugger to view warnings.') && state.button('Dismiss')) {
        report.debugWarningDismissed = true;
        await command('execute/sync', {script: 'tv: pressOk', args: [{elementId: state.button('Dismiss').getAttribute('id')}]});
        await delay(500);
        continue;
      }
      const error = state.labels.find(label => /film could not load|Playback could not start|SELENE could not connect|recap could not be prepared|This return is unavailable/i.test(label));
      assert(!error, error);
      if (predicate(state)) return state;
      await delay(500);
    }
    throw new Error(`Timed out: ${description}`);
  };
  const click = async label => {
    const state = await waitFor(`button ${label}`, value => value.button(label));
    const id = state.button(label).getAttribute('id');
    await command('execute/sync', {script: 'jsonrpc: setFocus', args: [[{id: Number(id)}]]});
    await waitFor(`focus on ${label}`, value => value.button(label)?.getAttribute('focused') === 'true');
    await key(28);
    await delay(250); // Allow the TV accessibility tree to reflect the remote action.
  };
  console.info(`Feature flow: ${story.id}. Uses the live configured model.`);
  await command('appium/device/activate_app', {appId: 'com.selene.tv.main'});
  await click('Try the demo');
  await waitFor('story picker', state => state.button('Watch demo') || state.button('Continue watching'));
  if (!pairOnly) {
    await click('Preferences'); await click('Translate'); await click('Done');
    await click('Connect to another playback app'); await click('Try the demo'); await click('Preferences');
    await waitFor('saved translation preference after native WebView recreation', value => value.labels.includes('Translate into'));
    await capture('storage-restored');
    report.checks.preferencesPersist = true;
    await click('Explain simply'); await click('Done');
  }
  let state = await waitFor('story picker after preferences', value => value.button('Watch demo') || value.button('Continue watching'));
  if (state.button(`Open ${story.title}`)) await click(`Open ${story.title}`);
  // A picker button also contains the bare title as a descendant text node.
  await waitFor('selected title', value => value.labels.includes(story.title) && !value.button(`Open ${story.title}`));
  await capture('selected');
  await click('Watch demo');
  await waitFor('quiet Selene control', value => value.button('Selene'));
  if (pairOnly) {
    await click('Selene'); await click('Selene tools'); await click('Pair phone');
    state = await waitFor('phone pairing code', value => value.labels.some(label => /^Pairing code (\d ){5}\d$/.test(label)));
    report.pairing = {code: state.labels.find(label => /^Pairing code (\d ){5}\d$/.test(label)).replace(/\D/g, ''),
      url: state.labels.find(label => /^https:\/\/.*\?join=1$/.test(label))};
    assert(report.pairing.url, 'Pairing URL is missing');
    report.checks.pairingCode = true;
    report.phone = 'awaiting browser verification';
    await capture('pairing');
    return;
  }
  await delay(5000);
  await capture('playing');
  await click('Selene'); await click('Selene tools'); await click('Hold our place');
  await waitFor('saved place control', value => value.button('Bring us back'));
  await capture('held');
  report.checks.holdControl = true;
  console.info('Marker saved. Letting the TV advance before requesting a return.');
  await delay(20000);
  await click('Bring us back');
  state = await waitFor('a reviewed recap with a nonempty interval', value => {
    assert(!value.labels.some(label => /no gap at|not enough evidence/i.test(label)), 'Return was a fallback, not a reviewed recap');
    return returnWindow(value.labels);
  }, 50000);
  const initial = returnWindow(state.labels);
  assert(initial.through > initial.from, 'TV did not advance beyond the saved place');
  report.interval = initial;
  report.checks.recapInterval = true;
  await capture('return');
  const later = await waitFor('TV time advancing underneath the recap', value => {
    const sample = returnWindow(value.labels);
    return sample && sample.tv > (initial.tv ?? initial.through) && sample.tv < story.duration;
  }, 15000);
  report.laterInterval = returnWindow(later.labels);
  report.checks.playbackUnderRecap = true;
  await capture('return-advancing');
  await click('Close return');
  await waitFor('return dismissed', value => value.button('Selene') && !returnWindow(value.labels));
  await capture('dismissed');
  report.checks.dismiss = true;
  // One hardware play/pause input per transition. UI transport state must change once.
  await click('Selene'); await click('Selene tools'); await click('Answer preferences');
  await click('Demo playback');
  await waitFor('playing transport state', value => value.button('Pause'));
  await key(164); // Linux KEY_PLAYPAUSE, delivered by the Vega remote path.
  await waitFor('one remote press pauses', value => value.button('Play'));
  await delay(1000);
  assert(ui(await command('source')).button('Play'), 'Pause was immediately undone by a second control route');
  await capture('remote-paused');
  await key(164);
  await waitFor('one remote press resumes', value => value.button('Pause'));
  await delay(1000);
  assert(ui(await command('source')).button('Pause'), 'Resume was immediately undone by a second control route');
  await capture('remote-resumed');
  report.checks.remotePlayPause = true;
  // This is a feature check, not a phone or hardware-performance claim.
  report.phone = 'not tested';
}
