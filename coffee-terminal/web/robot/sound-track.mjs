// Semantic presentation markers from the same segments as the robot, never from UI copy.
export function soundTrack(plan) {
  const markers=[], loops=[];
  plan.segments.forEach((s,index)=>{
    const id=`${s.stepId || s.stage}/${index}`;
    for(const side of ['Left','Right']) if(s.to['grip'+side] < s.from['grip'+side])
      markers.push({id:`${id}/grip-${side}`,at:s.end,kind:'grip'});
    if((s.from.owner && !s.to.owner) || (s.from.pitcherOwner && !s.to.pitcherOwner))
      markers.push({id:`${id}/place`,at:s.start,kind:'place'});
    if((s.to.ice || 0)>(s.from.ice || 0)) markers.push({id:`${id}/ice`,at:(s.start+s.end)/2,kind:'ice'});
    if(s.to.lid && !s.from.lid) markers.push({id:`${id}/lid`,at:(s.start+s.end)/2,kind:'lid'});
    if(s.stream) loops.push({id:`${id}/flow`,start:s.start,end:s.end,kind:s.stream==='coffee'?'brew':s.stream==='latte-art'?'milk':s.stream});
  });
  return {markers:markers.sort((a,b)=>a.at-b.at),loops};
}

export class ActionSoundTrack {
  constructor(sound) { this.sound=sound;this.highWater=new Map();this.previous=null; }
  reset() { this.previous=null;this.sound?.stopProcess(); }
  update({id,attempt=1,position,track,running,baseline=false}) {
    const key=JSON.stringify([id,attempt]);
    if(!id || !Number.isFinite(position)) {this.reset();return;}
    const old=this.previous;
    const floor=this.highWater.get(key) ?? -1;
    this.previous={key,position};
    this.highWater.set(key,Math.max(floor,position));
    if(this.highWater.size>16)this.highWater.delete(this.highWater.keys().next().value);
    const silent=baseline || !old || old.key!==key || position<old.position || !running;
    // Consume historical and muted markers; never burst-play a backlog after a seek.
    const passed=track.markers.filter(m=>m.at>floor && m.at<=position);
    for(const m of passed) {
      const fresh=this.sound?.mark(`action:${key}:${m.id}`);
      if(fresh && !silent && m.at>old.position && position-m.at<.25) this.sound?.playAction(m.kind);
    }
    const loop=running && !baseline ? track.loops.find(l=>position>=l.start && position<l.end) : null;
    this.sound?.setProcessLoop(loop?`${key}:${loop.id}`:null,loop?.kind);
  }
}
