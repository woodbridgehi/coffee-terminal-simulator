import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {fk} from './robot.mjs';
// The simulation is Z-up. One root transform adapts it to Three's Y-up camera.
export class TwinRenderer {
  constructor(host,config) {
    this.config=config;this.host=host;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#edf0ea');
    this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label','数字孪生三维工作台，拖动旋转，滚轮缩放');
    this.camera=new THREE.PerspectiveCamera(42,1,.05,50);this.camera.position.set(4,3.6,5);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,1.1,0);this.controls.enableDamping=true;
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x54665a,2.5));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,7,4);this.scene.add(light);
    this.root=new THREE.Group();this.root.rotation.x=-Math.PI/2;this.scene.add(this.root);
    this.materials=[];this.meshes=[];this.labels=[];this.assetErrors=[];this.disposed=false;
    const grid=new THREE.GridHelper(8,40,0xa6b4a8,0xd7ded5);grid.position.y=.02;this.scene.add(grid);
    this.grid=grid;
    const material=(color,extras={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.45,metalness:.25,...extras});this.materials.push(m);return m;};
    this.mat=material;
    this.staticMeshes=config.obstacles.map(o=>{
      const m=this.mesh(new THREE.BoxGeometry(...o.size),material(o.color??'#879a90'));this.setPose(m,o.pose);
      if(o.visual?.url) {
        const url=new URL(o.visual.url,location.href);
        if(url.origin!==location.origin) {this.assetErrors.push(`${o.id}: only same-origin GLB assets supported`);return m;}
        new GLTFLoader().load(url.href,gltf=>{
          if(this.disposed){gltf.scene.traverse(n=>{n.geometry?.dispose();if(n.material)for(const m of [n.material].flat())m.dispose();});return;}
          const asset=gltf.scene;const holder=new THREE.Group();this.setPose(holder,o.pose);holder.add(asset);
          // glTF is Y-up. Imported visuals use a local Y-up -> Z-up conversion.
          asset.rotation.x=Math.PI/2;asset.scale.setScalar(o.visual.scale??1);this.root.add(holder);this.meshes.push(holder);m.visible=false;
        },undefined,e=>this.assetErrors.push(`${o.id}: ${e.message}`));
      }
      return m;
    });
    for(const [id,s] of Object.entries(config.stations)) {
      const pad=this.mesh(new THREE.CylinderGeometry(.1,.1,.008,32),material('#98ac9b'));pad.rotation.x=Math.PI/2;pad.position.set(s.pose.position[0],s.pose.position[1],.951);
      const label=document.createElement('span');label.className='twin-label';label.textContent=s.label;host.append(label);this.labels.push({label,position:new THREE.Vector3(...s.pose.position)});
    }
    this.arms={};
    for(const id of Object.keys(config.robots)) {
      const m=material(id==='left'?'#548dc3':'#bf8d45');
      this.arms[id]={links:Array.from({length:7},()=>this.mesh(new THREE.CylinderGeometry(config.robots[id].linkRadius,config.robots[id].linkRadius,1,16),m)),joints:Array.from({length:7},()=>this.mesh(new THREE.SphereGeometry(config.robots[id].linkRadius*1.18,16,12),material('#bbc4c7'))),gripper:this.mesh(new THREE.BoxGeometry(.13,.05,.07),material('#293b35'))};
    }
    this.objects={};
    for(const [id,o] of Object.entries(config.objects)) {
      const body=this.mesh(new THREE.CylinderGeometry(o.radius,o.radius*.87,o.height,32,1,true),material(id==='cup'?'#faf5e8':'#92a39f',{side:THREE.DoubleSide,transparent:true,opacity:.78}));
      const liquid=this.mesh(new THREE.CylinderGeometry(o.radius*.88,o.radius*.85,.001,32),material('#7f492f'));
      this.objects[id]={body,liquid};
    }
    this.debugGroup=new THREE.Group();this.root.add(this.debugGroup);this.debugVisible=false;
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();
  }
  mesh(geometry,material) {const m=new THREE.Mesh(geometry,material);this.root.add(m);this.meshes.push(m);return m;}
  setPose(mesh,p) {mesh.position.fromArray(p.position);mesh.quaternion.fromArray(p.quaternion);}
  resize() {const {clientWidth:w,clientHeight:h}=this.host;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);}
  apply(state) {
    this.state=state;
    for(const [id,def] of Object.entries(this.config.devices)) {
      const index=this.config.obstacles.findIndex(o=>o.id===`${def.station}-housing`);
      if(index>=0)this.staticMeshes[index].material.emissive.set(state.devices[id].mode==='fault'?'#812216':state.devices[id].mode==='running'?'#1d4824':'#000000');
    }
    for(const [id,rs] of Object.entries(state.robots)) {
      const f=fk(this.config.robots[id],rs.q),points=[...f.frames.map(p=>p.position),f.position],arm=this.arms[id];
      arm.links.forEach((m,i)=>{
        const a=new THREE.Vector3(...points[i]),b=new THREE.Vector3(...points[i+1]),d=b.clone().sub(a);
        m.position.copy(a.add(b).multiplyScalar(.5));m.scale.y=d.length();m.userData.collisionCapsule={radius:this.config.robots[id].linkRadius,length:d.length()};m.visible=d.length()>1e-8;
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
        arm.joints[i].position.fromArray(points[i]);
      });
      this.setPose(arm.gripper,f);
    }
    for(const [id,o] of Object.entries(state.objects)) {
      const {body,liquid}=this.objects[id],def=this.config.objects[id];this.setPose(body,o.pose);body.rotateX(Math.PI/2);
      const fill=Math.min(1,Object.values(o.contents).reduce((a,b)=>a+b,0)/def.capacityKg);
      this.setPose(liquid,o.pose);liquid.translateZ(-def.height/2+fill*def.height/2);liquid.rotateX(Math.PI/2);liquid.scale.y=Math.max(.001,fill*def.height)/.001;liquid.visible=fill>0;
      liquid.material.color.set(o.contents.foamer?'#d6b894':'#7f492f');
    }
    this.updateDebug();
  }
  updateDebug() {
    for(const m of [...this.debugGroup.children]) {m.geometry.dispose();m.material.dispose();this.debugGroup.remove(m);}
    if(!this.debugVisible)return;
    for(const m of [...this.staticMeshes,...Object.values(this.arms).flatMap(a=>[...a.links,a.gripper]),...Object.values(this.objects).map(o=>o.body)]) {
      const capsule=m.userData.collisionCapsule;
      const wire=new THREE.Mesh(capsule?new THREE.CapsuleGeometry(capsule.radius,capsule.length,4,12):m.geometry.clone(),new THREE.MeshBasicMaterial({color:this.state?.collisions.length?'#d84135':'#e99e25',wireframe:true}));
      wire.position.copy(m.position);wire.quaternion.copy(m.quaternion);if(!capsule)wire.scale.copy(m.scale);wire.scale.multiplyScalar(1.002);this.debugGroup.add(wire);
    }
  }
  render() {
    this.controls.update();this.renderer.render(this.scene,this.camera);
    for(const {label,position} of this.labels) {
      const p=position.clone().applyMatrix4(this.root.matrixWorld).project(this.camera);
      label.hidden=p.z>1||p.z< -1;label.style.left=`${(p.x+1)*this.host.clientWidth/2}px`;label.style.top=`${(1-p.y)*this.host.clientHeight/2}px`;
    }
  }
  dispose() {
    this.disposed=true;this.observer.disconnect();this.controls.dispose();this.labels.forEach(x=>x.label.remove());
    const geometries=new Set(),materials=new Set(),textures=new Set();this.scene.traverse(m=>{if(m.geometry)geometries.add(m.geometry);if(m.material)for(const mat of [m.material].flat()){materials.add(mat);for(const v of Object.values(mat))if(v?.isTexture)textures.add(v);}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());this.renderer.dispose();this.renderer.domElement.remove();
  }
}
