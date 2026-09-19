export function bindTimeline({host,selection,index,onFocus}){
  let unsubscribe=()=>{};

  function sync(){
    const current=selection.get();
    const relatedTasks=new Set(index.relatedTasks(current));
    host.querySelectorAll('[data-task-id]').forEach(row=>{
      const id=row.dataset.taskId;
      row.classList.toggle('task-selected',current?.kind==='task'&&current.id===id);
      row.classList.toggle('task-related',!(current?.kind==='task'&&current.id===id)&&relatedTasks.has(id));
    });
  }

  const click=event=>{
    const row=event.target.closest('[data-task-id]');
    if(!row) return;
    selection.select({kind:'task',id:row.dataset.taskId},'timeline');
  };
  const dblclick=event=>{
    const row=event.target.closest('[data-task-id]');
    if(!row) return;
    const ref={kind:'task',id:row.dataset.taskId};
    selection.select(ref,'timeline');
    onFocus?.(ref);
  };
  host.addEventListener('click',click);
  host.addEventListener('dblclick',dblclick);
  unsubscribe=selection.subscribe(sync);

  return {sync,dispose(){unsubscribe();host.removeEventListener('click',click);host.removeEventListener('dblclick',dblclick);}};
}
