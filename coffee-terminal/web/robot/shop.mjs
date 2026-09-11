import * as THREE from 'three';
import { box, cylinder } from './models.mjs';
import logo from '../assets/brand/logo-horizontal.svg';
import motion from '../assets/brand/patterns/motion-path.svg';
import beans from '../assets/brand/patterns/bean-grid.svg';

// Spatial dressing only. All furniture stays outside the robot worktop envelope.
// SVGs are embedded by esbuild so both the offline terminal and cloud viewer share branding.
export const SHOP = { green: '#17382D', cream: '#F6F0E5', brass: '#B78A52', width: 7.6, depth: 5.8 };
export function createShop() {
  const group = new THREE.Group(); group.name = 'coffee-terminal-shop';
  let disposed = false;
  const pending = [];
  const mat = (color, roughness = .65, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const green = mat(SHOP.green), cream = mat(SHOP.cream), brass = mat(SHOP.brass, .32, .65);
  const dark = mat('#14261e'), glow = new THREE.MeshBasicMaterial({ color: '#ffe0a0' });
  function texture(w, h, draw) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    draw(canvas.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  let seed = 901;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const stone = texture(1024, 1024, (c,w,h) => {
    c.fillStyle = '#e9dfcc'; c.fillRect(0,0,w,h);
    const chips = ['#9e9587','#c7b48f','#fff9ed','#879180','#ac916e'];
    for (let i=0;i<3600;i++) {
      const x=random()*w,y=random()*h,r=.7+random()*4.0;
      c.fillStyle=chips[i%chips.length]; c.beginPath(); c.moveTo(x-r,y);
      c.lineTo(x+r*.6,y-r);c.lineTo(x+r,y+r*.6);c.lineTo(x-r*.6,y+r);c.fill();
    }
  });
  stone.wrapS = stone.wrapT = THREE.RepeatWrapping; stone.repeat.set(3.8,2.9);
  const floorMat = mat('#ffffff', .78); floorMat.map = stone;
  box(group,[7.6,.14,5.8],[0,-.07,.3],floorMat,.025);
  // Narrow brass perimeter set into the terrazzo; no infinite engineering grid.
  for (const z of [-2.49,3.09]) box(group,[7.38,.004,.016],[0,.003,z],brass,0);
  for (const x of [-3.69,3.69]) box(group,[.016,.004,5.58],[x,.003,.3],brass,0);
  const plaster = texture(256,256,(c,w,h)=>{
    c.fillStyle='#f2e9d8';c.fillRect(0,0,w,h);
    for(let i=0;i<16000;i++){c.fillStyle=i%2?'#cabaa712':'#ffffff30';c.fillRect(random()*w,random()*h,1+random()*2,1);}
  });
  plaster.wrapS=plaster.wrapT=THREE.RepeatWrapping;plaster.repeat.set(3,2);
  const wallMat = mat('#ffffff',.92);wallMat.map=plaster;
  const oakMap=texture(256,512,(c,w,h)=>{
    c.fillStyle='#b88952';c.fillRect(0,0,w,h);
    for(let i=0;i<650;i++){const x=random()*w;c.strokeStyle=i%3?'#69472120':'#efc99038';c.lineWidth=.3+random();c.beginPath();c.moveTo(x,0);c.bezierCurveTo(x+8,170,x-7,340,x+3,h);c.stroke();}
  });
  oakMap.wrapS=oakMap.wrapT=THREE.RepeatWrapping;oakMap.repeat.set(2,1);
  const oak=mat('#ffffff',.58);oak.map=oakMap;
  box(group,[7.6,3.5,.14],[0,1.75,-2.53],wallMat,.015);
  box(group,[.14,3.5,5.8],[-3.73,1.75,.3],wallMat,.015);
  box(group,[7.4,.09,.03],[0,.055,-2.44],brass,.004);
  box(group,[.03,.09,5.65],[-3.645,.055,.3],brass,.004);
  box(group,[6.25,1.9,.065],[.50,.99,-2.42],green,.005);
  // Instanced rounded flutes keep the larger environment cheap to render.
  const fluteGeometry = new THREE.CylinderGeometry(.026,.026,1.85,8);
  const flutes = new THREE.InstancedMesh(fluteGeometry,green,109);
  const matrix = new THREE.Matrix4();
  for(let i=0;i<109;i++){matrix.makeTranslation(-2.57+i*.057,.98,-2.375);flutes.setMatrixAt(i,matrix);}
  flutes.castShadow=true;flutes.receiveShadow=true;group.add(flutes);
  box(group,[6.27,.025,.12],[.5,1.94,-2.38],oak,.004);

  function graphic(svg, width, height, p, rotation=0, background=SHOP.cream, repeatY=1, unlit=false) {
    const t=texture(1536,Math.round(1536*height/width/repeatY),(c,w,h)=>{c.fillStyle=background;c.fillRect(0,0,w,h);});
    t.wrapT=THREE.RepeatWrapping;t.repeat.y=repeatY;
    const m=unlit?new THREE.MeshBasicMaterial({map:t}):mat('#ffffff',.8);m.map=t;
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(width,height),m);
    plane.position.set(...p);plane.rotation.y=rotation;group.add(plane);
    const img=new Image();
    pending.push(new Promise((resolve,reject)=>{
      img.onload=()=>{if(!disposed){t.image.getContext('2d').drawImage(img,0,0,t.image.width,t.image.height);t.needsUpdate=true;}resolve();};
      img.onerror=()=>reject(new Error('门店品牌纹理加载失败'));
      img.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', `<svg width="${t.image.width}" height="${t.image.height}" preserveAspectRatio="none" `))}`;
    }));
    return plane;
  }
  // Actual existing brand lockup, not a newly generated substitute logo.
  box(group,[4.9,.83,.055],[.45,2.70,-2.415],glow,.065);
  box(group,[4.84,.77,.10],[.45,2.70,-2.375],cream,.055);
  graphic(logo,4.40,4.40*80/508,[.45,2.70,-2.318],0,SHOP.cream,1,true);
  graphic(beans.replace('opacity=".38"','opacity=".8"'),.75,3.22,[-3.11,1.76,-2.447],0,SHOP.cream,6.13);
  box(group,[.018,3.3,.025],[-2.68,1.78,-2.44],glow,.002);
  // SVG repeat is magnified on this panel to turn the motion motif into architecture.
  box(group,[.07,2.28,4.38],[-3.61,2.13,.30],cream,.05);
  graphic(motion.replace('opacity=".38"','opacity=".9"'),4.26,2.16,[-3.57,2.13,.30],Math.PI/2);
  box(group,[.43,.075,4.50],[-3.40,1.02,.30],oak,.014);
  for(const z of [-1.45,2.05]) box(group,[.30,.035,.035],[-3.45,.88,z],brass,.003);
  // Two compact seats on the side ledge, with a clear aisle to the workcell.
  function stool(x,z,height=.72,radius=.22) {
    cylinder(group,.20,.035,[x,.025,z],brass);
    cylinder(group,.032,height-.07,[x,height/2,z],brass);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.16,.012,8,32),brass);
    ring.rotation.x=Math.PI/2;ring.position.set(x,.27,z);group.add(ring);
    cylinder(group,radius,.075,[x,height,z],green);
  }
  stool(-3.08,-.7);stool(-3.08,1.10);
  // Airy window frame: open glazing avoids transparent sorting across the robot.
  for(const z of [-2.48,-1.38,-.28,.82,1.92,3.08]) box(group,[.07,3.5,.055],[3.73,1.75,z],brass,.004);
  for(const y of [.08,1.30,3.48]) box(group,[.085,.055,5.64],[3.73,y,.30],brass,.004);
  box(group,[.17,.07,5.73],[3.73,3.52,.30],oak,.01);
  // Low lounge furniture remains below the worktop and outside the pickup zone.
  for(const [x,z] of [[2.54,2.19],[3.12,2.60]]) {
    cylinder(group,.255,.055,[x,.04,z],brass);
    cylinder(group,.27,.39,[x,.255,z],green);
    cylinder(group,.269,.045,[x,.467,z],green);
  }
  cylinder(group,.16,.035,[3.20,.03,1.76],brass);
  cylinder(group,.075,.52,[3.20,.28,1.76],oak);
  cylinder(group,.30,.045,[3.20,.565,1.76],oak);
  function plant(x,z,scale=1,baseY=0) {
    const plantGroup=new THREE.Group();plantGroup.position.set(x,baseY,z);plantGroup.scale.setScalar(scale);group.add(plantGroup);
    cylinder(plantGroup,.23,.43,[0,.215,0],cream,.28);
    cylinder(plantGroup,.245,.016,[0,.433,0],dark);
    const stem=mat('#6c5836'),leafMat=mat('#36543b');
    cylinder(plantGroup,.025,1.22,[0,1.02,0],stem,.016);
    const leaves=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6),leafMat,76);
    const transform=new THREE.Object3D();
    for(let i=0;i<76;i++) {
      const angle=i*2.399, r=.13+random()*.31,y=.9+random()*.9;
      transform.position.set(Math.cos(angle)*r,y,Math.sin(angle)*r);
      transform.rotation.set(random(),angle,Math.PI/4+random());transform.scale.set(.065,.19,.023);
      transform.updateMatrix();leaves.setMatrixAt(i,transform.matrix);
    }
    leaves.castShadow=true;plantGroup.add(leaves);
  }
  plant(3.02,-1.87,1.05);plant(3.20,1.76,.20,.589);plant(-3.40,-1.50,.28,1.06);
  for(const x of [-2.18,2.37]) {
    cylinder(group,.009,.33,[x,3.335,-1.97],dark);
    cylinder(group,.065,.30,[x,3.02,-1.97],brass);
    cylinder(group,.057,.008,[x,2.866,-1.97],glow);
    const light=new THREE.SpotLight('#ffdc9e',9,5,Math.PI/3,.85,2);
    light.position.set(x,2.86,-1.96);light.target.position.set(x,1.1,-2.40);
    group.add(light,light.target); // only daylight casts a shadow map
  }
  const wash=new THREE.PointLight('#ffd79b',1.2,4,2);wash.position.set(.45,2.8,-2.05);group.add(wash);
  box(group,[2.70,.51,.012],[-.70,.475,1.211],green,.008);
  const counterFlutes=new THREE.InstancedMesh(new THREE.CylinderGeometry(.016,.016,.47,8),green,65);
  for(let i=0;i<65;i++){matrix.makeTranslation(-2.01+i*.0405,.475,1.223);counterFlutes.setMatrixAt(i,matrix);}
  counterFlutes.castShadow=true;counterFlutes.receiveShadow=true;group.add(counterFlutes);
  box(group,[.05,.53,.028],[-2.025,.475,1.218],brass,.008);
  box(group,[2.74,.025,.027],[-.69,.20,1.218],brass,.004);
  graphic(logo,1.65,1.65*80/508,[-.75,.47,1.245],0,SHOP.cream,1,true);
  const ready=Promise.all(pending);
  // Keep rejections handled for callers that render immediately rather than await assets.
  ready.catch(error=>console.error(error.message));
  return {group,ready,dispose(){disposed=true;}};
}
