import {parentPort,workerData} from 'node:worker_threads';
import {DeviceRuntime} from '../coffee-terminal/web/twin/devices/runtime.mjs';
import {ensure} from '../coffee-terminal/web/twin/devices/profile.mjs';
const runtime=await DeviceRuntime.create(workerData.world,workerData.config);
let last=performance.now(),accumulator=0,lastReport=0;
const publish=()=>parentPort.postMessage({type:'snapshot',snapshot:runtime.snapshot(),events:runtime.drain()});
const clock=config=>{
 ensure(config&&Object.keys(config).every(k=>['mode','rate'].includes(k))&&['manual','realtime','accelerated'].includes(config.mode)&&Number.isFinite(config.rate)&&config.rate>=.1&&config.rate<=32,'INVALID_CLOCK','mode/rate');
 ensure(config.mode!=='realtime'||config.rate===1,'INVALID_CLOCK','realtime requires rate=1');
 runtime.config.clock={...config};last=performance.now();accumulator=0;runtime.emit('clock.changed',config);
};
// Serialize mutations, including async session reset, against the clock timer.
let queue=Promise.resolve();
parentPort.on('message',message=>{
 queue=queue.then(async()=>{
  const {id,method,args={}}=message;
  try{
   let result;
   if(method==='snapshot')result=runtime.snapshot();
   else if(method==='device')result=runtime.device(args.deviceId);
   else if(method==='command')result=runtime.command(args.commandId);
   else if(method==='submit')result=runtime.submit(args);
   else if(method==='cancel')result=runtime.cancel(args.commandId,args.sessionId);
   else if(method==='inject')result=runtime.inject(args.deviceId,args.options,args.sessionId);
   else if(method==='configure')result=runtime.configure(args.deviceId,args.configuration,args.sessionId);
   else if(method==='refill')result=runtime.refill(args.target,args.amount,args.sessionId);
   else if(method==='takeCup')result=runtime.takeCup(args.sessionId);
   else if(method==='advance'){runtime.checkSession(args.sessionId);ensure(runtime.config.clock.mode==='manual','CLOCK_NOT_MANUAL','Select manual mode first',409);result=runtime.advance(args.ticks);}
   else if(method==='clock'){runtime.checkSession(args.sessionId);clock(args.clock);result=runtime.snapshot();}
   else if(method==='reset'){runtime.checkSession(args.sessionId);result=await runtime.reset(args.config??runtime.config);last=performance.now();accumulator=0;}
   else throw Error('Unknown worker method');
   parentPort.postMessage({type:'response',id,result});publish();
  }catch(error){parentPort.postMessage({type:'response',id,error:{code:error.code??'INTERNAL_ERROR',message:error.message,status:error.status??500}});}
 });
});
setInterval(()=>{
 queue=queue.then(()=>{
  const now=performance.now(),elapsed=(now-last)/1000;last=now;
  if(runtime.config.clock.mode!=='manual'&&runtime.sim.state.status!=='collision'){
   accumulator+=elapsed*runtime.config.clock.rate;
   const ticks=Math.min(25,Math.floor(accumulator/runtime.sim.config.dt));
   if(ticks){runtime.advance(ticks);accumulator-=ticks*runtime.sim.config.dt;}
  }
  if(now-lastReport>=100){publish();lastReport=now;}
 }).catch(error=>parentPort.postMessage({type:'fatal',message:error.message}));
},20);
publish();
