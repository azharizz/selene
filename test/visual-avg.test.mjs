import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOMParser} from '@xmldom/xmldom';
import {visualToApl} from '../server/visual-avg.mjs';
import {animationPose, transformMatrix, operationsMatrix, interpolationPlan} from '../shared/visual-transform.mjs';

const visit = (items, predicate) => items.flatMap(item=>[...(predicate(item)?[item]:[]),...visit(item.items || [],predicate)]);
const fixture = () => ({status:'ready',description:'A skewed object touches the baseline; the label stays fixed.',svg:'<svg viewBox="-80 -45 160 90"><g fill="none" stroke="red" stroke-width="2" transform="translate(4 5) skewY(12)"><rect id="object" x="-10" y="-10" width="20" height="20" rx="3"/><line x1="-50" y1="10" x2="50" y2="10"/><ellipse cx="30" cy="0" rx="5" ry="9"/></g><text x="0" y="30" font-size="8" text-anchor="middle">Contact stays here</text></svg>',animations:[{target_id:'object',duration_ms:1500,delay_ms:100,keyframes:[{opacity:0.4,transform:'translate(0px, 0px) skewX(0deg) rotate(0turn)'},{opacity:1,transform:'translate(15px, -5px) skewX(45deg) rotate(.25turn)'},{opacity:1,transform:'none'}]}]});

test('prepared answers preserve every label and geometry as AVG, never generate again',()=> {
  const entries=JSON.parse(readFileSync(new URL('../server/preloaded-answers.json',import.meta.url),'utf8')).entries;
  for(const entry of entries) {
    const {avg,document,commands}=visualToApl(entry.visual);
    const svg=new DOMParser().parseFromString(entry.visual.svg,'image/svg+xml');
    const labels=Array.from(svg.getElementsByTagName('text')).map(el=>el.textContent);
    const shapeCount=['rect','circle','ellipse','line','polyline','polygon','path'].reduce((count,tag)=>count+svg.getElementsByTagName(tag).length,0);
    assert.deepEqual(visit(avg.items,item=>item.type==='text').map(item=>new DOMParser().parseFromString(`<text>${item.text}</text>`,'image/svg+xml').documentElement.textContent),labels);
    assert.equal(visit(avg.items,item=>item.type==='path').length,shapeCount);
    assert.equal(avg.viewportWidth,960); assert.equal(avg.viewportHeight,540);
    assert.equal(document.mainTemplate.items[0].source,'answer');
    assert.equal(commands.length,new Set(entry.visual.animations.map(a=>a.target_id)).size);
  }
});

test('AVG and native transforms preserve skew, composition, contact and angular units',()=> {
  const visual=fixture(), {avg,commands}=visualToApl(visual);
  assert.equal(avg.items[0].transform,'translate(80 45)');
  assert.equal(visit(avg.items,item=>item.transform==='translate(4 5) skewY(12)').length,1);
  assert.equal(visit(avg.items,item=>item.type==='path').length,3);
  assert.match(visit(avg.items,item=>item.transform?.includes('Motion0'))[0].transform,/skewX|rotate/);
  assert.equal(commands[0].delay,100);
  assert.equal(commands[0].commands[0].type,'AnimateItem');
  assert.equal(commands[0].commands[0].easing,'ease-out');
  assert.equal(commands[0].commands[0].duration,1500);
  assert.deepEqual(commands[0].commands[1].arguments,['selene:avg-loop',0]);
  const frames=[{opacity:0.4,transform:'scale(2) translate(10px, 3px) skewX(0deg)'},{opacity:1,transform:'scale(2) translate(20px, 5px) skewX(45deg)'}];
  const middle=animationPose(frames,0.5);
  assert.deepEqual(middle.matrix.slice(4),[30,8]);
  assert.ok(Math.abs(middle.matrix[2]-2*Math.tan(Math.PI/8))<1e-12);
  assert.equal(middle.opacity,0.7);
  assert.deepEqual(transformMatrix('rotate(.25turn)'),transformMatrix('rotate(90deg)'));
  const mismatched=interpolationPlan('translate(8px, 4px) rotate(30deg)','scale(2) skewY(20deg)');
  for(const fraction of [0,1]) {
    const actual=operationsMatrix(mismatched.map(op=>({name:op.name,values:fraction?op.to:op.from})));
    const expected=transformMatrix(fraction?'scale(2) skewY(20deg)':'translate(8px, 4px) rotate(30deg)');
    actual.forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<1e-12));
  }
});

test('reduced motion retains authored positions/opacity and labels without animation commands',()=> {
  const visual=fixture(); visual.svg=visual.svg.replace('id="object"','id="object" opacity="0.8" transform="translate(2 3) skewX(20)"');
  const {avg,document,commands}=visualToApl(visual,{reducedMotion:true});
  assert.equal(commands.length,0); assert.deepEqual(avg.parameters,[]);
  assert.equal(document.mainTemplate.items[0].onMount,undefined);
  assert.equal(visit(avg.items,item=>item.transform==='translate(2 3) skewX(20)' && item.opacity===0.8).length,1);
  assert.equal(visit(avg.items,item=>item.type==='text')[0].text,'Contact stays here');
});

test('unsupported SVG semantics fail explicitly instead of silently dropping them',()=> {
  for(const replacement of ['font-size="2em"','dominant-baseline="middle"']) {
    const visual=fixture(); visual.svg=visual.svg.replace('font-size="8"',replacement);
    assert.throws(()=>visualToApl(visual),/AVG conversion:/);
  }
  const positions=fixture(); positions.svg=positions.svg.replace('x="0" y="30"','x="0 10" y="30"');
  assert.throws(()=>visualToApl(positions),/AVG conversion:/);
  const visual=fixture(); visual.svg=visual.svg.replace('Contact stays here','Contact<tspan> flows</tspan>');
  assert.throws(()=>visualToApl(visual),/flowing tspan/);
  assert.throws(()=>transformMatrix('skewX(3em)'));
  assert.throws(()=>transformMatrix('translate(4px) unsupported(5)'));
});

test('generated label markup and APL expressions stay inert in the official web host',()=> {
  const visual=fixture();
  visual.svg=visual.svg.replace('Contact stays here','&lt;img onerror=&quot;alert(1)&quot;&gt; &amp; ${7*6}');
  const label=visit(visualToApl(visual).avg.items,item=>item.type==='text')[0].text;
  assert.ok(label.startsWith('${"'));
  assert.match(label,/&lt;img/);
  assert.match(label,/&amp;/);
  assert.ok(!label.includes('<img'));
});
