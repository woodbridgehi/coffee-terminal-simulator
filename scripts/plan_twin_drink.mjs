import {runLatte} from '../coffee-terminal/web/twin/devices/client.mjs';
const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
try{const result=await runLatte(arg('--url','http://127.0.0.1:9131'),{scenario:arg('--scenario','normal'),onProgress:p=>{if(p.status==='SUCCEEDED')console.log(`${p.done}/${p.total} ${p.task} @ ${p.time.toFixed(2)}s`);}});console.log(JSON.stringify({sessionId:result.sessionId,completed:result.completed,time:result.state.time,cup:result.state.objects.cup,supplies:result.state.supplies},null,2));}
catch(error){console.error(error.message);if(error.command)console.error(JSON.stringify(error.command));process.exitCode=1;}
