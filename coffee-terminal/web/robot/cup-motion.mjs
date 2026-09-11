import { BASES } from './kinematics.mjs';

// Open fingers extend 20 mm beyond TCP; a 160 mm axial retreat clears the cup
// before any lift, sideways travel or change of tool orientation.
export const CUP_CLEARANCE = .16;
export function cupApproach(side,target) {
  const base=BASES[side],dx=target[0]-base[0],dz=target[2]-base[2],r=Math.hypot(dx,dz);
  return [target[0]-CUP_CLEARANCE*dx/r,target[1],target[2]-CUP_CLEARANCE*dz/r];
}

// Side-grasp TCP cannot pass through the base's inner workspace. Insert a
// front/side arc only when the direct travel chord would enter that region.
export function cupTravel(from,to,side) {
  const base=BASES[side],a=[from[0]-base[0],from[2]-base[2]],b=[to[0]-base[0],to[2]-base[2]];
  const d=b.map((v,i)=>v-a[i]),length=d[0]**2+d[1]**2;
  const t=length?Math.max(0,Math.min(1,-(a[0]*d[0]+a[1]*d[1])/length)):0;
  if(Math.hypot(a[0]+t*d[0],a[1]+t*d[1])>=.44) return [to];
  const radius=.48,angleA=Math.atan2(a[1],a[0]),angleB=Math.atan2(b[1],b[0]);
  const delta=Math.atan2(Math.sin(angleB-angleA),Math.cos(angleB-angleA));
  if(Math.min(Math.hypot(...a),Math.hypot(...b))<.44) throw new RangeError('侧夹路径进入底座内侧不可达区域');
  const count=Math.max(1,Math.ceil(Math.abs(delta)/(.15))),points=[];
  for(let i=0;i<=count;i++) {
    const angle=angleA+delta*i/count;
    points.push([base[0]+radius*Math.cos(angle),from[1]+(to[1]-from[1])*i/count,base[2]+radius*Math.sin(angle)]);
  }
  return [...points,to];
}
