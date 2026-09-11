import { cupApproach, cupTravel } from './cup-motion.mjs';
import { ART_CUP, PITCHER_HOME, PITCHER_GRASP, pouringPose, validPattern } from './latte-art.mjs';
import { UPRIGHT } from './kinematics.mjs';
import { HOMES, STATIONS, sampleSequence, prepareMotion, transitionState, cupRotation } from './sequence.mjs';

const PITCHER_PICKUP=PITCHER_HOME.map((v,i)=>v+PITCHER_GRASP[i]);
const copy = (value) => JSON.parse(JSON.stringify(value));
const ALLOWED = new Set(['cups','brew','water','milk','ice','syrup','lid','pickup','wait','latte-art']);
export function normalizeSteps(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 100) return null;
  if (steps.some((s) => !s || !s.visual || s.visual.version !== 1 || !Array.isArray(s.visual.actions) ||
    !s.visual.actions.length || s.visual.actions.some((a) => !ALLOWED.has(a)) ||
    !Number.isFinite(s.durationSeconds) || s.durationSeconds <= 0)) return null;
  if (steps.some(s=>s.visual.actions.includes('latte-art') &&
    (!validPattern(s.visual.latteArt) || s.durationSeconds<24 || s.visual.actions.length!==1))) return null;
  return steps;
}

