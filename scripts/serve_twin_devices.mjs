import {readFile} from 'node:fs/promises';
import {createDeviceServer} from './twin_device_server.mjs';
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing ${key}`);return args[i+1];};
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const world=await read(new URL('../config/twin/coffee-workcell-main-v2.json',import.meta.url)),config=await read(option('--config',new URL('../config/twin/device-lab-v1.json',import.meta.url)));
if(args.includes('--manual'))config.clock={mode:'manual',rate:1};
const port=Number(option('--port',9131));if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
const service=await createDeviceServer({world,config,port});console.log(`Device lab: ${service.url}/device-lab.html\nAPI: ${service.url}/api/devices\nClock: ${config.clock.mode}; process-local command ledger, new session after restart.`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await service.close();process.exit(0);});
