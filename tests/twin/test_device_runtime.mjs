import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DeviceRuntime} from '../../coffee-terminal/web/twin/devices/runtime.mjs';
import {prepareWorld} from '../../coffee-terminal/web/twin/devices/profile.mjs';
const base=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-main-v2.json',import.meta.url)));
const defaults=JSON.parse(await readFile(new URL('../../config/twin/device-lab-v1.json',import.meta.url)));
const create=async change=>{const c=structuredClone(defaults);c.clock={mode:'manual',rate:1};change?.(c);return DeviceRuntime.create(base,c);};
const submit=(r,id,deviceId,action,parameters={},extra={})=>r.submit({sessionId:r.sessionId,commandId:id,deviceId,action,parameters,...extra}).command;
const advance=(r,seconds)=>{let ticks=Math.ceil(seconds/r.sim.config.dt);while(ticks){const n=Math.min(ticks,500);r.advance(n);ticks-=n;}};

test('device configuration rejects invalid timing, capacity, references and wrong clocks before mutation',async()=>{
 const r=await create(),before=structuredClone(r.config),p=structuredClone(before.devices.foamer);p.timing.durationSeconds=-1;
 assert.throws(()=>r.configure('foamer',p,r.sessionId),/timing/);assert.deepEqual(r.config,before);
 const c=structuredClone(defaults);c.clock.rate=2;assert.throws(()=>prepareWorld(base,c),/rate=1/);
 c.clock.rate=1;c.devices['cup-dispenser'].stock.initial=101;assert.throws(()=>prepareWorld(base,c),/stock/);
});

test('dispense is idempotent, consumes one cup, exposes a delayed outlet signal and refuses a second occupied outlet',async()=>{
 const r=await create(c=>{c.devices['cup-dispenser'].timing.sensorDelaySeconds=.5;});
 submit(r,'one','cup-dispenser','dispense');r.advance(65);
 assert.equal(r.command('one').status,'SUCCEEDED');assert.equal(r.sim.state.objects.cup.present,true);
 assert.equal(r.device('cup-dispenser').sensors.cupPresent,false);
 advance(r,.6);assert.equal(r.device('cup-dispenser').sensors.cupPresent,true);
 for(let i=0;i<3;i++)assert.equal(r.submit({sessionId:r.sessionId,commandId:'one',deviceId:'cup-dispenser',action:'dispense'}).duplicate,true);
 assert.equal(r.sim.state.supplies['cup-dispenser-stock'].amount,49);
 assert.throws(()=>submit(r,'one','cup-dispenser','reset'),/different parameters/);
 submit(r,'two','cup-dispenser','dispense',{}, {startWithinSeconds:.5});advance(r,1);
 assert.equal(r.command('two').status,'EXPIRED');assert.equal(r.sim.state.supplies['cup-dispenser-stock'].amount,49);
});

test('jam fails without duplicating consumption, reset clears fault but never retries a failed command',async()=>{
 const r=await create();r.inject('cup-dispenser',{faultAfterSeconds:.2},r.sessionId);
 submit(r,'jam','cup-dispenser','dispense');advance(r,1);
 assert.equal(r.command('jam').status,'FAILED');assert.equal(r.sim.state.objects.cup.present,false);
 assert.deepEqual(r.sim.state.supplies['cup-dispenser-stock'],{amount:50,reserved:0,consumed:0});
 submit(r,'repair','cup-dispenser','reset');advance(r,1);
 assert.equal(r.command('repair').status,'SUCCEEDED');assert.equal(r.device('cup-dispenser').fault,null);assert.equal(r.command('jam').status,'FAILED');
 submit(r,'retry-new','cup-dispenser','dispense');advance(r,2);assert.equal(r.command('retry-new').status,'SUCCEEDED');
});

test('dose command owns its container; shortage waits, refill resumes, cancellation retains partial output',async()=>{
 const r=await create(c=>{c.materials['milk-stock'].amount=.01;});
 submit(r,'foam','foamer','process',{object:'milk-cup',amountKg:.09});advance(r,4);
 assert.equal(r.command('foam').status,'ACCEPTED');assert.equal(r.command('foam').reason,'insufficient_material');
 r.refill('milk-stock',1,r.sessionId);advance(r,2);
 const used=r.sim.state.materials['milk-stock'].consumed;assert.ok(used>0&&used<.09);
 r.cancel('foam',r.sessionId);advance(r,1);
 assert.equal(r.command('foam').status,'CANCELLED');assert.equal(r.sim.state.materials['milk-stock'].reserved,0);assert.equal(r.sim.state.materials['milk-stock'].consumed,used);
});

test('disconnect hides feedback but does not stop a device; lost completion remains queryable and sensor overrides stay separate from physical state',async()=>{
 const r=await create();submit(r,'foam','foamer','process',{object:'milk-cup'});advance(r,4);
 r.inject('foamer',{online:false},r.sessionId);assert.throws(()=>r.command('foam'),/Reconnect/);
 assert.throws(()=>submit(r,'foam','foamer','process',{object:'milk-cup'}),e=>e.status===503);
 advance(r,20);assert.equal(r.sim.state.objects['milk-cup'].contents.foamer>.179,true);
 r.inject('foamer',{online:true},r.sessionId);assert.equal(r.command('foam').status,'SUCCEEDED');
 await r.reset();r.inject('foamer',{dropNextCompletion:true,forcedSensors:{ready:false}},r.sessionId);
 submit(r,'lost','foamer','process',{object:'milk-cup'});advance(r,24);
 assert.equal(r.command('lost').status,'SUCCEEDED');assert.equal(r.device('foamer').sensors.ready,false);
 assert.equal(r.drain().some(e=>e.type==='command.updated'&&e.command.commandId==='lost'&&e.command.status==='SUCCEEDED'),false);
 assert.equal(r.sim.state.devices.foamer.mode,'idle');
});

test('only supported cancellation is accepted, start deadline does not abort running work, session reset rejects stale commands',async()=>{
 const r=await create();submit(r,'cup','cup-dispenser','dispense',{}, {startWithinSeconds:.3});advance(r,.4);
 assert.equal(r.command('cup').status,'RUNNING');assert.throws(()=>r.cancel('cup',r.sessionId),/cannot be cancelled/);
 advance(r,2);assert.equal(r.command('cup').status,'SUCCEEDED');
 const session=r.sessionId;await r.reset();assert.notEqual(r.sessionId,session);
 assert.throws(()=>r.submit({sessionId:session,commandId:'cup',deviceId:'cup-dispenser',action:'dispense'}),/new sessionId/);
});

test('busy configuration changes and malformed commands preserve device state',async()=>{
 const r=await create();submit(r,'a','foamer','process',{object:'milk-cup'});
 const profile=structuredClone(r.config.devices.foamer);profile.timing.durationSeconds=4;
 assert.throws(()=>r.configure('foamer',profile,r.sessionId),/all commands/);
 assert.equal(submit(r,'b','foamer','process',{object:'milk-cup'}).reason,'DEVICE_BUSY');
 assert.equal(submit(r,'c','left','move',{station:'missing'}).status,'REJECTED');
 assert.equal(r.config.devices.foamer.timing.durationSeconds,16);
 r.cancel('a',r.sessionId);r.configure('foamer',profile,r.sessionId);
 submit(r,'d','foamer','process',{object:'milk-cup'});advance(r,8);assert.equal(r.command('d').status,'SUCCEEDED');
 assert.equal(r.command('d').finishedAt-r.command('d').startedAt,4);
});
