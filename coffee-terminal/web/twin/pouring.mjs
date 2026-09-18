// Pouring is a joint motion with a hold phase, not a renderer-only cup rotation.
import {Quaternion} from 'three/src/math/Quaternion.js';
import {Vector3} from 'three/src/math/Vector3.js';
import {ik,matrix,pose,pathTrajectory} from './robot.mjs';
import {syncAttachments} from './collision.mjs';
export function pourLip(def,object,target) {
 const q=new Quaternion(...object.pose.quaternion),direction=new Vector3(...target.pose.position).sub(new Vector3(...object.pose.position));direction.z=0;
 // Project the downward direction onto the tilted rim plane. At rest use the target direction.
 const localDown=new Vector3(0,0,-1).applyQuaternion(q.clone().invert());localDown.z=0;
 const local=localDown.length()>.1?localDown:direction.applyQuaternion(q.clone().invert());local.z=0;local.normalize().multiplyScalar(def.radius);local.z=def.height/2;
 return local.applyQuaternion(q).add(new Vector3(...object.pose.position)).toArray();
}
export function planPour(config,state,task,checker) {
 const def=config.robots[task.robot],src=state.objects[task.source],dst=state.objects[task.object],objectDef=config.objects[task.source],start=state.robots[task.robot].q;
 const direction=new Vector3(...dst.pose.position).sub(new Vector3(...src.pose.position));direction.z=0;if(direction.length()<.01)direction.set(-1,0,0);direction.normalize();
 const axis=new Vector3(0,0,1).cross(direction),angle=Math.PI/3;
 const original=new Quaternion(...src.pose.quaternion),tilted=new Quaternion().setFromAxisAngle(axis,angle).multiply(original);
 // Place the lowest lip above the receiving cup. All approach samples are collision checked.
 const tiltedObject={pose:{position:[...src.pose.position],quaternion:tilted.toArray()}};
 const lip=pourLip(objectDef,tiltedObject,dst),endPosition=src.pose.position.map((v,i)=>v+([dst.pose.position[0],dst.pose.position[1],dst.pose.position[2]+config.objects[task.object].height/2+.08][i]-lip[i]));
 const knots=[start];let q=start;
 for(let i=1;i<=24;i++){
  const u=i/24,objectPose={position:src.pose.position.map((v,j)=>v+(endPosition[j]-v)*u),quaternion:original.clone().slerp(tilted,u).toArray()};
  const tcp=pose(matrix(objectPose).multiply(matrix(src.attachment).invert()));q=ik(def,tcp,q);knots.push(q);
 }
 const down=pathTrajectory(def,knots,config.dt),up=pathTrajectory(def,[...knots].reverse(),config.dt),holdTicks=Math.max(1,Math.ceil((task.duration??6)/config.dt));
 const motion={ticks:down.ticks+holdTicks+up.ticks,flowStart:down.ticks,flowEnd:down.ticks+holdTicks,holdTicks,sample(tick){return tick<=down.ticks?down.sample(tick):tick<=down.ticks+holdTicks?down.sample(Infinity):up.sample(tick-down.ticks-holdTicks);}};
 const probe=structuredClone(state);
 for(let tick=0;tick<=motion.ticks;tick++){
  probe.robots[task.robot].q=motion.sample(tick).q;syncAttachments(config,probe);
  const hit=checker.check(probe).find(h=>[h.a,h.b].some(id=>id.startsWith(task.robot+'/')||id===task.source));
  if(hit)throw Error(`NO_SAFE_POUR: ${hit.a} / ${hit.b}`);
 }
 return motion;
}
