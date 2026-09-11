import {Vector3} from 'three/src/math/Vector3.js';

const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export function directorShot(seconds,state,aspect=1,finished=false){
  const scale=Math.max(1,1.25/Math.max(.6,aspect));
  const shop={position:[3.3*scale,1+4.1*scale,11.8*scale],target:[0,1.45,.15]};
  const wide={position:[3.5*scale,1+2.7*scale,5.8*scale],target:[0,1,.02]};
  if(seconds<8){const t=ease((seconds-1.5)/6.5);return {position:mix(shop.position,wide.position,t),target:mix(shop.target,wide.target,t)};}
  if(finished)return wide;
  const cup=state?.cup || [0,1.05,.1],art=state?.station==='latte-art' || state?.stream==='latte-art' || state?.rightMode==='pitcher';
  const target=[cup[0],cup[1]+.16,cup[2]];
  const orbit=Math.sin(seconds*.12)*.12;
  const zoom=Math.max(1,1/Math.max(.7,aspect));
  const position=[target[0]+(art?.55:(cup[0]<0?-.9:.9))+orbit,target[1]+(art?1.05:1.4)*zoom,target[2]+(art?1.4:2.5)*zoom];
  return {position,target};
}

export class DirectorCamera {
  constructor(scene,{reducedMotion=false,onChange=()=>{}}={}){
    this.scene=scene;this.enabled=!reducedMotion;this.onChange=onChange;this.seconds=0;this.previous=null;this.taskId=null;
    this.goalPosition=new Vector3();this.goalTarget=new Vector3();
    this.interrupt=()=>this.manual();
    scene.controls.addEventListener('start',this.interrupt);
    scene.renderer.domElement.addEventListener('pointerdown',this.interrupt);
    scene.renderer.domElement.addEventListener('wheel',this.interrupt,{passive:true});
    scene.preserveCameraOnResize=true;
  }
  manual(){if(!this.enabled)return;this.enabled=false;this.onChange(false);}
  resume(){this.enabled=true;this.seconds=8;this.previous=null;this.onChange(true);}
  update(now,state,{taskId,running=false,finished=false,connected=true}={}){
    const dt=this.previous===null?0:Math.max(0,Math.min(.1,(now-this.previous)/1000));this.previous=now;
    if(taskId!==this.taskId){this.taskId=taskId;this.seconds=0;}
    if(!this.enabled || !connected || (!running && !finished))return;
    this.seconds+=dt;
    const shot=directorShot(this.seconds,state,this.scene.camera.aspect,finished);
    this.goalPosition.set(...shot.position);this.goalTarget.set(...shot.target);
    const blend=1-Math.exp(-dt*.8);
    this.scene.controls.minDistance=.5;
    this.scene.camera.position.lerp(this.goalPosition,blend);
    this.scene.controls.target.lerp(this.goalTarget,blend);
  }
  dispose(){this.scene.controls.removeEventListener('start',this.interrupt);this.scene.renderer.domElement.removeEventListener('pointerdown',this.interrupt);this.scene.renderer.domElement.removeEventListener('wheel',this.interrupt);}
}
