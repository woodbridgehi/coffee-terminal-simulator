(function(root){
  const text=(value,locale)=>typeof value==='string'?value:value?.[locale] || value?.['zh-CN'] || '';
  const duration=slide=>{if(!['text','review'].includes(slide.type))return 3500;const copy=(slide.title||'')+' '+(slide.body||'');const han=(copy.match(/[\u3400-\u9fff]/g)||[]).length;const words=(copy.replace(/[\u3400-\u9fff]/g,' ').match(/\S+/g)||[]).length;return Math.min(24000,Math.max(7000,3500+han*230+words*280));};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  root.ShowcaseTiming={duration};
  if(!root.document?.querySelector)return;
  const host=document.querySelector('#terminalShowcase');if(!host)return;
  let configured=[],slides=[],index=0,signature='',active=false,paused=false,timer=null,latest=null,locale='zh-CN';
  const image=new Image();image.src='assets/showcase/shop.png';
  const card=host.querySelector('.showcase-card'),progress=host.querySelector('.showcase-progress'),count=host.querySelector('.showcase-count');
  const cup=`<svg viewBox="0 0 380 400" class="showcase-cup" aria-hidden="true"><defs><linearGradient id="cup-paper" x2="1"><stop stop-color="#eee2cf"/><stop offset=".5" stop-color="#fffdf4"/><stop offset="1" stop-color="#d6c7b1"/></linearGradient><linearGradient id="cup-coffee" x2="0" y2="1"><stop stop-color="#9a7050"/><stop offset="1" stop-color="#472c20"/></linearGradient></defs><ellipse cx="190" cy="350" rx="115" ry="20" fill="#0b2d2422"/><path d="M83 109h214l-24 210q-83 38-166 0Z" fill="url(#cup-paper)"/><ellipse cx="190" cy="109" rx="107" ry="30" fill="#fff8ed"/><ellipse cx="190" cy="108" rx="97" ry="23" fill="url(#cup-coffee)"/><path d="M165 106c-32-17-42 4-17 9 52 13 95-21 54-18-36 3-57 9-26 12" fill="none" stroke="#f8e7cf" stroke-width="5" stroke-linecap="round"/><path d="M97 221q93 28 186 0l-7 58q-86 32-172 0Z" fill="#1f5a46"/><image href="assets/brand/badges/precision-brew-cream.svg" x="125" y="239" width="130" height="43"/></svg>`;
  function schedule(){clearTimeout(timer);progress.style.animation='none';if(!active || paused || document.hidden || slides.length<2)return;void progress.offsetWidth;const ms=duration(slides[index]);progress.style.animation=`showcase-time ${ms}ms linear forwards`;timer=setTimeout(()=>{index=(index+1)%slides.length;paint();},ms);}
  function paint(){if(!slides.length)return;const slide=slides[index];
    card.className=`showcase-card showcase-${slide.type}`;
    card.innerHTML=`${slide.image?`<img class="showcase-photo" src="${esc(slide.image)}" alt="${esc(slide.title)}"/>`:''}${slide.type==='product'?`<div class="showcase-orbit">${cup}</div>`:''}<div class="showcase-copy"><span class="showcase-eyebrow">${esc(slide.eyebrow)}</span><h2>${esc(slide.title)}</h2>${slide.body?`<p>${esc(slide.body)}</p>`:''}${slide.author?`<span class="showcase-author">— ${esc(slide.author)}</span>`:''}</div>`;
    count.textContent=`${String(index+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`;
    host.querySelector('[data-showcase=pause]').textContent=paused?'▶':'Ⅱ';
    host.querySelector('[data-showcase=pause]').setAttribute('aria-label',locale==='en-US'?(paused?'Play carousel':'Pause carousel'):(paused?'继续轮播':'暂停轮播'));
    host.querySelector('[data-showcase=prev]').setAttribute('aria-label',locale==='en-US'?'Previous slide':'上一张');host.querySelector('[data-showcase=next]').setAttribute('aria-label',locale==='en-US'?'Next slide':'下一张');
    const photo=card.querySelector('img');if(photo)photo.onerror=()=>card.classList.add('showcase-image-unavailable');
    const next=slides[(index+1)%slides.length];if(next?.image){const preload=new Image();preload.src=next.image;}
    schedule();
  }
  function update(data,{active:enabled=true,locale:language='zh-CN'}={}){
    latest=data;const wasActive=active;active=enabled;locale=language;
    const products=(data.recipes||[]).filter(r=>r.enabled!==false && !(data.capabilities?.products||[]).some(p=>p.recipeId===r.recipeId && p.available===false)).slice(0,12).map(r=>({id:r.recipeId,type:'product',title:r.name || r.recipeId,eyebrow:locale==='en-US'?'ON THE MENU':'今日饮品',body:locale==='en-US'?'Made to order. Enjoy your moment.':'现点现做，把这一刻留给咖啡。'}));
    const editorial=configured.filter(s=>s.enabled!==false && ['image','text','review'].includes(s.type) && (s.type!=='review' || s.approved===true)).map(s=>({...s,title:text(s.title,locale),body:text(s.body,locale),eyebrow:text(s.eyebrow,locale),author:text(s.author,locale)}));
    const next=[];for(let i=0;i<Math.max(products.length,editorial.length);i++){if(products[i])next.push(products[i]);if(editorial[i])next.push(editorial[i]);}
    const nextSignature=JSON.stringify([locale,next]);
    if(signature!==nextSignature){const id=slides[index]?.id;signature=nextSignature;slides=next;index=Math.max(0,slides.findIndex(s=>s.id===id));paint();}
    else if(wasActive!==active)schedule();
  }
  host.querySelector('[data-showcase=next]').onclick=()=>{if(!slides.length)return;index=(index+1)%slides.length;paint();};
  host.querySelector('[data-showcase=prev]').onclick=()=>{if(!slides.length)return;index=(index-1+slides.length)%slides.length;paint();};
  host.querySelector('[data-showcase=pause]').onclick=()=>{paused=!paused;const button=host.querySelector('[data-showcase=pause]');button.textContent=paused?'▶':'Ⅱ';button.setAttribute('aria-label',locale==='en-US'?(paused?'Play carousel':'Pause carousel'):(paused?'继续轮播':'暂停轮播'));schedule();};
  document.addEventListener('visibilitychange',schedule);root.addEventListener('pagehide',()=>clearTimeout(timer));
  root.TerminalShowcase={update};
  fetch('showcase-content.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{configured=Array.isArray(data.slides)?data.slides:[];if(latest)update(latest,{active,locale});}).catch(()=>{});
})(globalThis);
