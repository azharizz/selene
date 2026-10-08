// The input SVG is server-validated data; only this host-owned script executes.
export function visualPage(visual, nonce) {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(nonce)) throw new Error('Invalid visual renderer nonce');
  const animations = JSON.stringify(visual.animations.map(({target_id, duration_ms, delay_ms, keyframes}) => ({
    target_id, duration_ms, delay_ms, keyframes: keyframes.map(({opacity, transform}) => ({opacity, transform})),
  }))).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none';"><style>html,body{margin:0;width:100%;height:100%;background:#202228;font-family:'Amazon Ember','Helvetica Neue',Arial,sans-serif}svg{display:block;width:100%;height:100%}</style></head><body>${visual.svg}<script nonce="${nonce}">
const motions=[];
const cancel=()=>{for(const motion of motions)motion.cancel();};
const fail=()=>{cancel();parent.postMessage('selene:visual-invalid','*');};
addEventListener('error',fail,{once:true});
addEventListener('pagehide',cancel,{once:true});
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
reduced.addEventListener('change',event=>{if(event.matches)cancel();});
addEventListener('load',()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
  if(reduced.matches)return;
  for(const a of ${animations}){
    const element=document.getElementById(a.target_id);
    if(!element||typeof element.animate!=='function'){fail();return;}
    const motion=element.animate(a.keyframes,{duration:a.duration_ms,delay:a.delay_ms,iterations:Infinity,fill:'both',easing:'ease-out'});
    motions.push(motion);
  }
})),{once:true});
</script></body></html>`;
}
