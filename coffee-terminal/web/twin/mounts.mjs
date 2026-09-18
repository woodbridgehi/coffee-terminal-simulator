// Installation frames are CPU-only, Z-up, metres; UI angles use XYZ degrees.
import {Euler} from 'three/src/math/Euler.js';
import {Quaternion} from 'three/src/math/Quaternion.js';
import {compose,relative,fk} from './robot.mjs';
const copy=structuredClone;
export const identity=()=>({position:[0,0,0],quaternion:[0,0,0,1]});
const check=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'INVALID_MOUNT',status:400});};
export function mountPose(m){return {position:[...m.position],quaternion:new Quaternion().setFromEuler(new Euler(...m.rotationDeg.map(v=>v*Math.PI/180),'XYZ')).toArray()};}
export function poseMount(parent,p){return {parent,position:[...p.position],rotationDeg:new Euler().setFromQuaternion(new Quaternion(...p.quaternion),'XYZ').toArray().slice(0,3).map(v=>v*180/Math.PI)};}
export function prepareMounts(base,world,profiles){
 const table=base.obstacles.find(o=>o.id==='table'),surface=table?compose(table.pose,{position:[0,0,table.size[2]/2],quaternion:[0,0,0,1]}):identity();
 const nodes={world:{pose:identity()},'table:top':{pose:surface}},defaults={},references={};
 for(const [id,p] of Object.entries(profiles)){
  if(p.kind==='gripper')defaults[id]={parent:`${p.gripper.robot}:flange`,position:[0,0,0],rotationDeg:[0,0,0]};
  else{const ref=copy(p.kind==='robot'?base.robots[id].base:base.stations[p.process.station].pose);if(p.kind!=='robot')ref.position[2]=surface.position[2];references[id]=ref;defaults[id]=poseMount('table:top',relative(surface,ref));}
 }
 const mounts=Object.fromEntries(Object.entries(profiles).map(([id,p])=>[id,copy(p.mounting??defaults[id])]));
 for(const [id,m] of Object.entries(mounts)){
  check(m&&Object.keys(m).every(k=>['parent','position','rotationDeg'].includes(k))&&typeof m.parent==='string','Invalid mounting fields');
  check(['position','rotationDeg'].every(k=>Array.isArray(m[k])&&m[k].length===3&&m[k].every(v=>Number.isFinite(v)&&Math.abs(v)<=(k==='position'?20:360))),`Invalid pose: ${id}`);
  const p=profiles[id];
  if(p.kind==='gripper')check(m.parent===`${p.gripper.robot}:flange`,'A tool must use its own robot flange');
  else check(m.parent==='world'||m.parent==='table:top'||(profiles[m.parent]?.kind&&!['robot','gripper'].includes(profiles[m.parent].kind)),`Unknown or dynamic installation parent: ${m.parent}`);
 }
 const visiting=new Set();
 const resolve=id=>{
  if(nodes[id])return nodes[id].pose;
  check(!visiting.has(id),`Installation cycle at ${id}`);visiting.add(id);
  const m=mounts[id];check(m,`Missing parent ${id}`);const parent=resolve(m.parent),pose=compose(parent,mountPose(m));
  nodes[id]={parent:m.parent,local:mountPose(m),pose};visiting.delete(id);return pose;
 };
 for(const [id,p] of Object.entries(profiles))if(p.kind!=='gripper')resolve(id);
 const deltas={};
 for(const [id,ref] of Object.entries(references)){
  // Exact identity for legacy/default installations avoids perturbing golden trajectories.
  const pose=nodes[id].pose;if(pose.position.every((v,i)=>Math.abs(v-ref.position[i])<1e-12)&&pose.quaternion.every((v,i)=>Math.abs(v-ref.quaternion[i])<1e-12)){nodes[id].pose=copy(ref);deltas[id]=identity();}
  else deltas[id]=compose(pose,relative(ref,identity()));
  const p=profiles[id],delta=deltas[id],move=pose=>JSON.stringify(delta)===JSON.stringify(identity())?copy(pose):compose(delta,pose);
  if(p.kind==='robot'){world.robots[id].base=move(base.robots[id].base);if(base.stations[`${id}-ready`])world.stations[`${id}-ready`].pose=move(base.stations[`${id}-ready`].pose);}
  else{
   const station=p.process.station;world.stations[station].pose=move(base.stations[station].pose);
   for(const obstacle of world.obstacles)if(obstacle.id.startsWith(`${station}-`)||(id==='cup-dispenser'&&obstacle.id==='cup-magazine'))obstacle.pose=move(base.obstacles.find(o=>o.id===obstacle.id).pose);
   for(const [key,o] of Object.entries(base.objects))if(Math.hypot(...o.pose.position.map((v,i)=>v-base.stations[station].pose.position[i]))<.001)world.objects[key].pose=move(o.pose);
  }
 }
 for(const [id,p] of Object.entries(profiles))if(p.kind==='gripper'){
  const robot=p.gripper.robot;nodes[`${robot}:flange`]={dynamic:true,robot};nodes[id]={parent:mounts[id].parent,local:mountPose(mounts[id]),dynamic:true,robot};
  world.robots[robot].tool=compose(mountPose(mounts[id]),base.robots[robot].tool);
 }
 world.installation={nodes,defaults,mounts,references,deltas,nominalTools:Object.fromEntries(Object.entries(base.robots).map(([id,r])=>[id,copy(r.tool)]))};
 return world;
}
export function installationPose(world,state,id){
 const node=world.installation?.nodes[id];if(!node)return null;if(!node.dynamic)return node.pose;
 const flange=fk({...world.robots[node.robot],tool:identity()},state.robots[node.robot].q);
 return node.local?compose(flange,node.local):flange;
}
