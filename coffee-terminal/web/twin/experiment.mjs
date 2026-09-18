import {Simulation} from './kernel.mjs';
import {initialGripper,linkRobotGrasp,advanceGrippers,stopGripper} from './devices/gripper.mjs';
import {cupOnPad} from './cup-sensor.mjs';
import {experimentTasks} from './shared-config.mjs';
// Shared configurations run independently: no HTTP, live commands or device faults
// are copied into the experiment. Communication timing belongs to the device lab.
class SharedExperiment extends Simulation {
 constructor(config,tasks,options){
  super(config,tasks,options);
  this.hardware={sim:this,config:config.sharedDeviceConfig,links:Object.fromEntries(Object.keys(config.sharedDeviceConfig.devices).map(id=>[id,{online:true,fault:null}])),records:new Map()};
  this.state.grippers=Object.fromEntries(Object.entries(this.hardware.config.devices).filter(([,p])=>p.kind==='gripper').map(([id,p])=>[id,initialGripper(p)]));
  this.sensorPending=[];this.lastCupSignal=null;this.trace=[];this.capture();
 }
 start(task){
  if(!super.start(task))return false;
  if(['grasp','release'].includes(task.type)){
   const r={commandId:task.id,deviceId:task.robot,action:task.type,parameters:{object:task.object},status:'RUNNING'},copy={...task};
   try{linkRobotGrasp(this.hardware,r,copy);this.active.get(task.id).ticks=Math.max(1,Math.ceil(copy.duration/this.config.dt));this.hardware.records.set(task.id,r);}
   catch(e){this.fail(task,e.code??e.message);return false;}
  }
  return true;
 }
 syncHardware(){
  if(!this.hardware)return;
  advanceGrippers(this.hardware);
  for(const r of this.hardware.records.values())if(r.status==='RUNNING'&&(['done','failed','cancelled'].includes(this.state.tasks[r.commandId].status)||this.state.status==='collision')){r.status=this.state.tasks[r.commandId].status==='done'?'SUCCEEDED':'FAILED';stopGripper(this.hardware,r.jawMotion?.toolId);}
  const dispenser=Object.entries(this.config.devices).find(([,d])=>d.effect==='dispense');if(!dispenser)return;
  const [id,d]=dispenser,signal=cupOnPad(this.config,this.state,id);
  this.state.deviceSensors??={};
  if(this.lastCupSignal===null)this.state.deviceSensors[id]={cupPresent:signal,cupSensorEnabled:d.cupSensor.enabled};
  else if(signal!==this.lastCupSignal)this.sensorPending.push({due:this.state.time+this.hardware.config.devices[id].timing.sensorDelaySeconds,value:signal});
  this.lastCupSignal=signal;
  while(this.sensorPending[0]?.due<=this.state.time+1e-9)this.state.deviceSensors[id].cupPresent=this.sensorPending.shift().value;
 }
 capture(){this.syncHardware();super.capture();}
 step(){const result=super.step();this.syncHardware();return result;}
}
export async function createExperiment(config,tasks=experimentTasks(config),options={}){
 // Init Rapier before constructing either implementation.
 if(!config.sharedDeviceConfig)return Simulation.create(config,tasks,options);
 const ready=await Simulation.create(config,[],{record:false});
 return new SharedExperiment(ready.config,tasks,options);
}
