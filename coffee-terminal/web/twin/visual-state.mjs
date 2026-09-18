import {Vector3,Quaternion} from 'three';
import {fk} from './robot.mjs';
// Only the presentation boundary converts coordinates. The simulation stays Z-up.
const turn=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2);
export function scenePosition(position){return new Vector3(...position).applyQuaternion(turn);}
export function armVisualState(config,state){
  const pose=fk(config,state.q);
  return {pose,points:[...pose.frames.map(p=>p.position),pose.position]};
}
export function containerFill(def,state){
  const mass=Object.values(state.contents).reduce((a,b)=>a+b,0);
  return {mass,fraction:Math.min(1,Math.max(0,mass/def.capacityKg)),milkFraction:mass?Math.min(1,(state.contents.foamer??0)/mass):0};
}
