import assert from 'node:assert/strict';
import test from 'node:test';
import { createLivePlan,livePosition,sampleSequence } from '../coffee-terminal/web/robot/live-plan.mjs';
import { SnapshotGate,orderSnapshot,terminalSnapshot } from '../coffee-terminal/web/robot/live-snapshot.mjs';
import { createArm } from '../coffee-terminal/web/robot/models.mjs';
import * as THREE from 'three';

const steps=[['cups',3.23],['ice',7.86],['brew',13.4],['milk',11.8],['lid',4.3]].map(([action,duration],i)=>({
  stepId:`step-${i}`,stepName:action,durationSeconds:duration,visual:{version:1,actions:[action],materials:[]}}));
test('live subactions preserve exact device durations and current step progress',()=>{
  const plan=createLivePlan(steps);
  assert.equal(plan.duration,steps.reduce((n,s)=>n+s.durationSeconds,0));
  steps.forEach((s,i)=>assert.ok(Math.abs(plan.ranges[i].end-plan.ranges[i].start-s.durationSeconds)<1e-10));
  const time=livePosition({steps,state:'RUNNING',stepId:'step-3',stepProgress:0.25},plan);
  assert.ok(Math.abs(time-(plan.ranges[3].start+11.8*.25))<1e-10);
  assert.ok(livePosition({steps,state:'RUNNING',stepId:'step-4',stepProgress:1},plan)<plan.duration);
  assert.equal(livePosition({steps,state:'SUCCEEDED'},plan),plan.duration);
});
test('live iced recipe reaches every target and transfers cup without discontinuities',()=>{
  const plan=createLivePlan(steps),arms={left:createArm('left'),right:createArm('right')};
  for(let t=0;t<plan.duration;t+=.1){
    const state=sampleSequence(plan,t);
    for(const side of ['left','right']){
      arms[side].move(state[side]);const actual=arms[side].tcp.getWorldPosition(new THREE.Vector3());
      assert.ok(actual.distanceTo(new THREE.Vector3(...state[side]))<1e-8);
    }
  }
  for(const segment of plan.segments.slice(0,-1)){
    const a=sampleSequence(plan,segment.end-1e-7),b=sampleSequence(plan,segment.end+1e-7);
    assert.ok(new THREE.Vector3(...a.cup).distanceTo(new THREE.Vector3(...b.cup))<1e-5);
  }
  assert.equal(sampleSequence(plan,plan.duration).ice,1);
});
test('retry rewinds only to its device step, and stale progress cannot revive a stopped task',()=>{
  const gate=new SnapshotGate(),base={taskId:'t1',revision:10,state:'RUNNING'};
  assert.ok(gate.accept(base));assert.equal(gate.accept({...base,revision:9}),false);
  assert.ok(gate.accept({...base,state:'HOLD'}));assert.equal(gate.accept(base),false);
  assert.ok(gate.accept({...base,revision:11,state:'RETRY_WAIT'}));
  assert.ok(gate.accept({...base,revision:12,stepProgress:0}));
  assert.ok(gate.accept({...base,revision:13,state:'SUCCEEDED'}));
  assert.equal(gate.accept({...base,revision:14}),false);
  assert.ok(gate.accept({...base,taskId:'t2',revision:1}));
});
test('terminal and phone use the same plan and progress; private fields are never projected',()=>{
  const local=terminalSnapshot({config:{secret:'token'},runtime:{task:{taskId:'t1',revision:5,state:'RUNNING',stepIndex:2,stepProgress:.4,
    recipe:{name:'Latte',steps:steps.map(s=>({id:s.stepId}))},stepPlan:steps},inventory:{materials:[{materialId:'milk',onHand:800}]}}});
  const phone=orderSnapshot({accessToken:'private',payment:{secret:'private'},status:'MAKING',product:{name:'Latte'},production:{
    taskId:'t1',deviceRevision:5,status:'EXECUTING',currentStepId:'step-2',stepProgress:.4,robotView:{version:1,steps}}});
  const plan=createLivePlan(steps);
  assert.equal(livePosition(local,plan),livePosition(phone,plan));
  assert.equal(local.inventory[0].onHand,800);assert.deepEqual(phone.inventory,[]);
  assert.ok(!JSON.stringify(phone).includes('private'));
});
