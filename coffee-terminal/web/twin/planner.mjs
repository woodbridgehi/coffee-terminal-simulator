import { Quaternion } from 'three/src/math/Quaternion.js';
import { Vector3 } from 'three/src/math/Vector3.js';
import { fk,ik,trajectory,pathTrajectory } from './robot.mjs';
import { syncAttachments } from './collision.mjs';
import { clone } from './schema.mjs';
// Deterministic candidate corridors, not a general sampling-based planner.
export function planMotion(config,state,task,checker) {
  const def=config.robots[task.robot],start=state.robots[task.robot].q;
  const from=fk(def,start);
  const station=config.stations[task.station]?.pose;
  const yaw=station?Math.atan2(-(station.position[0]-def.base.position[0]),station.position[1]-def.base.position[1]):0;
  const target=task.target?clone(task.target):{position:[...station.position],quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),yaw).toArray()};
  // A held container must arrive at the station pose; the TCP offset is accounted for.
  const objects=Object.entries(state.objects).filter(([,o])=>o.owner===task.robot);
  if(objects.length&&task.station) {
    // Grasp preserves the current TCP/container orientation; routes keep TCP orientation fixed.
    const offset=objects[0][1].pose.position.map((v,i)=>v-from.position[i]);
    target.position=target.position.map((v,i)=>v-offset[i]);
  }
  const nearCup=p=>Object.values(state.objects).some(o=>o.present!==false&&!o.owner&&new Vector3(...o.pose.position).distanceTo(new Vector3(...p.position))<.02);
  const withdraw=nearCup(from),enter=nearCup(target);
  // Do not enter around a cup with closed fingers and open them afterwards.
  if(enter)for(const g of Object.values(state.grippers??{}))if(g.robot===task.robot){
    const object=Object.entries(state.objects).find(([,o])=>o.present!==false&&!o.owner&&new Vector3(...o.pose.position).distanceTo(new Vector3(...target.position))<.02);
    if(g.openingMm<config.objects[object[0]].radius*2000+4)throw Error('GRIPPER_APPROACH_CLEARANCE: open jaws at least 4 mm wider than the container before approach');
  }
  const axial=config.motionProfile==='upright-corridor';
  const approach=new Vector3(0,axial?-.16:-.12,0).applyQuaternion(new Quaternion(...target.quaternion));
  const pre=(!axial||enter)?{position:target.position.map((v,i)=>v+approach.toArray()[i]),quaternion:target.quaternion}:target;
  const departure=new Vector3(0,axial?-.16:-.12,0).applyQuaternion(new Quaternion(...from.quaternion));
  const post=(!axial||withdraw)?{position:from.position.map((v,i)=>v+departure.toArray()[i]),quaternion:from.quaternion}:from;
  let corridors=[[target],[pre,target],[post,target],[post,pre,target],...[.15,.3,.45].map(lift=>{
    const z=Math.max(from.position[2],target.position[2])+lift;
    return [post,{position:[post.position[0],post.position[1],z],quaternion:from.quaternion},{position:[pre.position[0],pre.position[1],z],quaternion:target.quaternion},pre,target];
  })];
  if(config.motionProfile==='upright-corridor'&&!task.target) {
    // Axial disengagement comes before the front corridor; yaw is allowed only
    // after the fingers clear the container. Held containers stay upright.
    corridors=[];
    for(const height of [1.28,1.45,1.65,1.85])for(const front of [-.40,-.65,-.85]) {
      const z=Math.max(height,from.position[2],target.position[2]);
      const exit={position:[post.position[0],Math.min(front,post.position[1]),post.position[2]],quaternion:from.quaternion};
      const entry={position:[pre.position[0],Math.min(front,pre.position[1]),pre.position[2]],quaternion:target.quaternion};
      corridors.push([...(withdraw?[{...post,axial:true}]:[]),exit,{position:[exit.position[0],exit.position[1],z],quaternion:from.quaternion},
        {position:[entry.position[0],entry.position[1],z],quaternion:target.quaternion},entry,...(enter?[{...pre,orientAtEnd:true},{...target,axial:true}]:[target])]);
    }
  }
  const failures=[];
  // Other arms can be in a valid grasp transition while this arm plans.
  // Their current contacts are checked with active policies by Simulation.step.
  const relevant=hit=>[hit.a,hit.b].some(id=>id.startsWith(`${task.robot}/`)||state.objects[id]?.owner===task.robot);
  for(const waypoints of corridors) {
    try {
      let q=start; const segments=[],probe=clone(state);
      for(const p of waypoints) {
        if(config.motionProfile==='upright-corridor'&&!task.target) {
          const knots=[q];
          for(const pose of (p.axial?axialLeg(fk(def,q),p):uprightLeg(def,fk(def,q),p))){q=ik(def,pose,q);if(q.some((v,j)=>Math.abs(v-knots.at(-1)[j])>1e-6))knots.push(q);}
          const motion=pathTrajectory(def,knots,config.dt);
          for(let tick=0;tick<=motion.ticks;tick++){
            probe.robots[task.robot].q=motion.sample(tick).q;syncAttachments(config,probe);
            const hits=checker.check(probe,{allowedGrasps:task.allowedGrasps??[]}).filter(relevant);
            if(hits.length)throw Error(`COLLISION: ${hits[0].a} / ${hits[0].b}`);
          }
          segments.push(motion);continue;
        }

        const end=ik(def,p,q),segment=trajectory(def,q,end,config.dt);
        // Sample every simulation tick and refine large joint increments. This is not a CCD proof.
        const subdivisions=Math.max(segment.ticks,Math.ceil(Math.max(...end.map((v,i)=>Math.abs(v-q[i])))/.01));
        for(let k=0;k<=subdivisions;k++) {
          probe.robots[task.robot].q=segment.sample(k/subdivisions*segment.ticks).q;
          syncAttachments(config,probe);
          const hits=checker.check(probe,{allowedGrasps:task.allowedGrasps??[]}).filter(relevant);
          if(hits.length) throw Error(`COLLISION: ${hits[0].a} / ${hits[0].b}`);
        }
        segments.push(segment); q=end;
      }
      return {segments,ticks:segments.reduce((s,t)=>s+t.ticks,0),sample(tick) {
        for(const s of segments) {if(tick<=s.ticks) return s.sample(tick);tick-=s.ticks;}
        return segments.at(-1).sample(Infinity);
      }};
    } catch(e) { failures.push(e.message); }
  }
  throw Error(`NO_SAFE_ROUTE: ${task.id}: ${[...new Set(failures)].join('; ')}`);
}


