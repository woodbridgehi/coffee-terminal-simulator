import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BASES, forward, solvePose, sideGrip } from './kinematics.mjs';
import { STATIONS } from './sequence.mjs';

const material = (color, metalness = 0, roughness = 0.45) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
export const M = {
  shell: material('#e9e7de', 0.22, 0.32), dark: material('#273230', 0.55, 0.32),
  green: material('#255846', 0.3, 0.36), steel: material('#aab5b4', 0.8, 0.3),
  lightSteel: material('#cbd1ce', 0.65, 0.32), black: material('#151e1c', 0.15, 0.6),
  brass: material('#bb945d', 0.6, 0.3), white: material('#fcfaf2', 0.1, 0.38),
  coffee: material('#583723', 0.05, 0.24), amber: material('#d6a45a', 0.15, 0.35),
};
function mesh(parent, geometry, mat, p = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, mat);
  object.position.set(...p); object.castShadow = true; object.receiveShadow = true;
  parent.add(object); return object;
}
export const box = (parent, size, p, mat = M.shell, radius = 0.025) => mesh(parent,
  radius ? new RoundedBoxGeometry(...size, 2, radius) : new THREE.BoxGeometry(...size), mat, p);
export const cylinder = (parent, r, h, p, mat = M.dark, top = r) => mesh(parent, new THREE.CylinderGeometry(top, r, h, 32), mat, p);
function bolt(parent, p, radius = 0.014) { return cylinder(parent, radius, 0.013, p, M.steel); }
function ring(parent, radius, thickness, p, mat = M.green) {
  const object = mesh(parent, new THREE.TorusGeometry(radius, thickness, 10, 48), mat, p);
  object.rotation.x = Math.PI / 2; return object;
}

export function textPlate(parent, text, p, width = 0.45, height = 0.11, color = '#d7e2da', background = '#243e33') {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 144;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color; ctx.font = '500 62px -apple-system, "PingFang SC", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 384, 74, 720);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const label = mesh(parent, new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }), p);
  label.castShadow = false; return label;
}

export function createArm(side) {
  const group = new THREE.Group(); group.name = `${side}-UR10e`;
  group.position.set(...BASES[side]);
  box(group, [.32,.025,.32], [0,.012,0], M.dark);
  const blue = material('#73aaca', .38, .32);
  const joints = Array.from({length:6}, (_,i) => {
    const node = new THREE.Group(); group.add(node); node.matrixAutoUpdate=false;
    const housing=cylinder(node,i<2?.075:.058,i<2?.15:.10,[0,0,0],M.lightSteel);
    housing.rotation.x=Math.PI/2;
    const cap=cylinder(node,i<2?.065:.05,.012,[0,0,i<2?.081:.056],blue);
    cap.rotation.x=Math.PI/2;
    return node;
  });
  const rods=Array.from({length:6},(_,i)=>cylinder(group,i<3?.054:.042,1,[0,0,0],M.lightSteel));
  const flange=new THREE.Group(); group.add(flange); flange.matrixAutoUpdate=false;
  const tcp=new THREE.Object3D(); flange.add(tcp);
  box(tcp,[.15,.045,.065],[0,-.13,0],M.dark,.01);
  const fingers=[-1,1].map(sign=>{
    const finger=new THREE.Group(); tcp.add(finger);
    box(finger,[.018,.12,.035],[0,-.06,0],M.steel,.005);
    box(finger,[.014,.04,.045],[-sign*.006,0,0],M.black,.003);
    return finger;
  });
  const axes=new THREE.AxesHelper(.16); tcp.add(axes); axes.visible=false;
  const angles=Array(6).fill(0); let seeded=false;
  function pose(values,opening=1,narrow=false) {
    values.forEach((v,i)=>angles[i]=v);
    const fk=forward(values,[0,0,0]);
    joints.forEach((node,i)=>node.matrix.copy(fk.frames[i]));
    rods.forEach((rod,i)=>{
      const a=new THREE.Vector3().setFromMatrixPosition(fk.frames[i]);
      const b=new THREE.Vector3().setFromMatrixPosition(fk.frames[i+1]);
      const d=b.clone().sub(a); rod.position.copy(a.add(b).multiplyScalar(.5));
      rod.scale.y=d.length(); rod.visible=d.length()>1e-6;
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
    });
    flange.matrix.copy(fk.matrix);
    fingers.forEach((f,i)=>f.position.x=(i?1:-1)*((narrow?.014:.060)+opening*(narrow?.078:.032)));
    group.updateMatrixWorld(true); seeded=true;
  }
  return {group,joints,tcp,axes,angles,pose,
    move(target,opening=1,orientation=sideGrip(side,target),narrow=false) {
      pose(solvePose(target,orientation,BASES[side],seeded?angles:null),opening,narrow);
    }};
}

