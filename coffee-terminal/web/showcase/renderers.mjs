import {assetURL} from './contract.mjs';

function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text)e.textContent=text;return e;}
function copy(slide){const host=element('div','showcase-copy');host.append(element('span','showcase-eyebrow',slide.eyebrow),element('h2','',slide.title));if(slide.body)host.append(element('p','',slide.body));if(slide.author)host.append(element('span','showcase-author',`— ${slide.author}`));return host;}

function standard(host,slide,context){
  let image;
  const ready=new Promise((resolve,reject)=>{
    if(slide.src){
      image=element('img',slide.type==='product'?'showcase-cup':'showcase-photo');image.alt=slide.title||'';
      image.onload=()=>resolve();image.onerror=()=>reject(new Error(`Asset could not load: ${slide.src}`));
      image.style.objectFit=slide.fit||'cover';image.src=assetURL(context.base,slide.src);
      if(slide.type==='product'){const orbit=element('div','showcase-orbit');orbit.append(image);host.append(orbit);}else host.append(image);
    }else resolve();
  });
  if(slide.title||slide.body||slide.eyebrow)host.append(copy(slide));
  return {ready,setPaused(paused){host.classList.toggle('showcase-paused',paused);},destroy(){if(image){image.onload=null;image.onerror=null;image.removeAttribute('src');}host.replaceChildren();}};
}

function html(host,slide,context){
  const frame=element('iframe','showcase-frame');frame.title=slide.title||slide.id;
  frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');
  frame.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'; autoplay 'none'; fullscreen 'none'");
  frame.tabIndex=-1;frame.style.pointerEvents='none';
  const channel=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
  let paused=true,destroyed=false,settled=false,resolveReady,rejectReady;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const send=()=>{if(destroyed)return;const r=host.getBoundingClientRect();frame.contentWindow?.postMessage({protocol:'coffee.showcase.v1',type:'showcase-context',channel,locale:context.locale,paused,reducedMotion:motion.matches,viewport:{width:Math.round(r.width),height:Math.round(r.height)},designSize:context.designSize,products:context.products},'*');};
  const onMessage=event=>{
    const m=event.data;
    if(destroyed || event.source!==frame.contentWindow || !m || m.protocol!=='coffee.showcase.v1' || m.channel!==channel)return;
    if(m.type==='showcase-ready' && !settled){settled=true;resolveReady();}
    if(m.type==='showcase-error'){const error=new Error(String(m.message||'HTML slide failed').slice(0,300));if(!settled){settled=true;rejectReady(error);}else context.fail(error);}
    // Duration and navigation remain manifest-owned: content cannot hold or rush the playlist.
  };
  const resize=()=>{if(slide.layout==='canvas'){const r=host.getBoundingClientRect(),d=context.designSize;const scale=(slide.fit==='cover'?Math.max:Math.min)(r.width/d.width,r.height/d.height);frame.style.width=d.width+'px';frame.style.height=d.height+'px';frame.style.transform=`translate(-50%,-50%) scale(${scale})`;}send();};
  window.addEventListener('message',onMessage);const observer=new ResizeObserver(resize);observer.observe(host);
  motion.addEventListener('change',send);
  frame.onload=send;frame.src=assetURL(context.base,slide.src);host.append(frame);resize();
  return {ready,setPaused(value){paused=value;send();},destroy(){destroyed=true;observer.disconnect();motion.removeEventListener('change',send);window.removeEventListener('message',onMessage);frame.onload=null;frame.remove();}};
}

export const renderers=new Map([['image',standard],['svg',standard],['product',standard],['text',standard],['review',standard],['html',html],['animation',html]]);
