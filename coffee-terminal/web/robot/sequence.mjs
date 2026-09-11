import { cupApproach, cupTravel } from './cup-motion.mjs';
import { Quaternion } from 'three/src/math/Quaternion.js';
import { Vector3 } from 'three/src/math/Vector3.js';
import { UPRIGHT, leftSideGrip, sideGrip, solvePose, BASES, forward, rightHomeSeed } from './kinematics.mjs';
import { pouringPose, PITCHER_HOME, PITCHER_GRASP } from './latte-art.mjs';
import { lerp3, smooth } from './kinematics.mjs';

export const CUP_Y = 1.055;
export const STATIONS = Object.freeze({
  cups: { name: '取杯', number: '01', position: [-1.70, CUP_Y + 0.017, 0.05] },
  ice: { name: '冰块', number: '09', position: [-1.78, CUP_Y + 0.008, -0.62] },
  brew: { name: '咖啡萃取', number: '02', position: [-1.12, CUP_Y + 0.008, -0.68] },
  water: { name: '热水', number: '03', position: [-0.10, CUP_Y + 0.008, -0.68] },
  handoff: { name: '双臂交接', number: '04', position: [0, CUP_Y, 0.12] },
  milk: { name: '鲜奶', number: '05', position: [0.68, CUP_Y + 0.008, -0.68] },
  syrup: { name: '糖浆', number: '06', position: [1.46, CUP_Y + 0.008, -0.68] },
  lid: { name: '封盖', number: '07', position: [1.73, CUP_Y, 0.08] },
  pickup: { name: '成品取杯', number: '08', position: [1.08, CUP_Y + 0.014, 0.94] },
});
export const HOMES = Object.freeze({ left: [-1.28, 1.53, 0.49], right: [1.28, 1.53, 0.49] });
export const RECIPES = Object.freeze({
  latte: { name: '热拿铁', detail: '浓缩咖啡 + 鲜奶', stages: ['取杯', '萃取', '交接', '加奶', '封盖', '出杯'] },
  americano: { name: '美式咖啡', detail: '浓缩咖啡 + 热水', stages: ['取杯', '萃取', '加水', '交接', '封盖', '出杯'] },
  vanilla: { name: '香草拿铁', detail: '浓缩咖啡 + 鲜奶 + 糖浆', stages: ['取杯', '萃取', '交接', '加奶', '糖浆', '封盖', '出杯'] },
});
const clone = (value) => JSON.parse(JSON.stringify(value));

// Freeze a new grasp relative to the current cup pose. Horizontal approaches may
// yaw the cup, but must never tip it or reset its logo orientation at a handoff.
export function graspOrientation(side,state) {
  return side==='right' && state.rightMode==='pitcher' ? (state.rightOrientation || UPRIGHT) : sideGrip(side,state[side]);
}
export function cupRotation(state) {
  if(!state.owner) return state.cupOrientation || [0,0,0,1];
  const tool=graspOrientation(state.owner,state);
  return new Quaternion(...tool).multiply(new Quaternion(...state.cupGripRotation)).toArray();
}
export function transitionState(state,changes) {
  const next={...clone(state),...clone(changes)};
  if(next.owner!==state.owner) {
    next.cupOrientation=cupRotation(state);
    if(next.owner) {
      const tool=graspOrientation(next.owner,next);
      next.cupGripRotation=new Quaternion(...tool).invert().multiply(new Quaternion(...next.cupOrientation)).toArray();
    } else next.cupGripRotation=null;
  }
  return next;
}

