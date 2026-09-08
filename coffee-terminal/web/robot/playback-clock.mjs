// Follow confirmed progress at a bounded speed; never predict the next step.
export class PlaybackClock {
  constructor() { this.position=0; this.target=0; this.at=null; }
  update(target, now, {snap=false}={}) {
    this.sample(now);
    if (snap || target<this.position) this.position=target;
    this.target=target;
    this.at=now;
  }
  sample(now) {
    if (this.at===null) { this.at=now; return this.position; }
    // A resumed background tab must not fast-forward several seconds in one frame.
    const dt=Math.max(0,Math.min(.25,(now-this.at)/1000));
    this.at=now;
    const gap=Math.max(0,this.target-this.position);
    const speed=gap>2 ? 1.25 : 1;
    this.position=Math.min(this.target,this.position+dt*speed);
    return this.position;
  }
}
