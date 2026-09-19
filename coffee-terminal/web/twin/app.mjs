import {TwinRenderer} from './renderer.mjs';
import {validateWorld} from './schema.mjs';
import {experimentTasks,sharedWorld} from './shared-config.mjs';
import {createSelectionStore} from './studio/selection-store.mjs';
import {createEntityIndex} from './studio/entity-index.mjs';
import {mountSceneTree} from './studio/scene-tree.mjs';
import {mountInspector} from './studio/inspector.mjs';
import {bindTimeline} from './studio/timeline.mjs';
const $=id=>document.getElementById(id);
const names={'cup-dispenser':'落杯器','ice-maker':'制冰机','syrup-pump':'糖浆机','ice-stock':'冰块','syrup-stock':'糖浆',brewer:'咖啡机',foamer:'奶沫机','hot-water':'热水机',lidder:'封盖机',beans:'咖啡豆','water-stock':'水','milk-stock':'牛奶'};
const modes={warming:'预热',idle:'待机',running:'运行',cooldown:'清洁恢复',fault:'故障',ready:'准备就绪',completed:'制作完成',failed:'任务失败',collision:'碰撞停机',pending:'等待',done:'完成',skipped:'跳过'};
let loadingConfiguration=false,pendingConfiguration=false,defaultWorld,config,renderer,worker,state,playing=false,busy=false,replay=null,last=performance.now(),accumulator=0;
const selection=createSelectionStore();
let entityIndex,sceneTree,studioInspector,studioTimeline;
const ganttRows=new Map();
const studioNames={left:'左机械臂',right:'右机械臂',cup:'成品杯','milk-cup':'奶壶',cups:'落杯工位',brew:'萃取工位',milk:'奶泡工位',water:'热水工位',ice:'制冰工位',syrup:'糖浆工位',lid:'封盖工位',pickup:'取杯口',handoff:'交接工位',pour:'倾倒工位','left-ready':'左臂待机位','right-ready':'右臂待机位'};
function pause(){playing=false;$('play').textContent=state?.status==='running'?'继续':'开始';}
function notify(message) {$('status').textContent=message;}
function enable(enabled) {for(const id of ['play','step','reset','compare','export','fault','repair','refill'])$(id).disabled=!enabled;}
function send(data){if(!worker)return;busy=true;worker.postMessage(data);}
function node(tag,text,className=''){const e=document.createElement(tag);e.textContent=text;e.className=className;return e;}
function studioTasks(){return replay?.tasks??(config?experimentTasks(config):[]);}
function studioLabel(ref,entity){return names[ref.id]??studioNames[ref.id]??entity?.config?.label??ref.id;}
function focusSelection(ref=selection.get()){
  if(!ref||!renderer||!entityIndex)return;
  renderer.focusEntity(ref,entityIndex.related(ref));
}
function connectRendererSelection(){
  if(!renderer)return;
  renderer.onSelection=ref=>selection.select(ref,'viewport');
  renderer.onFocus=ref=>{selection.select(ref,'viewport');focusSelection(ref);};
}
function rebuildStudio(){
  if(!config)return;
  ganttRows.clear();$('gantt').replaceChildren();
  entityIndex=createEntityIndex(config,studioTasks());
  selection.reconcile(ref=>entityIndex.has(ref),'config-reload');
  sceneTree?.dispose();studioInspector?.dispose();studioTimeline?.dispose();
  sceneTree=mountSceneTree({host:$('scene-tree'),selection,index:entityIndex,getState:()=>state,labelFor:studioLabel,onFocus:focusSelection});
  studioInspector=mountInspector({host:$('inspector-content'),selection,index:entityIndex,getState:()=>state,getConfig:()=>config,getMode:()=>replay?'REPLAY':'LIVE',onFocus:focusSelection});
  studioTimeline=bindTimeline({host:$('gantt'),selection,index:entityIndex,onFocus:focusSelection});
  renderer?.setSelection(selection.get(),entityIndex.related(selection.get()));
}
selection.subscribe(ref=>{
  if(renderer&&entityIndex)renderer.setSelection(ref,entityIndex.related(ref));
  const focus=$('focus-proxy');if(focus)focus.disabled=!ref;
});
function draw(s,events=[]) {
  state=s;renderer.sensorViews=s.deviceSensors?Object.fromEntries(Object.entries(s.deviceSensors).map(([id,sensors])=>[id,{online:true,sensors}])):undefined;renderer.apply(s);sceneTree?.update(s);studioInspector?.update(s);$('clock').textContent=`${s.time.toFixed(2)} s`;$('progress').textContent=`${Object.values(s.tasks).filter(t=>t.status==='done').length} / ${Object.keys(s.tasks).length}`;
  notify(`${replay?'回放 · ':''}${modes[s.status]??s.status}${s.collisions.length?` · ${s.collisions[0].a} ↔ ${s.collisions[0].b}`:''}`);
  $('devices').replaceChildren(...Object.entries(s.devices).map(([id,d])=>{const row=node('div','','device');row.append(node('b',names[id]??id),node('span',`${modes[d.mode]??d.mode}${d.remaining>0?' '+d.remaining.toFixed(1)+'s':''}`,`pill ${d.mode}`));return row;}));
  $('materials').replaceChildren(...Object.entries(s.materials).map(([id,m])=>{const row=node('div','','material');row.append(node('span',names[id]??id),node('span',`${m.amount.toFixed(3)} kg${m.reserved>.0001?' · 已预留 '+m.reserved.toFixed(3):''}`));return row;}));
  $('shared-sensors').textContent=s.deviceSensors?Object.entries(s.deviceSensors).map(([id,v])=>`${names[id]??id} · 杯垫：${v.cupSensorEnabled?(v.cupPresent?'有杯':'无杯'):'停用'}`).join(' / '):'';
  for(const [id,stock] of Object.entries(s.supplies??{})){const row=node('div','','material');row.append(node('span',`${names[id.replace(/-stock$/,'')]??id}库存`),node('span',`${stock.amount} 个`));$('materials').append(row);}
  $('containers').replaceChildren(...Object.entries(s.objects).map(([id,o])=>node('div',`${id} · ${(Object.values(o.contents).reduce((a,b)=>a+b,0)*1000).toFixed(1)} g · ${o.present===false?'尚未落杯':o.owner??'已放置'}`,'container')));
  const taskDefs=replay?.tasks??experimentTasks(config),max=Math.max(80,s.time);
  for(const t of taskDefs){
    const ts=s.tasks[t.id];let row=ganttRows.get(t.id);
    if(!row){row=node('div','','gantt-row');row.dataset.taskId=t.id;row.tabIndex=0;row.setAttribute('role','button');const track=node('div','','gantt-track');track.append(node('div','',`gantt-bar ${t.robot??''}`));row.append(node('span',t.id),track);ganttRows.set(t.id,row);$('gantt').append(row);}
    for(const status of ['pending','running','done','failed','skipped','cancelled'])row.classList.toggle(status,ts.status===status);
    row.title=`${t.id}: ${ts.reason??ts.status}`;const bar=row.querySelector('.gantt-bar');bar.hidden=ts.startedAt===null;
    if(ts.startedAt!==null){bar.style.left=`${ts.startedAt/max*100}%`;bar.style.width=`${Math.max(.3,((ts.finishedAt??s.time)-ts.startedAt)/max*100)}%`;}
  }
  studioTimeline?.sync();$('events').textContent=events.slice(-15).map(e=>`${e.time.toFixed(2)}  ${e.type} ${e.task??e.reason??''}`).join('\n');
  if(s.status==='running'&&!Object.values(s.tasks).some(t=>t.status==='running')&&Object.values(s.tasks).some(t=>t.reason==='insufficient_material'))notify('等待补料 · 库存不足');
  if(s.status==='failed')notify('任务失败 · '+Object.values(s.tasks).find(t=>t.status==='failed')?.reason);
}
function sourceLabel(){const s=config.configurationSource;$('config-source').textContent=s?`配置来源：${s.type==='device-lab'?'联调台快照':s.fileName??'配置文件'}${s.configurationId?' · '+s.configurationId.slice(0,10):''}${s.exportedAt?' · '+new Date(s.exportedAt).toLocaleString():''}。独立运行，联调台修改后需重新载入。`:'配置来源：内置默认场景。';}
function init(next=config) {
  const validated=validateWorld(next);
  playing=false;busy=false;accumulator=0;replay=null;$('play').textContent='开始';$('seek').disabled=true;enable(false);
  config=validated;state=undefined;sourceLabel();
  const chosen=$('fault-device').value;
  $('fault-device').replaceChildren(...Object.keys(config.devices).map(id=>{const option=node('option',names[id]??id);option.value=id;return option;}));
  if(config.devices[chosen])$('fault-device').value=chosen;
  worker?.terminate();renderer?.dispose();renderer=new TwinRenderer($('viewport'),config);renderer.debugVisible=$('collision').checked;renderer.setView($('view').value);renderer.labelsVisible=$('labels').checked;connectRendererSelection();rebuildStudio();
  worker=new Worker('digital-twin.worker.js',{type:'module'});
  const owner=worker;
  worker.onmessage=({data})=>{
    if(worker!==owner)return;
    busy=false;
    if(data.type==='error'){if(pendingConfiguration){pendingConfiguration=false;$('config-feedback').textContent='实验初始化失败：'+data.message;}playing=false;enable(true);notify(data.message);return;}
    if(data.type==='state'){if(pendingConfiguration){pendingConfiguration=false;$('config-feedback').textContent=config.sharedDeviceConfig?'已载入设备与布局配置，建立独立实验。机械运动、工艺、库存、夹爪和杯垫参数生效；通信延迟/断连与命令确认请在联调台测试。':'已载入场景，实验已重置。';}enable(true);draw(data.state,data.events);if(['completed','failed','collision'].includes(data.state.status)){playing=false;$('play').textContent='开始';}return;}
    if(data.type==='export'){download(data.data,`coffee-twin-${Date.now()}.json`);return;}
    if(data.type==='compare') {
      enable(true);const [serial,parallel]=data.results;
      $('comparison').textContent=data.results.map(r=>`${r.policy==='serial'?'串行':'并行'}：${r.makespan.toFixed(2)} s · ${modes[r.status]??r.status}`).join('\n')+(serial.status==='completed'&&parallel.status==='completed'?`\n本场景缩短 ${((1-parallel.makespan/serial.makespan)*100).toFixed(1)}%`:'\n有未完成实验，请检查布局和任务。');
    }
  };
  worker.onerror=e=>{if(worker!==owner)return;busy=false;playing=false;notify(`内核加载失败：${e.message}`);};
  send({type:'init',config,policy:$('policy').value});
}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('play').onclick=()=>{if(replay)return;playing=!playing;$('play').textContent=playing?'暂停':'继续';last=performance.now();};
$('step').onclick=()=>{if(!busy&&!replay)send({type:'advance',ticks:1});};
$('reset').onclick=()=>init();$('policy').onchange=()=>init();
$('view').onchange=()=>renderer?.setView($('view').value);
$('labels').onchange=()=>{if(renderer)renderer.labelsVisible=$('labels').checked;};
$('collision').onchange=()=>{if(renderer){renderer.debugVisible=$('collision').checked;renderer.updateDebug();}};
$('focus-proxy').onclick=()=>focusSelection();
document.addEventListener('keydown',event=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(event.target?.tagName)||event.target?.isContentEditable||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key==='Escape')selection.clear('keyboard');
  if(event.key==='f'||event.key==='F')focusSelection();
});
$('export').onclick=()=>{pause();if(replay)download(replay,'coffee-twin-replay.json');else send({type:'export'});};
$('compare').onclick=()=>{pause();enable(false);$('comparison').textContent='正在执行串行与并行实验…';send({type:'compare',config});};
for(const type of ['fault','repair'])$(type).onclick=()=>send({type:'command',command:{type,device:$('fault-device').value}});
$('refill').onclick=()=>send({type:'command',command:{type:'refill',material:'milk-stock',amount:1}});
async function loadConfiguration(read){
 if(loadingConfiguration||playing||busy){$('config-feedback').textContent='请先暂停并等待当前操作结束，再载入配置。';return;}
 loadingConfiguration=true;$('load-shared').disabled=true;enable(false);$('config-feedback').textContent='正在读取并校验配置…';
 try{const data=await read();let next=data;
  if(data.sharedDeviceConfig){sharedWorld(defaultWorld,data.sharedDeviceConfig,data.configurationSource);next=validateWorld(data);}
  else if(data.devices&&Object.values(data.devices).some(p=>p.kind))next=sharedWorld(defaultWorld,data,{type:'file'});
  validateWorld(next);init(next);pendingConfiguration=true;$('config-feedback').textContent='配置校验通过，正在初始化独立实验…';
 }catch(e){enable(!replay);$('reset').disabled=false;$('export').disabled=false;$('config-feedback').textContent=`载入失败，保留原实验：${e.message}。若使用独立静态服务，请从联调台进入实验室，或导入导出的设备配置 JSON。`;}
 finally{loadingConfiguration=false;$('load-shared').disabled=false;}
}
const readShared=async()=>{const r=await fetch('/api/experiment-config',{cache:'no-store'});if(!r.ok)throw Error(`配置服务 HTTP ${r.status}`);return r.json();};
$('load-shared').onclick=()=>loadConfiguration(readShared);
$('world-file').onchange=e=>{const file=e.target.files[0];if(file)loadConfiguration(async()=>JSON.parse(await file.text()));e.target.value='';};
$('replay-file').onchange=async e=>{try{
  const file=e.target.files[0];if(!file)return;const data=JSON.parse(await file.text());validateWorld(data.config);
  if(data.schemaVersion!==1||!Array.isArray(data.trace)||!data.trace.length||!Array.isArray(data.tasks))throw Error('实验文件缺少有效回放轨迹');
  playing=false;worker?.terminate();worker=null;busy=false;replay=data;config=data.config;state=undefined;sourceLabel();renderer?.dispose();renderer=new TwinRenderer($('viewport'),config);renderer.debugVisible=$('collision').checked;renderer.setView($('view').value);renderer.labelsVisible=$('labels').checked;connectRendererSelection();rebuildStudio();
  enable(false);$('reset').disabled=false;$('export').disabled=false;$('seek').disabled=false;$('seek').max=data.trace.length-1;$('seek').value=0;draw(data.trace[0],[]);
}catch(e){notify(`回放导入失败：${e.message}`);}};
$('seek').oninput=()=>{const s=replay.trace[Number($('seek').value)];draw(s,replay.events.filter(e=>e.time<=s.time));};
function frame(now) {
  const elapsed=Math.min(.25,(now-last)/1000);last=now;
  if(playing&&!busy&&!replay){accumulator+=elapsed*Number($('speed').value);const ticks=Math.min(50,Math.floor(accumulator/config.dt));if(ticks){accumulator-=ticks*config.dt;send({type:'advance',ticks});}}
  renderer?.render();requestAnimationFrame(frame);
}
try{const response=await fetch('twin/coffee-workcell-main-v2.json');if(!response.ok)throw Error(`场景加载 HTTP ${response.status}`);defaultWorld=await response.json();init(defaultWorld);requestAnimationFrame(frame);if(new URLSearchParams(location.search).get('source')==='device-lab'){const onReady=setInterval(()=>{if(!busy){clearInterval(onReady);loadConfiguration(readShared);}},50);}}catch(e){notify(e.message);}
