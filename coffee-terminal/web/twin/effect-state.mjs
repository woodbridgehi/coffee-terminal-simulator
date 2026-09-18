// Pure, deterministic presentation phases; never changes device state.
export function devicePhase(state,id){
 const d=state.devices[id],t=state.tasks[d?.task];if(d?.mode!=='running'||!t||t.status!=='running')return null;
 return Math.max(0,Math.min(1,t.elapsed/Math.max(.0001,t.elapsed+d.remaining)));
}
export function dispensePresentation(state,id){
 const p=devicePhase(state,id);if(p===null)return null;
 const fall=Math.max(0,Math.min(1,(p-.25)/.55));
 return {progress:p,height:.24*(1-fall*fall),phase:p<.25?'分杯':p<.8?'下落':'到位确认'};
}
