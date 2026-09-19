(() => {
  'use strict';
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const app = $('#studio-app');
  const side = $('#side-panel');
  const inspector = $('#inspector');
  const dock = $('#dock');
  const prefsKey = 'ct-sim-studio-v2-live';
  const state = {workspace:'simulation', side:'experiment', dock:'timeline', dockH:238, dockCollapsed:false, dockMax:false,sideHidden:true,inspectorHidden:false};

  try { Object.assign(state, JSON.parse(localStorage.getItem(prefsKey) || '{}')); } catch {}
  if(!['workcell','flow','simulation','device'].includes(state.workspace))state.workspace='simulation';
  if(!['scene','experiment','materials','layers'].includes(state.side))state.side='experiment';
  if(!['timeline','events','metrics','console'].includes(state.dock))state.dock='timeline';
  if(!Number.isFinite(state.dockH))state.dockH=238;
  const save = () => { try { localStorage.setItem(prefsKey, JSON.stringify(state)); } catch {} };
  const log = msg => { const el=$('#ui-console'); if(el){ const stamp=new Date().toLocaleTimeString(); el.textContent += '\n['+stamp+'] '+msg; el.scrollTop=el.scrollHeight; } };

  function setWorkspace(ws,{restore=false}={}){
    state.workspace=ws; app.dataset.workspace=ws;
    $$('.workspace-tab').forEach(b=>b.classList.toggle('active',b.dataset.workspace===ws));
    const flow=$('#flow-preview'), dev=$('#device-workspace'), vp=$('#viewport-pane');
    flow.hidden = ws!=='flow'; dev.hidden = ws!=='device'; vp.hidden=false;
    const savedSideHidden=state.sideHidden;
    if(!restore&&ws==='flow'){ side.classList.remove('hidden'); setSide('scene'); state.dock='timeline'; }
    if(!restore&&ws==='simulation'){ side.classList.add('hidden'); state.dock='timeline'; }
    if(!restore&&ws==='workcell'){ side.classList.remove('hidden'); setSide('scene'); }
    if(!restore&&ws==='device'){ side.classList.add('hidden'); }
    if(restore)side.classList.toggle('hidden',savedSideHidden);else state.sideHidden=side.classList.contains('hidden');
    $$('.rail-btn[data-panel]').forEach(b=>b.classList.toggle('active',!state.sideHidden&&state.side===b.dataset.panel));
    applyDock(); save();
    log('workspace -> '+ws);
  }
  $$('.workspace-tab').forEach(b=>b.addEventListener('click',()=>setWorkspace(b.dataset.workspace)));

  const sideTitles={scene:'场景树 · SCENE',experiment:'实验控制 · EXPERIMENT',materials:'物料监控 · MATERIALS',layers:'显示层 · LAYERS'};
  function setSide(name){
    state.side=name;state.sideHidden=false; side.classList.remove('hidden'); $('#side-title').textContent=sideTitles[name]||name;
    $$('.side-view').forEach(v=>v.hidden=v.dataset.panelView!==name);
    $$('.rail-btn[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));
    save(); mirror();
  }
  $$('.rail-btn[data-panel]').forEach(b=>b.addEventListener('click',()=>{
    if(!side.classList.contains('hidden') && state.side===b.dataset.panel){ side.classList.add('hidden');state.sideHidden=true;b.classList.remove('active');save(); }
    else setSide(b.dataset.panel);
  }));
  $('#side-close').addEventListener('click',()=>{side.classList.add('hidden');state.sideHidden=true;$$('.rail-btn[data-panel]').forEach(b=>b.classList.remove('active'));save();});
  $$('.rail-btn[data-tool]').forEach(b=>b.addEventListener('click',()=>{$$('.rail-btn[data-tool]').forEach(x=>x.classList.toggle('active',x===b));log('tool -> '+b.dataset.tool+' (UI mode only)');}));

  const setInspector=hidden=>{state.inspectorHidden=hidden;inspector.classList.toggle('hidden',hidden);save();};
  $('#inspector-toggle').addEventListener('click',()=>setInspector(!state.inspectorHidden));
  $('#inspector-close').addEventListener('click',()=>setInspector(true));
  $$('.ins-tab').forEach(b=>b.addEventListener('click',()=>{
    $$('.ins-tab').forEach(x=>x.classList.toggle('active',x===b));
    $$('.ins-view').forEach(v=>v.hidden=v.dataset.insView!==b.dataset.ins);
  }));
  $('#config-open-inspector').addEventListener('click',()=>{setSide('experiment');hidePopovers();$('#load-shared').scrollIntoView({block:'nearest'});});

  function applyDock(){
    $$('.dock-tab').forEach(b=>b.classList.toggle('active',b.dataset.dock===state.dock));
    $$('.dock-pane').forEach(p=>p.classList.toggle('active',p.dataset.dockPane===state.dock));
    dock.classList.toggle('collapsed',!!state.dockCollapsed);
    state.dockH=Math.max(120,Math.min(innerHeight*.7,state.dockH));
    const h=state.dockCollapsed?34:(state.dockMax?Math.round(innerHeight*.62):state.dockH);
    app.style.setProperty('--dock',h+'px');
  }
  $$('.dock-tab').forEach(b=>b.addEventListener('click',()=>{state.dock=b.dataset.dock;state.dockCollapsed=false;applyDock();save();}));
  $('#dock-collapse').addEventListener('click',()=>{state.dockCollapsed=!state.dockCollapsed;state.dockMax=false;applyDock();save();});
  $('#dock-max').addEventListener('click',()=>{state.dockMax=!state.dockMax;state.dockCollapsed=false;applyDock();save();});
  window.addEventListener('resize',applyDock);
  const grip=$('#dock-grip'); let dragging=false;
  grip.addEventListener('pointerdown',e=>{dragging=true;grip.setPointerCapture(e.pointerId);state.dockCollapsed=false;document.body.style.cursor='row-resize';});
  grip.addEventListener('pointermove',e=>{if(!dragging)return;state.dockH=Math.max(120,Math.min(innerHeight*.7,innerHeight-e.clientY-27));state.dockMax=false;applyDock();});
  const endResize=()=>{dragging=false;document.body.style.cursor='';save();};
  grip.addEventListener('pointerup',endResize);grip.addEventListener('pointercancel',endResize);

  const layoutBtn=$('#layout-toggle'), layoutPop=$('#layout-popover'), cfgBtn=$('#config-toggle'), cfgPop=$('#config-popover');
  function placePopover(btn,pop){const r=btn.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(innerWidth-pop.offsetWidth-8,r.right-pop.offsetWidth))+'px';}
  function hidePopovers(){layoutPop.hidden=true;cfgPop.hidden=true;layoutBtn.setAttribute('aria-expanded','false');cfgBtn.setAttribute('aria-expanded','false');}
  layoutBtn.addEventListener('click',e=>{e.stopPropagation();const show=layoutPop.hidden;hidePopovers();if(show){layoutPop.hidden=false;placePopover(layoutBtn,layoutPop);layoutBtn.setAttribute('aria-expanded','true');}});
  cfgBtn.addEventListener('click',e=>{e.stopPropagation();const show=cfgPop.hidden;hidePopovers();if(show){cfgPop.hidden=false;placePopover(cfgBtn,cfgPop);cfgBtn.setAttribute('aria-expanded','true');}});
  document.addEventListener('click',e=>{if(!e.target.closest('.popover')&&!e.target.closest('#layout-toggle')&&!e.target.closest('#config-toggle'))hidePopovers();});
  $$('[data-layout]').forEach(b=>b.addEventListener('click',()=>{
    const mode=b.dataset.layout; hidePopovers();
    if(mode==='simulation'){setWorkspace('simulation');setInspector(false);state.dock='timeline';state.dockH=238;state.dockCollapsed=false;}
    if(mode==='workcell'){setWorkspace('workcell');setInspector(false);setSide('scene');state.dockH=200;}
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

  const mirrorSignatures=new WeakMap();
  function mirrorContainer(source,targets){
    if(!source) return;
    const rows=[...source.children].map(ch=>{
      const parts=[...ch.children].map(x=>x.textContent.trim());
      return [parts[0]||ch.textContent.trim(),parts.slice(1).join(' · ')];
    }),signature=JSON.stringify(rows);
    targets.forEach(sel=>{const target=$(sel);if(!target||mirrorSignatures.get(target)===signature)return;
      mirrorSignatures.set(target,signature);
      target.replaceChildren(...rows.map(([name,value])=>{const row=document.createElement('div');row.className='mirror-item';const title=document.createElement('b'),detail=document.createElement('span');title.textContent=name;detail.textContent=value;row.append(title,detail);return row;}));
    });
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
    const play=$('#play'); if(play){const running=String(play.textContent.trim()==='暂停');if(play.dataset.running!==running)play.dataset.running=running;}
    const src=$('#config-source')?.textContent||'';const details=$('#config-details');if(details&&details.textContent!==src)details.textContent=src; const m=src.match(/配置来源：([^。]+)/); if(m) $('#scene-name').textContent=m[1].replace(/ · .*/,'').slice(0,30);
    mirror();
  }
  // Coalesce kernel DOM updates once per frame; never observe attributes written by syncLive.
  let syncFrame=0;
  const observer=new MutationObserver(()=>{if(!syncFrame)syncFrame=requestAnimationFrame(()=>{syncFrame=0;syncLive();});});
  for(const sel of ['#clock','#status','#progress','#devices','#materials','#containers','#config-source','#play']){
    const el=$(sel);if(el)observer.observe(el,{childList:true,subtree:true,characterData:true});
  }

  document.addEventListener('keydown',e=>{
    if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||e.target.isContentEditable||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key==='1') setWorkspace('workcell');
    if(e.key==='2') setWorkspace('flow');
    if(e.key==='3') setWorkspace('simulation');
    if(e.key==='4') setWorkspace('device');
  });

  const restoredSideHidden=state.sideHidden;setSide(state.side);state.sideHidden=restoredSideHidden;
  setInspector(state.inspectorHidden);setWorkspace(state.workspace,{restore:true});applyDock();syncLive();
})();
