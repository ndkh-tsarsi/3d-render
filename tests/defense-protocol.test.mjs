import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createCatDefenseClient} from '../packages/cat-defense-sdk/index.js';
import {NAMESPACE,PROTOCOL_VERSION,makeEnvelope,randomId} from '../packages/cat-defense-sdk/protocol.js';
import {createGameBridge,PROTOCOL_VERSION as BRIDGE_VERSION,NAMESPACE as BRIDGE_NAMESPACE} from '../game/cat-defense/bridge.js';

class Surface {
  listeners = new Map();
  crypto = webcrypto;
  console = console;
  setTimeout = setTimeout;
  clearTimeout = clearTimeout;
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  dispatch(type,event){for(const fn of this.listeners.get(type)??[])fn(event);}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function sdkFixture(timeoutMs=500){
  const host=new Surface();host.location={href:'https://portal.example/play'};
  const sent=[];
  const frame=new Surface();frame.ownerDocument={defaultView:host};
  frame.contentWindow={postMessage:(data,targetOrigin)=>sent.push({data,targetOrigin})};
  const client=createCatDefenseClient({iframe:frame,gameUrl:'https://game.example/index.html',timeoutMs});
  const channel=new URL(frame.src).searchParams.get('channelId');
  const deliver=(data,extra={})=>host.dispatch('message',{origin:'https://game.example',source:frame.contentWindow,data,...extra});
  const message=(kind,type,payload,extra={})=>makeEnvelope(channel,kind,type,payload,{instanceId:'instance-1',...extra});
  const ready=()=>deliver(message('event','ready',{status:'ready',runId:null}));
  return {host,frame,sent,client,channel,deliver,message,ready};
}
test('game and SDK use the same versioned namespace',()=>{assert.equal(NAMESPACE,BRIDGE_NAMESPACE);assert.equal(PROTOCOL_VERSION,BRIDGE_VERSION);});
test('channel IDs work on LAN HTTP without secure-context randomUUID',()=>{
  const provider={getRandomValues:values=>webcrypto.getRandomValues(values)};
  assert.match(randomId(provider),/^[a-f0-9]{32}$/);
  assert.notEqual(randomId(provider),randomId(provider));
});
test('SDK authenticates source/origin/channel and correlates command receipts',async()=>{
  const f=sdkFixture();
  const event=f.message('event','ready',{status:'ready'});
  f.deliver(event,{origin:'https://evil.example'});assert.equal(f.client.connected,false);
  f.deliver(event,{source:{}});assert.equal(f.client.connected,false);
  f.deliver({...event,channelId:'wrong'});assert.equal(f.client.connected,false);
  f.ready();await f.client.ready();assert.equal(f.client.connected,true);
  const task=f.client.fire({target:{x:.6,y:.5}});await tick();
  const {data,targetOrigin}=f.sent.at(-1);assert.equal(targetOrigin,'https://game.example');assert.equal(data.type,'fire');
  assert.deepEqual(data.payload,{target:{x:.6,y:.5}});
  f.deliver(f.message('response','fire',{accepted:true},{requestId:data.requestId,ok:true}));
  assert.deepEqual(await task,{accepted:true});
  f.client.destroy();assert.equal(f.host.listeners.get('message').size,0);assert.equal(f.frame.listeners.get('load').size,0);
});
test('SDK rejects errors, reloads, timeouts and disposal without leaking requests',async()=>{
  const f=sdkFixture(100);f.ready();await f.client.ready();
  const invalid=f.client.configure({enemySpeed:NaN});await tick();
  f.deliver(f.message('response','configure',undefined,{requestId:f.sent.at(-1).data.requestId,ok:false,error:{code:'INVALID_COMMAND',message:'Invalid speed'}}));
  await assert.rejects(invalid,/Invalid speed/);
  const reloaded=f.client.getState();await tick();f.deliver(f.message('event','ready',{status:'ready'},{instanceId:'instance-2'}));
  await assert.rejects(reloaded,/reloaded/);
  await assert.rejects(f.client.getState(),/timed out/);
  const disposed=f.client.getState();await tick();f.client.destroy();await assert.rejects(disposed,/destroyed/);
  await assert.rejects(f.client.start(),/destroyed/);
});
test('SDK rejects insecure URL configurations and surfaces game asset load errors',async()=>{
  const f=sdkFixture();f.client.destroy();
  assert.throws(()=>createCatDefenseClient({iframe:f.frame,gameUrl:'javascript:alert(1)'}),/HTTP/);
  assert.throws(()=>createCatDefenseClient({iframe:f.frame,gameUrl:'https://game.example',allowedOrigin:'https://other.example'}),/allowedOrigin/);
  const next=sdkFixture();next.deliver(next.message('event','loadError',{message:'Missing atlas'}));await assert.rejects(next.client.ready(),/Missing atlas/);next.client.destroy();
});
test('SDK recovers commands after a failed initial load and announces each instance once',async()=>{
  const f=sdkFixture();let announcements=0;f.client.on('ready',()=>announcements++);
  f.deliver(f.message('event','loadError',{message:'Missing atlas'}));
  await assert.rejects(f.client.ready(),/Missing atlas/);
  f.ready();f.ready();await f.client.ready();assert.equal(announcements,1);
  const command=f.client.getState();await tick();
  f.deliver(f.message('response','getState',{status:'ready'},{requestId:f.sent.at(-1).data.requestId,ok:true}));
  assert.equal((await command).status,'ready');f.client.destroy();
  await assert.rejects(f.client.ready(),/destroyed/);
});
function bridgeFixture(){
  const host=new Surface();const sent=[];const calls=[];
  host.location={href:'https://game.example/?embed=1&parentOrigin=https%3A%2F%2Fportal.example&channelId=channel-1'};
  host.parent={postMessage:(data,targetOrigin)=>sent.push({data,targetOrigin})};
  let score=0;
  const game={getState:()=>({status:'ready',score}),execute:async(type,payload)=>{calls.push({type,payload});if(type==='explode')throw new Error('Bad explosion');if(type==='setScore')score=payload.score;return game.getState();},destroy:()=>calls.push({type:'destroy'})};
  const bridge=createGameBridge({game,hostWindow:host});bridge.announce();
  const instanceId=sent[0].data.instanceId;
  const request=(type,payload={},requestId='request-1')=>({namespace:NAMESPACE,version:1,channelId:'channel-1',instanceId,kind:'request',type,payload,requestId});
  const deliver=(data,extra={})=>host.dispatch('message',{origin:'https://portal.example',source:host.parent,data,...extra});
  return {host,sent,calls,bridge,request,deliver};
}
test('bridge ignores foreign messages and deduplicates side effects by requestId',async()=>{
  const f=bridgeFixture();
  const req=f.request('fire');f.deliver(req,{origin:'https://other.example'});f.deliver(req,{source:{}});f.deliver({...req,version:2});f.deliver({...req,instanceId:'old'});
  await tick();assert.equal(f.calls.length,0);
  f.deliver(req);f.deliver(req);await tick();assert.equal(f.calls.length,1);
  assert.equal(f.sent.filter(x=>x.data.kind==='response').length,2);
  assert.ok(f.sent.every(x=>x.targetOrigin==='https://portal.example'));
  f.bridge.destroy();
});
test('bridge init carries only run context and emits structured command failures',async()=>{
  const f=bridgeFixture();
  const result=await f.bridge.api.init({player:{id:'1',displayName:'Tester'},rules:{autoFire:false},runId:'run-123'});
  assert.equal(result.runId,'run-123');assert.deepEqual(f.calls.map(x=>x.type),['configure','setPlayer']);
  f.bridge.publish('scoreRequested',{enemyId:'enemy-1',points:100});
  assert.equal(f.sent.at(-1).data.payload.runId,'run-123');
  f.deliver(f.request('explode',{x:.5,y:.5},'bad-explosion'));await tick();
  assert.equal(f.sent.at(-1).data.ok,false);assert.match(f.sent.at(-1).data.error.message,/Bad explosion/);
  await assert.rejects(f.bridge.api.init({token:'secret'}),/Unknown init/);
  await assert.rejects(f.bridge.api.init({runId:'bad id'}),/runId/);
  await assert.rejects(f.bridge.api.execute('not-a-command'),/Unknown/);
  f.bridge.destroy();assert.equal(f.host.listeners.get('message').size,0);
});
