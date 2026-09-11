import {createLivePlan,livePosition,normalizeSteps} from './live-plan.mjs';
import {PlaybackClock} from './playback-clock.mjs';
import {SnapshotGate} from './live-snapshot.mjs';
import {soundTrack,ActionSoundTrack} from './sound-track.mjs';

export class ProcessAudio {
  constructor(sound,{visualPosition=()=>null,now=()=>performance.now()}={}) {
    this.sound=sound;this.visualPosition=visualPosition;this.now=now;
    this.clock=new PlaybackClock();this.gate=new SnapshotGate();this.track=new ActionSoundTrack(sound);
    this.snapshot=null;this.signature='';this.plan=null;this.updatedAt=0;this.baseline=true;
  }
  update(next) {
    if(!this.gate.accept(next))return;
    const previous=this.snapshot, signature=JSON.stringify(next.steps);
    const changed=this.signature!==signature || previous?.taskId!==next.taskId;
    this.snapshot=next;this.updatedAt=this.now();
    if(changed) {
      this.signature=signature;
      try {this.plan=normalizeSteps(next.steps)?createLivePlan(next.steps,{motion:false}):null;}catch{this.plan=null;}
      this.cues=this.plan?soundTrack(this.plan):null;
    }
    const reset=changed || !previous?.connected || next.attempt!==previous?.attempt || previous?.state!=='RUNNING' || next.state!=='RUNNING' || !next.connected;
    if(this.plan)this.clock.update(livePosition(next,this.plan),this.updatedAt,{snap:reset});
    if(reset){this.baseline=true;this.track.reset();}
  }
  frame(now=this.now()) {
    const s=this.snapshot;
    if(!s || !this.plan){this.track.reset();return;}
    const visual=this.visualPosition(now);
    const useVisual=visual?.taskId===s.taskId && visual?.attempt===s.attempt;
    if(useVisual!==this.usingVisual){this.baseline=true;this.usingVisual=useVisual;}
    const position=useVisual?visual.position:this.clock.sample(now);
    const fresh=now-this.updatedAt<(s.source==='terminal'?4000:12000);
    const running=s.state==='RUNNING' && s.connected && fresh && !s.collected && !globalThis.document?.hidden;
    this.track.update({id:s.taskId,attempt:s.attempt,position,track:this.cues,running,baseline:this.baseline});
    this.baseline=false;
    if(!running)this.baseline=true;
  }
  disconnect(){this.snapshot=null;this.gate.snapshot=null;this.baseline=true;this.track.reset();}
  dispose(){this.disconnect();this.plan=null;this.cues=null;}
}
if(globalThis.document) globalThis.CoffeeProcessAudio={ProcessAudio};
