import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDeviceServer} from '../../scripts/twin_device_server.mjs';
import {request,submitCommand,runLatte} from '../../coffee-terminal/web/twin/devices/client.mjs';
const world=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-main-v2.json',import.meta.url)));
const defaults=JSON.parse(await readFile(new URL('../../config/twin/device-lab-v1.json',import.meta.url)));
async function start(){const config=structuredClone(defaults);config.clock={mode:'manual',rate:1};return createDeviceServer({world,config,port:0});}

test('HTTP contract supports status, lost ACK recovery, SSE, deduplication and stale-session rejection',async()=>{
 const service=await start(),url=service.url;const streamAbort=new AbortController();
 try{
  const initial=await request(url,'/api/state'),sessionId=initial.sessionId;
  assert.match(await (await fetch(url+'/device-lab.html')).text(),/虚拟设备联调台/);
  const stream=await fetch(url+'/api/events',{signal:streamAbort.signal});assert.equal(stream.headers.get('content-type'),'text/event-stream');
  const reader=stream.body.getReader(),first=await reader.read();assert.match(new TextDecoder().decode(first.value),/snapshot/);await reader.cancel();
  await request(url,'/api/devices/cup-dispenser/injection',{method:'POST',body:{sessionId,options:{dropNextAck:true}}});
  const command={sessionId,commandId:'lost-ack',deviceId:'cup-dispenser',action:'dispense',parameters:{}};
  assert.equal((await submitCommand(url,command)).status,'ACCEPTED');
  assert.equal((await request(url,'/api/commands',{method:'POST',body:command})).duplicate,true);
  await request(url,'/api/clock/advance',{method:'POST',body:{sessionId,ticks:100}});
  assert.equal((await request(url,'/api/commands/lost-ack')).status,'SUCCEEDED');
  assert.equal((await request(url,'/api/devices/cup-dispenser')).stock.amount,49);
  await assert.rejects(request(url,'/api/commands',{method:'POST',body:{...command,action:'reset'}}),e=>e.status===409);
  const before=await request(url,'/api/config');await assert.rejects(request(url,'/api/session/reset',{method:'POST',body:{sessionId,config:{schemaVersion:1}}}));
  assert.deepEqual(await request(url,'/api/config'),before);assert.equal((await request(url,'/api/state')).sessionId,sessionId);
  const reset=await request(url,'/api/session/reset',{method:'POST',body:{sessionId}});
  await assert.rejects(request(url,'/api/commands',{method:'POST',body:command}),e=>e.code==='SESSION_MISMATCH');assert.notEqual(reset.sessionId,sessionId);
 }finally{streamAbort.abort();await service.close();}
});

test('real-time service continues after clients close; queries and a fresh UI recover device result',async()=>{
 const service=await start(),url=service.url;
 try{
  const {sessionId}=await request(url,'/api/state');
  await request(url,'/api/commands',{method:'POST',body:{sessionId,commandId:'independent',deviceId:'cup-dispenser',action:'dispense'}});
  await request(url,'/api/clock',{method:'POST',body:{sessionId,clock:{mode:'accelerated',rate:16}}});
  const deadline=Date.now()+10000;let result;
  do{await new Promise(r=>setTimeout(r,100));result=await request(url,'/api/commands/independent');}while(result.status!=='SUCCEEDED'&&Date.now()<deadline);
  assert.equal(result.status,'SUCCEEDED');assert.equal((await request(url,'/api/state')).state.supplies['cup-dispenser-stock'].amount,49);
 }finally{await service.close();}
});

test('external HTTP planner completes a capped latte despite dropped confirmations and completion events',async()=>{
 const service=await start();
 try{
  const result=await runLatte(service.url,{scenario:'lost-notification'});
  assert.equal(result.completed,32);assert.equal(result.state.objects.cup.sealed,true);assert.equal(result.state.objects.cup.owner,null);
  assert.equal(result.state.supplies['cup-dispenser-stock'].amount,49);assert.equal(result.state.supplies['lidder-stock'].amount,49);
  assert.ok(Math.abs(Object.values(result.state.objects.cup.contents).reduce((a,b)=>a+b,0)-.22)<1e-8);
  const events=(await request(service.url,'/api/state')).events;
  assert.equal(result.state.status,'idle');
  await request(service.url,'/api/pickup',{method:'POST',body:{sessionId:result.sessionId}});
  assert.equal((await request(service.url,'/api/state')).state.objects.cup.present,false);
  assert.ok(events.length>0);
 }finally{await service.close();}
});
