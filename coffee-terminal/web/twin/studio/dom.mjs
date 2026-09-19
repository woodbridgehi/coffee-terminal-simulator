// Patch live values without replacing focused buttons or scroll containers every tick.
export function patchMarkup(host,html){
  const template=document.createElement('template');template.innerHTML=html;
  function patch(parent,incoming){
    for(let i=0;i<incoming.childNodes.length;i++){
      const next=incoming.childNodes[i],current=parent.childNodes[i];
      if(!current){parent.append(next.cloneNode(true));continue;}
      if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.replaceWith(next.cloneNode(true));continue;}
      if(next.nodeType===3){if(current.textContent!==next.textContent)current.textContent=next.textContent;continue;}
      if(next.nodeType!==1)continue;
      for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
      for(const attr of next.attributes)if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
      patch(current,next);
    }
    while(parent.childNodes.length>incoming.childNodes.length)parent.lastChild.remove();
  }
  patch(host,template.content);
}
