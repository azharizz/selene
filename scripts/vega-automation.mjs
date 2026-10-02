// Launcher-only smoke check. Uses the installed toolchain; never builds or opens SELENE.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const home = homedir();
const nodeRoot = join(home, '.nvm/versions/node/v22.17.0');
const node = join(nodeRoot, 'bin/node');
const self = fileURLToPath(import.meta.url);
// npm may be launched with Node 26. Appium and its children must use Node 22.
if (process.execPath !== node) {
  try { execFileSync(node, [self], { stdio: 'inherit' }); }
  catch (error) { process.exit(error.status || 1); }
  process.exit(0);
}

const root = dirname(dirname(self));
const sdkVersion = '0.24.12112';
const sdk = join(home, 'vega/sdk/vega-sdk/main', sdkVersion);
const vda = join(sdk, 'workspace/env/KeplerCLIVegaDeviceAdaptor-2.0/runtime/bin/vda');
const appium = join(nodeRoot, 'lib/node_modules/appium');
const appiumHome = join(home, '.appium');
const driver = join(appiumHome, 'node_modules/@amazon-devices/appium-vega-driver');
const serial = 'emulator-5554';
const base = 'http://127.0.0.1:4723';
const out = join(root, 'artifacts/automation-baseline', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(out, { recursive: true });
const env = {
  ...process.env,
  APPIUM_HOME: appiumHome,
  ANDROID_SERIAL: serial,
  PATH: [join(nodeRoot, 'bin'), dirname(vda), join(home, 'vega/bin'), process.env.PATH].join(':'),
};
const capabilities = {
  platformName: 'Vega',
  'appium:automationName': 'automation-toolkit/JSON-RPC',
  'vega:device': `vda://${serial}`,
  'appium:newCommandTimeout': 60,
};
const report = { status: 'failed', sdk: sdkVersion, node: process.version, serial, capabilities, checks: {} };
let server;
let session;
let stage = 'preflight';
const run = (bin, args) => execFileSync(bin, args, { env, encoding: 'utf8', timeout: 15000 });
const version = (path) => JSON.parse(readFileSync(join(path, 'package.json'))).version;
async function request(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert(response.ok && !data.value?.error, `${method} ${path}: ${JSON.stringify(data)}`);
  return data.value;
}
const command = (path, body) => request(`/session/${session}/${path}`, body);
const focus = (source) => [...source.matchAll(/<child\b[^>]*focused="true"[^>]*>/g)]
  .map(([tag]) => tag.match(/\bid="([^"]+)"/)?.[1]).filter(Boolean).sort().join(',');
const launcher = (source) => assert.deepEqual(
  [...source.matchAll(/<app\b[^>]*appName="([^"]+)"/g)].map(match => match[1]),
  ['com.amazon.keplerlauncherapp'], 'Expected only the Vega launcher');
async function screenshot(name) {
  const png = Buffer.from(await command('screenshot'), 'base64');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Invalid PNG');
  assert.equal(png.readUInt32BE(16), 1280, 'Display must stay at 1280x720');
  assert.equal(png.readUInt32BE(20), 720, 'Display must stay at 1280x720');
  writeFileSync(join(out, `${name}.png`), png);
}

try {
  assert.equal(process.version, 'v22.17.0');
  assert.equal(version(appium), '2.2.2');
  assert.equal(version(driver), '3.34.1');
  report.appium = version(appium);
  report.driver = version(driver);
  const cli = run(join(home, 'vega/bin/vega'), ['--version']);
  assert(cli.includes(`Active SDK Version: ${sdkVersion}`), 'Active SDK changed. Restore the pinned SDK.');
  const processes = run('/bin/ps', ['-axo', 'command']);
  const emulator = processes.split('\n').filter(line => line.startsWith(`${sdk}/vvd/images/tv/vmtools/agent/qemu/`));
  assert.equal(emulator.length, 1, 'Start exactly one virtual device using npm run vega:vvd');
  assert(emulator[0].includes('-skin 1280x720 ') && emulator[0].includes('-gpu off '),
    'Expected the pinned 720p software-rendered virtual device');
  report.emulatorCommand = emulator[0];
  writeFileSync(join(out, 'devices.txt'), run(vda, ['devices', '-l']));
  const profile = run(vda, ['-s', serial, 'shell', 'vdcm get com.amazon.devconf/system/device-info/profile']);
  assert(profile.includes("= 'tv'"), 'Vega shell is unhealthy; do not retry Appium until shell works');
  run(vda, ['-s', serial, 'shell', 'touch /tmp/automation-toolkit.enable']);
  report.checks.preflight = true;
  // Refuse to reuse or kill another task's Appium process.
  let listening = false;
  try { await fetch(`${base}/status`, { signal: AbortSignal.timeout(1000) }); listening = true; }
  catch { /* no HTTP listener */ }
  assert(!listening, 'Port 4723 is occupied. Stop its Appium session before running this check.');

  stage = 'appium-start';
  const log = openSync(join(out, 'appium.log'), 'w');
  try {
    server = spawn(node, [join(appium, 'index.js'), '--address', '127.0.0.1', '--port', '4723', '--use-drivers', 'vega', '--log-timestamp', '--log-no-colors'],
      { env, stdio: ['ignore', log, log] });
  } finally { closeSync(log); }
  let ready = false;
  for (let i = 0; i < 40; i++) {
    assert(server.exitCode === null, 'Appium exited. See appium.log.');
    try {
      const r = await fetch(`${base}/status`, { signal: AbortSignal.timeout(500) });
      const data = await r.json();
      ready = r.ok && data.value?.ready && data.value.build?.version === '2.2.2';
    } catch { /* bounded startup polling */ }
    if (ready) break;
    await delay(250);
  }
  assert(ready, 'Appium did not become ready within the startup deadline');
  stage = 'session';
  session = (await request('/session', { capabilities: { alwaysMatch: capabilities, firstMatch: [{}] } })).sessionId;
  assert(session, 'No Appium session ID');
  report.checks.session = true;

  stage = 'launcher';
  await command('appium/device/press_keycode', { keycode: 172 }); // Linux KEY_HOMEPAGE
  await command('appium/device/press_keycode', { keycode: 103 }); // Up to Settings
  const before = await command('source');
  writeFileSync(join(out, 'before.xml'), before);
  launcher(before);
  assert(focus(before), 'Launcher has no focusable control selected');
  await delay(500); // Let the launcher's focus animation finish before capture.
  await screenshot('before');
  report.checks.screenshot = true;

  stage = 'remote-down';
  await command('appium/device/press_keycode', { keycode: 108 });
  let after;
  for (let i = 0; i < 10; i++) {
    after = await command('source');
    writeFileSync(join(out, 'after.xml'), after);
    launcher(after);
    if (focus(after) && focus(after) !== focus(before)) break;
    await delay(200);
  }
  assert(focus(after) && focus(after) !== focus(before), 'Down returned without moving launcher focus');
  await delay(500);
  await screenshot('after');
  report.checks.remoteFocusChanged = true;
  report.focusBefore = focus(before);
  report.focusAfter = focus(after);
  report.status = 'passed';
} catch (error) {
  report.failure = { stage, message: error.message };
  process.exitCode = 1;
} finally {
  if (session) {
    try { await request(`/session/${session}`, undefined, 'DELETE'); }
    catch (error) { report.cleanupError = error.message; report.status = 'failed'; process.exitCode = 1; }
  }
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    await stopped;
    clearTimeout(timer);
  }
  writeFileSync(join(out, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, checks: report.checks, failure: report.failure, artifacts: out }, null, 2));
}