export function createPitcher() {
  const group=new THREE.Group();
  const profile=[[.044,-.065],[.061,.065],[.058,.065],[.041,-.060],[0,-.060]];
  mesh(group,new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),40),M.steel);
  const spout=mesh(group,new THREE.ConeGeometry(.023,.055,4),M.steel,[-.07,.063,0]);
  spout.rotation.z=Math.PI/2;
  const handle=mesh(group,new THREE.TorusGeometry(.065,.009,8,24),M.steel,[.13,0,0]);
  handle.scale.x=.7;
  cylinder(group,.052,.004,[0,.039,0],M.white);
  return {group};
}

export function createCup({ miniature = false } = {}) {
  const group = new THREE.Group();
  // Open shell with inner wall: the liquid is visible from above.
  const profile = [[0.042, -0.084], [0.052, 0.084], [0.055, 0.087], [0.059, 0.083], [0.047, -0.089], [0, -0.089]];
  mesh(group, new THREE.LatheGeometry(profile.map(([x,y]) => new THREE.Vector2(x,y)), 40), M.white);
  ring(group, 0.056, 0.003, [0, 0.084, 0], M.white);
  cylinder(group, 0.049, 0.068, [0, -0.01, 0], M.green, 0.054);
  const logo = textPlate(group, 'C', [0, -0.005, 0.055], 0.035, 0.035, '#f5eddf', '#255846');
  logo.name='cup-brand-label';
  const liquidMat = M.coffee.clone();
  const liquid = cylinder(group, 0.052, 0.008, [0, -0.075, 0], liquidMat);
  const lid = new THREE.Group();
  const ice = new THREE.Group();
  for (let i=0;i<4;i++) box(ice,[0.025,0.02,0.026],[Math.cos(i*1.57)*0.022,0.035+(i%2)*0.02,Math.sin(i*1.57)*0.022],M.lightSteel,0.004);
  group.add(ice); ice.visible=false;
  cylinder(lid, 0.061, 0.017, [0, 0.092, 0], M.white);
  cylinder(lid, 0.052, 0.013, [0, 0.105, 0], M.white);
  box(lid, [0.018, 0.004, 0.008], [0, 0.114, 0.037], M.black, 0.003);
  group.add(lid); lid.visible = false; liquid.visible = false;
  if (miniature) logo.visible = false;
  return { group, lid, liquid, ice, setFill(fill, milk = 0) {
    liquid.visible = fill > 0.001; liquid.position.y = -0.074 + fill * 0.15;
    liquid.scale.setScalar(0.86 + fill * 0.13);
    liquidMat.color.copy(M.coffee.color).lerp(new THREE.Color('#cda578'), milk * 0.85);
  } };
}

