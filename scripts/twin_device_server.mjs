import {createHash} from 'node:crypto';
import http from 'node:http';
import {Worker} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const webRoot=resolve(fileURLToPath(new URL('../coffee-terminal/web/',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary','.mp3':'audio/mpeg','.wav':'audio/wav'};
export async function createDeviceServer({world,config,port=9131}={}){
 const worker=new Worker(new URL('./twin_device_worker.mjs',import.meta.url),{workerData:{world,config}});
 let snapshot,next=0,history=[],fatal;const requests=new Map(),clients=new Set();
 let resolveReady,rejectReady;const ready=new Promise((res,rej)=>{resolveReady=res;rejectReady=rej;});
 const sendEvent=(client,type,data,id)=>{
  if(client.writableLength>1024*1024){client.destroy();clients.delete(client);return;}
  client.write(`${id?`id: ${id}\n`:''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
 };
 const failed=error=>{fatal=error;rejectReady(error);for(const p of requests.values())p.reject(error);requests.clear();};
 worker.on('error',failed);worker.on('exit',code=>{if(code)failed(Error(`Device worker exited ${code}`));});
 worker.on('message',m=>{
  if(m.type==='fatal'){failed(Error(m.message));return;}
  if(m.type==='response'){const p=requests.get(m.id);if(!p)return;requests.delete(m.id);if(m.error)p.reject(Object.assign(Error(m.error.message),m.error));else p.resolve(m.result);return;}
  if(m.type!=='snapshot')return;
  if(snapshot?.sessionId!==m.snapshot.sessionId)history=[];
  snapshot=m.snapshot;resolveReady();
  for(const e of m.events){history.push(e);if(history.length>2000)history.shift();for(const c of clients)sendEvent(c,'device-event',e,`${e.sessionId}:${e.id}`);}
  // State stream is an explicit debug view; command consumers use command events
  // or GET commands/:id, not the visual world's internal state as hardware feedback.
  for(const c of clients)sendEvent(c,'snapshot',{installationRevision:snapshot.installationRevision,sessionId:snapshot.sessionId,clock:snapshot.clock,state:snapshot.state,devices:snapshot.devices});
 });
 const rpc=(method,args={})=>new Promise((resolve,reject)=>{if(fatal){reject(fatal);return;}const id=++next;requests.set(id,{resolve,reject});worker.postMessage({id,method,args});});
 await ready;
 const json=(res,status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const body=async req=>{
  let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024)throw Object.assign(Error('Body exceeds 1 MiB'),{status:413,code:'BODY_TOO_LARGE'});chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw Object.assign(Error('Expected a JSON object'),{status:400,code:'INVALID_JSON'});}
 };
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname;
   if(req.method!=='GET'&&req.headers.origin){const origin=new URL(req.headers.origin);if(origin.host!==req.headers.host)throw Object.assign(Error('Use the same-origin local UI'),{status:403,code:'ORIGIN_REJECTED'});}
   if(path==='/api/events'&&req.method==='GET'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('retry: 1000\n\n');clients.add(res);
    const cursor=req.headers['last-event-id'],prefix=`${snapshot.sessionId}:`;
    if(cursor?.startsWith(prefix)){const n=Number(cursor.slice(prefix.length));for(const e of history)if(e.id>n)sendEvent(res,'device-event',e,`${e.sessionId}:${e.id}`);}
    sendEvent(res,'snapshot',{installationRevision:snapshot.installationRevision,sessionId:snapshot.sessionId,clock:snapshot.clock,state:snapshot.state,devices:snapshot.devices});req.on('close',()=>clients.delete(res));return;
   }
   if(path.startsWith('/api/')){
    let result;
    if(req.method==='GET'){
     if(path==='/api/state')result=await rpc('snapshot');
     else if(path==='/api/devices')result=(await rpc('snapshot')).devices;
     else if(path==='/api/experiment-config'){const s=await rpc('snapshot');result={...s.world,sharedDeviceConfig:s.config,configurationSource:{type:'device-lab',configurationId:createHash('sha256').update(JSON.stringify({world:s.world,devices:s.config})).digest('hex'),sessionId:s.sessionId,installationRevision:s.installationRevision,exportedAt:new Date().toISOString()}};}
     else if(path==='/api/config')result=(await rpc('snapshot')).config;
     else if(/^\/api\/devices\/[^/]+$/.test(path))result=await rpc('device',{deviceId:decodeURIComponent(path.split('/')[3])});
     else if(/^\/api\/commands\/[^/]+$/.test(path))result=await rpc('command',{commandId:decodeURIComponent(path.split('/')[3])});
     else throw Object.assign(Error('Unknown API route'),{status:404,code:'NOT_FOUND'});
    }else if(['POST','PUT'].includes(req.method)){
     const data=await body(req);
     if(path==='/api/commands'&&req.method==='POST'){
      const reply=await rpc('submit',data);
      if(reply.dropAck){req.socket.destroy();return;}
      if(reply.ackDelayMs)await new Promise(resolve=>setTimeout(resolve,reply.ackDelayMs));
      json(res,reply.command.status==='REJECTED'?422:reply.duplicate?200:202,{command:reply.command,duplicate:reply.duplicate});return;
     }
     if(/^\/api\/commands\/[^/]+\/cancel$/.test(path))result=await rpc('cancel',{...data,commandId:decodeURIComponent(path.split('/')[3])});
     else if(/^\/api\/devices\/[^/]+\/injection$/.test(path))result=await rpc('inject',{...data,deviceId:decodeURIComponent(path.split('/')[3])});
     else if(/^\/api\/devices\/[^/]+\/config$/.test(path)&&req.method==='PUT')result=await rpc('configure',{...data,deviceId:decodeURIComponent(path.split('/')[3])});
     else if(path==='/api/clock')result=await rpc('clock',data);
     else if(path==='/api/clock/advance')result=await rpc('advance',data);
     else if(path==='/api/session/reset')result=await rpc('reset',data);
     else if(path==='/api/refill')result=await rpc('refill',data);
     else if(path==='/api/pickup')result=await rpc('takeCup',data);
     else throw Object.assign(Error('Unknown API route'),{status:404,code:'NOT_FOUND'});
    }else throw Object.assign(Error('Method not allowed'),{status:405,code:'METHOD_NOT_ALLOWED'});
    json(res,200,result);return;
   }
   if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
   const relative=decodeURIComponent(path==='/'?'/device-lab.html':path),file=resolve(webRoot,'.'+relative);
   if(!file.startsWith(webRoot+sep)&&file!==webRoot)throw Object.assign(Error('Not found'),{status:404});
   const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
  }catch(error){json(res,error.status??(error.code==='ENOENT'?404:500),{error:{code:error.code??'INTERNAL_ERROR',message:error.message}});}
 });
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(error){await worker.terminate();throw error;}
 return {server,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{for(const c of clients)c.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await worker.terminate();}};
}
