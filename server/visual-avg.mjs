import {DOMParser} from '@xmldom/xmldom';
import {validateVisual} from './visual.mjs';
import {parseTransform, decompose, interpolationPlan} from '../shared/visual-transform.mjs';

// AVG 1.2: https://developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/apl-avg-format.html
// AnimateItem: https://developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/apl-animate-item-command.html
const presentation = {'fill':'fill','stroke':'stroke','fill-opacity':'fillOpacity','stroke-opacity':'strokeOpacity','stroke-width':'strokeWidth','stroke-linecap':'strokeLineCap','stroke-linejoin':'strokeLineJoin','stroke-dasharray':'strokeDashArray','font-size':'fontSize','font-family':'fontFamily','font-weight':'fontWeight','text-anchor':'textAnchor','dominant-baseline':'baseline'};
const numeric = new Set(['fillOpacity','strokeOpacity','strokeWidth','fontSize']);
const metadata = new Set(['id','xmlns','role','aria-label','viewBox']);
const geometry = {svg:['width','height'],g:[],rect:['x','y','width','height','rx','ry'],circle:['cx','cy','r'],ellipse:['cx','cy','rx','ry'],line:['x1','y1','x2','y2'],polyline:['points'],polygon:['points'],path:['d'],text:['x','y','dx','dy'],tspan:['x','y','dx','dy']};
const fail = message => {throw new Error(`AVG conversion: ${message}`);};
const literal = value => value.includes('${') || value.startsWith('@') ? '${' + JSON.stringify(value) + '}' : value;
const n = (value, label) => {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) fail(`unsupported numeric ${label}="${value}"`);
  return Number(value);
};
const expression = source => '${' + source + '}';
const lerp = (from,to,t) => from === to ? String(from) : `(${from}+(${to-from})*(${t}))`;
function piecewise(frames, variable, make) {
  return frames.slice(0,-1).map((from,index) => {
    const t = `(${variable}*${frames.length-1}-${index})`;
    return {test:`${variable}<${(index+1)/(frames.length-1)}`,value:make(from,frames[index+1],t)};
  }).reduceRight((next,part,index,array)=> index === array.length-1 ? part.value : `(${part.test}?${part.value}:${next})`, '');
}
function animatedTransform(frames, variable) {
  return expression(piecewise(frames,variable,(from,to,t)=> {
    const pairs = interpolationPlan(from.transform,to.transform);
    const pieces = pairs.map(pair => JSON.stringify(`${pair.name}(`) + '+' + pair.from.map((v,i)=>lerp(v,pair.to[i],t)).join('+" "+') + '+")"');
    return pieces.length ? pieces.join('+" "+') : '""';
  }));
}
function staticTransform(value) {
  return parseTransform(value,false).flatMap(op=>op.name === 'matrix' ? decompose(op.values) : op).map(op=>`${op.name}(${op.values.join(' ')})`).join(' ');
}
function pathData(el) {
  const tag = el.tagName, get = (name, fallback=0) => el.hasAttribute(name) ? n(el.getAttribute(name),name) : fallback;
  if (tag === 'path') return el.getAttribute('d') || '';
  if (tag === 'line') return `M${get('x1')} ${get('y1')}L${get('x2')} ${get('y2')}`;
  if (tag === 'polyline' || tag === 'polygon') {
    const points = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(v=>n(v,'points'));
    if (points.length < 4 || points.length%2) fail('invalid points');
    return `M${points.slice(0,2).join(' ')}L${points.slice(2).join(' ')}${tag === 'polygon' ? 'Z' : ''}`;
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const x=get('cx'),y=get('cy'),rx=tag === 'circle'?get('r'):get('rx'),ry=tag === 'circle'?get('r'):get('ry');
    if (rx<0 || ry<0) fail('negative radius');
    return `M${x-rx} ${y}A${rx} ${ry} 0 1 0 ${x+rx} ${y}A${rx} ${ry} 0 1 0 ${x-rx} ${y}Z`;
  }
  const x=get('x'),y=get('y'),w=get('width'),h=get('height');
  if(w<0 || h<0) fail('negative rectangle size');
  const rx=Math.min(get('rx',get('ry')),w/2),ry=Math.min(get('ry',get('rx')),h/2);
  if(rx<0 || ry<0) fail('negative rectangle radius');
  if(!rx || !ry) return `M${x} ${y}H${x+w}V${y+h}H${x}Z`;
  return `M${x+rx} ${y}H${x+w-rx}A${rx} ${ry} 0 0 1 ${x+w} ${y+ry}V${y+h-ry}A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h}H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+h-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z`;
}
export function visualToApl(input, {reducedMotion = false} = {}) {
  const visual = validateVisual(input);
  if (visual.status !== 'ready') fail('visual is not ready');
  const root = new DOMParser().parseFromString(visual.svg,'image/svg+xml').documentElement;
  const [originX,originY,width,height] = root.getAttribute('viewBox').split(/[\s,]+/).map(Number);
  const motions = new Map();
  visual.animations.forEach((a,index)=>motions.set(a.target_id,{...a,variable:`Motion${index}`}));
  const parameters = [], bindings = [], commands = [];
  // Multiple animations targeting one SVG element follow WAAPI replacement order (last wins).
  for(const animation of motions.values()) {
    if(reducedMotion) continue;
    parameters.push({name:animation.variable,type:'number',default:0});
    bindings.push({name:animation.variable,type:'number',value:0});
    commands.push({type:'Sequential',sequencer:animation.variable,delay:animation.delay_ms,commands:[{type:'AnimateItem',componentId:'diagram',duration:animation.duration_ms,easing:'ease-out',value:[{property:animation.variable,from:0,to:1}]},{type:'SendEvent',arguments:['selene:avg-loop',commands.length]}]});
  }
  function convert(el, inherited, textPosition) {
    const tag = el.tagName;
    if(tag === 'title' || tag === 'desc') return null; // Accessibility is retained in AVG.description/APL.accessibilityLabel.
    if(!geometry[tag]) fail(`unsupported element ${tag}`);
    const paint = {...inherited};
    for(const attr of Array.from(el.attributes)) {
      if(presentation[attr.name]) {
        const key=presentation[attr.name];
        paint[key] = numeric.has(key) ? n(attr.value,attr.name) : key === 'strokeDashArray' ? attr.value === 'none' ? [] : attr.value.trim().split(/[\s,]+/).map(v=>n(v,attr.name)) : attr.value;
      } else if(!metadata.has(attr.name) && !['transform','opacity'].includes(attr.name) && !geometry[tag].includes(attr.name)) fail(`unsupported ${tag} attribute ${attr.name}`);
    }
    const animation = reducedMotion ? null : motions.get(el.getAttribute('id'));
    const group = {type:'group',items:[]};
    if(animation) {
      group.transform=animatedTransform(animation.keyframes,animation.variable);
      group.opacity=expression(piecewise(animation.keyframes,animation.variable,(a,b,t)=>lerp(a.opacity,b.opacity,t)));
    } else {
      if(el.hasAttribute('transform')) group.transform=staticTransform(el.getAttribute('transform'));
      if(el.hasAttribute('opacity')) group.opacity=n(el.getAttribute('opacity'),'opacity');
    }
    const pathPaint = Object.fromEntries(['fill','stroke','fillOpacity','strokeOpacity','strokeWidth','strokeLineCap','strokeLineJoin','strokeDashArray'].filter(key=>paint[key]!==undefined).map(key=>[key,typeof paint[key] === 'string' ? literal(paint[key] === 'none' && ['fill','stroke'].includes(key) ? 'transparent' : paint[key]) : paint[key]]));
    if(tag === 'svg' || tag === 'g') {
      group.items=Array.from(el.childNodes).filter(node=>node.nodeType===1).map(node=>convert(node,paint)).filter(Boolean);
    } else if(tag === 'text' || tag === 'tspan') {
      if(paint.baseline && !['auto','alphabetic'].includes(paint.baseline)) fail(`unsupported text baseline ${paint.baseline}`);
      if (paint.stroke && paint.stroke !== 'none' && (paint.strokeDashArray?.length || paint.strokeLineCap || paint.strokeLineJoin)) fail('unsupported styled text stroke');
      const pos={x:el.hasAttribute('x')?n(el.getAttribute('x'),'x'):textPosition?.x ?? 0,y:el.hasAttribute('y')?n(el.getAttribute('y'),'y'):textPosition?.y ?? 0};
      pos.x+=el.hasAttribute('dx')?n(el.getAttribute('dx'),'dx'):0;
      pos.y+=el.hasAttribute('dy')?n(el.getAttribute('dy'),'dy'):0;
      const children=Array.from(el.childNodes).filter(node=>node.nodeType===1 || node.nodeType===3 && node.nodeValue.trim());
      if(children.length>1 && children.some(node=>node.nodeType===3 || !node.hasAttribute('x'))) fail('flowing tspan text requires explicit x positions');
      // The official web host assigns AVG text through innerHTML. Keep generated labels inert.
      group.items=children.map(node=>node.nodeType===1 ? convert(node,paint,pos) : ({type:'text',...pathPaint,x:pos.x,y:pos.y,text:literal(node.nodeValue.replace(/\s+/g,' ').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')),fontSize:paint.fontSize ?? 16,fontFamily:literal(paint.fontFamily ?? "'Amazon Ember','Helvetica Neue',Arial,sans-serif"),fontWeight:paint.fontWeight ?? 'normal',textAnchor:paint.textAnchor ?? 'start'}));
    } else {
      if (Array.from(el.childNodes).some(node=>node.nodeType===1)) fail(`unsupported children of ${tag}`);
      group.items=[{type:'path',...pathPaint,pathData:literal(pathData(el))}];
    }
    return group;
  }
  const items=[convert(root,{fill:'black',stroke:'none',strokeWidth:1})];
  const avg={type:'AVG',version:'1.2',width,height,viewportWidth:width,viewportHeight:height,description:literal(visual.description),parameters,items:originX || originY ? [{type:'group',transform:`translate(${-originX} ${-originY})`,items}] : items};
  const component={type:'VectorGraphic',id:'diagram',source:'answer',width:'100%',height:'100%',scale:'best-fit',accessibilityLabel:literal(visual.description),bind:bindings,parameters:Object.fromEntries(parameters.map(p=>[p.name,expression(p.name)]))};
  if(commands.length) component.onMount=[{type:'Parallel',commands}];
  return {avg,commands,document:{type:'APL',version:'2024.3',theme:'dark',graphics:{answer:avg},mainTemplate:{items:[component]}}};
}
