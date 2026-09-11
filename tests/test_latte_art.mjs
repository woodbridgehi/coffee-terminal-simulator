import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion} from 'three';
import {createLatteArtDemo,DEMO_STEPS} from '../coffee-terminal/web/robot/latte-art-demo.mjs';
import {sampleSequence,STATIONS} from '../coffee-terminal/web/robot/sequence.mjs';
import {createLivePlan,normalizeSteps} from '../coffee-terminal/web/robot/live-plan.mjs';
import {solvePose,forward,BASES,UPRIGHT,UR10E} from '../coffee-terminal/web/robot/kinematics.mjs';
import {SPOUT,spiralPoint,PITCHER_HOME} from '../coffee-terminal/web/robot/latte-art.mjs';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{addSpiral}=require('../coffee-terminal/web/recipe-latte-art.js');
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
test('UR10e zero-position FK matches independent DH reference',()=>{
  assert.deepEqual(UR10E.a,[0,-.6127,-.57155,0,0,0]);
  const e=forward([0,0,0,0,0,0],[0,0,0]).frames.at(-1).elements;
  assert.ok(distance([e[12],e[13],e[14]],[-1.18425,.06085,.2907])<1e-10);
});
test('spiral has full pose IK, fixed grasp, continuous cup and pitcher',()=>{
  const plan=createLatteArtDemo(),seed={};let pours=0;
  for(let t=0;t<=plan.duration;t+=.05){
    const s=sampleSequence(plan,t);
    for(const side of ['left','right']){
      const orientation=s[side+'Orientation']||UPRIGHT;
      const q=s[side+'Joints'] || solvePose(s[side],orientation,BASES[side],seed[side]);
      if(seed[side]) assert.ok(Math.max(...q.map((v,i)=>Math.abs(v-seed[side][i])))<Math.PI/2,'no joint branch jumps '+t+' '+side+' '+s.description+' seed '+seed[side]+' '+q.map((v,i)=>v-seed[side][i]));
      seed[side]=q;const fk=forward(q,BASES[side]);
      assert.ok(distance(fk.position.toArray(),s[side])<1e-7);
      assert.ok(fk.quaternion.angleTo(new Quaternion(...orientation))<1e-6);
    }
    if(s.stream==='latte-art'){
      pours++;assert.equal(s.owner,'left');assert.equal(s.pitcherOwner,'right');
      const spout=new Vector3(...SPOUT).applyQuaternion(new Quaternion(...s.pitcherOrientation)).add(new Vector3(...s.pitcher));
      assert.ok(distance(spout.toArray(),s.spout)<1e-10);
      assert.ok(distance(new Vector3(s.landing[0]-s.cup[0],0,s.landing[2]-s.cup[2]).applyQuaternion(new Quaternion(...s.cupOrientation).invert()).toArray(),spiralPoint(s.artProgress))<1e-10);
    }
  }
  assert.ok(pours>20);
  for(const seg of plan.segments.slice(0,-1)){
    const a=sampleSequence(plan,seg.end-1e-8),b=sampleSequence(plan,seg.end+1e-8);
    for(const key of ['cup','pitcher','right','left']) assert.ok(distance(a[key],b[key])<1e-5,key+' must not teleport: '+seg.description);
  }
  const final=sampleSequence(plan,plan.duration);
  assert.deepEqual(final.cup,STATIONS.pickup.position);assert.deepEqual(final.pitcher,PITCHER_HOME);assert.equal(final.artProgress,1);
  const middle=sampleSequence(plan,77);sampleSequence(plan,0);assert.deepEqual(sampleSequence(plan,77),middle);
});
test('unsupported pattern and incompatible drink are rejected',()=>{
  for(const patternId of ['heart','unknown']){const steps=structuredClone(DEMO_STEPS);steps[3].visual.latteArt.patternId=patternId;assert.equal(normalizeSteps(steps),null);}
  const short=structuredClone(DEMO_STEPS);short[3].durationSeconds=1;assert.throws(()=>createLivePlan(short));
  const ice=structuredClone(DEMO_STEPS);ice[2].visual.actions=['ice'];assert.throws(()=>createLivePlan(ice),/无冰/);
  const lid=structuredClone(DEMO_STEPS);lid[2].visual.actions=['lid'];assert.throws(()=>createLivePlan(lid),/未封盖/);
});
test('editor adds one versioned step before sealing without increasing milk',()=>{
  const recipe=JSON.parse(readFileSync(new URL('../config/instances/coffee-bot-003/recipes/latte.json',import.meta.url)));
  assert.throws(()=>addSpiral(recipe),/已包含/);
  recipe.steps=recipe.steps.filter(s=>!s.latteArt);recipe.steps.find(s=>s.id==='add-milk').consumes[0].amount=180;
  const before=structuredClone(recipe),added=addSpiral(recipe);
  assert.deepEqual(recipe,before);assert.equal(added.steps[3].latteArt.patternId,'spiral');
  assert.equal(added.steps.flatMap(s=>s.consumes).filter(i=>i.materialId==='milk').reduce((n,i)=>n+i.amount,0),180);
  assert.notEqual(added.version,recipe.version);
});

