import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const root=vm.createContext({});
vm.runInContext(readFileSync(new URL('../coffee-terminal/web/terminal-sound.js',import.meta.url),'utf8'),root);
test('terminal defaults to full volume and retries blocked playback on interaction',async()=>{
  let calls=0;
  const sound={enabled:false,setVolume(v){this.volume=v;},async enable(){this.enabled=++calls>1;},mute(){this.enabled=false;},disconnect(){}};
  const p=new root.TerminalSoundPreferences(sound);
  assert.equal(p.enabled,true);assert.equal(sound.volume,1);
  await p.activate();assert.equal(sound.enabled,false);
  await p.activate();assert.equal(sound.enabled,true);
  await p.toggle(false);await p.activate();assert.equal(calls,2);assert.equal(sound.enabled,false);
  await p.visibility(false);await p.visibility(true);assert.equal(calls,2);
  await p.toggle(true);await p.visibility(false);assert.equal(sound.enabled,false);
  await p.visibility(true);assert.equal(sound.enabled,true);
});
