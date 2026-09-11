import test from 'node:test';
import assert from 'node:assert/strict';
import {CompletionClose} from '../coffee-terminal/web/robot/completion-close.mjs';
test('successful terminal task closes after 3 seconds without resetting on repeated polls',()=>{
  let callback,delay,scheduled=0,closed=0,cancelled=0;
  const c=new CompletionClose(()=>closed++,{schedule(fn,ms){callback=fn;delay=ms;return ++scheduled;},cancel(){cancelled++;}});
  const s={source:'terminal',taskId:'A',state:'RUNNING'};
  c.update(s,true);assert.equal(scheduled,0);
  s.state='SUCCEEDED';c.update(s,true);c.update({...s},true);
  assert.equal(scheduled,1);assert.equal(delay,3000);callback();assert.equal(closed,1);
  c.clear();c.update(s,true);c.clear();assert.equal(cancelled,1);
  c.update({...s,taskId:'B'},true);c.update({...s,state:'FAILED'},true);assert.equal(cancelled,2);
  c.update({...s,source:'order'},true);c.update(s,false);assert.equal(scheduled,3);
});
