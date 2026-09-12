import schema from './manifest.schema.json';

export function validate(value, spec=schema, path='manifest'){
  if(spec.$ref)spec=schema.$defs[spec.$ref.split('/').pop()];
  const types={object:v=>v!==null && typeof v==='object' && !Array.isArray(v),array:Array.isArray,string:v=>typeof v==='string',integer:Number.isInteger,boolean:v=>typeof v==='boolean'};
  const fail=message=>{throw new Error(`${path}: ${message}`);};
  if(spec.type && !types[spec.type](value))fail(`expected ${spec.type}`);
  if('const' in spec && value!==spec.const)fail('invalid constant');
  if(spec.enum && !spec.enum.includes(value))fail('unsupported value');
  if(spec.type==='object'){
    for(const key of spec.required||[])if(!Object.prototype.hasOwnProperty.call(value,key))fail(`missing ${key}`);
    for(const [key,child] of Object.entries(value)){
      if(!Object.prototype.hasOwnProperty.call(spec.properties||{},key))fail(`unknown field ${key}`);
      validate(child,spec.properties[key],`${path}.${key}`);
    }
  }
  if(spec.type==='array'){
    if(value.length<(spec.minItems||0)||value.length>(spec.maxItems||Infinity))fail('invalid count');
    value.forEach((v,i)=>validate(v,spec.items,`${path}[${i}]`));
  }
  if(spec.type==='string' && (value.length<(spec.minLength||0)||value.length>(spec.maxLength||Infinity)||(spec.pattern && !new RegExp(spec.pattern).test(value))))fail('invalid string');
  if(spec.type==='integer' && (value<(spec.minimum??-Infinity)||value>(spec.maximum??Infinity)))fail('out of range');
  return value;
}

export function assetURL(base,path){
  if(!/^(assets|slides)\/[a-zA-Z0-9_./-]+$/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid package asset path');
  const root=new URL(base,location.href),url=new URL(path,root);
  if(url.origin!==root.origin || !url.pathname.startsWith(root.pathname))throw new Error('Asset outside package');
  return url.href;
}

export function validateManifest(value){
  validate(value);const ids=new Set();let nonProduct=0,products=0;
  for(const slide of value.slides){
    if(ids.has(slide.id))throw new Error('Duplicate slide id');ids.add(slide.id);
    const kind=slide.type,sources=slide.src?[slide.src]:Object.values(slide.srcByLocale||{});
    if(slide.layout && !['html','animation'].includes(kind))throw new Error('Layout only applies to HTML/animation');
    if(slide.template && !['text','review'].includes(kind))throw new Error('Template only applies to text/review');
    if('approved' in slide && kind!=='review')throw new Error('Approval only applies to review');
    if(slide.fit && ['text','review'].includes(kind))throw new Error('Text/review does not accept fit');
    if(slide.src && slide.srcByLocale)throw new Error('Use src OR srcByLocale');
    if(['image','svg','product','html','animation'].includes(kind) && !sources.length)throw new Error('Source required');
    if(['text','review'].includes(kind) && (!slide.content||sources.length))throw new Error('Text/review requires content and no source');
    if(slide.duration && (!['text','review'].includes(kind)||slide.durationMs!==undefined))throw new Error('Invalid auto duration');
    if(['image','svg','product'].includes(kind) && ((slide.durationMs??3500)<3000||(slide.durationMs??3500)>4000))throw new Error('Image duration outside 3000–4000ms');
    if(['html','animation'].includes(kind) && !slide.durationMs)throw new Error('HTML duration required');
    if(kind==='review' && slide.enabled!==false && slide.approved!==true)throw new Error('Unapproved review');
    for(const source of sources){
      if(source.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Unsafe asset path');
      const pattern=['html','animation'].includes(kind)?/\.html$/:kind==='svg'?/\.svg$/:/\.(svg|png|jpe?g|webp)$/;
      if(!pattern.test(source.toLowerCase()))throw new Error('Incompatible asset format');
    }
    if(kind==='product')products++;
    else if(slide.enabled!==false)nonProduct++;
  }
  if(!nonProduct || products>1)throw new Error('Needs non-product fallback and at most one product collection');
  return value;
}

export function duration(slide){
  if(slide.durationMs)return Math.min(24000,Math.max(1000,slide.durationMs));
  if(!['text','review'].includes(slide.type))return 3500;
  const copy=(slide.title||'')+' '+(slide.body||''),han=(copy.match(/[\u3400-\u9fff]/g)||[]).length;
  const words=(copy.replace(/[\u3400-\u9fff]/g,' ').match(/\S+/g)||[]).length;
  return Math.min(24000,Math.max(7000,3500+han*230+words*280));
}

export function playlist(manifest,locale,products=[]){
  const editorial=[],menu=[],all=[];
  for(const slide of manifest.slides){
    if(slide.enabled===false || (slide.type==='review' && !slide.approved))continue;
    const copy=slide.content?.[locale]||{};
    const item={...slide,...copy,src:slide.srcByLocale?.[locale]||slide.src};
    if(slide.type==='product'){
      for(const product of products.slice(0,12)){
        const row={...item,id:`${slide.id}:${product.id}`,title:product.name,eyebrow:copy.title};menu.push(row);all.push(row);
      }
    }else{editorial.push(item);all.push(item);}
  }
  if(manifest.playlist!=='interleave-products')return all;
  const result=[];for(let i=0;i<Math.max(menu.length,editorial.length);i++){if(menu[i])result.push(menu[i]);if(editorial[i])result.push(editorial[i]);}return result;
}
