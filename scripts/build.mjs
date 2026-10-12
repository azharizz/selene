import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {loadEnvFile} from 'node:process';
// Official apl-viewhost-web@2024.3.0 preinstall artifact:
// https://d2o906d8ln7ui1.cloudfront.net/apl-viewhost-web-2024.3.js (Apache-2.0).
// The upstream downloader checks neither HTTP status nor artifact integrity.
const aplRuntimeSha256 = 'e19cc25eb2424bfc6ea60a96aefa93c0b7b31f037462c6a35e4558a5ff13c164';
const aplInstallMessage = 'Reinstall the pinned apl-viewhost-web@2024.3.0 runtime with approved lifecycle scripts: npm rebuild apl-viewhost-web --ignore-scripts=false. This downloads the official runtime; then retry npm run build:web. Do not update the checksum without reviewing the upstream artifact.';
let aplRuntime;
try {
  aplRuntime = await readFile('node_modules/apl-viewhost-web/index.js');
} catch (cause) {
  throw new Error(`Missing or unreadable APL runtime. ${aplInstallMessage}`, {cause});
}
if (createHash('sha256').update(aplRuntime).digest('hex') !== aplRuntimeSha256) {
  throw new Error(`APL runtime SHA256 mismatch (expected ${aplRuntimeSha256}). ${aplInstallMessage}`);
}
loadEnvFile(new URL('../../.env', import.meta.url));
// UI rebuilds retain the selected native relay. Override explicitly to switch targets.
const configured = JSON.parse(await readFile('src/config.json', 'utf8')).appUrl;
const url = process.env.SELENE_APP_URL ?? configured ?? `http://127.0.0.1:${process.env.SELENE_PORT ?? 4519}`;
if (!/^https:\/\//.test(url) && !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('Remote SELENE_APP_URL must use HTTPS');
await mkdir('assets', {recursive: true});
await build({entryPoints: ['web/App.tsx'], bundle: true, minify: true, sourcemap: false, outdir: 'assets', entryNames: 'app', platform: 'browser', target: 'chrome120', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}});
await build({entryPoints: ['web/AplRuntime.ts'], bundle: true, minify: true, sourcemap: false, outfile: 'assets/apl-runtime.js', format: 'iife', globalName: 'SeleneApl', platform: 'browser', target: 'chrome120'});
for (const file of ['LICENSE', 'NOTICE', 'THIRD-PARTY.txt']) await copyFile(`node_modules/apl-viewhost-web/${file}`, `assets/apl-runtime-${file}`);
await writeFile('assets/apl-preview.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#apl-root{margin:0;width:100%;height:100%;overflow:hidden;background:#202228}</style></head><body><div id="apl-root"></div><script src="/apl-runtime.js"></script></body></html>');
await writeFile('assets/index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>SELENE</title><link rel="icon" type="image/svg+xml" href="/selene-mark.svg"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js" defer></script></body></html>');
await writeFile('src/config.json', JSON.stringify({appUrl: url}) + '\n');
console.info('Built SELENE web app and public host configuration.');
