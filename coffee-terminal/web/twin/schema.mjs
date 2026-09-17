export const clone = value => structuredClone(value);
export function validateWorld(w) {
  const assert=(ok,msg)=>{if(!ok) throw Error(`WORLD_SCHEMA: ${msg}`);};
  const numbers=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite);
  const positive=x=>Number.isFinite(x)&&x>0;
  const checkPose=p=>p&&numbers(p.position,3)&&numbers(p.quaternion,4)&&Math.abs(Math.hypot(...p.quaternion)-1)<1e-5;
  assert(w.schemaVersion===1,'schemaVersion must be 1');
  assert(w.coordinates==='RH_Z_UP'&&w.units==='m_rad_s_kg','coordinates/units');
  assert(positive(w.dt)&&w.dt<=.05,'dt in (0, .05]');
  assert(['stop','shadow'].includes(w.collisionMode),'collisionMode');
  assert(Number.isFinite(w.clearance)&&w.clearance>=0,'clearance');
  assert(w.robots&&w.stations&&w.devices&&w.materials&&Array.isArray(w.obstacles),'collections');
  const ids=new Set();
  const idCheck=id=>{assert(typeof id==='string'&&/^[a-z][a-z0-9_-]*$/i.test(id)&&!ids.has(id),`duplicate/invalid id ${id}`);ids.add(id);};
  for(const [id,r] of Object.entries(w.robots)) {
    idCheck(id);assert(r.id===id&&checkPose(r.base)&&checkPose(r.tool),`${id} poses`);
    assert(r.chain?Array.isArray(r.chain)&&r.chain.filter(j=>j.type!=='fixed').length===6&&r.chain.every(j=>['fixed','revolute','continuous'].includes(j.type)&&checkPose(j.origin)&&(j.type==='fixed'||numbers(j.axis,3)&&Math.abs(Math.hypot(...j.axis)-1)<1e-5)):['a','d','alpha'].every(k=>numbers(r.dh?.[k],6)),`${id} DH/URDF chain`);
    assert(numbers(r.home,6)&&r.limits?.length===6,`${id} joints`);
    assert(r.limits.every((l,i)=>Number.isFinite(l.min)&&l.min<l.max&&positive(l.velocity)&&positive(l.acceleration)&&positive(l.jerk)&&r.home[i]>=l.min&&r.home[i]<=l.max),`${id} limits`);
    assert(positive(r.linkRadius),`${id} radius`);
    assert(Array.isArray(r.allowedSelfPairs)&&r.allowedSelfPairs.every(p=>numbers(p,2)&&p.every(i=>Number.isInteger(i)&&i>=0&&i<=7)),`${id} self pairs`);
  }
  for(const [id,s] of Object.entries(w.stations)) { idCheck(id);assert(checkPose(s.pose),`${id} pose`); }
  for(const o of w.obstacles) {idCheck(o.id);assert(checkPose(o.pose)&&numbers(o.size,3)&&o.size.every(positive),`${o.id} box`);}
  for(const [id,m] of Object.entries(w.materials)) {idCheck(id);assert(Number.isFinite(m.amount)&&m.amount>=0,`${id} amount`);}
  for(const [id,d] of Object.entries(w.devices)) {
    idCheck(id);assert(w.stations[d.station]&&Number.isFinite(d.warmup)&&d.warmup>=0&&Number.isFinite(d.cooldown)&&d.cooldown>=0,`${id} device`);
    assert(positive(d.duration)&&Array.isArray(d.inputs)&&d.inputs.every(i=>w.materials[i.material]&&positive(i.amount)),`${id} recipe`);
    assert(new Set(d.inputs.map(i=>i.material)).size===d.inputs.length,`${id} duplicate input`);
    assert(positive(d.outputKg),`${id} outputKg`);
    assert(d.inputs.reduce((s,i)=>s+i.amount,0)+1e-9>=d.outputKg,`${id} mass conservation`);
  }
  assert(w.objects&&Object.keys(w.objects).length>0,'objects');
  for(const [id,o] of Object.entries(w.objects)) {idCheck(id);assert(checkPose(o.pose)&&positive(o.radius)&&positive(o.height)&&positive(o.capacityKg)&&Number.isFinite(o.tareKg)&&o.tareKg>0,`${id} container`);}
  return clone(w);
}
export function validateGraph(tasks,world) {
  const ids=new Set(tasks.map(t=>t.id));
  if(ids.size!==tasks.length) throw Error('TASK_SCHEMA: duplicate id');
  const done=new Set();
  for(const t of tasks) {
    if(!['move','grasp','release','process','wait','transfer'].includes(t.type)||!Array.isArray(t.after)||!Array.isArray(t.resources)||new Set(t.resources).size!==t.resources.length||t.after.some(id=>!ids.has(id))) throw Error(`TASK_SCHEMA: ${t.id}`);
    if(['move','grasp','release'].includes(t.type)&&!world.robots[t.robot]) throw Error(`TASK_SCHEMA: robot ${t.id}`);
    if(['grasp','release','process'].includes(t.type)&&!world.objects[t.object]) throw Error(`TASK_SCHEMA: object ${t.id}`);
    if(t.target&&(!Array.isArray(t.target.position)||t.target.position.length!==3||!Array.isArray(t.target.quaternion)||t.target.quaternion.length!==4||![...t.target.position,...t.target.quaternion].every(Number.isFinite)||Math.abs(Math.hypot(...t.target.quaternion)-1)>1e-5)) throw Error(`TASK_SCHEMA: pose ${t.id}`);
    if(t.allowedGrasps&&(!Array.isArray(t.allowedGrasps)||t.allowedGrasps.some(p=>!world.robots[p.robot]||!world.objects[p.object]))) throw Error(`TASK_SCHEMA: grasp policy ${t.id}`);
    if(t.type==='move'&&!world.stations[t.station]&&!t.target) throw Error(`TASK_SCHEMA: target ${t.id}`);
    if(t.type==='release'&&!world.stations[t.station]) throw Error(`TASK_SCHEMA: station ${t.id}`);
    if(t.type==='process'&&!world.devices[t.device]) throw Error(`TASK_SCHEMA: device ${t.id}`);
    if(t.type==='transfer'&&(!world.objects[t.object]||!world.objects[t.source]||t.object===t.source||!world.robots[t.robot])) throw Error(`TASK_SCHEMA: transfer ${t.id}`);
    if(t.duration!==undefined&&!(Number.isFinite(t.duration)&&t.duration>=0)) throw Error(`TASK_SCHEMA: duration ${t.id}`);
    if(t.type==='wait'&&!(Number.isFinite(t.duration)&&t.duration>=0)) throw Error(`TASK_SCHEMA: duration ${t.id}`);
  }
  while(done.size<tasks.length) {
    const ready=tasks.filter(t=>!done.has(t.id)&&t.after.every(id=>done.has(id)));
    if(!ready.length) throw Error('TASK_SCHEMA: dependency cycle');
    ready.forEach(t=>done.add(t.id));
  }
  return clone(tasks);
}
