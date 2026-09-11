/* Recipe editor helper. Saving still uses the existing validated catalogue API. */
(function(root) {
  function addSpiral(recipe) {
    const r=JSON.parse(JSON.stringify(recipe));
    if(r.optionSchema?.temperature!=='HOT' || !r.optionSchema.options?.milk) throw new Error('请先配置热饮与奶量选项');
    if(!Array.isArray(r.steps) || r.steps.some(s=>s.robotActions?.includes('latte-art') || s.latteArt)) throw new Error('配方已包含拉花或步骤无效');
    if(r.steps.some(s=>s.robotActions?.includes('ice'))) throw new Error('首版拉花不支持含冰配方');
    const milk=r.steps.find(s=>s.customizationRole==='milk' && s.robotActions?.length===1 && s.robotActions[0]==='milk' && s.consumes?.length===1 && s.consumes[0].materialId==='milk' && s.consumes[0].unit==='ml' && s.consumes[0].amount>20);
    if(!milk) throw new Error('需要一个超过 20 ml 的独立加奶步骤，以拆分奶泡用量');
    const end=r.steps.findIndex(s=>s.robotActions?.some(a=>['lid','pickup'].includes(a)));
    const index=end<0?r.steps.length:end;
    if(!r.steps.slice(0,index).some(s=>s.robotActions?.includes('brew')) || r.steps.indexOf(milk)>=index) throw new Error('萃取和加奶必须在封盖、出杯之前');
    const id='latte-art'; if(r.steps.some(s=>s.id===id)) throw new Error('latte-art 步骤 ID 已使用');
    milk.consumes[0].amount=Math.round((milk.consumes[0].amount-20)*1000)/1000;
    r.steps.splice(index,0,{id,name:'螺旋拉花',durationSeconds:30,robotActions:['latte-art'],
      latteArt:{patternId:'spiral',patternVersion:'1.0.0'},customizationRole:'milk',dispenseChannel:'foam-pitcher',
      consumes:[{materialId:'milk',amount:20,unit:'ml'}]});
    if(/^\d+\.\d+\.\d+$/.test(r.version)) {const v=r.version.split('.').map(Number);r.version=`${v[0]}.${v[1]+1}.0`;}
    else throw new Error('请先使用 major.minor.patch 格式的配方版本');
    return r;
  }
  root.CoffeeRecipeActions={addSpiral};
  if(typeof module!=='undefined') module.exports={addSpiral};
})(globalThis);
