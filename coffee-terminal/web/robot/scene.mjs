import {brandCup} from './cup-brand.mjs';
import { spiralPoint } from './latte-art.mjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createArm, createCup, createPitcher, createWorkcell, M } from './models.mjs';
import { createShop } from './shop.mjs';
import { STATIONS } from './sequence.mjs';

export class CoffeeScene {
  constructor(host, labelHost) {
    this.host = host; this.labelHost = labelHost;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e8dece');
    this.scene.fog = new THREE.Fog('#e8dece', 22, 45);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.setAttribute('aria-label', '双 UR10e 机械臂三维场景，可拖动旋转、滚轮缩放');
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(37, 1, 0.05, 50);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 2.5; this.controls.maxDistance = 26;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.target.set(0, 0.98, 0);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = this.pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture; this.scene.environmentIntensity = 0.4;
    room.dispose();
    this.scene.add(new THREE.HemisphereLight('#fffdf5', '#847660', 1.0));
    const sun = new THREE.DirectionalLight('#ffe6bf', 2.4);
    sun.position.set(7, 6, 3); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -6; sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6; sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 24;
    sun.shadow.normalBias = 0.025; sun.shadow.bias = -0.0001;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#edf4ff', 0.65); rim.position.set(3, 4, -4); this.scene.add(rim);
    this.shop = createShop(); this.scene.add(this.shop.group); this.ready = this.shop.ready;
    this.cell = createWorkcell(); this.scene.add(this.cell.group);
    this.arms = { left: createArm('left'), right: createArm('right') };
    Object.values(this.arms).forEach((arm) => this.scene.add(arm.group));
    this.cup = createCup(); this.scene.add(this.cup.group);
    this.ready=Promise.all([this.shop.ready,brandCup(this.cup)]);
    this.pitcher=createPitcher(); this.scene.add(this.pitcher.group);
    const points=Array.from({length:241},(_,i)=>new THREE.Vector3(...spiralPoint(i/240)));
    this.foam=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),240,.0016,6,false),M.white);
    this.cup.group.add(this.foam); this.foam.visible=false;
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 1, 10), M.coffee.clone());
    this.stream.visible = false; this.scene.add(this.stream);
    this.labels = Object.entries(STATIONS).map(([id, station]) => {
      const element = document.createElement('div'); element.className = 'station-label';
      element.innerHTML = `<b>${station.number}</b><span>${station.name}</span>`;
      labelHost.append(element);
      const heights = { cups: 1.73, ice: 1.86, brew: 2.17, water: 1.84, milk: 1.86, syrup: 2.19, handoff: 1.02, lid: 1.68, pickup: 0.93 };
      const p = new THREE.Vector3(station.position[0], heights[id], station.position[2]);
      if (['handoff', 'pickup'].includes(id)) p.z += 0.24;
      return { id, element, position: p };
    });
    this.showLabels = true; this.view = 'shop'; this.setView('shop');
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host);
    this.resize();
  }

  resize() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height);
    if (!this.preserveCameraOnResize && this.lastAspect && Math.abs(this.lastAspect - width / height) > 0.15) this.setView(this.view);
    this.lastAspect = width / height;
  }

  setView(view) {
    this.view = view;
    const ratio = this.host.clientWidth / Math.max(1, this.host.clientHeight);
    const scale = view==='art'?1:Math.max(1, 1.25 / Math.max(0.6, ratio));
    const positions = { shop:[3.3,5.1,11.8], art:[.32,2.05,1.0], perspective: [3.5, 3.7, 5.8], top: [0, 7.5, 0.001], front: [0, 2.0, 7.5] };
    const p = positions[view] || positions.perspective;
    this.controls.target.set(...(view==='art'?[-.04,1.27,.40]:view==='shop'?[0,1.45,.15]:[0,1.0,.02]));
    this.controls.minDistance=view==='art'?.5:2.5;
    this.camera.position.set(p[0] * scale, 1 + (p[1] - 1) * scale, p[2] * scale);
    this.camera.lookAt(this.controls.target); this.controls.update();
  }

  apply(state) {
    this.state = state;
    if(state.leftJoints && state.rightJoints) {
      this.arms.left.pose(state.leftJoints,state.gripLeft);
      this.arms.right.pose(state.rightJoints,state.gripRight,state.pitcherOwner==='right');
    } else {
      this.arms.left.move(state.left,state.gripLeft,state.leftOrientation);
      this.arms.right.move(state.right,state.gripRight,state.rightOrientation,state.pitcherOwner==='right');
    }
    this.cup.group.position.set(...state.cup); this.cup.group.quaternion.fromArray(state.cupOrientation);
    this.cup.lid.visible = state.lid; this.cup.setFill(state.fill, state.milk);
    this.pitcher.group.position.set(...state.pitcher);
    this.pitcher.group.quaternion.fromArray(state.pitcherOrientation);
    this.foam.visible=(state.artProgress || 0)>0 && !state.lid;
    this.foam.position.y=-.074+state.fill*.15+.005;
    this.foam.geometry.setDrawRange(0,Math.floor((state.artProgress || 0)*240)*6*6);
    this.cup.ice.visible = (state.ice || 0) > 0.1;
    this.stream.visible = !!state.stream;
    if (state.stream && state.stream !== 'latte-art') {
      this.stream.quaternion.identity();
      const bottom = state.cup[1] - 0.074 + state.fill * 0.15, top = 1.455;
      this.stream.position.set(state.cup[0], (top + bottom) / 2, state.cup[2]);
      this.stream.scale.y = top - bottom;
      this.stream.material.color.set({ coffee: '#634023', milk: '#fff4d8', water: '#b6d9d3', syrup: '#c68c36' }[state.stream]);
    }
    if(state.stream==='latte-art') {
      const from=new THREE.Vector3(...state.spout),to=new THREE.Vector3(...state.landing),d=to.clone().sub(from);
      this.stream.position.copy(from.add(to).multiplyScalar(.5)); this.stream.scale.set(.35,d.length(),.35);
      this.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
      this.stream.material.color.set('#fff4d8');
    } else { this.stream.scale.x=1;this.stream.scale.z=1; }
    const pressing = state.description === '压合杯盖';
    this.cell.press.position.y = 1.42 - (pressing ? Math.sin(Math.PI * state.segmentProgress) * 0.15 : 0);
    for (const [id, pad] of Object.entries(this.cell.pads)) {
      pad.material.color.set(id === state.station ? '#bf9245' : '#477261');
      pad.material.emissive.set(id === state.station ? '#6c4312' : '#000000');
      pad.material.emissiveIntensity = 0.35;
    }
    for (const label of this.labels) label.element.classList.toggle('active', label.id === state.station);
  }

  render() {
    this.controls.update(); this.renderer.render(this.scene, this.camera);
    const width = this.host.clientWidth, height = this.host.clientHeight;
    for (const label of this.labels) {
      const p = label.position.clone().project(this.camera);
      const x = (p.x * 0.5 + 0.5) * width, y = (-p.y * 0.5 + 0.5) * height;
      label.element.hidden = !this.showLabels || (this.view === 'shop' && label.id !== this.state?.station) || p.z > 1 || p.z < -1 || x < 35 || x > width - 35 || y < 75 || y > height - 55;
      label.element.style.left = `${x}px`; label.element.style.top = `${y}px`;
    }
  }

  dispose() {
    this.resizeObserver.disconnect(); this.controls.dispose(); this.shop.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
    this.scene.traverse((object) => {
      if (object.isLight && object.shadow) object.shadow.dispose();
      if (object.isInstancedMesh) object.dispose();
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) for (const mat of [object.material].flat()) materials.add(mat);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const mat of materials) { for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value); mat.dispose(); }
    for (const texture of textures) { if (texture.image) images.add(texture.image); texture.dispose(); }
    for (const image of images) image.close?.();
    this.environment.dispose(); this.pmrem.dispose(); this.renderer.dispose();
  }
}
