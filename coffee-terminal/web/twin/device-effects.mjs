import * as THREE from 'three';
import {cupVisual} from './visuals.mjs';
import {devicePhase,dispensePresentation} from './effect-state.mjs';
export class DeviceEffects {
 constructor(root,config){
  this.config=config;this.group=new THREE.Group();this.group.name='device-action-effects';root.add(this.group);this.streams={};this.particles={};
  const ghost=cupVisual(config.objects.cup);this.cup=new THREE.Group();this.cup.add(ghost.group);this.cup.visible=false;this.group.add(this.cup);this.ready=ghost.ready;
  const colors={brewer:'#593421',foamer:'#eee5d5','hot-water':'#b7d7cf','syrup-pump':'#ba8244'};
  for(const [id,def] of Object.entries(config.devices)){
   if(def.effect==='dispense'||def.effect==='seal')continue;
   const stream=new THREE.Mesh(new THREE.CylinderGeometry(.004,.006,1,10),new THREE.MeshStandardMaterial({color:colors[id]??'#e0f1eb',transparent:true,opacity:id==='hot-water'?.6:.9,roughness:.45}));this.group.add(stream);stream.visible=false;this.streams[id]=stream;
   const particles=Array.from({length:7},()=>{const p=new THREE.Mesh(id==='ice-maker'?new THREE.BoxGeometry(.018,.018,.018):new THREE.SphereGeometry(.006,8,6),new THREE.MeshBasicMaterial({color:id==='ice-maker'?'#cce8e3':'#f6f0e5',transparent:true,opacity:.5}));this.group.add(p);p.visible=false;return p;});this.particles[id]=particles;
  }
  this.pour=new THREE.Mesh(new THREE.CylinderGeometry(.004,.007,1,10),new THREE.MeshStandardMaterial({color:'#eee5d5'}));this.group.add(this.pour);this.pour.visible=false;
 }
 line(mesh,a,b){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);mesh.position.copy(start.add(end).multiplyScalar(.5));mesh.scale.y=delta.length();mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());mesh.visible=true;}
 apply(state){
  this.cup.visible=false;this.pour.visible=false;const active=[];
  for(const [id,def] of Object.entries(this.config.devices)){
   const p=devicePhase(state,id),station=this.config.stations[def.station].pose;
   if(def.effect==='dispense'){
    const drop=dispensePresentation(state,id);if(drop&&state.objects[def.object].present===false){this.cup.visible=true;this.cup.position.fromArray(station.position);this.cup.position.z+=drop.height;this.cup.quaternion.fromArray(station.quaternion);active.push(`落杯器：${drop.phase}`);}continue;
   }
   const stream=this.streams[id],particles=this.particles[id];if(!stream)continue;stream.visible=false;particles.forEach(p=>p.visible=false);if(p===null)continue;
   const object=Object.entries(state.objects).find(([,o])=>o.present!==false&&!o.owner&&Math.hypot(...o.pose.position.map((v,i)=>v-station.position[i]))<.02);
   if(!object)continue;const [key,o]=object,top=[...o.pose.position];top[2]+=this.config.objects[key].height/2;
   if(id!=='ice-maker')this.line(stream,[top[0],top[1],top[2]+.19],top);
   if(['foamer','hot-water','ice-maker'].includes(id))particles.forEach((mesh,i)=>{const phase=(state.time*(id==='ice-maker'?1.5:.55)+i/7)%1;mesh.visible=true;mesh.position.set(top[0]+Math.sin(i*2.4+state.time)*.025,top[1]+Math.cos(i*2.4)*.025,top[2]+(id==='ice-maker'?(1-phase)*.18:phase*.12));mesh.scale.setScalar(id==='ice-maker'?1:.5+phase);mesh.rotation.set(phase*3,i,phase);});
   active.push(`${id==='brewer'?'咖啡萃取':id==='foamer'?'奶泡加工':id==='hot-water'?'热水出料':id==='ice-maker'?'冰块出料':'糖浆出料'} ${Math.round(p*100)}%`);
  }
  for(const [robot,r] of Object.entries(state.robots))if(r.mode==='transfer'){
   const source=Object.entries(state.objects).find(([,o])=>o.owner===robot),target=state.objects.cup;if(!source||!target||target.owner)continue;
   const from=[...source[1].pose.position],to=[...target.pose.position];from[2]+=this.config.objects[source[0]].height*.35;to[2]+=this.config.objects.cup.height*.4;this.line(this.pour,from,to);active.push('倒奶：物料转移');
  }
  if(state.devices.lidder?.mode==='running')active.push('封盖：下压 / 回升');
  for(const g of Object.values(state.grippers??{}))if(g.mode==='running')active.push(`夹爪：${g.openingMm.toFixed(1)} → ${g.targetOpeningMm.toFixed(1)} mm`);
  return active;
 }
}
