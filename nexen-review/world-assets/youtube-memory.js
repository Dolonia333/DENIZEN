const BASE='/api/youtube-memory/sources';
export const EXAMPLE_URL='https://www.youtube.com/watch?v=w0S-khYCaB4';
export const KINDS=Object.freeze(['guide','workflow','command']);
const SOURCE_ACTIVE=new Set(['queued','fetching','indexing']);
const COMPILE_ACTIVE=new Set(['queued','running']);
const LABELS=Object.freeze({queued:'Queued',fetching:'Getting transcript',indexing:'Saving to memory',ready:'Source ready',transcript_unavailable:'Transcript unavailable',cancelled:'Cancelled',failed:'Failed'});

export function videoURL(raw){
  if(typeof raw!=='string'||raw.length>2048)throw Error('Paste a YouTube video link.');
  let url;try{url=new URL(raw.trim());}catch{throw Error('Paste the full https:// YouTube video link.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error('Use an https:// YouTube video link without a sign-in or port.');
  const host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean);let id=null;
  if(host==='youtu.be'&&parts.length===1)id=parts[0];
  else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host)){
    if(url.pathname==='/watch'&&url.searchParams.getAll('v').length===1)id=url.searchParams.get('v');
    else if(parts.length===2&&['shorts','live','embed'].includes(parts[0]))id=parts[1];
  }
  if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))throw Error('This is not a supported YouTube video link. Use a watch, Shorts, live or youtu.be URL.');
  return {id,url:'https://www.youtube.com/watch?v='+id};
}
export function sourceID(value){
  if(typeof value==='string'&&/^[a-f0-9]{24}$/.test(value))return value;
  throw Error('The source has no valid NEXEN ID. Refresh your saved sources.');
}
export function timeLabel(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;
  const seconds=Math.floor(value),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
  return hours?hours+':'+String(minutes).padStart(2,'0')+':'+String(rest).padStart(2,'0'):minutes+':'+String(rest).padStart(2,'0');
}
export function sourceLink(source,start=null){
  const parsed=videoURL(source?.url);
  if(source?.video_id&&source.video_id!==parsed.id)throw Error('Video identity does not match its source.');
  return parsed.url+(timeLabel(start)!==null?'&t='+Math.floor(start)+'s':'');
}
export function sourceStages(source,kind='guide'){
  if(!source||typeof source!=='object')throw Error('Source status is unavailable.');
  const status=source.status,hasTranscript=Array.isArray(source.segments)&&source.segments.some(p=>typeof p?.text==='string'&&p.text.length>0);
  const draft=source.drafts?.[kind],compiling=COMPILE_ACTIVE.has(source.compile_status),task=Number.isSafeInteger(source.task_id)&&source.task_id>0;
  return {
    transcript:{state:hasTranscript?'done':SOURCE_ACTIVE.has(status)?'active':['failed','transcript_unavailable','cancelled'].includes(status)?'blocked':'waiting',text:hasTranscript?'Source text available':LABELS[status]||'Not available'},
    memory:{state:source.memory_indexed===true?'done':status==='indexing'?'active':status==='ready'?'blocked':'waiting',text:source.memory_indexed===true?'Indexed in NEXEN':status==='indexing'?'Indexing':status==='ready'?'Indexing not confirmed':'Not saved yet'},
    draft:{state:draft?'done':compiling?'active':['failed','blocked'].includes(source.compile_status)?'blocked':'waiting',text:draft?'Local draft available':compiling?'Preparing '+(source.compile_kind||'draft'):'Not prepared'},
    action:{state:task?'done':'waiting',text:task?'Task #'+source.task_id+' created':'Not run'}
  };
}
export function runState(source,capabilities){
  const existing=Number.isSafeInteger(source?.task_id)&&source.task_id>0;
  if(existing)return {canRun:false,title:'NEXEN task created',description:'Task #'+source.task_id+' is saved in your task tracker. The video tutorial itself has not been executed.',label:'Task created',task_id:source.task_id};
  if(source?.status!=='ready')return {canRun:false,title:'Create a NEXEN task',description:'A ready source is required before creating a task.',label:'Source needed'};
  if(!Array.isArray(capabilities?.run_actions)||!capabilities.run_actions.includes('create_task'))return {canRun:false,title:'Create a NEXEN task',description:'This service has not confirmed a supported create-task adapter. Refresh its readiness first.',label:'Adapter unconfirmed'};
  return {canRun:true,title:'Create a NEXEN task',description:'Save this video and its source references as a planned NEXEN task. This action does not run commands from the transcript or complete the tutorial.',label:'Local action available'};
}

