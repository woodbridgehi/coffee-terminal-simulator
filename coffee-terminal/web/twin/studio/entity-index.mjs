const keyOf = ref => ref ? `${ref.kind}:${ref.id}` : '';

export function createEntityIndex(config, tasks = []) {
  const entities = new Map();
  const links = new Map();
  const taskIds = new Set();

  const add = (kind, id, data = {}) => {
    if (id === undefined || id === null) return null;
    const ref = {kind, id: String(id)};
    const key = keyOf(ref);
    if (!entities.has(key)) entities.set(key, {...ref, ...data});
    else Object.assign(entities.get(key), data);
    if (!links.has(key)) links.set(key, new Set());
    return ref;
  };

  const link = (a, b) => {
    if (!a || !b) return;
    const ka = keyOf(a), kb = keyOf(b);
    if (!entities.has(ka) || !entities.has(kb) || ka === kb) return;
    links.get(ka).add(kb);
    links.get(kb).add(ka);
  };

  const known=(kind,id)=>entities.has(keyOf({kind,id:String(id)}))?{kind,id:String(id)}:null;

  for (const [id, robot] of Object.entries(config.robots ?? {})) add('robot', id, {config: robot});
  for (const [id, gripper] of Object.entries(config.grippers ?? {})) {
    const gr = add('gripper', id, {config: gripper, robot: gripper.robot});
    link(gr, known('robot', gripper.robot));
  }
  for (const [id, station] of Object.entries(config.stations ?? {})) add('station', id, {config: station});
  for (const [id, device] of Object.entries(config.devices ?? {})) {
    const dev = add('device', id, {config: device, station: device.station});
    link(dev, known('station', device.station));
  }
  for (const [id, object] of Object.entries(config.objects ?? {})) add('object', id, {config: object});

  const grippersByRobot = new Map();
  for (const [id, gripper] of Object.entries(config.grippers ?? {})) {
    if (!grippersByRobot.has(gripper.robot)) grippersByRobot.set(gripper.robot, []);
    grippersByRobot.get(gripper.robot).push(id);
  }

  for (const task of tasks) {
    const taskRef = add('task', task.id, {task});
    taskIds.add(task.id);
    const related = [];
    if (task.robot) related.push(known('robot', task.robot));
    if (task.device) related.push(known('device', task.device));
    if (task.object) related.push(known('object', task.object));
    if (task.source) related.push(known('object', task.source));
    const station=task.station??config.devices?.[task.device]?.station;
    if (station) related.push(known('station', station));
    if (task.robot && ['grasp', 'release'].includes(task.type)) {
      for (const id of grippersByRobot.get(task.robot) ?? []) related.push(add('gripper', id, {config: config.grippers?.[id], robot: task.robot}));
    }
    for (const grasp of task.allowedGrasps ?? []) {
      if (grasp.robot) related.push(known('robot', grasp.robot));
      if (grasp.object) related.push(known('object', grasp.object));
    }
    for (const ref of related) link(taskRef, ref);
  }

  return {
    keyOf,

    has(ref) {
      return !!ref && entities.has(keyOf(ref));
    },

    get(ref) {
      return ref ? entities.get(keyOf(ref)) ?? null : null;
    },

    all(kind) {
      return [...entities.values()].filter(entity => !kind || entity.kind === kind);
    },

    related(ref) {
      if (!ref) return [];
      return [...(links.get(keyOf(ref)) ?? [])].map(key => entities.get(key)).filter(Boolean);
    },

    relatedTasks(ref) {
      if (!ref) return [];
      if (ref.kind === 'task') return taskIds.has(ref.id) ? [ref.id] : [];
      return [...(links.get(keyOf(ref)) ?? [])]
        .map(key => entities.get(key))
        .filter(entity => entity?.kind === 'task')
        .map(entity => entity.id);
    }
  };
}
