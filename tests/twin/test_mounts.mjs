import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DeviceRuntime} from '../../coffee-terminal/web/twin/devices/runtime.mjs';
import {prepareWorld} from '../../coffee-terminal/web/twin/devices/profile.mjs';
import {poseMount,installationPose,identity} from '../../coffee-terminal/web/twin/mounts.mjs';
import {relative,compose,fk} from '../../coffee-terminal/web/twin/robot.mjs';
const base=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-main-v2.json',import.meta.url)));
const config=JSON.parse(await readFile(new URL('../../config/twin/device-lab-v1.json',import.meta.url)));
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8,`${a} != ${b}`));
const make=()=>DeviceRuntime.create(base,structuredClone(config));
const mount=(r,id)=>({...structuredClone(r.config.devices[id]),mounting:structuredClone(r.sim.config.installation.mounts[id])});

test('legacy installation preserves exact stations and obstacles, and parent replacement preserves world pose',()=>{
 const w=prepareWorld(base,config);assert.deepEqual(w.stations,base.stations);assert.deepEqual(w.obstacles,base.obstacles);
 const c=structuredClone(config);c.devices.brewer.mounting=poseMount('world',w.installation.nodes.brewer.pose);const next=prepareWorld(base,c);assert.deepEqual(next.stations,w.stations);assert.deepEqual(next.obstacles,w.obstacles);
});
test('parent translation and rotation propagate through children, stations and collision proxies',()=>{
 const c=structuredClone(config),w=prepareWorld(base,c);
 c.devices['hot-water'].mounting=poseMount('brewer',relative(w.installation.nodes.brewer.pose,w.installation.nodes['hot-water'].pose));
 c.devices.brewer.mounting=structuredClone(w.installation.mounts.brewer);c.devices.brewer.mounting.position[0]+=.05;c.devices.brewer.mounting.rotationDeg[2]=10;
 const moved=prepareWorld(base,c),delta=moved.installation.deltas.brewer;
 near(moved.stations.water.pose.position,compose(delta,w.stations.water.pose).position);
 near(moved.obstacles.find(o=>o.id==='water-head').pose.position,compose(delta,w.obstacles.find(o=>o.id==='water-head').pose).position);
});
test('cycles, missing parents and invalid poses are rejected without mutating the live configuration',async()=>{
 const r=await make(),before=r.snapshot();for(const parent of ['missing','brewer','left:flange']){const p=mount(r,'brewer');p.mounting.parent=parent;assert.throws(()=>r.configure('brewer',p,r.sessionId));}
 const p=mount(r,'brewer');p.mounting.position[0]=NaN;assert.throws(()=>r.configure('brewer',p,r.sessionId));assert.deepEqual(r.snapshot(),before);
 const c=structuredClone(config),w=r.sim.config;c.devices.brewer.mounting={...w.installation.mounts.brewer,parent:'hot-water'};c.devices['hot-water'].mounting={...w.installation.mounts['hot-water'],parent:'brewer'};assert.throws(()=>prepareWorld(base,c),/cycle/);
});
test('layout edits apply atomically, move resting objects and reject collisions, unreachable workpoints and active commands',async()=>{
 const r=await make(),p=mount(r,'foamer');p.mounting.position[0]+=.02;r.configure('foamer',p,r.sessionId);
 near(r.sim.state.objects['milk-cup'].pose.position,r.sim.config.stations.milk.pose.position);assert.equal(r.installationRevision,1);
 const old=r.snapshot(),bad=mount(r,'foamer');bad.mounting.position[0]-=.7;assert.throws(()=>r.configure('foamer',bad,r.sessionId));assert.deepEqual(r.snapshot(),old);
 bad.mounting.position[0]=10;assert.throws(()=>r.configure('foamer',bad,r.sessionId),e=>e.code==='INSTALLATION_UNREACHABLE');assert.deepEqual(r.snapshot(),old);
 r.submit({sessionId:r.sessionId,commandId:'drop',deviceId:'cup-dispenser',action:'dispense',parameters:{}});assert.throws(()=>r.configure('foamer',p,r.sessionId),e=>e.code==='DEVICE_BUSY');
});
test('flange mount follows robot rotation, tool offset changes TCP, and reset/export retains mounting',async()=>{
 const r=await make(),p=mount(r,'left-gripper');p.mounting.position[2]=.003;r.configure('left-gripper',p,r.sessionId);
 const world=r.sim.config,first=installationPose(world,r.sim.state,'left-gripper');r.sim.state.robots.left.q[0]+=.1;
 const moved=installationPose(world,r.sim.state,'left-gripper'),flange=fk({...world.robots.left,tool:identity()},r.sim.state.robots.left.q);near(moved.position,compose(flange,{position:[0,0,.003],quaternion:[0,0,0,1]}).position);assert.notDeepEqual(moved.position,first.position);
 const saved=structuredClone(r.config);await r.reset(saved);assert.deepEqual(r.config.devices['left-gripper'].mounting,p.mounting);near(r.sim.config.robots.left.tool.position,[0,0,.123]);
 const before=r.snapshot(),bad=mount(r,'left-gripper');bad.mounting.position[2]=10;assert.throws(()=>r.configure('left-gripper',bad,r.sessionId),e=>e.code==='INSTALLATION_UNREACHABLE');assert.deepEqual(r.snapshot(),before);
});

test('invalid imported layout preserves session, and a held object prevents installation edits',async()=>{
 const r=await make(),before=r.snapshot(),c=structuredClone(config);c.devices.foamer.mounting={parent:'world',position:[10,0,1],rotationDeg:[0,0,0]};await assert.rejects(()=>r.reset(c));assert.deepEqual(r.snapshot(),before);
 r.sim.state.objects.cup.owner='left';const p=mount(r,'left-gripper');p.mounting.position[2]=.003;assert.throws(()=>r.configure('left-gripper',p,r.sessionId),e=>e.code==='INSTALLATION_HOLDING_OBJECT');
});
test('mounted tool grasp follows TCP, and release preserves the last world pose',async()=>{
 const r=await make(),p=mount(r,'left-gripper');p.mounting.position[2]=.003;r.configure('left-gripper',p,r.sessionId);
 const run=(id,deviceId,action,parameters={})=>{r.submit({sessionId:r.sessionId,commandId:id,deviceId,action,parameters});for(let n=0;n<20&&!['SUCCEEDED','FAILED','REJECTED'].includes(r.command(id).status);n++)r.advance(500);assert.equal(r.command(id).status,'SUCCEEDED',JSON.stringify(r.command(id)));};
 run('drop','cup-dispenser','dispense');run('move','left','move',{station:'cups',approachObject:'cup'});run('grasp','left','grasp',{object:'cup'});
 const attached=r.sim.state.objects.cup;near(attached.pose.position,compose(fk(r.sim.config.robots.left,r.sim.state.robots.left.q),attached.attachment).position);
 const before=structuredClone(attached.pose);run('release','left','release',{object:'cup',station:'cups'});assert.equal(r.sim.state.objects.cup.owner,null);assert.deepEqual(r.sim.state.objects.cup.pose,before);
});
