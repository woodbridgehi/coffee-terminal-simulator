import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
// Executes the actual shipped browser Worker bundle; substitutes only its message transport.
// This does not claim WebGL or browser UI validation.
test('built worker initializes, advances fixed ticks and exports a versioned experiment',async()=>{
  const url=new URL('../../coffee-terminal/web/digital-twin.worker.js',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:data=>parentPort.postMessage(data)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
  const ask=data=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(Error('Worker timeout'));},15000);
    const onMessage=m=>{cleanup();resolve(m);},onError=e=>{cleanup();reject(e);};
    const cleanup=()=>{clearTimeout(timer);worker.off('message',onMessage);worker.off('error',onError);};
    worker.on('message',onMessage);worker.on('error',onError);worker.postMessage(data);
  });
  try{
    const config=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-v1.json',import.meta.url)));
    const init=await ask({type:'init',config,tasks:[{id:'wait',type:'wait',after:[],resources:[],duration:.1}]});assert.equal(init.type,'state');assert.equal(init.state.time,0);
    const advanced=await ask({type:'advance',ticks:10});assert.equal(advanced.state.status,'completed');assert.equal(advanced.state.time,.1);
    const exported=await ask({type:'export'});assert.equal(exported.type,'export');assert.equal(exported.data.engineVersion,'1.0.0');assert.equal(exported.data.finalState.tick,5);
  }finally{await worker.terminate();}
});
