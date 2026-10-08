import {constants} from 'node:fs';
import {access, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {validateVisual} from './visual.mjs';
import {visualPage} from './visual-page.mjs';

const viewport = {width: 1280, height: 720};
const installedBrowsers = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome', '/snap/bin/chromium',
];

async function executablePath(signal) {
  const candidates = process.env.SELENE_CHROMIUM_PATH ? [process.env.SELENE_CHROMIUM_PATH] : installedBrowsers;
  for (const candidate of candidates) {
    signal.throwIfAborted();
    try {await access(candidate, constants.X_OK); return candidate;} catch {}
  }
  throw new Error('Visual inspection requires Chrome or Chromium; install it or set SELENE_CHROMIUM_PATH.');
}

// These are schematic renderer pixels and measurements, never movie-frame evidence.
export async function inspectVisual(visual, {signal} = {}) {
  signal?.throwIfAborted();
  const safe = validateVisual(visual);
  if (safe.status !== 'ready') throw new Error('Visual inspection requires a ready visual');
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forwardAbort, {once: true});
  const timeout = setTimeout(() => controller.abort(new Error('Visual inspection timed out')), 30000);
  const stop = controller.signal;
  let browser, page, directory;
  try {
    const executable = await executablePath(stop);
    directory = await mkdtemp(join(tmpdir(), 'selene-visual-'));
    stop.throwIfAborted();
    browser = await puppeteer.launch({
      executablePath: executable, browser: 'chrome', headless: true, pipe: true, signal: stop,
      timeout: 15000, protocolTimeout: 15000, defaultViewport: {...viewport, deviceScaleFactor: 1},
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
      userDataDir: join(directory, 'profile'),
      // Do not inherit provider credentials, user profiles, proxies or debugging settings.
      env: {PATH: '/usr/bin:/bin', HOME: directory, TMPDIR: directory, LANG: 'en_US.UTF-8', TZ: 'UTC'},
      args: ['--disable-background-networking', '--disable-component-update', '--disable-domain-reliability',
        '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    stop.throwIfAborted();
    const frames = [], observations = [];
    const targets = [...new Set(safe.animations.map(animation => animation.target_id))];
    const end = Math.max(...safe.animations.map(animation => animation.delay_ms + animation.duration_ms));
    const html = visualPage(safe, randomUUID());
    for (const phase of ['static', 'animation']) {
      stop.throwIfAborted();
      page = await browser.newPage();
      let renderError;
      page.on('pageerror', error => {renderError = error;});
      await page.setRequestInterception(true);
      page.on('request', request => {void request.abort().catch(() => {});});
      await page.setOfflineMode(true);
      await page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: phase === 'static' ? 'reduce' : 'no-preference'}]);
      await page.setContent(html, {waitUntil: 'load', timeout: 10000});
      if (phase === 'animation') {
        await page.waitForFunction(count => document.getAnimations().length === count,
          {polling: 'raf', timeout: 5000}, safe.animations.length);
      }
      for (const at_ms of phase === 'static' ? [null] : [0, end / 2, end - 1]) {
        stop.throwIfAborted();
        await page.evaluate(async ({phase, at_ms}) => {
          if (phase === 'animation') {
            for (const motion of document.getAnimations()) {
              motion.pause();
              motion.currentTime = at_ms;
            }
          }
          // Flush real browser layout/compositing after the seek, not simulated keyframes.
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, {phase, at_ms});
        if (renderError) throw new Error(`Visual renderer failed: ${renderError.message}`);
        const measured = await page.evaluate(ids => ids.map(id => {
          const target = document.getElementById(id);
          if (!target) throw new Error(`Visual renderer lost target ${id}`);
          const {x, y, width, height} = target.getBoundingClientRect();
          const {transform, opacity} = getComputedStyle(target);
          return {id, x, y, width, height, transform, opacity: Number(opacity)};
        }), targets);
        const png = await page.screenshot({type: 'png', encoding: 'base64'});
        stop.throwIfAborted();
        frames.push({phase, at_ms, image_url: {url: `data:image/png;base64,${png}`}});
        observations.push({phase, at_ms, targets: measured});
      }
      await page.close();
      page = undefined;
    }
    return {viewport: {...viewport}, frames, observations};
  } catch (error) {
    stop.throwIfAborted();
    throw error;
  } finally {
    try {await page?.close();} catch {}
    try {await browser?.close();} catch {controller.abort(new Error('Visual renderer cleanup failed'));}
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
    if (directory) await rm(directory, {recursive: true, force: true});
  }
}
