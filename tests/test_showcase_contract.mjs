import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const bundle=await build({entryPoints:[new URL('../coffee-terminal/web/showcase/contract.mjs',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {validateManifest,playlist,duration}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
// Contract fixtures must not depend on the installed editorial content.
const copy=title=>({'zh-CN':{title},'en-US':{title}});
const example={schemaVersion:1,id:'fixture',version:'1.0.0',name:'Fixture',designSize:{width:1600,height:1100},playlist:'interleave-products',slides:[
 {id:'menu',type:'product',src:'assets/cup.svg',content:copy('Menu')},
 ...['space','craft','detail'].map(id=>({id,type:'image',src:`assets/${id}.png`,content:copy(id)})),
 {id:'philosophy',type:'text',duration:'auto',content:copy('Make room for a moment.')}
]};
test('shipped Beijing collection retains showroom pages without legacy product templates',()=>{
 const shipped=JSON.parse(readFileSync(new URL('../coffee-terminal/web/showcase-packages/default/manifest.json',import.meta.url)));
 validateManifest(shipped);
 assert.equal(playlist(shipped,'en-US',[{id:'latte',name:'Latte'}]).length,17);
 assert.deepEqual(shipped.slides.slice(-3).map(s=>s.id),['space','craft','detail']);
 assert(!shipped.slides.some(s=>s.type==='product'||s.id==='philosophy'));
});
test('strict package contract rejects unknown fields, missing locales, and traversal',()=>{
  for(const change of [m=>m.extra=true,m=>delete m.slides[0].content['en-US'],m=>m.slides[1].src='assets/../escape.png',m=>m.slides[1].durationMs=24000,m=>m.slides[1].type='video']){
    const m=structuredClone(example);change(m);assert.throws(()=>validateManifest(m));
  }
  assert.equal(validateManifest(example),example);
  assert.throws(()=>validateManifest(JSON.parse(JSON.stringify(example).replace('"schemaVersion":1','"__proto__":{},"schemaVersion":1'))));
});
test('empty menus retain editorial slides; product template expands only supplied public names',()=>{
  assert.equal(playlist(example,'en-US',[]).length,4);
  const rows=playlist(example,'en-US',[{id:'latte',name:'Latte',token:'never-copy'}]);
  assert.equal(rows[0].title,'Latte');assert.equal(rows[1].id,'space');assert.equal(rows[0].token,undefined);
  assert.equal(rows[4].title,'Make room for a moment.');
});
test('localized assets follow selected language and explicit duration stays bounded',()=>{
  const m=structuredClone(example);delete m.slides[1].src;m.slides[1].srcByLocale={'zh-CN':'assets/zh.png','en-US':'assets/en.png'};
  assert.equal(playlist(m,'en-US',[])[0].src,'assets/en.png');
  assert.equal(duration({type:'html',durationMs:9000}),9000);
});
