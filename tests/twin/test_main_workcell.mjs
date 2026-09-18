import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Simulation} from '../../coffee-terminal/web/twin/kernel.mjs';
import {latteTasks} from '../../coffee-terminal/web/twin/recipes.mjs';
import {pathTrajectory,fk,ik} from '../../coffee-terminal/web/twin/robot.mjs';
import {STATIONS} from '../../coffee-terminal/web/robot/sequence.mjs';
import {BASES} from '../../coffee-terminal/web/robot/kinematics.mjs';
const world=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-main-v2.json',import.meta.url)));
const xyz=p=>[p[0],-p[2]||0,p[1]];

test('main workcell uses the existing equipment mouths, bases, dispenser and lid clearance geometry',()=>{
  for(const [id,s] of Object.entries(STATIONS))assert.deepEqual(world.stations[id].pose.position,xyz(s.position));
  for(const [id,p] of Object.entries(BASES))assert.deepEqual(world.robots[id].base.position,xyz(p));
  for(const id of ['cup-magazine','brew-nozzle','ice-housing','water-housing','milk-housing','syrup-housing','lid-column','lid-head','lid-press'])assert.ok(world.obstacles.some(o=>o.id===id),id);
  assert.equal(world.collisionMode,'stop');
});

test('continuous joint path obeys velocity acceleration jerk limits and rejects overshoot',()=>{
  const r=world.robots.left,knots=[0,.2,-.1,.3,.35].map(d=>r.home.map((q,i)=>q+d*(i%2?-.7:1)));
  const motion=pathTrajectory(r,knots,world.dt),q=[],v=[],a=[];
  for(let tick=0;tick<=motion.ticks;tick++)q.push(motion.sample(tick).q);
  for(let i=1;i<q.length;i++)v.push(q[i].map((x,j)=>(x-q[i-1][j])/world.dt));
  for(let i=1;i<v.length;i++)a.push(v[i].map((x,j)=>(x-v[i-1][j])/world.dt));
  for(let j=0;j<6;j++){
    assert.ok(Math.max(...v.map(x=>Math.abs(x[j])))<=r.limits[j].velocity+1e-6);
    assert.ok(Math.max(...a.map(x=>Math.abs(x[j])))<=r.limits[j].acceleration+1e-6);
    for(let i=1;i<a.length;i++)assert.ok(Math.abs(a[i][j]-a[i-1][j])/world.dt<=r.limits[j].jerk+1e-5);
    assert.ok(Math.abs(q[0][j]-knots[0][j])<1e-9);assert.ok(Math.abs(q.at(-1)[j]-knots.at(-1)[j])<1e-9);
    assert.ok(motion.sample(0).dq[j]===0);assert.ok(motion.sample(Infinity).dq[j]===0);
  }
  assert.throws(()=>pathTrajectory(r,[r.home,r.home.map(()=>100)],world.dt),/JOINT_LIMIT/);
});

test('main layout completes upright dual-arm transfer, clear-before-seal and capped pickup without collision',async()=>{
  const sim=await Simulation.create(world,latteTasks(world),{record:false});let maxTilt=0,pourTilt=0,flowSamples=0;
  while(sim.state.time<600){
    const advancing=sim.step();
    for(const [id,o] of Object.entries(sim.state.objects)){
      const tilt=2*(o.pose.quaternion[0]**2+o.pose.quaternion[1]**2);
      if(id==='milk-cup'&&sim.state.tasks.pour.status==='running')pourTilt=Math.max(pourTilt,tilt);
      else maxTilt=Math.max(maxTilt,tilt);
    }
    if(sim.state.tasks.pour.status==='running'){
      const phase=sim.state.tasks.pour.pourPhase;
      if(phase==='flow'){flowSamples++;assert.ok(sim.state.objects['milk-cup'].pose.quaternion[0]**2+sim.state.objects['milk-cup'].pose.quaternion[1]**2>.24);}
      if(phase==='tilting')assert.equal(sim.state.objects.cup.contents.foamer??0,0);
    }
    if(sim.state.tasks.seal.status==='running'){
      assert.equal(sim.state.objects.cup.owner,null);
      assert.equal(sim.state.tasks['right-clear-lid'].status,'done');
      for(const [id,r] of Object.entries(sim.state.robots))assert.ok(Math.hypot(...fk(world.robots[id],r.q).position.map((v,i)=>v-sim.state.objects.cup.pose.position[i]))>=.25);
    }
    if(!advancing)break;
  }
  assert.equal(sim.state.status,'completed',JSON.stringify(sim.metrics()));assert.equal(sim.metrics().done,31);
  assert.ok(maxTilt<1-Math.cos(Math.PI/180),'transport keeps cups upright within one degree');
  assert.ok(pourTilt>.49&&pourTilt<.51,'pitcher reaches 60 degrees');assert.equal(flowSamples,300,'six seconds of flow excludes tilt/return');
  assert.equal(sim.state.objects.cup.sealed,true);assert.equal(sim.state.objects.cup.owner,null);
  assert.equal(sim.events.some(e=>e.type.startsWith('collision.')),false);
  assert.ok(Math.abs(Object.values(sim.state.objects.cup.contents).reduce((a,b)=>a+b,0)-.22)<1e-8);
  assert.ok(Math.hypot(...sim.state.objects.cup.pose.position.map((v,i)=>v-world.stations.pickup.pose.position[i]))<.015);
});

test('lid press waits for gripper clearance and faults never mark a cup sealed',async()=>{
  const w=structuredClone(world);w.objects.cup.pose=structuredClone(w.stations.lid.pose);
  const task={id:'seal',type:'process',device:'lidder',object:'cup',after:[],resources:[]};
  const sim=await Simulation.create(w,[task],{record:false});
  const station=w.stations.lid.pose.position,r=w.robots.right,yaw=Math.atan2(-(station[0]-r.base.position[0]),station[1]-r.base.position[1]);
  sim.state.robots.right.q=ik(r,{position:station,quaternion:[0,0,Math.sin(yaw/2),Math.cos(yaw/2)]});
  assert.equal(sim.start(task),false);assert.equal(sim.state.tasks.seal.reason,'gripper_not_clear');
  sim.state.robots.right.q=[...r.home];
  assert.equal(sim.start(task),true);sim.command({type:'fault',device:'lidder'});sim.step();
  assert.equal(sim.state.tasks.seal.status,'failed');assert.notEqual(sim.state.objects.cup.sealed,true);
});
