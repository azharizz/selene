import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateVisual} from '../server/visual.mjs';

const animation = () => ({target_id: 'object', duration_ms: 1500, delay_ms: 100,
  keyframes: [{opacity: 1, transform: 'translate(-32px, 0px)'}, {opacity: 1, transform: 'none'}]});
const visual = (geometry = '<g id="object" fill="none" stroke="#f1f1f1" stroke-width="20"><circle cx="400" cy="240" r="40"/><path d="M440 240H600"/></g>') => ({status: 'ready', description: 'The object settles into a fixed position.',
  svg: `<svg viewBox="0 0 960 540">${geometry}<text x="480" y="400" font-size="64">Stay still</text></svg>`, animations: [animation()]});

test('ready geometry requires nonconstant motion, while fallback stays static', () => {
  const accepted = validateVisual(visual());
  assert.equal(accepted.animations.length, 1);
  assert.match(accepted.svg, /role="img"/);
  assert.match(accepted.svg, /Stay still/);
  assert.throws(() => validateVisual({...visual(), animations: []}), /needs a meaningful geometry animation/);
  for (const transform of ['none', 'translate(0px, 0px)', 'scale(1)', 'rotate(0deg)', 'skewX(0rad)', 'translate(40px, 0px) translate(-40px, 0px)']) {
    const input = visual(); input.animations[0].keyframes[0].transform = transform;
    assert.throws(() => validateVisual(input), /must change geometry/);
  }
  const reveal = visual(); reveal.animations[0].keyframes = [{opacity: 0.4, transform: 'none'}, {opacity: 1, transform: 'none'}];
  assert.equal(validateVisual(reveal).animations.length, 1);
  const faint = visual(); faint.animations[0].keyframes = [{opacity: 0.9, transform: 'none'}, {opacity: 1, transform: 'none'}];
  assert.equal(validateVisual(faint).animations.length, 1);
  assert.deepEqual(validateVisual({...visual(), status: 'fallback'}).animations, []);
});

test('geometry animation cannot target labels, empty groups, hidden shapes or the background', () => {
  for (const geometry of [
    '<text id="object" x="480" y="200">Static label</text>',
    '<g id="object"><circle cx="400" cy="240" r="40"/><text x="480" y="200">Static label</text></g>',
    '<g id="object"><circle cx="400" cy="240" r="40"/><tspan>Static label</tspan></g>',
    '<g id="object"/>',
    '<g id="object" opacity="0"><circle cx="400" cy="240" r="40"/></g>',
    '<circle id="object" cx="400" cy="240" r="40" fill="none" stroke="none"/>',
    '<rect id="object" width="960" height="540" fill="#202228"/>',
  ]) assert.throws(() => validateVisual(visual(geometry)), /Keep visual labels stable|needs visible non-background geometry/);
  const missing = visual(); missing.animations[0].target_id = 'missing';
  assert.throws(() => validateVisual(missing), /needs a matching id attribute/);
});

test('animation accepts free motion and keyframe counts within duration and opacity bounds', () => {
  for (const transform of ['translate(0.001px, 0px)', 'translate(-12000px, 4e3px)', 'scale(0.98)', 'scale(15, 0.01)', 'rotate(3000deg)', 'rotate(.5turn)', 'rotate(1.5rad)', 'skewX(40deg) skewY(-.2rad)']) {
    const input = visual(); input.animations[0].keyframes[0].transform = transform;
    input.animations[0].duration_ms = 5000; input.animations[0].delay_ms = 8000;
    assert.equal(validateVisual(input).animations.length, 1);
  }
  const multi = visual();
  multi.animations[0].keyframes = [{opacity: 0.4, transform: 'none'}, {opacity: 0.5, transform: 'scale(2)'}, {opacity: 0.4, transform: 'none'}];
  multi.animations = Array.from({length: 5}, () => structuredClone(multi.animations[0]));
  assert.equal(validateVisual(multi).animations.length, 5);
  for (const changes of [{duration_ms: 1499}, {duration_ms: 5001}, {duration_ms: 1500.5}, {duration_ms: Infinity}, {duration_ms: Number.MAX_SAFE_INTEGER, delay_ms: 1}, {delay_ms: -1}, {delay_ms: 0.1}, {delay_ms: NaN}, {keyframes: [{opacity: 1, transform: 'none'}]}]) {
    const input = visual(); Object.assign(input.animations[0], changes);
    assert.throws(() => validateVisual(input), /Unsafe animation/);
  }
  for (const transform of ['translate(Infinitypx)', 'translate(1e999px)', 'translate(2em)', 'scale(0)', 'scale(-2)', 'rotate(1)', 'translate(var(--x))', 'url(https://evil.invalid)', 'none;alert(1)', 'matrix(1,0,0,1,0,0)']) {
    const input = visual(); input.animations[0].keyframes[0].transform = transform;
    assert.throws(() => validateVisual(input), /Unsafe animation/);
  }
  for (const opacity of [0, 0.399, 1.1, Infinity, NaN]) {
    const input = visual(); input.animations[0].keyframes[0].opacity = opacity;
    assert.throws(() => validateVisual(input), /Unsafe animation/);
  }
});

test('16:9 bounds use arbitrary coordinates without font or label budgets', () => {
  const input = visual('<circle id="object" cx="0" cy="0" r="1"/>');
  input.svg = '<svg viewBox="-8 -4.5 16 9" font-family="serif" font-size="3"><circle id="object" cx="0" cy="0" r="1"/>' + '<text font-size="1">An unrestricted explanatory label</text>'.repeat(8) + '</svg>';
  const accepted = validateVisual(input);
  assert.match(accepted.svg, /viewBox="-8 -4.5 16 9"/);
  assert.match(accepted.svg, /font-family="serif" font-size="3"/);
  assert.equal(validateVisual({...input, svg: input.svg.replace('-8 -4.5 16 9', '100 200 16000 9000')}).animations.length, 1);
  for (const bounds of ['0 0 16 10', '0 0 0 9', '0 0 -16 -9', 'NaN 0 16 9', '0 0 Infinity 9', '0 0 16', '']) {
    assert.throws(() => validateVisual({...input, svg: input.svg.replace('-8 -4.5 16 9', bounds)}), /Invalid visual bounds/);
  }
  assert.throws(() => validateVisual({...input, svg: '<svg viewBox="-8 -4.5 16 9"><rect id="object" x="-8" y="-4.5" width="16" height="9" fill="red"/></svg>'}), /visible non-background geometry/);
});
