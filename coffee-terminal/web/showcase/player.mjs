import {validateManifest,playlist,duration,assetURL} from './contract.mjs';
import {renderers} from './renderers.mjs';

export class ShowcasePlayer{
  constructor(host,{onError=()=>{},onPackageFailed=()=>{},onSlideReady=()=>{}}={}){
    this.host=host;this.card=host.querySelector('.showcase-card');this.progress=host.querySelector('.showcase-progress');this.count=host.querySelector('.showcase-count');
    this.onError=onError;this.onPackageFailed=onPackageFailed;this.onSlideReady=onSlideReady;this.locale='zh-CN';this.products=[];this.active=false;this.paused=false;this.index=0;this.slides=[];this.bad=new Set();this.generation=0;
    this.click=e=>{const button=e.target.closest('[data-showcase]');if(!button)return;const action=button.dataset.showcase;if(action==='pause'){this.paused=!this.paused;this.refreshPause();this.labels();}else this.move(action==='prev'?-1:1);};
    this.visibility=()=>this.refreshPause();host.addEventListener('click',this.click);document.addEventListener('visibilitychange',this.visibility);
  }
  setPackage(manifest,base,key){
    validateManifest(manifest);this.manifest=manifest;this.base=base;this.key=key;this.bad.clear();this.exhausted=false;this.index=0;this.signature='';this.rebuild();
  }
  setContext({active,locale,products}){
    const changed=locale!==this.locale || JSON.stringify(products)!==JSON.stringify(this.products);
    const wasActive=this.active;this.active=!!active;this.locale=locale==='en-US'?'en-US':'zh-CN';this.products=products||[];
    if(changed && this.manifest)this.rebuild();
    else if(!wasActive && this.active && !this.renderer && this.slides.length && !this.exhausted)this.paint();
    if(!this.active){this.clear();this.card.replaceChildren();}else this.refreshPause();this.labels();
  }
  rebuild(){
    const next=playlist(this.manifest,this.locale,this.products),signature=JSON.stringify(next);
    if(this.signature===signature && this.renderer)return;
    const id=this.slides[this.index]?.id;this.slides=next;this.signature=signature;this.index=Math.max(0,next.findIndex(s=>s.id===id));if(this.active)this.paint();
  }
  labels(){
    const en=this.locale==='en-US';const pause=this.host.querySelector('[data-showcase=pause]');
    if(pause){pause.textContent=this.paused?'▶':'Ⅱ';pause.setAttribute('aria-label',this.paused?(en?'Play carousel':'继续轮播'):(en?'Pause carousel':'暂停轮播'));}
    this.host.querySelector('[data-showcase=prev]')?.setAttribute('aria-label',en?'Previous slide':'上一张');this.host.querySelector('[data-showcase=next]')?.setAttribute('aria-label',en?'Next slide':'下一张');
    if(this.count)this.count.textContent=`${String(this.index+1).padStart(2,'0')} / ${String(this.slides.length).padStart(2,'0')}`;
  }
  clear(){this.generation++;clearTimeout(this.timer);clearTimeout(this.loadingTimer);this.renderer?.destroy();this.renderer=null;this.preload?.removeAttribute('src');this.preload=null;this.ready=false;this.started=null;if(this.progress)this.progress.style.animation='none';}
  async paint(){
    this.clear();if(!this.active || !this.slides.length || this.exhausted)return;const token=this.generation,slide=this.slides[this.index];
    this.card.className=`showcase-card showcase-${slide.type}${slide.template==='quote'?' showcase-quote':''}`;
    if(!slide.title&&!slide.body&&!slide.eyebrow)this.card.classList.add('showcase-no-copy');
    this.card.style.background=this.manifest.background||'';if(['text','review','product'].includes(slide.type))this.card.style.background='';
    this.remaining=duration(slide);this.labels();
    try{
      const factory=renderers.get(slide.type);if(!factory)throw new Error('Unsupported renderer');
      this.renderer=factory(this.card,slide,{base:this.base,locale:this.locale,designSize:this.manifest.designSize,products:this.products.map(p=>({id:p.id,name:p.name})),fail:error=>{if(token===this.generation)this.failed(error);}});
      this.renderer.setPaused(true);
      await Promise.race([this.renderer.ready,new Promise((_,reject)=>{this.loadingTimer=setTimeout(()=>reject(new Error('Slide load timed out (5s)')),5000);})]);
      if(token!==this.generation)return;clearTimeout(this.loadingTimer);this.ready=true;
      this.onSlideReady(this.key,slide.id);
      const next=this.slides[(this.index+1)%this.slides.length];
      if(next?.src && ['image','svg','product'].includes(next.type)){this.preload=new Image();this.preload.src=assetURL(this.base,next.src);}
      if(this.progress)this.progress.style.animation=`showcase-time ${this.remaining}ms linear forwards`;
      this.refreshPause();
    }catch(error){if(token===this.generation)this.failed(error);}
  }
  failed(error){
    this.bad.add(this.slides[this.index]?.id);this.onError({key:this.key,slideId:this.slides[this.index]?.id,message:error.message});
    if(this.slides.every(slide=>this.bad.has(slide.id))){this.clear();this.exhausted=true;this.card.textContent='Coffee Terminal';this.onPackageFailed(this.key,error);return;}
    this.move(1);
  }
  move(delta){if(!this.slides.length)return;for(let n=0;n<this.slides.length;n++){this.index=(this.index+delta+this.slides.length)%this.slides.length;if(!this.bad.has(this.slides[this.index].id))break;}this.paint();}
  refreshPause(){
    const pause=!this.active||this.paused||document.hidden;this.renderer?.setPaused(pause);
    if(this.progress)this.progress.style.animationPlayState=pause?'paused':'running';
    clearTimeout(this.timer);
    if(this.started!=null){this.remaining=Math.max(0,this.remaining-(performance.now()-this.started));this.started=null;}
    if(!pause && this.ready){this.started=performance.now();this.timer=setTimeout(()=>this.move(1),this.remaining);}
    // Third-party JavaScript cannot be forcibly paused; unload it while hidden/paused.
    if(pause && ['html','animation'].includes(this.slides[this.index]?.type) && this.renderer){this.clear();this.card.textContent=this.locale==='en-US'?'Paused':'已暂停';}
    else if(!pause && this.active && !this.renderer && this.slides.length && !this.exhausted)this.paint();
  }
  destroy(){this.clear();this.host.removeEventListener('click',this.click);document.removeEventListener('visibilitychange',this.visibility);}
}

export async function loadPackage(base){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch(new URL('manifest.json',base),{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Package manifest unavailable');const manifest=await response.json();return validateManifest(manifest);}finally{clearTimeout(timeout);}
}
