import React from 'react';

export type VisualArtifact = {status: 'ready' | 'fallback' | 'none'; svg: string; description: string; animations: unknown[]};

export class Visual extends React.PureComponent<{visual: VisualArtifact; compact?: boolean}, {failed: boolean}> {
  state = {failed: false};
  private frame = React.createRef<HTMLIFrameElement>();
  private nonce = document.querySelector<HTMLMetaElement>('meta[name="selene-renderer-nonce"]')?.content;
  componentDidMount() {window.addEventListener('message', this.receive);}
  componentWillUnmount() {window.removeEventListener('message', this.receive);}
  private receive = (event: MessageEvent) => {
    if (event.source === this.frame.current?.contentWindow && event.data === 'selene:visual-invalid') this.setState({failed: true});
  };
  render() {
    const {visual, compact = false} = this.props;
    if (visual.status !== 'ready' || this.state.failed || !this.nonce) return <div className="visual-fallback">
      <p>{visual.description || 'The explanation is ready in words.'}</p>
      {(visual.status === 'fallback' || this.state.failed || !this.nonce) && <span className="small">Visual unavailable</span>}
    </div>;
    const animations = JSON.stringify(visual.animations).replace(/</g, '\\u003c');
    // Only this host-owned script executes. The server accepts SVG geometry, never generated JavaScript.
    const page = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${this.nonce}';"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#202228;font-family:'Amazon Ember','Helvetica Neue',Arial,sans-serif}svg{display:block;width:100%;height:100%;overflow:hidden}</style></head><body>${visual.svg}<script nonce="${this.nonce}">
const fail=()=>parent.postMessage('selene:visual-invalid','*');
addEventListener('error',fail,{once:true});
const svg=document.querySelector('svg');
const compact=${compact};
if(compact){
  // The adjacent answer carries the words; don't shrink duplicate labels into unreadable text.
  for(const label of svg.querySelectorAll('text'))label.style.display='none';
  for(const rect of svg.querySelectorAll('rect')){
    if(rect.getAttribute('fill')==='#202228'&&Number(rect.getAttribute('width'))>=800&&Number(rect.getAttribute('height'))>=440)rect.style.display='none';
  }
}
const labels=compact?[]:Array.from(svg.querySelectorAll('text'));
function fits(){
  const inverse=svg.getScreenCTM().inverse();
  const illegible=labels.some(label=>{
    const style=getComputedStyle(label), matrix=label.getScreenCTM();
    let opacity=Number(style.fillOpacity);
    for(let element=label;element&&element!==document.body;element=element.parentElement)opacity*=Number(getComputedStyle(element).opacity);
    return parseFloat(style.fontSize)*Math.hypot(matrix.a,matrix.b)<${Math.max(18, Math.min(28, window.innerWidth / 1920 * 28))}||opacity<0.8;
  });
  const boxes=labels.map(label=>{
    const box=label.getBoundingClientRect();
    const start=new DOMPoint(box.left,box.top).matrixTransform(inverse);
    const end=new DOMPoint(box.right,box.bottom).matrixTransform(inverse);
    return {left:start.x,top:start.y,right:end.x,bottom:end.y};
  });
  const overflow=Array.from(svg.querySelectorAll('path,line,polyline,polygon,circle,ellipse,rect')).filter(shape=>getComputedStyle(shape).display!=='none').some(shape=>{
    const box=shape.getBoundingClientRect(),start=new DOMPoint(box.left,box.top).matrixTransform(inverse),end=new DOMPoint(box.right,box.bottom).matrixTransform(inverse);
    return start.x<-.5||start.y<-.5||end.x>960.5||end.y>540.5;
  });
  const invalid=illegible||overflow||boxes.some(box=>box.left<35||box.top<35||box.right>925||box.bottom>505)||boxes.some((box,i)=>boxes.slice(i+1).some(other=>Math.min(box.right,other.right)-Math.max(box.left,other.left)>2&&Math.min(box.bottom,other.bottom)-Math.max(box.top,other.top)>2));
  if(invalid)fail();
  return !invalid;
}
requestAnimationFrame(()=>{
  if(!fits())return;
  if(compact){
    const box=svg.getBBox(),size=Math.max(box.width,box.height)+96;
    if(box.width>0&&box.height>0)svg.setAttribute('viewBox',[box.x+box.width/2-size/2,box.y+box.height/2-size/2,size,size].join(' '));
  }
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  // Older cached diagrams can reveal their connector strokes once. Never pulse the entire SVG.
  if(compact && ${animations}.length===0){
    let index=0;
    for(const line of svg.querySelectorAll('path,line,polyline')){
      if(getComputedStyle(line).display==='none'||getComputedStyle(line).stroke==='none')continue;
      const length=line.getTotalLength();
      if(length>0)line.animate([{strokeDasharray:String(length),strokeDashoffset:String(length)},{strokeDasharray:String(length),strokeDashoffset:'0'}],{duration:900,delay:index++*180,iterations:1,fill:'backwards',easing:'ease-out'});
    }
  }
  for(const a of ${animations}){
    const element=document.getElementById(a.target_id);
    if(element&&element.animate){const motion=element.animate(a.keyframes,{duration:a.duration_ms,delay:a.delay_ms,iterations:1,fill:'forwards',easing:'ease-out'});motion.onfinish=fits;}
  }
});
</script></body></html>`;
    return <iframe ref={this.frame} title={visual.description} sandbox="allow-scripts" srcDoc={page} tabIndex={-1} onError={() => this.setState({failed: true})} />;
  }
}