// Exact closest distance between the two centre-line segments (capsule approximation).
function segmentDistance(a,b,c,d) {
  const u=b.clone().sub(a),v=d.clone().sub(c),w=a.clone().sub(c);
  const A=u.dot(u),B=u.dot(v),C=v.dot(v),D=u.dot(w),E=v.dot(w),den=A*C-B*B;
  let s=den>1e-12?Math.max(0,Math.min(1,(B*E-C*D)/den)):0;
  let t=C>1e-12?(B*s+E)/C:0;
  if(t<0){t=0;s=A>1e-12?Math.max(0,Math.min(1,-D/A)):0;}
  else if(t>1){t=1;s=A>1e-12?Math.max(0,Math.min(1,(B-D)/A)):0;}
  return w.addScaledVector(u,s).addScaledVector(v,-t).length();
}
test('sampled UR links clear worktop and each other throughout the spiral demo',()=>{
  const plan=createLatteArtDemo();
  for(let time=0;time<plan.duration;time+=.1){
    const state=sampleSequence(plan,time),frames={};
    for(const side of ['left','right']){
      frames[side]=forward(state[side+'Joints'],BASES[side]).frames.map(f=>new Vector3().setFromMatrixPosition(f));
      for(const point of frames[side].slice(2)) assert.ok(point.y>1.01,'link clears worktop at '+time);
    }
    for(let i=0;i<6;i++)for(let j=0;j<6;j++){
      const gap=segmentDistance(frames.left[i],frames.left[i+1],frames.right[j],frames.right[j+1]);
      assert.ok(gap>.12,'two conservative 60 mm link capsules must not overlap at '+time+' '+gap);
    }
  }
});

test('left side grasp keeps the cup upright and clears the liquid surface',()=>{
  const plan=createLatteArtDemo();let checked=0;
  for(let time=0;time<plan.duration;time+=.1){
    const state=sampleSequence(plan,time);
    const cupUp=new Vector3(0,1,0).applyQuaternion(new Quaternion(...state.cupOrientation));
    assert.ok(cupUp.distanceTo(new Vector3(0,1,0))<1e-8,'cup must not tip');
    const tool=forward(state.leftJoints,BASES.left);
    const approach=new Vector3(0,1,0).applyQuaternion(tool.quaternion);
    assert.ok(Math.abs(approach.y)<1e-8,'left gripper must approach horizontally');
    if(state.stream==='latte-art'){
      checked++;
      const wrist=new Vector3().setFromMatrixPosition(tool.frames[6]);
      assert.ok(Math.abs(wrist.y-state.cup[1])<1e-8,'flange stays beside cup, not above it');
      assert.ok(Math.hypot(wrist.x-state.cup[0],wrist.z-state.cup[2])>.119,'wrist clears open surface');
    }
  }
  assert.ok(checked>20);
  for(const segment of plan.segments.slice(0,-1)){
    const before=sampleSequence(plan,segment.end-1e-8),after=sampleSequence(plan,segment.end+1e-8);
    assert.ok(new Quaternion(...before.cupOrientation).angleTo(new Quaternion(...after.cupOrientation))<1e-6,'cup orientation must not jump at '+segment.description);
  }
});
