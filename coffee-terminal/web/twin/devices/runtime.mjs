import {checkInstallation} from './installation.mjs';
import {linkRobotGrasp,initialGripper,gripperSensors,gripperTask,advanceGrippers,stopGripper} from './gripper.mjs';
import {Simulation} from '../kernel.mjs';
import {fk,vec} from '../robot.mjs';
import {clone} from '../schema.mjs';
import {DeviceError,ensure,prepareWorld,actionsFor,cancellable} from './profile.mjs';
const terminal=s=>['SUCCEEDED','FAILED','REJECTED','CANCELLED','EXPIRED'].includes(s);
const canonical=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
const idOK=id=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(id);
export class DeviceRuntime {
  static async create(base,config){const r=new DeviceRuntime(base,config);await r.reset();return r;}
  constructor(base,config){this.base=clone(base);this.config=clone(config);prepareWorld(base,config);}
  async reset(config=this.config){
    const world=prepareWorld(this.base,config),sim=await Simulation.create(world,[],{record:false,external:true});
    if(Object.values(config.devices).some(p=>p.mounting)){const original=prepareWorld(this.base,{...config,devices:Object.fromEntries(Object.entries(config.devices).map(([id,p])=>{const c=clone(p);delete c.mounting;return [id,c];}))});const baseline=await Simulation.create(original,[],{record:false,external:true});const checked=checkInstallation(original,world,baseline.state);world.installation.validation=checked.validation;}
    this.installationRevision=0;this.config=clone(config);this.sim=sim;this.sessionId=crypto.randomUUID();this.records=new Map();this.events=[];this.outbox=[];this.sequence=0;this.links={};this.sensors={};
    this.sim.state.grippers=Object.fromEntries(Object.entries(config.devices).filter(([,p])=>p.kind==='gripper').map(([id,p])=>[id,initialGripper(p)]));
    for(const id of Object.keys(config.devices)){
      this.links[id]={online:true,fault:null,dropNextAck:false,dropNextCompletion:false,faultAfterSeconds:null,forcedSensors:{}};
      this.sensors[id]={values:this.actualSensors(id),observedAt:0,pending:[],lastActual:this.actualSensors(id)};
    }
    this.emit('session.started',{});return this.snapshot();
  }
  checkSession(id){ensure(id===this.sessionId,'SESSION_MISMATCH','Read the new sessionId; commands from an old instance cannot be replayed',409);}
  profile(id){ensure(Object.hasOwn(this.config.devices,id),'UNKNOWN_DEVICE',id,404);return this.config.devices[id];}
  emit(type,data,deliver=true){const e={id:++this.sequence,sessionId:this.sessionId,time:this.sim.state.time,type,...clone(data)};this.events.push(e);if(this.events.length>2000)this.events.shift();if(deliver)this.outbox.push(e);}
  drain(){const events=this.outbox;this.outbox=[];return events;}
  update(record,status,reason=null){
    if(record.status===status&&record.reason===reason)return;
    record.status=status;record.reason=reason;
    if(status==='RUNNING')record.startedAt=this.sim.state.tasks[record.commandId]?.startedAt??this.sim.state.time;
    if(terminal(status)){record.finishedAt=this.sim.state.time;if(status!=='REJECTED')stopGripper(this,record.jawMotion?.toolId??record.deviceId);}
    const link=this.links[record.deviceId],drop=terminal(status)&&link.dropNextCompletion;
    if(drop)link.dropNextCompletion=false;
    this.emit('command.updated',{command:this.publicRecord(record)},link.online&&!drop);
    if(drop)this.emit('communication.completion_dropped',{commandId:record.commandId});
  }
  actualSensors(id){
    const p=this.config.devices[id],s=this.sim.state;
    if(p.kind==='gripper')return gripperSensors(this,id);
    if(p.kind==='robot')return {ready:!this.links?.[id]?.fault,gripperHasObject:Object.values(s.objects).some(o=>o.owner===id)};
    const d=s.devices[id],station=this.sim.config.stations[p.process.station].pose.position;
    const cupPresent=Object.values(s.objects).some(o=>o.present!==false&&!o.owner&&vec(o.pose.position).distanceTo(vec(station))<.02);
    return {ready:d.mode==='idle'&&!d.fault,cupPresent,...(p.stock?{stockRemaining:s.supplies[`${id}-stock`].amount}:{}),...(p.kind==='lidder'?{headPosition:d.mode==='running'?'working':'up'}:{})};
  }
  sampleSensors(){
    for(const id of Object.keys(this.config.devices)){
      const sensor=this.sensors[id],actual=this.actualSensors(id),time=this.sim.state.time;
      if(canonical(actual)!==canonical(sensor.lastActual)){sensor.pending.push({due:time+this.profile(id).timing.sensorDelaySeconds,values:actual});sensor.lastActual=actual;}
      while(sensor.pending[0]?.due<=time+1e-9){const next=sensor.pending.shift();sensor.values=next.values;sensor.observedAt=time;}
    }
  }
  device(id){
    const p=this.profile(id),s=this.sim.state,link=this.links[id];
    const active=[...this.records.values()].find(r=>(r.deviceId===id||r.jawMotion?.toolId===id)&&!terminal(r.status));
    const state=p.kind==='gripper'?clone(s.grippers[id]):p.kind==='robot'?{...s.robots[id],tcp:fk(this.sim.config.robots[id],s.robots[id].q)}:clone(s.devices[id]);
    if(p.kind==='gripper'&&active?.status==='RUNNING'&&active.action==='reset')state.mode='resetting';
    if(state.tcp)delete state.tcp.frames;
    const view={id,kind:p.kind,model:p.model,online:link.online,mode:link.fault?'fault':active?.status==='ACCEPTED'?'waiting':state.mode,fault:link.fault??state.fault??null,currentCommandId:active?.commandId??null,
      ...(p.kind==='gripper'?{hardwareInterface:{ratedOpeningMm:85,simulationOpeningLimitMm:120,connector:'6-pin aviation',electrical:'RS485',supportedProtocols:['serial','Modbus RTU','I/O'],transportImplemented:'HTTP simulation only'},compatibility:'Robot grasp/release animate aperture before logical attachment/release; no force/contact physics'}:{}),
      capabilities:actionsFor(p).map(action=>({action,cancellable:cancellable(p,action)})),state,
      sensors:{...clone(this.sensors[id].values),...link.forcedSensors},observedAt:this.sensors[id].observedAt,
      stock:p.stock?{...s.supplies[`${id}-stock`],capacity:p.stock.capacity}:null,configuration:clone(p)};
    if(!link.online&&link.lastView)return {...clone(link.lastView),online:false,mode:'offline'};
    link.lastView=clone(view);return view;
  }
  taskFor(r){
    const p=this.profile(r.deviceId),v=r.parameters,t={id:r.commandId,type:'wait',after:[],resources:[]};
    if(p.kind==='gripper')return gripperTask(this,r);
    const allowed={move:['station','approachObject'],grasp:['object'],release:['object','station'],transfer:['source','object','durationSeconds'],process:['object','amountKg'],seal:['object'],dispense:[],clean:[],reset:[],stop:[]}[r.action];
    ensure(allowed&&Object.keys(v).every(k=>allowed.includes(k)),'INVALID_PARAMETERS','Unsupported parameters');
    if(p.kind==='robot'){
      t.robot=r.deviceId;
      if(['move','release'].includes(r.action))ensure(this.sim.config.stations[v.station],'INVALID_PARAMETERS','Unknown station');
      if(['grasp','release','transfer'].includes(r.action))ensure(this.sim.state.objects[v.object],'INVALID_PARAMETERS','Unknown object');
      if(r.action==='move'){
        t.type='move';t.station=v.station;
        if(v.approachObject){ensure(this.sim.state.objects[v.approachObject],'INVALID_PARAMETERS','Unknown approach object');t.allowedGrasps=[{robot:r.deviceId,object:v.approachObject}];}
      }else if(['grasp','release'].includes(r.action)){t.type=r.action;t.object=v.object;if(v.station)t.station=v.station;t.duration=p.timing[r.action+'Seconds'];}
      else if(r.action==='transfer'){
        ensure(this.sim.state.objects[v.source]&&v.source!==v.object,'INVALID_PARAMETERS','Invalid source');
        ensure(v.durationSeconds===undefined||(Number.isFinite(v.durationSeconds)&&v.durationSeconds>=.02&&v.durationSeconds<=120),'INVALID_PARAMETERS','transfer duration');
        Object.assign(t,{type:'transfer',source:v.source,object:v.object,duration:v.durationSeconds??6,resources:['zone:handoff']});
      }
    }else{
      t.device=r.deviceId;
      if(['process','seal'].includes(r.action)){
        ensure(this.sim.state.objects[v.object],'INVALID_PARAMETERS','Unknown container');t.type='process';t.object=v.object;
        if(v.amountKg!==undefined){ensure(r.action==='process'&&Number.isFinite(v.amountKg)&&v.amountKg>0&&v.amountKg<=this.sim.config.objects[v.object].capacityKg,'INVALID_PARAMETERS','amountKg outside container capacity');t.doseKg=v.amountKg;}
      }else if(r.action==='dispense'){t.type='dispense';t.object=p.process.object;}
      else {t.type='wait';t.operation=r.action;t.duration=p.timing[r.action==='clean'?'cleanSeconds':'resetSeconds'];}
    }
    if(r.action==='reset'){t.type='wait';t.operation='reset';t.duration=p.timing.resetSeconds;}
    return t;
  }
  submit(body){
    this.checkSession(body.sessionId);const p=this.profile(body.deviceId);
    ensure(Object.keys(body).every(k=>['sessionId','commandId','deviceId','action','parameters','startWithinSeconds'].includes(k))&&idOK(body.commandId)&&typeof body.action==='string'&&body.parameters!==null&&(body.parameters===undefined||(typeof body.parameters==='object'&&!Array.isArray(body.parameters))),'INVALID_COMMAND','Command envelope');
    const request={deviceId:body.deviceId,action:body.action,parameters:body.parameters??{},startWithinSeconds:body.startWithinSeconds??30},fingerprint=canonical(request);
    const existing=this.records.get(body.commandId);
    if(existing){ensure(this.links[body.deviceId].online,'DEVICE_OFFLINE','Reconnect before querying the original command',503);ensure(existing.fingerprint===fingerprint,'COMMAND_ID_CONFLICT','Same commandId has different parameters',409);return {command:this.publicRecord(existing),duplicate:true,ackDelayMs:0};}
    ensure(this.records.size<10000,'SESSION_CAPACITY','Start a new session before submitting more commands',409);
    ensure(Number.isFinite(request.startWithinSeconds)&&request.startWithinSeconds>0&&request.startWithinSeconds<=3600,'INVALID_COMMAND','startWithinSeconds');
    const r={commandId:body.commandId,...clone(request),fingerprint,status:'ACCEPTED',reason:null,acceptedAt:this.sim.state.time,startedAt:null,finishedAt:null,result:null};
    let error;
    try{
      ensure(actionsFor(p).includes(r.action),'UNSUPPORTED_ACTION',r.action);
      ensure(this.links[r.deviceId].online,'DEVICE_OFFLINE','Device is disconnected',503);
      ensure(this.sim.state.status!=='collision','COLLISION_STOP','Reset the experiment after a collision',409);
      if(r.action!=='reset'&&r.action!=='stop')ensure(!this.links[r.deviceId].fault,'DEVICE_FAULT',this.links[r.deviceId].fault,409);
      ensure(r.action==='stop'||![...this.records.values()].some(c=>(c.deviceId===r.deviceId||c.jawMotion?.toolId===r.deviceId)&&!terminal(c.status)),'DEVICE_BUSY','Device already has a command',409);
      if(p.kind==='gripper'||p.kind==='robot'){
        const robot=p.kind==='robot'?r.deviceId:p.gripper.robot;
        ensure(r.action==='stop'||![...this.records.values()].some(c=>!terminal(c.status)&&c.deviceId!==r.deviceId&&(c.deviceId===robot||this.profile(c.deviceId).gripper?.robot===robot)),'TOOL_BUSY','Mounted gripper and robot commands cannot overlap',409);
      }
      r.task=this.taskFor(r);if(p.kind==='robot')linkRobotGrasp(this,r,r.task);
    }catch(e){if(!(e instanceof DeviceError))throw e;error=e;}
    this.records.set(r.commandId,r);
    if(error)this.update(r,'REJECTED',error.code);
    else if(r.action==='stop'){
      for(const c of this.records.values())if(c!==r&&(c.deviceId===r.deviceId||c.jawMotion?.toolId===r.deviceId)&&!terminal(c.status)){this.sim.cancel(c.commandId,'STOPPED');this.update(c,'CANCELLED','STOPPED');}
      this.update(r,'SUCCEEDED');
    }else this.emit('command.accepted',{command:this.publicRecord(r)});
    const dropAck=this.links[r.deviceId].dropNextAck;this.links[r.deviceId].dropNextAck=false;
    if(dropAck)this.emit('communication.ack_dropped',{commandId:r.commandId});
    return {command:this.publicRecord(r),duplicate:false,ackDelayMs:p.timing.ackDelayMs,dropAck};
  }
  publicRecord(r){
    const {fingerprint,task,jawMotion,...record}=r,s=this.sim.state.tasks[r.commandId],active=this.sim.active.get(r.commandId);
    const elapsedSeconds=s?.elapsed??0,estimatedDurationSeconds=active?active.ticks*this.sim.config.dt:r.estimatedDurationSeconds??null;
    return clone({...record,elapsedSeconds,estimatedDurationSeconds,progress:r.status==='SUCCEEDED'?1:estimatedDurationSeconds?Math.min(1,elapsedSeconds/estimatedDurationSeconds):0});
  }
  command(id){const r=this.records.get(id);ensure(r,'UNKNOWN_COMMAND',id,404);ensure(this.links[r.deviceId].online,'DEVICE_OFFLINE','Reconnect before querying the device result',503);return this.publicRecord(r);}
  cancel(id,sessionId){
    this.checkSession(sessionId);const r=this.records.get(id);ensure(r,'UNKNOWN_COMMAND',id,404);
    if(terminal(r.status))return this.publicRecord(r);
    ensure(this.links[r.deviceId].online,'DEVICE_OFFLINE','Device disconnected',503);
    ensure(r.status==='ACCEPTED'||cancellable(this.profile(r.deviceId),r.action),'NOT_CANCELLABLE','This operation cannot be cancelled once running',409);
    this.sim.cancel(id);this.update(r,'CANCELLED');return this.publicRecord(r);
  }
  fault(id,reason='INJECTED_FAULT'){
    const p=this.profile(id);this.links[id].fault=reason;
    if(p.kind!=='robot'&&p.kind!=='gripper')this.sim.command({type:'fault',device:id,reason});
    for(const r of this.records.values())if((r.deviceId===id||r.jawMotion?.toolId===id)&&!terminal(r.status)){this.sim.cancel(r.commandId,reason);this.update(r,'FAILED',reason);}
    stopGripper(this,id);this.emit('device.fault',{deviceId:id,reason});
  }
  inject(id,options,sessionId){
    this.checkSession(sessionId);this.profile(id);const link=this.links[id];
    ensure(options&&Object.keys(options).every(k=>['online','fault','faultAfterSeconds','dropNextAck','dropNextCompletion','forcedSensors'].includes(k)),'INVALID_INJECTION','Injection fields');
    for(const k of ['online','dropNextAck','dropNextCompletion'])if(options[k]!==undefined)ensure(typeof options[k]==='boolean','INVALID_INJECTION',k);
    if(options.fault!==undefined)ensure(typeof options.fault==='string'&&options.fault.length>0&&options.fault.length<=80,'INVALID_INJECTION','fault');
    if(options.faultAfterSeconds!==undefined)ensure(options.faultAfterSeconds===null||(Number.isFinite(options.faultAfterSeconds)&&options.faultAfterSeconds>=0&&options.faultAfterSeconds<=3600),'INVALID_INJECTION','faultAfterSeconds');
    if(options.forcedSensors!==undefined){
      const actual=this.actualSensors(id);ensure(options.forcedSensors&&typeof options.forcedSensors==='object'&&!Array.isArray(options.forcedSensors)&&Object.entries(options.forcedSensors).every(([k,v])=>Object.hasOwn(actual,k)&&typeof v===typeof actual[k]&&(typeof v!=='number'||Number.isFinite(v))),'INVALID_INJECTION','forcedSensors');
    }
    this.device(id);for(const k of ['online','dropNextAck','dropNextCompletion','faultAfterSeconds','forcedSensors'])if(options[k]!==undefined)link[k]=clone(options[k]);
    if(options.fault)this.fault(id,options.fault);
    this.emit('device.injection',{deviceId:id,options});return this.device(id);
  }
  advance(ticks){
    ensure(Number.isInteger(ticks)&&ticks>=1&&ticks<=500,'INVALID_TICKS','ticks in [1,500]');
    for(let i=0;i<ticks;i++){
      if(this.sim.state.status==='collision')break;
      for(const r of this.records.values())if(r.status==='ACCEPTED'){
        if(this.sim.state.time-r.acceptedAt>=r.startWithinSeconds){this.sim.cancel(r.commandId);this.update(r,'EXPIRED','START_DEADLINE_EXCEEDED');continue;}
        if(!this.sim.state.tasks[r.commandId]&&this.sim.state.time-r.acceptedAt+1e-9>=this.profile(r.deviceId).timing.startDelaySeconds)this.sim.enqueue(r.task);
      }
      this.sim.step();advanceGrippers(this);
      for(const r of this.records.values()){
        if(terminal(r.status))continue;const task=this.sim.state.tasks[r.commandId];if(!task)continue;
        if(task.startedAt!==null&&r.startedAt===null){r.estimatedDurationSeconds=this.sim.active.get(r.commandId)?.ticks*this.sim.config.dt||(task.finishedAt-task.startedAt);this.update(r,'RUNNING');}
        if(task.status==='running'){
          this.update(r,'RUNNING');
          if(this.links[r.deviceId].faultAfterSeconds!==null&&task.elapsed>=this.links[r.deviceId].faultAfterSeconds&&r.action!=='reset'){
            this.links[r.deviceId].faultAfterSeconds=null;this.fault(r.deviceId,'INJECTED_ACTION_FAILURE');
          }
        }else if(task.status==='done'){
          if(r.action==='reset'){if(this.sim.state.grippers[r.deviceId])this.sim.state.grippers[r.deviceId].targetOpeningMm=this.sim.state.grippers[r.deviceId].openingMm;this.links[r.deviceId].fault=null;this.links[r.deviceId].forcedSensors={};stopGripper(this,r.deviceId);if(this.sim.state.devices[r.deviceId]){const d=this.sim.state.devices[r.deviceId];d.fault=null;d.mode='warming';d.remaining=this.profile(r.deviceId).timing.warmupSeconds;}}
          r.result={...(this.profile(r.deviceId).kind==='gripper'?{gripper:clone(this.sim.state.grippers[r.deviceId])}:{}),object:r.parameters.object?clone(this.sim.state.objects[r.parameters.object]):r.action==='dispense'?clone(this.sim.state.objects[this.profile(r.deviceId).process.object]):null,sensors:this.actualSensors(r.deviceId)};
          this.update(r,'SUCCEEDED');
        }else if(['failed','cancelled'].includes(task.status))this.update(r,task.status==='failed'?'FAILED':'CANCELLED',task.reason);
        else r.reason=task.reason;
      }
      if(this.sim.state.status==='collision')for(const r of this.records.values())if(!terminal(r.status)){this.sim.cancel(r.commandId,'COLLISION_STOP');this.update(r,'FAILED','COLLISION_STOP');}
      this.sampleSensors();
    }
    return this.snapshot();
  }
  configure(id,profile,sessionId){
    this.checkSession(sessionId);const old=this.profile(id);
    ensure(![...this.records.values()].some(r=>!terminal(r.status)),'DEVICE_BUSY','Change configuration when all commands are terminal',409);
    ensure(profile.gripper?.robot===old.gripper?.robot&&profile.kind===old.kind&&profile.process?.station===old.process?.station&&profile.process?.object===old.process?.object,'IMMUTABLE_IDENTITY','Kind/station/object belong to the world layout');
    const next=clone(this.config);next.devices[id]=clone(profile);const world=prepareWorld(this.base,next);
    if(profile.stock)ensure(profile.stock.capacity>=this.sim.state.supplies[`${id}-stock`].amount,'INVALID_CONFIG','Capacity below current stock');
    if(profile.kind==='robot')ensure(this.sim.state.robots[id].q.every((q,i)=>q>=profile.motion.limits[i].min&&q<=profile.motion.limits[i].max),'INVALID_CONFIG','Current joints outside new limits');
    if(profile.kind==='gripper')ensure(this.sim.state.grippers[id].openingMm<=profile.gripper.maxOpeningMm,'INVALID_CONFIG','Current opening exceeds new limit');
    if(JSON.stringify(world.installation.mounts)!==JSON.stringify(this.sim.config.installation.mounts)){const checked=checkInstallation(this.sim.config,world,this.sim.state);this.sim.state=checked.state;world.installation.validation=checked.validation;this.installationRevision++;}
    this.config=next;this.sim.config=world;this.sim.checker.config=world;this.emit('device.configured',{deviceId:id});return this.device(id);
  }
  refill(target,amount,sessionId){
    this.checkSession(sessionId);ensure(Number.isFinite(amount)&&amount>0,'INVALID_REFILL','Positive amount required');
    if(this.sim.state.materials[target]){ensure(this.sim.state.materials[target].amount+amount<=1000,'INVALID_REFILL','Material capacity');this.sim.command({type:'refill',material:target,amount});}
    else{const p=this.profile(target),s=this.sim.state.supplies[`${target}-stock`];ensure(p.stock&&Number.isInteger(amount)&&s.amount+amount<=p.stock.capacity,'INVALID_REFILL','Stock capacity/count');s.amount+=amount;s.added=(s.added??0)+amount;}
    this.emit('stock.refilled',{target,amount});return this.snapshot();
  }
  takeCup(sessionId){
    this.checkSession(sessionId);const o=this.sim.state.objects.cup;
    ensure(o.present&&!o.owner&&vec(o.pose.position).distanceTo(vec(this.sim.config.stations.pickup.pose.position))<.02&&!this.sim.locks.has('object:cup'),'CUP_NOT_READY','No released cup at pickup',409);
    this.sim.state.servedKg=(this.sim.state.servedKg??0)+Object.values(o.contents).reduce((a,b)=>a+b,0);o.present=false;o.contents={};o.sealed=false;this.emit('cup.collected',{});return this.snapshot();
  }
  snapshot(){return {installationRevision:this.installationRevision,sessionId:this.sessionId,clock:clone(this.config.clock),config:clone(this.config),world:clone(this.sim.config),state:clone(this.sim.state),devices:Object.keys(this.config.devices).map(id=>this.device(id)),commands:[...this.records.values()].slice(-100).map(r=>this.publicRecord(r)),events:this.events.slice(-100)};}
}