export function createWorkcell({ cabinetOnly = false } = {}) {
  const group = new THREE.Group(); group.name = 'coffee-workcell';
  // Floor cabinet, open side detailing, adjustable feet and brushed worktop.
  box(group, [4.35, 0.12, 2.45], [0, 0.88, 0.05], M.lightSteel, 0.045);
  box(group, [4.15, 0.63, 2.23], [0, 0.50, 0.05], M.shell, 0.04);
  box(group, [4.23, 0.09, 2.27], [0, 0.16, 0.05], M.dark, 0.022);
  box(group, [4.20, 0.025, 0.02], [0, 0.80, 1.177], M.green, 0.004);
  for (const x of [-1.85, 1.85]) for (const z of [-0.87, 0.98]) {
    cylinder(group, 0.07, 0.1, [x, 0.09, z], M.steel);
    cylinder(group, 0.085, 0.04, [x, 0.025, z], M.black);
  }
  for (const x of [-1.40, 0, 1.40]) {
    box(group, [1.34, 0.52, 0.025], [x, 0.49, 1.18], M.shell, 0.018);
    box(group, [0.24, 0.025, 0.03], [x, 0.69, 1.208], M.dark, 0.008);
  }
  textPlate(group, 'COFFEE / ROBOTICS', [-1.40, 0.42, 1.199], 0.83, 0.10, '#365143', '#e9e7de');
  for (let i = 0; i < 11; i++) box(group, [0.52, 0.012, 0.014], [1.40, 0.28 + i * 0.025, 1.20], M.dark, 0.003);
  // Low rear rail leaves the machinery visible from all inspection angles.
  box(group, [4.2, 0.10, 0.04], [0, 1.0, -1.16], M.steel);
  if (cabinetOnly) return { group, pads: {}, press: null };
  const pads = {};
  for (const [id, station] of Object.entries(STATIONS)) {
    const [x, , z] = station.position;
    cylinder(group, id === 'pickup' ? 0.20 : 0.145, 0.025, [x, 0.953, z], M.dark);
    const indicator = ring(group, id === 'pickup' ? 0.18 : 0.127, 0.008, [x, 0.970, z], M.green.clone());
    pads[id] = indicator;
  }
  // Cup magazine with a separate front dispensing position.
  box(group, [0.38, 0.045, 0.60], [-1.72, 0.96, -0.14], M.steel);
  for (let i = 0; i < 8; i++) {
    const cup = createCup({ miniature: true });
    cup.group.position.set(-1.72, 1.072 + i * 0.036, -0.34); group.add(cup.group);
  }
  for (const x of [-1.84, -1.6]) cylinder(group, 0.012, 0.58, [x, 1.25, -0.36], M.steel);
  textPlate(group, '01  CUPS', [-1.72, 1.55, -0.37], 0.36, 0.075);

  function dispenser(id, width, name, kind) {
    const x = STATIONS[id].position[0];
    box(group, [width, 0.71, 0.27], [x, 1.34, -1.0], kind === 'coffee' ? M.green : M.shell, 0.045);
    box(group, [width, 0.17, 0.50], [x, 1.65, -0.87], kind === 'coffee' ? M.green : M.shell, 0.035);
    box(group, [width - 0.09, 0.22, 0.014], [x, 1.39, -0.855], M.black, 0.015);
    textPlate(group, kind === 'coffee' ? 'ESPRESSO' : name, [x, 1.69, -0.611], width - 0.08, 0.055, '#eaf0e8', kind === 'coffee' ? '#255846' : '#35443d');
    cylinder(group, 0.032, 0.09, [x, 1.53, -0.68], M.steel);
    cylinder(group, 0.018, 0.035, [x, 1.47, -0.68], M.dark);
    // Drip-tray bars.
    for (let i = -3; i <= 3; i++) box(group, [width - 0.07, 0.009, 0.012], [x, 0.969, -0.68 + i * 0.034], M.steel, 0.003);
    if (kind === 'coffee') {
      textPlate(group, '93°C  /  READY', [x, 1.40, -0.844], 0.30, 0.055, '#b8dcc4', '#151e1c');
      for (const dx of [-0.24, 0.24]) {
        const dial = cylinder(group, 0.035, 0.025, [x + dx, 1.39, -0.83], M.steel);
        dial.rotation.x = Math.PI / 2;
      }
      cylinder(group, 0.16, 0.24, [x, 1.91, -0.94], M.dark, 0.12);
      cylinder(group, 0.16, 0.02, [x, 2.04, -0.94], M.black);
      for (let i = 0; i < 10; i++) {
        const bean = mesh(group, new THREE.SphereGeometry(0.025, 10, 8), M.coffee, [x + Math.cos(i * 2.4) * 0.09, 2.035, -0.94 + Math.sin(i * 2.4) * 0.09]);
        bean.scale.y = 0.5;
      }
    }
  }
  dispenser('brew', 0.65, 'COFFEE', 'coffee');
  dispenser('ice', 0.36, 'ICE', 'ice');
  dispenser('water', 0.44, 'HOT WATER', 'water');
  dispenser('milk', 0.53, 'FRESH MILK', 'milk');
  dispenser('syrup', 0.46, 'VANILLA', 'syrup');
  // Syrup bottles above the dosing unit.
  for (const x of [1.35, 1.56]) {
    cylinder(group, 0.057, 0.22, [x, 1.88, -0.95], M.amber, 0.047);
    cylinder(group, 0.028, 0.06, [x, 2.02, -0.95], M.dark);
    box(group, [0.10, 0.018, 0.025], [x + 0.028, 2.056, -0.95], M.black, 0.005);
  }
  // Compact press; its head is animated only after the gripper leaves the tray.
  box(group, [0.075, 0.60, 0.12], [1.73, 1.24, -0.20], M.steel);
  box(group, [0.27, 0.08, 0.38], [1.73, 1.52, -0.07], M.green);
  const press = new THREE.Group(); press.position.set(1.73, 1.42, 0.08); group.add(press);
  cylinder(press, 0.025, 0.13, [0, 0, 0], M.steel);
  cylinder(press, 0.095, 0.06, [0, -0.085, 0], M.dark);
  textPlate(group, '07  LID', [1.73, 1.54, 0.126], 0.24, 0.058);
  // Customer-facing illuminated shelf.
  box(group, [0.76, 0.04, 0.52], [1.08, 0.951, 0.96], M.green, 0.04);
  cylinder(group, 0.18, 0.008, [1.08, 0.976, 0.94], M.shell);
  textPlate(group, 'PICK UP / 取杯', [1.08, 0.87, 1.285], 0.57, 0.09);
  // Stack light and recessed emergency-stop button (visual hardware).
  cylinder(group, 0.019, 0.30, [2.01, 1.13, -1.02], M.steel);
  cylinder(group, 0.047, 0.09, [2.01, 1.33, -1.02], M.green);
  cylinder(group, 0.047, 0.075, [2.01, 1.41, -1.02], M.amber);
  cylinder(group, 0.05, 0.045, [-1.93, 0.98, 0.90], M.amber);
  cylinder(group, 0.032, 0.044, [-1.93, 1.02, 0.90], material('#a84032'));
  return { group, pads, press };
}
