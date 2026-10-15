// Visible checkpoints share the backend's actual transfer state, without actions.
function hasSameOriginDevelopmentParent(){
  try{return window.parent!==window&&window.parent.location.origin===location.origin;}
  catch{return false;}
}
if (!hasSameOriginDevelopmentParent()) {
  const host=document.createElement('details');
  host.className='nexen-development';
  host.innerHTML='<summary>Development status <span data-dev-label>Loading…</span></summary><div><p data-dev-detail></p><p data-dev-transfer></p><ul data-dev-steps></ul><small data-dev-time></small><nav><a href="/storage" target="_top">Storage + models</a><a href="/next" target="_top">Next task</a><a href="/connections" target="_top">Needs you</a></nav></div>';
  const css=document.createElement('style');
  css.textContent='.nexen-development{box-sizing:border-box;border:1px solid #83caff48;border-radius:14px;background:linear-gradient(120deg,#183b58e8,#091c32ed);color:#dcefff;font:13px/1.5 system-ui;margin:12px 0;padding:12px 16px}.nexen-development summary{cursor:pointer;font-weight:700}.nexen-development summary span{font-weight:400;color:#a8d9ff;margin-left:10px}.nexen-development p{margin:8px 0}.nexen-development small{display:block;color:#a6b9cc}.nexen-development nav{display:flex;gap:15px;flex-wrap:wrap;margin-top:10px}.nexen-development a{color:#bceaff}.nexen-development ul{padding-left:20px}.nexen-development[data-floating]{position:fixed;bottom:72px;left:18px;z-index:45;max-width:min(420px,calc(100vw - 36px));max-height:65vh;overflow:auto;box-shadow:0 10px 30px #0005}';
  document.head.append(css);
  const target=document.querySelector('[data-nexen-development]')||document.querySelector('main');
  if(target){target.prepend(host);host.open=location.pathname==='/';}else{host.dataset.floating='true';document.body.append(host);}
  let busy=false;
  async function refresh(){
    if(busy||document.hidden)return;busy=true;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch('/api/development/status',{signal:controller.signal});
      if(!response.ok)throw new Error(response.status===401?'Unlock NEXEN to view status.':'Status unavailable.');
      const result=await response.json(),p=result.checkpoint||{},m=result.model_transfer||{};
      host.querySelector('[data-dev-label]').textContent=p.title||'Checkpoint';
      host.querySelector('[data-dev-detail]').textContent=p.detail||'';
      host.querySelector('[data-dev-transfer]').textContent=`Model migration: ${m.status||'unknown'} · ${m.copied_bytes==null?'unknown':(m.copied_bytes/1073741824).toFixed(1)} GiB copied · ${m.verified_files??'?'}/${m.total_files??'?'} files verified.`;
      const list=host.querySelector('[data-dev-steps]');list.replaceChildren();
      for(const item of p.steps||[]){const li=document.createElement('li');li.textContent=`${item.label}: ${item.status}`;list.append(li);}
      host.querySelector('[data-dev-time]').textContent=`Development checkpoint ${p.updated_at?new Date(p.updated_at).toLocaleString():'time unavailable'}. Transfer checked ${new Date().toLocaleTimeString()}.`;
    }catch(error){host.querySelector('[data-dev-label]').textContent=error.name==='AbortError'?'Status refresh timed out; previous data may be stale.':error.message;}
    finally{clearTimeout(timer);busy=false;}
  }
  refresh();setInterval(refresh,15000);document.addEventListener('visibilitychange',refresh);
}
