import {ShowcasePlayer,loadPackage} from './player.mjs';
const params=new URLSearchParams(location.search),key=params.get('key'),locale=params.get('locale')==='en-US'?'en-US':'zh-CN';document.documentElement.lang=locale;
const host=document.querySelector('#preview-player'),height=Math.min(2160,Math.max(200,Number(params.get('height'))||559));host.querySelector('.showcase-card').style.height=height+'px';
const player=new ShowcasePlayer(host,{onError:detail=>{const p=document.createElement('p');p.textContent=detail.message;document.body.append(p);},onPackageFailed:()=>{},onSlideReady:key=>parent.postMessage({type:'showcase-preview-ready',key},location.origin)});
if(/^[a-z][a-z0-9-]{0,47}\/[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/.test(key||'')){
  const base=new URL(`/packs/${key}/`,location.href).href;
  loadPackage(base).then(manifest=>{player.setContext({active:true,locale,products:[{id:'sample-latte',name:locale==='en-US'?'Latte':'拿铁'}]});player.setPackage(manifest,base,key);}).catch(error=>{host.textContent=error.message;});
}else host.textContent='Invalid package key';
window.addEventListener('pagehide',()=>player.destroy());
