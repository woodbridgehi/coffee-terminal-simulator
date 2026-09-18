import {relative} from './robot.mjs';
export const defaultCupSensor=()=>({enabled:true,radiusMm:80,heightToleranceMm:8});
// Presence on the pad, in station coordinates. Decorative stacks and falling
// preview meshes are not physical objects and never participate in sensing.
export function cupOnPad(world,state,deviceId='cup-dispenser'){
 const device=world.devices[deviceId],sensor=device.cupSensor??defaultCupSensor();if(!sensor.enabled)return false;
 const station=world.stations[device.station].pose,padZ=-world.objects[device.object].height/2;
 return Object.entries(state.objects).some(([id,o])=>{
  if(o.present===false)return false;
  const p=relative(station,o.pose),q=p.quaternion,upright=1-2*(q[0]*q[0]+q[1]*q[1]);
  return upright>.98&&Math.hypot(p.position[0],p.position[1])<=sensor.radiusMm/1000&&Math.abs(p.position[2]-world.objects[id].height/2-padZ)<=sensor.heightToleranceMm/1000;
 });
}
