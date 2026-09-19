import {cupOnPad} from './cup-sensor.mjs';
import {installationPose} from './mounts.mjs';
import {DeviceEffects} from './device-effects.mjs';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createWorkcell} from '../robot/models.mjs';
import mainLayout from '../../../config/twin/coffee-workcell-main-v2.json' with {type:'json'};
import {createShop} from '../robot/shop.mjs';
import {armVisualState,containerFill,scenePosition} from './visual-state.mjs';
import {ownMaterials,cabinetVisual,deviceVisual,armVisual,cupVisual,milkVesselVisual} from './visuals.mjs';

// Presentation only: all moving poses and contents come from the twin state.
export class TwinRenderer {
  constructor(host,config){
    this.host=host;this.config=config;this.disposed=false;this.labels=[];this.assetErrors=[];
    this.entityRoots=new Map();this.pickRoots=[];this.raycaster=new THREE.Raycaster();this.pointerDown=null;
    this.onSelection=null;this.onFocus=null;this.selectionHelper=null;this.relatedHelpers=[];
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e8dece');this.scene.fog=new THREE.Fog('#e8dece',22,45);
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.domElement.setAttribute('aria-label','数字孪生三维工作台，拖动旋转，滚轮缩放');this.renderer.domElement.tabIndex=0;host.append(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(37,1,.05,60);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.09;
    this.controls.minDistance=2;this.controls.maxDistance=26;this.controls.maxPolarAngle=Math.PI/2-.03;
    this.pmrem=new THREE.PMREMGenerator(this.renderer);const room=new RoomEnvironment();this.environment=this.pmrem.fromScene(room,.04);room.dispose();
    this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.4;
    this.scene.add(new THREE.HemisphereLight('#fffdf5','#847660',1));
    const sun=new THREE.DirectionalLight('#ffe6bf',2.4);sun.position.set(7,6,3);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.5,far:24});sun.shadow.normalBias=.025;sun.shadow.bias=-.0001;this.scene.add(sun);
    const rim=new THREE.DirectionalLight('#edf4ff',.65);rim.position.set(3,4,-4);this.scene.add(rim);
    this.root=new THREE.Group();this.root.rotation.x=-Math.PI/2;this.scene.add(this.root);
    this.shop=createShop();ownMaterials(this.shop.group);this.scene.add(this.shop.group);
    const jobs=[this.shop.ready];this.devices={};
    if(config.presentation==='main-workcell'&&(config.installation||JSON.stringify(config.obstacles)===JSON.stringify(mainLayout.obstacles)&&JSON.stringify(config.stations)===JSON.stringify(mainLayout.stations))) {
      this.workcell=createWorkcell({cupPadTop:mainLayout.stations.cups.pose.position[2]-config.objects.cup.height*.089/.176});ownMaterials(this.workcell.group);this.scene.add(this.workcell.group);
      for(const [id,delta] of Object.entries(config.installation?.deltas??{})){
        const station=config.devices[id]?.station,part=this.workcell.components[station];if(!part)continue;
        const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2),turn=new THREE.Matrix4().makeRotationFromQuaternion(q);
        const matrix=new THREE.Matrix4().compose(new THREE.Vector3(...delta.position),new THREE.Quaternion(...delta.quaternion),new THREE.Vector3(1,1,1));
        part.applyMatrix4(turn.clone().multiply(matrix).multiply(turn.clone().invert()));
      }
    }
    for(const def of config.obstacles){
      if(this.workcell)continue;
      const holder=new THREE.Group();holder.name=`twin-obstacle:${def.id}`;this.setPose(holder,def.pose);this.root.add(holder);
      let visual;
      if(def.id==='table')visual=cabinetVisual(def);
      else if(def.id.endsWith('-housing')){
        const station=def.id.replace(/-housing$/,'');const device=deviceVisual(def,config.stations[station]?.label??station);
        visual=device.group;this.devices[station]=device;
      }else{
        visual=new THREE.Mesh(new THREE.BoxGeometry(...def.size),new THREE.MeshStandardMaterial({color:def.color??'#879a90',roughness:.4,metalness:.3}));
        visual.castShadow=true;visual.receiveShadow=true;
      }
      holder.add(visual);
      if(def.visual?.url)jobs.push(this.loadVisual(def,holder,visual));
    }
    let number=0;
    for(const [id,station] of Object.entries(config.stations)){
      if(['left-ready','right-ready','pour'].includes(id))continue;
      if(!this.workcell){const pad=new THREE.Mesh(new THREE.TorusGeometry(.08,.004,8,40),new THREE.MeshStandardMaterial({color:'#b78a52',metalness:.6,roughness:.3}));
      const table=config.obstacles.find(o=>o.id==='table');
      pad.position.set(station.pose.position[0],station.pose.position[1],table?table.pose.position[2]+table.size[2]/2+.012:station.pose.position[2]-.1);this.root.add(pad);}
      const label=document.createElement('span');label.className='twin-label';label.textContent=`${station.number??++number} · ${station.label}`;host.append(label);
      this.labels.push({label,position:scenePosition(station.pose.position),deviceId:Object.entries(config.devices).find(([,d])=>d.station===id)?.[0]});
    }
    this.arms={};
    for(const [id,robot] of Object.entries(config.robots)){
      const arm=armVisual(robot.linkRadius,{independentGripper:Object.values(config.grippers??{}).some(g=>g.robot===id),maxOpeningMm:Object.values(config.grippers??{}).find(g=>g.robot===id)?.maxOpeningMm??120});if(arm.actuator)arm.actuator.group.quaternion.fromArray((config.installation?.nominalTools[id]??robot.tool).quaternion).invert();this.root.add(arm.group);this.arms[id]=arm;
      const base=new THREE.Mesh(new THREE.CylinderGeometry(.105,.12,.025,32),new THREE.MeshStandardMaterial({color:'#273230',metalness:.5,roughness:.3}));
      const group=new THREE.Group();this.setPose(group,robot.base);base.rotation.x=Math.PI/2;group.add(base);this.root.add(group);
    }
    this.objects={};
    for(const [id,def] of Object.entries(config.objects)){
      const visual=id==='cup'?cupVisual(def):milkVesselVisual(def),holder=new THREE.Group();holder.name=`twin-object:${id}`;
      holder.add(visual.group);this.root.add(holder);this.objects[id]={holder,visual};jobs.push(visual.ready);
    }
    this.originAxes=new THREE.AxesHelper(.22);this.originAxes.material.depthTest=false;this.originAxes.renderOrder=20;this.originAxes.visible=false;this.root.add(this.originAxes);
    this.registerSelectionEntities();this.bindPicking();
    this.effects=new DeviceEffects(this.root,config);jobs.push(this.effects.ready);this.actionLabel=document.createElement('span');this.actionLabel.className='twin-action-label';host.append(this.actionLabel);
    this.debugGroup=new THREE.Group();this.root.add(this.debugGroup);this.debugVisible=false;this.labelsVisible=true;
    this.ready=Promise.all(jobs).catch(error=>{if(!this.disposed)this.assetErrors.push(error.message);});
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();this.setView('shop');
  }
  entityKey(ref){return ref?`${ref.kind}:${ref.id}`:'';}
  markEntity(root,ref){
    if(!root||!ref)return;
    root.userData.selectionRef={kind:String(ref.kind),id:String(ref.id)};
    this.entityRoots.set(this.entityKey(ref),root);
  }
  registerSelectionEntities(){
    this.entityRoots.clear();
    for(const [id,arm] of Object.entries(this.arms??{}))this.markEntity(arm.group,{kind:'robot',id});
    for(const [id,gripper] of Object.entries(this.config.grippers??{})){
      const arm=this.arms[gripper.robot],root=arm?.actuator?.group??arm?.gripper;
      this.markEntity(root,{kind:'gripper',id});
    }
    for(const [id,def] of Object.entries(this.config.devices??{})){
      const root=this.workcell?.components?.[def.station]??this.devices?.[def.station]?.group;
      this.markEntity(root,{kind:'device',id});
    }
    for(const [id,entry] of Object.entries(this.objects??{}))this.markEntity(entry.holder,{kind:'object',id});
    for(const id of Object.keys(this.config.stations??{})){
      const pad=this.workcell?.pads?.[id];
      if(pad)this.markEntity(pad,{kind:'station',id});
    }
    this.pickRoots=[this.root,...(this.workcell?.group?[this.workcell.group]:[])];
  }
  selectionRef(object){
    for(let node=object;node;node=node.parent)if(node.userData?.selectionRef)return node.userData.selectionRef;
    return null;
  }
  pick(event){
    const rect=this.renderer.domElement.getBoundingClientRect();
    if(!rect.width||!rect.height)return null;
    const pointer=new THREE.Vector2(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
    this.raycaster.setFromCamera(pointer,this.camera);
    for(const hit of this.raycaster.intersectObjects(this.pickRoots,true)){
      const ref=this.selectionRef(hit.object);
      if(ref)return ref;
    }
    return null;
  }
  bindPicking(){
    this.pointerDownHandler=event=>{if(event.button===0)this.pointerDown={x:event.clientX,y:event.clientY};};
    this.pointerUpHandler=event=>{
      if(event.button!==0||!this.pointerDown)return;
      const moved=Math.hypot(event.clientX-this.pointerDown.x,event.clientY-this.pointerDown.y);this.pointerDown=null;
      if(moved>4)return;
      this.onSelection?.(this.pick(event));
    };
    this.doubleClickHandler=event=>{const ref=this.pick(event);if(ref)this.onFocus?.(ref);};
    this.renderer.domElement.addEventListener('pointerdown',this.pointerDownHandler);
    this.renderer.domElement.addEventListener('pointerup',this.pointerUpHandler);
    this.renderer.domElement.addEventListener('dblclick',this.doubleClickHandler);
  }
  clearSelectionHelpers(){
    if(this.selectionHelper){this.scene.remove(this.selectionHelper);this.selectionHelper.dispose?.();this.selectionHelper=null;}
    for(const helper of this.relatedHelpers){this.scene.remove(helper);helper.dispose?.();}
    this.relatedHelpers=[];
  }
  addSelectionHelper(root,color){
    if(!root)return null;
    const helper=new THREE.BoxHelper(root,color);helper.material.depthTest=false;helper.material.transparent=true;helper.material.opacity=.92;helper.renderOrder=40;this.scene.add(helper);return helper;
  }
  setSelection(ref,related=[]){
    this.selectedRef=ref?{kind:ref.kind,id:ref.id}:null;
    this.selectedDevice=ref?.kind==='device'?ref.id:undefined;
    this.clearSelectionHelpers();
    let primary=this.entityRoots.get(this.entityKey(ref));
    const relatedRoots=[];
    for(const item of related??[]){
      const root=this.entityRoots.get(this.entityKey(item));
      if(root&&!relatedRoots.includes(root))relatedRoots.push(root);
    }
    if(!primary)primary=relatedRoots.shift();
    if(primary)this.selectionHelper=this.addSelectionHelper(primary,0xb78a52);
    for(const root of relatedRoots.filter(root=>root!==primary).slice(0,12)){
      const helper=this.addSelectionHelper(root,0x75a58e);if(helper)this.relatedHelpers.push(helper);
    }
    for(const entry of this.labels){
      const selected=ref?.kind==='device'&&entry.deviceId===ref.id;
      const relatedDevice=(related??[]).some(item=>item.kind==='device'&&item.id===entry.deviceId);
      entry.label.dataset.selected=selected?'true':'false';entry.label.dataset.related=relatedDevice?'true':'false';
    }
  }
  focusEntity(ref,related=[]){
    if(!ref)return;
    if(['device','robot','gripper'].includes(ref.kind)){
      const before=this.controls.target.clone();this.focusDevice(ref.id);
      if(!this.controls.target.equals(before)||this.entityRoots.has(this.entityKey(ref)))return;
    }
    let root=this.entityRoots.get(this.entityKey(ref));
    if(!root)for(const item of related??[]){root=this.entityRoots.get(this.entityKey(item));if(root)break;}
    if(!root)return;
    this.scene.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(root);if(box.isEmpty())return;
    const sphere=box.getBoundingSphere(new THREE.Sphere()),target=sphere.center;
    const direction=this.camera.position.clone().sub(this.controls.target);if(direction.lengthSq()<1e-8)direction.set(1,.8,1.6);
    direction.normalize();
    const distance=Math.max(.35,sphere.radius/Math.tan(THREE.MathUtils.degToRad(this.camera.fov*.5))*1.35);
    this.controls.target.copy(target);this.camera.position.copy(target).add(direction.multiplyScalar(distance));this.camera.lookAt(target);this.controls.update();
  }
  async loadVisual(def,holder,fallback){
    const url=new URL(def.visual.url,location.href);
    if(url.origin!==location.origin){this.assetErrors.push(`${def.id}: only same-origin GLB assets supported`);return;}
    try{
      const gltf=await new GLTFLoader().loadAsync(url.href);
      if(this.disposed){this.disposeTree(gltf.scene);return;}
      gltf.scene.rotation.x=Math.PI/2;gltf.scene.scale.setScalar(def.visual.scale??1);holder.add(gltf.scene);fallback.visible=false;
    }catch(error){if(!this.disposed)this.assetErrors.push(`${def.id}: ${error.message}`);}
  }
  setPose(mesh,pose){mesh.position.fromArray(pose.position);mesh.quaternion.fromArray(pose.quaternion);}
  setView(view){
    this.focusedTool=false;this.controls.minDistance=2;this.view=view;const aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight),scale=Math.max(1,1.25/Math.max(.6,aspect));
    const table=this.config.obstacles.find(o=>o.id==='table'),centre=table?scenePosition(table.pose.position):new THREE.Vector3(0,.88,0);
    const radius=table?Math.max(1,table.size[0]/4.35,table.size[1]/2.45):1;
    const positions={shop:[3.3,5.1,11.8],workcell:[3.3,3.5,5.8],top:[0,7.5,.01]};
    const p=positions[view]??positions.shop;
    this.controls.target.copy(view==='shop'?new THREE.Vector3(0,1.45,.15):centre.clone().add(new THREE.Vector3(0,.3,0)));
    const target=this.controls.target;this.camera.position.set(target.x+p[0]*scale*radius,target.y+(p[1]-1)*scale*radius,target.z+p[2]*scale*radius);
    this.camera.lookAt(target);this.controls.update();
  }
  selectDevice(id){this.setSelection(id?{kind:'device',id}:null,[]);}
  focusDevice(id){
    const tool=this.config.grippers?.[id];
    if(tool&&this.state){
      this.scene.updateMatrixWorld(true);const target=this.arms[tool.robot].gripper.getWorldPosition(new THREE.Vector3());this.controls.minDistance=.18;this.controls.target.copy(target);this.focusedTool=true;const orientation=this.arms[tool.robot].actuator.group.getWorldQuaternion(new THREE.Quaternion());this.camera.position.copy(target).add(new THREE.Vector3(.20,.12,.26).applyQuaternion(orientation));this.camera.lookAt(target);this.controls.update();return;
    }
    this.focusedTool=false;const device=this.config.devices[id],robot=this.config.robots[id];
    const pose=device?this.config.stations[device.station].pose:robot?.base;if(!pose)return;
    const target=scenePosition(pose.position);this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3(.9,1.2,2.2));this.camera.lookAt(target);this.controls.update();
  }
  resize(){
    const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);
    if(this.lastAspect&&Math.abs(this.lastAspect-w/h)>.15)this.setView(this.view);this.lastAspect=w/h;
  }
  apply(state){
    this.state=state;
    for(const [id,def] of Object.entries(this.config.devices)){
      const visual=this.devices[def.station];if(visual)visual.indicator.material.color.set(state.devices[id].mode==='fault'?'#e45442':state.devices[id].mode==='running'?'#bdebb3':'#83b59b');
    }
    for(const [id,rs] of Object.entries(state.robots)){
      const {pose,points}=armVisualState(this.config.robots[id],rs),arm=this.arms[id];
      arm.links.forEach((mesh,i)=>{
        const a=new THREE.Vector3(...points[i]),b=new THREE.Vector3(...points[i+1]),d=b.clone().sub(a);mesh.position.copy(a.add(b).multiplyScalar(.5));
        mesh.scale.y=d.length();mesh.visible=d.length()>1e-8&&!(arm.actuator&&i===arm.links.length-1);if(mesh.visible)mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
        this.setPose(arm.joints[i],pose.frames[i]);
      });this.setPose(arm.gripper,pose);
    }
    for(const [id,g] of Object.entries(state.grippers??{}))this.arms[g.robot]?.actuator?.setState(g);
    for(const [id,object] of Object.entries(state.objects)){
      const visual=this.objects[id],fill=containerFill(this.config.objects[id],object);visual.holder.visible=object.present!==false;this.setPose(visual.holder,object.pose);visual.visual.setFill(fill.fraction,fill.milkFraction);visual.visual.setSealed?.(object.sealed);
    }
    if(this.workcell) {
      for(const [id,pad] of Object.entries(this.workcell.pads)) {
        const device=Object.entries(this.config.devices).find(([,d])=>d.station===id);
        const mode=state.devices[device?.[0]]?.mode;pad.material.color.set(mode==='fault'?'#a84032':mode==='running'?'#c79a50':'#365143');
        if(id==='cups'&&device?.[1].effect==='dispense'){const view=this.sensorViews?.[device[0]],enabled=view?view.online&&view.sensors.cupSensorEnabled:(device[1].cupSensor?.enabled??true),detected=view?view.sensors.cupPresent:cupOnPad(this.config,state,device[0]);pad.material.color.set(mode==='fault'?'#a84032':!enabled?'#87918c':detected?'#36b881':'#b78a52');}
      }
      const lidder=state.devices.lidder,progress=lidder?.mode==='running'?Math.max(0,Math.min(1,1-lidder.remaining/this.config.devices.lidder.duration)):0;
      this.workcell.press.position.y=1.42-Math.sin(progress*Math.PI)*.17;
    }
    const origin=installationPose(this.config,state,this.selectedDevice);if(this.originAxes){this.originAxes.visible=!!this.originsVisible&&!!origin;if(origin)this.setPose(this.originAxes,origin);}
    const actions=this.effects.apply(state);this.actionLabel.textContent=actions.join(' · ');this.actionLabel.hidden=!actions.length;
    this.updateDebug();
  }
  updateDebug(){
    this.disposeTree(this.debugGroup);this.debugGroup.clear();if(!this.debugVisible||!this.state)return;
    const material=new THREE.MeshBasicMaterial({color:this.state.collisions.length?'#d84135':'#e99e25',wireframe:true,depthTest:false,transparent:true,opacity:.6});
    const add=(geometry,pose)=>{const mesh=new THREE.Mesh(geometry,material);this.setPose(mesh,pose);mesh.renderOrder=10;this.debugGroup.add(mesh);return mesh;};
    for(const o of this.config.obstacles)add(new THREE.BoxGeometry(...o.size),o.pose);
    for(const [id,robot] of Object.entries(this.state.robots)){
      const {pose,points}=armVisualState(this.config.robots[id],robot);
      for(let i=0;i<points.length-1;i++){
        const a=new THREE.Vector3(...points[i]),b=new THREE.Vector3(...points[i+1]),d=b.clone().sub(a);
        const q=d.length()>1e-9?new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize()):new THREE.Quaternion();
        add(new THREE.CapsuleGeometry(this.config.robots[id].linkRadius,d.length(),4,12),{position:a.add(b).multiplyScalar(.5).toArray(),quaternion:q.toArray()});
      }add(new THREE.BoxGeometry(.13,.05,.07),pose);
    }
    for(const [id,o] of Object.entries(this.state.objects)){
      if(o.present===false)continue;const def=this.config.objects[id];add(new THREE.CylinderGeometry(def.radius,def.radius,def.height,24),o.pose).rotateX(Math.PI/2);
    }
  }
  render(){
    this.controls.update();this.selectionHelper?.update();for(const helper of this.relatedHelpers)helper.update();this.renderer.render(this.scene,this.camera);
    const occupied=[];
    for(const {label,position,deviceId} of this.labels){
      const p=position.clone().project(this.camera),x=(p.x+1)*this.host.clientWidth/2,y=(1-p.y)*this.host.clientHeight/2;
      const hidden=this.focusedTool||!this.labelsVisible||p.z>1||p.z< -1||x<30||x>this.host.clientWidth-30||y<0||y>this.host.clientHeight-25||occupied.some(([px,py])=>Math.abs(px-x)<85&&Math.abs(py-y)<26);
      label.hidden=hidden;if(hidden)continue;occupied.push([x,y]);label.style.left=`${x}px`;label.style.top=`${y}px`;
      label.dataset.mode=this.state?.devices[deviceId]?.mode??'';
    }
  }
  disposeTree(root){
    const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      for(const material of [object.material].flat().filter(Boolean)){materials.add(material);for(const v of Object.values(material))if(v?.isTexture)textures.add(v);}
    });geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
  }
  dispose(){
    this.disposed=true;this.shop.dispose();this.observer.disconnect();this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown',this.pointerDownHandler);this.renderer.domElement.removeEventListener('pointerup',this.pointerUpHandler);this.renderer.domElement.removeEventListener('dblclick',this.doubleClickHandler);this.clearSelectionHelpers();
    this.labels.forEach(x=>x.label.remove());this.actionLabel.remove();
    this.disposeTree(this.scene);this.environment.dispose();this.pmrem.dispose();this.renderer.dispose();this.renderer.domElement.remove();
  }
}
