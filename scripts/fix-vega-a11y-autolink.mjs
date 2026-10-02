import {readFile, writeFile} from 'node:fs/promises';

const config = new URL('../node_modules/@amazon-devices/kepler-a11y-settings-interface-turbo/react-native.config.js', import.meta.url);
const source = await readFile(config, 'utf8');
const flags = [...source.matchAll(/(["']linkDynamic["']\s*:\s*)(true|false)/g)];
if (flags.length !== 1) throw new Error('Unexpected Vega accessibility autolink config; refusing to build without a verified module link.');
if (flags[0][2] === 'true') await writeFile(config, source.replace(flags[0][0], `${flags[0][1]}false`));
