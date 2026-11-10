// A read-only view of canonical money tracks. Geometry never grants execution authority.
export const MAX_BUILDINGS = 512;
export const MAX_TRACKS = 506;
export const CORE_SLOTS = Object.freeze({housing:8,lumipaw:9,wdr:10,music:11,'nexen-product':12,other:13});
const validID = id => typeof id === 'string' && /^[a-z0-9-]{1,64}$/.test(id);
const count = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
const clean = (value, max=160) => typeof value === 'string' ? value.slice(0,max) : '';
export function normalizeWorkspace(data) {
  if(!data || !Array.isArray(data.tracks)) throw Error('Business track response is unavailable.');
  const stages = new Map((Array.isArray(data.opportunities)?data.opportunities:[]).slice(0,500)
    .filter(o=>Number.isSafeInteger(o?.id)&&o.id>0).map(o=>[o.id,clean(o.status,24)]));
  const tracks=[], ids=new Set();
  for(const raw of data.tracks.slice(0,MAX_TRACKS)) {
    if(!validID(raw?.id)||ids.has(raw.id))continue;
    ids.add(raw.id);
    const tasks=(Array.isArray(raw.tasks)?raw.tasks:[]).slice(0,500)
      .filter(t=>Number.isSafeInteger(t?.id)&&t.id>0)
      .map(t=>({id:t.id,status:clean(t.status,24),text:clean(t.text,200),next_step:clean(t.next_step,400)}));
    tracks.push({id:raw.id,stationID:'money-'+raw.id,title:clean(raw.title)||raw.id,
      kind:clean(raw.kind,32),description:clean(raw.description,500),
      open:count(raw.open_count),done:count(raw.done_count),blocked:count(raw.blocked_count),
      tasks,next_task_id:tasks.find(t=>t.id===raw.next_task?.id)?.id??null,
      stages:[...new Set((Array.isArray(raw.opportunity_ids)?raw.opportunity_ids:[]).map(id=>stages.get(id)).filter(Boolean))],
      url:'/money?track='+encodeURIComponent(raw.id),counts_scope:'loaded_task_page'});
  }
  return {tracks,updated_at:clean(data.updated_at,80),truncated:data.coverage?.truncated===true,
    track_limit_reached:data.tracks.length>MAX_TRACKS,loaded_tasks:count(data.coverage?.loaded),
    total_tasks:count(data.coverage?.total),source:'canonical_money_workspace',executed:false};
}
function hash(id) {let value=2166136261;for(const c of id)value=Math.imul(value^c.charCodeAt(0),16777619);return value>>>0;}
export function assignSlots(tracks,previous={}) {
  const result={}, used=new Set(Object.values(CORE_SLOTS)), core=new Set(Object.keys(CORE_SLOTS));
  // Retain known placements when new businesses arrive. Only active IDs are persisted.
  for(const track of tracks)if(core.has(track.id))result[track.id]=CORE_SLOTS[track.id];
  for(const track of tracks) {
    if(core.has(track.id))continue;
    const slot=Object.prototype.hasOwnProperty.call(previous,track.id)?previous[track.id]:null;
    if(Number.isInteger(slot)&&slot>=0&&slot<MAX_BUILDINGS&&!used.has(slot)){result[track.id]=slot;used.add(slot);}
  }
  for(const track of [...tracks].sort((a,b)=>a.id.localeCompare(b.id))) {
    if(Object.prototype.hasOwnProperty.call(result,track.id))continue;
    const start=hash(track.id)%MAX_BUILDINGS;
    for(let i=0;i<MAX_BUILDINGS;i++){const slot=(start+i)%MAX_BUILDINGS;if(!used.has(slot)){result[track.id]=slot;used.add(slot);break;}}
  }
  return result;
}
export function lotFor(slot) {
  if(!Number.isInteger(slot)||slot<0||slot>=MAX_BUILDINGS)throw Error('Invalid building slot.');
  return {x:((slot%20)-9.5)*22,z:158+Math.floor(slot/20)*22,w:14,d:12,h:8+(slot%4)*2};
}
export function isMoneyRegion(x,z,r=0) {
  return (Math.abs(x)<=9-r && z>=106 && z<=146) ||
    (Math.abs(x)<=224-r && z>=140+r && z<=724-r);
}
export function trackSummary(track) {
  const n=v=>v===null?'?':v;
  return `${n(track.open)} open · ${n(track.done)} completed · ${n(track.blocked)} blocked`;
}

