import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion } from 'three/src/math/Quaternion.js';
import { Vector3 } from 'three/src/math/Vector3.js';
import { fk, compose } from './robot.mjs';
let ready;
export async function initCollision() { ready ??= RAPIER.init(); await ready; }
const v=a=>({x:a[0],y:a[1],z:a[2]});
const r=a=>({x:a[0],y:a[1],z:a[2],w:a[3]});
function capsule(id,a,b,radius,meta) {
  const d=new Vector3(...b).sub(new Vector3(...a)), length=d.length();
  const q=length>1e-9?new Quaternion().setFromUnitVectors(new Vector3(0,1,0),d.normalize()):new Quaternion();
  return {id,shape:new RAPIER.Capsule(length/2,radius),position:v(a.map((n,i)=>(n+b[i])/2)),rotation:r(q.toArray()),...meta};
}
export function syncAttachments(config,state) {
  for(const o of Object.values(state.objects)) if(o.owner) o.pose=compose(fk(config.robots[o.owner],state.robots[o.owner].q),o.attachment);
}
export class CollisionChecker {
  constructor(config) { this.config=config; }
  shapes(state) {
    const list=this.config.obstacles.map(o=>({id:o.id,kind:'static',shape:new RAPIER.Cuboid(...o.size.map(x=>x/2)),position:v(o.pose.position),rotation:r(o.pose.quaternion)}));
    for(const [id,rs] of Object.entries(state.robots)) {
      const def=this.config.robots[id],f=fk(def,rs.q),points=[...f.frames.map(p=>p.position),f.position];
      for(let i=0;i<points.length-1;i++) list.push(capsule(`${id}/link${i}`,points[i],points[i+1],def.linkRadius,{kind:'robot',robot:id,link:i}));
      list.push({id:`${id}/gripper`,kind:'robot',robot:id,link:7,shape:new RAPIER.Cuboid(.065,.025,.035),position:v(f.position),rotation:r(f.quaternion)});
    }
    for(const [id,o] of Object.entries(state.objects)) {
      const def=this.config.objects[id];
      // Rapier cylinder is Y-up; container local axis is Z-up.
      const q=new Quaternion(...o.pose.quaternion).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2));
      list.push({id,kind:'object',owner:o.owner,shape:new RAPIER.Cylinder(def.height/2,def.radius),position:v(o.pose.position),rotation:r(q.toArray())});
    }
    return list;
  }
  check(state,{margin=this.config.clearance,allowedGrasps=[]}={}) {
    const list=this.shapes(state),contacts=[];
    for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++) {
      const a=list[i],b=list[j];
      if(this.config.allowedCollisionPairs?.some(p=>p.includes(a.id)&&p.includes(b.id))) continue;
      if(a.kind==='static'&&b.kind==='static') continue;
      if(a.robot&&a.robot===b.robot&&this.config.robots[a.robot].allowedSelfPairs.some(p=>p.includes(a.link)&&p.includes(b.link))) continue;
      const robot=a.kind==='robot'?a:b,object=a.kind==='object'?a:b;
      if(robot.kind==='robot'&&object.kind==='object'&&robot.link>=6&&(object.owner===robot.robot||allowedGrasps.some(p=>p.robot===robot.robot&&p.object===object.id))) continue;
      const contact=a.shape.contactShape(a.position,a.rotation,b.shape,b.position,b.rotation,margin);
      if(contact&&contact.distance<margin-1e-6) contacts.push({a:a.id,b:b.id,distance:contact.distance});
    }
    return contacts;
  }
}
