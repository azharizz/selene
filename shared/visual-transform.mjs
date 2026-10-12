// CSS transform interpolation shared by native SVG and the AVG converter.
// Matrices use SVG's [a,b,c,d,e,f] order. No unsupported transform is ignored.
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const token = new RegExp(`^(${number})(px|deg|rad|turn)?$`);
const identity = [1, 0, 0, 1, 0, 0];
export function multiply(left, right) {
  const [a,b,c,d,e,f] = left, [g,h,i,j,k,l] = right;
  return [a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];
}
export function parseTransform(value = 'none', css = true) {
  if (value.trim() === 'none') return [];
  let rest = value.trim(); const result = [];
  while (rest) {
    const match = /^(translate|scale|rotate|skewX|skewY|matrix)\(([^()]*)\)/.exec(rest);
    if (!match) throw new Error(`Unsupported transform: ${value}`);
    const [,name,body] = match;
    const parts = body.trim().split(/[\s,]+/).map(part => {
      const parsed = token.exec(part);
      if (!parsed || !Number.isFinite(Number(parsed[1]))) throw new Error(`Invalid transform: ${value}`);
      return {value: Number(parsed[1]), unit: parsed[2] || ''};
    });
    const angle = name === 'rotate' || name.startsWith('skew');
    if (parts.some((p,i) => angle && i === 0 ? css ? !['deg','rad','turn'].includes(p.unit) : Boolean(p.unit) : name === 'translate' ? css ? p.unit !== 'px' : Boolean(p.unit) : Boolean(p.unit))) throw new Error(`Invalid transform units: ${value}`);
    const values = parts.map((p,i) => angle && i === 0 ? p.unit === 'rad' ? p.value*180/Math.PI : p.unit === 'turn' ? p.value*360 : p.value : p.value);
    if ((name === 'matrix' && (css || values.length !== 6)) || (name.startsWith('skew') && values.length !== 1) || (name === 'rotate' && values.length !== 1 && (css || values.length !== 3)) || (['translate','scale'].includes(name) && ![1,2].includes(values.length))) throw new Error(`Invalid transform arguments: ${value}`);
    if (name === 'translate') result.push({name, values: [values[0],values[1] ?? 0]});
    else if (name === 'scale') result.push({name, values: [values[0],values[1] ?? values[0]]});
    else if (name === 'rotate' && values.length === 3) result.push({name:'translate',values:values.slice(1)}, {name,values:[values[0]]}, {name:'translate',values:values.slice(1).map(n=>-n)});
    else result.push({name,values});
    rest = rest.slice(match[0].length).trimStart();
  }
  return result;
}
export function operationsMatrix(operations) {
  return operations.reduce((matrix, {name,values:v}) => {
    const r = v[0]*Math.PI/180;
    const next = name === 'translate' ? [1,0,0,1,...v] : name === 'scale' ? [v[0],0,0,v[1],0,0] : name === 'rotate' ? [Math.cos(r),Math.sin(r),-Math.sin(r),Math.cos(r),0,0] : name === 'skewX' ? [1,0,Math.tan(r),1,0,0] : name === 'skewY' ? [1,Math.tan(r),0,1,0,0] : v;
    return multiply(matrix,next);
  }, identity);
}
export function transformMatrix(value, css = true) {return operationsMatrix(parseTransform(value,css));}
export function decompose(matrix) {
  let [a,b,c,d,e,f] = matrix;
  let sx = Math.hypot(a,b), sy, skew;
  if (!sx) throw new Error('Singular transform cannot be interpolated');
  a /= sx; b /= sx;
  skew = a*c+b*d; c -= a*skew; d -= b*skew;
  sy = Math.hypot(c,d);
  if (!sy) throw new Error('Singular transform cannot be interpolated');
  skew /= sy;
  if (a*d-b*c < 0) {sx = -sx; a = -a; b = -b; skew = -skew;}
  return [{name:'translate',values:[e,f]}, {name:'rotate',values:[Math.atan2(b,a)*180/Math.PI]}, {name:'skewX',values:[Math.atan(skew)*180/Math.PI]}, {name:'scale',values:[sx,sy]}];
}
const neutral = operation => ({name:operation.name,values:operation.values.map(()=>operation.name === 'scale' ? 1 : 0)});
export function interpolationPlan(from, to) {
  const left = parseTransform(from), right = parseTransform(to);
  const count = Math.max(left.length,right.length);
  const pairs = [];
  for (let i=0;i<count;i++) {
    const a = left[i] || neutral(right[i]), b = right[i] || neutral(left[i]);
    if (a.name !== b.name) {
      const x = decompose(operationsMatrix(left.slice(i))), y = decompose(operationsMatrix(right.slice(i)));
      // CSS matrix interpolation takes the shortest rotation when lists stop matching.
      if (Math.abs(x[1].values[0]-y[1].values[0]) > 180) {
        if (x[1].values[0] > y[1].values[0]) x[1].values[0] -= 360; else y[1].values[0] -= 360;
      }
      pairs.push(...x.map((op,j)=>({name:op.name,from:op.values,to:y[j].values})));
      break;
    }
    pairs.push({name:a.name,from:a.values,to:b.values});
  }
  return pairs;
}
export function animationPose(keyframes, progress, plans) {
  const offset = Math.max(0,Math.min(1,progress))*(keyframes.length-1);
  const index = Math.min(keyframes.length-2,Math.floor(offset)), fraction = offset-index;
  const from = keyframes[index], to = keyframes[index+1];
  const operations = (plans?.[index] ?? interpolationPlan(from.transform ?? 'none',to.transform ?? 'none')).map(pair=>({name:pair.name,values:pair.from.map((value,i)=>value+(pair.to[i]-value)*fraction)}));
  return {matrix:operationsMatrix(operations),opacity:(from.opacity ?? 1)+((to.opacity ?? 1)-(from.opacity ?? 1))*fraction};
}
