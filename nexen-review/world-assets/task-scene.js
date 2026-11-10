// Model output selects only these authored scene primitives. No generated code or asset URLs.
export const SCENES=Object.freeze({cleaning:'sweep',coding:'type',music:'mix',planning:'review',rest:'pause'});
export async function taskSceneAPI(path,body){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json','X-Nexen-Action':'launch'},body:JSON.stringify(body)})});
    if(r.status===401||(r.url&&new URL(r.url).pathname==='/login')){const error=Error('NEXEN is locked. Sign in to refresh the scene.');error.code='NEXEN_LOCKED';throw error;}
    if(!r.ok){let detail;try{if(r.headers.get('content-type')?.includes('json'))detail=(await r.json()).detail;}catch{}throw Error(typeof detail==='string'?detail:'Local scene service unavailable ('+r.status+').');}
    try{return await r.json();}catch{throw Error('Local scene service returned an unreadable response. Refresh when NEXEN is ready.');}
  }finally{clearTimeout(timeout);}
}
export function validatedScene(receipt,taskId){
  if(!Number.isSafeInteger(taskId)||taskId<1||!receipt||receipt.task_id!==taskId||!/^[a-f0-9]{32}$/.test(receipt.id)||receipt.status!=='ready'||receipt.executed!==false||receipt.xp_awarded!==0||receipt.routing!=='local_only'||receipt.reconstruction!==false)throw Error('Scene receipt is not ready for this task.');
  const p=receipt.scene;
  if(!p||!Object.hasOwn(SCENES,p.scene)||SCENES[p.scene]!==p.action||typeof p.grounded_summary!=='string'||!p.grounded_summary.trim()||p.grounded_summary.length>600||!Array.isArray(p.source_refs)||p.source_refs.length<1||p.source_refs.length>24)throw Error('Scene plan failed the visual contract.');
  if(Object.keys(p).some(key=>!['scene','action','grounded_summary','source_refs'].includes(key)))throw Error('Extra scene instructions are not accepted.');
  const refs=new Set((Array.isArray(receipt.provenance)?receipt.provenance:[]).map(source=>source.source_ref));
  if(!p.source_refs.includes('task:'+taskId)||p.source_refs.some(ref=>!refs.has(ref)))throw Error('Scene sources do not match this task.');
  return {scene:p.scene,action:p.action,grounded_summary:p.grounded_summary,receipt_id:receipt.id,task_id:taskId,case_id:receipt.case_id,executed:false};
}

