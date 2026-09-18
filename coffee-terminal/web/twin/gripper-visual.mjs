import * as THREE from 'three';
import {box,cylinder,M} from '../robot/models.mjs';
// Nominal silhouette from the supplied drawing: 110 mm across, 60 mm deep,
// 81 mm fingers + 85.6 mm body/mount. TCP stays at the finger contact centre.
export function createGripperVisual(maxOpeningMm=120){
 const group=new THREE.Group();group.name='parallel-gripper';
 const silver=new THREE.MeshStandardMaterial({color:'#d8dcde',metalness:.65,roughness:.3});
 const rubber=new THREE.MeshStandardMaterial({color:'#292c2d',metalness:.05,roughness:.83});
 box(group,[.110+Math.max(0,maxOpeningMm-85)/1000,.060,.020],[0,0,-.0585],silver,.009);
 box(group,[.108+Math.max(0,maxOpeningMm-85)/1000,.058,.012],[0,0,-.0745],M.dark,.008);
 const motor=cylinder(group,.025,.045,[0,0,-.1036],M.dark);motor.rotation.x=Math.PI/2;
 const collar=cylinder(group,.030,.013,[0,0,-.084],silver);collar.rotation.x=Math.PI/2;
 box(group,[.086+Math.max(0,maxOpeningMm-85)/1000,.004,.002],[0,0,-.0475],M.dark,.001);
 const jaws=[];
 for(const sign of [-1,1]){
  const jaw=new THREE.Group();group.add(jaw);jaws.push({jaw,sign});
  box(jaw,[.012,.027,.081],[0,0,0],silver,.002);
  box(jaw,[.003,.028,.065],[-sign*.006,0,.006],rubber,.001);
  for(let i=0;i<15;i++)box(jaw,[.001,.030,.0012],[-sign*.0075,0,-.024+i*.0042],rubber,.0003);
  // Recessed side panels and cross braces suggest the machined lightening pockets.
  for(const side of [-1,1]){
   box(jaw,[.008,.001,.060],[0,side*.0138,.004],M.dark,.001);
   for(let i=0;i<4;i++){const brace=box(jaw,[.009,.0015,.002],[0,side*.0146,-.021+i*.016],silver,.0005);brace.rotation.y=(i%2?1:-1)*.5;}
   const screw=cylinder(jaw,.002,.002,[0,side*.015,-.031],M.steel);screw.rotation.z=Math.PI/2;
  }
 }
 const led=new THREE.Mesh(new THREE.SphereGeometry(.003,12,8),new THREE.MeshBasicMaterial({color:'#34795D'}));led.position.set(0,-.030,-.074);group.add(led);
 const setState=state=>{const width=Math.max(0,Math.min(120,state.openingMm??maxOpeningMm))/1000;for(const {jaw,sign} of jaws)jaw.position.x=sign*(width/2+.008);led.material.color.set(state.fault?'#8A5A3B':state.mode==='running'?'#B78A52':'#34795D');group.userData.openingMm=width*1000;};
 setState({openingMm:maxOpeningMm});return {group,setState};
}
