import {prepareWorld} from './devices/profile.mjs';
import {validateWorld,clone} from './schema.mjs';
import {latteTasks} from './recipes.mjs';
export function sharedWorld(base,profile,source={type:'file'}){
 const world=prepareWorld(base,profile);
 world.sharedDeviceConfig=clone(profile);world.configurationSource=clone(source);
 return validateWorld(world);
}
export function experimentTasks(world){
 const tasks=latteTasks(world),profiles=world.sharedDeviceConfig?.devices;if(!profiles)return tasks;
 const dispenser=Object.entries(world.devices).find(([,d])=>d.effect==='dispense'&&d.object==='cup');
 if(dispenser){tasks.unshift({id:'dispense-cup',type:'dispense',device:dispenser[0],object:'cup',after:[],resources:[]});tasks.find(t=>t.id==='left-get-cup').after.push('dispense-cup');}
 for(const t of tasks)if(['grasp','release'].includes(t.type))t.duration=profiles[t.robot].timing[`${t.type}Seconds`];
 return tasks;
}
