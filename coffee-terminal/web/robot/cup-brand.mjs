import * as THREE from 'three';
import precision from '../assets/brand/badges/precision-brew-cream.svg';
import seal from '../assets/brand/badges/ai-brew-system.svg';

// Printed artwork follows the cup sleeve. No changes to grasp or liquid geometry.
export function brandCup(cup){
  const old=cup.group.getObjectByName('cup-brand-label');
  if(old){old.removeFromParent();old.geometry.dispose();old.material.map?.dispose();old.material.dispose();}
  const jobs=[];
  function print(svg,top,bottom,height,angle,arc){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=Math.round(1024*height/((top+bottom)/2*arc));
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const material=new THREE.MeshStandardMaterial({map:texture,transparent:true,roughness:.8,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(top,bottom,height,64,1,true,angle,arc),material);mesh.position.y=-.01;mesh.name='brand-printed-sleeve';cup.group.add(mesh);
    let disposed=false;texture.addEventListener('dispose',()=>{disposed=true;});
    const image=new Image();jobs.push(new Promise((resolve,reject)=>{image.onload=()=>{if(!disposed){canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);texture.needsUpdate=true;}resolve();};image.onerror=()=>reject(new Error('Cup artwork unavailable'));image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg.replace('<svg ','<svg width="1024" height="'+canvas.height+'" '));}));
  }
  print(precision,.053,.0506,.032,-.95,1.9);
  print(seal.replaceAll('#17382D','#F6F0E5').replaceAll('#B78A52','#D7B67E'),.0535,.0502,.043,2*Math.PI/3-.415,.83);
  print(precision,.053,.0506,.032,4*Math.PI/3-.95,1.9);
  return Promise.all(jobs);
}
