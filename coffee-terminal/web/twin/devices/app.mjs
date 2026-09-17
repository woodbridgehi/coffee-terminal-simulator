import {TwinRenderer} from '../renderer.mjs';
import {request,submitCommand,runLatte} from './client.mjs';
const $=id=>document.getElementById(id),base=location.origin;
const names={left:'左机械臂',right:'右机械臂',brewer:'咖啡机',foamer:'奶泡机','hot-water':'热水机',lidder:'封盖机','cup-dispenser':'落杯器','ice-maker':'制冰机','syrup-pump':'糖浆机'};
const words={idle:'待机',ready:'就绪',running:'运行',waiting:'等待',warming:'预热',cooldown:'恢复',fault:'故障',offline:'离线',cleaning:'清洗',resetting:'复位',move:'移动',grasp:'抓取',release:'释放',transfer:'倒奶',process:'加工',seal:'封盖',dispense:'落杯',clean:'清洗',reset:'复位',stop:'停止',ACCEPTED:'已接收',RUNNING:'执行中',SUCCEEDED:'成功',FAILED:'失败',REJECTED:'拒绝',CANCELLED:'已取消',EXPIRED:'启动过期'};
const sensorNames={ready:'就绪信号',cupPresent:'杯到位',gripperHasObject:'夹爪持物',headPosition:'压头位置',stockRemaining:'剩余库存'};
let snapshot,renderer,selected='cup-dispenser',records=new Map(),events=[],plannerRunning=false;
const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
function notice(message,error=false){$('notice').textContent=message;$('notice').dataset.error=error;}
async function action(fn){try{await fn();}catch(error){notice(error.message,true);}}
const post=(path,body={})=>request(base,path,{method:'POST',body:{sessionId:snapshot.sessionId,...body}});
function defaults(action){if(action==='move')return {station:selected==='left'?'cups':'right-ready',...(selected==='left'?{approachObject:'cup'}:{})};if(action==='release')return {object:'cup',station:'handoff'};if(action==='grasp')return {object:'cup'};if(action==='process')return {object:selected==='foamer'?'milk-cup':'cup'};if(action==='seal')return {object:'cup'};if(action==='transfer')return {source:'milk-cup',object:'cup',durationSeconds:6};return {};}
function newId(){ $('command-id').value=`ui-${crypto.randomUUID()}`; }
function renderRecords(){
 $('commands').replaceChildren(...[...records.values()].slice(-40).reverse().map(c=>{
  const row=document.createElement('tr');for(const value of [c.commandId,`${names[c.deviceId]??c.deviceId} / ${words[c.action]??c.action}`,words[c.status]??c.status,c.reason??''])row.append(text('td',value));
  row.onclick=()=>{$('query-id').value=c.commandId;$('command-result').textContent=JSON.stringify(c,null,2);};return row;
 }));
}
function selectedState(){
 const d=snapshot.devices.find(x=>x.id===selected);if(!d)return;
 $('device-title').textContent=names[selected]??selected;
 $('device-state').textContent=`${words[d.mode]??d.mode} · ${d.online?'在线':'离线'}${d.fault?' · '+d.fault:''}${d.state.remaining>0?' · 剩余 '+d.state.remaining.toFixed(2)+' s':''}`;
 $('sensors').replaceChildren(...Object.entries(d.sensors).map(([k,v])=>{const row=document.createElement('div');row.append(text('span',sensorNames[k]??k),text('b',typeof v==='boolean'?(v?'是':'否'):String(v)));return row;}));
 $('stock-state').textContent=d.stock?`库存 ${d.stock.amount} / ${d.stock.capacity}，预留 ${d.stock.reserved}`:`传感器更新时间 ${d.observedAt.toFixed(2)} s`;
}
function configuration(){
 const d=snapshot.devices.find(x=>x.id===selected),p=structuredClone(d.configuration);
 $('configuration').value=JSON.stringify(p,null,2);$('config-fields').replaceChildren();
 const fields=[['durationSeconds','加工时间 s'],['warmupSeconds','预热时间 s'],['cooldownSeconds','恢复时间 s'],['startDelaySeconds','启动延迟 s'],['ackDelayMs','确认延迟 ms'],['sensorDelaySeconds','传感器延迟 s']];
 if(p.kind==='robot')fields.splice(0,3,['graspSeconds','抓取时间 s'],['releaseSeconds','释放时间 s'],['resetSeconds','复位时间 s']);
 for(const [key,label] of fields){const row=text('label',label),input=document.createElement('input');input.type='number';input.min='0';input.step='any';input.value=p.timing[key];input.dataset.field=key;
  input.oninput=()=>{try{const current=JSON.parse($('configuration').value);current.timing[key]=Number(input.value);$('configuration').value=JSON.stringify(current,null,2);}catch{notice('请先修正完整属性 JSON',true);}};row.append(input);$('config-fields').append(row);}
 $('action').replaceChildren(...d.capabilities.map(c=>{const o=text('option',words[c.action]??c.action);o.value=c.action;return o;}));$('parameters').value=JSON.stringify(defaults($('action').value),null,2);newId();
}
function draw(update){
 snapshot={...snapshot,...update};$('clock').textContent=`${snapshot.state.time.toFixed(2)} s`;$('clock-mode').value=snapshot.clock.mode;$('advance').disabled=snapshot.clock.mode!=='manual';
 if(renderer){renderer.apply(snapshot.state);}
 $('device-list').replaceChildren(...snapshot.devices.map(d=>{const b=text('button',names[d.id]??d.id);b.setAttribute('aria-pressed',d.id===selected);b.append(text('small',words[d.mode]??d.mode));b.onclick=()=>{selected=d.id;selectedState();configuration();draw(snapshot);};return b;}));selectedState();
}
async function load(){
 snapshot=await request(base,'/api/state');renderer?.dispose();renderer=new TwinRenderer($('viewport'),snapshot.world);renderer.setView($('view').value);renderer.debugVisible=$('collision').checked;
 records=new Map(snapshot.commands.map(c=>[c.commandId,c]));events=snapshot.events.slice(-20);renderRecords();draw(snapshot);configuration();
 $('refill-target').replaceChildren(...[...Object.keys(snapshot.state.materials),...snapshot.devices.filter(d=>d.stock).map(d=>d.id)].map(id=>{const option=text('option',names[id]??id);option.value=id;return option;}));
}
$('action').onchange=()=>{$('parameters').value=JSON.stringify(defaults($('action').value),null,2);newId();};$('new-id').onclick=newId;
$('send').onclick=()=>action(async()=>{
 const c={sessionId:snapshot.sessionId,commandId:$('command-id').value,deviceId:selected,action:$('action').value,parameters:JSON.parse($('parameters').value),startWithinSeconds:Number($('deadline').value)};
 const result=await submitCommand(base,c);records.set(result.commandId,result);renderRecords();$('query-id').value=result.commandId;notice(`命令 ${words[result.status]??result.status}。相同 ID 重试不会再次执行。`);
});
$('query').onclick=()=>action(async()=>{const r=await request(base,`/api/commands/${encodeURIComponent($('query-id').value)}`);records.set(r.commandId,r);renderRecords();$('command-result').textContent=JSON.stringify(r,null,2);notice(`查询结果：${words[r.status]??r.status}`);});
$('cancel').onclick=()=>action(async()=>{const r=await post(`/api/commands/${encodeURIComponent($('command-id').value)}/cancel`);records.set(r.commandId,r);renderRecords();notice(`取消结果：${words[r.status]??r.status}`);});
$('reset-device').onclick=()=>action(async()=>{await submitCommand(base,{sessionId:snapshot.sessionId,commandId:`reset-${crypto.randomUUID()}`,deviceId:selected,action:'reset',parameters:{}});notice('已提交设备复位；失败的制作任务不会自动重做。');});
$('save-config').onclick=()=>action(async()=>{await request(base,`/api/devices/${selected}/config`,{method:'PUT',body:{sessionId:snapshot.sessionId,configuration:JSON.parse($('configuration').value)}});snapshot=await request(base,'/api/state');configuration();notice('配置已保存。初始库存与预热时间在下次重置实验时生效。');});
const inject=options=>post(`/api/devices/${selected}/injection`,{options});
for(const [id,options] of [['fault',{fault:'OPERATOR_INJECTED'}],['disconnect',{online:false}],['reconnect',{online:true}],['drop-ack',{dropNextAck:true}],['drop-completion',{dropNextCompletion:true}]])$(id).onclick=()=>action(async()=>{await inject(options);notice('设置已应用。可发送命令或查询原命令观察结果。');});
$('apply-sensor').onclick=()=>action(async()=>{await inject({forcedSensors:JSON.parse($('sensor-override').value)});notice('传感器异常设置已应用。');});
$('refill').onclick=()=>action(async()=>{await post('/api/refill',{target:$('refill-target').value,amount:Number($('refill-amount').value)});notice('补料完成。');});
$('pickup').onclick=()=>action(async()=>{await post('/api/pickup');notice('已取走成品，杯对象槽位可用于下一杯。');});
$('clock-mode').onchange=()=>action(async()=>{const mode=$('clock-mode').value;await post('/api/clock',{clock:{mode,rate:mode==='accelerated'?16:1}});notice('时钟模式已切换。');});
$('advance').onclick=()=>action(async()=>{await post('/api/clock/advance',{ticks:50});});
$('view').onchange=()=>renderer?.setView($('view').value);$('collision').onchange=()=>{renderer.debugVisible=$('collision').checked;renderer.updateDebug();};
$('reset-session').onclick=()=>action(async()=>{await post('/api/session/reset');await load();notice('实验已重置，原会话命令 ID 不再有效。');});
$('export-config').onclick=()=>action(async()=>{const config=await request(base,'/api/config'),url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='device-lab-config.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('已导出设备配置。');});
$('import-config').onchange=()=>action(async()=>{const file=$('import-config').files[0];if(!file)return;await post('/api/session/reset',{config:JSON.parse(await file.text())});await load();notice('配置已导入，实验已重置。');});
$('run-scenario').onclick=()=>action(async()=>{
 if(plannerRunning)return;plannerRunning=true;$('run-scenario').disabled=true;const scenario=$('scenario').value;
 try{await post('/api/session/reset');await load();notice('示例规划器正在通过 HTTP 接口驱动设备…');
  const result=await runLatte(base,{scenario,onProgress:p=>{$('planner-status').textContent=`${p.done}/${p.total} · ${p.task} · ${words[p.status]??p.status}`;}});
  $('planner-status').textContent=`完成 ${result.completed} 个接口任务 · ${result.state.time.toFixed(2)} s · 已封盖 ${result.state.objects.cup.sealed?'是':'否'}`;notice('联调场景完成，可查询命令记录与事件。');
 }catch(error){$('planner-status').textContent=error.message;if(scenario==='jam'&&error.command?.status==='FAILED')notice('卡杯场景已触发失败；检查落杯器库存和失败原因，再复位设备。');else throw error;}
 finally{plannerRunning=false;$('run-scenario').disabled=false;}
});
await action(async()=>{await load();notice('已连接。先选择设备发送单条命令，或运行一键联调场景。');});
const stream=new EventSource('/api/events');stream.onopen=()=>{$('connection').textContent='服务已连接';};stream.onerror=()=>{$('connection').textContent='连接中断，正在重连';};
stream.addEventListener('snapshot',e=>{const update=JSON.parse(e.data);if(snapshot&&update.sessionId!==snapshot.sessionId){action(load);return;}if(snapshot)draw(update);});
stream.addEventListener('device-event',e=>{const event=JSON.parse(e.data);events.push(event);events=events.slice(-30);$('events').textContent=events.map(e=>`${e.time.toFixed(2)} ${e.type} ${e.command?.commandId??e.deviceId??''}`).join('\n');if(event.command){records.set(event.command.commandId,event.command);renderRecords();}});
function frame(){renderer?.render();requestAnimationFrame(frame);}requestAnimationFrame(frame);
