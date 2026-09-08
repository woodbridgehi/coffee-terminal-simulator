import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackClock} from '../coffee-terminal/web/robot/playback-clock.mjs';

test('a five second report is not compressed into 600ms',()=>{
  const c=new PlaybackClock(); c.update(0,0,{snap:true}); c.update(5,5000);
  for(let t=5010;t<=5600;t+=10)c.sample(t);
  assert.ok(c.position<=.76);
  for(let t=5610;t<=11000;t+=10)c.sample(t);
  assert.equal(c.position,5); // Never extrapolate beyond the confirmed target.
});
test('pause, retry, new task and background tab cannot continue an old blend',()=>{
  const c=new PlaybackClock(); c.update(10,0);
  c.sample(100); c.update(2,100,{snap:true});
  assert.equal(c.sample(2000),2);
  c.update(0,2000,{snap:true}); assert.equal(c.sample(2010),0);
  c.update(10,2010); assert.ok(c.sample(60000)<=.3125);
});
