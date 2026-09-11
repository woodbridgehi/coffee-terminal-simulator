/** One grace period per visible successful task; state polling does not postpone it. */
export class CompletionClose {
  constructor(close,{schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}={}){this.close=close;this.schedule=schedule;this.cancel=cancel;this.timer=null;this.key=null;}
  update(snapshot,open){
    const key=open && snapshot?.source==='terminal' && snapshot.state==='SUCCEEDED' && snapshot.taskId;
    if(!key){this.clear();return;}
    if(this.key===key)return;
    this.clear();this.key=key;
    this.timer=this.schedule(()=>{this.timer=null;this.close();},3000);
  }
  clear(){if(this.timer!==null)this.cancel(this.timer);this.timer=null;this.key=null;}
}
