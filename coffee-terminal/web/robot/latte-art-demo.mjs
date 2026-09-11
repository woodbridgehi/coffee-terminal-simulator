import {createLivePlan} from './live-plan.mjs';
import {PATTERN} from './latte-art.mjs';
export const DEMO_STEPS=[
  ['取杯',8,'cups',[]],['萃取',28,'brew',[{materialId:'water',amount:45,unit:'ml'}]],
  ['加奶',20,'milk',[{materialId:'milk',amount:160,unit:'ml'}]],
  ['拉花',30,'latte-art',[{materialId:'milk',amount:20,unit:'ml'}]],
  ['出杯',12,'pickup',[]],
].map(([stepName,durationSeconds,action,materials],i)=>({stepId:`demo-${i}`,stepName,durationSeconds,
  visual:{version:1,actions:[action],materials,liquidReferenceMl:225,...(action==='latte-art'?{latteArt:PATTERN}:{})}}));
export function createLatteArtDemo() {
  return {...createLivePlan(DEMO_STEPS),recipeId:'spiral',recipe:{name:'UR 双臂拉花拿铁',detail:'UR10e × 2 · 螺旋拉花 · 预制奶泡仿真',stages:DEMO_STEPS.map(s=>s.stepName)}};
}
