import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DeviceRuntime} from '../../coffee-terminal/web/twin/devices/runtime.mjs';
import {prepareWorld} from '../../coffee-terminal/web/twin/devices/profile.mjs';
import {createGripperVisual} from '../../coffee-terminal/web/twin/gripper-visual.mjs';
const base=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-main-v2.json',import.meta.url)));
const config=JSON.parse(await readFile(new URL('../../config/twin/device-lab-v1.json',import.meta.url)));
const make=()=>{const c=structuredClone(config);for(const id of ['left-gripper','right-gripper'])Object.assign(c.devices[id].gripper,{maxOpeningMm:85,initialOpeningMm:85});return DeviceRuntime.create(base,c);};
const send=(r,id,action,parameters={},deviceId='left-gripper')=>r.submit({sessionId:r.sessionId,commandId:id,deviceId,action,parameters}).command;

test('gripper full stroke is 85 mm in two seconds and repeated IDs do not repeat motion',async()=>{
 const r=await make();assert.equal(r.device('left-gripper').state.openingMm,85);send(r,'close','close');r.advance(55);
 assert.equal(send(r,'busy','open').status,'REJECTED');assert.equal(r.device('left-gripper').state.mode,'running');
 assert.ok(Math.abs(r.device('left-gripper').state.openingMm-42.5)<1e-6);
 r.advance(50);const c=r.command('close');assert.equal(c.status,'SUCCEEDED');assert.equal(c.finishedAt-c.startedAt,2);assert.equal(r.device('left-gripper').state.openingMm,0);
 send(r,'open','open');r.advance(110);send(r,'close','close');assert.equal(r.device('left-gripper').state.openingMm,85);assert.equal(r.command('close').status,'SUCCEEDED');
 assert.equal(r.device('right-gripper').state.openingMm,85);
});

test('position and speed control, cancellation and fault preserve partial aperture, reset never opens unexpectedly',async()=>{
 const r=await make();send(r,'position','setOpening',{openingMm:25,speedMmS:20});r.advance(55);const partial=r.device('left-gripper').state.openingMm;
 assert.ok(Math.abs(partial-65)<1e-6);r.cancel('position',r.sessionId);r.advance(100);assert.equal(r.device('left-gripper').state.openingMm,partial);assert.equal(r.device('left-gripper').state.speedMmS,0);
 send(r,'again','close');r.advance(25);r.inject('left-gripper',{fault:'JAM'},r.sessionId);const stalled=r.device('left-gripper').state.openingMm;r.advance(100);assert.equal(r.command('again').status,'FAILED');assert.equal(r.device('left-gripper').state.openingMm,stalled);
 send(r,'reset','reset');r.advance(40);assert.equal(r.device('left-gripper').fault,null);assert.equal(r.command('reset').result.gripper.fault,null);assert.equal(r.command('reset').result.gripper.mode,'idle');assert.equal(r.device('left-gripper').state.openingMm,stalled);
 send(r,'resume','close');r.advance(25);send(r,'stop','stop');const stopped=r.device('left-gripper').state.openingMm;r.advance(100);assert.equal(r.command('resume').status,'CANCELLED');assert.equal(r.device('left-gripper').state.openingMm,stopped);
});

test('gripper parameters/configuration are validated before motion; old profiles remain accepted',async()=>{
 const r=await make();for(const parameters of [{openingMm:86},{openingMm:-1},{openingMm:40,speedMmS:0},{openingMm:40,speedMmS:1e-320},{openingMm:40,speedMmS:99}])assert.equal(send(r,crypto.randomUUID(),'setOpening',parameters).status,'REJECTED');
 const p=structuredClone(r.config.devices['left-gripper']);p.gripper.closingSpeedMmS=20;r.configure('left-gripper',p,r.sessionId);send(r,'slow','close');r.advance(250);assert.ok(Math.abs(r.command('slow').finishedAt-r.command('slow').startedAt-4.26)<1e-9);
 p.gripper.initialOpeningMm=90;const before=structuredClone(r.config);assert.throws(()=>r.configure('left-gripper',p,r.sessionId));assert.deepEqual(r.config,before);
 const legacy=structuredClone(config);delete legacy.devices['left-gripper'];delete legacy.devices['right-gripper'];assert.ok(prepareWorld(base,legacy));
 const duplicate=structuredClone(config);duplicate.devices['right-gripper'].gripper.robot='left';assert.throws(()=>prepareWorld(base,duplicate),/one gripper/);
});

