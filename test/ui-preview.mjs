// Test-only visual harness. It bundles the actual components, never ships in assets,
// and substitutes only native transport/network boundaries. No provider/model claim.
import {build} from 'esbuild';
import {createServer} from 'node:http';
const phoneStory = {id: 'phone-fixture', title: 'Sintel excerpt', content_version: 'a'.repeat(64), duration: 105, transcript: [], scenes: []};
const phoneMoment = {state: 'response', answer: '“Sit still” means stay in one place without moving.', audience: {recipient: 'grandparent', source: 'declaration'},
  visual: {status: 'ready', description: 'An abstract figure settles into a fixed place. This diagram explains the phrase, not an action in the film.',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#202228"/><circle cx="480" cy="235" r="155" fill="none" stroke="#ffad33" stroke-width="18"/><g id="figure" stroke="#f1f1f1" stroke-width="20" stroke-linecap="round"><circle cx="480" cy="170" r="28" fill="#f1f1f1"/><path d="M480 216V280M432 244H528M480 280L444 328M480 280L516 328"/></g><text x="480" y="462" text-anchor="middle" font-size="60" fill="#f1f1f1">Stay in place</text></svg>',
    animations: [{target_id: 'figure', keyframes: [{opacity: 1, transform: 'translate(-32px, 0px)'}, {opacity: 1, transform: 'none'}], duration_ms: 1500, delay_ms: 100}]},
  grounding: {content_id: phoneStory.id, scene_id: 'fixture', at_seconds: 42, evidence_ids: []},
  intervention: {playback: 'keep_watching', audio: 'silent'},};
