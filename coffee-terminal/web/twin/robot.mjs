// CPU-only mathematics; no DOM, WebGL, animation clock or mesh dependencies.
import { Matrix4 } from 'three/src/math/Matrix4.js';
import { Quaternion } from 'three/src/math/Quaternion.js';
import { Vector3 } from 'three/src/math/Vector3.js';
export const vec = a => new Vector3(...a);
export const pose = m => ({position:new Vector3().setFromMatrixPosition(m).toArray(), quaternion:new Quaternion().setFromRotationMatrix(m).toArray()});
export function matrix(p) { return new Matrix4().compose(vec(p.position), new Quaternion(...p.quaternion), new Vector3(1,1,1)); }
export function compose(a,b) { return pose(matrix(a).multiply(matrix(b))); }
export function relative(a,b) { return pose(matrix(a).invert().multiply(matrix(b))); }
export function fk(robot,q) {
  const m=matrix(robot.base), frames=[m.clone()];
  if(robot.chain) {
    const origins=[],axes=[];let j=0;
    for(const joint of robot.chain) {
      m.multiply(matrix(joint.origin));
      if(joint.type!=='fixed') {
        origins.push(pose(m));axes.push(vec(joint.axis).transformDirection(m).toArray());
        m.multiply(new Matrix4().makeRotationAxis(vec(joint.axis),q[j++]));
      }
    }
    const flange=pose(m);m.multiply(matrix(robot.tool));
    return {...pose(m),frames:[...origins,flange],jacobian:origins.map((p,i)=>({position:p.position,axis:axes[i]}))};
  }
  q.forEach((v,i)=>{
    const {a,d,alpha}=robot.dh, c=Math.cos(v),s=Math.sin(v),ca=Math.cos(alpha[i]),sa=Math.sin(alpha[i]);
    m.multiply(new Matrix4().set(c,-s*ca,s*sa,a[i]*c,s,c*ca,-c*sa,a[i]*s,0,sa,ca,d[i],0,0,0,1));
    frames.push(m.clone());
  });
  m.multiply(matrix(robot.tool));
  return {...pose(m),frames:frames.map(pose)};
}
function linear(a,b) {
  const m=a.map((r,i)=>[...r,b[i]]),n=b.length;
  for(let i=0;i<n;i++) {
    let k=i; for(let j=i+1;j<n;j++) if(Math.abs(m[j][i])>Math.abs(m[k][i])) k=j;
    [m[i],m[k]]=[m[k],m[i]]; const p=m[i][i]; if(Math.abs(p)<1e-14) return null;
    for(let j=i;j<=n;j++) m[i][j]/=p;
    for(let r=0;r<n;r++) if(r!==i) { const f=m[r][i]; for(let j=i;j<=n;j++) m[r][j]-=f*m[i][j]; }
  }
  return m.map(r=>r[n]);
}
export function ik(robot,target,seed=robot.home) {
  if(![...target.position,...target.quaternion].every(Number.isFinite)) throw Error('Invalid IK pose');
  const goal=vec(target.position), rot=new Quaternion(...target.quaternion).normalize();
  const seeds=[seed,robot.home,...[-1,1].map(s=>[0,-1.5,s*1.5,-1.5,1.5,0])];
  for(const initial of seeds) {
    const q=[...initial];
    for(let it=0;it<180;it++) {
      const f=fk(robot,q), delta=goal.clone().sub(vec(f.position));
      const er=rot.clone().multiply(new Quaternion(...f.quaternion).invert()).normalize();
      if(er.w<0) er.set(-er.x,-er.y,-er.z,-er.w);
      const axis=new Vector3(er.x,er.y,er.z),len=axis.length();
      if(len>1e-12) axis.multiplyScalar(2*Math.atan2(len,er.w)/len);
      if(delta.length()<1e-5 && axis.length()<1e-4) {
        const out=q.map((v,i)=>seed[i]+Math.atan2(Math.sin(v-seed[i]),Math.cos(v-seed[i])));
        if(out.every((v,i)=>v>=robot.limits[i].min && v<=robot.limits[i].max)) return out;
        break;
      }
      const cols=(f.jacobian??f.frames.slice(0,6)).map(p=>{
        const z=p.axis?vec(p.axis):new Vector3(0,0,1).applyQuaternion(new Quaternion(...p.quaternion));
        return [...z.clone().cross(vec(f.position).sub(vec(p.position))).toArray(),...z.toArray()];
      });
      const err=[...delta.toArray(),...axis.toArray()];
      const dq=linear(cols.map((c,i)=>cols.map((d,j)=>c.reduce((sum,v,k)=>sum+v*d[k],0)+(i===j?1e-5:0))),cols.map(c=>c.reduce((sum,v,k)=>sum+v*err[k],0)));
      if(!dq) break;
      const scale=Math.min(1,.2/Math.max(...dq.map(Math.abs)));
      q.forEach((v,i)=>q[i]=v+dq[i]*scale);
    }
  }
  throw Error(`IK_UNREACHABLE: ${robot.id} at ${target.position.join(',')}`);
}
// Quintic rest-to-rest joint segment. Analytic extrema enforce v/a/jerk bounds.
export function trajectory(robot,start,end,dt) {
  const duration=Math.max(dt,...end.map((v,i)=>{
    const d=Math.abs(v-start[i]),l=robot.limits[i];
    if(v<l.min || v>l.max) throw Error(`JOINT_LIMIT: ${robot.id}/${i}`);
    return Math.max(1.875*d/l.velocity,Math.sqrt(5.773502692*d/l.acceleration),Math.cbrt(60*d/l.jerk));
  }));
  const ticks=Math.ceil(duration/dt),T=ticks*dt;
  return {ticks,duration:T,start:[...start],end:[...end],sample(tick) {
    const u=Math.max(0,Math.min(1,tick/ticks)),s=10*u**3-15*u**4+6*u**5;
    const ds=(30*u*u-60*u**3+30*u**4)/T;
    return {q:start.map((v,i)=>v+(end[i]-v)*s),dq:start.map((v,i)=>(end[i]-v)*ds)};
  }};
}

