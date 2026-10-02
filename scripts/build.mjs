import {build} from 'esbuild';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {loadEnvFile} from 'node:process';
loadEnvFile(new URL('../../.env', import.meta.url));
// UI rebuilds retain the selected native relay. Override explicitly to switch targets.
const configured = JSON.parse(await readFile('src/config.json', 'utf8')).appUrl;
const url = process.env.SELENE_APP_URL ?? configured ?? `http://127.0.0.1:${process.env.SELENE_PORT ?? 4519}`;
if (!/^https:\/\//.test(url) && !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('Remote SELENE_APP_URL must use HTTPS');
await mkdir('assets', {recursive: true});
await build({entryPoints: ['web/App.tsx'], bundle: true, minify: true, sourcemap: false, outdir: 'assets', entryNames: 'app', platform: 'browser', target: 'chrome120', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}});
await writeFile('assets/index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>SELENE</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js" defer></script></body></html>');
await writeFile('src/config.json', JSON.stringify({appUrl: url}) + '\n');
console.info('Built SELENE web app and public host configuration.');
