import {ShowcasePlayer,loadPackage} from './player.mjs';
import {duration} from './contract.mjs';

// This is the only adapter that understands the terminal snapshot. Nothing else
// in the content/player layer receives runtime, credentials, recipes or orders.
const host=globalThis.document?.querySelector('#terminalShowcase');
globalThis.ShowcaseTiming={duration};
if(host){
  const builtin=new URL('showcase-packages/default/',document.currentScript?.src||location.href).href;
  let connection=null,connecting=false,polling=false,installing=false,context={active:false,locale:'zh-CN',products:[]},epoch=0,lastPoll=0,state=null;
  const failedKeys=new Set();
  const player=new ShowcasePlayer(host,{onError:detail=>{console.warn('Showcase:',detail.message);window.dispatchEvent(new CustomEvent('showcase-error',{detail}));},onPackageFailed:async(key,error)=>{
    failedKeys.add(key);
    const native=window.pywebview?.api;
    if(native?.report_showcase_failure)try{await native.report_showcase_failure(key,error.message);}catch{}
    const prior=state?.previous;
    if(connection && prior && !failedKeys.has(prior))await install(`${connection.publicUrl}/packs/${prior}/`,prior);
    else if(key!=='default/1.1.0')await install(builtin,'default/1.1.0');
  }});
  async function install(base,key){
    const generation=++epoch;installing=true;
    try{const manifest=await loadPackage(base);if(generation!==epoch || !context.active)return;player.setPackage(manifest,base,key);player.setContext(context);}
    catch(error){if(generation!==epoch)return;failedKeys.add(key);if(key!=='default/1.1.0')await install(builtin,'default/1.1.0');console.warn('Showcase package:',error.message);}
    finally{installing=false;}
  }
  async function connect(){
    if(connection||connecting)return;
    const native=window.pywebview?.api;
    if(!native?.get_showcase_connection)return;
    connecting=true;
    try{connection=await native.get_showcase_connection();lastPoll=0;}catch(error){console.warn('Showcase service:',error.message);}finally{connecting=false;}
  }
  async function poll(){
    if(polling||!context.active||document.hidden)return;
    await connect();if(!connection)return;
    polling=true;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
    try{const response=await fetch(`${connection.publicUrl}/active.json`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Content service unavailable');const next=await response.json();state=next;
      if(!context.active)return;
      if(!/^[a-z][a-z0-9-]{0,47}\/[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/.test(next.active))throw new Error('Invalid active package');
      if(next.active!==player.key && !failedKeys.has(next.active))await install(`${connection.publicUrl}/packs/${next.active}/`,next.active);
    }catch(error){console.warn('Showcase refresh:',error.message);}finally{clearTimeout(timeout);polling=false;lastPoll=Date.now();}
  }
  function update(data,{active=true,locale='zh-CN'}={}){
    const previous=context.active;
    const products=(data.recipes||[]).filter(r=>r.enabled!==false && !(data.capabilities?.products||[]).some(p=>p.recipeId===r.recipeId && p.available===false)).slice(0,12).map(r=>({id:String(r.recipeId).slice(0,100),name:String(r.name||r.recipeId).slice(0,160)}));
    context={active:!!active,locale,products};player.setContext(context);
    if(!active){epoch++;return;}
    if(!player.manifest && !polling && !installing)install(builtin,'default/1.1.0');
    if(!previous || Date.now()-lastPoll>15000)poll();
  }
  document.addEventListener('pywebviewready',connect);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
  document.querySelector('[data-manage-showcase]')?.addEventListener('click',async()=>{
    await connect();
    if(!connection){const message=context.locale==='en-US'?'Package management requires the terminal app or the standalone showcase service.':'请在终端应用中管理内容包，或启动独立轮播管理服务。';window.alert(message);return;}
    const dialog=document.createElement('dialog');dialog.className='showcase-manager-dialog';
    const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label',context.locale==='en-US'?'Close':'关闭');
    const frame=document.createElement('iframe');frame.title=context.locale==='en-US'?'Content packages':'轮播内容包';frame.src=connection.manageUrl;
    close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{dialog.remove();lastPoll=0;poll();},{once:true});dialog.append(close,frame);document.body.append(dialog);dialog.showModal();
  });
  window.addEventListener('pagehide',()=>{epoch++;player.destroy();});
  globalThis.TerminalShowcase={update};
}