// C2 natural cubic joint path with a quintic clock. Analytic bounds on each
// polynomial's derivatives give conservative v/a/jerk limits for the clock.
export function pathTrajectory(robot,knots,dt) {
  const n=knots.length-1;if(n<1)return trajectory(robot,knots[0],knots[0],dt);
  const curves=Array.from({length:6},(_,j)=>{
    const y=knots.map(q=>q[j]),m=Array(n+1).fill(0),diag=Array(n+1).fill(4),rhs=Array(n+1).fill(0);
    for(let i=1;i<n;i++)rhs[i]=6*(y[i+1]-2*y[i]+y[i-1]);
    for(let i=2;i<n;i++){const f=1/diag[i-1];diag[i]-=f;rhs[i]-=f*rhs[i-1];}
    for(let i=n-1;i>0;i--)m[i]=(rhs[i]-m[i+1])/diag[i];
    return Array.from({length:n},(_,i)=>[y[i],y[i+1]-y[i]-(2*m[i]+m[i+1])/6,m[i]/2,(m[i+1]-m[i])/6]);
  });
  const inverse=s=>{let lo=0,hi=1;for(let k=0;k<45;k++){const u=(lo+hi)/2;if(10*u**3-15*u**4+6*u**5<s)lo=u;else hi=u;}return (lo+hi)/2;};
  const clocks=Array.from({length:n},(_,i)=>{
    const lo=inverse(i/n),hi=inverse((i+1)/n);
    const bound=(f,roots)=>Math.max(...[lo,hi,...roots.filter(u=>u>lo&&u<hi)].map(u=>Math.abs(f(u))))*n;
    return [bound(u=>30*u*u-60*u**3+30*u**4,[.5]),bound(u=>60*u-180*u*u+120*u**3,[(3-Math.sqrt(3))/6,(3+Math.sqrt(3))/6]),bound(u=>60-360*u+360*u*u,[.5])];
  });
  let duration=dt;
  curves.forEach((pieces,j)=>{
    for(const [index,[a,b,c,d]] of pieces.entries()){
      let b1=0,b2=0,b3=0;
      const extrema=[0,1];if(d&&-c/(3*d)>0&&-c/(3*d)<1)extrema.push(-c/(3*d));
      b1=Math.max(b1,...extrema.map(t=>Math.abs(b+2*c*t+3*d*t*t)));
      b2=Math.max(b2,Math.abs(2*c),Math.abs(2*c+6*d));b3=Math.max(b3,Math.abs(6*d));
      // Include stationary points to reject spline overshoot outside joint limits.
      const disc=4*c*c-12*d*b,roots=d&&disc>=0?[(-2*c+Math.sqrt(disc))/(6*d),(-2*c-Math.sqrt(disc))/(6*d)]:c?[-b/(2*c)]:[];
      for(const t of [0,1,...roots.filter(t=>t>0&&t<1)]){const q=a+b*t+c*t*t+d*t*t*t;if(q<robot.limits[j].min||q>robot.limits[j].max)throw Error(`JOINT_LIMIT: ${robot.id}/${j}`);}
      const l=robot.limits[j],[v,acc,k]=clocks[index];
      duration=Math.max(duration,b1*v/l.velocity,Math.sqrt((b2*v*v+b1*acc)/l.acceleration),Math.cbrt((b3*v**3+3*b2*v*acc+b1*k)/l.jerk));
    }
  });
  const ticks=Math.ceil(duration/dt),T=ticks*dt;
  return {ticks,duration:T,sample(tick){
    const u=Math.max(0,Math.min(1,tick/ticks)),s=n*(10*u**3-15*u**4+6*u**5),ds=n*(30*u*u-60*u**3+30*u**4)/T;
    const i=Math.min(n-1,Math.floor(s)),t=s-i;
    return {q:curves.map(p=>{const [a,b,c,d]=p[i];return a+b*t+c*t*t+d*t*t*t;}),dq:curves.map(p=>{const [,b,c,d]=p[i];return (b+2*c*t+3*d*t*t)*ds;})};
  }};
}
