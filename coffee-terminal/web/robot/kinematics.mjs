import { Matrix4 } from 'three/src/math/Matrix4.js';
import { Quaternion } from 'three/src/math/Quaternion.js';
import { Vector3 } from 'three/src/math/Vector3.js';

// UR10e nominal standard DH, metres/radians. No factory calibration or hardware driver.
// https://www.universal-robots.com/developer/hardware-and-motion/robot-motion-dh-parameters/
export const UR10E = Object.freeze({ name: 'UR10e', a: [0,-0.6127,-0.57155,0,0,0],
  d: [0.1807,0,0,0.17415,0.11985,0.11655], alpha: [Math.PI/2,0,0,Math.PI/2,-Math.PI/2,0] });
export const ARM = Object.freeze({ shoulder: .1807, upper: .6127, forearm: .57155, tool: .12 });
export const BASES = Object.freeze({ left: [-0.62, 0.96, -0.08], right: [0.94, 0.96, 0.0] });
export const LIMITS = Array.from({length:6}, () => [-360,360]);
export const rad = d => d*Math.PI/180;
export const deg = r => r*180/Math.PI;
export const smooth = t => t*t*(3-2*t);
export const lerp3 = (a,b,t) => a.map((v,i)=>v+(b[i]-v)*t);
export const UPRIGHT = new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI).toArray();
// Tool +Y approaches the cup horizontally; tool +Z is vertical. Orient towards
// the target from the base so the flange stays on the reachable side of the cup.
export function sideGrip(side,target) {
  const direction=new Vector3(target[0]-BASES[side][0],0,target[2]-BASES[side][2]).normalize();
  if(direction.lengthSq()<.5) throw new RangeError('侧夹目标不能位于底座轴线上');
  const across=new Vector3(-direction.z,0,direction.x);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(across,direction,new Vector3(0,1,0))).toArray();
}
export const leftSideGrip = target => sideGrip('left',target);
export function rightHomeSeed(mode='cup') {
  return mode==='pitcher' ? [1.8810850456,-1.7686486428,1.724713301,-1.5268609849,-Math.PI/2,-2.8313039348]
    : [1.67,-2,2.08,-.08,1.07,-Math.PI];
}
export function dhMatrix(i,q) {
  const c=Math.cos(q),s=Math.sin(q),ca=Math.cos(UR10E.alpha[i]),sa=Math.sin(UR10E.alpha[i]);
  return new Matrix4().set(c,-s*ca,s*sa,UR10E.a[i]*c, s,c*ca,-c*sa,UR10E.a[i]*s,
    0,sa,ca,UR10E.d[i], 0,0,0,1);
}
export function baseMatrix(base) { return new Matrix4().makeRotationX(-Math.PI/2).setPosition(...base); }
export function toolMatrix() { return new Matrix4().makeRotationX(Math.PI/2).setPosition(0,0,ARM.tool); }
export function forward(joints,base) {
  const matrix=baseMatrix(base), frames=[matrix.clone()];
  joints.forEach((q,i)=>{ matrix.multiply(dhMatrix(i,q)); frames.push(matrix.clone()); });
  matrix.multiply(toolMatrix());
  return {matrix,frames,position:new Vector3().setFromMatrixPosition(matrix),quaternion:new Quaternion().setFromRotationMatrix(matrix)};
}
function linearSolve(a,b) {
  const m=a.map((row,i)=>[...row,b[i]]);
  for(let i=0;i<6;i++) {
    let k=i; for(let j=i+1;j<6;j++) if(Math.abs(m[j][i])>Math.abs(m[k][i])) k=j;
    [m[i],m[k]]=[m[k],m[i]];
    const pivot=m[i][i]; if(Math.abs(pivot)<1e-15) return null;
    for(let j=i;j<7;j++) m[i][j]/=pivot;
    for(let r=0;r<6;r++) if(r!==i) { const f=m[r][i]; for(let j=i;j<7;j++) m[r][j]-=f*m[i][j]; }
  }
  return m.map(r=>r[6]);
}
/** Damped full-pose IK. Previous joint seed preserves the local solution branch. */
export function solvePose(target,orientation,base,seed=null) {
  if(target?.length!==3 || base?.length!==3 || orientation?.length!==4 ||
    ![...target,...base,...orientation].every(Number.isFinite)) throw new RangeError('目标姿态必须是有限数值');
  const goal=new Vector3(...target), rotation=new Quaternion(...orientation);
  if(rotation.length()<1e-8 || goal.distanceTo(new Vector3(...base))>1.8) throw new RangeError('目标超出机械臂工作范围');
  rotation.normalize();
  const yaw=Math.atan2(-(target[2]-base[2]),target[0]-base[0]);
  // Start each arm on its validated workcell home branch; the left seed uses a side grasp.
  const seeds=seed?[seed]:(base[0]>0?[rightHomeSeed()]:[[.4347776138,-1.4911559652,1.6698821355,-.1787261703,1.2932163425,-Math.PI]]);
  for(const shoulder of [-Math.PI/2,-Math.PI/3]) for(const elbow of [Math.PI/2,-Math.PI/2])
    seeds.push([yaw,shoulder,elbow,-Math.PI/2,Math.PI/2,0]);
  for(const initial of seeds) {
    const q=[...initial];
    for(let iteration=0;iteration<140;iteration++) {
      const fk=forward(q,base), delta=goal.clone().sub(fk.position);
      const er=rotation.clone().multiply(fk.quaternion.clone().invert()).normalize();
      if(er.w<0) er.set(-er.x,-er.y,-er.z,-er.w);
      const axis=new Vector3(er.x,er.y,er.z), length=axis.length();
      if(length>1e-12) axis.multiplyScalar(2*Math.atan2(length,er.w)/length);
      if(delta.length()<1e-10 && axis.length()<1e-10) {
        const normalized=q.map((v,i)=>{ const center=seed?.[i] || 0; return center+Math.atan2(Math.sin(v-center),Math.cos(v-center)); });
        if(normalized.every(v=>Math.abs(v)<=2*Math.PI)) return normalized;
        break;
      }
      const columns=fk.frames.slice(0,6).map(frame=>{
        const e=frame.elements, z=new Vector3(e[8],e[9],e[10]);
        const p=new Vector3().setFromMatrixPosition(frame);
        return [...z.clone().cross(fk.position.clone().sub(p)).toArray(),...z.toArray()];
      });
      const error=[...delta.toArray(),...axis.toArray()];
      const a=columns.map((col,i)=>columns.map((other,j)=>col.reduce((s,v,k)=>s+v*other[k],0)+(i===j?1e-7:0)));
      const b=columns.map(col=>col.reduce((s,v,k)=>s+v*error[k],0));
      const dq=linearSolve(a,b); if(!dq) break;
      const scale=Math.min(1,.25/Math.max(...dq.map(Math.abs)));
      q.forEach((v,i)=>q[i]=v+dq[i]*scale);
    }
  }
  throw new RangeError('UR10e 无可达的连续目标姿态');
}
export function solveUpright(target,base,roll=0) {
  if(!Number.isFinite(roll)) throw new RangeError('目标姿态必须是有限数值');
  const q=new Quaternion(...UPRIGHT).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),roll));
  return solvePose(target,q.toArray(),base);
}
