import test from 'node:test';
import assert from 'node:assert/strict';
import {dispensePresentation,devicePhase} from '../../coffee-terminal/web/twin/effect-state.mjs';
const state=p=>({devices:{cup:{mode:'running',task:'drop',remaining:2*(1-p)}},tasks:{drop:{status:'running',elapsed:2*p}}});
test('dispense presentation separates, drops and settles from simulation time without creating inventory',()=>{
 const a=dispensePresentation(state(.1),'cup'),b=dispensePresentation(state(.5),'cup'),c=dispensePresentation(state(.9),'cup');
 assert.equal(a.phase,'分杯');assert.equal(a.height,.24);assert.equal(b.phase,'下落');assert.ok(b.height>0&&b.height<a.height);assert.equal(c.phase,'到位确认');assert.equal(c.height,0);
 const frozen=state(.5),before=structuredClone(frozen);assert.deepEqual(dispensePresentation(frozen,'cup'),dispensePresentation(frozen,'cup'));assert.deepEqual(frozen,before);
 frozen.devices.cup.mode='fault';assert.equal(dispensePresentation(frozen,'cup'),null);
});
test('process animation progress uses actual task duration, including custom doses',()=>{assert.equal(devicePhase(state(.5),'cup'),.5);const s=state(.5);s.tasks.drop.status='done';assert.equal(devicePhase(s,'cup'),null);});
