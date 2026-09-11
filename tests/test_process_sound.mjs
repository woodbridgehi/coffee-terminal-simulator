import test from 'node:test';
import assert from 'node:assert/strict';
import {soundTrack,ActionSoundTrack} from '../coffee-terminal/web/robot/sound-track.mjs';
import {createLivePlan} from '../coffee-terminal/web/robot/live-plan.mjs';
import {ProcessAudio} from '../coffee-terminal/web/robot/process-audio.mjs';
import {orderSnapshot,terminalSnapshot} from '../coffee-terminal/web/robot/live-snapshot.mjs';
const steps=['cups','brew','water','milk','ice','lid','pickup'].map((a,i)=>({stepId:a,stepName:'renamable-'+i,durationSeconds:20,visual:{version:1,actions:[a],materials:[]}}));
function fake(){const played=[],seen=new Set();return {played,seen,mark(k){if(seen.has(k))return false;seen.add(k);return true;},playAction(k){played.push(k);},setProcessLoop(key,kind){this.loop=key?{key,kind}:null;},stopProcess(){this.loop=null;}};}
test('semantic cues follow actual grip, cup, ice, lid and stream intervals',()=>{
 const plan=createLivePlan(steps,{motion:false}),track=soundTrack(plan);
 assert.deepEqual(new Set(track.markers.map(m=>m.kind)),new Set(['grip','place','ice','lid']));
 assert.deepEqual(track.loops.map(l=>l.kind),['brew','water','milk']);
 assert.equal(new Set(track.markers.map(m=>m.id)).size,track.markers.length);
 assert.ok(track.markers.every(m=>m.at>=0 && m.at<=plan.duration));
 const renamed=createLivePlan(steps.map(s=>({...s,stepName:'new name'})),{motion:false});
 assert.deepEqual(soundTrack(renamed),track);
});
test('same attempt cannot replay on duplicate, backward seek, pause or reconnect; retry is separate',()=>{
 const sound=fake(),player=new ActionSoundTrack(sound),track={markers:[{id:'close',at:1,kind:'grip'}],loops:[{id:'brew',start:2,end:4,kind:'brew'}]};
 const frame=(position,extra={})=>player.update({id:'task',attempt:1,position,track,running:true,...extra});
 frame(0);frame(1.01);frame(1.01);frame(0);frame(1.01);assert.deepEqual(sound.played,['grip']);
 frame(2.1);assert.equal(sound.loop.kind,'brew');frame(2.2,{running:false});assert.equal(sound.loop,null);
 player.reset();frame(2.2);assert.deepEqual(sound.played,['grip']);
 frame(0,{attempt:2});frame(1.01,{attempt:2});assert.deepEqual(sound.played,['grip','grip']);
 frame(4.1,{attempt:2});assert.equal(sound.loop,null);
});
test('initial snapshots and large jumps consume markers without burst playback',()=>{
 const sound=fake(),player=new ActionSoundTrack(sound),track={markers:[{id:'a',at:1,kind:'place'},{id:'b',at:2,kind:'ice'}],loops:[]};
 player.update({id:'task',position:1.1,track,running:true});player.update({id:'task',position:4,track,running:true});
 assert.equal(sound.played.length,0);assert.equal(sound.seen.size,2);
});
test('controller stops loops on stale data, disconnect and stopped authoritative states',()=>{
 const sound=fake();let now=0;const controller=new ProcessAudio(sound,{now:()=>now});
 const plan=createLivePlan(steps,{motion:false}),loop=soundTrack(plan).loops[0];
 const range=plan.ranges[1],position=(loop.start+loop.end)/2;
 const snap={taskId:'task',attempt:1,revision:1,state:'RUNNING',connected:true,source:'terminal',steps,stepId:'brew',stepProgress:(position-range.start)/(range.end-range.start)};
 controller.update(snap);controller.frame();now=20;controller.frame();assert.equal(sound.loop.kind,'brew');
 now=4500;controller.frame();assert.equal(sound.loop,null);assert.equal(sound.played.length,0);
 for(const state of ['PAUSED','RETRY_WAIT','FAILED','HOLD','SUCCEEDED','CANCELLED']){
  controller.update({...snap,revision:++snap.revision,state});controller.frame();assert.equal(sound.loop,null);
 }
 controller.disconnect();assert.equal(sound.loop,null);
});
test('both projections use the authoritative retry attempt and old plans default to one',()=>{
 assert.equal(terminalSnapshot({runtime:{task:{attempt:3}}}).attempt,3);
 assert.equal(orderSnapshot({production:{attempt:4}}).attempt,4);
 assert.equal(orderSnapshot({}).attempt,1);
});
