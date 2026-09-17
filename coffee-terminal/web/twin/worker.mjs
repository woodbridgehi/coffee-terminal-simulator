import {Simulation} from './kernel.mjs';
import {latteTasks} from './recipes.mjs';
let sim;
self.onmessage=async({data})=>{
  try {
    if(data.type==='init')sim=await Simulation.create(data.config,data.tasks??latteTasks(),{policy:data.policy??'parallel'});
    else if(data.type==='advance') {for(let i=0;i<Math.min(100,data.ticks);i++)if(!sim.step())break;}
    else if(data.type==='command')sim.command(data.command);
    else if(data.type==='export'){self.postMessage({type:'export',data:sim.export()});return;}
    else if(data.type==='compare') {
      const results=[];
      for(const policy of ['serial','parallel']) {const experiment=await Simulation.create(data.config,latteTasks(),{policy,record:false});results.push({policy,...experiment.run(300)});}
      self.postMessage({type:'compare',results});return;
    } else throw Error('Unknown worker request');
    self.postMessage({type:'state',state:sim.state,events:sim.events.slice(-20),metrics:sim.metrics()});
  } catch(e) {self.postMessage({type:'error',message:e.message});}
};