test('robot and mounted tool exclude simultaneous commands, holding objects blocks jaw motion and exposes size/payload incompatibility',async()=>{
 const r=await make();send(r,'close','close');assert.equal(send(r,'robot','move',{station:'left-ready'},'left').reason,'TOOL_BUSY');
 send(r,'other','close',{},'right-gripper');assert.equal(r.command('other').status,'ACCEPTED');r.advance(110);
 r.sim.state.objects.cup.owner='left';r.sim.state.objects.cup.contents={test:2.1};
 assert.equal(send(r,'held','open').reason,'ROBOT_HOLDING_OBJECT');const sensors=r.actualSensors('left-gripper');assert.equal(sensors.heldObjectWidthMm,100);assert.equal(sensors.openingCompatible,false);assert.equal(sensors.payloadWithinLimit,false);
});

test('offline gripper still executes; query and sensor feedback recover after reconnect',async()=>{
 const r=await make();send(r,'close','close');r.inject('left-gripper',{online:false},r.sessionId);r.advance(110);assert.throws(()=>r.command('close'),e=>e.status===503);
 r.inject('left-gripper',{online:true},r.sessionId);assert.equal(r.command('close').status,'SUCCEEDED');assert.equal(r.device('left-gripper').state.openingMm,0);r.advance(5);assert.equal(r.device('left-gripper').sensors.atTarget,true);
});

test('visual jaw plates move symmetrically while the TCP group stays fixed',()=>{
 const visual=createGripperVisual(),initial=visual.group.position.toArray();visual.setState({openingMm:85});const open=visual.group.children.filter(c=>c.type==='Group').map(c=>c.position.x);
 visual.setState({openingMm:25});const closed=visual.group.children.filter(c=>c.type==='Group').map(c=>c.position.x);assert.equal(open.length,2);assert.ok(Math.abs((open[1]-open[0])-(closed[1]-closed[0])-.06)<1e-9);assert.deepEqual(visual.group.position.toArray(),initial);
});

test('120 mm simulation profile grasps a 100 mm cup only after closure, then opens before release',async()=>{
 const r=await DeviceRuntime.create(base,structuredClone(config));
 const run=(id,deviceId,action,parameters={})=>{send(r,id,action,parameters,deviceId);for(let i=0;i<400&&!['SUCCEEDED','FAILED','REJECTED'].includes(r.command(id).status);i++)r.advance(50);assert.equal(r.command(id).status,'SUCCEEDED',JSON.stringify(r.command(id)));};
 run('cup','cup-dispenser','dispense');run('approach','left','move',{station:'cups',approachObject:'cup'});
 send(r,'grasp','grasp',{object:'cup'},'left');r.advance(15);
 assert.equal(r.sim.state.objects.cup.owner,null);assert.ok(r.device('left-gripper').state.openingMm>100&&r.device('left-gripper').state.openingMm<120);
 r.advance(25);assert.equal(r.sim.state.objects.cup.owner,'left');assert.equal(r.device('left-gripper').state.openingMm,100);
 send(r,'release','release',{object:'cup',station:'cups'},'left');r.advance(15);assert.equal(r.sim.state.objects.cup.owner,'left');assert.ok(r.device('left-gripper').state.openingMm>100);
 r.advance(25);assert.equal(r.sim.state.objects.cup.owner,null);assert.equal(r.device('left-gripper').state.openingMm,120);
 run('close','left-gripper','close');send(r,'regrasp','grasp',{object:'cup'},'left');r.advance(55);assert.equal(r.sim.state.objects.cup.owner,null);assert.ok(r.device('left-gripper').state.openingMm<100);r.advance(150);assert.equal(r.sim.state.objects.cup.owner,'left');assert.equal(r.device('left-gripper').state.openingMm,100);
});

test('tool fault during robot grasp aborts the parent before attaching the object',async()=>{
 const r=await DeviceRuntime.create(base,structuredClone(config));
 send(r,'cup','dispense',{},'cup-dispenser');r.advance(100);send(r,'approach','move',{station:'cups',approachObject:'cup'},'left');for(let i=0;i<20&&r.command('approach').status!=='SUCCEEDED';i++)r.advance(50);
 send(r,'grasp','grasp',{object:'cup'},'left');r.advance(15);const opening=r.device('left-gripper').state.openingMm;r.inject('left-gripper',{fault:'JAM'},r.sessionId);r.advance(50);
 assert.equal(r.command('grasp').status,'FAILED');assert.equal(r.sim.state.objects.cup.owner,null);assert.equal(r.device('left-gripper').state.openingMm,opening);
});
