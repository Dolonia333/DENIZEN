// One prerequisite view for the dashboard, game and connection room.
if (window.top === window.self || document.getElementById('nexen-required-actions')) {
  const el = (tag, text, cls) => { const n = document.createElement(tag); if(text !== undefined)n.textContent=text; if(cls)n.className=cls; return n; };
  const css=document.createElement('link');css.rel='stylesheet';css.href='/world-assets/action-required.css';document.head.append(css);
  let root=document.getElementById('nexen-required-actions');
  if(!root){root=el('section',undefined,'');root.id='nexen-required-actions';const today=document.getElementById('today');if(today)today.prepend(root);else{root.classList.add('nra-floating');document.body.append(root);}}
  root.classList.add('nra');root.setAttribute('aria-label','Required logins and setup');
  const header=el('div',undefined,'nra-header'),heading=el('h2','Needs you'),tools=el('div',undefined,'nra-tools');
  const voice=el('button','Enable JARVIS alerts'),link=el('a','All required steps');link.href='/connections';tools.append(voice,link);header.append(heading,tools);
  const summary=el('p','Checking required steps…','nra-summary'),list=el('div',undefined,'nra-list'),feedback=el('p','','nra-feedback');feedback.setAttribute('role','status');
  root.append(header,summary,list,feedback);
  let current=[],speakingEnabled=false,lastSignature='',running=false;
  function announce(force=false){
    const signature=current.map(x=>x.id+':'+x.state).join('|');
    if(!speakingEnabled||document.hidden||(!force&&signature===lastSignature))return;
    const voices=window.speechSynthesis?.getVoices().filter(v=>v.localService&&/^en\b/i.test(v.lang))||[];
    const chosen=voices.find(v=>/^en[-_]GB$/i.test(v.lang))||voices[0];
    if(!chosen){feedback.textContent='No installed local English voice is available. Required steps remain visible.';return;}
    lastSignature=signature;
    const message=new SpeechSynthesisUtterance('NEXEN needs you. '+current.slice(0,3).map(x=>x.title+'. '+x.blocks+' is paused.').join(' '));
    message.voice=chosen;message.rate=0.97;message.onend=()=>{feedback.textContent='JARVIS read the current blockers using '+chosen.name+'.';};
    message.onerror=()=>{feedback.textContent='Read-aloud was interrupted. The required steps are still listed.';};
    window.speechSynthesis.cancel();window.speechSynthesis.speak(message);
  }
  voice.onclick=()=>{if(!window.speechSynthesis){feedback.textContent='This browser does not support local read-aloud.';return;}speakingEnabled=!speakingEnabled;voice.textContent=speakingEnabled?'Mute JARVIS alerts':'Enable JARVIS alerts';if(speakingEnabled)announce(true);else window.speechSynthesis.cancel();};
  async function refresh(){
    if(running||document.hidden)return;running=true;
    try{
      const response=await fetch('/api/action-required',{credentials:'same-origin',signal:AbortSignal.timeout(7000)});
      if(response.status===401){summary.textContent='NEXEN is locked. Sign in to check required steps.';list.replaceChildren();return;}
      if(!response.ok)throw Error('Required-step status is temporarily unavailable.');
      const data=await response.json();if(!Array.isArray(data.pending))throw Error('Required-step status is unavailable.');
      if(data.pending.some(item=>!item||typeof item!=='object'||Array.isArray(item)||typeof item.id!=='string'))throw Error('Required-step records are unavailable.');
      current=data.pending.map(item=>({...item,state:typeof item.state==='string'&&item.state.trim()?item.state:'status_unavailable'}));heading.textContent='Required actions · '+current.length;summary.textContent='HUMAN = owner step; BLOCKED = service or executor issue. Provider actions stay paused. Status refreshed '+new Date(data.checked_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+'.';
      const oldFocus=document.activeElement?.dataset?.check;
      list.replaceChildren();
      for(const item of current.slice(0,root.dataset.expanded==='true'?20:3)){
        const card=el('article',undefined,'nra-card'),state=el('small',item.state.replaceAll('_',' ').toUpperCase()),title=el('h3',item.title),body=el('p',item.action),block=el('p','Paused: '+item.blocks,'nra-block');
        const actions=el('div',undefined,'nra-tools'),open=el('a','Open setup');open.href=item.url;
        if(/^https?:/.test(item.url)){open.target='_blank';open.rel='noopener noreferrer';}
        const check=el('button',item.check_request?'Check requested':'Request connection check');check.dataset.check=item.id;
        check.onclick=async()=>{check.disabled=true;try{const r=await fetch('/api/action-required/'+encodeURIComponent(item.id)+'/check',{method:'POST',headers:{'X-Nexen-Action':'launch'},credentials:'same-origin',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Could not record the connection check.');const result=await r.json();feedback.textContent=result.message;await refresh();}catch(e){feedback.textContent=e.message;}finally{check.disabled=false;}};
        const execution=['HUMAN','BLOCKED','AUTOMATABLE'].includes(item.execution_class)?item.execution_class:'BLOCKED';
        const badge=el('strong',execution,'nra-execution '+execution.toLowerCase()),reason=el('p',item.execution_reason||'Execution readiness has not been classified.','nra-evidence');
        if(item.execution_next_step)body.textContent=item.execution_next_step;
        actions.append(open,check);card.append(state,badge,title,reason,body,block,actions);
        if(root.dataset.expanded==='true'){card.append(el('p',item.evidence,'nra-evidence'));}
        list.append(card);
      }
      if(oldFocus)list.querySelector('[data-check="'+oldFocus+'"]')?.focus({preventScroll:true});
      if(root.dataset.expanded==='true')list.append(el('p',data.coverage+' '+data.voice,'nra-evidence'));
      announce();
    }catch(e){summary.textContent=e.message+' Last known blockers remain in place.';}finally{running=false;}
  }
  window.speechSynthesis?.addEventListener('voiceschanged',()=>{if(speakingEnabled)announce(true);});
  refresh();setInterval(refresh,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
}
