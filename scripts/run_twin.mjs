import {readFile,writeFile} from 'node:fs/promises';
import {Simulation} from '../coffee-terminal/web/twin/kernel.mjs';
import {latteTasks} from '../coffee-terminal/web/twin/recipes.mjs';
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing ${name} value`);return args[i+1];};
if(args.includes('--help')){console.log('npm run twin:run -- [--world file.json] [--tasks tasks.json] [--policy serial|parallel] [--compare] [--output experiment.json] [--replay experiment.json] [--max-seconds 600]');process.exit(0);}
const maxSeconds=Number(option('--max-seconds',600));if(!Number.isFinite(maxSeconds)||maxSeconds<=0)throw Error('Invalid max-seconds');
if(args.includes('--replay')) {
  const recorded=JSON.parse(await readFile(option('--replay'),'utf8'));
  const sim=await Simulation.create(recorded.config,recorded.tasks,{policy:recorded.policy,record:false});
  let c=0;while(sim.state.tick<recorded.finalState.tick){while(recorded.commands[c]?.tick===sim.state.tick){const {tick,...command}=recorded.commands[c++];sim.command(command);}if(!sim.step())break;}
  while(recorded.commands[c]?.tick===sim.state.tick){const {tick,...command}=recorded.commands[c++];sim.command(command);}
  // Terminal collision/failure may happen without advancing the last tick.
  if(sim.state.status!==recorded.finalState.status)sim.step();
  const same=JSON.stringify(sim.state)===JSON.stringify(recorded.finalState);console.log(JSON.stringify({deterministic:same,...sim.metrics()},null,2));if(!same)process.exitCode=1;
} else {
  const config=JSON.parse(await readFile(option('--world',new URL('../config/twin/coffee-workcell-main-v2.json',import.meta.url)),'utf8'));
  const tasks=args.includes('--tasks')?JSON.parse(await readFile(option('--tasks'),'utf8')):latteTasks(config);
  const runs=[];
  for(const policy of args.includes('--compare')?['serial','parallel']:[option('--policy','parallel')]) {
    const sim=await Simulation.create(config,tasks,{policy,record:!!option('--output')});const metrics=sim.run(maxSeconds);runs.push(sim.export());console.log(JSON.stringify({policy,...metrics},null,2));if(metrics.status!=='completed')process.exitCode=1;
  }
  if(option('--output'))await writeFile(option('--output'),JSON.stringify(runs.length===1?runs[0]:{schemaVersion:1,experiments:runs}));
}
