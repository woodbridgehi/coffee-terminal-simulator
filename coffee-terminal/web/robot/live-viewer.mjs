import { CoffeeScene } from './scene.mjs';
import { createLivePlan, livePosition, sampleSequence, normalizeSteps } from './live-plan.mjs';
import { createSequence } from './sequence.mjs';
import { SnapshotGate } from './live-snapshot.mjs';
import { PlaybackClock } from './playback-clock.mjs';

const names = { IDLE:'等待订单',CREATED:'等待支付',AWAITING_PAYMENT:'等待支付',QUEUED:'订单排队中',
  DISPATCHED:'等待设备接单',ACCEPTED:'设备已接单',ACKNOWLEDGED:'设备已接单',RUNNING:'正在制作',
  PAUSED:'制作已暂停',RETRY_WAIT:'等待重试',HOLD:'等待核查',SUCCEEDED:'制作完成，请取杯',
  FAILED:'制作失败',CANCELLED:'订单已取消',REFUNDED:'订单已退款',EXPIRED:'订单已过期' };

export function mount(root) {
  const canvasHost = root.querySelector('.rv-canvas'), labelHost = root.querySelector('.rv-labels');
  const scene = new CoffeeScene(canvasHost,labelHost);
  scene.renderer.setPixelRatio(Math.min(devicePixelRatio || 1,1.25));
  scene.renderer.shadowMap.enabled = canvasHost.clientWidth > 600;
  const idle = sampleSequence(createSequence(),0);
  scene.apply(idle); scene.cup.group.visible=false;
  let plan=null, signature='', snapshot=null, updatedAt=0, alive=true, raf;
  const clock=new PlaybackClock();
  const gate=new SnapshotGate();
  function renderInfo() {
    if (!snapshot) return;
    const stale = snapshot.state === 'RUNNING' && performance.now()-updatedAt > (snapshot.source === 'terminal' ? 4000 : 12000);
    const status = snapshot.collected ? '顾客已取杯' : !snapshot.connected || stale ? '等待状态同步 · 动作已停留' : names[snapshot.state] || snapshot.state;
    root.querySelector('.rv-state').textContent = status;
    root.querySelector('.rv-title').textContent = snapshot.name || '咖啡机器人';
    root.querySelector('.rv-progress').textContent = `${Math.round(Math.max(0,Math.min(1,snapshot.overallProgress))*100)}%`;
    let step = snapshot.steps.find((s)=>s.stepId===snapshot.stepId) || snapshot.steps[snapshot.stepIndex || 0];
    root.querySelector('.rv-step').textContent = !plan && snapshot.taskId ? '设备尚未提供三维步骤计划，请查看二维进度。' : step?.stepName || '接单后自动同步制作动作';
  }
  function update(next) {
    if (!alive || !gate.accept(next)) return;
    const newTask = next.taskId !== snapshot?.taskId;
    snapshot=next; updatedAt=performance.now();
    const nextSignature=JSON.stringify(next.steps);
    const changed=signature !== nextSignature;
    if (changed || newTask) {
      signature=nextSignature;
      try { plan=normalizeSteps(next.steps) ? createLivePlan(next.steps) : null; }
      catch(error) { plan=null; console.warn('三维计划未通过运动校验:',error.message); }
    }
    if (plan && snapshot.taskId) {
      const target=livePosition(snapshot,plan);
      // Smooth only BETWEEN reported states. Never predict completion or extrapolate.
      clock.update(target,performance.now(),{snap:newTask || changed || snapshot.state !== 'RUNNING' || !snapshot.connected});
      scene.cup.group.visible=!snapshot.collected;
    } else {
      scene.apply(idle); scene.cup.group.visible=false; clock.update(0,performance.now(),{snap:true});
    }
    const list=root.querySelector('.rv-materials'); list.replaceChildren();
    const step=next.steps.find((s)=>s.stepId===next.stepId) || next.steps[next.stepIndex || 0];
    for (const item of step?.visual?.materials || []) {
      const row=document.createElement('li');
      const stock=next.inventory.find((s)=>s.materialId===item.materialId);
      row.textContent=`${item.name || item.materialId} · 本步配方 ${item.amount} ${item.unit}`+
        (stock ? ` · 库存 ${stock.onHand} ${stock.unit} · 预占 ${stock.reserved} ${stock.unit}` : '');
      list.append(row);
    }
    renderInfo();
  }
  const frame=(now)=>{
    if (!alive) return;
    try {
    if (!document.hidden) {
      if (plan && snapshot?.taskId) {
        scene.apply(sampleSequence(plan,clock.sample(now)));
        // A held/failed order never presents a success-only pickup signal.
        if(snapshot.state!=='SUCCEEDED') scene.cell.pads.pickup.material.emissive.set('#000000');
      }
      scene.render(); renderInfo();
    }
    } catch {
      alive=false;
      root.querySelector('.rv-step').textContent='当前动作无法显示，请返回二维查看制作进度。';
      return;
    }
    raf=requestAnimationFrame(frame);
  };
  raf=requestAnimationFrame(frame);
  const buttons=root.querySelectorAll('[data-rv-view]');
  for(const button of buttons) button.setAttribute('aria-pressed',String(button.dataset.rvView===scene.view));
  for(const button of buttons) button.onclick=()=>{
    scene.setView(button.dataset.rvView);
    buttons.forEach((b)=>b.setAttribute('aria-pressed',String(b===button)));
  };
  scene.renderer.domElement.addEventListener('webglcontextlost',(event)=>{
    event.preventDefault();alive=false;cancelAnimationFrame(raf);
    root.querySelector('.rv-step').textContent='图形显示已中断，请关闭三维后重新打开；二维进度仍可使用。';
  });
  return {update,audioPosition(now){return snapshot && {taskId:snapshot.taskId,attempt:snapshot.attempt,position:clock.sample(now)};},dispose(){alive=false;cancelAnimationFrame(raf);scene.dispose();canvasHost.replaceChildren();labelHost.replaceChildren();}};
}
window.CoffeeRobotLive={mount};
