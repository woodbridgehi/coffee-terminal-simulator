import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Texture } from 'three';
import { attachShopAsset } from '../coffee-terminal/web/robot/shop-asset.mjs';
const response = async () => ({ ok:true, arrayBuffer:async()=>new ArrayBuffer(0) });
function setup(loader, fetcher=response) {
  const group=new Group(), fallback=new Group();group.add(fallback);
  return { group, fallback, asset:attachShopAsset(group,[fallback],{url:'https://example.invalid/shop.glb',fetcher,loader}) };
}
test('decoded model replaces fallback atomically and retains dynamic shadows',async()=>{
  const scene=new Group(), mesh=new Mesh(new BoxGeometry(),new MeshStandardMaterial());scene.add(mesh);
  let finish;const parse=new Promise(resolve=>{finish=resolve;});
  const {group,fallback,asset}=setup({parseAsync:()=>parse});
  assert.equal(fallback.visible,true);finish({scene});await asset.ready;
  assert.equal(fallback.visible,false);assert.equal(group.userData.staticAsset,'ready');assert.equal(mesh.receiveShadow,true);asset.dispose();
});
test('failed asset leaves original shop visible',async()=>{
  const {group,fallback,asset}=setup({},async()=>({ok:false,status:404}));await asset.ready;
  assert.equal(fallback.visible,true);assert.equal(group.userData.staticAsset,'fallback');asset.dispose();
});
test('close during decoding releases all PBR textures and never attaches late model',async()=>{
  const scene=new Group(), material=new MeshStandardMaterial(), texture=new Texture();
  let closed=0,freed=0;texture.image={close:()=>closed++};texture.addEventListener('dispose',()=>freed++);
  material.aoMap=texture;material.emissiveMap=texture;scene.add(new Mesh(new BoxGeometry(),material));
  let finish,started;const decoding=new Promise(resolve=>{started=resolve;});
  const {group,fallback,asset}=setup({parseAsync:()=>{started();return new Promise(resolve=>finish=resolve);}});
  await decoding;asset.dispose();finish({scene});await asset.ready;
  assert.equal(group.children.length,1);assert.equal(fallback.visible,true);assert.equal(freed,1);assert.equal(closed,1);
});
test('shipped GLB embeds baked PBR maps and matches the cloud artifact',async()=>{
  const data=await readFile(new URL('../coffee-terminal/web/assets/scene/coffee-shop-v1.glb',import.meta.url));
  assert.equal(data.readUInt32LE(0),0x46546c67);
  const gltf=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
  assert.equal(gltf.meshes[0].primitives.length,5);
  for(const m of gltf.materials){assert.ok(m.pbrMetallicRoughness.baseColorTexture);assert.ok(m.occlusionTexture);assert.ok(m.emissiveTexture);}
  assert.ok(gltf.images.every(image=>image.bufferView!==undefined));
  assert.ok(data.length<4*1024*1024);
  assert.deepEqual(data,await readFile(new URL('../../coffee-cloud-mvp/public/robot/assets/scene/coffee-shop-v1.glb',import.meta.url)));
});
