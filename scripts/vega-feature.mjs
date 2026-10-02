import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DOMParser} from '@xmldom/xmldom';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export function applicationRunning(list, componentId) {
  return list.split('\n').some(line => line.trim().split(/\s+/, 1)[0] === componentId);
}

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
  // Enter into the next screen. Match the driver’s remotePressOk 100 ms tap instead.
  const key = keycode => command('execute/sync', {script: 'jsonrpc: injectInputKeyEvent', args: [[{inputKeyEvent: String(keycode), holdDuration: 100}]]});
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
      const error = state.labels.find(label => /film could not load|Playback could not start|SELENE could not connect|recap could not be prepared|Recap unavailable|This return is unavailable/i.test(label));
      assert(!error, error);
      if (predicate(state)) return state;
      await delay(500);
    }
    throw new Error(`Timed out: ${description}`);
  };
  const click = async label => {
    const state = await waitFor(`button ${label}`, value => value.button(label));
    report.step = `focus on ${label}`; checkpoint();
    // Chromium can replace accessibility IDs during a painted transition.
    // Refresh only focus, never retry an OK press that may already have acted.
    let current = state, focused = false;
    const deadline = Date.now() + 5000;
    do {
      const button = current.button(label);
      if (button?.getAttribute('focused') === 'true') {focused = true; break;}
      if (button) await command('execute/sync', {script: 'jsonrpc: setFocus', args: [[{id: Number(button.getAttribute('id'))}]]});
      await delay(150);
      current = ui(await command('source'));
    } while (Date.now() < deadline);
    assert(focused, `Could not focus current button: ${label}`);
    await key(28);
    await delay(250); // Allow the TV accessibility tree to reflect the remote action.
  };
  console.info(`Feature flow: ${story.id}. Uses the live configured model.`);
  await command('appium/device/activate_app', {appId: 'com.selene.tv.main'});
  await waitFor('companion entry', value => value.button('Try the demo'));
  await delay(1000); // Native accessibility can be ready before its first painted frame.
  const entry = await capture('entry');
  report.checks.cleanEntry = !entry.labels.some(label => /Open debugger to view warnings|Running debug build of JavaScript/.test(label));
  await click('Try the demo');
  await waitFor('story picker', state => state.button('Watch demo') || state.button('Continue watching'));
  let state = await waitFor('story picker after preferences', value => value.button('Watch demo') || value.button('Continue watching'));
  await click('Films');
  await capture('films');
  await click(`Open ${story.title}`);
  await waitFor('selected title', value => value.labels.includes(story.title) && !value.button('Close films'));
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
    console.info(`Pair phone at ${report.pairing.url} with code ${report.pairing.code}. Keeping automation active for 90 seconds; browser verification is separate.`);
    checkpoint();
    // Keep the VDA automation/display session alive while a browser joins.
    for (let i = 0; i < 9; i++) {await delay(10000); await command('source');}
    await capture('paired-later');
    return;
  }
  await delay(5000);
  await capture('playing');
  if (story.id === 'the-red-kite') {
    await click('Selene'); await click('Selene tools'); await click('Playback');
    await click('Forward 10 seconds');
    if (ui(await command('source')).button('Close playback')) await click('Close playback');
    await click('Ask Selene');
    await click('Prepared examples');
    await waitFor('title-matched prepared example', value => value.button('Who is Arun to Maya?'));
    await capture('prepared-examples');
    await click('Who is Arun to Maya?');
    await waitFor('prepared answer with SVG', value => value.labels.includes('Arun is Maya’s grandfather.'));
    await capture('prepared-answer');
    report.checks.preparedExample = true;
    await click('More options');
    const more = await capture('answer-options');
    assert(!more.labels.some(label => /Life Connection/i.test(label)), 'Obsolete option remains visible');
    report.checks.noLifeConnection = true;
    await click('Dismiss');
  }
  await click('Selene');
  await click('Selene tools'); await click('Hold our place');
  await waitFor('saved place control', value => value.button('Bring us back'));
  await capture('held');
  report.checks.holdControl = true;
  // A saved quiet control activates Return. Use the real D-pad to open tools.
  await key(103); await delay(250); await key(106); await delay(250); await key(28);
  await waitFor('saved tools panel', value => value.button('Clear saved place'));
  const tools = await capture('saved-tools');
  assert(tools.button('Clear saved place') && tools.labels.some(label => /^Saved at/.test(label)), 'Saved place controls are missing');
  await click('Close tools'); await click('Hide Selene');
  console.info('Marker saved. Letting the TV advance before requesting a return.');
  await delay(20000);
  await click('Bring us back');
  await capture('preparing-return');
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
  await click('Selene'); await click('Selene tools'); await click('Playback');
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
