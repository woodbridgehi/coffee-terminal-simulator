import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scenePosition,armVisualState,containerFill} from '../../coffee-terminal/web/twin/visual-state.mjs';
import {fk} from '../../coffee-terminal/web/twin/robot.mjs';
import {forward} from '../../coffee-terminal/web/robot/kinematics.mjs';
const world=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-v1.json',import.meta.url)));
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-9,`${a} != ${b}`));
test('presentation coordinates preserve main Y-up world convention without changing config',()=>{
  const original=structuredClone(world),robot=world.robots.left;
  near(scenePosition([1,2,3]).toArray(),[1,3,-2]);
  const presented=scenePosition(armVisualState(robot,{q:robot.home}).pose.position);
  const main=forward(robot.home,scenePosition(robot.base.position).toArray());
  near(presented.toArray(),main.position.toArray());assert.deepEqual(world,original);
});
test('arm visuals use calibrated base/tool and recorded joints rather than main animation IK',()=>{
  const robot=structuredClone(world.robots.left);robot.base.position=[.2,-.3,1.1];robot.base.quaternion=[0,0,Math.sin(.3),Math.cos(.3)];robot.tool.position=[.01,.02,.18];
  const q=robot.home.map((v,i)=>v+.01*i),state={q},before=structuredClone(state),visual=armVisualState(robot,state),expected=fk(robot,q);
  near(visual.points[0],robot.base.position);near(visual.points.at(-1),expected.position);near(visual.pose.quaternion,expected.quaternion);
  assert.equal(visual.points.length,8);assert.deepEqual(state,before);
});
test('cup appearance reads recorded mass and capacity without consuming or transferring material',()=>{
  const state={contents:{brewer:.04,foamer:.18}},before=structuredClone(state),fill=containerFill({capacityKg:.35},state);
  near([fill.mass,fill.fraction,fill.milkFraction],[.22,.22/.35,.18/.22]);assert.deepEqual(state,before);
  assert.deepEqual(containerFill({capacityKg:.35},{contents:{}}),{mass:0,fraction:0,milkFraction:0});
});