const snapshot = {package_id: 'test.player', session_id: 7, catalog_name: 'test', content_id: 'kite', title: 'The Red Kite', provider_name: 'UI test player', at_seconds: 36};
const playback = {state: 'playing', can_pause: true, can_play: true, revision: 1, observing: false};
const moment = {state: 'response', answer: 'From your description, Arun wants to repair the kite because it reminds him of his father. Keeping it matters more to him than replacing it.', audience: {recipient: 'grandparent', source: 'declaration'},
  visual: {status: 'ready', description: 'Arun connects the old kite with memories of his father.', animations: [{target_id: 'memory-link', duration_ms: 1500, delay_ms: 0, keyframes: [{opacity: 0.4, transform: 'translate(-24px, 0px)'}, {opacity: 1, transform: 'none'}]}], svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#202228"/><text x="60" y="95" font-size="48" fill="#f1f1f1">From your description</text><rect x="60" y="175" width="335" height="200" rx="16" fill="#303238"/><text x="105" y="265" font-size="56" fill="#f1f1f1">Old kite</text><text x="105" y="330" font-size="48" fill="#b9bdc6">Arun keeps it</text><g id="memory-link"><path d="M420 275H510" stroke="#ffad33" stroke-width="18"/><path d="m500 260 24 15-24 15" fill="#ffad33"/></g><rect x="550" y="175" width="350" height="200" rx="16" fill="#303238"/><text x="585" y="265" font-size="56" fill="#f1f1f1">His father</text><text x="585" y="330" font-size="48" fill="#b9bdc6">A memory</text></svg>'},
  intervention: {playback: 'offer_choice', audio: 'silent'},};
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CompanionMoment} from './web/CompanionMoment'; import {Companion} from './src/Companion'; import {MomentPanel} from './src/Moment'; import {PrivateMirror} from './web/PrivateMirror'; import './web/style.css';
const params=new URLSearchParams(location.search), view=params.get('view')||'ask';
const snapshot=${JSON.stringify(snapshot)}, playback=${JSON.stringify(playback)}, moment=${JSON.stringify(moment)};
class NativePreview extends Companion {componentDidMount(){this.mounted=true;} }
const ref=React.createRef();
class Preview extends React.Component {
 componentDidMount(){if(view==='phone'||view==='native')return; const app=ref.current; if(view==='home'||view==='empty') {
   const sessions=Array.from({length:view==='empty'?0:8},(_,i)=>({packageId:'test.player.'+i,title:['The Red Kite','Offside Practice','A longer title to check truncation on television screens'][i%3],providerName:'UI test player',state:{id:{id:i},playbackState:{playbackStatus:'PLAYING'},capabilities:{actions:[]}}}));
   app.setState({sessions,busy:false,message:sessions.length?'Choose what you’re watching.':'No shared playback found. Start a title in a supported app, then try again.'});
 } else {app.sessionId='ui-fixture'; if(view==='response')app.setState({screen:'moment',moment,playback,choice:'unspecified'});
 if(view==='clarification')app.setState({screen:'ask',clarifying:true,moment:{...moment,state:'clarification',answer:'What did the person say just before that?'},lastInput:null});
 if(view==='loading')app.setState({screen:'loading'}); if(view==='error')app.setState({error:'The playback app stopped sharing this session. Close this moment and try again.'});}}
 render(){return <>{view==='native'?<MomentPanel moment={moment} onDismiss={()=>{}}/>:view==='phone'?<PrivateMirror token="ui-fixture"/>:view==='home'||view==='empty'?<NativePreview ref={ref} onReady={()=>{}} onDemo={()=>location.href='http://127.0.0.1:4519'} onImport={()=>location.href='http://127.0.0.1:4519/?import=mp4'}/>:<CompanionMoment ref={ref} initial={{snapshot,playback}}/>}<div style={{position:'fixed',bottom:2,right:12,fontSize:12,color:'#b9bdc6',pointerEvents:'none'}}>UI TEST FIXTURE · no live playback or model</div></>}
}
createRoot(document.getElementById('root')).render(<Preview/>);`;
const nativeShim = `import React from 'react';
const css=(styles)=>{const s=Object.assign({},...[styles].flat(Infinity).filter(Boolean)); for(const [key,a,b] of [['paddingHorizontal','paddingLeft','paddingRight'],['paddingVertical','paddingTop','paddingBottom'],['marginVertical','marginTop','marginBottom'],['marginHorizontal','marginLeft','marginRight']])if(key in s){s[a]=s[key];s[b]=s[key];delete s[key];} if(typeof s.lineHeight==='number')s.lineHeight=s.lineHeight+'px';if(Array.isArray(s.transform))s.transform=s.transform.map(t=>Object.entries(t).map(([k,v])=>k+'('+v+(k.startsWith('translate')?'px':'')+')').join(' ')).join(' ');return s};
const animation={start(){},stop(){}};class Value{constructor(n){this.n=n}setValue(n){this.n=n}stopAnimation(){}interpolate({outputRange}){return outputRange.at(-1)}}
export const Animated={Value,View:({style,children})=><View style={style}>{children}</View>,Text:({style,children})=><Text style={style}>{children}</Text>,createAnimatedComponent:C=>C,timing:()=>animation,delay:()=>animation,sequence:()=>animation,loop:()=>animation};
export const Easing={linear:x=>x,cubic:x=>x,quad:x=>x,out:f=>f,in:f=>f,inOut:f=>f,bezier:()=>x=>x};
export const AccessibilityInfo={isReduceMotionEnabled:async()=>false};export const StyleSheet={create:s=>s,absoluteFill:{position:'absolute',inset:0}};
export const AppState={addEventListener:()=>({remove(){}})},BackHandler=AppState;
export const useWindowDimensions=()=>({width:960,height:540});
export function View({style,children,accessibilityLabel}){return <div aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',minWidth:0,minHeight:0,...css(style)}}>{children}</div>}
export const ScrollView=View;
export function Text({style,children,numberOfLines,accessible}){return <span aria-label={accessible?String(children):undefined} style={{display:numberOfLines?'-webkit-box':'block',WebkitLineClamp:numberOfLines,WebkitBoxOrient:'vertical',overflow:'hidden',...css(style)}}>{children}</span>}
export function TextInput({value,onChangeText,placeholder,style}){return <input value={value} placeholder={placeholder} onChange={e=>onChangeText(e.target.value)} style={css(style)}/>}
export function Image({source,style}){return <img src={source} style={css(style)}/>}
export function Pressable({children,style,onPress,onFocus,onBlur,disabled,accessibilityLabel,hasTVPreferredFocus}){return <button aria-label={accessibilityLabel} autoFocus={hasTVPreferredFocus} disabled={disabled} onClick={onPress} onFocus={onFocus} onBlur={onBlur} style={{textAlign:'left',display:'flex',flexDirection:'column',...css(style)}}>{children}</button>}`;
const output = await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'preview',platform:'browser',format:'iife',loader:{'.png':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-native-boundary',setup(b){
 b.onResolve({filter:/^react-native$/},()=>({path:'native',namespace:'test'}));
 b.onResolve({filter:/^@amazon-devices\/(webview|kepler-media-controls|react-native-svg)$/},a=>({path:a.path,namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},({path})=>({contents:path==='native'?nativeShim:path==='@amazon-devices/react-native-svg'?`import React from 'react';const node=tag=>({children,...props})=>React.createElement(tag,props,children);export const Defs=node('defs'),LinearGradient=node('linearGradient'),Stop=node('stop'),Path=node('path'),Rect=node('rect'),Circle=node('circle'),Ellipse=node('ellipse'),G=node('g'),Line=node('line'),Polygon=node('polygon'),Polyline=node('polyline'),Text=node('text'),TSpan=node('tspan');export default node('svg');`:'export const WebView=()=>null; export const MediaControlComponentAsync={makeMediaControlEndpointLocator:()=>({getMediaControlEndpoints:async()=>[]})};',loader:'tsx',resolveDir:process.cwd()}));
}}]});
const js=output.outputFiles.find(f=>f.path.endsWith('.js')).contents, css=output.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const bootstrap = `let playback=${JSON.stringify(playback)}; window.ReactNativeWebView={postMessage(raw){const msg=JSON.parse(raw);if(msg.action==='close'){location.href='/?view=home';return;}if(['play','pause','refresh'].includes(msg.action)){if(msg.action!=='refresh')playback={...playback,state:msg.action==='pause'?'paused':'playing',revision:playback.revision+1};queueMicrotask(()=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{type:'selene:playback',id:msg.id,playback}})));}}};
let phoneTime=42,phoneSequence=1,phoneHold=null,phoneHelp=null,phoneBridge=null,phoneThread=null;
const phonePlayback=()=>({content_id:'phone-fixture',content_version:'${phoneStory.content_version}',epoch:0,sequence:phoneSequence,at_seconds:phoneTime,play_state:phoneTime===105?'ended':'playing',playback_rate:1,age_ms:0,fresh:true});
window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'personal',story:${JSON.stringify(phoneStory)},playback:phonePlayback(),hold:phoneHold,help:phoneHelp,bridge:phoneBridge,thread:phoneThread})}),50);this.timer=setInterval(()=>{phoneTime=Math.min(105,phoneTime+1);phoneSequence++;this.onmessage?.({data:JSON.stringify({type:'playback',playback:phonePlayback()})})},1000)}close(){clearInterval(this.timer)}};
window.fetch=async(url,options)=>{const input=JSON.parse(options?.body||'{}'); if(url.startsWith('/api/private/')){let result={};
 if(url.endsWith('/hold')){phoneHold={id:'fixture-branch',content_version:'${phoneStory.content_version}',epoch:0,from_seconds:input.from_seconds,question_at_seconds:null};phoneBridge=null;phoneHelp=null;result={hold:phoneHold,playback:phonePlayback()};}
 if(url.endsWith('/ask')){phoneHold.question_at_seconds=input.at_seconds;if(input.new_topic)phoneThread=null;phoneHelp={id:'fixture-answer',request:input.request,at_seconds:input.at_seconds,moment:{...${JSON.stringify(phoneMoment)},grounding:{...${JSON.stringify(phoneMoment.grounding)},at_seconds:input.at_seconds}},evidence:[],quote:{id:'fixture-caption',at_seconds:input.at_seconds,text:'Sit still!'}};phoneBridge=null;result={...phoneHelp,hold:phoneHold,thread:phoneThread};}
 if(url.endsWith('/return')){phoneBridge={status:'ready',from_seconds:input.from_seconds,through_seconds:input.through_seconds,moment:{...${JSON.stringify(phoneMoment)},answer:'The instruction was to stay in one place without moving.',grounding:{...${JSON.stringify(phoneMoment.grounding)},at_seconds:input.through_seconds}},evidence:[]};phoneHold=null;phoneHelp=null;result=phoneBridge;}
 if(url.endsWith('/thread')){phoneThread=input.enabled?{id:'fixture-thread',answer_id:phoneHelp.id,question:phoneHelp.request,help:phoneHelp,revision:0,checked_through_seconds:phoneHelp.at_seconds,content_version:'${phoneStory.content_version}',epoch:0}:null;result={thread:phoneThread};}
 if(url.endsWith('/thread-check'))result={thread:phoneThread,updated:false};
 if(url.endsWith('/end')){phoneHold=null;phoneHelp=null;phoneBridge=null;phoneThread=null;}
 return {ok:true,json:async()=>result};} if(url==='/api/companion/moment')return {ok:true,json:async()=>(${JSON.stringify(moment)})};return {ok:true,json:async()=>({session_id:'ui-fixture',private_mirror_available:false})};};`;
const server=createServer(async(req,res)=>{
 if(req.url==='/preview.js'){res.setHeader('Content-Type','text/javascript');return res.end(js);}
 if(req.url==='/preview.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><style>#root{display:flex;flex-direction:column}#root>div:first-child{min-height:100%}</style><title>SELENE UI fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="selene-renderer-nonce" content="ui-fixture"><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script>'+bootstrap+'</script><script src="/preview.js"></script></body></html>');
});
server.listen(4518,'127.0.0.1',()=>console.log('Isolated UI fixtures: http://127.0.0.1:4518/?view=ask (home, empty, response, clarification, loading, error)'));
