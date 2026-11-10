// Existing NEXEN modules share one sidebar. This layer only reads status and opens workspaces.
export const LEGACY_ROUTES = Object.freeze(['','control','ideas','morning','needs','attach','tools','catalogue','queue','store','blueprint','revenue','products','wdr']);
export function legacyState(data, browserHost) {
  const local = ['127.0.0.1','localhost','[::1]'].includes(browserHost);
  const service = Array.isArray(data?.services) ? data.services.find(item => item?.name === 'Original NEXEN' && item?.url === 'http://127.0.0.1:8770/') : null;
  const reachable = service?.status === 'reachable';
  return {reachable,local,label: !service ? 'Status unavailable' : reachable ? 'Local port responding' : 'Original service unavailable',
    detail: local ? 'These original pages open on this PC in their own tab. A responding port does not verify every page, login or action.' : 'Original pages use this PC’s localhost service. These links are not a verified phone connection; use them on the NEXEN PC.'};
}
export function taskSummary(data) {
  if (!Array.isArray(data?.tasks)) throw Error('Task records are unavailable.');
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {done:count(data.counts?.done),blocked:count(data.counts?.blocked),
    tasks:data.tasks.filter(t => t && t.status !== 'done').slice(0,5),total:count(data.total)};
}
export function taskWorkIntent(task) {
  if (!Number.isSafeInteger(task?.id) || task.id < 1) throw Error('Choose a saved task first.');
  return {task_id:task.id,url:'/next?task_id='+task.id,
    avatar_prompt:'Illustrate the WDR avatar preparing to work on task #'+task.id+': '+String(task.text||'Saved task').slice(0,700)+'. This is a visual work cue, not proof that the task has been done.',
    guide_prompt:'Open the actual saved task #'+task.id+' and its current guide. Next step: '+String(task.next_step||'Review the task and add a concrete next step.').slice(0,700)+'. Preserve its real status and require its normal controls for actions.',
    executed:false};
}

