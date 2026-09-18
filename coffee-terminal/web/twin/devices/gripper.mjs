// Independent parallel-jaw actuator. Units: mm, mm/s, kg, simulation seconds.
// This module deliberately does not attach objects or alter the legacy grasp planner.
import {ensure} from './profile.mjs';
export const gripperActions=['open','close','setOpening','stop','reset'];
export function validateGripper(p,world){
 const g=p.gripper,fields=['robot','maxOpeningMm','initialOpeningMm','openingSpeedMmS','closingSpeedMmS','massKg','maxPayloadKg'];
 ensure(g&&typeof g==='object'&&!Array.isArray(g)&&Object.keys(g).every(k=>fields.includes(k))&&world.robots[g.robot],'INVALID_CONFIG','gripper mounting robot');
 for(const k of fields.slice(1))ensure(Number.isFinite(g[k]),'INVALID_CONFIG',`gripper ${k}`);
 ensure(g.maxOpeningMm>0&&g.maxOpeningMm<=85&&g.initialOpeningMm>=0&&g.initialOpeningMm<=g.maxOpeningMm,'INVALID_CONFIG','gripper opening range 0..85 mm');
 ensure(g.openingSpeedMmS>=.1&&g.openingSpeedMmS<=42.5&&g.closingSpeedMmS>=.1&&g.closingSpeedMmS<=42.5,'INVALID_CONFIG','gripper speed range [0.1,42.5] mm/s');
 ensure(g.massKg===.7&&g.maxPayloadKg>0&&g.maxPayloadKg<=2&&!p.motion&&!p.process&&!p.stock,'INVALID_CONFIG','gripper mass/payload/profile');
}
export function initialGripper(p){return {robot:p.gripper.robot,openingMm:p.gripper.initialOpeningMm,targetOpeningMm:p.gripper.initialOpeningMm,speedMmS:0,mode:'idle'};}
export function gripperSensors(runtime,id){
 const p=runtime.config.devices[id],g=runtime.sim.state.grippers[id];
 const held=Object.entries(runtime.sim.state.objects).find(([,o])=>o.owner===p.gripper.robot);
 const width=held?runtime.sim.config.objects[held[0]].radius*2000:0;
 const load=held?runtime.sim.config.objects[held[0]].tareKg+Object.values(held[1].contents).reduce((a,b)=>a+b,0):0;
 return {ready:g.mode==='idle'&&!runtime.links[id]?.fault,openingMm:g.openingMm,targetOpeningMm:g.targetOpeningMm,moving:g.mode==='running',atTarget:Math.abs(g.openingMm-g.targetOpeningMm)<1e-6,robotHoldingObject:!!held,heldObjectWidthMm:width,openingCompatible:width<=p.gripper.maxOpeningMm,payloadKg:load,payloadWithinLimit:load<=p.gripper.maxPayloadKg};
}
export function gripperTask(runtime,r){
 const p=runtime.config.devices[r.deviceId],g=runtime.sim.state.grippers[r.deviceId],v=r.parameters;
 const allowed=r.action==='setOpening'?['openingMm','speedMmS']:['open','close'].includes(r.action)?['speedMmS']:[];
 ensure(Object.keys(v).every(k=>allowed.includes(k)),'INVALID_PARAMETERS','Unsupported gripper parameters');
 const task={id:r.commandId,type:'wait',after:[],resources:[`robot:${p.gripper.robot}`],duration:p.timing.resetSeconds};
 if(['stop','reset'].includes(r.action))return task;
 ensure(!Object.values(runtime.sim.state.objects).some(o=>o.owner===p.gripper.robot),'ROBOT_HOLDING_OBJECT','Release the object through the existing robot interface before independent jaw movement',409);
 const target=r.action==='open'?p.gripper.maxOpeningMm:r.action==='close'?0:v.openingMm;
 ensure(Number.isFinite(target)&&target>=0&&target<=p.gripper.maxOpeningMm,'INVALID_PARAMETERS','openingMm outside configured range');
 const speed=v.speedMmS??p.gripper[target>=g.openingMm?'openingSpeedMmS':'closingSpeedMmS'];
 ensure(Number.isFinite(speed)&&speed>=.1&&speed<=42.5,'INVALID_PARAMETERS','speedMmS must be in [0.1,42.5]');
 task.duration=Math.max(runtime.sim.config.dt,Math.abs(target-g.openingMm)/speed);
 r.jawMotion={from:g.openingMm,target,speed};return task;
}
export function advanceGrippers(runtime){
 for(const r of runtime.records.values()){
  if(!['ACCEPTED','RUNNING'].includes(r.status)||runtime.config.devices[r.deviceId].kind!=='gripper'||!r.jawMotion)continue;
  const task=runtime.sim.state.tasks[r.commandId];if(!task||!['running','done'].includes(task.status))continue;
  const g=runtime.sim.state.grippers[r.deviceId],m=r.jawMotion;
  const distance=Math.min(Math.abs(m.target-m.from),task.elapsed*m.speed);
  g.openingMm=m.from+Math.sign(m.target-m.from)*distance;g.targetOpeningMm=m.target;g.speedMmS=task.status==='running'?m.speed:0;g.mode=task.status==='running'?'running':'idle';
 }
}
export function stopGripper(runtime,id){const g=runtime.sim.state.grippers?.[id];if(g){g.speedMmS=0;g.fault=runtime.links[id]?.fault??null;g.mode=g.fault?'fault':'idle';}}
