const keyOf = ref => ref ? `${ref.kind}:${ref.id}` : '';

function statusFor(ref,state,taskRobots){
  if(!state) return '';
  if(ref.kind==='device') return state.devices?.[ref.id]?.mode ?? '';
  if(ref.kind==='gripper') return state.grippers?.[ref.id]?.mode ?? '';
  if(ref.kind==='object'){
    const object=state.objects?.[ref.id];
    if(!object) return '';
    if(object.present===false) return 'absent';
    return object.owner ? `held · ${object.owner}` : 'present';
  }
  if(ref.kind==='robot'){
    const running=Object.entries(state.tasks??{}).some(([id,t])=>t.status==='running'&&taskRobots.get(id)===ref.id);
    return running?'running':'ready';
  }
  return '';
}

export function mountSceneTree({host,selection,index,getState,labelFor,onFocus}){
  let unsubscribe=()=>{};
  const refsByKey=new Map();
  const taskRobots=new Map(index.all('task').filter(x=>x.task?.robot).map(x=>[x.id,x.task.robot]));

  function label(ref){
    return labelFor?.(ref,index.get(ref)) ?? ref.id;
  }

  function group(title,refs){
    const section=document.createElement('section');
    section.className='tree-group';
    const head=document.createElement('div');
    head.className='tree-group-title';
    head.textContent=title;
    section.append(head);
    const body=document.createElement('div');
    body.className='tree-group-body';
    for(const ref of refs){
      refsByKey.set(keyOf(ref),ref);
      const row=document.createElement('button');
      row.type='button';
      row.className='tree-row';
      row.dataset.selectionKey=keyOf(ref);
      row.dataset.kind=ref.kind;
      row.dataset.id=ref.id;
      const name=document.createElement('span');
      name.className='tree-name';
      name.textContent=label(ref);
      const meta=document.createElement('span');
      meta.className='tree-meta';
      meta.dataset.treeStatus='';
      row.append(name,meta);
      body.append(row);
    }
    section.append(body);
    return section;
  }

  function render(){
    refsByKey.clear();
    host.replaceChildren(
      group('ROBOTS',index.all('robot')),
      group('GRIPPERS',index.all('gripper')),
      group('DEVICES',index.all('device')),
      group('OBJECTS',index.all('object')),
      group('STATIONS',index.all('station'))
    );
    sync();
    update(getState?.());
  }

  function sync(){
    const current=selection.get();
    const selectedKey=keyOf(current);
    const related=new Set((index.related(current)||[]).map(keyOf));
    host.querySelectorAll('.tree-row').forEach(row=>{
      row.classList.toggle('selected',row.dataset.selectionKey===selectedKey);
      row.classList.toggle('related',related.has(row.dataset.selectionKey));
    });
  }

  function update(state){
    host.querySelectorAll('.tree-row').forEach(row=>{
      const ref=refsByKey.get(row.dataset.selectionKey);
      const value=statusFor(ref,state,taskRobots);
      const meta=row.querySelector('[data-tree-status]');
      if(meta) meta.textContent=value;
      row.dataset.status=value.split(' · ')[0];
    });
  }

  const click=event=>{
    const row=event.target.closest('.tree-row');
    if(!row) return;
    selection.select({kind:row.dataset.kind,id:row.dataset.id},'scene-tree');
  };
  const dblclick=event=>{
    const row=event.target.closest('.tree-row');
    if(!row) return;
    const ref={kind:row.dataset.kind,id:row.dataset.id};
    selection.select(ref,'scene-tree');
    onFocus?.(ref);
  };
  host.addEventListener('click',click);
  host.addEventListener('dblclick',dblclick);
  unsubscribe=selection.subscribe(sync);
  render();

  return {
    render,
    update,
    sync,
    dispose(){
      unsubscribe();
      host.removeEventListener('click',click);
      host.removeEventListener('dblclick',dblclick);
    }
  };
}
