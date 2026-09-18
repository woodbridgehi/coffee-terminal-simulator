import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Quaternion} from 'three/src/math/Quaternion.js';
import {Vector3} from 'three/src/math/Vector3.js';
import {processOutlet} from '../../coffee-terminal/web/twin/effect-state.mjs';
import {pourLip} from '../../coffee-terminal/web/twin/pouring.mjs';
import {DISPENSER_NOZZLE} from '../../coffee-terminal/web/robot/workcell-geometry.mjs';
import {planMotion} from '../../coffee-terminal/web/twin/planner.mjs';
import {Simulation} from '../../coffee-terminal/web/twin/kernel.mjs';
import {fk,ik,relative,compose} from '../../coffee-terminal/web/twin/robot.mjs';
const world=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-main-v2.json',import.meta.url)));
test('stream begins at the mesh nozzle bottom and follows a translated/rotated installation',()=>{
 const w=structuredClone(world),source=processOutlet(w,'brewer');assert.equal(source[2],DISPENSER_NOZZLE.centerY-DISPENSER_NOZZLE.height/2);
 const local=relative(w.stations.brew.pose,{position:source,quaternion:[0,0,0,1]});w.stations.brew.pose={position:[1,2,3],quaternion:new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.3).toArray()};
 assert.deepEqual(processOutlet(w,'brewer'),compose(w.stations.brew.pose,local).position);
});
test('pour source is on the lower rim, outside the wall, above the receiving cup',()=>{
 const def=world.objects['milk-cup'],source={pose:{position:[.1,0,1.3],quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,-1,0),Math.PI/3).toArray()}},target={pose:{position:[0,0,1.05],quaternion:[0,0,0,1]}};
 const lip=pourLip(def,source,target),local=relative(source.pose,{position:lip,quaternion:[0,0,0,1]}).position;
 assert.ok(Math.abs(Math.hypot(local[0],local[1])-def.radius)<1e-10);assert.ok(Math.abs(local[2]-def.height/2)<1e-10);assert.ok(lip[2]>target.pose.position[2]+world.objects.cup.height/2);
});
test('released cup is cleared along the fingers without lateral sweep or wrist yaw',async()=>{
 const sim=await Simulation.create(world,[],{external:true,record:false}),def=world.robots.left,station=world.stations.brew.pose.position,yaw=Math.atan2(-(station[0]-def.base.position[0]),station[1]-def.base.position[1]);
 sim.state.robots.left.q=ik(def,{position:station,quaternion:[0,0,Math.sin(yaw/2),Math.cos(yaw/2)]});sim.state.objects.cup.pose=structuredClone(world.stations.brew.pose);
 const from=fk(def,sim.state.robots.left.q),motion=planMotion(world,sim.state,{id:'withdraw',robot:'left',station:'left-ready',allowedGrasps:[{robot:'left',object:'cup'}]},sim.checker),segment=motion.segments[0];
 for(let t=0;t<=segment.ticks;t++){
  const p=relative(from,fk(def,segment.sample(t).q));assert.ok(Math.abs(p.position[0])<.001&&Math.abs(p.position[2])<.001,'no sideways/upward sweep');assert.ok(p.position[1]<=.001&&p.position[1]>=-.161);assert.ok(Math.abs(p.quaternion[3])>.99999,'orientation stays fixed');
 }
 assert.ok(Math.abs(relative(from,fk(def,segment.sample(Infinity).q)).position[1]+.16)<.001);
});
test('closed gripper cannot approach a cup before opening',async()=>{
 const sim=await Simulation.create(world,[],{external:true,record:false});sim.state.grippers={tool:{robot:'left',openingMm:100}};
 assert.throws(()=>planMotion(world,sim.state,{id:'approach',robot:'left',station:'cups'},sim.checker),/GRIPPER_APPROACH_CLEARANCE/);
});
