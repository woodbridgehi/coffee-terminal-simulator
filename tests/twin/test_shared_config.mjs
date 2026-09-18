import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sharedWorld,experimentTasks} from '../../coffee-terminal/web/twin/shared-config.mjs';
import {createExperiment} from '../../coffee-terminal/web/twin/experiment.mjs';
import {createDeviceServer} from '../../scripts/twin_device_server.mjs';
const base=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-main-v2.json',import.meta.url)));
const profile=JSON.parse(await readFile(new URL('../../config/twin/device-lab-v1.json',import.meta.url)));
test('shared configuration copies layout, process, stock, tool and detector settings without changing the source',()=>{
 const p=structuredClone(profile),initial=sharedWorld(base,p);p.devices.foamer.mounting=structuredClone(initial.installation.mounts.foamer);p.devices.foamer.mounting.position[0]+=.02;p.devices.foamer.timing.durationSeconds=21;p.devices['left-gripper'].gripper.closingSpeedMmS=10;p.devices['cup-dispenser'].stock.initial=7;p.devices['cup-dispenser'].cupSensor.radiusMm=60;
 const w=sharedWorld(base,p),tasks=experimentTasks(w);assert.equal(tasks.length,32);assert.ok(Math.abs(w.stations.milk.pose.position[0]-.7)<1e-9);assert.equal(w.devices.foamer.duration,21);assert.equal(w.supplies['cup-dispenser-stock'].amount,7);assert.equal(w.grippers['left-gripper'].closingSpeedMmS,10);assert.equal(w.devices['cup-dispenser'].cupSensor.radiusMm,60);assert.equal(w.objects.cup.present,false);w.sharedDeviceConfig.devices.foamer.model='changed';assert.notEqual(p.devices.foamer.model,'changed');
});
test('shared experiment completes real dispensing and jaw movement, exports a self-contained deterministic replay',async()=>{
 const p=structuredClone(profile);p.devices['left-gripper'].gripper.closingSpeedMmS=10;
 const w=sharedWorld(base,p),sim=await createExperiment(w);assert.equal(sim.run(600).done,32);assert.equal(sim.state.status,'completed');assert.equal(sim.state.supplies['cup-dispenser-stock'].consumed,1);
 const jaw=sim.trace.find(s=>s.tasks['left-grasp'].status==='running'&&s.grippers['left-gripper'].openingMm>100&&s.grippers['left-gripper'].openingMm<120);assert.ok(jaw);assert.equal(jaw.objects.cup.owner,null);assert.ok(sim.trace.some(s=>s.deviceSensors['cup-dispenser'].cupPresent));
 const data=sim.export(),again=await createExperiment(data.config,data.tasks,{policy:data.policy,record:false});again.run(600);assert.deepEqual(again.state,data.finalState);
});
test('shared API is a read-only configuration snapshot, excludes live commands and changes its identifier with profile edits',async()=>{
 const service=await createDeviceServer({world:base,config:{...structuredClone(profile),clock:{mode:'manual',rate:1}},port:0});
 try{const get=path=>fetch(service.url+path).then(r=>r.json()),before=await get('/api/state'),a=await get('/api/experiment-config');assert.equal(a.configurationSource.sessionId,before.sessionId);assert.equal(a.sharedDeviceConfig.devices.foamer.timing.durationSeconds,16);assert.equal(a.commands,undefined);assert.deepEqual(await get('/api/state'),before);
 const config=structuredClone(before.config.devices.foamer);config.timing.durationSeconds=22;const r=await fetch(service.url+'/api/devices/foamer/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:before.sessionId,configuration:config})});assert.ok(r.ok);const b=await get('/api/experiment-config');assert.notEqual(a.configurationSource.configurationId,b.configurationSource.configurationId);assert.equal(b.devices.foamer.duration,22);assert.equal(a.devices.foamer.duration,16);
 }finally{await service.close();}
});