export function initYouTubeMemory(doc=document){
  const $=id=>doc.getElementById(id);if(!$('source-form'))return;
  const doctorButton=doc.createElement('button');doctorButton.type='button';doctorButton.className='secondary';doctorButton.textContent="Check this video's local setup";doctorButton.hidden=true;$('run-area').append(doctorButton);
  const doctorReceipt=doc.createElement('div');doctorReceipt.className='run-receipt';doctorReceipt.setAttribute('role','status');doctorReceipt.setAttribute('aria-live','polite');$('run-area').append(doctorReceipt);
  let current=null,kind='guide',busy=false,serviceReady=false,capabilityState=null,epoch=0,pollTimer=null,disposed=false,segmentLimit=80,modelsLoaded=false,polling=false;
  const text=(id,value)=>$(id).textContent=String(value??'');
  const element=(tag,className,value)=>{const node=doc.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=String(value);return node;};
  const formMessage=(value,error=false)=>{text('source-form-status',value);$('source-form-status').dataset.error=String(error);};
  function setBusy(value){busy=value;$('create-source').disabled=value||!serviceReady;$('save-manual').disabled=value||!serviceReady;$('use-example').disabled=value;$('retry-source').disabled=value;$('stop-source').disabled=value;$('refresh-source').disabled=value;buttons();}
  function buttons(){const ready=current?.status==='ready',compiling=COMPILE_ACTIVE.has(current?.compile_status);$('generate-artifact').disabled=busy||!serviceReady||!ready||compiling||!modelsLoaded||capabilityState?.local_model_drafts!==true;$('draft-model').disabled=busy||compiling;$('run-artifact').disabled=busy||!serviceReady||!runState(current,capabilityState).canRun;doctorButton.hidden=!(current?.video_id==='w0S-khYCaB4'&&capabilityState?.run_actions?.includes('check_agentic_os'));doctorButton.disabled=busy||!serviceReady||!ready;}
  async function api(path,body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json','X-Nexen-Action':'launch'},body:JSON.stringify(body)})});
      if(response.status===401||(response.url&&new URL(response.url).pathname==='/login'))throw Error('NEXEN is locked. Sign in again; your pasted text remains in this page.');
      let data;try{data=await response.json();}catch{throw Error('The YouTube memory service did not return its expected response. Refresh after the app update.');}
      if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:Array.isArray(data.detail)?data.detail[0]?.msg||'Please check the submitted fields.':'The local service could not complete this request ('+response.status+').');return data;
    }catch(error){if(error.name==='AbortError')throw Error('The local request timed out. Refresh saved sources before trying the operation again; its server state is not yet confirmed.');throw error;}finally{clearTimeout(timer);}
  }
  const date=value=>{const parsed=new Date(value);return value&&!Number.isNaN(parsed.getTime())?parsed.toLocaleString():'';};
  function renderTranscript(){
    const area=$('transcript'),segments=Array.isArray(current?.segments)?current.segments:[];area.replaceChildren();
    text('transcript-detail',segments.length?segments.length.toLocaleString()+' source segments':'No transcript yet');
    if(!segments.length){area.append(element('p','help','No transcript text has been returned. If captions are unavailable, paste a transcript you have permission to use.'));return;}
    for(const segment of segments.slice(0,segmentLimit)){
      if(typeof segment?.text!=='string')continue;
      const row=element('div','segment'),stamp=timeLabel(segment.start);let marker;
      if(stamp!==null){try{marker=element('a','stamp',stamp);marker.href=sourceLink(current,segment.start);marker.target='_blank';marker.rel='noopener noreferrer';marker.setAttribute('aria-label','Watch source at '+stamp);}catch{marker=element('span','stamp',stamp);}}
      else marker=element('span','stamp','Text');
      if(typeof segment.id==='string')marker.append(element('small','source-refs',' / '+segment.id));row.append(marker,element('p','',segment.text));area.append(row);
    }
    if(segmentLimit<segments.length){const more=element('button','secondary wide','Show the next transcript segments');more.type='button';more.addEventListener('click',()=>{segmentLimit+=80;renderTranscript();});area.append(more);}
  }
  function addDraftSteps(container,draft){
    if(typeof draft.title==='string')container.append(element('h3','',draft.title));
    if(typeof draft.summary==='string')container.append(element('p','artifact-body',draft.summary));
    if(Array.isArray(draft.steps))for(const [index,step] of draft.steps.entries()){
      const item=element('div','details');item.append(element('h3','',(index+1)+'. '+String(step?.title||'Draft step')));
      if(typeof step?.instruction==='string')item.append(element('p','artifact-body',step.instruction));
      const refs=Array.isArray(step?.source_refs)?step.source_refs.filter(ref=>typeof ref==='string'):[];
      const referenceLine=element('p','source-refs','Source: ');
      for(const [refIndex,ref] of refs.entries()){if(refIndex)referenceLine.append(doc.createTextNode(', '));const segment=current?.segments?.find(row=>row.id===ref);let link;try{if(!segment||timeLabel(segment.start)===null)throw Error('No timestamp');link=element('a','',ref+' ('+timeLabel(segment.start)+')');link.href=sourceLink(current,segment.start);link.target='_blank';link.rel='noopener noreferrer';}catch{link=element('span','',ref);}referenceLine.append(link);}
      if(!refs.length)referenceLine.append(doc.createTextNode('No segment references supplied.'));
      item.append(referenceLine,element('p','source-refs','Adapter: '+String(step?.required_adapter||'needs_adapter')+'. '+String(step?.execution_status||'not_executed')+'.'));
      container.append(item);
    }
  }
  function renderArtifact(){
    const summaries={guide:'A guide explains the useful steps and keeps their source references.',workflow:'A workflow organizes the steps, inputs and missing adapters.',command:'A command draft describes an intended action. It cannot execute arbitrary shell code.'};
    text('artifact-summary',summaries[kind]);text('generate-artifact','Create '+kind);$('artifact-panel').setAttribute('aria-labelledby','tab-'+kind);
    const draft=current?.drafts?.[kind],container=$('artifact-content');container.replaceChildren();
    if(draft&&typeof draft==='object'){addDraftSteps(container,draft);text('artifact-sources','Local draft'+(draft.model?' by '+draft.model:'')+(date(draft.created_at)?', saved '+date(draft.created_at):'')+'.'+(draft.transcript_sha256?' Transcript SHA-256: '+draft.transcript_sha256+'.':'')+(draft.coverage?' Context coverage: '+JSON.stringify(draft.coverage)+'.':'')+' Generated text remains a draft; verify it against the transcript.');}
    else {text('artifact-sources','');const baseline=current?.artifacts?.[kind];if(typeof baseline==='string'&&baseline.trim()){container.append(element('p','artifact-body',baseline));text('artifact-sources','Source-derived preparation. No local model rewrite has been recorded for this tab.');}else if(baseline&&typeof baseline==='object'){container.append(element('p','artifact-body',JSON.stringify(baseline,null,2)));text('artifact-sources','Prepared specification from the source. These steps have not been executed.');}}
    const compile=current?.compile_status;let message='';
    if(COMPILE_ACTIVE.has(compile))message='Local '+(current.compile_kind||'draft')+' compilation is '+compile+'. You can keep reading the saved transcript.';
    else if(['failed','blocked','cancelled'].includes(compile))message=current.compile_error||'Local compilation '+compile+'. Retry explicitly when ready.';
    else if(draft)message='Draft available. Review its steps and source references.';
    else if(!modelsLoaded)message='Choose an available local model after its readiness check. No cloud fallback is used by this page.';
    else message='Create this draft when the source is ready.';
    text('artifact-status',message);$('artifact-status').dataset.error=String(['failed','blocked'].includes(compile));
    const state=runState(current,capabilityState);$('run-area').hidden=!current;text('run-title',state.title);text('run-status',state.label);$('run-status').dataset.tone=state.task_id?'good':'warning';text('run-description',state.description);text('run-artifact','Create a NEXEN task');
    const blockers=Array.isArray(draft?.blockers)?draft.blockers.filter(v=>typeof v==='string'):[];$('run-blockers').replaceChildren(...blockers.map(v=>element('li','',v)));$('run-blockers').hidden=!blockers.length;
    if(state.task_id){const link=element('a','','Open task #'+state.task_id);link.href='/next?task_id='+state.task_id;$('run-receipt').replaceChildren(element('span','','Recorded result: local task created. '),link);}else text('run-receipt','No action receipt recorded for this source.');buttons();
    const run=current?.last_run;doctorReceipt.replaceChildren();if(run?.action==='check_agentic_os'&&run.execution==='local_readiness_check'){
      doctorReceipt.append(element('p','','Local setup check '+String(run.status||'status unavailable')+(date(run.checked_at)?', '+date(run.checked_at):'')+'. This means the check ran; it does not mean all tools are ready.'));
      const ready=run.result?.ready;doctorReceipt.append(element('p','',ready===true?'The check reports this setup ready.':ready===false?'The check found setup still needed.':'Overall readiness was not supplied.'));
      if(Array.isArray(run.result?.checks))for(const item of run.result.checks){const row=element('div','details');row.append(element('h3','',String(item?.name||'Setup check')),element('p','',String(item?.status||'Status unavailable').replaceAll('_',' ')),element('p','',String(item?.detail||'')));doctorReceipt.append(row);}
      if(run.id)doctorReceipt.append(element('small','receipt','Check receipt '+run.id));
    }
  }
  function render(source){
    sourceID(source?.id);current=source;$('empty-source').hidden=true;$('source-workspace').hidden=false;
    text('video-title',typeof source.title==='string'&&source.title.trim()?source.title:'YouTube video '+String(source.video_id||''));text('source-caption','Saved source #'+source.id+' / '+String(source.transcript_origin||'transcript origin pending').replaceAll('_',' '));
    text('source-status',LABELS[source.status]||'Status unavailable');$('source-status').dataset.tone=source.status==='ready'?'good':['failed','transcript_unavailable'].includes(source.status)?'error':'warning';
    try{$('watch-video').href=sourceLink(source);$('watch-video').hidden=false;}catch{$('watch-video').removeAttribute('href');$('watch-video').hidden=true;}
    text('source-date',date(source.updated_at));
    const stages=sourceStages(source,kind);for(const [key,stage] of Object.entries(stages)){const node=$('stage-'+key);node.dataset.state=stage.state;node.querySelector('span').textContent=stage.text;}
    const active=SOURCE_ACTIVE.has(source.status)||COMPILE_ACTIVE.has(source.compile_status);
    let message=source.error||({queued:'The source is queued. No transcript has been inferred.',fetching:'Retrieving available captions for this video.',indexing:'Saving the obtained source text and its references into NEXEN.',ready:'Source ready. Read the transcript, prepare a draft and review its supported action.',transcript_unavailable:'Captions could not be obtained. Paste a transcript you have permission to use, then save it with the same video link.',failed:'The source operation failed. Review its details and retry explicitly.',cancelled:'The operation was cancelled. Any saved transcript remains available.'}[source.status]||'This source returned an unrecognized status; no progress is assumed.');
    if(source.coverage!==undefined){const coverage=typeof source.coverage==='string'?source.coverage:JSON.stringify(source.coverage);message+='\nCoverage: '+coverage;}
    if(source.retry_available===false&&['failed','transcript_unavailable','cancelled'].includes(source.status))message+='\nNo automatic caption retries remain for this source. A supplied transcript can be saved as a source version.';
    text('source-message',message);$('source-message').dataset.error=String(['failed','transcript_unavailable'].includes(source.status));$('stop-source').hidden=!active;$('retry-source').hidden=source.retry_available!==true;
    renderTranscript();text('memory-receipt',(source.memory_indexed===true?'Indexed in NEXEN memory.':'Memory indexing is not confirmed.')+(source.transcript_sha256?' Transcript SHA-256: '+source.transcript_sha256:''));
    renderArtifact();for(const item of $('recent-sources').querySelectorAll('[data-source-id]'))item.setAttribute('aria-current',String(item.dataset.sourceId===String(source.id)));
    text('last-checked','Source checked '+new Date().toLocaleTimeString()+'. Updates pause while this page is hidden.');
  }
  async function refreshCurrent(){if(!current||busy||disposed)return;const id=sourceID(current.id),token=epoch;try{const source=await api(BASE+'/'+id);if(disposed||token!==epoch||String(current?.id)!==id)return;render(source);}catch(error){if(token===epoch){text('source-message',error.message+'\nLast saved view retained; no new status is assumed.');$('source-message').dataset.error='true';}}}
  async function select(id){if(busy)return;const token=++epoch;try{const source=await api(BASE+'/'+sourceID(id));if(disposed||token!==epoch)return;segmentLimit=80;render(source);$('video-url').value=sourceLink(source);const locationURL=new URL(location.href);locationURL.searchParams.set('source_id',sourceID(source.id));history.replaceState(null,'',locationURL);}catch(error){if(token===epoch)formMessage(error.message,true);}}
  function capabilities(data){const cap=data.capabilities;capabilityState=cap;if(!cap||typeof cap!=='object'){text('service-state','Local source service responded. Detailed retrieval capabilities were not supplied.');return;}const lines=[cap.caption_fetch===true?'Caption retrieval is available; each video can still fail.':'Caption retrieval is not confirmed.',cap.local_model_drafts===true?'Drafting uses your local model.':'Local drafting is not confirmed.',Array.isArray(cap.run_actions)&&cap.run_actions.includes('create_task')?'Supported action: create a planned NEXEN task.':'No supported run action was confirmed.'];text('service-state',lines.join(' '));$('save-manual').hidden=cap.supplied_transcript!==true;}
  async function sources(){try{const data=await api(BASE);if(disposed)return;if(!Array.isArray(data.sources))throw Error('Saved source list is not available yet.');serviceReady=true;capabilities(data);$('recent-sources').replaceChildren();for(const source of data.sources.slice(0,60)){let id;try{id=sourceID(source.id);}catch{continue;}const button=element('button','recent-item',source.title||'YouTube '+String(source.video_id||id));button.type='button';button.dataset.sourceId=id;button.setAttribute('aria-current',String(id===String(current?.id)));button.append(element('small','',(LABELS[source.status]||'Status unavailable')+(date(source.updated_at)?' / '+date(source.updated_at):'')));button.onclick=()=>select(source.id);$('recent-sources').append(button);}if(!$('recent-sources').children.length)$('recent-sources').append(element('p','help','No saved video sources yet. Paste the first link above.'));formMessage('Ready for a video link. Nothing is imported until you start.');text('last-checked','Service checked '+new Date().toLocaleTimeString()+'.');}catch(error){serviceReady=false;formMessage(error.message,true);text('service-state','Service unavailable. Your link and pasted transcript remain here.');}finally{setBusy(busy);}}
  async function models(){try{const data=await api('/api/lab/models');if(disposed)return;$('draft-model').replaceChildren();for(const item of (Array.isArray(data.models)?data.models:[]).slice(0,200)){if(typeof item?.name!=='string')continue;const option=element('option','',item.name);option.value=item.name;$('draft-model').append(option);}modelsLoaded=$('draft-model').options.length>0;if(!modelsLoaded){const option=element('option','','No installed local model available');option.value='';$('draft-model').append(option);}}catch{modelsLoaded=false;$('draft-model').replaceChildren(element('option','','Local model list unavailable'));}buttons();if(current)renderArtifact();}
  async function create(manual=false){if(busy||!serviceReady)return;let parsed;try{parsed=videoURL($('video-url').value);}catch(error){formMessage(error.message,true);$('video-url').focus();return;}const transcript=$('manual-transcript').value.trim();if(manual&&!transcript){formMessage('Paste the transcript text before saving this version.',true);$('manual-transcript').focus();return;}++epoch;setBusy(true);formMessage(manual?'Saving your supplied transcript with its video source...':'Requesting the video transcript...');try{const source=await api(BASE,{url:parsed.url,...(manual?{transcript,transcript_origin:'user_supplied'}:{})});if(disposed)return;segmentLimit=80;render(source);formMessage(manual?'Supplied transcript version accepted. See its actual indexing state.':'Source accepted. Its actual progress is shown on the right.');}catch(error){formMessage(error.message,true);}finally{setBusy(false);}}
  async function operation(name,body){if(busy||!current)return;if(name==='run'&&(!serviceReady||(body.action==='create_task'?!runState(current,capabilityState).canRun:body.action!=='check_agentic_os'||current.video_id!=='w0S-khYCaB4'||!capabilityState?.run_actions?.includes('check_agentic_os')||current.status!=='ready')))return;const id=sourceID(current.id);++epoch;setBusy(true);try{const result=await api(BASE+'/'+id+'/'+name,body);if(disposed)return;if(name==='run'){
      if(body.action==='check_agentic_os'){
        if(result.execution!=='local_readiness_check'||result.action!=='check_agentic_os'||result.source_id!==id)throw Error('The run response did not confirm this source\'s setup check. Refresh its receipt.');
        if(result.source&&typeof result.source==='object')render(result.source);else render({...current,last_run:result});
        text('artifact-status','Local setup check recorded. Review the actual checks below; no tutorial installation or external action is implied.');
      }else{
        if(result.execution!=='local_task_created'||!Number.isSafeInteger(result.task_id)||result.task_id<1)throw Error('The run response did not confirm a created task. Refresh the source before retrying.');
        if(result.source&&typeof result.source==='object')render(result.source);else render({...current,task_id:result.task_id});
        text('artifact-status','Task #'+result.task_id+' created with status '+String(result.status||'unavailable')+'. The video instructions were not executed.');
      }
    }else render(result);}catch(error){text(name==='compile'||name==='run'?'artifact-status':'source-message',error.message);$(name==='compile'||name==='run'?'artifact-status':'source-message').dataset.error='true';}finally{setBusy(false);}}
  function chooseKind(value){if(!KINDS.includes(value))return;kind=value;for(const tab of $('artifact-tabs').querySelectorAll('[data-kind]')){const active=tab.dataset.kind===kind;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}if(current)render(current);else renderArtifact();}
  $('source-form').addEventListener('submit',event=>{event.preventDefault();create(false);});$('save-manual').addEventListener('click',()=>create(true));$('use-example').addEventListener('click',()=>{$('video-url').value=EXAMPLE_URL;formMessage('Your example is pasted. Choose Import video transcript to start.');$('video-url').focus();});$('refresh-sources').addEventListener('click',()=>{sources();if(!modelsLoaded)models();});$('refresh-source').addEventListener('click',refreshCurrent);$('retry-source').addEventListener('click',()=>operation('retry',{}));$('stop-source').addEventListener('click',()=>operation('cancel',{}));$('generate-artifact').addEventListener('click',()=>operation('compile',{kind,model:$('draft-model').value||null}));$('run-artifact').addEventListener('click',()=>operation('run',{action:'create_task'}));
  $('artifact-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-kind]');if(tab)chooseKind(tab.dataset.kind);});$('artifact-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=KINDS.indexOf(kind),next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;chooseKind(KINDS[next]);$('tab-'+kind).focus();});
  doctorButton.addEventListener('click',()=>operation('run',{action:'check_agentic_os'}));
  async function tick(){clearTimeout(pollTimer);if(disposed||polling)return;polling=true;try{if(!doc.hidden)await refreshCurrent();}finally{polling=false;if(!disposed)pollTimer=setTimeout(tick,current&&(SOURCE_ACTIVE.has(current.status)||COMPILE_ACTIVE.has(current.compile_status))?4000:30000);}}
  const visibility=()=>{if(!doc.hidden)tick();};doc.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',()=>{disposed=true;++epoch;clearTimeout(pollTimer);doc.removeEventListener('visibilitychange',visibility);},{once:true});
  sources();models();const initial=new URLSearchParams(location.search).get('source_id');if(initial)select(initial);pollTimer=setTimeout(tick,4000);
}

if(typeof document!=='undefined')initYouTubeMemory();
