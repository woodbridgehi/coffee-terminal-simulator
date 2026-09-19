(() => {
  'use strict';
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const app = $('#studio-app');
  const side = $('#side-panel');
  const inspector = $('#inspector');
  const dock = $('#dock');
  const prefsKey = 'ct-sim-studio-v2-live';
  const state = {workspace:'simulation', side:'experiment', dock:'timeline', dockH:238, dockCollapsed:false, dockMax:false};

  try { Object.assign(state, JSON.parse(localStorage.getItem(prefsKey) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(prefsKey, JSON.stringify(state)); } catch {} };
  const log = msg => { const el=$('#ui-console'); if(el){ const stamp=new Date().toLocaleTimeString(); el.textContent += '\n['+stamp+'] '+msg; el.scrollTop=el.scrollHeight; } };

  function setWorkspace(ws){
    state.workspace=ws; app.dataset.workspace=ws;
    $$('.workspace-tab').forEach(b=>b.classList.toggle('active',b.dataset.workspace===ws));
    const flow=$('#flow-preview'), dev=$('#device-workspace'), vp=$('#viewport-pane');
    flow.hidden = ws!=='flow'; dev.hidden = ws!=='device'; vp.hidden=false;
    if(ws==='flow'){ side.classList.remove('hidden'); setSide('scene'); state.dock='timeline'; }
    if(ws==='simulation'){ side.classList.add('hidden'); state.dock='timeline'; }
    if(ws==='workcell'){ side.classList.remove('hidden'); setSide('scene'); }
    if(ws==='device'){ side.classList.add('hidden'); }
    applyDock(); save();
    log('workspace -> '+ws);
  }
  $$('.workspace-tab').forEach(b=>b.addEventListener('click',()=>setWorkspace(b.dataset.workspace)));

  const sideTitles={scene:'场景树 · SCENE',experiment:'实验控制 · EXPERIMENT',materials:'物料监控 · MATERIALS',layers:'显示层 · LAYERS'};
  function setSide(name){
    state.side=name; side.classList.remove('hidden'); $('#side-title').textContent=sideTitles[name]||name;
    $$('.side-view').forEach(v=>v.hidden=v.dataset.panelView!==name);
    $$('.rail-btn[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));
    save(); mirror();
  }
  $$('.rail-btn[data-panel]').forEach(b=>b.addEventListener('click',()=>{
    if(!side.classList.contains('hidden') && state.side===b.dataset.panel){ side.classList.add('hidden'); b.classList.remove('active'); save(); }
    else setSide(b.dataset.panel);
  }));
  $('#side-close').addEventListener('click',()=>{side.classList.add('hidden');$$('.rail-btn[data-panel]').forEach(b=>b.classList.remove('active'));save();});
  $$('.rail-btn[data-tool]').forEach(b=>b.addEventListener('click',()=>{$$('.rail-btn[data-tool]').forEach(x=>x.classList.toggle('active',x===b));log('tool -> '+b.dataset.tool+' (UI mode only)');}));

  $('#inspector-toggle').addEventListener('click',()=>inspector.classList.toggle('hidden'));
  $('#inspector-close').addEventListener('click',()=>inspector.classList.add('hidden'));
  $$('.ins-tab').forEach(b=>b.addEventListener('click',()=>{
    $$('.ins-tab').forEach(x=>x.classList.toggle('active',x===b));
    $$('.ins-view').forEach(v=>v.hidden=v.dataset.insView!==b.dataset.ins);
  }));
  $('#config-open-inspector').addEventListener('click',()=>{inspector.classList.remove('hidden');$('.ins-tab[data-ins="config"]').click();hidePopovers();});

  function applyDock(){
    $$('.dock-tab').forEach(b=>b.classList.toggle('active',b.dataset.dock===state.dock));
    $$('.dock-pane').forEach(p=>p.classList.toggle('active',p.dataset.dockPane===state.dock));
    dock.classList.toggle('collapsed',!!state.dockCollapsed);
    const h=state.dockCollapsed?34:(state.dockMax?Math.round(innerHeight*.62):state.dockH);
    app.style.setProperty('--dock',h+'px');
  }
  $$('.dock-tab').forEach(b=>b.addEventListener('click',()=>{state.dock=b.dataset.dock;state.dockCollapsed=false;applyDock();save();}));
  $('#dock-collapse').addEventListener('click',()=>{state.dockCollapsed=!state.dockCollapsed;state.dockMax=false;applyDock();save();});
  $('#dock-max').addEventListener('click',()=>{state.dockMax=!state.dockMax;state.dockCollapsed=false;applyDock();save();});
  const grip=$('#dock-grip'); let dragging=false;
  grip.addEventListener('pointerdown',e=>{dragging=true;grip.setPointerCapture(e.pointerId);state.dockCollapsed=false;document.body.style.cursor='row-resize';});
  grip.addEventListener('pointermove',e=>{if(!dragging)return;state.dockH=Math.max(120,Math.min(innerHeight*.7,innerHeight-e.clientY-27));state.dockMax=false;applyDock();});
  grip.addEventListener('pointerup',()=>{dragging=false;document.body.style.cursor='';save();});

  const layoutBtn=$('#layout-toggle'), layoutPop=$('#layout-popover'), cfgBtn=$('#config-toggle'), cfgPop=$('#config-popover');
  function placePopover(btn,pop){const r=btn.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(innerWidth-pop.offsetWidth-8,r.right-pop.offsetWidth))+'px';}
  function hidePopovers(){layoutPop.hidden=true;cfgPop.hidden=true;layoutBtn.setAttribute('aria-expanded','false');cfgBtn.setAttribute('aria-expanded','false');}
  layoutBtn.addEventListener('click',e=>{e.stopPropagation();const show=layoutPop.hidden;hidePopovers();if(show){layoutPop.hidden=false;placePopover(layoutBtn,layoutPop);layoutBtn.setAttribute('aria-expanded','true');}});
  cfgBtn.addEventListener('click',e=>{e.stopPropagation();const show=cfgPop.hidden;hidePopovers();if(show){cfgPop.hidden=false;placePopover(cfgBtn,cfgPop);cfgBtn.setAttribute('aria-expanded','true');}});
  document.addEventListener('click',e=>{if(!e.target.closest('.popover')&&!e.target.closest('#layout-toggle')&&!e.target.closest('#config-toggle'))hidePopovers();});
  $$('[data-layout]').forEach(b=>b.addEventListener('click',()=>{
    const mode=b.dataset.layout; hidePopovers();
    if(mode==='simulation'){setWorkspace('simulation');inspector.classList.remove('hidden');state.dock='timeline';state.dockH=238;state.dockCollapsed=false;}
    if(mode==='workcell'){setWorkspace('workcell');inspector.classList.remove('hidden');setSide('scene');state.dockH=200;}
    if(mode==='fault'){setWorkspace('simulation');side.classList.remove('hidden');setSide('experiment');state.dock='events';state.dockH=286;state.dockCollapsed=false;}
    applyDock();save();
  }));

  const labels=$('#labels'), collision=$('#collision');
  const labelsProxy=$('#labels-proxy'), collisionProxy=$('#collision-proxy');
  labelsProxy.addEventListener('click',()=>{labels.checked=!labels.checked;labels.dispatchEvent(new Event('change'));labelsProxy.classList.toggle('active',labels.checked);});
  collisionProxy.addEventListener('click',()=>{collision.checked=!collision.checked;collision.dispatchEvent(new Event('change'));collisionProxy.classList.toggle('active',collision.checked);});
  labels.addEventListener('change',()=>labelsProxy.classList.toggle('active',labels.checked));
  collision.addEventListener('change',()=>collisionProxy.classList.toggle('active',collision.checked));
  $('#view').addEventListener('change',()=>{$('#sb-view').textContent=$('#view').value;log('camera -> '+$('#view').value);});

  function mirrorContainer(source,targets){
    if(!source) return;
    targets.forEach(sel=>{const target=$(sel); if(!target)return; target.innerHTML=''; [...source.children].forEach(ch=>{const row=document.createElement('div');row.className='mirror-item';const parts=[...ch.children].map(x=>x.textContent.trim());row.innerHTML='<b>'+(parts[0]||ch.textContent.trim())+'</b><span>'+parts.slice(1).join(' · ')+'</span>';target.appendChild(row);});});
  }
  function mirror(){
    mirrorContainer($('#devices'),['#scene-device-mirror','#device-rack-mirror']);
    mirrorContainer($('#materials'),['#material-mirror']);
    mirrorContainer($('#containers'),['#container-mirror']);
    const rack=$('#device-rack-mirror'); if(rack){[...rack.children].forEach(x=>x.classList.add('device-card'));}
  }

  function syncLive(){
    const clock=$('#clock')?.textContent||'0.00 s', status=$('#status')?.textContent||'LOADING', progress=$('#progress')?.textContent||'0 / 25';
    $('#clock-mirror').textContent=clock; $('#viewport-status').textContent=status; $('#viewport-progress').textContent=progress;
    $('#metric-time').textContent=clock; $('#metric-progress').textContent=progress; $('#metric-status').textContent=status;
    $('#sb-time').textContent=clock; $('#sb-status').textContent=status; $('#sb-progress').textContent=progress;
    const play=$('#play'); if(play) play.dataset.running=String(play.textContent.trim()==='暂停');
    const src=$('#config-source')?.textContent||''; const m=src.match(/配置来源：([^。]+)/); if(m) $('#scene-name').textContent=m[1].replace(/ · .*/,'').slice(0,30);
    mirror();
  }
  const watched=['#clock','#status','#progress','#devices','#materials','#containers','#config-source'];
  watched.forEach(sel=>{const el=$(sel);if(el)new MutationObserver(syncLive).observe(el,{childList:true,subtree:true,characterData:true});});
  new MutationObserver(syncLive).observe($('#play'),{childList:true,subtree:true,characterData:true,attributes:true});

  document.addEventListener('keydown',e=>{
    if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    if(e.key==='1') setWorkspace('workcell');
    if(e.key==='2') setWorkspace('flow');
    if(e.key==='3') setWorkspace('simulation');
    if(e.key==='4') setWorkspace('device');
  });

  if(state.side) setSide(state.side); else setSide('experiment');
  setWorkspace(state.workspace||'simulation'); applyDock(); syncLive();
})();
