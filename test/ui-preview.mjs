// Test-only visual harness. It bundles the actual components, never ships in assets,
// and substitutes only native transport/network boundaries. No provider/model claim.
import {build} from 'esbuild';
import {createServer} from 'node:http';
const snapshot = {package_id: 'test.player', session_id: 7, catalog_name: 'test', content_id: 'kite', title: 'The Red Kite', provider_name: 'UI test player', at_seconds: 36};
const playback = {state: 'playing', can_pause: true, can_play: true, revision: 1, observing: false};
const moment = {state: 'response', answer: 'From your description, Arun wants to repair the kite because it reminds him of his father. Keeping it matters more to him than replacing it.',
  visual: {status: 'ready', description: 'Arun connects the old kite with memories of his father.', animations: [], svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#202228"/><text x="60" y="95" font-size="48" fill="#f1f1f1">From your description</text><rect x="60" y="175" width="335" height="200" rx="16" fill="#303238"/><text x="105" y="265" font-size="56" fill="#f1f1f1">Old kite</text><text x="105" y="330" font-size="48" fill="#b9bdc6">Arun keeps it</text><path d="M420 275H510" stroke="#ffad33" stroke-width="6"/><path d="m500 260 24 15-24 15" fill="#ffad33"/><rect x="550" y="175" width="350" height="200" rx="16" fill="#303238"/><text x="585" y="265" font-size="56" fill="#f1f1f1">His father</text><text x="585" y="330" font-size="48" fill="#b9bdc6">A memory</text></svg>'},
  intervention: {playback: 'offer_choice', audio: 'silent'}, life_connection: {offered: false, question: '', recipient: 'everyone'}};
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {CompanionMoment} from './web/CompanionMoment'; import {Companion} from './src/Companion'; import './web/style.css';
const params=new URLSearchParams(location.search), view=params.get('view')||'ask';
const snapshot=${JSON.stringify(snapshot)}, playback=${JSON.stringify(playback)}, moment=${JSON.stringify(moment)};
class NativePreview extends Companion {componentDidMount(){this.mounted=true;} }
const ref=React.createRef();
class Preview extends React.Component {
 componentDidMount(){const app=ref.current; if(view==='home'||view==='empty') {
   const sessions=Array.from({length:view==='empty'?0:8},(_,i)=>({packageId:'test.player.'+i,title:['The Red Kite','Offside Practice','A longer title to check truncation on television screens'][i%3],providerName:'UI test player',state:{id:{id:i},playbackState:{playbackStatus:'PLAYING'},capabilities:{actions:[]}}}));
   app.setState({sessions,busy:false,message:sessions.length?'Choose what you’re watching.':'No shared playback found. Start a title in a supported app, then try again.'});
 } else {app.sessionId='ui-fixture'; if(view==='response'||view==='life-response')app.setState({screen:'moment',moment:view==='life-response'?{...moment,life_connection:{offered:true,question:'Is there something you’ve kept because of the person who gave it to you?',recipient:'everyone'}}:moment,lifeStarted:view==='life-response',playback:view==='life-response'?{...playback,state:'paused'}:playback,choice:view==='life-response'?'pause_to_explore':'unspecified'});
 if(view==='clarification')app.setState({screen:'ask',clarifying:true,moment:{...moment,state:'clarification',answer:'What did the person say just before that?'},lastInput:null});
 if(view==='loading')app.setState({screen:'loading'}); if(view==='error')app.setState({error:'The playback app stopped sharing this session. Close this moment and try again.'});}}
 render(){return <>{view==='home'||view==='empty'?<NativePreview ref={ref} onReady={()=>{}} onDemo={()=>location.href='http://127.0.0.1:4519'}/>:<CompanionMoment ref={ref} initial={{snapshot,playback}}/>}<div style={{position:'fixed',bottom:2,right:12,fontSize:12,color:'#b9bdc6',pointerEvents:'none'}}>UI TEST FIXTURE · no live playback or model</div></>}
}
createRoot(document.getElementById('root')).render(<Preview/>);`;
const nativeShim = `import React from 'react';
const css=(styles)=>{const s=Object.assign({},...[styles].flat(Infinity).filter(Boolean)); for(const [key,a,b] of [['paddingHorizontal','paddingLeft','paddingRight'],['paddingVertical','paddingTop','paddingBottom'],['marginVertical','marginTop','marginBottom']])if(key in s){s[a]=s[key];s[b]=s[key];delete s[key];} if(typeof s.lineHeight==='number')s.lineHeight=s.lineHeight+'px'; if(Array.isArray(s.transform))s.transform=s.transform.map(t=>'scale('+t.scale+')').join(' ');return s};
export const StyleSheet={create:s=>s}; export const AppState={addEventListener:()=>({remove(){}})}, BackHandler=AppState;
export function View({style,children}){return <div style={{display:'flex',flexDirection:'column',minWidth:0,minHeight:0,...css(style)}}>{children}</div>}
export function Text({style,children,numberOfLines}){return <span style={{display:numberOfLines?' -webkit-box'.trim():'block',WebkitLineClamp:numberOfLines,WebkitBoxOrient:'vertical',overflow:'hidden',...css(style)}}>{children}</span>}
export function Image({source,style}){return <img src={source} style={css(style)}/>}
export function Pressable({children,style,onPress,onFocus,onBlur,disabled,accessibilityLabel,hasTVPreferredFocus}){return <button aria-label={accessibilityLabel} autoFocus={hasTVPreferredFocus} disabled={disabled} onClick={onPress} onFocus={onFocus} onBlur={onBlur} style={{textAlign:'left',display:'flex',flexDirection:'column',...css(style)}}>{children}</button>}`;
const output = await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'preview',platform:'browser',format:'iife',loader:{'.png':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-native-boundary',setup(b){
 b.onResolve({filter:/^react-native$/},()=>({path:'native',namespace:'test'}));
 b.onResolve({filter:/^@amazon-devices\/(webview|kepler-media-controls)$/},()=>({path:'sdk',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},({path})=>({contents:path==='native'?nativeShim:'export const WebView=()=>null; export const MediaControlComponentAsync={makeMediaControlEndpointLocator:()=>({getMediaControlEndpoints:async()=>[]})};',loader:'tsx',resolveDir:process.cwd()}));
}}]});
const js=output.outputFiles.find(f=>f.path.endsWith('.js')).contents, css=output.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const bootstrap = `let playback=${JSON.stringify(playback)}; window.ReactNativeWebView={postMessage(raw){const msg=JSON.parse(raw);if(msg.action==='close'){location.href='/?view=home';return;}if(['play','pause','refresh'].includes(msg.action)){if(msg.action!=='refresh')playback={...playback,state:msg.action==='pause'?'paused':'playing',revision:playback.revision+1};queueMicrotask(()=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{type:'selene:playback',id:msg.id,playback}})));}}};
window.fetch=async(url,options)=>{const input=JSON.parse(options?.body||'{}'); if(url==='/api/companion/moment')return {ok:true,json:async()=>({...${JSON.stringify(moment)},life_connection:input.life_connection?{offered:true,recipient:input.recipient,question:'Is there something you’ve kept because of the person who gave it to you?'}:${JSON.stringify(moment.life_connection)}})};return {ok:true,json:async()=>({session_id:'ui-fixture',private_mirror_available:false})};};`;
const server=createServer(async(req,res)=>{
 if(req.url==='/preview.js'){res.setHeader('Content-Type','text/javascript');return res.end(js);}
 if(req.url==='/preview.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><style>#root{display:flex;flex-direction:column}#root>div:first-child{min-height:100%}</style><title>SELENE UI fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="selene-renderer-nonce" content="ui-fixture"><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script>'+bootstrap+'</script><script src="/preview.js"></script></body></html>');
});
server.listen(4518,'127.0.0.1',()=>console.log('Isolated UI fixtures: http://127.0.0.1:4518/?view=ask (home, empty, response, clarification, loading, error, life-response)'));
