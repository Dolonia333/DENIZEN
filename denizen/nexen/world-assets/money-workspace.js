/* Shared business/task view. All mutations use the existing authenticated APIs. */
const byId = id => document.getElementById(id);
const initialTrack = new URLSearchParams(window.location.search).get('track');
const state = {packet:null, track:initialTrack||'all', taskLimit:12, unassignedLimit:12, loading:false, loadFailed:false, memoryVersion:0, memoryBusy:false};
let draftKey = null;
const message = text => { byId('money-message').textContent = text; };
const text = value => String(value ?? '');
const statusLabel = value => text(value || 'planned').replaceAll('_',' ');
function node(tag, value, className) {
  const result = document.createElement(tag);
  if (value !== undefined) result.textContent = text(value);
  if (className) result.className = className;
  return result;
}
function button(label, action, primary=false) {
  const result = node('button', label, 'btn'+(primary?' primary':''));
  result.type = 'button';
  result.addEventListener('click', async () => {
    result.disabled=true;
    try { await action(); } catch(error) { message(error.message); }
    finally { result.disabled=false; }
  });
  return result;
}
async function request(path, options={}, timeout=20000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(path,{...options,signal:controller.signal,headers:{'Content-Type':'application/json','X-Nexen-Action':'launch'}});
    if(response.status===401 || response.redirected && new URL(response.url).pathname==='/login') {
      throw Error('Your session expired. Unlock NEXEN from the main page, then refresh.');
    }
    if(!(response.headers.get('content-type')||'').includes('application/json')) throw Error('NEXEN returned an unreadable response. Refresh after the service is ready.');
    const data=await response.json();
    if(!response.ok) throw Error(typeof data.detail==='string'?data.detail:'NEXEN could not save this change. Check the fields and try again.');
    return data;
  } catch(error) {
    if(error.name==='AbortError') throw Error('NEXEN took too long to respond. Refresh to check whether the change was saved before retrying.');
    throw error;
  } finally { clearTimeout(timer); }
}
const post=(path,body,timeout)=>request(path,{method:'POST',body:JSON.stringify(body)},timeout);
function tracks() { return state.packet?.tracks || []; }
function selectedTrack() { return tracks().find(track=>track.id===state.track); }
function compareTasks(a,b) {
  const rank={urgent:0,high:1,normal:2,low:3};
  return Number(a.status==='done')-Number(b.status==='done') ||
    (rank[a.priority]??2)-(rank[b.priority]??2) ||
    text(a.due_date||'9999').localeCompare(text(b.due_date||'9999')) || a.id-b.id;
}
function allTasks() {
  const rows = new Map();
  for(const track of tracks()) for(const task of track.tasks||[]) {
    if(!rows.has(task.id)) rows.set(task.id,{...task,track_id:track.id,track_title:track.title});
  }
  return [...rows.values()].sort(compareTasks);
}
async function openTask(id) {
  await post('/api/next/select',{task_id:id});
  window.location.assign('/next');
}
function taskCard(task, unassigned=false) {
  const card=node('article',undefined,'money-task');
  card.dataset.status=task.status || 'planned';
  const meta=node('div',undefined,'money-task-meta');
  for(const label of ['Task '+task.id,task.track_title,statusLabel(task.status),task.priority==='normal'?'':task.priority,task.due_date?'Due '+task.due_date:'']) {
    if(label) meta.append(node('span',label,'money-tag'));
  }
  card.append(meta,node('h3',text(task.text || task.title).slice(0,260)));
  if(task.next_step) card.append(node('p',text(task.next_step).slice(0,500)));
  if(task.assignment?.basis) card.append(node('small',statusLabel(task.assignment.basis),'small'));
  const actions=node('div',undefined,'actions');
  actions.append(button(task.status==='done'?'Review completed task':'Open task & next step',()=>openTask(task.id),!unassigned));
  if(unassigned) {
    const select=node('select');
    select.setAttribute('aria-label','Assign task '+task.id+' to a money plan');
    select.append(new Option('Choose a money plan',''));
    tracks().forEach(track=>select.append(new Option(track.title,track.id)));
    const save=button('Assign to plan',async()=>{
      if(!select.value) throw Error('Choose a money plan first.');
      await post('/api/money/tasks/'+task.id+'/track',{track_id:select.value});
      await load();
      message('Task '+task.id+' is now linked to that plan. Its original history is preserved.');
    });
    actions.append(select,save);
  }
  card.append(actions);
  return card;
}
function renderTasks() {
  if(!state.packet) return;
  const query=byId('money-search').value.trim().toLowerCase();
  const filter=byId('money-task-state').value;
  const rows=allTasks().filter(task=>(state.track==='all'||task.track_id===state.track) &&
    (filter==='all'||filter==='open'&&task.status!=='done'||task.status===filter) &&
    (!query || (text(task.text)+' '+text(task.next_step)).toLowerCase().includes(query)));
  byId('money-task-list').replaceChildren(...rows.slice(0,state.taskLimit).map(task=>taskCard(task)));
  if(!rows.length) byId('money-task-list').append(node('p',query?'No matching tasks. Try another phrase.':'No tasks in this view. Add a next action or assign one from your other saved tasks.','money-empty'));
  byId('money-more-tasks').hidden=rows.length<=state.taskLimit;
  byId('money-selected-label').textContent=selectedTrack()?.title || 'All businesses & plans';
}
function renderUnassigned() {
  if(!state.packet) return;
  const query=byId('money-unassigned-search').value.trim().toLowerCase();
  const rows=(state.packet.unassigned_tasks||[]).filter(task=>!query||(text(task.text)+' '+text(task.next_step)).toLowerCase().includes(query));
  byId('money-unassigned-list').replaceChildren(...rows.slice(0,state.unassignedLimit).map(task=>taskCard(task,true)));
  if(!rows.length) byId('money-unassigned-list').append(node('p','No matching unassigned tasks in the loaded records.','money-empty'));
  byId('money-unassigned-title').textContent='Other saved tasks · '+(state.packet.unassigned_tasks||[]).length+' available to assign';
  byId('money-more-unassigned').hidden=rows.length<=state.unassignedLimit;
}
function invalidateMemory() {
  state.memoryVersion++;
  byId('money-context-sources').replaceChildren();
  byId('money-context-details').hidden=true;
  byId('money-context-text').textContent='';
  byId('money-context-status').textContent='Question changed. Retrieve the sources for this request.';
}
function chooseTrack(id) {
  const restoreFocus=byId('money-tracks').contains(document.activeElement);
  state.track=id;state.taskLimit=12;
  renderTracks();
  if(restoreFocus) byId('money-tracks').querySelector('[aria-pressed="true"]')?.focus();
  renderTasks();
  const track=selectedTrack();
  if(track) {
    byId('money-task-track').value=track.id;
    byId('money-context-query').value='Find my '+track.title+' plans, relevant guides, unresolved decisions and practical next steps.';
  } else byId('money-context-query').value='Find my business and money plans, their unresolved decisions and practical next steps.';
  invalidateMemory();
}
function renderTracks() {
  const rows=tracks();
  const all={id:'all',title:'All businesses & plans',description:'See your connected work together.',kind:'Overview',tasks:allTasks()};
  byId('money-tracks').replaceChildren(...[all,...rows].map(track=>{
    const result=node('button',undefined,'money-track');result.type='button';result.setAttribute('aria-pressed',String(track.id===state.track));
    const tasks=track.tasks||[];
    const next=track.next_task || tasks.filter(task=>task.status!=='done').sort(compareTasks)[0];
    const open=track.open_count ?? tasks.filter(task=>task.status!=='done').length;
    const done=track.done_count ?? tasks.filter(task=>task.status==='done').length;
    result.append(node('span',statusLabel(track.kind||'Business plan'),'eyebrow'),node('strong',track.title),node('span',open+' open · '+done+' completed','small'),node('span',next?'Next: '+text(next.next_step||next.text):track.description||'Add your next action.','track-next'));
    result.addEventListener('click',()=>chooseTrack(track.id));
    return result;
  }));
}
function render(packet) {
  if(!packet || !Array.isArray(packet.tracks) || !Array.isArray(packet.unassigned_tasks)) throw Error('Money workspace data is incomplete. The last visible data is preserved.');
  state.packet=packet;
  if(state.track!=='all'&&!selectedTrack()) state.track='all';
  const rows=allTasks();
  byId('money-track-count').textContent=tracks().length;
  byId('money-open-count').textContent=packet.summary?.open_tasks ?? rows.filter(task=>task.status!=='done').length;
  byId('money-blocked-count').textContent=packet.summary?.blocked_tasks ?? rows.filter(task=>task.status==='blocked').length;
  byId('money-done-count').textContent=packet.summary?.done_tasks ?? rows.filter(task=>task.status==='done').length;
  const urgent=packet.urgent_tasks?.[0];
  byId('money-urgent').hidden=!urgent;
  if(urgent) {
    byId('money-urgent-title').textContent=text(urgent.text||urgent.title).slice(0,180);
    byId('money-urgent-detail').textContent=(urgent.due_date?'Due '+urgent.due_date+' · ':'')+text(urgent.next_step).slice(0,350);
    byId('money-urgent-open').onclick=async()=>{
      const button=byId('money-urgent-open');button.disabled=true;
      try { await openTask(urgent.id); } catch(error) { message(error.message); } finally {button.disabled=false;}
    };
  }
  const saved=byId('money-task-track').value;
  byId('money-task-track').replaceChildren(...tracks().map(track=>new Option(track.title,track.id)));
  if(tracks().some(track=>track.id===saved)) byId('money-task-track').value=saved;
  renderTracks();renderTasks();
  if(byId('money-unassigned').open) renderUnassigned();
  else byId('money-unassigned-title').textContent='Other saved tasks · '+packet.unassigned_tasks.length+' available to assign';
  const c=packet.coverage;
  const coverage=typeof c==='string'?c: c ? 'Showing '+c.loaded+' of '+c.total+' saved tasks. '+(c.truncated?'Some tasks are outside this page; open Task room for the full list.':'All current task records are loaded.') : '';
  byId('money-coverage').textContent=coverage+' Refreshed '+new Date().toLocaleTimeString()+'.';
}
async function load(quiet=false) {
  if(state.loading) return;
  state.loading=true;
  try {
    const first=!state.packet;
    render(await request('/api/money/workspace'));
    if(first&&selectedTrack())chooseTrack(state.track);
    if(!quiet || state.loadFailed)message('Connected to your saved tasks. Choose a plan or open your next action.');
    state.loadFailed=false;
  }
  catch(error) { state.loadFailed=true; message(error.message); }
  finally { state.loading=false; }
}
byId('money-search').addEventListener('input',()=>{state.taskLimit=12;renderTasks();});
byId('money-task-state').addEventListener('change',()=>{state.taskLimit=12;renderTasks();});
byId('money-more-tasks').onclick=()=>{state.taskLimit+=12;renderTasks();};
byId('money-unassigned-search').addEventListener('input',()=>{state.unassignedLimit=12;renderUnassigned();});
byId('money-unassigned').addEventListener('toggle',()=>{if(byId('money-unassigned').open)renderUnassigned();});
byId('money-more-unassigned').onclick=()=>{state.unassignedLimit+=12;renderUnassigned();};
byId('money-refresh').onclick=()=>load();
byId('money-add-plan').onclick=()=>{byId('commerce-tools').open=true;byId('newform').hidden=false;byId('newform').scrollIntoView({block:'center'});byId('newform').querySelector('input').focus();};
byId('money-context-query').addEventListener('input',invalidateMemory);
byId('money-find-knowledge').onclick=async()=>{
  if(state.memoryBusy)return;
  const query=byId('money-context-query').value.trim();
  if(!query){byId('money-context-status').textContent='Describe what you want to find first.';return;}
  const version=++state.memoryVersion;state.memoryBusy=true;
  const button=byId('money-find-knowledge');button.disabled=true;
  byId('money-context-status').textContent='Searching the relevant shared memory…';
  try {
    const packet=await post('/api/memory/context',{query,pool:selectedTrack()?.pool||'all',task_type:'workflow'},45000);
    if(version!==state.memoryVersion)return;
    const citations=Array.isArray(packet.citations)?packet.citations:[];
    byId('money-context-sources').replaceChildren(...citations.map(source=>{
      const result=node('div',undefined,'source-row');
      result.append(node('strong',source.title||source.source_id||'Indexed source'));
      const origin=[statusLabel(source.kind||source.type||'source')];
      if(source.role)origin.push(statusLabel(source.role)+' content');
      if(source.ts)origin.push((source.kind==='chunk'?'Indexed ':'Recorded ')+text(source.ts).slice(0,10));
      result.append(node('small',origin.join(' · ')));
      return result;
    }));
    byId('money-context-text').textContent=text(packet.text);
    byId('money-context-details').hidden=!packet.text;
    byId('money-context-status').textContent=citations.length+' source references · '+statusLabel(packet.data_sufficiency||'review the evidence')+'. '+(Array.isArray(packet.warnings)?packet.warnings.join(' '):'');
  } catch(error) {if(version===state.memoryVersion)byId('money-context-status').textContent=error.message;}
  finally {state.memoryBusy=false;button.disabled=false;}
};
byId('money-task-form').addEventListener('input',()=>{draftKey=null;});
byId('money-task-form').addEventListener('change',()=>{draftKey=null;});
byId('money-task-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget,button=form.querySelector('button');
  if(button.disabled)return;
  button.disabled=true;
  const payload=Object.fromEntries(new FormData(form));
  if(!payload.due_date)delete payload.due_date;
  draftKey ||= crypto.randomUUID().replaceAll('-','');payload.request_key=draftKey;
  try {
    const result=await post('/api/money/tasks',payload);
    form.reset();draftKey=null;
    byId('money-task-save-status').textContent='Task '+(result.task?.id??result.id)+' saved to the shared task room and this plan.';
    await load(true);
  } catch(error) {byId('money-task-save-status').textContent=error.message;}
  finally {button.disabled=false;}
});
window.addEventListener('nexen-money-updated',()=>load(true));
load();
setInterval(()=>{
  const editing=document.activeElement?.matches('input,textarea,select') || byId('money-unassigned').contains(document.activeElement);
  if(!document.hidden && !editing)load(true);
},20000);
