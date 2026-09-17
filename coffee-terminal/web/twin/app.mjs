import {TwinRenderer} from './renderer.mjs';
import {validateWorld} from './schema.mjs';
import {latteTasks} from './recipes.mjs';
const $=id=>document.getElementById(id);
const names={brewer:'咖啡机',foamer:'奶沫机','hot-water':'热水机',beans:'咖啡豆','water-stock':'水','milk-stock':'牛奶'};
const modes={warming:'预热',idle:'待机',running:'运行',cooldown:'清洁恢复',fault:'故障',ready:'准备就绪',completed:'制作完成',failed:'任务失败',collision:'碰撞停机',pending:'等待',done:'完成',skipped:'跳过'};
let config,renderer,worker,state,playing=false,busy=false,replay=null,last=performance.now(),accumulator=0;
function pause(){playing=false;$('play').textContent=state?.status==='running'?'继续':'开始';}
function notify(message) {$('status').textContent=message;}
function enable(enabled) {for(const id of ['play','step','reset','compare','export','fault','repair','refill'])$(id).disabled=!enabled;}
function send(data){if(!worker)return;busy=true;worker.postMessage(data);}
function node(tag,text,className=''){const e=document.createElement(tag);e.textContent=text;e.className=className;return e;}
function draw(s,events=[]) {
  state=s;renderer.apply(s);$('clock').textContent=`${s.time.toFixed(2)} s`;$('progress').textContent=`${Object.values(s.tasks).filter(t=>t.status==='done').length} / ${Object.keys(s.tasks).length}`;
  notify(`${replay?'回放 · ':''}${modes[s.status]??s.status}${s.collisions.length?` · ${s.collisions[0].a} ↔ ${s.collisions[0].b}`:''}`);
  $('devices').replaceChildren(...Object.entries(s.devices).map(([id,d])=>{const row=node('div','','device');row.append(node('b',names[id]??id),node('span',`${modes[d.mode]??d.mode}${d.remaining>0?' '+d.remaining.toFixed(1)+'s':''}`,`pill ${d.mode}`));return row;}));
  $('materials').replaceChildren(...Object.entries(s.materials).map(([id,m])=>{const row=node('div','','material');row.append(node('span',names[id]??id),node('span',`${m.amount.toFixed(3)} kg${m.reserved>.0001?' · 已预留 '+m.reserved.toFixed(3):''}`));return row;}));
  $('containers').replaceChildren(...Object.entries(s.objects).map(([id,o])=>node('div',`${id} · ${(Object.values(o.contents).reduce((a,b)=>a+b,0)*1000).toFixed(1)} g · ${o.owner??'已放置'}`,'container')));
  const taskDefs=replay?.tasks??latteTasks(),max=Math.max(80,s.time);
  $('gantt').replaceChildren(...taskDefs.map(t=>{const ts=s.tasks[t.id],row=node('div','',`gantt-row ${ts.status}`),track=node('div','','gantt-track');row.title=`${t.id}: ${ts.reason??ts.status}`;row.append(node('span',t.id),track);if(ts.startedAt!==null){const bar=node('div','',`gantt-bar ${t.robot??''}`);bar.style.left=`${ts.startedAt/max*100}%`;bar.style.width=`${Math.max(.3,((ts.finishedAt??s.time)-ts.startedAt)/max*100)}%`;track.append(bar);}return row;}));
  $('events').textContent=events.slice(-15).map(e=>`${e.time.toFixed(2)}  ${e.type} ${e.task??e.reason??''}`).join('\n');
  if(s.status==='running'&&!Object.values(s.tasks).some(t=>t.status==='running')&&Object.values(s.tasks).some(t=>t.reason==='insufficient_material'))notify('等待补料 · 库存不足');
  if(s.status==='failed')notify('任务失败 · '+Object.values(s.tasks).find(t=>t.status==='failed')?.reason);
}
function init(next=config) {
  const validated=validateWorld(next);
  playing=false;busy=false;accumulator=0;replay=null;$('play').textContent='开始';$('seek').disabled=true;enable(false);
  config=validated;
  worker?.terminate();renderer?.dispose();renderer=new TwinRenderer($('viewport'),config);renderer.debugVisible=$('collision').checked;renderer.setView($('view').value);renderer.labelsVisible=$('labels').checked;
  worker=new Worker('digital-twin.worker.js',{type:'module'});
  worker.onmessage=({data})=>{
    busy=false;
    if(data.type==='error'){playing=false;enable(true);notify(data.message);return;}
    if(data.type==='state'){enable(true);draw(data.state,data.events);if(['completed','failed','collision'].includes(data.state.status)){playing=false;$('play').textContent='开始';}return;}
    if(data.type==='export'){download(data.data,`coffee-twin-${Date.now()}.json`);return;}
    if(data.type==='compare') {
      enable(true);const [serial,parallel]=data.results;
      $('comparison').textContent=data.results.map(r=>`${r.policy==='serial'?'串行':'并行'}：${r.makespan.toFixed(2)} s · ${modes[r.status]??r.status}`).join('\n')+(serial.status==='completed'&&parallel.status==='completed'?`\n本场景缩短 ${((1-parallel.makespan/serial.makespan)*100).toFixed(1)}%`:'\n有未完成实验，请检查布局和任务。');
    }
  };
  worker.onerror=e=>{busy=false;playing=false;notify(`内核加载失败：${e.message}`);};
  send({type:'init',config,policy:$('policy').value});
}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('play').onclick=()=>{if(replay)return;playing=!playing;$('play').textContent=playing?'暂停':'继续';last=performance.now();};
$('step').onclick=()=>{if(!busy&&!replay)send({type:'advance',ticks:1});};
$('reset').onclick=()=>init();$('policy').onchange=()=>init();
$('view').onchange=()=>renderer?.setView($('view').value);
$('labels').onchange=()=>{if(renderer)renderer.labelsVisible=$('labels').checked;};
$('collision').onchange=()=>{renderer.debugVisible=$('collision').checked;renderer.setView($('view').value);renderer.labelsVisible=$('labels').checked;renderer.updateDebug();};
$('export').onclick=()=>{pause();if(replay)download(replay,'coffee-twin-replay.json');else send({type:'export'});};
$('compare').onclick=()=>{pause();enable(false);$('comparison').textContent='正在执行串行与并行实验…';send({type:'compare',config});};
for(const type of ['fault','repair'])$(type).onclick=()=>send({type:'command',command:{type,device:$('fault-device').value}});
$('refill').onclick=()=>send({type:'command',command:{type:'refill',material:'milk-stock',amount:1}});
$('world-file').onchange=async e=>{try{const file=e.target.files[0];if(file)init(JSON.parse(await file.text()));}catch(e){notify(e.message);}};
$('replay-file').onchange=async e=>{try{
  const file=e.target.files[0];if(!file)return;const data=JSON.parse(await file.text());validateWorld(data.config);
  if(data.schemaVersion!==1||!Array.isArray(data.trace)||!data.trace.length||!Array.isArray(data.tasks))throw Error('实验文件缺少有效回放轨迹');
  playing=false;worker?.terminate();worker=null;busy=false;replay=data;config=data.config;renderer?.dispose();renderer=new TwinRenderer($('viewport'),config);renderer.debugVisible=$('collision').checked;renderer.setView($('view').value);renderer.labelsVisible=$('labels').checked;
  enable(false);$('reset').disabled=false;$('export').disabled=false;$('seek').disabled=false;$('seek').max=data.trace.length-1;$('seek').value=0;draw(data.trace[0],[]);
}catch(e){notify(`回放导入失败：${e.message}`);}};
$('seek').oninput=()=>{const s=replay.trace[Number($('seek').value)];draw(s,replay.events.filter(e=>e.time<=s.time));};
function frame(now) {
  const elapsed=Math.min(.25,(now-last)/1000);last=now;
  if(playing&&!busy&&!replay){accumulator+=elapsed*Number($('speed').value);const ticks=Math.min(50,Math.floor(accumulator/config.dt));if(ticks){accumulator-=ticks*config.dt;send({type:'advance',ticks});}}
  renderer?.render();requestAnimationFrame(frame);
}
try{const response=await fetch('twin/coffee-workcell-v1.json');if(!response.ok)throw Error(`场景加载 HTTP ${response.status}`);init(await response.json());requestAnimationFrame(frame);}catch(e){notify(e.message);}
