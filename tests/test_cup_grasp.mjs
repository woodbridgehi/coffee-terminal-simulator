import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion} from 'three';
import {createSequence,sampleSequence} from '../coffee-terminal/web/robot/sequence.mjs';
import {createLatteArtDemo} from '../coffee-terminal/web/robot/latte-art-demo.mjs';
const scenarios=[['spiral',createLatteArtDemo],['vanilla',()=>createSequence('vanilla')]];

for(const [name,build] of scenarios) {
  test(`${name}: both coffee-cup grasps are horizontal, approach/retract along the open finger axis`,()=>{
    const plan=build();let approaches=0,retreats=0;
    for(const segment of plan.segments) {
      const entering=segment.description==='沿夹持轴水平进入杯身';
      const leaving=segment.description==='沿夹持轴水平后退，退出杯身';
      if(!entering && !leaving) continue;
      entering?approaches++:retreats++;
      const a=sampleSequence(plan,segment.start+1e-8),b=sampleSequence(plan,segment.end-1e-8);
      const side=['left','right'].find(side=>new Vector3(...a[side]).distanceTo(new Vector3(...b[side]))>.001);
      assert.ok(side);
      const q=new Quaternion(...a[side+'Orientation']),direction=new Vector3(0,1,0).applyQuaternion(q);
      const delta=new Vector3(...b[side]).sub(new Vector3(...a[side]));
      assert.ok(Math.abs(direction.y)<1e-8);
      assert.ok(delta.clone().cross(direction).length()<1e-8,'must not withdraw sideways');
      assert.ok(entering?delta.dot(direction)>0:delta.dot(direction)<0);
      assert.ok(q.angleTo(new Quaternion(...b[side+'Orientation']))<1e-6,'do not turn until fingers clear');
      assert.ok(a[side==='left'?'gripLeft':'gripRight']>.999);
      assert.notEqual(a.owner,side);assert.notEqual(b.owner,side);
      assert.ok(new Vector3(...a.cup).distanceTo(new Vector3(...b.cup))<1e-8);
    }
    assert.ok(approaches>=2 && retreats>=2);
    for(let t=0;t<plan.duration;t+=.05) {
      const state=sampleSequence(plan,t);
      if(state.owner) {
        const direction=new Vector3(0,1,0).applyQuaternion(new Quaternion(...state[state.owner+'Orientation']));
        assert.ok(Math.abs(direction.y)<1e-8,'coffee cup must use a horizontal grasp');
      }
    }
  });

  test(`${name}: open fingers and palm do not intersect the stationary cup during free travel`,()=>{
    const plan=build();let nearby=0;
    for(let t=0;t<plan.duration;t+=.025) {
      const state=sampleSequence(plan,t);
      for(const side of ['left','right']) {
        if(state.owner===side || (side==='right' && state.rightMode==='pitcher')) continue;
        const opening=state[side==='left'?'gripLeft':'gripRight'];
        if(opening<.999 || new Vector3(...state[side]).distanceTo(new Vector3(...state.cup))>.35) continue;
        const q=new Quaternion(...state[side+'Orientation']);
        // During cup operations local Z is vertical. Cylinder/OBB closest point
        // is exact in the horizontal plane; the maximum cup radius is conservative.
        assert.ok(new Vector3(0,0,1).applyQuaternion(q).y>.999);
        const center=new Vector3(...state.cup).sub(new Vector3(...state[side])).applyQuaternion(q.invert());
        const boxes=[[[0,-.13,0],[.15,.045,.065]]];
        for(const sign of [-1,1]) {
          const x=sign*(.060+opening*.032);
          boxes.push([[x,-.06,0],[.018,.12,.035]],[[x-sign*.006,0,0],[.014,.04,.045]]);
        }
        for(const [p,size] of boxes) {
          if(Math.abs(center.z-p[2])>.089+size[2]/2) continue;
          const dx=Math.max(0,Math.abs(center.x-p[0])-size[0]/2),dy=Math.max(0,Math.abs(center.y-p[1])-size[1]/2);
          assert.ok(Math.hypot(dx,dy)>.059,`${side} finger/palm intersects cup at ${t.toFixed(3)}s (${state.description})`);
          nearby++;
        }
      }
    }
    assert.ok(nearby>20);
  });
}