export function mountMoneyDistrict({THREE,scene,stations,colliders,buildings,player,panel,drawer,directory,onUpdated}) {
  let state={tracks:[],updated_at:'',stale:true,error:'Reading saved businesses…'}, placements={};
  let busy=false,disposed=false,controller=null,checked='',lastLabels=0;
  const records=new Map(), matrix=new THREE.Matrix4(), position=new THREE.Vector3(), rotation=new THREE.Quaternion(), scale=new THREE.Vector3();
  const geometry=new THREE.BoxGeometry(1,1,1), layers=[];
  const group=new THREE.Group();group.name='NEXEN saved business district';scene.add(group);
  function cube(x,y,z,w,h,d,color){const m=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.8}));m.position.set(x,y+h/2,z);m.scale.set(w,h,d);m.receiveShadow=true;group.add(m);return m;}
  cube(0,-.32,432,454,.25,590,0x496779);cube(0,-.065,124,18,.08,40,0x1d3448);
  // Connected roads between lots. The original district and its cars remain intact.
  for(let col=0;col<=20;col++)cube((col-10)*22,-.05,432,7,.08,584,0x233e54);
  for(let row=0;row<=26;row++)cube(0,-.045,147+row*22,448,.08,7,0x233e54);
  const specs=[{color:0x355d79,offset:0,w:14,d:12,height:null},{color:0x82c4df,offset:0,w:14.4,d:12.4,height:.35,roof:true},
    {color:0x142d42,offset:0,w:2.4,d:.12,height:3.2,front:true},{color:0xa7dcff,offset:0,w:.9,d:.9,height:1.35,terminal:true}];
  for(const spec of specs){const material=new THREE.MeshStandardMaterial({color:spec.color,roughness:.6,metalness:.2});
    const mesh=new THREE.InstancedMesh(geometry,material,MAX_BUILDINGS);mesh.count=0;mesh.receiveShadow=true;mesh.frustumCulled=false;group.add(mesh);layers.push({mesh,spec});}
  // Only eight nearby name signs exist, even with 500 opportunities.
  const labels=Array.from({length:8},()=>{
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=160;
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(12,3.75),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
    mesh.visible=false;group.add(mesh);return {canvas,texture,mesh,key:''};
  });
  const button=document.createElement('button');button.type='button';button.textContent='Businesses · checking';
  button.title='Saved business buildings and their canonical task status';button.onclick=()=>directory({businessOnly:true});
  document.querySelector('.tools')?.prepend(button);
  try{const saved=localStorage.getItem('wdr-money-building-slots-v1');if(saved&&saved.length<50000){const data=JSON.parse(saved);if(data&&typeof data==='object'&&!Array.isArray(data))placements=data;}}catch{}
  const colorFor=t=>state.stale?0x7692a3:t.blocked>0||t.stages.includes('blocked')?0xe0ad67:t.open===0&&t.done>0?0x66d5b4:0x78caff;
  function removeOwned(array){for(let i=array.length-1;i>=0;i--)if(array[i].moneyBuilding)array.splice(i,1);}
  function rebuild(){
    removeOwned(stations);removeOwned(colliders);removeOwned(buildings);records.clear();
    placements=assignSlots(state.tracks,placements);
    try{localStorage.setItem('wdr-money-building-slots-v1',JSON.stringify(placements));}catch{}
    state.tracks.forEach((track,index)=>{
      const lot=lotFor(placements[track.id]), color=colorFor(track);
      records.set(track.stationID,{track,lot,index});
      stations.push({id:track.stationID,name:track.title,x:lot.x,z:lot.z+8,color,
        detail:trackSummary(track),moneyBuilding:true,trackID:track.id});
      colliders.push({...lot,moneyBuilding:true});buildings.push({...lot,moneyBuilding:true});
      for(const {mesh,spec}of layers){const h=spec.height??lot.h;
        position.set(lot.x,(spec.roof?lot.h:0)+h/2,lot.z+(spec.front?6.07:spec.terminal?8:0));
        scale.set(spec.w,h,spec.d);matrix.compose(position,rotation,scale);mesh.setMatrixAt(index,matrix);
        if(spec.terminal||spec.roof)mesh.setColorAt(index,new THREE.Color(color));
      }
    });
    for(const {mesh}of layers){mesh.count=state.tracks.length;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
    lastLabels=0;paintOpenStatus();onUpdated?.();
  }
  function paintOpenStatus(){
    button.textContent='Businesses · '+state.tracks.length+(state.stale?' · offline':'');
    button.title=state.stale?'Saved view: '+state.error:'Checked '+checked+' · refreshes every 20 seconds while visible';
    const holder=document.getElementById('game-business-state');if(!holder)return;
    const record=records.get(holder.dataset.station);if(!record){holder.textContent='This business is not in the current catalogue.';return;}
    holder.replaceChildren();
    for(const message of [trackSummary(record.track),
      record.track.stages.length?'Opportunity stage (user reported): '+record.track.stages.join(', '):'Saved '+record.track.kind+' track',
      state.stale?'Connection unavailable; showing the last saved view. '+state.error:'Checked '+checked+' · updates every 20 seconds',
      'Counts cover the loaded task page'+(state.truncated?' (more tasks exist).':'.')+' Task completion does not verify income or provider execution.']){
      const p=document.createElement('p');p.textContent=message;holder.append(p);
    }
    const next=record.track.next_task_id;if(next){const a=document.createElement('a');a.className='route-link';a.href='/next?task_id='+next;a.target='_blank';a.rel='noopener';a.textContent='Open next task #'+next+' ↗';holder.append(a);}
  }
  async function refresh(){
    if(busy||disposed||document.hidden)return;busy=true;controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
    try{const r=await fetch('/api/money/workspace?limit=500',{credentials:'same-origin',signal:controller.signal,cache:'no-store'});
      if(!r.ok)throw Error('Business status returned '+r.status+'.');const parsed=normalizeWorkspace(await r.json());
      if(disposed)return;state={...parsed,stale:false,error:''};checked=new Date().toLocaleTimeString();rebuild();
    }catch(error){if(disposed)return;state={...state,stale:true,error:error.name==='AbortError'?'Status check timed out.':error.message};rebuild();}
    finally{clearTimeout(timer);busy=false;controller=null;}
  }
  function openStation(station){
    const record=records.get(station.id);if(!record)return false;
    panel(record.track.title,'<div id="game-business-state"></div><p><a id="game-business-open" class="route-link" target="_blank" rel="noopener">Full business workspace ↗</a></p><iframe id="game-business-frame" class="task-work-frame" title="Canonical Money Engine business workspace"></iframe>');
    const holder=document.getElementById('game-business-state');holder.dataset.station=station.id;
    document.getElementById('game-business-open').href=record.track.url;
    document.getElementById('game-business-frame').src=record.track.url;
    drawer.classList.add('task-work-drawer');paintOpenStatus();return true;
  }
  function update(time){
    if(time-lastLabels<500)return;lastLabels=time;
    const near=[...records.values()].map(record=>({record,d:Math.hypot(record.lot.x-player.x,record.lot.z-player.z)}))
      .filter(x=>x.d<75).sort((a,b)=>a.d-b.d).slice(0,labels.length);
    labels.forEach((label,index)=>{
      const item=near[index];label.mesh.visible=Boolean(item);if(!item)return;
      const {track,lot}=item.record,key=track.id+'|'+track.title+'|'+trackSummary(track)+'|'+state.stale;
      label.mesh.position.set(lot.x,lot.h-2.4,lot.z+6.12);
      if(key===label.key)return;label.key=key;
      const ctx=label.canvas.getContext('2d');ctx.fillStyle='#102b41';ctx.fillRect(0,0,512,160);
      ctx.fillStyle=state.stale?'#a8becb':'#b7ecff';ctx.textAlign='center';ctx.font='700 34px system-ui';ctx.fillText(track.title,256,60,480);
      ctx.font='500 20px system-ui';ctx.fillText(trackSummary(track),256,106,480);ctx.fillText(state.stale?'LAST SAVED VIEW':'SAVED TASKS · ENTER TO WORK',256,140,480);label.texture.needsUpdate=true;
    });
  }
  const visible=()=>{if(!document.hidden)refresh();};document.addEventListener('visibilitychange',visible);
  const timer=setInterval(refresh,20000);refresh();
  return {openStation,update,refresh,getState:()=>({buildings:state.tracks.length,stale:state.stale,
      checked_at:state.updated_at,counts_scope:'loaded_task_page',executed:false,
      tracks:state.tracks.map(t=>({id:t.id,station_id:t.stationID,slot:placements[t.id],open:t.open,completed:t.done,blocked:t.blocked,next_task_id:t.next_task_id}))}),
    dispose(){disposed=true;clearInterval(timer);controller?.abort();document.removeEventListener('visibilitychange',visible);button.remove();removeOwned(stations);removeOwned(colliders);removeOwned(buildings);scene.remove(group);
      group.traverse(o=>{if(o.material)o.material.dispose();});for(const label of labels){label.texture.dispose();label.mesh.geometry.dispose();}geometry.dispose();}};
}