function uprightLeg(def,from,to) {
  const a=from.position.map((v,i)=>v-def.base.position[i]),b=to.position.map((v,i)=>v-def.base.position[i]);
  const d=[b[0]-a[0],b[1]-a[1]],l=d[0]**2+d[1]**2,t=l?Math.max(0,Math.min(1,-(a[0]*d[0]+a[1]*d[1])/l)):0;
  let routed=[to];
  if(Math.hypot(a[0]+t*d[0],a[1]+t*d[1])<.44){
    if(Math.min(Math.hypot(a[0],a[1]),Math.hypot(b[0],b[1]))<.44)throw Error('INNER_WORKSPACE');
    const angle=Math.atan2(a[1],a[0]),end=Math.atan2(b[1],b[0]),delta=Math.atan2(Math.sin(end-angle),Math.cos(end-angle));
    const count=Math.max(1,Math.ceil(Math.abs(delta)/.15));
    routed=[...Array.from({length:count+1},(_,i)=>({position:[def.base.position[0]+.48*Math.cos(angle+delta*i/count),def.base.position[1]+.48*Math.sin(angle+delta*i/count),def.base.position[2]+a[2]+(b[2]-a[2])*i/count]})),to];
  }
  let previous=from;
  return routed.flatMap(p=>{
    const a=previous;previous=p;
    const n=Math.max(1,Math.ceil(new Vector3(...a.position).distanceTo(new Vector3(...p.position))/.06));
    return Array.from({length:n},(_,i)=>{
      const position=a.position.map((v,j)=>v+(p.position[j]-v)*(i+1)/n);
      const yaw=Math.atan2(-(position[0]-def.base.position[0]),position[1]-def.base.position[1]);
      return {position,quaternion:i===n-1&&p.orientAtEnd?p.quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),yaw).toArray()};
    });
  });
}

// Close to a container, translate along the fingers without yawing through it.
function axialLeg(from,to) {
 const n=Math.max(1,Math.ceil(new Vector3(...from.position).distanceTo(new Vector3(...to.position))/.01));
 return Array.from({length:n},(_,i)=>({position:from.position.map((v,j)=>v+(to.position[j]-v)*(i+1)/n),quaternion:to.quaternion}));
}
