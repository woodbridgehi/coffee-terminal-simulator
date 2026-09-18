import {TwinRenderer} from '../renderer.mjs';
import {request,submitCommand,runLatte} from './client.mjs';
const $=id=>document.getElementById(id),base=location.origin;
const names={'left-gripper':'左末端夹爪','right-gripper':'右末端夹爪',left:'左机械臂',right:'右机械臂',brewer:'咖啡机',foamer:'奶泡机','hot-water':'热水机',lidder:'封盖机','cup-dispenser':'落杯器','ice-maker':'制冰机','syrup-pump':'糖浆机'};
const words={open:'张开',close:'闭合',setOpening:'指定开口',idle:'待机',ready:'就绪',running:'运行',waiting:'等待',warming:'预热',cooldown:'恢复',fault:'故障',offline:'离线',cleaning:'清洗',resetting:'复位',move:'移动',grasp:'抓取',release:'释放',transfer:'倒奶',process:'加工',seal:'封盖',dispense:'落杯',clean:'清洗',reset:'复位',stop:'停止',ACCEPTED:'已接收',RUNNING:'执行中',SUCCEEDED:'成功',FAILED:'失败',REJECTED:'拒绝',CANCELLED:'已取消',EXPIRED:'启动过期'};
const sensorNames={openingMm:'实际开口',targetOpeningMm:'目标开口',moving:'开合中',atTarget:'到达目标',robotHoldingObject:'机械臂持物',heldObjectWidthMm:'持物直径',openingCompatible:'开口尺寸兼容',payloadKg:'持物重量 kg',payloadWithinLimit:'负载未超限',ready:'就绪信号',cupPresent:'杯到位',gripperHasObject:'夹爪持物',headPosition:'压头位置',stockRemaining:'剩余库存'};
let snapshot,renderer,selected='cup-dispenser',records=new Map(),events=[],plannerRunning=false,selectedCommandId=null,polling=false,loading=null;
const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
function notice(message,error=false){$('notice').textContent=message;$('notice').dataset.error=error;}
async function action(fn){try{await fn();}catch(error){const c=error.data?.command;if(c){records.set(c.commandId,c);renderRecords();showRecord(c);}notice(c?describe(c):error.message,true);}}
const post=(path,body={})=>request(base,path,{method:'POST',body:{sessionId:snapshot.sessionId,...body}});
function defaults(action){if(action==='setOpening')return {openingMm:40,speedMmS:42.5};if(['open','close'].includes(action))return {};if(action==='move')return {station:selected==='left'?'cups':'right-ready',...(selected==='left'?{approachObject:'cup'}:{})};if(action==='release')return {object:'cup',station:'handoff'};if(action==='grasp')return {object:'cup'};if(action==='process')return {object:selected==='foamer'?'milk-cup':'cup'};if(action==='seal')return {object:'cup'};if(action==='transfer')return {source:'milk-cup',object:'cup',durationSeconds:6};return {};}
function newId(){ $('command-id').value=`ui-${crypto.randomUUID()}`; }
const finished=c=>['SUCCEEDED','FAILED','REJECTED','CANCELLED','EXPIRED'].includes(c.status);
const reasons={ROBOT_HOLDING_OBJECT:'机械臂正在持物。请先通过机械臂释放，再独立开合夹爪。',TOOL_BUSY:'夹爪与安装它的机械臂不能同时接受运动命令，请等待当前动作结束。',outlet_or_cup_slot_occupied:'单杯槽位已占用：先取走成品台上的杯子；制作中的杯子需先完成流程。',outlet_not_clear:'机械臂靠近落杯出口，请先移开机械臂。',insufficient_supply:'杯或盖不足，请在「库存 / 会话」中补充。',insufficient_material:'原料不足，补料后可继续等待中的命令。',container_not_at_device:'容器未放到设备工位，或仍被机械臂握住。',gripper_not_clear:'机械臂尚未退出封盖区域。',device_warming:'设备正在预热，请等待。',device_cooldown:'设备正在恢复，请等待。',resource_busy:'所需设备或容器正在被其他动作使用。',DEVICE_BUSY:'该设备已有未结束命令。',START_DEADLINE_EXCEEDED:'启动等待已过期，本条命令不会执行。排除原因后用新 ID 发送。',INJECTED_ACTION_FAILURE:'已触发模拟故障；先复位设备，再用新 ID 重试。',CONTAINER_ABSENT:'没有可用的杯子，请先落杯。',CONTAINER_ALREADY_SEALED:'杯子已封盖，不能再次加工。'};
function describe(c){
 const head=`${names[c.deviceId]??c.deviceId} · ${words[c.action]??c.action} · ${words[c.status]??c.status}`;
 const detail=c.reason?(reasons[c.reason]??`原因：${c.reason}`):c.status==='SUCCEEDED'?(c.action==='dispense'?'杯子已出现在落杯器出口，库存减 1。相同 ID 重发不会再次落杯。':'本条动作已完成；这不一定表示整杯咖啡已完成。'):c.status==='ACCEPTED'?'命令已接收，尚未执行。':c.status==='RUNNING'?'设备正在执行；查看工作台与设备状态。':c.status==='CANCELLED'?'命令已取消；已执行的动作或已消耗物料不会回退。':'查看原始结果获取详细信息。';
 return `${head}\n${detail}${!finished(c)&&snapshot.clock.mode==='manual'&&!plannerRunning?'\n当前为手动时钟：点击「推进 1 秒」或切换「实时 1×」才能继续。':''}`;
}
function showRecord(c,select=true){
 selectedCommandId=c.commandId;if(select)$('query-id').value=c.commandId;
 $('command-result').textContent=JSON.stringify(c,null,2);$('result-summary').textContent=describe(c);$('result-summary').dataset.status=c.status;
 $('command-feedback').textContent=describe(c);$('command-feedback').dataset.status=c.status;
 for(const row of $('commands').children)row.dataset.selected=row.dataset.id===selectedCommandId;
}
// Keep interactive nodes alive across telemetry updates, including pointerdown → pointerup.
const commandRows=new Map();
function renderRecords(){
 const visible=[...records.values()].slice(-40).reverse(),ids=new Set(visible.map(c=>c.commandId));
 for(const [id,row] of commandRows)if(!ids.has(id)){row.remove();commandRows.delete(id);}
 for(let i=0;i<visible.length;i++){
  const c=visible[i];let row=commandRows.get(c.commandId);
  if(!row){row=document.createElement('tr');row.dataset.id=c.commandId;const device=text('td',''),status=text('td',''),id=text('td',''),control=text('td',''),button=text('button','查看'),pill=text('span','');pill.className='status-pill';status.append(pill);id.append(text('code',c.commandId));button.setAttribute('aria-label',`查看 ${names[c.deviceId]??c.deviceId} ${words[c.action]??c.action} ${c.commandId}`);button.onclick=()=>showRecord(records.get(c.commandId));control.append(button);row.append(device,status,id,control);commandRows.set(c.commandId,row);}
  row.children[0].textContent=`${names[c.deviceId]??c.deviceId} / ${words[c.action]??c.action}`;const pill=row.children[1].firstChild;pill.textContent=words[c.status]??c.status;pill.dataset.status=c.status;row.dataset.selected=c.commandId===selectedCommandId;
  if($('commands').children[i]!==row)$('commands').insertBefore(row,$('commands').children[i]??null);
 }
 $('commands-empty').hidden=records.size>0;$('record-count').textContent=records.size?`最近 ${visible.length} 条记录`:'暂无命令';
 if(selectedCommandId&&records.has(selectedCommandId))showRecord(records.get(selectedCommandId),false);
}
function selectTab(name){for(const tab of document.querySelectorAll('[data-tab]')){const active=tab.dataset.tab===name;tab.setAttribute('aria-selected',active);tab.tabIndex=active?0:-1;$(tab.getAttribute('aria-controls')).hidden=!active;}}
for(const tab of document.querySelectorAll('[data-tab]')){
 tab.onclick=()=>selectTab(tab.dataset.tab);
 tab.onkeydown=e=>{const tabs=[...document.querySelectorAll('[data-tab]')],i=tabs.indexOf(tab);let n;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;else return;e.preventDefault();selectTab(tabs[n].dataset.tab);tabs[n].focus();};
}
function deviceButtons(){
 $('device-count').textContent=`${snapshot.devices.length} 台虚拟设备`;
 $('device-list').replaceChildren(...snapshot.devices.map(d=>{const b=text('button',names[d.id]??d.id);b.dataset.device=d.id;b.setAttribute('aria-pressed',d.id===selected);b.append(text('small',''));b.onclick=()=>{selected=d.id;selectedState();configuration();draw(snapshot);};return b;}));
}
function actionHelp(){const a=$('action').value,p=snapshot.devices.find(d=>d.id===selected).configuration,isJaw=p.kind==='gripper';$('gripper-controls').hidden=!isJaw||!['open','close','setOpening'].includes(a);if(isJaw){$('jaw-target').max=p.gripper.maxOpeningMm;$('jaw-target').disabled=a!=='setOpening';$('jaw-target').value=a==='open'?p.gripper.maxOpeningMm:a==='close'?0:Math.min(40,p.gripper.maxOpeningMm);$('jaw-speed').value=p.gripper[a==='open'?'openingSpeedMmS':'closingSpeedMmS'];syncJawParameters();$('action-help').textContent='独立命令控制开口；机械臂抓取 / 释放会自动驱动夹爪，并在开合完成后更新持物状态。';$('command-parameters').open=false;return;}$('action-help').textContent=a==='dispense'?'成功后出口出现一只杯子，库存减 1。已有杯子时须先完成制作并取走成品。':a==='process'?'先把容器放到该设备工位，再加工；未到位会等待，不会凭空出料。':a==='seal'?'杯子须在封盖工位，机械臂退出后才能封盖。':'动作按设备状态与联锁执行；展开参数，核对目标工位与容器。';$('command-parameters').open=!['dispense','reset','clean','stop'].includes(a);}
function selectedState(){
 const d=snapshot.devices.find(x=>x.id===selected);if(!d)return;
 $('device-title').textContent=names[selected]??selected;
 $('device-state').textContent=`${words[d.mode]??d.mode} · ${d.online?'在线':'离线'}${d.fault?' · '+d.fault:''}${d.state.remaining>0?' · 剩余 '+d.state.remaining.toFixed(2)+' s':''}`;
 $('sensors').replaceChildren(...Object.entries(d.sensors).map(([k,v])=>{const row=document.createElement('div');row.append(text('span',sensorNames[k]??k),text('b',typeof v==='boolean'?(v?'是':'否'):(typeof v==='number'?String(Number(v.toFixed(3))):String(v))+(k.endsWith('Mm')?' mm':'')));return row;}));
 $('gripper-notes').hidden=d.kind!=='gripper';if(d.kind==='gripper')$('gripper-notes').textContent=`仿真扩展开口上限 ${d.configuration.gripper.maxOpeningMm} mm，${d.configuration.gripper.maxOpeningMm>=100?'可夹取':'不能夹取'}当前 100 mm 杯模型。原实物额定 85 mm；本扩展不代表真实硬件能力。抓取力与滑移未建模。`;
 $('stock-state').textContent=d.stock?`库存 ${d.stock.amount} / ${d.stock.capacity}，预留 ${d.stock.reserved}`:`传感器更新时间 ${d.observedAt.toFixed(2)} s`;
}
function configuration(){
 const d=snapshot.devices.find(x=>x.id===selected),p=structuredClone(d.configuration);
 $('configuration').value=JSON.stringify(p,null,2);$('config-fields').replaceChildren();
 const fields=[['durationSeconds','加工时间 s'],['warmupSeconds','预热时间 s'],['cooldownSeconds','恢复时间 s'],['startDelaySeconds','启动延迟 s'],['ackDelayMs','确认延迟 ms'],['sensorDelaySeconds','传感器延迟 s']];
 if(p.kind==='robot')fields.splice(0,3,['graspSeconds','抓取时间 s'],['releaseSeconds','释放时间 s'],['resetSeconds','复位时间 s']);
 if(p.kind==='gripper'){fields.splice(0,fields.length,['initialOpeningMm','初始开口 mm'],['openingSpeedMmS','张开速度 mm/s'],['closingSpeedMmS','闭合速度 mm/s'],['maxOpeningMm','开口上限 mm'],['maxPayloadKg','负载上限 kg']);}
 for(const [key,label] of fields){const row=text('label',label),input=document.createElement('input');input.type='number';input.min='0';input.step='any';const section=p.kind==='gripper'?'gripper':'timing';input.value=p[section][key];input.dataset.field=key;if(p.kind==='gripper'){input.min=key==='initialOpeningMm'?'0':'0.1';input.max=key.includes('Speed')?'42.5':key==='maxPayloadKg'?'2':'120';}
  input.oninput=()=>{try{const current=JSON.parse($('configuration').value);current[section][key]=Number(input.value);$('configuration').value=JSON.stringify(current,null,2);}catch{notice('请先修正完整属性 JSON',true);}};row.append(input);$('config-fields').append(row);}
 $('action').replaceChildren(...d.capabilities.map(c=>{const o=text('option',words[c.action]??c.action);o.value=c.action;return o;}));if(p.kind==='gripper')$('action').value='setOpening';$('parameters').value=JSON.stringify(defaults($('action').value),null,2);newId();actionHelp();
}
function draw(update){
 snapshot={...snapshot,...update};$('clock').textContent=`${snapshot.state.time.toFixed(2)} s`;if($('clock-mode').value!==snapshot.clock.mode)$('clock-mode').value=snapshot.clock.mode;$('advance').disabled=snapshot.clock.mode!=='manual'||plannerRunning;
 $('clock-help').textContent=snapshot.clock.mode==='manual'?(plannerRunning?'手动时钟 · 示例规划器正在自动推进。':'手动时钟已暂停 · 发送命令不会自动走时；点击「推进 1 秒」或切换实时模式。'):snapshot.clock.mode==='accelerated'?'加速 16× · 设备自动执行，短动作可能一闪而过。':'实时 1× · 接收命令后，设备按配置耗时自动执行。';
 if(renderer){renderer.apply(snapshot.state);renderer.selectDevice(selected);}
 for(const d of snapshot.devices){const b=$('device-list').querySelector(`[data-device="${d.id}"]`);if(b){b.setAttribute('aria-pressed',d.id===selected);b.querySelector('small').textContent=words[d.mode]??d.mode;}}selectedState();
 const cup=snapshot.state.objects.cup,pickup=snapshot.world.stations.pickup.pose.position,atPickup=cup.present&&!cup.owner&&Math.hypot(...cup.pose.position.map((v,i)=>v-pickup[i]))<.02;
 $('pickup').disabled=!atPickup||plannerRunning;
 $('cup-status').textContent=cup.present===false?'杯槽空闲 · 可以落杯':atPickup?'成品杯待取 · 单杯槽位已占用':cup.owner?`杯子由${names[cup.owner]}持有`:'工作台上已有杯子 · 单杯槽位已占用';
 $('cup-help').textContent=cup.present===false?'选择落杯器发送一次落杯；成功后在出口观察杯子。':atPickup?'先点击「取走成品杯」，再用新命令 ID 落下一杯。':'需要先完成当前杯的流程；也可在「库存 / 会话」中重置实验。';
}
async function load(){
 if(loading)return loading;
 loading=(async()=>{
 snapshot=await request(base,'/api/state');renderer?.dispose();renderer=new TwinRenderer($('viewport'),snapshot.world);renderer.setView($('view').value);renderer.debugVisible=$('collision').checked;
 selectedCommandId=null;records=new Map(snapshot.commands.map(c=>[c.commandId,c]));events=snapshot.events.slice(-20);commandRows.clear();$('commands').replaceChildren();deviceButtons();renderRecords();draw(snapshot);configuration();$('command-feedback').textContent='发送后会在这里显示接收、等待、执行和结果。';$('query-id').value='';$('command-result').textContent='暂无结果';$('result-summary').textContent='选择一条记录，查看它是否真正执行成功。';$('events').textContent=events.map(e=>`${e.time.toFixed(2)} ${e.type}`).join('\n');
 $('refill-target').replaceChildren(...[...Object.keys(snapshot.state.materials),...snapshot.devices.filter(d=>d.stock).map(d=>d.id)].map(id=>{const option=text('option',names[id]??id);option.value=id;return option;}));
 })();
 try{return await loading;}finally{loading=null;}
}
function syncJawParameters(){const a=$('action').value;if(!['open','close','setOpening'].includes(a))return;const p={speedMmS:Number($('jaw-speed').value)};if(a==='setOpening')p.openingMm=Number($('jaw-target').value);$('parameters').value=JSON.stringify(p,null,2);}
$('jaw-target').oninput=syncJawParameters;$('jaw-speed').oninput=syncJawParameters;
$('action').onchange=()=>{$('parameters').value=JSON.stringify(defaults($('action').value),null,2);newId();actionHelp();};$('new-id').onclick=newId;
$('send').onclick=()=>action(async()=>{
 const c={sessionId:snapshot.sessionId,commandId:$('command-id').value,deviceId:selected,action:$('action').value,parameters:JSON.parse($('parameters').value),startWithinSeconds:Number($('deadline').value)};
 const result=await submitCommand(base,c);records.set(result.commandId,result);renderRecords();showRecord(result);notice(`命令 ${words[result.status]??result.status}。相同 ID 重试不会再次执行。`);
});
$('query').onclick=()=>action(async()=>{const r=await request(base,`/api/commands/${encodeURIComponent($('query-id').value)}`);records.set(r.commandId,r);renderRecords();showRecord(r);notice(`查询结果：${words[r.status]??r.status}`);});
$('cancel').onclick=()=>action(async()=>{const r=await post(`/api/commands/${encodeURIComponent($('command-id').value)}/cancel`);records.set(r.commandId,r);renderRecords();notice(`取消结果：${words[r.status]??r.status}`);});
$('reset-device').onclick=()=>action(async()=>{await submitCommand(base,{sessionId:snapshot.sessionId,commandId:`reset-${crypto.randomUUID()}`,deviceId:selected,action:'reset',parameters:{}});notice('已提交设备复位；失败的制作任务不会自动重做。');});
$('save-config').onclick=()=>action(async()=>{await request(base,`/api/devices/${selected}/config`,{method:'PUT',body:{sessionId:snapshot.sessionId,configuration:JSON.parse($('configuration').value)}});snapshot=await request(base,'/api/state');configuration();notice('配置已保存。初始库存与预热时间在下次重置实验时生效。');});
const inject=options=>post(`/api/devices/${selected}/injection`,{options});
for(const [id,options] of [['fault',{fault:'OPERATOR_INJECTED'}],['disconnect',{online:false}],['reconnect',{online:true}],['drop-ack',{dropNextAck:true}],['drop-completion',{dropNextCompletion:true}]])$(id).onclick=()=>action(async()=>{await inject(options);notice('设置已应用。可发送命令或查询原命令观察结果。');});
$('apply-sensor').onclick=()=>action(async()=>{await inject({forcedSensors:JSON.parse($('sensor-override').value)});notice('传感器异常设置已应用。');});
$('refill').onclick=()=>action(async()=>{await post('/api/refill',{target:$('refill-target').value,amount:Number($('refill-amount').value)});notice('补料完成。');});
$('pickup').onclick=()=>action(async()=>{await post('/api/pickup');notice('已取走成品，杯对象槽位可用于下一杯。');});
$('clock-mode').onchange=()=>action(async()=>{const mode=$('clock-mode').value;await post('/api/clock',{clock:{mode,rate:mode==='accelerated'?16:1}});notice(mode==='manual'?'已暂停自动走时。点击「推进 1 秒」继续设备动作。':'时钟模式已切换，设备将自动推进。');});
$('advance').onclick=()=>action(async()=>{await post('/api/clock/advance',{ticks:50});});
$('focus-device').onclick=()=>renderer?.focusDevice(selected);
$('fault-reset').onclick=()=>$('reset-device').click();
$('view').onchange=()=>renderer?.setView($('view').value);$('collision').onchange=()=>{renderer.debugVisible=$('collision').checked;renderer.updateDebug();};
$('reset-session').onclick=()=>action(async()=>{await post('/api/session/reset');await load();notice('实验已重置，原会话命令 ID 不再有效。');});
$('export-config').onclick=()=>action(async()=>{const config=await request(base,'/api/config'),url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='device-lab-config.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('已导出设备配置。');});
$('import-config').onchange=()=>action(async()=>{const file=$('import-config').files[0];if(!file)return;await post('/api/session/reset',{config:JSON.parse(await file.text())});await load();notice('配置已导入，实验已重置。');});
$('run-scenario').onclick=()=>action(async()=>{
 if(plannerRunning)return;plannerRunning=true;$('run-scenario').disabled=true;const scenario=$('scenario').value;$('planner-progress').value=0;for(const id of ['send','reset-session','import-config','pickup','scenario'])$(id).disabled=true;
 try{await post('/api/session/reset');await load();notice('示例规划器正在通过 HTTP 接口驱动设备…');
  const result=await runLatte(base,{scenario,onProgress:p=>{$('planner-progress').value=p.done;$('planner-status').textContent=`${p.done}/${p.total} · ${p.task} · ${words[p.status]??p.status}`;}});
  $('planner-progress').value=result.completed;$('planner-status').textContent=`完成 ${result.completed} 个接口任务 · ${result.state.time.toFixed(2)} s · 已封盖 ${result.state.objects.cup.sealed?'是':'否'}`;notice('联调场景完成，可查询命令记录与事件。');
 }catch(error){$('planner-status').textContent=error.message;if(scenario==='jam'&&error.command?.status==='FAILED')notice('卡杯场景已触发失败；检查落杯器库存和失败原因，再复位设备。');else throw error;}
 finally{plannerRunning=false;$('run-scenario').disabled=false;for(const id of ['send','reset-session','import-config','scenario'])$(id).disabled=false;draw(snapshot);}
});
const scenarioHelp={normal:'预期：32 / 32 成功，成品台出现已封盖咖啡；杯库存和盖库存各减 1。观察双臂动作，再核对命令记录。',jam:'预期：落杯命令失败，出口不出现杯子，杯库存不减少。这是预期的故障验证；结束后复位落杯器。',disconnect:'预期：奶泡机加工中显示离线，但加工继续；重连后规划器查询结果并完成整杯，不重复打奶泡。', 'lost-notification':'预期：故意丢掉一次确认和完成通知；规划器查询原命令 ID 找回结果，整杯完成且不重复扣料。'};
$('scenario').onchange=()=>{$('scenario-help').textContent=scenarioHelp[$('scenario').value];};$('scenario').onchange();
// Query only the inspected unfinished command. This exposes waiting reasons even without an event.
setInterval(async()=>{
 const id=selectedCommandId,session=snapshot?.sessionId;if(polling||!id||!records.has(id)||finished(records.get(id)))return;polling=true;
 try{const r=await request(base,`/api/commands/${encodeURIComponent(id)}`);if(snapshot.sessionId===session){records.set(id,r);renderRecords();}}
 catch(error){if(id===selectedCommandId)$('command-feedback').textContent=error.status===503?'设备离线，结果暂不可查询。动作可能仍在执行；重连后查询原命令 ID。':error.message;}
 finally{polling=false;}
},1000);
await action(async()=>{await load();notice('已连接。先选择设备发送单条命令，或运行一键联调场景。');});
const stream=new EventSource('/api/events');stream.onopen=()=>{$('connection').textContent='服务已连接';};stream.onerror=()=>{$('connection').textContent='连接中断，正在重连';};
stream.addEventListener('snapshot',e=>{const update=JSON.parse(e.data);if(snapshot&&update.sessionId!==snapshot.sessionId){action(load);return;}if(snapshot)draw(update);});
stream.addEventListener('device-event',e=>{const event=JSON.parse(e.data);events.push(event);events=events.slice(-30);$('events').textContent=events.map(e=>`${e.time.toFixed(2)} ${e.type} ${e.command?.commandId??e.deviceId??''}`).join('\n');if(event.command){records.set(event.command.commandId,event.command);renderRecords();}});
function frame(){renderer?.render();requestAnimationFrame(frame);}requestAnimationFrame(frame);