// An explicit timeline is seekable, deterministic and independent of render FPS.
// Transfer via a fixture: only one arm owns the cup at a time.
export function createSequence(recipeId = 'latte') {
  const recipe = RECIPES[recipeId];
  if (!recipe) throw new RangeError('未知演示配方');
  const segments = [];
  let cursor = 0;
  let state = { left: [...HOMES.left], right: [...HOMES.right], gripLeft: 1, gripRight: 1,
    cup: [...STATIONS.cups.position], owner: null, fill: 0, lid: false, milk: 0 };
  function add(stage, station, description, seconds, changes = {}, stream = null) {
    const from = clone(state);
    state = transitionState(state,changes);
    segments.push({ start: cursor, end: cursor + seconds, stage, station, description, from, to: clone(state), stream });
    cursor += seconds;
  }
  const move = (arm, position, stage, station, description, seconds = 1.2) => {
    const points=cupTravel(state[arm],position,arm);
    for(const point of points) add(stage,station,description,seconds/points.length,{[arm]:point});
  };
  function approach(arm,station,stage) {
    const target=STATIONS[station].position,pre=cupApproach(arm,target);
    move(arm,[state[arm][0],1.28,Math.max(.4,state[arm][2])],stage,station,'空夹爪退出至搬运高度',.5);
    move(arm,[pre[0],1.28,pre[2]],stage,station,'空夹爪移至侧夹预备位',.8);
    move(arm,pre,stage,station,'空夹爪对准杯身侧面',.5);
    move(arm,target,stage,station,'沿夹持轴水平进入杯身',.8);
  }
  function transport(arm, station, stage) {
    const target = STATIONS[station].position;
    const current = state[arm];
    // Exit dispenser mouths horizontally before lifting; travel in a front corridor.
    if (current[2] < -0.4) move(arm, [current[0], current[1], 0.40], stage, station, '沿出料口前方退出', 0.7);
    move(arm, [state[arm][0], 1.28, Math.max(0.40, state[arm][2])], stage, station, '抬杯至搬运高度', 0.65);
    const approach = [target[0], 1.28, Math.max(0.40, target[2])];
    move(arm, approach, stage, station, '沿工位前方搬运', 1.2);
    move(arm, [target[0], target[1], approach[2]], stage, station, '保持杯口竖直，对准工位', 0.7);
    if (target[2] < 0.40) move(arm, target, stage, station, '进入出料口下方', 0.8);
  }
  const release = (arm, station, stage) => {
    add(stage, station, '松开夹爪，杯子落在定位托盘', 0.55, { [arm === 'left' ? 'gripLeft' : 'gripRight']: 1 });
    add(stage, station, '确认杯子已放稳', 0.35, { owner: null, cup: STATIONS[station].position });
    move(arm,cupApproach(arm,state[arm]),stage,station,'沿夹持轴水平后退，退出杯身',.7);
  };
  const retreat = (arm, stage, station) => {
    move(arm, [state[arm][0], 1.28, Math.max(.40,state[arm][2])], stage, station, '夹爪抬起并退出工位', 0.75);
    move(arm, HOMES[arm], stage, station, '机械臂返回待机位', 1.2);
  };

  approach('left','cups','取杯');
  add('取杯', 'cups', '左臂闭合夹爪', 0.6, { gripLeft: 0 });
  add('取杯', 'cups', '取杯完成', 0.25, { owner: 'left' });
  transport('left', 'brew', '萃取');
  add('萃取', 'brew', '萃取浓缩咖啡', 6, { fill: 0.24 }, 'coffee');
  if (recipeId === 'americano') {
    transport('left', 'water', '加水');
    add('加水', 'water', '注入热水', 4, { fill: 0.86 }, 'water');
  }
  transport('left', 'handoff', '交接');
  release('left', 'handoff', '交接');
  retreat('left', '交接', 'handoff');
  approach('right','handoff','交接');
  add('交接', 'handoff', '右臂闭合夹爪', 0.6, { gripRight: 0 });
  add('交接', 'handoff', '杯子控制权交接完成', 0.25, { owner: 'right' });
  if (recipeId !== 'americano') {
    transport('right', 'milk', '加奶');
    add('加奶', 'milk', '注入鲜奶', 5, { fill: 0.82, milk: 1 }, 'milk');
  }
  if (recipeId === 'vanilla') {
    transport('right', 'syrup', '糖浆');
    add('糖浆', 'syrup', '加入香草糖浆', 2, { fill: 0.9 }, 'syrup');
  }
  transport('right', 'lid', '封盖');
  release('right', 'lid', '封盖');
  move('right', [1.34, 1.15, 0.37], '封盖', 'lid', '夹爪退让，封盖机构下降', 0.9);
  add('封盖', 'lid', '压合杯盖', 2, { lid: true });
  approach('right','lid','封盖');
  add('封盖', 'lid', '夹持成品杯', 0.55, { gripRight: 0 });
  add('封盖', 'lid', '封盖完成', 0.25, { owner: 'right' });
  transport('right', 'pickup', '出杯');
  release('right', 'pickup', '出杯');
  retreat('right', '出杯', 'pickup');
  add('出杯', 'pickup', '制作完成，请取杯', 0.5);
  return prepareMotion({ recipeId, recipe, segments, duration: cursor });
}

