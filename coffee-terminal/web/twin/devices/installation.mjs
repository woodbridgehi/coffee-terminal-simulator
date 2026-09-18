import {CollisionChecker,syncAttachments} from '../collision.mjs';
import {compose,relative,ik} from '../robot.mjs';
import {Quaternion} from 'three/src/math/Quaternion.js';
import {ensure} from './profile.mjs';
const pair=h=>[h.a,h.b].sort().join('|');
// Build a candidate state, then check before publishing any configuration.
export function checkInstallation(previous,world,state){
 const candidate=structuredClone(state);
 ensure(!Object.values(state.objects).some(o=>o.owner),'INSTALLATION_HOLDING_OBJECT','Release held objects before changing installation',409);
 for(const [id,o] of Object.entries(candidate.objects)){
  const station=Object.keys(previous.stations).find(k=>Math.hypot(...o.pose.position.map((v,i)=>v-previous.stations[k].pose.position[i]))<.002);
  if(station)o.pose=compose(world.stations[station].pose,relative(previous.stations[station].pose,o.pose));
 }
 syncAttachments(world,candidate);
 const oldChecker=new CollisionChecker(previous),checker=new CollisionChecker(world),oldHits=new Set(oldChecker.check(state).map(pair));
 const hit=checker.check(candidate).find(h=>!oldHits.has(pair(h)));
 ensure(!hit,'INSTALLATION_COLLISION',hit?`${hit.a} / ${hit.b}`:'',409);
 // The normal motion checker skips static/static. Layout editing must check them.
 const before=oldChecker.shapes(state).filter(s=>s.kind==='static'),after=checker.shapes(candidate).filter(s=>s.kind==='static');
 for(let i=0;i<after.length;i++)for(let j=i+1;j<after.length;j++){
  const a=after[i],b=after[j],oldA=before.find(s=>s.id===a.id),oldB=before.find(s=>s.id===b.id);
  if(world.allowedCollisionPairs?.some(p=>p.includes(a.id)&&p.includes(b.id)))continue;
  const depth=(x,y)=>x.shape.contactShape(x.position,x.rotation,y.shape,y.position,y.rotation,0)?.distance??0;
  const d=depth(a,b);ensure(d>=Math.min(-.002,depth(oldA,oldB))-.00001,'INSTALLATION_COLLISION',`${a.id} / ${b.id}`,409);
 }
 const changed=Object.keys(world.stations).filter(k=>JSON.stringify(world.stations[k].pose)!==JSON.stringify(previous.stations[k].pose));
 const robotChanged=JSON.stringify(world.robots)!==JSON.stringify(previous.robots);
 const targets=robotChanged?Object.keys(world.stations):changed;
 for(const key of targets){
  const position=world.stations[key].pose.position;
  const reachable=Object.entries(world.robots).some(([id,r])=>{if(key.endsWith('-ready')&&key!==`${id}-ready`)return false;const yaw=Math.atan2(-(position[0]-r.base.position[0]),position[1]-r.base.position[1]);try{ik(r,{position,quaternion:new Quaternion().setFromAxisAngle({x:0,y:0,z:1},yaw).toArray()},candidate.robots[id].q);return true;}catch{return false;}});
  ensure(reachable,'INSTALLATION_UNREACHABLE',`No robot IK solution for ${key}`,409);
 }
 return {state:candidate,validation:{currentCollision:'passed',changedWorkpoints:changed,checkedWorkpoints:targets,reachability:targets.length?'IK checked; paths checked when executing':'unchanged',note:'Sampled collision proxies; not a hardware safety certification'}};
}
