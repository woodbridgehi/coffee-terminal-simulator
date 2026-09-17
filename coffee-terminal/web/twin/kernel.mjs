import {clone,validateWorld,validateGraph} from './schema.mjs';
import {fk,relative,vec} from './robot.mjs';
import {CollisionChecker,initCollision,syncAttachments} from './collision.mjs';
import {planMotion} from './planner.mjs';
export class Simulation {
  static async create(config,tasks,options={}) {await initCollision();return new Simulation(config,tasks,options);}
  constructor(config,tasks,{policy='parallel',record=true}={}) {
    if(!['parallel','serial'].includes(policy)) throw Error('Unknown policy');
    this.config=validateWorld(config);this.tasks=validateGraph(tasks,this.config);this.policy=policy;this.record=record;
    this.checker=new CollisionChecker(this.config);this.active=new Map();this.locks=new Map();this.events=[];this.commands=[];this.trace=[];
    this.state={schemaVersion:1,tick:0,time:0,status:'ready',robots:{},objects:{},devices:{},materials:{},tasks:{},collisions:[],wasteKg:0};
    for(const [id,r] of Object.entries(config.robots)) this.state.robots[id]={q:[...r.home],dq:Array(6).fill(0),mode:'idle'};
    for(const [id,o] of Object.entries(config.objects)) this.state.objects[id]={pose:clone(o.pose),owner:null,attachment:null,contents:{}};
    for(const [id,d] of Object.entries(config.devices)) this.state.devices[id]={mode:d.warmup>0?'warming':'idle',remaining:d.warmup,task:null,fault:null};
    for(const [id,m] of Object.entries(config.materials)) this.state.materials[id]={amount:m.amount,reserved:0,consumed:0,added:0};
    for(const t of this.tasks) this.state.tasks[t.id]={status:'pending',reason:null,startedAt:null,finishedAt:null,elapsed:0};
    this.capture();
  }
  emit(type,details={}) {this.events.push({tick:this.state.tick,time:this.state.time,type,...details});}
  capture() {if(this.record)this.trace.push(clone(this.state));}
  resources(t) {
    return [...new Set([...t.resources,...(t.robot?[`robot:${t.robot}`,...Object.entries(this.state.objects).filter(([,o])=>o.owner===t.robot).map(([id])=>`object:${id}`)]:[]),...(t.object?[`object:${t.object}`]:[]),...(t.source?[`object:${t.source}`]:[]),...(t.device?[`device:${t.device}`,`station:${this.config.devices[t.device].station}`]:[])])];
  }
  fail(t,reason) {
    const s=this.state.tasks[t.id];s.status='failed';s.reason=reason;s.finishedAt=this.state.time;
    this.release(t);this.emit('task.failed',{task:t.id,reason});
  }
  release(t) {
    const a=this.active.get(t.id);
    if(a?.reserved) for(const [id,amount] of Object.entries(a.reserved)) this.state.materials[id].reserved=Math.max(0,this.state.materials[id].reserved-amount);
    this.active.delete(t.id);
    for(const [key,id] of this.locks) if(id===t.id)this.locks.delete(key);
    if(t.robot) {this.state.robots[t.robot].mode='idle';this.state.robots[t.robot].dq.fill(0);}
    if(t.device) {
      const d=this.state.devices[t.device];d.task=null;
      if(!d.fault) {d.mode='cooldown';d.remaining=this.config.devices[t.device].cooldown;}
    }
  }
  start(t) {
    const s=this.state.tasks[t.id],resources=this.resources(t);
    const blocked=reason=>{s.reason=reason;return false;};
    if(resources.some(r=>this.locks.has(r))) return blocked('resource_busy');
    let a={task:t,elapsed:0,ticks:Math.max(1,Math.ceil((t.duration??.3)/this.config.dt))};
    if(t.type==='process') {
      const d=this.state.devices[t.device],def=this.config.devices[t.device],o=this.state.objects[t.object];
      if(d.mode!=='idle')return blocked(`device_${d.mode}`);
      if(def.effect==='seal'&&Object.entries(this.state.robots).some(([id,r])=>vec(fk(this.config.robots[id],r.q).position).distanceTo(vec(o.pose.position))<.25))return blocked('gripper_not_clear');
      if(o.owner||vec(o.pose.position).distanceTo(vec(this.config.stations[def.station].pose.position))>.015) return blocked('container_not_at_device');
      if(Object.values(o.contents).reduce((a,b)=>a+b,0)+def.outputKg>this.config.objects[t.object].capacityKg+1e-9) {this.fail(t,'CAPACITY_EXCEEDED');return false;}
      if(def.inputs.some(i=>this.state.materials[i.material].amount-this.state.materials[i.material].reserved<i.amount-1e-9))return blocked('insufficient_material');
      a.reserved={};for(const i of def.inputs) {a.reserved[i.material]=(a.reserved[i.material]??0)+i.amount;this.state.materials[i.material].reserved+=i.amount;}
      a.ticks=Math.ceil(def.duration/this.config.dt);d.mode='running';d.task=t.id;d.remaining=a.ticks*this.config.dt;
    }
    if(t.type==='move') {
      try {a.motion=planMotion(this.config,this.state,t,this.checker);a.ticks=a.motion.ticks;} catch(e) {this.fail(t,e.message);return false;}
    }
    if(t.type==='grasp') {
      const o=this.state.objects[t.object],f=fk(this.config.robots[t.robot],this.state.robots[t.robot].q);
      if(o.owner) return blocked('container_owned');
      if(Object.values(this.state.objects).some(o=>o.owner===t.robot)) {this.fail(t,'GRIPPER_OCCUPIED');return false;}
      if(vec(o.pose.position).distanceTo(vec(f.position))>.012) {this.fail(t,'GRASP_OUT_OF_REACH');return false;}
    }
    if(t.type==='release') {
      const o=this.state.objects[t.object];
      if(o.owner!==t.robot||vec(o.pose.position).distanceTo(vec(this.config.stations[t.station].pose.position))>.015) {this.fail(t,'INVALID_RELEASE');return false;}
    }
    if(t.type==='transfer') {
      const src=this.state.objects[t.source],dst=this.state.objects[t.object];
      if(!src.owner||dst.owner||vec(src.pose.position).distanceTo(vec(dst.pose.position))>.3) {this.fail(t,'INVALID_POUR_POSE');return false;}
      const mass=Object.values(src.contents).reduce((a,b)=>a+b,0);
      if(mass<=0||mass+Object.values(dst.contents).reduce((a,b)=>a+b,0)>this.config.objects[t.object].capacityKg+1e-9) {this.fail(t,'INVALID_POUR_VOLUME');return false;}
      a.transfer=clone(src.contents);a.ticks=Math.ceil((t.duration??6)/this.config.dt);
    }
    resources.forEach(r=>this.locks.set(r,t.id));this.active.set(t.id,a);
    s.status='running';s.reason=null;s.startedAt=this.state.time;s.resources=resources;
    if(t.robot)this.state.robots[t.robot].mode=t.type;
    this.emit('task.started',{task:t.id});return true;
  }
  schedule() {
    for(const t of this.tasks) {
      const s=this.state.tasks[t.id];if(s.status!=='pending')continue;
      if(t.after.some(id=>['failed','cancelled','skipped'].includes(this.state.tasks[id].status))) {s.status='skipped';s.reason='dependency_failed';this.emit('task.skipped',{task:t.id});continue;}
      if(!t.after.every(id=>this.state.tasks[id].status==='done')) {s.reason='dependency';continue;}
      if(this.policy==='serial'&&this.active.size)break;
      this.start(t);
    }
  }
  step() {
    if(['completed','failed','collision'].includes(this.state.status)) return false;
    this.state.status='running';this.schedule();
    const next=clone(this.state);
    for(const a of this.active.values()) if(a.motion) Object.assign(next.robots[a.task.robot],a.motion.sample(a.elapsed+1));
    syncAttachments(this.config,next);
    const allowedGrasps=[...this.active.values()].flatMap(a=>a.task.allowedGrasps??(a.task.type==='grasp'?[{robot:a.task.robot,object:a.task.object}]:[]));
    const hits=this.checker.check(next,{allowedGrasps});
    next.collisions=hits;
    if(hits.length&&this.config.collisionMode==='stop') {
      this.state.status='collision';this.state.collisions=hits;for(const r of Object.values(this.state.robots)){r.dq.fill(0);r.mode='stopped';}this.emit('collision.stopped',{contacts:hits});this.capture();return false;
    }
    if(hits.length&&!this.state.collisions.length)this.emit('collision.shadow',{contacts:hits});
    this.state=next;this.state.tick++;this.state.time=Number((this.state.tick*this.config.dt).toFixed(9));
    for(const d of Object.values(this.state.devices)) if(['warming','cooldown'].includes(d.mode)) {
      d.remaining=Math.max(0,d.remaining-this.config.dt);if(d.remaining<1e-9){d.remaining=0;d.mode='idle';}
    }
    for(const a of [...this.active.values()]) {
      const t=a.task,s=this.state.tasks[t.id];a.elapsed++;s.elapsed=a.elapsed*this.config.dt;
      if(t.type==='process') {
        const def=this.config.devices[t.device],fraction=1/a.ticks,o=this.state.objects[t.object];
        this.state.devices[t.device].remaining=Math.max(0,(a.ticks-a.elapsed)*this.config.dt);
        for(const i of def.inputs) {
          const used=Math.min(a.reserved[i.material],i.amount*fraction),m=this.state.materials[i.material];
          m.amount-=used;m.reserved=Math.max(0,m.reserved-used);m.consumed+=used;a.reserved[i.material]-=used;
        }
        o.contents[t.device]=(o.contents[t.device]??0)+def.outputKg*fraction;
        this.state.wasteKg+=(def.inputs.reduce((s,i)=>s+i.amount,0)-def.outputKg)*fraction;
      }
      if(t.type==='transfer') for(const [id,mass] of Object.entries(a.transfer)) {
        const amount=Math.min(this.state.objects[t.source].contents[id],mass/a.ticks);
        this.state.objects[t.source].contents[id]-=amount;
        this.state.objects[t.object].contents[id]=(this.state.objects[t.object].contents[id]??0)+amount;
      }
      if(a.elapsed>=a.ticks) {
        if(t.type==='process'&&this.config.devices[t.device].effect==='seal')this.state.objects[t.object].sealed=true;
        if(t.type==='grasp') {const o=this.state.objects[t.object];o.owner=t.robot;o.attachment=relative(fk(this.config.robots[t.robot],this.state.robots[t.robot].q),o.pose);}
        if(t.type==='release') {const o=this.state.objects[t.object];o.owner=null;o.attachment=null;}
        s.status='done';s.finishedAt=this.state.time;this.release(t);this.emit('task.completed',{task:t.id});
      }
    }
    if(Object.values(this.state.tasks).every(s=>['done','failed','skipped','cancelled'].includes(s.status))) {
      this.state.status=Object.values(this.state.tasks).every(s=>s.status==='done')?'completed':'failed';this.emit('simulation.finished',{status:this.state.status});
    }
    if(this.state.tick%10===0||this.state.status!=='running')this.capture();
    return this.state.status==='running';
  }
  command(command) {
    const c=clone(command);
    if(c.type==='fault') {
      const d=this.state.devices[c.device];if(!d)throw Error('Unknown device');
      d.fault=c.reason??'injected';d.mode='fault';d.remaining=0;if(d.task)this.fail(this.tasks.find(t=>t.id===d.task),'DEVICE_FAULT');
    } else if(c.type==='repair') {
      const d=this.state.devices[c.device];if(!d)throw Error('Unknown device');
      if(d.mode!=='fault')throw Error('Repair requires a faulted device');
      d.fault=null;d.mode='warming';d.remaining=this.config.devices[c.device].warmup;
    } else if(c.type==='refill') {
      const m=this.state.materials[c.material];if(!m||!Number.isFinite(c.amount)||c.amount<=0)throw Error('Invalid refill');
      m.amount+=c.amount;m.added+=c.amount;
    } else throw Error('Unknown command');
    this.commands.push({tick:this.state.tick,...c});this.emit('command',c);
  }
  run(maxSeconds=300) {const limit=this.state.tick+Math.ceil(maxSeconds/this.config.dt);while(this.state.tick<limit&&this.step()){}return this.metrics();}
  metrics() {
    const duration=this.state.time,busy={};
    for(const t of this.tasks) {const s=this.state.tasks[t.id];if(s.startedAt!==null)for(const r of s.resources??this.resources(t))busy[r]=(busy[r]??0)+(s.finishedAt??duration)-s.startedAt;}
    return {status:this.state.status,makespan:duration,done:Object.values(this.state.tasks).filter(t=>t.status==='done').length,total:this.tasks.length,consumed:Object.fromEntries(Object.entries(this.state.materials).map(([id,m])=>[id,m.consumed])),wasteKg:this.state.wasteKg,utilization:Object.fromEntries(Object.entries(busy).map(([id,s])=>[id,duration?s/duration:0])),blocked:Object.entries(this.state.tasks).filter(([,s])=>s.status==='pending'||s.status==='failed').map(([id,s])=>({id,reason:s.reason}))};
  }
  export() {return {schemaVersion:1,engineVersion:'1.0.0',config:clone(this.config),tasks:clone(this.tasks),policy:this.policy,commands:clone(this.commands),events:clone(this.events),trace:clone(this.trace),finalState:clone(this.state),metrics:this.metrics()};}
}
