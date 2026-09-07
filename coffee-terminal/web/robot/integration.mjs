import {terminalSnapshot,orderSnapshot} from './live-snapshot.mjs';

// This small bridge loads on both 2D pages. Three.js loads only when the user opens 3D.
const scriptURL=document.currentScript?.src || location.href;
const viewerURL=new URL('robot-live.bundle.js',scriptURL).href;
let latest=null,viewer=null,dialog=null,loading=null,opener=null,generation=0;
function ensureDialog(){
  if(dialog)return;
  dialog=document.createElement('dialog');dialog.className='rv-dialog';dialog.setAttribute('aria-label','三维制作视图');
  dialog.innerHTML=`<div class="rv-shell"><header class="rv-header"><div><strong class="rv-title">咖啡机器人</strong><span class="rv-state" role="status">等待状态</span></div><button class="rv-close" aria-label="返回二维视图">返回二维 ×</button></header>
    <div class="rv-stage"><div class="rv-canvas"></div><div class="rv-labels station-labels" aria-hidden="true"></div><div class="rv-views" role="group" aria-label="三维相机视角"><button data-rv-view="perspective" aria-pressed="true">透视</button><button data-rv-view="top" aria-pressed="false">俯视</button><button data-rv-view="front" aria-pressed="false">正视</button></div><p class="rv-loading" role="status">正在加载三维视图…</p></div>
    <footer class="rv-footer"><div><strong class="rv-step">等待设备步骤</strong><output class="rv-progress">0%</output></div><ul class="rv-materials"></ul><p>动作示意与设备步骤同步 · 拖动旋转 / 双指缩放</p></footer></div>`;
  document.body.append(dialog);
  dialog.querySelector('.rv-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
    generation++;viewer?.dispose();viewer=null;
    dialog.querySelector('.rv-loading').hidden=false;
    opener?.focus?.();
  });
}
function load(){
  if(window.CoffeeRobotLive)return Promise.resolve();
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=viewerURL;
    script.onload=()=>{loading=null;resolve();};
    script.onerror=()=>{loading=null;script.remove();reject(new Error('三维资源加载失败，请返回二维或重新打开。'));};
    document.head.append(script);
  });return loading;
}
async function open(){
  ensureDialog();if(dialog.open)return;
  opener=document.activeElement;dialog.showModal();
  const token=++generation;
  const message=dialog.querySelector('.rv-loading');message.hidden=false;message.textContent='正在加载三维视图…';
  try{
    await load();if(token!==generation || !dialog.open)return;
    viewer=window.CoffeeRobotLive.mount(dialog);message.hidden=true;
    if(latest)viewer.update(latest);
  }catch(error){message.hidden=false;message.textContent=error.message;}
}
function fail(error){
  viewer?.dispose();viewer=null;
  const message=dialog?.querySelector('.rv-loading');
  if(message){message.hidden=false;message.textContent=`三维显示暂不可用：${error.message}。可返回二维继续查看。`;}
}
function update(snapshot){
  latest=snapshot;
  // A rendering failure must never interrupt the existing 2D refresh loop.
  try{viewer?.update(snapshot);}catch(error){fail(error);}
}
document.addEventListener('click',(event)=>{if(event.target.closest('[data-open-robot]'))open();});
window.CoffeeRobotIntegration={
  terminal(data){update(terminalSnapshot(data));},
  order(order){update(orderSnapshot(order));},
  disconnected(){if(latest)update({...latest,connected:false});},
  open,
};
