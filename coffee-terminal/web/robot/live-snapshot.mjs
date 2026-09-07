export function terminalSnapshot(data) {
  const task = data?.runtime?.task;
  return { taskId: task?.taskId || null, revision: task?.revision || 0,
    state: task?.recoveryHold ? 'HOLD' : task?.state || 'IDLE',
    stepId: task?.recipe?.steps?.[task.stepIndex]?.id, stepIndex: task?.stepIndex || 0,
    stepProgress: task?.stepProgress || 0, overallProgress: task?.overallProgress || 0,
    steps: task?.stepPlan || [], name: task?.recipe?.name || '',
    connected: !data?.runtime?.override?.offline, source: 'terminal',
    inventory: data?.runtime?.inventory?.materials || [],
  };
}

export function orderSnapshot(order) {
  const job = order?.production;
  const stopped = ['HOLD','FAILED','CANCELLED','REFUNDED','EXPIRED'];
  const state = order?.status === 'READY' ? 'SUCCEEDED' : stopped.includes(order?.status) ? order.status :
    job?.status === 'EXECUTING' ? 'RUNNING' : job?.status || order?.status || 'IDLE';
  // Customer snapshots never contain payment credentials, order tokens or device inventory.
  return { taskId: job?.taskId || null, revision: job?.deviceRevision || 0,
    state, stepId: job?.currentStepId, stepProgress: job?.stepProgress || 0,
    overallProgress: job?.overallProgress || job?.progress || 0,
    steps: job?.robotView?.version === 1 ? job.robotView.steps : [],
    name: order?.product?.name || '', source:'order',connected:true,inventory:[] };
}

/** Reject stale progress for the same task; lifecycle states override equal revisions. */
export class SnapshotGate {
  snapshot = null;
  accept(next) {
    const old = this.snapshot;
    if (old?.taskId && old.taskId === next.taskId) {
      if (next.revision < old.revision) return false;
      if (['SUCCEEDED','FAILED','CANCELLED','REFUNDED','EXPIRED'].includes(old.state) && next.state === 'RUNNING') return false;
      if (next.revision === old.revision && ['HOLD','PAUSED','RETRY_WAIT'].includes(old.state) && next.state === 'RUNNING') return false;
    }
    this.snapshot = next; return true;
  }
}
