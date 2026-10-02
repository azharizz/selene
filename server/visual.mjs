import {DOMParser, XMLSerializer} from '@xmldom/xmldom';

const elements = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'title', 'desc']);
const attributes = new Set(['xmlns', 'viewBox', 'width', 'height', 'id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'transform', 'dx', 'dy', 'role', 'aria-label']);
const transform = /^(?:none|(?:(?:translate\(-?\d+(?:\.\d+)?px(?:,\s*-?\d+(?:\.\d+)?px)?\)|scale\((?:0\.[5-9]\d*|1(?:\.0+)?)\))\s*)+)$/;

// Model output is data. Scripts, CSS, images, references, events and foreign HTML are not accepted.
export function validateVisual(visual) {
  if (visual.status !== 'ready') return {...visual, svg: '', animations: []};
  if (visual.svg.length > 24000 || /<!|<\?|&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/u.test(visual.svg)) throw new Error('Unsafe XML');
  const doc = new DOMParser({errorHandler: {warning: () => {throw new Error('Malformed SVG');}, error: () => {throw new Error('Malformed SVG');}, fatalError: () => {throw new Error('Malformed SVG');}}}).parseFromString(visual.svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.tagName !== 'svg' || root.getAttribute('viewBox') !== '0 0 960 540') throw new Error('Invalid visual bounds');
  if (Array.from(doc.childNodes).some(n => n !== root && (n.nodeType !== 3 || n.textContent.trim()))) throw new Error('Multiple roots');
  const ids = new Map(); let count = 0; let labels = 0; let geometry = 0;
  function walk(el, depth, inheritedFont = 48) {
    if (++count > 180 || depth > 10 || !elements.has(el.tagName)) throw new Error('Unsupported SVG element');
    for (const attr of Array.from(el.attributes)) {
      if (!attributes.has(attr.name) || /url\s*\(|https?:|javascript:|data:|[<>\\]/i.test(attr.value) && attr.name !== 'xmlns') throw new Error('Unsafe SVG attribute');
      if (attr.name === 'xmlns' && (el !== root || attr.value !== 'http://www.w3.org/2000/svg')) throw new Error('Invalid namespace');
      if (attr.value.length > 5000) throw new Error('Oversized SVG attribute');
    }
    if (['path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect'].includes(el.tagName) && !(el.tagName === 'rect' && el.getAttribute('fill') === '#202228' && Number(el.getAttribute('width')) >= 800 && Number(el.getAttribute('height')) >= 440)) geometry++;
    const size = el.hasAttribute('font-size') ? Number(el.getAttribute('font-size')) : inheritedFont;
    if (!Number.isFinite(size) || size < 48 || size > 64) throw new Error('Illegible visual text');
    if (el.tagName === 'text' && (++labels > 6 || el.textContent.length > 80)) throw new Error('Visual labels exceed TV budget');
    if (el.hasAttribute('id')) {
      const id = el.getAttribute('id');
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(id) || ids.has(id)) throw new Error('Invalid SVG id');
      ids.set(id, el);
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) walk(child, depth + 1, size);
      else if (child.nodeType !== 3) throw new Error('Unsupported XML node');
    }
  }
  walk(root, 0);
  if (!labels && geometry < 2) throw new Error('An isolated shape does not explain the answer. Draw a recognizable schematic or relationship, with at least two non-background shapes.');
  if (!visual.description.trim()) throw new Error('Visual lacks an accessible explanation');
  for (const a of visual.animations) {
    if (!ids.has(a.target_id)) throw new Error(`Animation target "${a.target_id}" needs a matching id attribute on the SVG geometry.`);
    if (a.keyframes.length !== 2 || a.duration_ms + a.delay_ms > 4000 || a.keyframes.some(k => !transform.test(k.transform))) throw new Error('Unsafe animation');
    const target = ids.get(a.target_id);
    if (['svg', 'text', 'tspan'].includes(target.tagName) || target.getElementsByTagName('text').length) throw new Error('Keep visual labels stable');
    if (a.keyframes.some(k => [...k.transform.matchAll(/translate\(([^)]+)\)/g)].some(match => match[1].split(',').some(value => Math.abs(parseFloat(value)) > 40)))) throw new Error('Animation moves outside its safe area');
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  root.setAttribute('font-family', 'sans-serif'); root.setAttribute('font-size', '48');
  root.setAttribute('width', '100%'); root.setAttribute('height', '100%');
  root.setAttribute('role', 'img'); root.setAttribute('aria-label', visual.description);
  return {...visual, svg: new XMLSerializer().serializeToString(root)};
}
