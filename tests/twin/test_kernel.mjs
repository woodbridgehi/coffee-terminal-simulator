import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Simulation} from '../../coffee-terminal/web/twin/kernel.mjs';
import {latteTasks} from '../../coffee-terminal/web/twin/recipes.mjs';
import {validateWorld,validateGraph} from '../../coffee-terminal/web/twin/schema.mjs';
import {fk,ik,trajectory} from '../../coffee-terminal/web/twin/robot.mjs';
const world=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-v1.json',import.meta.url)));
const near=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const processTask={id:'foam',type:'process',after:[],resources:[],device:'foamer',object:'milk-cup'};
function conservation(sim) {
  const s=sim.state;
  for(const [id,m] of Object.entries(s.materials)){near(world.materials[id].amount+m.added,m.amount+m.consumed);assert.ok(m.amount>=-1e-9&&m.reserved>=-1e-9&&m.reserved<=m.amount+1e-9);}
  const consumed=Object.values(s.materials).reduce((a,m)=>a+m.consumed,0),contents=Object.values(s.objects).reduce((sum,o)=>sum+Object.values(o.contents).reduce((a,b)=>a+b,0),0);
  near(consumed,contents+s.wasteKg);
}
test('scene rejects invalid units, joints, cycles and broken references',()=>{
  assert.throws(()=>validateWorld({...world,coordinates:'Y_UP'}),/coordinates/);
  const bad=structuredClone(world);bad.robots.left.limits[0].velocity=0;assert.throws(()=>validateWorld(bad),/limits/);
  assert.throws(()=>validateGraph([{id:'x',type:'wait',duration:1,resources:[],after:['x']}],world),/cycle/);
  assert.throws(()=>validateGraph([{...processTask,device:'missing'}],world),/device/);
});
test('full-pose IK recovers reachable poses and rejects unreachable targets',()=>{
  for(const r of Object.values(world.robots)){
    const q=r.home.map((v,i)=>v+(i%2?.1:-.1)),target=fk(r,q),solved=fk(r,ik(r,target,r.home));
    target.position.forEach((v,i)=>near(v,solved.position[i],1e-4));
    const dot=target.quaternion.reduce((s,v,i)=>s+v*solved.quaternion[i],0);near(Math.abs(dot),1,1e-6);
    assert.throws(()=>ik(r,{position:[100,100,100],quaternion:[0,0,0,1]}),/IK_UNREACHABLE/);
  }
});
test('joint trajectories obey limits and continuous rest-to-rest v/a/jerk bounds',()=>{
  const r=world.robots.left,end=r.home.map(v=>v+.8),t=trajectory(r,r.home,end,world.dt);
  assert.deepEqual(t.sample(0).q,r.home);assert.deepEqual(t.sample(t.ticks).q,end);
  for(let i=0;i<6;i++) {const d=Math.abs(end[i]-r.home[i]),l=r.limits[i];assert.ok(1.875*d/t.duration<=l.velocity);assert.ok(5.773502692*d/t.duration**2<=l.acceleration);assert.ok(60*d/t.duration**3<=l.jerk);}
  assert.throws(()=>trajectory(r,r.home,[100,...end.slice(1)],world.dt),/JOINT_LIMIT/);
});
test('complete dual-arm latte is collision-free, conserves material and serves cup',async()=>{
  const sim=await Simulation.create(world,latteTasks());const result=sim.run();
  assert.equal(result.status,'completed');assert.equal(result.done,25);assert.equal(sim.events.some(e=>e.type.startsWith('collision.')),false);
  conservation(sim);near(Object.values(sim.state.objects.cup.contents).reduce((a,b)=>a+b,0),.22);
  near(Object.values(sim.state.objects['milk-cup'].contents).reduce((a,b)=>a+b,0),0);
  sim.state.objects.cup.pose.position.forEach((v,i)=>near(v,world.stations.pickup.pose.position[i],.015));assert.equal(sim.state.objects.cup.owner,null);
  assert.ok(sim.state.tasks.foam.startedAt<sim.state.tasks.extract.finishedAt);
  for(const frame of sim.trace)for(const r of Object.values(frame.robots))assert.ok(r.q.every(Number.isFinite));
});
test('serial versus parallel changes makespan, not product or material consumption',async()=>{
  const serial=await Simulation.create(world,latteTasks(),{policy:'serial',record:false}),parallel=await Simulation.create(world,latteTasks(),{record:false});
  const a=serial.run(),b=parallel.run();assert.equal(a.status,'completed');assert.equal(b.status,'completed');assert.ok(b.makespan<a.makespan);assert.deepEqual(a.consumed,b.consumed);
  for(const r of Object.values(b.utilization))assert.ok(r>=0&&r<=1+1e-8);
});
test('fault during dispensing preserves partial consumption and releases reservation',async()=>{
  const sim=await Simulation.create(world,[processTask],{record:false});sim.run(8);const before=sim.state.materials['milk-stock'].consumed;
  assert.ok(before>0&&before<.18);sim.command({type:'fault',device:'foamer'});sim.step();
  near(sim.state.materials['milk-stock'].consumed,before);near(sim.state.materials['milk-stock'].reserved,0);assert.equal(sim.state.devices.foamer.mode,'fault');assert.equal(sim.state.tasks.foam.status,'failed');conservation(sim);
});
test('shortage blocks, refill resumes without duplicate dispensing',async()=>{
  const w=structuredClone(world);w.materials['milk-stock'].amount=.01;const sim=await Simulation.create(w,[processTask],{record:false});sim.run(5);
  assert.equal(sim.state.tasks.foam.reason,'insufficient_material');near(sim.state.materials['milk-stock'].consumed,0);
  sim.command({type:'refill',material:'milk-stock',amount:1});sim.run(25);assert.equal(sim.state.status,'completed');near(sim.state.materials['milk-stock'].amount,.83);near(sim.state.materials['milk-stock'].consumed,.18);
});
test('capacity guard fails before reserving or dispensing',async()=>{
  const w=structuredClone(world);w.objects['milk-cup'].capacityKg=.1;const sim=await Simulation.create(w,[processTask],{record:false});sim.run(10);
  assert.equal(sim.state.tasks.foam.reason,'CAPACITY_EXCEEDED');near(sim.state.materials['milk-stock'].consumed,0);near(sim.state.materials['milk-stock'].reserved,0);
});
test('two devices cannot reserve the same insufficient stock',async()=>{
  const w=structuredClone(world);w.materials['milk-stock'].amount=.2;w.devices.foamer2={...w.devices.foamer,station:'cups'};
  const sim=await Simulation.create(w,[processTask,{...processTask,id:'foam2',device:'foamer2',object:'cup'}],{record:false});sim.run(30);
  assert.equal(sim.state.tasks.foam.status,'done');assert.equal(sim.state.tasks.foam2.reason,'insufficient_material');near(sim.state.materials['milk-stock'].consumed,.18);
});
test('unexpected obstacle halts before advancing or consuming material',async()=>{
  const w=structuredClone(world);const p=fk(w.robots.left,w.robots.left.home).position;w.obstacles.push({id:'obstruction',pose:{position:p,quaternion:[0,0,0,1]},size:[.2,.2,.2]});
  const sim=await Simulation.create(w,[{id:'wait',type:'wait',duration:1,after:[],resources:[]}],{record:false});sim.step();assert.equal(sim.state.status,'collision');assert.equal(sim.state.tick,0);assert.ok(sim.state.collisions.some(c=>c.a==='obstruction'||c.b==='obstruction'));
});
test('shadow mode records contact but continues',async()=>{
  const w=structuredClone(world);w.collisionMode='shadow';w.obstacles.push({id:'obstruction',pose:{position:fk(w.robots.left,w.robots.left.home).position,quaternion:[0,0,0,1]},size:[.2,.2,.2]});
  const sim=await Simulation.create(w,[{id:'wait',type:'wait',duration:.1,after:[],resources:[]}],{record:false});sim.run(1);assert.equal(sim.state.status,'completed');assert.ok(sim.events.some(e=>e.type==='collision.shadow'));
});
test('fixed ticks are independent of caller batches and command replay is deterministic',async()=>{
  const a=await Simulation.create(world,[processTask]),b=await Simulation.create(world,[processTask]);
  for(let i=0;i<400;i++)a.step();a.command({type:'fault',device:'foamer'});a.step();
  for(let batch=0;batch<40;batch++)for(let i=0;i<10;i++)b.step();b.command({type:'fault',device:'foamer'});b.step();
  assert.deepEqual(a.state,b.state);assert.deepEqual(a.events,b.events);assert.deepEqual(a.export().commands,b.export().commands);
});
