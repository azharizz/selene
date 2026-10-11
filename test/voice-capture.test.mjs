import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
const built = await build({entryPoints:['src/VoiceCapture.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'microphone-boundary',setup(b){
  b.onResolve({filter:/^@amazon-devices\//},a=>({path:a.path,namespace:'device'}));
  b.onLoad({filter:/.*/,namespace:'device'},({path})=>({contents:path.includes('security-manager')?'export const SecurityManager=globalThis.security,PrivilegeState={ALLOW:1,DENY:0};':path.endsWith('AudioRecordStreamBuilder')?'export default globalThis.Builder;':'export const AudioChannelMask={CHANNEL_MONO:1},AudioSampleFormat={FORMAT_PCM_16_BIT:1},AudioSampleRate={SAMPLE_RATE_16_KHZ:16000},AudioSource={VOICE_RECOGNITION:1};'}));
}}]});
function fixture({allowed=false,grant=true,chunk=new Uint8Array(640000)}={}) {
  let constructed=0,destroyed=0,requests=0,readResolve;
  const stream={getMinBufferSizeInBytesAsync:async()=>4096,readAsync:()=>{if(chunk){const result=chunk;chunk=null;return Promise.resolve(result.buffer);}return new Promise(r=>{readResolve=r;});}};
  class Builder {constructor(){constructed++;}setAudioConfig(){}setAudioSource(){}async buildAsync(){return stream;}static async destroyAsync(){destroyed++;readResolve?.(new ArrayBuffer(0));}}
  const context={module:{exports:{}},Uint8Array,DataView,Error,security:{getPrivilegeState:async()=>allowed?1:0,requestPrivilege:async()=>{requests++;return grant?1:0;}},Builder};
  vm.runInNewContext(built.outputFiles[0].text,context);
  return {capture:new context.module.exports.VoiceCapture(),counts:()=>({constructed,destroyed,requests})};
}
test('OS microphone denial cannot open a stream; consent cancellation cannot request permission',async()=>{
  const denied=fixture({grant:false});
  await assert.rejects(denied.capture.start(()=>{},()=>{},async()=>true),/not granted/);
  await denied.capture.cancel();assert.deepEqual(denied.counts(),{constructed:0,destroyed:0,requests:1});
  const declined=fixture();await assert.rejects(declined.capture.start(()=>{},()=>{},async()=>false),/not granted/);
  await declined.capture.cancel();assert.deepEqual(declined.counts(),{constructed:0,destroyed:0,requests:0});
});
test('capture emits bounded mono PCM WAV and frees its stream before restart',async()=>{
  const f=fixture({chunk:new Uint8Array(700000).fill(17)});let limit=0;
  await f.capture.start(()=>limit++,error=>{throw error;},async()=>true);
  const wav=Buffer.from(await f.capture.stop(),'base64');
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt16LE(34),16);assert.equal(wav.readUInt32LE(40),640000);assert.equal(wav.length,640044);assert.equal(wav[44],17);assert.equal(limit,1);assert.equal(f.counts().destroyed,1);
});
test('cancel blocks restart until the pending privilege operation settles',async()=>{
  const f=fixture();let confirm,notify;
  const prompted=new Promise(resolve=>{notify=resolve;});
  const start=f.capture.start(()=>{},()=>{},()=>new Promise(resolve=>{confirm=resolve;notify();}));
  await prompted;const cancel=f.capture.cancel();const second=f.capture.cancel();assert.equal(cancel,second);
  assert.throws(()=>f.capture.start(()=>{},()=>{},async()=>true),/still closing/);
  confirm(true);await start;await cancel;assert.deepEqual(f.counts(),{constructed:0,destroyed:0,requests:0});
  await f.capture.start(()=>{},()=>{},async()=>true);await f.capture.cancel();assert.equal(f.counts().destroyed,1);
});
