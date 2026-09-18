// Independent parallel-jaw actuator. Units: mm, mm/s, kg, simulation seconds.
// Aperture follows command time; object attachment stays in the existing kernel.
import {ensure} from './profile.mjs';
export const gripperActions=['open','close','setOpening','stop','reset'];
export function validateGripper(p,world){
 const g=p.gripper,fields=['robot','maxOpeningMm','initialOpeningMm','openingSpeedMmS','closingSpeedMmS','massKg','maxPayloadKg'];
 ensure(g&&typeof g==='object'&&!Array.isArray(g)&&Object.keys(g).every(k=>fields.includes(k))&&world.robots[g.robot],'INVALID_CONFIG','gripper mounting robot');
 for(const k of fields.slice(1))ensure(Number.isFinite(g[k]),'INVALID_CONFIG',`gripper ${k}`);
 ensure(g.maxOpeningMm>0&&g.maxOpeningMm<=120&&g.initialOpeningMm>=0&&g.initialOpeningMm<=g.maxOpeningMm,'INVALID_CONFIG','gripper opening range 0..120 mm');
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
 r.jawMotion={toolId:r.deviceId,phases:[{from:g.openingMm,target,speed,duration:Math.abs(target-g.openingMm)/speed}]};return task;
}
export function linkRobotGrasp(runtime,r,task){
 if(!['grasp','release'].includes(r.action))return;
 const entry=Object.entries(runtime.config.devices).find(([,p])=>p.gripper?.robot===r.deviceId);if(!entry)return;
 const [id,p]=entry,g=runtime.sim.state.grippers[id],def=runtime.sim.config.objects[r.parameters.object];
 ensure(runtime.links[id].online&&!runtime.links[id].fault,'TOOL_UNAVAILABLE','Mounted gripper is offline or faulted',409);
 const width=def.radius*2000,object=runtime.sim.state.objects[r.parameters.object];
 if(r.action==='grasp'){
  ensure(width<=p.gripper.maxOpeningMm,'GRIPPER_TOO_SMALL','Object exceeds configured opening',409);
  ensure(def.tareKg+Object.values(object.contents).reduce((a,b)=>a+b,0)<=p.gripper.maxPayloadKg,'GRIPPER_OVERLOAD','Object exceeds configured payload',409);
 }
 const phases=[];let from=g.openingMm;
 const add=target=>{const speed=p.gripper[target>=from?'openingSpeedMmS':'closingSpeedMmS'];phases.push({from,target,speed,duration:Math.abs(target-from)/speed});from=target;};
 if(r.action==='grasp'){if(from<width+.5)add(p.gripper.maxOpeningMm);add(width);}else add(p.gripper.maxOpeningMm);
 r.jawMotion={toolId:id,phases};task.duration=Math.max(task.duration,phases.reduce((n,p)=>n+p.duration,0));
}
export function advanceGrippers(runtime){
 for(const r of runtime.records.values()){
  if(!['ACCEPTED','RUNNING'].includes(r.status)||!r.jawMotion)continue;
  const task=runtime.sim.state.tasks[r.commandId];if(!task||!['running','done'].includes(task.status))continue;
  const g=runtime.sim.state.grippers[r.jawMotion.toolId],phases=r.jawMotion.phases;let elapsed=task.elapsed;
  for(const m of phases){
   const distance=Math.min(Math.abs(m.target-m.from),Math.max(0,elapsed)*m.speed);
   g.openingMm=m.from+Math.sign(m.target-m.from)*distance;g.speedMmS=elapsed<m.duration?m.speed:0;
   if(elapsed<m.duration)break;elapsed-=m.duration;
  }
  g.targetOpeningMm=phases.at(-1).target;g.mode=task.status==='running'?'running':'idle';if(task.status==='done')g.speedMmS=0;
 }
}
export function stopGripper(runtime,id){const g=runtime.sim.state.grippers?.[id];if(g){g.speedMmS=0;g.fault=runtime.links[id]?.fault??null;g.mode=g.fault?'fault':'idle';}}
