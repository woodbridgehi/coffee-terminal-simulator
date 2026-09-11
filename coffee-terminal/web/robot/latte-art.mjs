import { Quaternion, Vector3 } from 'three';
import { UPRIGHT } from './kinematics.mjs';

export const PATTERN = Object.freeze({patternId:'spiral',patternVersion:'1.0.0'});
export const ART_CUP = [-.04,1.22,.40];
export const PITCHER_HOME = [.44,1.025,.70];
export const PITCHER_GRASP = [.175,0,0];
export const SPOUT = [-.0975,.063,0];
export function spiralPoint(progress) {
  const t=Math.max(0,Math.min(1,progress)), r=.003+.032*t, angle=t*Math.PI*5;
  return [Math.cos(angle)*r,0,Math.sin(angle)*r];
}
// The cup-relative landing point drives both the pitcher spout and foam drawing.
export function pouringPose(cup,fill,progress,tilt=.95,height=.035,cupOrientation=[0,0,0,1]) {
  const local=new Vector3(...spiralPoint(progress)).applyQuaternion(new Quaternion(...cupOrientation)).toArray(), landing=[cup[0]+local[0],cup[1]-.074+fill*.15,cup[2]+local[2]];
  const spout=[landing[0],landing[1]+height,landing[2]];
  const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),tilt);
  const offset=new Vector3(...SPOUT).applyQuaternion(rotation);
  return {right:new Vector3(...spout).sub(offset).add(new Vector3(...PITCHER_GRASP).applyQuaternion(rotation)).toArray(),
    rightOrientation:rotation.clone().multiply(new Quaternion(...UPRIGHT)).toArray(),
    pitcherOrientation:rotation.toArray(), spout,landing};
}
export function validPattern(value) {
  return value && value.patternId===PATTERN.patternId && value.patternVersion===PATTERN.patternVersion;
}