/** Compile visual subactions INTO each authoritative step, never add production time. */
export function createLivePlan(steps, {motion=true}={}) {
  if (!normalizeSteps(steps)) throw new Error('设备尚未提供三维步骤计划');
  const sequence = { segments: [], ranges: [], duration: 0 };
  let state = { left: [...HOMES.left], right: [...HOMES.right], gripLeft: 1, gripRight: 1,
    cup: [...STATIONS.cups.position], owner: null, fill: 0, milk: 0, ice: 0, lid: false, pitcher:[...PITCHER_HOME], pitcherOwner:null, rightMode:'cup', rightOrientation:UPRIGHT, artProgress:0 };
  let cursor = 0, index = 0, current = 'cups', held = false;
  const quantity = (step, action) => {
    const list = step.visual.materials || [];
    const matching = list.filter((m) => m.unit === 'ml' && (action === 'brew' || new RegExp({water:'water|水',milk:'milk|奶','latte-art':'milk|奶',syrup:'syrup|choco|糖浆|巧克力'}[action] || '(?!)','i').test(`${m.materialId} ${m.name}`)));
    return matching.reduce((sum,m) => sum + Number(m.amount || 0),0) || ({brew:45,water:150,milk:180,syrup:15}[action] || 0);
  };
  const reference = steps[0]?.visual?.liquidReferenceMl;
  const total = (Number.isFinite(reference) && reference > 0 ? reference : 0) || steps.reduce((sum,step) => sum + step.visual.actions.reduce((n,a) => n + quantity(step,a),0),0) || 1;
  function add(station, description, changes = {}, weight = 1, stream = null) {
    const from = copy(state); state = transitionState(state,changes);
    sequence.segments.push({ start: cursor, end: cursor + weight, stage: steps[index].stepName,
      station, description, stepId: steps[index].stepId, dispenseChannel: steps[index].visual.dispenseChannel || null,
      from, to: copy(state), stream }); cursor += weight;
  }
  const move = (side,p,station,description) => {
    const points=side==='right' && state.rightMode==='pitcher'?[p]:cupTravel(state[side],p,side);
    for(const point of points) add(station,description,{[side]:point},1/points.length);
  };
  const grip = (side,open) => ({[side === 'left' ? 'gripLeft' : 'gripRight']:open});
  function transfer(side, station) {
    const target = STATIONS[station].position;
    if (state[side][2] < -0.4) move(side,[state[side][0],state[side][1],0.40],station,'退出出料口');
    move(side,[state[side][0],1.28,Math.max(0.40,state[side][2])],station,'抬杯');
    move(side,[target[0],1.28,Math.max(0.40,target[2])],station,'搬运至工位');
    move(side,[target[0],target[1],Math.max(0.40,target[2])],station,'对准定位托盘');
    if (target[2] < 0.40) move(side,target,station,'进入出料口下方');
    current = station;
  }
  function pickup(side,station) {
    const target=STATIONS[station].position,approach=cupApproach(side,target);
    move(side,[state[side][0],1.28,Math.max(.4,state[side][2])],station,'空夹爪退出至搬运高度');
    move(side,[approach[0],1.28,approach[2]],station,'空夹爪移至侧夹预备位');
    move(side,approach,station,'空夹爪对准杯身侧面');
    move(side,target,station,'沿夹持轴水平进入杯身');
    current=station;
    add(station,'闭合夹爪',grip(side,0),0.6);
    add(station,'夹持杯子',{owner:side},0.1); held = true;
  }
  function drop(side,station) {
    add(station,'松开夹爪',grip(side,1),0.6);
    add(station,'杯子已放稳',{owner:null,cup:STATIONS[station].position},0.1);
    held = false;
    move(side,cupApproach(side,state[side]),station,'沿夹持轴水平后退，退出杯身');
  }
  function home(side,station) {
    move(side,[state[side][0],1.28,Math.max(0.40,state[side][2])],station,'退出工位');
    move(side,HOMES[side],station,'机械臂回位');
  }
  function ensureSide(side) {
    if (!held) { pickup(side,current); return; }
    if (state.owner === side) return;
    const previous = state.owner;
    transfer(previous,'handoff'); drop(previous,'handoff'); home(previous,'handoff');
    pickup(side,'handoff');
  }
  for (index = 0; index < steps.length; index++) {
    const startIndex = sequence.segments.length, start = sequence.duration;
    cursor = start;
    if (index === 0) pickup('left','cups');
    for (const action of steps[index].visual.actions) {
      if (action === 'cups') continue;
      if (action === 'latte-art') {
        if(state.fill<=0 || state.lid || state.ice>0 || state.artProgress>0) throw new Error('拉花需要未封盖、无冰且已有咖啡的饮料');
        ensureSide('left');
        move('left',ART_CUP,'handoff','左臂持杯进入拉花区');
        add('handoff','空夹爪切换奶泡杯抓取姿态',{rightMode:'pitcher',rightOrientation:UPRIGHT},1);
        sequence.segments.at(-1).toolChange=true;
        // A prepared pitcher is a simulation fixture; this action consumes its reserved milk.
        move('right',[PITCHER_PICKUP[0],1.28,PITCHER_PICKUP[2]],'handoff','右臂接近预制奶泡杯');
        move('right',PITCHER_PICKUP,'handoff','右臂对准奶泡杯');
        add('handoff','夹持奶泡杯',grip('right',0),.6);
        add('handoff','奶泡杯抓取完成',{pitcherOwner:'right'},.1);
        move('right',[PITCHER_PICKUP[0],1.28,PITCHER_PICKUP[2]],'handoff','提起奶泡杯');
        const startPose=pouringPose(ART_CUP,state.fill,0,0,.16,cupRotation(state));
        add('handoff','壶嘴对准液面',startPose,1);
        const pourStart=pouringPose(ART_CUP,state.fill,0,undefined,undefined,cupRotation(state));
        add('handoff','倾斜奶泡杯，准备倾倒',pourStart,1);
        const fill=Math.min(.9,state.fill+.86*quantity(steps[index],action)/total);
        add('handoff','双臂协作：螺旋拉花',{...pouringPose(ART_CUP,fill,1,undefined,undefined,cupRotation(state)),fill,milk:1,artProgress:1},8,'latte-art');
        sequence.segments.at(-1).latteArt=steps[index].visual.latteArt;
        add('handoff','收流并回正奶泡杯',pouringPose(ART_CUP,fill,1,0,.16,cupRotation(state)),1);
        move('right',[PITCHER_PICKUP[0],1.28,PITCHER_PICKUP[2]],'handoff','移回奶泡杯托盘');
        move('right',PITCHER_PICKUP,'handoff','放下奶泡杯');
        add('handoff','松开奶泡杯',grip('right',1),.6);
        add('handoff','奶泡杯已归位',{pitcherOwner:null,pitcher:PITCHER_HOME},.1);
        home('right','handoff');
        add('handoff','空夹爪恢复咖啡杯水平侧夹',{rightMode:'cup'},1);
        sequence.segments.at(-1).toolChange=true;
        continue;
      }
      if (action === 'wait') { add(current,'执行设备自定义步骤',{},3); continue; }
      const side = ['milk','syrup','lid','pickup'].includes(action) ? 'right' : 'left';
      ensureSide(side); transfer(side,action);
      if (action === 'pickup') { drop(side,action); home(side,action); continue; }
      if (action === 'lid') {
        drop(side,action); move(side,[1.34,1.15,0.37],action,'夹爪退出封盖区');
        add(action,'压合杯盖',{lid:true},3); pickup(side,action);
      } else if (action === 'ice') {
        add(action,'加入冰块',{ice:1},5);
      } else {
        add(action,steps[index].stepName,{fill:Math.min(0.9,state.fill+0.86*quantity(steps[index],action)/total),
          milk:action === 'milk' ? 1 : state.milk},6,{brew:'coffee',water:'water',milk:'milk',syrup:'syrup'}[action]);
      }
    }
    if (index === steps.length - 1 && current !== 'pickup') {
      ensureSide('right'); transfer('right','pickup'); drop('right','pickup'); home('right','pickup');
    }
    if (sequence.segments.length === startIndex) add(current,steps[index].stepName,{},1);
    const weight = cursor - start, duration = steps[index].durationSeconds;
    for (const segment of sequence.segments.slice(startIndex)) {
      segment.start = start + (segment.start-start)/weight*duration;
      segment.end = start + (segment.end-start)/weight*duration;
    }
    sequence.duration = start+duration;
    sequence.ranges.push({start,end:sequence.duration});
  }
  return motion?prepareMotion(sequence):sequence;
}

export function livePosition(snapshot, plan) {
  if (snapshot.state === 'SUCCEEDED') return plan.duration;
  let index = snapshot.steps.findIndex((step) => step.stepId === snapshot.stepId);
  if (index < 0) index = Number.isInteger(snapshot.stepIndex) ? snapshot.stepIndex : 0;
  index = Math.min(plan.ranges.length-1,Math.max(0,index));
  const range = plan.ranges[index];
  const progress = Math.max(0,Math.min(1,Number(snapshot.stepProgress) || 0));
  // Only confirmed SUCCEEDED exposes the final cup, even if progress rounded to 100%.
  return Math.min(plan.duration-1e-7,range.start+(range.end-range.start)*progress);
}
export { sampleSequence };
