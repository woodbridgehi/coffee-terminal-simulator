import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DeviceRuntime} from '../../coffee-terminal/web/twin/devices/runtime.mjs';
import {cupOnPad} from '../../coffee-terminal/web/twin/cup-sensor.mjs';
import {compose} from '../../coffee-terminal/web/twin/robot.mjs';
const base=JSON.parse(await readFile(new URL('../../config/twin/coffee-workcell-main-v2.json',import.meta.url)));
const config=JSON.parse(await readFile(new URL('../../config/twin/device-lab-v1.json',import.meta.url)));
const make=()=>DeviceRuntime.create(base,structuredClone(config));
test('pad sensor measures local radial position and bottom height; ignores preview/lifted cups and remains active during an in-place grasp',async()=>{
 const r=await make(),w=r.sim.config,s=r.sim.state,o=s.objects.cup;assert.equal(cupOnPad(w,s),false);
 o.present=true;assert.equal(cupOnPad(w,s),true);
 const station=w.stations.cups.pose,place=(x,z)=>{o.pose=compose(w.stations.cups.pose,{position:[x,0,z],quaternion:[0,0,0,1]});};
 place(.079,0);assert.equal(cupOnPad(w,s),true);place(.081,0);assert.equal(cupOnPad(w,s),false);place(0,.009);assert.equal(cupOnPad(w,s),false);place(0,0);o.owner='left';assert.equal(cupOnPad(w,s),true);place(0,.02);assert.equal(cupOnPad(w,s),false);o.owner=null;
 w.stations.cups.pose={position:[1,2,3],quaternion:[0,0,Math.SQRT1_2,Math.SQRT1_2]};place(.02,0);assert.equal(cupOnPad(w,s),true);
});
test('successful dispense publishes pad detection after sensor delay; overrides and disable are explicit',async()=>{
 const r=await make(),id='cup-dispenser';r.submit({sessionId:r.sessionId,commandId:'drop',deviceId:id,action:'dispense',parameters:{}});r.advance(30);assert.equal(r.device(id).sensors.cupPresent,false);
 while(r.command('drop').status!=='SUCCEEDED')r.advance(1);assert.equal(r.command('drop').result.sensors.cupPresent,true);assert.equal(r.device(id).sensors.cupPresent,false);r.advance(3);assert.equal(r.device(id).sensors.cupPresent,true);
 r.inject(id,{forcedSensors:{cupPresent:false}},r.sessionId);assert.equal(r.device(id).sensors.cupPresent,false);r.inject(id,{forcedSensors:{}},r.sessionId);assert.equal(r.device(id).sensors.cupPresent,true);
 const p=structuredClone(r.config.devices[id]);p.cupSensor.enabled=false;r.configure(id,p,r.sessionId);r.advance(4);assert.equal(r.device(id).sensors.cupPresent,false);assert.equal(r.device(id).sensors.cupSensorEnabled,false);
});
test('invalid sensor configuration rolls back and legacy profiles get the default pad detector',async()=>{
 const r=await make(),before=structuredClone(r.config),p=structuredClone(r.config.devices['cup-dispenser']);p.cupSensor.radiusMm=200;assert.throws(()=>r.configure('cup-dispenser',p,r.sessionId));assert.deepEqual(r.config,before);
 const c=structuredClone(config);delete c.devices['cup-dispenser'].cupSensor;const legacy=await DeviceRuntime.create(base,c);assert.equal(legacy.device('cup-dispenser').sensorCapabilities.cupPresent.configuration.radiusMm,80);
});
