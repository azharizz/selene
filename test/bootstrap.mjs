import {fileURLToPath} from 'node:url';

// 00-story.json keeps the authored default for regression tests, not production.
process.env.SELENE_CONTENT_ROOT = fileURLToPath(new URL('./fixtures/content/', import.meta.url));
