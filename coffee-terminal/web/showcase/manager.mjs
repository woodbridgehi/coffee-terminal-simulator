const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
const dictionaries={
  'zh-CN':{title:'轮播内容包',intro:'导入 ZIP，预览后启用。终端在待机时自动加载。',import:'导入 ZIP',refresh:'刷新',rollback:'回退上一版本',preview:'内容预览',previewNote:'预览使用示例饮品，不连接设备订单。',footer:'本机内容管理',activate:'启用',active:'已启用',current:'当前内容包',success:'操作完成',loading:'处理中…',select:'请先预览这个版本',missing:'管理凭证失效，请从终端重新打开管理页。',zip:'ZIP 不得超过 50 MiB',error:'最近自动回退原因'},
  'en-US':{title:'Content packages',intro:'Import a ZIP, preview, then activate. The terminal loads it while idle.',import:'Import ZIP',refresh:'Refresh',rollback:'Roll back',preview:'Preview',previewNote:'Preview uses sample drinks and has no connection to device orders.',footer:'Local content management',activate:'Activate',active:'Active',current:'Active package',success:'Done',loading:'Working…',select:'Preview this version first',missing:'Management token missing. Reopen this page from the terminal.',zip:'ZIP must not exceed 50 MiB',error:'Last automatic fallback'}
};
let locale='zh-CN',catalog=null,selected=null,previewed=new Set(),busy=false,statusKey=null;
const $=s=>document.querySelector(s),t=k=>dictionaries[locale][k];
function status(message,error=false){statusKey=Object.keys(dictionaries[locale]).find(k=>t(k)===message)||null;$('#status').textContent=message;$('#status').dataset.error=String(error);}
async function api(path,options={}){const response=await fetch('/api/'+path,{...options,headers:{'X-Showcase-Token':token,...options.headers}});const data=await response.json();if(!response.ok)throw new Error(data.error||response.status);return data;}
function draw(){
  document.documentElement.lang=locale;document.querySelectorAll('[data-copy]').forEach(e=>e.textContent=t(e.dataset.copy));
  $('#packages').replaceChildren();if(!catalog)return;
  $('#active').textContent=`${t('current')}: ${catalog.active}`;$('#last-error').textContent=catalog.lastError?`${t('error')}: ${catalog.lastError}`:'';
  $('#rollback').disabled=busy||!catalog.previous;
  for(const pack of catalog.packages){const card=document.createElement('article');card.className='package';const title=document.createElement('strong');title.textContent=pack.name;const key=document.createElement('small');key.textContent=pack.key;const actions=document.createElement('div');actions.className='actions';
    const preview=document.createElement('button');preview.textContent=t('preview');preview.onclick=()=>showPreview(pack.key);
    const activate=document.createElement('button');activate.textContent=pack.key===catalog.active?t('active'):t('activate');activate.disabled=busy||pack.key===catalog.active||!previewed.has(pack.key);activate.title=previewed.has(pack.key)?'':t('select');activate.onclick=()=>run(()=>api('activate',{method:'POST',body:JSON.stringify({key:pack.key})}));
    actions.append(preview,activate);card.append(title,key,actions);$('#packages').append(card);}
}
function showPreview(key){selected=key;previewed.delete(key);const [width,height]=$('#size').value.split(',');$('#preview').style.width=width+'px';$('#preview').style.height=(Number(height)+66)+'px';$('#preview').src=`preview.html?key=${encodeURIComponent(key)}&locale=${locale}&height=${height}`;draw();}
window.addEventListener('message',event=>{if(event.source!==$('#preview').contentWindow || event.origin!==location.origin || event.data?.type!=='showcase-preview-ready' || event.data.key!==selected)return;previewed.add(selected);draw();});
async function refresh(){catalog=await api('catalog');draw();}
async function run(action){if(busy)return;busy=true;draw();status(t('loading'));try{await action();await refresh();status(t('success'));}catch(error){status(error.message,true);}finally{busy=false;draw();}}
$('#archive').onchange=()=>{const file=$('#archive').files[0];if(!file)return;if(file.size>50*1024*1024){status(t('zip'),true);return;}run(()=>api('import',{method:'POST',headers:{'Content-Type':'application/zip'},body:file}));$('#archive').value='';};
$('#refresh').onclick=()=>run(refresh);$('#rollback').onclick=()=>run(()=>api('rollback',{method:'POST',body:'{}'}));
$('#locale').onchange=()=>{locale=$('#locale').value;draw();if(statusKey)status(t(statusKey),$('#status').dataset.error==='true');if(selected)showPreview(selected);};$('#size').onchange=()=>{if(selected)showPreview(selected);};
draw();if(token)run(refresh);else status(t('missing'),true);
