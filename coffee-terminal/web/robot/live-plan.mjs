import { HOMES, STATIONS, sampleSequence } from './sequence.mjs';

const copy = (value) => JSON.parse(JSON.stringify(value));
const ALLOWED = new Set(['cups','brew','water','milk','ice','syrup','lid','pickup','wait']);
export function normalizeSteps(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 100) return null;
  if (steps.some((s) => !s || !s.visual || s.visual.version !== 1 || !Array.isArray(s.visual.actions) ||
    !s.visual.actions.length || s.visual.actions.some((a) => !ALLOWED.has(a)) ||
    !Number.isFinite(s.durationSeconds) || s.durationSeconds <= 0)) return null;
  return steps;
}

/** Compile visual subactions INTO each authoritative step, never add production time. */
export function createLivePlan(steps) {
  if (!normalizeSteps(steps)) throw new Error('设备尚未提供三维步骤计划');
  const sequence = { segments: [], ranges: [], duration: 0 };
  let state = { left: [...HOMES.left], right: [...HOMES.right], gripLeft: 1, gripRight: 1,
    cup: [...STATIONS.cups.position], owner: null, fill: 0, milk: 0, ice: 0, lid: false };
  let cursor = 0, index = 0, current = 'cups', held = false;
  const quantity = (step, action) => {
    const list = step.visual.materials || [];
    const matching = list.filter((m) => m.unit === 'ml' && (action === 'brew' || new RegExp({water:'water|水',milk:'milk|奶',syrup:'syrup|choco|糖浆|巧克力'}[action] || '(?!)','i').test(`${m.materialId} ${m.name}`)));
    return matching.reduce((sum,m) => sum + Number(m.amount || 0),0) || ({brew:45,water:150,milk:180,syrup:15}[action] || 0);
  };
  const total = steps.reduce((sum,step) => sum + step.visual.actions.reduce((n,a) => n + quantity(step,a),0),0) || 1;
  function add(station, description, changes = {}, weight = 1, stream = null) {
    const from = copy(state); state = { ...copy(state), ...copy(changes) };
    sequence.segments.push({ start: cursor, end: cursor + weight, stage: steps[index].stepName,
      station, description, from, to: copy(state), stream }); cursor += weight;
  }
  const move = (side,p,station,description) => add(station,description,{[side]:p});
  const grip = (side,open) => ({[side === 'left' ? 'gripLeft' : 'gripRight']:open});
  function transfer(side, station) {
    const target = STATIONS[station].position;
    if (state[side][2] < -0.4) move(side,[state[side][0],state[side][1],-0.24],station,'退出出料口');
    move(side,[state[side][0],1.40,Math.max(-0.24,state[side][2])],station,'抬杯');
    move(side,[target[0],1.40,Math.max(-0.24,target[2])],station,'搬运至工位');
    move(side,[target[0],target[1],Math.max(-0.24,target[2])],station,'对准定位托盘');
    if (target[2] < -0.4) move(side,target,station,'进入出料口下方');
    current = station;
  }
  function pickup(side,station) {
    transfer(side,station);
    add(station,'闭合夹爪',grip(side,0),0.6);
    add(station,'夹持杯子',{owner:side},0.1); held = true;
  }
  function drop(side,station) {
    add(station,'松开夹爪',grip(side,1),0.6);
    add(station,'杯子已放稳',{owner:null,cup:STATIONS[station].position},0.1);
    held = false;
  }
  function home(side,station) {
    move(side,[state[side][0],1.40,Math.max(-0.24,state[side][2])],station,'退出工位');
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
  return sequence;
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
