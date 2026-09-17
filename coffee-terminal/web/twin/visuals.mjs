import * as THREE from 'three';
import {box,cylinder,textPlate,M,createWorkcell,createCup} from '../robot/models.mjs';
import {brandCup} from '../robot/cup-brand.mjs';

// Clone shared model materials: disposing this viewport must not invalidate main's viewer.
export function ownMaterials(group){
  const copies=new Map();
  group.traverse(object=>{
    if(!object.material)return;
    const clone=m=>{if(!copies.has(m))copies.set(m,m.clone());return copies.get(m);};
    object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
  });return group;
}
export function cabinetVisual(def){
  const {group}=createWorkcell({cabinetOnly:true});
  // Main's worktop centre is [0,.88,.05], size [4.35,.12,2.45].
  const holder=new THREE.Group(),scaled=new THREE.Group();
  group.position.set(0,-.88,-.05);scaled.add(group);
  scaled.scale.set(def.size[0]/4.35,def.size[2]/.12,def.size[1]/2.45);
  holder.rotation.x=Math.PI/2;holder.add(scaled);return ownMaterials(holder);
}
export function deviceVisual(def,label){
  const [w,d,h]=def.size,group=new THREE.Group();group.rotation.x=Math.PI/2;
  const shell=M.shell.clone();shell.color.set(def.id==='brew-housing'?'#255846':'#e9e7de');
  box(group,[w,h,d],[0,0,0],shell,.025);
  box(group,[w*.78,h*.28,.008],[0,h*.08,d/2+.005],M.black,.012);
  box(group,[w*.9,.012,.01],[0,h*.32,d/2+.006],M.brass,.003);
  textPlate(group,label,[0,h*.4,d/2+.012],w*.8,h*.055,'#e9e7de','#255846');
  const indicator=new THREE.Mesh(new THREE.CircleGeometry(.009,16),new THREE.MeshBasicMaterial({color:'#83b59b'}));
  indicator.position.set(w*.31,h*.18,d/2+.011);group.add(indicator);
  for(const sign of [-1,1]){
    const dial=cylinder(group,w*.055,.016,[sign*w*.26,h*.03,d/2+.012],M.steel);dial.rotation.x=Math.PI/2;
  }
  // Door and ventilation stay within the model's configured footprint.
  box(group,[w*.8,h*.25,.008],[0,-h*.29,d/2+.005],M.dark,.006);
  for(let i=0;i<5;i++)box(group,[w*.65,.009,.006],[0,-h*.36+i*h*.035,d/2+.011],M.steel,.002);
  ownMaterials(group);return {group,indicator};
}
export function armVisual(radius){
  const group=new THREE.Group(),steel=M.lightSteel.clone(),blue=new THREE.MeshStandardMaterial({color:'#73aaca',metalness:.38,roughness:.32});
  const links=Array.from({length:7},()=>cylinder(group,radius*.86,1,[0,0,0],steel));
  const joints=Array.from({length:7},()=>{
    const joint=new THREE.Group();group.add(joint);
    const housing=cylinder(joint,radius*1.3,radius*1.65,[0,0,0],steel);housing.rotation.x=Math.PI/2;
    const cap=cylinder(joint,radius*1.15,.012,[0,0,radius*.87],blue);cap.rotation.x=Math.PI/2;
    const rim=cylinder(joint,radius*1.2,.008,[0,0,-radius*.85],M.dark);rim.rotation.x=Math.PI/2;
    return joint;
  });
  const gripper=new THREE.Group();group.add(gripper);
  box(gripper,[.13,.05,.07],[0,0,0],M.dark,.008);
  // Cosmetic jaw plates fit the existing gripper proxy; they do not solve grasping.
  for(const sign of [-1,1])box(gripper,[.014,.046,.055],[sign*.057,0,0],M.steel,.003);
  ownMaterials(group);return {group,links,joints,gripper};
}
export function cupVisual(def){
  const cup=createCup(),holder=new THREE.Group();holder.rotation.x=Math.PI/2;
  holder.scale.set(def.radius/.059,def.height/.176,def.radius/.059);
  holder.add(cup.group);ownMaterials(holder);
  const ready=brandCup(cup);ready.catch(()=>{});
  return {group:holder,ready,setSealed:value=>{cup.lid.visible=!!value;},setFill:(fraction,milk)=>{
    cup.liquid.visible=fraction>.001;cup.liquid.position.y=-.074+fraction*.15;
    cup.liquid.scale.setScalar(.86+fraction*.13);
    cup.liquid.material.color.copy(M.coffee.color).lerp(new THREE.Color('#cda578'),milk*.85);
  }};
}
export function milkVesselVisual(def){
  // A handle-free steel vessel: the kernel models a cylinder, not main's handled pitcher.
  const group=new THREE.Group();group.rotation.x=Math.PI/2;
  const h=def.height,r=def.radius,profile=[[r*.87,-h/2],[r,h/2],[r*.94,h/2],[r*.81,-h/2+.004],[0,-h/2+.004]];
  const shell=new THREE.Mesh(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),40),M.steel.clone());group.add(shell);shell.castShadow=true;
  const liquid=cylinder(group,r*.9,.004,[0,-h/2+.008,0],M.white.clone());
  return {group,ready:Promise.resolve(),setFill:f=>{liquid.visible=f>.001;liquid.position.y=-h/2+.008+f*(h-.016);}};
}
