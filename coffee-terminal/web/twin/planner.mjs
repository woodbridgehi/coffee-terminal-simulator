import { Quaternion } from 'three/src/math/Quaternion.js';
import { Vector3 } from 'three/src/math/Vector3.js';
import { fk,ik,trajectory } from './robot.mjs';
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
  const approach=new Vector3(0,-.12,0).applyQuaternion(new Quaternion(...target.quaternion));
  const pre={position:target.position.map((v,i)=>v+approach.toArray()[i]),quaternion:target.quaternion};
  const departure=new Vector3(0,-.12,0).applyQuaternion(new Quaternion(...from.quaternion));
  const post={position:from.position.map((v,i)=>v+departure.toArray()[i]),quaternion:from.quaternion};
  const corridors=[[target],[pre,target],[post,target],[post,pre,target],...[.15,.3,.45].map(lift=>{
    const z=Math.max(from.position[2],target.position[2])+lift;
    return [post,{position:[post.position[0],post.position[1],z],quaternion:from.quaternion},{position:[pre.position[0],pre.position[1],z],quaternion:target.quaternion},pre,target];
  })];
  const failures=[];
  for(const waypoints of corridors) {
    try {
      let q=start; const segments=[],probe=clone(state);
      for(const p of waypoints) {
        const end=ik(def,p,q),segment=trajectory(def,q,end,config.dt);
        // Sample every simulation tick and refine large joint increments. This is not a CCD proof.
        const subdivisions=Math.max(segment.ticks,Math.ceil(Math.max(...end.map((v,i)=>Math.abs(v-q[i])))/.01));
        for(let k=0;k<=subdivisions;k++) {
          probe.robots[task.robot].q=segment.sample(k/subdivisions*segment.ticks).q;
          syncAttachments(config,probe);
          const hits=checker.check(probe,{allowedGrasps:task.allowedGrasps??[]});
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