// Bake chronological IK seeds once: seeking/reconnects use the same solution branch.
export function prepareMotion(sequence) {
  const samples=[],seed={};
  for(let time=0;time<=sequence.duration+.1;time+=.1) {
    const segment=sequence.segments.find(s=>time<s.end) || sequence.segments.at(-1);
    if(segment.toolChange && !segment.rightJointTransition) {
      segment.rightJointTransition={
        from:solvePose(segment.from.right,graspOrientation('right',segment.from),BASES.right,seed.right),
        to:solvePose(segment.to.right,graspOrientation('right',segment.to),BASES.right,rightHomeSeed(segment.to.rightMode)),
      };
    }
    const state=sampleSequence(sequence,Math.min(time,sequence.duration));
    for(const side of ['left','right']) {
      let next;
      try { next=state[side+'Joints'] || solvePose(state[side],state[side+'Orientation'] || UPRIGHT,BASES[side],seed[side]); }
      catch(error) { throw new RangeError(`${side} @ ${time.toFixed(2)}s (${state.description}): ${error.message}`); }
      seed[side]=next;
    }
    samples.push({left:[...seed.left],right:[...seed.right]});
  }
  sequence.jointSamples=samples;
  return sequence;
}

export function sampleSequence(sequence, time) {
  time = Math.max(0, Math.min(sequence.duration, Number.isFinite(time) ? time : 0));
  const segment = sequence.segments.find((s) => time < s.end) || sequence.segments.at(-1);
  const t = Math.max(0, Math.min(1, (time - segment.start) / (segment.end - segment.start)));
  const state = clone(t >= 1 ? segment.to : segment.from);
  for (const key of ['left', 'right', 'cup']) state[key] = lerp3(segment.from[key], segment.to[key], smooth(t));
  for (const key of ['artProgress','gripLeft', 'gripRight', 'fill', 'milk', 'ice']) state[key] = (segment.from[key] || 0) + ((segment.to[key] || 0) - (segment.from[key] || 0)) * smooth(t);
  // Ownership is discrete. At a transfer both poses coincide with the fixture.
  if (state.owner) state.cup = [...state[state.owner]];
  state.leftOrientation=leftSideGrip(state.left);
  state.rightOrientation=new Quaternion(...graspOrientation('right',segment.from))
    .slerp(new Quaternion(...graspOrientation('right',segment.to)),smooth(t)).toArray();
  if(segment.from.rightMode!=='pitcher' && segment.to.rightMode!=='pitcher') state.rightOrientation=sideGrip('right',state.right);
  if(segment.rightJointTransition) {
    state.rightJoints=segment.rightJointTransition.from.map((q,i)=>q+(segment.rightJointTransition.to[i]-q)*smooth(t));
    const pose=forward(state.rightJoints,BASES.right);
    state.right=pose.position.toArray();state.rightOrientation=pose.quaternion.toArray();
  }
  state.cupOrientation=cupRotation(state);
  if(segment.latteArt) Object.assign(state,pouringPose(state.cup,state.fill,state.artProgress,undefined,undefined,state.cupOrientation));

  state.pitcherOrientation=state.pitcherOwner==='right'
    ?new Quaternion(...state.rightOrientation).multiply(new Quaternion(...UPRIGHT).invert()).toArray():[0,0,0,1];
  state.pitcher=state.pitcherOwner==='right'
    ?new Vector3(...state.right).sub(new Vector3(...PITCHER_GRASP).applyQuaternion(new Quaternion(...state.pitcherOrientation))).toArray()
    :[...(state.pitcher || PITCHER_HOME)];
  if(sequence.jointSamples) {
    const seed=sequence.jointSamples[Math.min(sequence.jointSamples.length-1,Math.floor(time/.1))];
    for(const side of ['left','right']) if(!state[side+'Joints']) state[side+'Joints']=solvePose(state[side],state[side+'Orientation'] || UPRIGHT,BASES[side],seed[side]);
  }
  return { ...state, stage: segment.stage, station: segment.station, description: segment.description,
    stream: t > 0 && t < 1 ? segment.stream : null, time, done: time >= sequence.duration,
    progress: time / sequence.duration, segmentProgress: t };
}