export function mountTaskScene(root,intent,onScene,onStop=()=>{}){
  if(!root||!Number.isSafeInteger(intent?.task_id)||intent.task_id<1)return()=>{};
  if(!document.getElementById('task-scene-style')){const style=document.createElement('style');style.id='task-scene-style';style.textContent='.task-scene{border:1px solid #a9dcff35;background:#08283c66;border-radius:10px;padding:13px;margin:12px 0}.task-scene h3{font:500 13px Segoe UI!important;margin:0 0 9px!important}.task-scene p{font-size:10px!important;line-height:1.65;margin:8px 0!important;overflow-wrap:anywhere}.task-scene-controls{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.task-scene select{font:10px Segoe UI;color:#cde7f7;background:#071c2e;border:1px solid #abdfff30;border-radius:6px;min-width:0;max-width:220px;padding:7px}.task-scene button{font:10px Segoe UI;color:#c4e6f9;background:#78b9de16;border:1px solid #abdfff30;border-radius:6px;padding:8px;cursor:pointer}.task-scene details{font-size:10px;color:#9dc3dc;margin-top:10px}.task-scene summary{cursor:pointer}.task-scene a{font-size:10px;color:#abddfa}.task-scene small{font:9px/1.6 Consolas,monospace;color:#85aac3;overflow-wrap:anywhere}.task-scene[data-error=true] [data-scene-status]{color:#e4bd93!important}';document.head.append(style);}
  root.className='task-scene';
  root.innerHTML='<h3>Task scene · local model</h3><p data-scene-status role="status">Preparing one local scene draft from this saved task…</p><div class="task-scene-controls"><select data-scene-model aria-label="Local model for a scene retry"><option value="">Smallest available text model</option></select><button type="button" data-scene-start disabled>Generate again</button><button type="button" data-scene-stop>Stop scene</button></div><p data-scene-summary></p><small data-scene-receipt></small><details><summary>Sources &amp; what this animation means</summary><p>Original procedural game animation guided by a local model. Saved photo summaries may inform it; this is not a reconstructed photograph or proof that work was done. Task completion and XP stay in your normal controls.</p><div data-scene-sources></div></details>';
  const q=s=>root.querySelector(s),status=q('[data-scene-status]'),start=q('[data-scene-start]'),stop=q('[data-scene-stop]'),model=q('[data-scene-model]');
  model.firstElementChild.textContent='Smallest installed model';
  const saved=document.createElement('button');saved.type='button';saved.textContent='Load latest saved scene';q('.task-scene-controls').append(saved);
  let id=null,pending=false,disposed=false,timer=null,epoch=0,startedAt=0;
  const setStatus=(text,error=false)=>{status.textContent=text;root.dataset.error=String(error);};
  const api=taskSceneAPI;
  function render(receipt){
    id=receipt.id;q('[data-scene-receipt]').textContent='Receipt '+id+' · task #'+intent.task_id+(receipt.case_id?' · photo case #'+receipt.case_id:'');
    q('[data-scene-sources]').replaceChildren(...(receipt.provenance||[]).map(source=>{const p=document.createElement('p');p.textContent=source.source_ref+' · '+source.kind+(source.original_sha256?' · SHA-256 '+source.original_sha256:'');return p;}));
    if(receipt.status==='ready'){const plan=validatedScene(receipt,intent.task_id);onScene(plan);pending=false;start.disabled=false;stop.disabled=false;setStatus('Model-directed '+plan.scene+' scene · '+(receipt.used_model||'local model'));q('[data-scene-summary]').textContent=plan.grounded_summary;return false;}
    if(['failed','interrupted','cancelled'].includes(receipt.status)){pending=false;start.disabled=false;stop.disabled=true;setStatus(receipt.error||'Scene stopped. Retry explicitly.',receipt.status!=='cancelled');return false;}
    setStatus('Local model is '+receipt.status+'… Actual task controls remain available below.');return true;
  }
  async function poll(run){
    if(disposed||run!==epoch||!pending)return;
    if(Date.now()-startedAt>150000){pending=false;start.disabled=false;setStatus('Scene status is no longer being polled. Check the receipt before starting another request.',true);return;}
    if(document.hidden){timer=setTimeout(()=>poll(run),2000);return;}
    try{const receipt=await api('/api/task-scenes/'+id);if(disposed||run!==epoch)return;if(!render(receipt))return;}
    catch(error){if(disposed||run!==epoch)return;if(error.code==='NEXEN_LOCKED'){pending=false;start.disabled=true;setStatus(error.message,true);return;}setStatus('Scene status could not refresh. Last receipt retained; no animation inferred.',true);}
    timer=setTimeout(()=>poll(run),1800);
  }
  async function generate(){
    if(pending||disposed)return;
    onStop();const run=++epoch;pending=true;id=null;startedAt=Date.now();start.disabled=true;stop.disabled=false;
    q('[data-scene-summary]').textContent='';setStatus('Requesting one local model-directed scene…');
    const requestKey=crypto.randomUUID().replaceAll('-','');
    try{const receipt=await api('/api/task-scenes/start',{request_key:requestKey,task_id:intent.task_id,case_id:intent.case_id??null,model:model.value||null});
      if(disposed||run!==epoch){if(['queued','running'].includes(receipt.status))api('/api/task-scenes/'+receipt.id+'/cancel',{}).catch(()=>{});return;}
      if(render(receipt))timer=setTimeout(()=>poll(run),1400);
    }catch(error){if(disposed||run!==epoch)return;pending=false;start.disabled=false;stop.disabled=true;setStatus(error.name==='AbortError'?'Scene request timed out. Check saved receipts before retrying.':error.message,true);}
  }
  async function cancel(){const activeId=id,wasPending=pending;++epoch;clearTimeout(timer);pending=false;start.disabled=false;stop.disabled=true;onStop();setStatus('Scene illustration stopped. Task state and XP are unchanged.');if(wasPending&&activeId){try{await api('/api/task-scenes/'+activeId+'/cancel',{});}catch{setStatus('Illustration stopped; server cancellation could not be confirmed. The model request has its own time limit.',true);}}}
  saved.addEventListener('click',async()=>{
    if(pending||disposed){setStatus('Stop or wait for the current request before loading another receipt.');return;}
    const run=++epoch;saved.disabled=true;start.disabled=true;
    try{const data=await api('/api/task-scenes/by-task/'+intent.task_id);if(disposed||run!==epoch)return;const receipt=data.receipts?.[0];if(!receipt){setStatus('No saved scene receipt for this task yet.');return;}onStop();startedAt=Date.now();pending=['queued','running'].includes(receipt.status);stop.disabled=!pending;if(render(receipt))timer=setTimeout(()=>poll(run),1000);}
    catch(error){if(!disposed&&run===epoch){pending=false;setStatus(error.message,true);}}
    finally{saved.disabled=false;if(!pending)start.disabled=false;}
  });
  start.addEventListener('click',generate);stop.addEventListener('click',cancel);
  const stopVoice=()=>cancel();window.addEventListener('nexen:voice-stop',stopVoice);
  api('/api/lab/models').then(data=>{if(disposed)return;for(const item of (data.models||[]).slice(0,200)){if(typeof item.name!=='string')continue;const option=document.createElement('option');option.value=item.name;option.textContent=item.name;model.append(option);}}).catch(()=>{});
  // This function is called only by the user's Start Task Work control.
  generate();
  return()=>{disposed=true;cancel();window.removeEventListener('nexen:voice-stop',stopVoice);};
}
