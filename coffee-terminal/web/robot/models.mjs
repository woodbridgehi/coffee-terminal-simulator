import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ARM, BASES, solveUpright } from './kinematics.mjs';
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
  const group = new THREE.Group(); group.name = `${side}-6R`;
  group.position.set(...BASES[side]);
  box(group, [0.38, 0.04, 0.36], [0, 0.02, 0], M.dark, 0.03);
  for (const x of [-0.145, 0.145]) for (const z of [-0.13, 0.13]) bolt(group, [x, 0.046, z]);
  cylinder(group, 0.145, 0.15, [0, 0.11, 0], M.shell, 0.125);
  ring(group, 0.126, 0.009, [0, 0.17, 0], side === 'left' ? M.green : M.brass);
  const joints = Array.from({ length: 6 }, () => new THREE.Group());
  const [j1, j2, j3, j4, j5, j6] = joints;
  group.add(j1); j1.position.y = ARM.shoulder;
  j1.add(j2); j2.add(j3); j3.position.y = ARM.upper;
  j3.add(j4); j4.position.y = ARM.forearm;
  j4.add(j5); j5.add(j6);
  function jointHousing(parent, r, depth, axis = 'z') {
    const housing = cylinder(parent, r, depth, [0, 0, 0], M.dark);
    if (axis === 'z') housing.rotation.x = Math.PI / 2;
    for (const sign of [-1, 1]) {
      const cap = cylinder(parent, r * 0.78, 0.016, axis === 'z' ? [0, 0, sign * depth / 2] : [0, sign * depth / 2, 0], M.steel);
      if (axis === 'z') cap.rotation.x = Math.PI / 2;
      const center = cylinder(parent, r * 0.42, 0.020, axis === 'z' ? [0, 0, sign * (depth / 2 + 0.008)] : [0, sign * (depth / 2 + 0.008), 0], M.shell);
      if (axis === 'z') center.rotation.x = Math.PI / 2;
    }
  }
  jointHousing(j2, 0.132, 0.26);
  box(j2, [0.18, ARM.upper - 0.06, 0.17], [0, ARM.upper / 2, 0], M.shell, 0.065);
  box(j2, [0.11, 0.32, 0.013], [0, ARM.upper / 2, 0.091], side === 'left' ? M.green : M.brass, 0.012);
  jointHousing(j3, 0.108, 0.23);
  box(j3, [0.14, ARM.forearm - 0.05, 0.145], [0, ARM.forearm / 2, 0], M.shell, 0.053);
  // Cable is local to each rigid link, so it never stretches between unrelated joints.
  for (const [parent, length, offset] of [[j2, ARM.upper, -0.106], [j3, ARM.forearm, -0.09]]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.06, offset), new THREE.Vector3(-0.09, length * 0.3, offset - 0.055),
      new THREE.Vector3(-0.07, length * 0.75, offset - 0.04), new THREE.Vector3(0, length - 0.06, offset),
    ]);
    mesh(parent, new THREE.TubeGeometry(curve, 20, 0.018, 8, false), M.black);
  }
  jointHousing(j4, 0.085, 0.12, 'y');
  jointHousing(j5, 0.067, 0.15);
  cylinder(j6, 0.053, 0.07, [0, 0.07, 0], M.steel);
  box(j6, [0.16, 0.057, 0.08], [0, 0.123, 0], M.dark, 0.012);
  const fingers = [-1, 1].map((sign) => {
    const finger = new THREE.Group(); j6.add(finger);
    box(finger, [0.023, 0.11, 0.046], [0, 0.20, 0], M.steel, 0.008);
    box(finger, [0.012, 0.058, 0.055], [-sign * 0.012, 0.229, 0], M.black, 0.004);
    return finger;
  });
  const tcp = new THREE.Object3D(); tcp.position.y = ARM.tool; j6.add(tcp);
  const axes = new THREE.AxesHelper(0.18); tcp.add(axes); axes.visible = false;
  const angles = Array(6).fill(0);
  function pose(values, opening = 1) {
    values.forEach((value, i) => { angles[i] = value; joints[i].rotation[['y', 'z', 'z', 'y', 'z', 'y'][i]] = value; });
    fingers.forEach((finger, i) => { finger.position.x = (i ? 1 : -1) * (0.061 + opening * 0.039); });
    group.updateMatrixWorld(true);
  }
  return { group, joints, tcp, axes, angles, pose,
    move(target, opening = 1) { pose(solveUpright(target, BASES[side]), opening); } };
}

export function createCup({ miniature = false } = {}) {
  const group = new THREE.Group();
  // Open shell with inner wall: the liquid is visible from above.
  const profile = [[0.042, -0.084], [0.052, 0.084], [0.055, 0.087], [0.059, 0.083], [0.047, -0.089], [0, -0.089]];
  mesh(group, new THREE.LatheGeometry(profile.map(([x,y]) => new THREE.Vector2(x,y)), 40), M.white);
  ring(group, 0.056, 0.003, [0, 0.084, 0], M.white);
  cylinder(group, 0.049, 0.068, [0, -0.01, 0], M.green, 0.054);
  const logo = textPlate(group, 'C', [0, -0.005, 0.055], 0.035, 0.035, '#f5eddf', '#255846');
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

export function createWorkcell() {
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
