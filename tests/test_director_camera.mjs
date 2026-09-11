import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three/src/math/Vector3.js';
import {DirectorCamera,directorShot} from '../coffee-terminal/web/robot/director-camera.mjs';
const state={cup:[.7,1.05,-.68],station:'milk'};
function setup(reducedMotion=false){
  const controlEvents=new EventTarget(),canvas=new EventTarget();
  const scene={camera:{position:new Vector3(3.3,5.1,11.8),aspect:1.5},controls:Object.assign(controlEvents,{target:new Vector3(0,1.45,.15)}),renderer:{domElement:canvas}};
  return {scene,director:new DirectorCamera(scene,{reducedMotion}),canvas};
}
test('wide introduction, bounded close-up and all station targets remain finite',()=>{
  assert.ok(directorShot(0,state).position[2]>directorShot(7,state).position[2]);
  for(const cup of [[-1.7,1.05,.05],[-1.1,1.05,-.68],[1.46,1.05,-.68],[-.04,1.22,.4]])for(const aspect of [.5,1,2]){
    const shot=directorShot(15,{cup},aspect);assert.ok([...shot.position,...shot.target].every(Number.isFinite));
    assert.ok(shot.position[1]>cup[1] && shot.position[2]>cup[2]);
  }
});
test('camera moves smoothly, yields to gestures, resumes without snapping, and freezes on pause',()=>{
  const {scene,director,canvas}=setup();const options={taskId:'one',running:true,connected:true};
  for(let n=0;n<600;n++){const before=scene.camera.position.clone();director.update(n*30,state,options);assert.ok(before.distanceTo(scene.camera.position)<.3);}
  assert.ok(scene.camera.position.z<5);
  canvas.dispatchEvent(new Event('pointerdown'));assert.equal(director.enabled,false);
  const fixed=scene.camera.position.clone();director.update(19000,state,options);assert.ok(fixed.equals(scene.camera.position));
  director.resume();director.update(20000,state,options);assert.ok(fixed.equals(scene.camera.position));
  director.update(20030,state,{...options,running:false});assert.ok(fixed.equals(scene.camera.position));
  director.update(20060,state,{...options,connected:false});assert.ok(fixed.equals(scene.camera.position));
  director.dispose();
});
test('reduced motion starts in manual mode; explicit master button can enable it',()=>{
  const {director}=setup(true);assert.equal(director.enabled,false);director.resume();assert.equal(director.enabled,true);director.dispose();
});
