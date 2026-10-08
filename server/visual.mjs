import {DOMParser, XMLSerializer} from '@xmldom/xmldom';

const elements = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'title', 'desc']);
const attributes = new Set(['xmlns', 'viewBox', 'width', 'height', 'id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'transform', 'dx', 'dy', 'role', 'aria-label']);
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const transformFunction = new RegExp(`^(translate|scale|rotate|skewX|skewY)\\(\\s*(${number})(px|deg|rad|turn)?\\s*(?:,\\s*(${number})(px)?\\s*)?\\)`);

function transformMatrix(value) {
  if (typeof value !== 'string') return null;
  let rest = value.trim(), matrix = [1, 0, 0, 1, 0, 0];
  if (rest === 'none') return matrix;
  if (!rest) return null;
  while (rest) {
    const match = rest.match(transformFunction);
    if (!match) return null;
    const [, name, first, unit, second, secondUnit] = match;
    const x = Number(first), y = second === undefined ? undefined : Number(second);
    if (!Number.isFinite(x) || y !== undefined && !Number.isFinite(y)) return null;
    let next;
    if (name === 'translate') {
      if (unit !== 'px' || y !== undefined && secondUnit !== 'px') return null;
      next = [1, 0, 0, 1, x, y ?? 0];
    } else if (name === 'scale') {
      if (unit || secondUnit || x <= 0 || y !== undefined && y <= 0) return null;
      next = [x, 0, 0, y ?? x, 0, 0];
    } else {
      if (!['deg', 'rad', 'turn'].includes(unit) || y !== undefined) return null;
      const angle = unit === 'deg' ? x % 360 * Math.PI / 180 : unit === 'turn' ? x % 1 * 2 * Math.PI : x;
      if (name === 'rotate') next = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
      else next = name === 'skewX' ? [1, 0, Math.tan(angle), 1, 0, 0] : [1, Math.tan(angle), 0, 1, 0, 0];
    }
    const [a, b, c, d, e, f] = matrix, [g, h, i, j, k, l] = next;
    matrix = [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
    if (!matrix.every(Number.isFinite)) return null;
    rest = rest.slice(match[0].length).trimStart();
  }
  return matrix;
}

// Model output is data. Scripts, CSS, images, references, events and foreign HTML are not accepted.
export function validateVisual(visual) {
  if (visual.status !== 'ready') return {...visual, svg: '', animations: []};
  if (visual.svg.length > 24000 || /<!|<\?|&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/u.test(visual.svg)) throw new Error('Unsafe XML');
  const doc = new DOMParser({errorHandler: {warning: () => {throw new Error('Malformed SVG');}, error: () => {throw new Error('Malformed SVG');}, fatalError: () => {throw new Error('Malformed SVG');}}}).parseFromString(visual.svg, 'image/svg+xml');
  const root = doc.documentElement;
  const bounds = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (root.tagName !== 'svg' || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0 || Math.abs(bounds[2] / bounds[3] - 16 / 9) > 1e-6) throw new Error('Invalid visual bounds');
  if (Array.from(doc.childNodes).some(n => n !== root && (n.nodeType !== 3 || n.textContent.trim()))) throw new Error('Multiple roots');
  const ids = new Map(), visibleGeometry = new Set(); let count = 0;
  function walk(el, depth, fill = 'black', stroke = 'none', opacity = 1) {
    if (++count > 180 || depth > 10 || !elements.has(el.tagName)) throw new Error('Unsupported SVG element');
    for (const attr of Array.from(el.attributes)) {
      if (!attributes.has(attr.name) || /url\s*\(|https?:|javascript:|data:|[<>\\]/i.test(attr.value) && attr.name !== 'xmlns') throw new Error('Unsafe SVG attribute');
      if (attr.name === 'xmlns' && (el !== root || attr.value !== 'http://www.w3.org/2000/svg')) throw new Error('Invalid namespace');
      if (attr.value.length > 5000) throw new Error('Oversized SVG attribute');
    }
    fill = el.getAttribute('fill') || fill; stroke = el.getAttribute('stroke') || stroke;
    opacity *= el.hasAttribute('opacity') ? Number(el.getAttribute('opacity')) : 1;
    const x = Number(el.getAttribute('x') || 0), y = Number(el.getAttribute('y') || 0);
    const background = el.tagName === 'rect' && x <= bounds[0] && y <= bounds[1] && x + Number(el.getAttribute('width')) >= bounds[0] + bounds[2] && y + Number(el.getAttribute('height')) >= bounds[1] + bounds[3];
    if (['path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect'].includes(el.tagName) && !background) {
      const filled = !['line', 'polyline'].includes(el.tagName) && fill !== 'none' && Number(el.getAttribute('fill-opacity') || 1) > 0;
      const stroked = stroke !== 'none' && Number(el.getAttribute('stroke-opacity') || 1) > 0 && Number(el.getAttribute('stroke-width') || 1) > 0;
      if (opacity > 0 && (filled || stroked)) visibleGeometry.add(el);
    }
    if (el.hasAttribute('id')) {
      const id = el.getAttribute('id');
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(id) || ids.has(id)) throw new Error('Invalid SVG id');
      ids.set(id, el);
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) walk(child, depth + 1, fill, stroke, opacity);
      else if (child.nodeType !== 3) throw new Error('Unsupported XML node');
    }
  }
  walk(root, 0);
  if (!visual.description.trim()) throw new Error('Visual lacks an accessible explanation');
  if (!Array.isArray(visual.animations) || !visual.animations.length) throw new Error('A ready visual needs a meaningful geometry animation');
  for (const a of visual.animations) {
    if (!ids.has(a.target_id)) throw new Error(`Animation target "${a.target_id}" needs a matching id attribute on the SVG geometry.`);
    if (!Array.isArray(a.keyframes) || a.keyframes.length < 2 || !Number.isSafeInteger(a.duration_ms) || a.duration_ms < 1500 || a.duration_ms > 5000 || !Number.isSafeInteger(a.delay_ms) || a.delay_ms < 0 || !Number.isSafeInteger(a.duration_ms + a.delay_ms) || a.keyframes.some(k => !k || !Number.isFinite(k.opacity) || k.opacity < 0.4 || k.opacity > 1)) throw new Error('Unsafe animation');
    const matrices = a.keyframes.map(k => transformMatrix(k.transform));
    if (matrices.some(matrix => !matrix)) throw new Error('Unsafe animation');
    const target = ids.get(a.target_id);
    if (['svg', 'text', 'tspan'].includes(target.tagName) || target.getElementsByTagName('text').length || target.getElementsByTagName('tspan').length) throw new Error('Keep visual labels stable');
    if (!visibleGeometry.has(target) && !Array.from(target.getElementsByTagName('*')).some(el => visibleGeometry.has(el))) throw new Error('Animation needs visible non-background geometry');
    if (!a.keyframes.some((k, index) => k.opacity !== a.keyframes[0].opacity || matrices[index].some((value, component) => value !== matrices[0][component]))) throw new Error('Animation must change geometry');
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  root.setAttribute('width', '100%'); root.setAttribute('height', '100%');
  root.setAttribute('role', 'img'); root.setAttribute('aria-label', visual.description);
  return {...visual, svg: new XMLSerializer().serializeToString(root)};
}
