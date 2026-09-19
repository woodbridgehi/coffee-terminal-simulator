import {patchMarkup} from './dom.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=n=>Number.isFinite(Number(n))?Number(n).toFixed(3):String(n??'—');

export function mountInspector({host,selection,index,getState,getConfig,getMode,onFocus}){
  let unsubscribe=()=>{},frame=0,disposed=false,lastHTML='';

  const row=(k,v)=>`<div class="context-row"><span>${esc(k)}</span><strong>${v}</strong></div>`;
  const relationButtons=ref=>{
    const related=index.related(ref);
    if(!related.length) return '';
    return `<div class="context-related">${related.map(item=>`<button type="button" data-related-kind="${esc(item.kind)}" data-related-id="${esc(item.id)}">${esc(item.kind)} · ${esc(item.id)}</button>`).join('')}</div>`;
  };

  function sceneSummary(config,state){
    return `
      <div class="context-head"><small>SCENE</small><h3>Coffee Workcell</h3><span class="context-pill">${esc(getMode?.()??'LIVE')}</span></div>
      <div class="context-section"><div class="section-title">场景概览</div>
        ${row('设备',Object.keys(config?.devices??{}).length)}
        ${row('机器人',Object.keys(config?.robots??{}).length)}
        ${row('对象',Object.keys(config?.objects??{}).length)}
        ${row('仿真状态',esc(state?.status??'loading'))}
      </div>
      <p class="support-copy">在场景树、3D 视口或时间线中选择对象。选择是全局共享的，Reset / Reload 后按稳定 ID 重新解析。</p>`;
  }

  function deviceView(ref,entity,state){
    const cfg=entity?.config??{}, live=state?.devices?.[ref.id]??{};
    return `
      <div class="context-head"><small>DEVICE · ${esc(ref.id)}</small><h3>${esc(ref.id)}</h3><span class="context-pill">${esc(live.mode??'unknown')}</span></div>
      <div class="context-section"><div class="section-title">实时状态</div>
        ${row('Mode',esc(live.mode??'—'))}
        ${row('Remaining',live.remaining===undefined?'—':fmt(live.remaining)+' s')}
        ${row('Station',esc(cfg.station??'—'))}
        ${row('Duration',cfg.duration===undefined?'—':fmt(cfg.duration)+' s')}
        ${row('Effect',esc(cfg.effect??'—'))}
        ${row('Task',esc(live.task??'—'))}
        ${row('Fault',esc(live.fault??'—'))}
      </div>
      ${relationButtons(ref)}`;
  }

  function robotView(ref,entity,state){
    const cfg=entity?.config??{}, live=state?.robots?.[ref.id]??{};
    const q=(live.q??[]).map((v,i)=>`J${i+1} ${Number(v).toFixed(3)}`).join(' · ');
    const p=cfg.base?.position??[];
    return `
      <div class="context-head"><small>ROBOT · ${esc(ref.id)}</small><h3>${esc(cfg.model??ref.id)}</h3><span class="context-pill">${esc(getMode?.()??'LIVE')}</span></div>
      <div class="context-section"><div class="section-title">机器人</div>
        ${row('Mode',esc(live.mode??'—'))}
        ${row('Base',p.length?p.map(fmt).join(', ')+' m':'—')}
        ${row('Joints',esc(q||'—'))}
        ${row('Link radius',cfg.linkRadius===undefined?'—':fmt(cfg.linkRadius)+' m')}
      </div>
      ${relationButtons(ref)}`;
  }

  function gripperView(ref,entity,state){
    const cfg=entity?.config??{}, live=state?.grippers?.[ref.id]??{};
    return `
      <div class="context-head"><small>GRIPPER · ${esc(ref.id)}</small><h3>${esc(ref.id)}</h3><span class="context-pill">${esc(live.mode??'unknown')}</span></div>
      <div class="context-section"><div class="section-title">夹爪</div>
        ${row('Robot',esc(cfg.robot??entity?.robot??'—'))}
        ${row('Opening',live.openingMm===undefined?'—':fmt(live.openingMm)+' mm')}
        ${row('Target',live.targetOpeningMm===undefined?'—':fmt(live.targetOpeningMm)+' mm')}
      </div>
      ${relationButtons(ref)}`;
  }

  function objectView(ref,entity,state){
    const live=state?.objects?.[ref.id]??{}, contents=live.contents??{};
    const mass=Object.values(contents).reduce((a,b)=>a+Number(b||0),0);
    return `
      <div class="context-head"><small>OBJECT · ${esc(ref.id)}</small><h3>${esc(ref.id)}</h3><span class="context-pill">${live.present===false?'ABSENT':esc(live.owner??'PLACED')}</span></div>
      <div class="context-section"><div class="section-title">容器 / 对象</div>
        ${row('Present',String(live.present!==false))}
        ${row('Owner',esc(live.owner??'—'))}
        ${row('Mass',fmt(mass*1000)+' g')}
        ${row('Contents',esc(Object.entries(contents).map(([k,v])=>`${k}:${Number(v).toFixed(3)}kg`).join(' · ')||'—'))}
      </div>
      ${relationButtons(ref)}`;
  }

  function stationView(ref,entity){
    const pose=entity?.config?.pose;
    return `
      <div class="context-head"><small>STATION · ${esc(ref.id)}</small><h3>${esc(entity?.config?.label??ref.id)}</h3><span class="context-pill">STATION</span></div>
      <div class="context-section"><div class="section-title">工位</div>
        ${row('Position',pose?.position?pose.position.map(fmt).join(', ')+' m':'—')}
        ${row('Quaternion',pose?.quaternion?pose.quaternion.map(fmt).join(', '):'—')}
      </div>
      ${relationButtons(ref)}`;
  }

  function taskView(ref,entity,state){
    const task=entity?.task??{}, live=state?.tasks?.[ref.id]??{};
    return `
      <div class="context-head"><small>TASK · ${esc(ref.id)}</small><h3>${esc(task.type??ref.id)}</h3><span class="context-pill">${esc(live.status??'pending')}</span></div>
      <div class="context-section"><div class="section-title">任务窗口</div>
        ${row('Type',esc(task.type??'—'))}
        ${row('Status',esc(live.status??'—'))}
        ${row('Robot',esc(task.robot??'—'))}
        ${row('Device',esc(task.device??'—'))}
        ${row('Object',esc(task.object??'—'))}
        ${row('Source',esc(task.source??'—'))}
        ${row('Station',esc(task.station??getConfig?.()?.devices?.[task.device]?.station??'—'))}
        ${row('Started',live.startedAt===null||live.startedAt===undefined?'—':fmt(live.startedAt)+' s')}
        ${row('Finished',live.finishedAt===null||live.finishedAt===undefined?'—':fmt(live.finishedAt)+' s')}
        ${row('Reason',esc(live.reason??'—'))}
      </div>
      ${relationButtons(ref)}`;
  }

  function render(){
    if(disposed)return;
    const ref=selection.get(), state=getState?.(), config=getConfig?.();
    let html='';
    if(!ref) html=sceneSummary(config,state);
    else {
      const entity=index.get(ref);
      if(!entity){ html=sceneSummary(config,state); }
      else if(ref.kind==='device') html=deviceView(ref,entity,state);
      else if(ref.kind==='robot') html=robotView(ref,entity,state);
      else if(ref.kind==='gripper') html=gripperView(ref,entity,state);
      else if(ref.kind==='object') html=objectView(ref,entity,state);
      else if(ref.kind==='station') html=stationView(ref,entity);
      else if(ref.kind==='task') html=taskView(ref,entity,state);
      else html=sceneSummary(config,state);
    }
    const nextHTML=html+`<div class="context-actions"><button type="button" data-context-focus ${ref?'':'disabled'}>聚焦选中</button><button type="button" data-context-clear ${ref?'':'disabled'}>清除选择</button></div>`;
    if(nextHTML!==lastHTML){patchMarkup(host,nextHTML);lastHTML=nextHTML;}
  }

  function update(){
    if(frame||disposed)return;
    frame=requestAnimationFrame(()=>{frame=0;render();});
  }

  const click=event=>{
    const related=event.target.closest('[data-related-kind]');
    if(related) selection.select({kind:related.dataset.relatedKind,id:related.dataset.relatedId},'inspector-related');
    if(event.target.closest('[data-context-focus]')) onFocus?.(selection.get());
    if(event.target.closest('[data-context-clear]')) selection.clear('inspector');
  };
  host.addEventListener('click',click);
  unsubscribe=selection.subscribe(render,{immediate:true});

  return {render,update,dispose(){disposed=true;cancelAnimationFrame(frame);unsubscribe();host.removeEventListener('click',click);}};
}
