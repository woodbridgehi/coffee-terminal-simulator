import {createExperiment} from './experiment.mjs';
import {experimentTasks} from './shared-config.mjs';
let sim;
self.onmessage=async({data})=>{
  try {
    if(data.type==='init')sim=await createExperiment(data.config,data.tasks??experimentTasks(data.config),{policy:data.policy??'parallel'});
    else if(data.type==='advance') {for(let i=0;i<Math.min(100,data.ticks);i++)if(!sim.step())break;}
    else if(data.type==='command')sim.command(data.command);
    else if(data.type==='export'){self.postMessage({type:'export',data:sim.export()});return;}
    else if(data.type==='compare') {
      const results=[];
      for(const policy of ['serial','parallel']) {const experiment=await createExperiment(data.config,experimentTasks(data.config),{policy,record:false});results.push({policy,...experiment.run(600)});}
      self.postMessage({type:'compare',results});return;
    } else throw Error('Unknown worker request');
    self.postMessage({type:'state',state:sim.state,events:sim.events.slice(-20),metrics:sim.metrics()});
  } catch(e) {self.postMessage({type:'error',message:e.message});}
};
