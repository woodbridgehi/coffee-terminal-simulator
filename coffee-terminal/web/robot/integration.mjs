import {CompletionClose} from './completion-close.mjs';
import {ui} from './ui-locale.mjs';
import {terminalSnapshot,orderSnapshot} from './live-snapshot.mjs';

// This small bridge loads on both 2D pages. Three.js loads only when the user opens 3D.
const scriptURL=document.currentScript?.src || location.href;
const viewerResource=new URL('robot-live.bundle.js',scriptURL);
viewerResource.search=new URL(scriptURL).search;
const viewerURL=viewerResource.href;
let latest=null,viewer=null,dialog=null,loading=null,opener=null,generation=0;
const completionClose=new CompletionClose(()=>{if(dialog?.open && !watching)dialog.close();});
let inlineRoot=null,inlineViewer=null,inlineGeneration=0,watching=null;
let processPlayer=null,audioLoading=null,audioFrame=null;
async function ensureProcessAudio(){
  if(!window.CoffeeSound?.enabled)return;
  if(!window.CoffeeProcessAudio){
    if(!audioLoading)audioLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script'),url=new URL('process-audio.bundle.js',scriptURL);
      url.search=new URL(scriptURL).search;script.src=url.href;
      script.onload=()=>{audioLoading=null;resolve();};
      script.onerror=()=>{audioLoading=null;script.remove();reject(new Error('工序声音加载失败'));};
      document.head.append(script);
    });
    try{await audioLoading;}catch{window.CoffeeSound?.mute();return;}
  }
  if(processPlayer || !window.CoffeeSound?.enabled)return;
  processPlayer=new window.CoffeeProcessAudio.ProcessAudio(window.CoffeeSound,{visualPosition:now=>inlineViewer?.audioPosition(now) || (!watching && viewer?.audioPosition(now))});
  if(latest)try{processPlayer.update(latest);}catch{stopAudio();return;}
  const frame=now=>{if(!processPlayer)return;try{processPlayer.frame(now);}catch{stopAudio();return;}audioFrame=requestAnimationFrame(frame);};
  audioFrame=requestAnimationFrame(frame);
}
function stopAudio(){cancelAnimationFrame(audioFrame);processPlayer?.dispose();processPlayer=null;window.CoffeeSound?.mute();}
window.addEventListener('coffee-sound-change',ensureProcessAudio);
window.addEventListener('pagehide',()=>{cancelAnimationFrame(audioFrame);processPlayer?.dispose();processPlayer=null;});
function ensureDialog(){
  if(dialog && dialog.dataset.locale!==document.documentElement.lang && !dialog.open){dialog.dispatchEvent(new Event('locale-dispose'));dialog.remove();dialog=null;}
  if(dialog)return;
  dialog=document.createElement('dialog');dialog.className='rv-dialog';dialog.dataset.locale=document.documentElement.lang;dialog.setAttribute('aria-label',ui('三维制作视图'));
  dialog.innerHTML=`<div class="rv-shell"><header class="rv-header"><div><strong class="rv-title">${ui('咖啡机器人')}</strong><span class="rv-state" role="status">${ui('等待状态')}</span></div><button class="rv-sound" type="button">${ui('开启声音')}</button><button class="rv-close" aria-label="${ui('返回二维视图')}">${ui('返回二维 ×')}</button></header>
    <div class="rv-stage"><div class="rv-canvas"></div><div class="rv-labels station-labels" aria-hidden="true"></div><div class="rv-views" role="group" aria-label="${ui('三维相机视角')}"><button data-rv-view="shop" aria-pressed="true">${ui('门店')}</button><button data-rv-view="perspective" aria-pressed="false">${ui('工作站')}</button><button data-rv-view="art" aria-pressed="false">${ui('拉花特写')}</button><button data-rv-view="top" aria-pressed="false">${ui('俯视')}</button><button data-rv-view="front" aria-pressed="false">${ui('正视')}</button></div><p class="rv-loading" role="status">${ui('正在加载三维视图…')}</p></div>
    <footer class="rv-footer"><div><strong class="rv-step">${ui('等待设备步骤')}</strong><output class="rv-progress">0%</output></div><ul class="rv-materials"></ul><p>${ui('动作示意与设备步骤同步 · 拖动旋转 / 双指缩放')}</p></footer></div>`;
  document.body.append(dialog);
  const soundButton=dialog.querySelector('.rv-sound');
  const soundLabel=()=>{const en=document.documentElement.lang.startsWith('en');soundButton.textContent=window.CoffeeSound?.enabled?(en?'Mute':'静音'):(en?'Enable sound':'开启声音');soundButton.setAttribute('aria-pressed',String(!!window.CoffeeSound?.enabled));};
  soundButton.onclick=async()=>{if(window.CoffeeSound?.enabled)window.CoffeeSound.mute();else await window.CoffeeSound?.enable();soundLabel();};
  window.addEventListener('coffee-sound-change',soundLabel);dialog.addEventListener('locale-dispose',()=>window.removeEventListener('coffee-sound-change',soundLabel),{once:true});soundLabel();
  dialog.querySelector('.rv-close').onclick=()=>{window.CoffeeSound?.mute();dialog.close();};
  dialog.addEventListener('cancel',()=>window.CoffeeSound?.mute());
  dialog.addEventListener('close',()=>{
    completionClose.clear();
    generation++;viewer?.dispose();viewer=null;watching=null;dialog.classList.remove("rv-spectator");dialog.querySelector('.rv-close').textContent=ui('返回二维 ×');window.dispatchEvent(new Event("coffee-watch-closed"));window.CoffeeSound?.mute();
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
    script.onerror=()=>{loading=null;script.remove();reject(new Error(ui('三维资源加载失败，请返回二维或重新打开。')));};
    document.head.append(script);
  });return loading;
}
async function open(){
  ensureDialog();if(dialog.open)return;
  opener=document.activeElement;dialog.showModal();
  completionClose.update(latest,!watching);
  const token=++generation;
  const message=dialog.querySelector('.rv-loading');message.hidden=false;message.textContent=ui('正在加载三维视图…');
  try{
    await load();if(token!==generation || !dialog.open)return;
    viewer=window.CoffeeRobotLive.mount(dialog);message.hidden=true;
    if(watching || latest)viewer.update(watching || latest);
  }catch(error){message.hidden=false;message.textContent=error.message;}
}
function fail(error){
  viewer?.dispose();viewer=null;
  const message=dialog?.querySelector('.rv-loading');
  if(message){message.hidden=false;message.textContent=document.documentElement.lang.startsWith('en')?`3D unavailable: ${error.message}. Continue in 2D.`:`三维显示暂不可用：${error.message}。可返回二维继续查看。`;}
}
function update(snapshot){
  latest=snapshot;
  completionClose.update(snapshot,!!dialog?.open && !watching);
  try{processPlayer?.update(snapshot);}catch{stopAudio();}
  // A rendering failure must never interrupt the existing 2D refresh loop.
  try{if(!watching)viewer?.update(snapshot);inlineViewer?.update(snapshot);}catch(error){fail(error);}
}
async function inline(host,enabled=true){
  if(!host || !enabled){inlineGeneration++;inlineViewer?.dispose();inlineViewer=null;inlineRoot?.remove();inlineRoot=null;return;}
  if(inlineRoot){host.append(inlineRoot);return;}
  ensureDialog();
  const root=document.createElement('section');root.className='rv-inline';root.innerHTML=dialog.innerHTML;
  root.querySelector('.rv-close').remove();root.querySelector('.rv-sound').remove();root.querySelector('.rv-footer p')?.remove();
  inlineRoot=root;host.append(root);const token=++inlineGeneration;
  try{await load();if(token!==inlineGeneration)return;
    inlineViewer=window.CoffeeRobotLive.mount(root);root.querySelector('.rv-loading').hidden=true;
    if(latest)inlineViewer.update(latest);
  }catch{root.querySelector('.rv-loading').textContent=ui('三维暂不可用，可切换二维查看进度。');}
}
async function watch(snapshot){
  if(!snapshot){if(watching)dialog?.close();return;}
  watching=snapshot;ensureDialog();dialog.classList.add('rv-spectator');dialog.querySelector('.rv-close').textContent=document.documentElement.lang.startsWith('en')?'Back to queue ×':'返回排队 ×';
  await open();if(watching)viewer?.update(watching);
}
window.addEventListener('pagehide',()=>{completionClose.clear();inlineGeneration++;inlineViewer?.dispose();inlineViewer=null;});
document.addEventListener('click',(event)=>{if(event.target.closest('[data-open-robot]'))open();});
window.CoffeeRobotIntegration={
  terminal(data){update(terminalSnapshot(data));},
  order(order){update(orderSnapshot(order));},
  disconnected(){if(latest)update({...latest,connected:false});},
  open, inline, watch,
};