if (typeof document !== 'undefined') {
  const sidebar = document.getElementById('workspace-activity');
  const embedded = window.parent !== window;
  const game = document.body.classList.contains('game-workspace');
  if (game && embedded) sidebar?.remove();
  const active = game && embedded ? null : sidebar;
  const $ = id => document.getElementById(id);
  const node = (tag, cls, text) => {const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
  let currentTab = 'development', refreshing = false;
  function focusCity(open) {window.dispatchEvent(new CustomEvent('nexen:workspace-focus',{detail:{open}}));}
  function close() {if(game&&active){active.hidden=true;window.NexenVoice?.stop();focusCity(false);document.querySelector('[data-workspace-open]')?.focus();}}
  function choose(name, focus = false) {
    if (!['development','connections','tasks','voice'].includes(name)) return;
    if (game && embedded) {
      try {if(window.parent.location.origin === location.origin)window.parent.dispatchEvent(new window.parent.CustomEvent('nexen:workspace-tab',{detail:{tab:name}}));}catch{}
      return;
    }
    if(!active)return;
    if(currentTab==='voice'&&name!=='voice')window.NexenVoice?.stop();
    currentTab=name; active.hidden=false;
    active.querySelectorAll('[data-workspace-tab]').forEach(button=>{const selected=button.dataset.workspaceTab===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected&&focus)button.focus();});
    active.querySelectorAll('[data-workspace-panel]').forEach(panel=>{panel.hidden=panel.dataset.workspacePanel!==name;});
    if(game)focusCity(true);else if(innerWidth<1400)active.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    if(name==='voice')window.NexenVoice?.open();
  }
  document.querySelectorAll('[data-workspace-open]').forEach(button=>button.addEventListener('click',()=>choose(button.dataset.workspaceOpen||'development',true)));
  active?.querySelector('[data-workspace-close]')?.addEventListener('click',close);
  active?.querySelectorAll('[data-workspace-tab]').forEach(button=>{
    button.addEventListener('click',()=>choose(button.dataset.workspaceTab));
    button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const tabs=[...active.querySelectorAll('[data-workspace-tab]')],at=tabs.indexOf(button),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(at+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;choose(tabs[next].dataset.workspaceTab,true);});
  });
  window.addEventListener('nexen:workspace-tab',event=>choose(event.detail?.tab,true));
  window.addEventListener('nexen:station-open',()=>{if(game&&active){active.hidden=true;if(currentTab==='voice')window.NexenVoice?.stop();focusCity(false);}});
  active?.addEventListener('keydown',event=>{if(game&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
  async function get(path) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
    try {const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(response.status===401||new URL(response.url).pathname==='/login')throw Error('NEXEN is locked. Sign in to refresh status.');if(!response.ok)throw Error('Local status unavailable ('+response.status+').');return await response.json();}
    finally{clearTimeout(timer);}
  }
  async function refreshLegacy() {
    if(!$('original-state'))return;
    try {const data=await get('/api/hub/control'),s=legacyState(data,location.hostname);$('original-state').textContent=s.label;$('original-state').dataset.ready=String(s.reachable);$('original-note').textContent=s.detail;$('original-checked').textContent='Service checked '+new Date(data.checked_at).toLocaleTimeString();}
    catch(error){$('original-state').textContent='Status unavailable';$('original-state').dataset.ready='false';$('original-checked').textContent=error.name==='AbortError'?'Service check timed out. Previous status is stale.':error.message;}
  }
  async function refreshTasks() {
    if(!active)return;
    const target=$('workspace-task-list'),summary=$('workspace-task-summary'),note=$('workspace-task-checked');
    try {const data=await get('/api/tasks?include_done=false&limit=100'),s=taskSummary(data);
      summary.replaceChildren(...[['Marked done',s.done],['Blocked',s.blocked]].map(([label,value])=>{const n=node('span','',label);n.prepend(node('strong','',value===null?'—':value.toLocaleString()));return n;}));
      target.replaceChildren(...s.tasks.map(task=>{const row=node('article','workspace-task');row.append(node('small','',String(task.status||'unknown').replaceAll('_',' ')),node('h3','',String(task.text||'Saved task').slice(0,220)));if(task.next_step)row.append(node('p','',String(task.next_step).slice(0,200)));return row;}));
      if(!s.tasks.length)target.append(node('p','workspace-refresh-note','No open tasks in this response. Open the task room to choose your next step.'));
      note.textContent='Saved task records · refreshed '+new Date().toLocaleTimeString()+'. These are not exploration XP.';
    }catch(error){note.textContent=(error.name==='AbortError'?'Task check timed out.':error.message)+' Any earlier records shown may be stale.';}
  }
  async function refreshCurrent() {
    if(!active)return;
    const target=$('workspace-current-task');
    try {const data=await get('/api/next'),task=data.selected_task;target.replaceChildren();
      if(!task){target.append(node('p','workspace-refresh-note','No current task selected. Choose one in the task room.'));return;}
      const intent=taskWorkIntent(task),label=node('small','','CURRENT TASK #'+task.id),title=node('h3','',task.text||'Saved task'),detail=node('p','',task.next_step||'Open the task to choose the next step.');
      const prompt=node('details','workspace-intents'),heading=node('summary','','Two work intents · prepared');prompt.append(heading,node('p','','Avatar: '+intent.avatar_prompt),node('p','','Task guide: '+intent.guide_prompt));
      const start=node('button','workspace-start','Start task work');start.type='button';
      start.addEventListener('click',()=>{if(game){window.dispatchEvent(new CustomEvent('nexen:task-work',{detail:intent}));}else{location.assign(intent.url);}});
      target.append(label,title,detail,start,prompt,node('p','workspace-refresh-note',data.action?.message||'The task workspace determines what is currently available.'));
    }catch(error){target.replaceChildren(node('p','workspace-refresh-note',error.name==='AbortError'?'Current task check timed out. No task inferred.':error.message));}
  }
  async function refresh(){if(refreshing||document.hidden)return;refreshing=true;try{await Promise.allSettled([refreshLegacy(),refreshTasks(),refreshCurrent()]);}finally{refreshing=false;}}
  document.querySelectorAll('[data-workspace-refresh]').forEach(button=>button.addEventListener('click',refresh));
  document.querySelector('[data-original-refresh]')?.addEventListener('click',refreshLegacy);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  if(active){active.querySelectorAll('[data-workspace-panel]').forEach(panel=>panel.hidden=panel.dataset.workspacePanel!=='development');}
  refresh();setInterval(refresh,30000);
  window.NexenWorkspace=Object.freeze({open:choose,close,refresh});
}
