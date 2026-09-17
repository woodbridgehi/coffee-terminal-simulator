import {validateWorld,clone} from '../schema.mjs';
export class DeviceError extends Error {
  constructor(code,message,status=400){super(message??code);this.code=code;this.status=status;}
}
export const ensure=(ok,code,message,status)=>{if(!ok)throw new DeviceError(code,message,status);};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const keys=(obj,allowed)=>plain(obj)&&Object.keys(obj).every(k=>allowed.includes(k));
const number=(v,min=0,max=3600)=>Number.isFinite(v)&&v>=min&&v<=max;
const timingKeys=['ackDelayMs','startDelaySeconds','sensorDelaySeconds','warmupSeconds','durationSeconds','cooldownSeconds','cleanSeconds','resetSeconds','graspSeconds','releaseSeconds'];
export function actionsFor(p){
  return p.kind==='robot'?['move','grasp','release','transfer','stop','reset']:p.kind==='dispenser'?['dispense','reset']:p.kind==='lidder'?['seal','reset']:['process','clean','reset'];
}
export function cancellable(p,action){return action==='reset'||action==='clean'||(p.kind!=='lidder'&&action!=='dispense');}
export function validateProfile(id,p,world){
  ensure(keys(p,['kind','model','timing','motion','process','stock']),'INVALID_CONFIG',`${id}: unknown profile fields`);
  ensure(['robot','processor','dispenser','lidder'].includes(p.kind)&&typeof p.model==='string'&&p.model.length>0&&p.model.length<=120,'INVALID_CONFIG',`${id}: kind/model`);
  ensure(keys(p.timing,timingKeys)&&timingKeys.every(k=>number(p.timing[k],['durationSeconds','cleanSeconds','resetSeconds','graspSeconds','releaseSeconds'].includes(k)?.02:0,k==='ackDelayMs'?30000:3600)),'INVALID_CONFIG',`${id}: timing`);
  if(p.kind==='robot'){
    ensure(world.robots[id]&&keys(p.motion,['limits'])&&p.motion.limits?.length===6,'INVALID_CONFIG',`${id}: robot limits`);
    ensure(p.motion.limits.every(l=>keys(l,['min','max','velocity','acceleration','jerk'])&&number(l.min,-100,100)&&number(l.max,-100,100)&&l.min<l.max&&number(l.velocity,.01,12)&&number(l.acceleration,.01,100)&&number(l.jerk,.01,1000)),'INVALID_CONFIG',`${id}: limits`);
    ensure(!p.process&&!p.stock,'INVALID_CONFIG',`${id}: robot fields`);
  }else{
    ensure(keys(p.process,['station','object','outputKg','inputs'])&&world.stations[p.process.station]&&!p.motion,'INVALID_CONFIG',`${id}: process station`);
    if(p.kind==='dispenser')ensure(world.objects[p.process.object]&&p.process.outputKg===undefined&&p.process.inputs===undefined,'INVALID_CONFIG',`${id}: dispenser object`);
    else {
      ensure(number(p.process.outputKg,p.kind==='lidder'?0:.0001,10)&&Array.isArray(p.process.inputs)&&p.process.inputs.every(i=>keys(i,['material','amount'])&&world.materials[i.material]&&number(i.amount,.0001,10)),'INVALID_CONFIG',`${id}: dose`);
      ensure(p.kind!=='lidder'||(p.process.outputKg===0&&p.process.inputs.length===0),'INVALID_CONFIG',`${id}: seal must not dispense material`);
    }
    if(['dispenser','lidder'].includes(p.kind))ensure(keys(p.stock,['initial','capacity'])&&Number.isInteger(p.stock.initial)&&Number.isInteger(p.stock.capacity)&&number(p.stock.capacity,1,10000)&&number(p.stock.initial,0,p.stock.capacity),'INVALID_CONFIG',`${id}: stock`);
    else ensure(!p.stock,'INVALID_CONFIG',`${id}: unsupported stock`);
  }
  return clone(p);
}
export function prepareWorld(base,config){
  ensure(keys(config,['schemaVersion','clock','materials','devices'])&&config.schemaVersion===1&&keys(config.clock,['mode','rate'])&&['realtime','manual','accelerated'].includes(config.clock.mode)&&number(config.clock.rate,.1,32),'INVALID_CONFIG','clock/config');
  ensure(config.clock.mode!=='realtime'||config.clock.rate===1,'INVALID_CONFIG','realtime requires rate=1');
  const world=clone(base);world.materials=clone(config.materials);
  ensure(plain(world.materials)&&Object.entries(world.materials).every(([id,m])=>/^[a-z][a-z0-9_-]*$/i.test(id)&&keys(m,['amount'])&&number(m.amount,0,1000)),'INVALID_CONFIG','materials');
  ensure(plain(config.devices)&&Object.keys(config.devices).length<=32,'INVALID_CONFIG','devices');
  for(const id of ['left','right','brewer','foamer','hot-water','lidder','cup-dispenser','ice-maker','syrup-pump'])ensure(config.devices[id],'INVALID_CONFIG',`missing device ${id}`);
  world.devices={};world.supplies={};
  for(const [id,p] of Object.entries(config.devices)){
    ensure(/^[a-z][a-z0-9_-]*$/i.test(id),'INVALID_CONFIG','device ID');validateProfile(id,p,world);
    if(p.kind==='robot'){world.robots[id].limits=clone(p.motion.limits);continue;}
    const t=p.timing;
    world.devices[id]={station:p.process.station,warmup:t.warmupSeconds,duration:t.durationSeconds,cooldown:t.cooldownSeconds,outputKg:p.process.outputKg??0,inputs:clone(p.process.inputs??[])};
    if(p.kind==='dispenser'){
      world.devices[id].effect='dispense';world.devices[id].object=p.process.object;world.objects[p.process.object].present=false;
    }
    if(p.kind==='lidder')world.devices[id].effect='seal';
    if(p.stock){const supply=`${id}-stock`;world.supplies[supply]={amount:p.stock.initial,capacity:p.stock.capacity};world.devices[id].supply=supply;}
  }
  try{validateWorld(world);}catch(error){throw new DeviceError('INVALID_CONFIG',error.message);}
  return world;
}
