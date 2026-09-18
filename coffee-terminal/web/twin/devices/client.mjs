import {latteTasks} from '../recipes.mjs';
export async function request(base,path,{method='GET',body,signal}={}){
  const response=await fetch(new URL(path,base),{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal});
  const data=await response.json();if(!response.ok){const e=Object.assign(Error(data.error?.message??data.command?.reason??`HTTP ${response.status}`),{status:response.status,code:data.error?.code,data});throw e;}return data;
}
// A lost HTTP confirmation is not permission to send a second physical action.
export async function submitCommand(base,command,signal){
  for(let attempt=0;attempt<3;attempt++){
    try{return (await request(base,'/api/commands',{method:'POST',body:command,signal})).command;}
    catch(error){
      if(error.status||signal?.aborted)throw error;
      try{return await request(base,`/api/commands/${encodeURIComponent(command.commandId)}`,{signal});}
      catch(queryError){if(queryError.status&&queryError.status!==404)throw queryError;}
    }
  }
  throw Error('Command delivery unresolved; query the same commandId before retrying');
}
export async function runLatte(base,{scenario='normal',signal,onProgress=()=>{}}={}){
  if(!['normal','jam','disconnect','lost-notification'].includes(scenario))throw Error('Unknown scenario');
  const initial=await request(base,'/api/state',{signal}),sessionId=initial.sessionId,runId=`latte-${crypto.randomUUID()}`;
  if(initial.state.objects.cup.present!==false)throw Error('Collect the previous cup or reset the experiment first');
  if(initial.commands.some(c=>['ACCEPTED','RUNNING'].includes(c.status)))throw Error('Another command is active');
  const post=(path,body)=>request(base,path,{method:'POST',body:{sessionId,...body},signal});
  if(scenario==='jam')await post('/api/devices/cup-dispenser/injection',{options:{faultAfterSeconds:.4}});
  if(scenario==='lost-notification'){
    await post('/api/devices/cup-dispenser/injection',{options:{dropNextAck:true}});
    await post('/api/devices/foamer/injection',{options:{dropNextCompletion:true}});
  }
  const definitions=[{id:'dispense-cup',type:'dispense',device:'cup-dispenser',after:[],resources:[]},...latteTasks(initial.world).map(t=>({...t,after:t.id==='left-get-cup'?[...t.after,'dispense-cup']:t.after}))];
  const commands=new Map(),done=new Set();let disconnectedAt=null,reconnected=false;
  const wallStart=Date.now(),simStart=initial.state.time;
  try{while(done.size<definitions.length){
    if(signal?.aborted)throw Error('Client stopped; accepted device commands retain their state');
    const state=await request(base,'/api/state',{signal});
    if(state.sessionId!==sessionId)throw Error('Session changed during planning');
    if(state.state.time-simStart>600||Date.now()-wallStart>900000)throw Error('Planner wait limit reached; inspect accepted commands before retrying');
    for(const t of definitions){
      if(done.has(t.id))continue;
      let record=commands.get(t.id);
      if(record){
        try{record=await request(base,`/api/commands/${record.commandId}`,{signal});commands.set(t.id,record);}
        catch(error){if(error.status===503)continue;throw error;}
        if(record.status==='SUCCEEDED'){done.add(t.id);onProgress({task:t.id,status:record.status,done:done.size,total:definitions.length,time:state.state.time});}
        else if(['FAILED','REJECTED','CANCELLED','EXPIRED'].includes(record.status))throw Object.assign(Error(`${t.id}: ${record.reason??record.status}`),{command:record});
        continue;
      }
      if(!t.after.every(id=>done.has(id)))continue;
      const deviceId=t.robot??t.device,parameters={};let action=t.type;
      if(t.type==='move'){parameters.station=t.station;if(t.allowedGrasps?.[0])parameters.approachObject=t.allowedGrasps[0].object;}
      else if(['grasp','release'].includes(t.type)){parameters.object=t.object;if(t.station)parameters.station=t.station;}
      else if(t.type==='process'){action=t.device==='lidder'?'seal':'process';parameters.object=t.object;}
      else if(t.type==='transfer')Object.assign(parameters,{source:t.source,object:t.object,durationSeconds:t.duration});
      const view=state.devices.find(d=>d.id===deviceId);if(view.currentCommandId||!view.online)continue;
      const command={sessionId,commandId:`${runId}-${t.id}`,deviceId,action,parameters,startWithinSeconds:120};
      record=await submitCommand(base,command,signal);commands.set(t.id,record);view.currentCommandId=record.commandId;
      onProgress({task:t.id,status:record.status,done:done.size,total:definitions.length,time:state.state.time});
    }
    if(scenario==='disconnect'){
      const foam=commands.get('foam');
      if(disconnectedAt===null&&foam?.status==='RUNNING'){await post('/api/devices/foamer/injection',{options:{online:false}});disconnectedAt=state.state.time;}
      if(disconnectedAt!==null&&!reconnected&&state.state.time-disconnectedAt>=20){await post('/api/devices/foamer/injection',{options:{online:true}});reconnected=true;}
    }
    if(done.size===definitions.length)break;
    if(state.clock.mode==='manual')await post('/api/clock/advance',{ticks:25});
    else await new Promise(resolve=>setTimeout(resolve,100));
  }
  }catch(error){
    const unresolved=[];
    for(const r of commands.values())if(!['SUCCEEDED','FAILED','REJECTED','CANCELLED','EXPIRED'].includes(r.status)){
      try{await request(base,`/api/commands/${r.commandId}/cancel`,{method:'POST',body:{sessionId}});}catch{unresolved.push(r.commandId);}
    }
    if(unresolved.length){error.unresolvedCommands=unresolved;error.message+=` (query unresolved commands: ${unresolved.join(', ')})`;}
    throw error;
  }
  return {sessionId,runId,completed:done.size,commands:[...commands.values()],state:(await request(base,'/api/state',{signal})).state};
}
