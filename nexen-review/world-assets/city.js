import * as THREE from '/vendor/three.module.js';
import {taskWorkIntent} from '/world-assets/workspace-shell.js';
import {mountTaskScene} from '/world-assets/task-scene.js';
import {mountMoneyDistrict,isMoneyRegion} from '/world-assets/game-money.js';

// Original local geometry. Stations read NEXEN; exploration rewards are game XP only.
const $ = (id) => document.getElementById(id);
const embedded = window.parent !== window && new URLSearchParams(location.search).get('embed') === '1';
document.body.classList.toggle('embedded', embedded);
const keys = new Set(), colliders = [], buildings = [], stations = [], cars = [], animated = [];
let renderer, scene, camera, avatar, torsoMaterial, activeCar = null, nearby = null;
let cameraYaw = 0, cameraPitch = .32, cameraDistance = 11, dragging = false;
let last = performance.now(), elapsed = 0, step = 0, hudClock = 0, drawerOpen = false;
let workspaceOpen = false, taskActivity = null, statusBusy = false;
let taskSceneProp = null, taskSceneDispose = null;
let moneyDistrict = null;
let ambientMotion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let noticeTimer, selectedTrack = null;
const player = new THREE.Vector3(-2, 0, 34), cameraTarget = player.clone();
const audio = $('music'), visits = new Set();
const clamp = THREE.MathUtils.clamp;
try { for (const v of JSON.parse(localStorage.getItem('wdr-city-visits') || '[]')) if (typeof v === 'string') visits.add(v); } catch {}
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const materials = new Map();
function material(color, emissive = false) {
  const key = color + ':' + emissive;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({color, roughness:.72, metalness:emissive?.12:.18, emissive:emissive?color:0x000000, emissiveIntensity:emissive?1.3:0}));
  return materials.get(key);
}
const boxGeometry = new THREE.BoxGeometry(1,1,1);
function box(x,y,z,w,h,d,color,parent=scene,solid=false,glow=false) {
  const mesh = new THREE.Mesh(boxGeometry, typeof color === 'object' ? color : material(color,glow));
  mesh.position.set(x,y+h/2,z); mesh.scale.set(w,h,d); mesh.castShadow=h>1; mesh.receiveShadow=true; parent.add(mesh);
  if(solid) colliders.push({x,z,w,d});
  return mesh;
}
function cylinder(x,y,z,r,h,color,parent=scene) {
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,10),material(color)); mesh.position.set(x,y+h/2,z); mesh.castShadow=true; parent.add(mesh); return mesh;
}
function textTexture(text, foreground='#e8fbff', background='#132d45', sub='') {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,1024,256);
  ctx.strokeStyle=foreground;ctx.globalAlpha=.35;ctx.strokeRect(13,13,998,230);ctx.globalAlpha=1;
  ctx.textAlign='center';ctx.fillStyle=foreground;ctx.font='800 105px system-ui';ctx.fillText(text,512,sub?139:162,940);
  if(sub){ctx.font='500 27px system-ui';ctx.fillText(sub,512,207,940);}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function sign(text,x,y,z,w=12,h=3,color='#abecff',sub='') {
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:textTexture(text,color,'#10263b',sub),side:THREE.DoubleSide}));mesh.position.set(x,y,z);scene.add(mesh);return mesh;
}
function windowTexture(seed) {
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=256;const ctx=canvas.getContext('2d');
  ctx.fillStyle=['#36566e','#2a455f','#314763','#344e67'][seed%4];ctx.fillRect(0,0,128,256);
  for(let row=0;row<8;row++)for(let col=0;col<4;col++){
    const lit=(row*7+col*13+seed*11)%9<5;ctx.fillStyle=lit?['#8cbbc9','#ccbe9d','#529bae'][seed%3]:'#19384f';
    ctx.fillRect(col*32+8,row*32+7,17,18);ctx.fillStyle=lit?'#8ba3ad':'#112b41';ctx.fillRect(col*32+8,row*32+20,17,1);
  }
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return t;
}
const facadeMaterials=[];
function building(x,z,w,d,h,seed=1){
  const facade=facadeMaterials[seed%facadeMaterials.length];
  box(x,0,z,w,h,d,facade,scene,true);box(x,h,z,w+.3,.45,d+.3,0x425e75);
  box(x,h+.45,z,w*.45,.9,d*.35,0x263e53);box(x,-.04,z,w+2,.22,d+2,0x61798a);
  buildings.push({x,z,w,d,h});
}
function road(x,z,w,d){box(x,-.07,z,w,.08,d,0x1d3448);}
function tree(x,z){
  cylinder(x,.1,z,.2,2.4,0x455669);const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.9,0),material(0x247b78));crown.position.set(x,3.6,z);crown.scale.y=1.25;crown.castShadow=true;scene.add(crown);
  box(x,0,z,2.6,.22,2.6,0x536e7e);
}
function lamp(x,z,turn=1){
  cylinder(x,0,z,.09,6,0x355367);box(x+turn*.75,5.9,z,1.6,.1,.14,0x597589);box(x+turn*1.45,5.77,z,.52,.12,.45,0xaadfff,scene,false,true);
}
function makeStation(id,name,x,z,color,detail){
  const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);
  cylinder(0,.06,0,1.35,.08,0x213e54,group);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.25,.045,6,36),material(color,true));ring.rotation.x=Math.PI/2;ring.position.y=.14;group.add(ring);
  const diamond=new THREE.Mesh(new THREE.OctahedronGeometry(.42),material(color,true));diamond.position.y=2.9;group.add(diamond);
  box(0,0,0,.85,1.2,.5,0x1b3b52,group);const screen=box(0,1.2,-.02,.95,.7,.08,color,group,false,true);screen.rotation.x=-.2;
  animated.push({object:diamond,base:2.9});
  stations.push({id,name,x,z,color,detail});
}
function city(){
  box(0,-.32,0,234,.25,234,0x486574);
  for(const x of [-66,0,66]) road(x,0,17,226);
  for(const z of [-58,21,77]) road(0,z,226,16);
  for(const x of [-66,0,66])for(let z=-106;z<=106;z+=9)box(x,-.01,z,.18,.018,3.8,0xb4c3c1);
  for(const z of [-58,21,77])for(let x=-106;x<=106;x+=9)if(![-66,0,66].some(c=>Math.abs(c-x)<12))box(x,-.01,z,3.8,.018,.18,0xb4c3c1);
  for(const z of [10,32])for(let x=-7;x<=7;x+=2)box(x,.004,z,1,.02,3.6,0xcbd6d3);
  for(const x of [-11,11]){box(x,-.04,0,.45,.19,222,0xadc4cd);for(let z=-98;z<104;z+=20)lamp(x,z,x>0?-1:1);}
  for(let i=0;i<8;i++)facadeMaterials.push(new THREE.MeshStandardMaterial({color:0xb0cee1,map:windowTexture(i),emissive:0x254962,emissiveMap:windowTexture(i),emissiveIntensity:.23,roughness:.85}));
  // Central plaza, an open computer room, and a factory courtyard.
  box(-30,.01,-6,33,.14,34,0x6e8998);box(-30,.15,-21,34,10,.7,0x19344e,scene,true);
  box(-47,.15,-11,.65,10,21,0x21435c,scene,true);box(-13,.15,-14,.65,10,15,0x21435c,scene,true);
  box(-30,9.8,-11,34,.4,21,0x73bdde);box(-30,.16,-4,31,.02,15,0x3d5d74);
  sign('WDR / NEXEN',-30,7.8,-20.58,26,4,'#b2ebff','MEMORY / KNOWLEDGE / REAL WORK');
  for(let x=-42;x<-18;x+=6){box(x,.15,-16,4,1.3,1.7,0x283e54,scene,true);box(x,1.45,-16.45,3,1.8,.12,0x70e4e7,scene,false,true);box(x,.15,-13.8,1.1,1.2,.8,0x152839);}
  for(let x=-43;x<-16;x+=5)box(x,.17,5,2.6,.1,.1,0x7ee6ff,scene,false,true);
  makeStation('memory','Memory room',-28,-5,0x66e8ff,'Search the conversations and plans actually indexed in NEXEN.');
  building(-32,-40,26,16,12,1);sign('NEXT TASK',-32,8,-31.8,23,3.8,'#c8edff','YOUR SAVED TASK / ONE NEXT STEP');
  makeStation('next','Next Task building',-30,-27,0xbde8ff,'Choose a saved task, see the two work intents, and open its actual workspace.');
  building(32,-19,30,28,14,2);sign('NEXEN FACTORY',32,10,-4.8,27,4,'#90ffdf','LIVE QUEUE / REAL STATUS');
  box(32,.1,4,34,.12,15,0x506e81);for(const x of [23,32,41]){box(x,.22,1,4.8,3,2.2,0x143a4b);box(x,.4,2.16,3.6,1.9,.05,0x37a79f,scene,false,true);}
  makeStation('requests','AI factory',32,7,0x71ffc6,'See live jobs and send a request through the main GUI.');
  building(-32,51,30,24,11,4);sign('WDR SUPPLY',-32,8,63.15,24,3.7,'#d0beff','ORIGINAL WDR / CITY WARDROBE');
  makeStation('wardrobe','WDR wardrobe',-31,68,0xcfb2ff,'Choose your WDR shirt color. Cosmetic changes are free.');
  building(32,51,30,24,13,3);sign('LUMIPAW',32,9,63.2,23,3.9,'#bdfed6','STORE / ADS / NEXT STEPS');
  makeStation('store','Lumipaw studio',29,68,0xb8fa9b,'Open the real store controls. Ads are not running.');
  building(-31,-83,31,26,19,7);sign('WDR SOUND',-31,13,-69.8,26,4.4,'#9edbff','YOUR LOCAL MUSIC / PRESS PLAY');
  makeStation('music','WDR Sound',-28,-66,0x9cc8ff,'Play your indexed local tracks. No music starts automatically.');
  building(31,-85,32,24,22,0);sign('SIGNAL',31,16,-72.8,24,4,'#9afff2','DISCORD / THE FIRST PRIORITY');
  makeStation('digest','Signal / Discord',28,-66,0x6ef8d0,'Read the real Discord digest in the main GUI.');
  makeStation('control','Control tower',-15,42,0xffcf99,'Service status and the allowed PC controls.');
  makeStation('skills','Skills arcade',17,42,0x9ed1ff,'Browse the local reference skill library.');
  // Outer city blocks frame the playable streets; all structures collide.
  for(const x of [-95,95])for(const [i,z] of [-92,-25,49,99].entries()) building(x,z,20,24,18+(i*13+(x>0?11:3))%35,i+3);
  for(const x of [-45,43])building(x,102,25,22,24+(x>0?17:0),5);
  for(const x of [-99,-77,76,100])building(x,5,14,18,20+Math.abs(x)%27,Math.abs(x)%8);
  // Distant skyline is scenery, outside the playable district.
  for(let i=0;i<25;i++){const x=-165+i*14,z=-150-(i%3)*9,h=25+(i*19)%65;box(x,0,z,10+(i%3)*3,h,12,0x3a617d);}
  for(const x of [-53,53])for(const z of [-42,0,40,65,91])tree(x,z);
  for(const z of [38,46]){box(-23,0,z,5,.65,1.1,0x29485b);box(-23,.7,z+.4,5,.65,.2,0x486b7e);}
  for(const x of [-110,110])box(x,0,0,.4,1,220,0x96bac6,scene,true);
  box(0,0,-110,220,1,.4,0x96bac6,scene,true);
  // South avenue joins the business district; the rest of the central boundary stays solid.
  for(const x of [-60,60])box(x,0,110,100,1,.4,0x96bac6,scene,true);
  sign('DA MONEY',0,7,112,16,3,'#a8e7ff','YOUR BUSINESSES / DRIVE SOUTH');
  // Original abstract WDR landmark.
  const monument=new THREE.Mesh(new THREE.TorusKnotGeometry(2.1,.43,60,8),material(0x70cfff,true));monument.position.set(20,5,30);scene.add(monument);animated.push({object:monument,base:5});
  cylinder(20,.1,30,3.3,.65,0x234963);
}
function createAvatar(){
  const group=new THREE.Group();torsoMaterial=new THREE.MeshStandardMaterial({color:0x286bbb,roughness:.8});
  try{const c=localStorage.getItem('wdr-shirt');if(/^#[\da-f]{6}$/i.test(c||''))torsoMaterial.color.set(c);}catch{}
  box(0,.9,0,.74,.82,.4,torsoMaterial,group);box(0,1.73,0,.42,.45,.43,0xc2957f,group);
  // Blonde curls above a close taper: original procedural avatar geometry.
  const curlGeometry=new THREE.IcosahedronGeometry(.11,1);
  const shades=[0xe4b45d,0xf6ce79,0xd49a44,0xffdd93];
  for(let ring=0;ring<3;ring++){
    const count=ring===2?7:12,radius=ring===2?.18:.31,y=2.17+ring*.12;
    for(let i=0;i<count;i++){
      const a=i/count*Math.PI*2+ring*.25,curl=new THREE.Mesh(curlGeometry,material(shades[(i+ring)%4]));
      curl.position.set(Math.cos(a)*radius,y+Math.sin(i*2.1)*.025,Math.sin(a)*radius);
      curl.scale.set(1,.95,1);curl.castShadow=true;group.add(curl);
    }
  }
  const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(.22,2),material(0xf2c36b));crown.position.y=2.40;group.add(crown);
  for(const side of [-1,1])for(let i=0;i<5;i++){
    const taper=new THREE.Mesh(new THREE.SphereGeometry(.043,6,4),material(0xc58b3e));
    taper.position.set(side*.224,2.03+i*.019,-.14+i*.065);group.add(taper);
  }
  for(const x of [-.105,.105]){box(x,1.98,-.222,.07,.04,.018,0x20303a,group);}

  const limbs=[];
  for(const x of [-.25,.25]){const leg=new THREE.Group();leg.position.set(x,.92,0);group.add(leg);box(0,-.76,0,.24,.76,.28,0x243e59,leg);box(0,-.88,-.07,.3,.14,.45,0xe4e9ed,leg);limbs.push(leg);}
  for(const x of [-.49,.49]){const arm=new THREE.Group();arm.position.set(x,1.6,0);group.add(arm);box(0,-.6,0,.23,.58,.27,torsoMaterial,arm);box(0,-.76,0,.2,.21,.23,0xc2957f,arm);limbs.push(arm);}
  const logoMap=textTexture('WDR','#ecfaff','#2463a3');const logo=new THREE.Mesh(new THREE.PlaneGeometry(.62,.2),new THREE.MeshBasicMaterial({map:logoMap}));logo.position.set(0,1.43,.207);group.add(logo);
  const logoFront=logo.clone();logoFront.rotation.y=Math.PI;logoFront.position.z=-.207;group.add(logoFront);
  group.userData.limbs=limbs;scene.add(group);return group;
}
function makeCar(x,z,color,rotation=0){
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rotation;scene.add(g);
  const paint=new THREE.MeshStandardMaterial({color,roughness:.29,metalness:.48});
  const black=new THREE.MeshStandardMaterial({color:0x111922,roughness:.38,metalness:.25});
  const glass=new THREE.MeshStandardMaterial({color:0x284a58,roughness:.13,metalness:.6});
  // A compact, original WDR luxury SUV with a floating roof and upright silhouette.
  function shell(y,w,h,d,mat){
    const r=.09,shape=new THREE.Shape();
    shape.moveTo(-w/2+r,-h/2);shape.lineTo(w/2-r,-h/2);
    shape.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);shape.lineTo(w/2,h/2-r);
    shape.quadraticCurveTo(w/2,h/2,w/2-r,h/2);shape.lineTo(-w/2+r,h/2);
    shape.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);shape.lineTo(-w/2,-h/2+r);
    shape.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
    const geo=new THREE.ExtrudeGeometry(shape,{depth:d-.1,bevelEnabled:true,bevelThickness:.05,bevelSize:.025,bevelSegments:2,steps:1,curveSegments:3});
    geo.center();const mesh=new THREE.Mesh(geo,mat);mesh.position.y=y+h/2;mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);return mesh;
  }
  shell(.48,2.22,.92,4.15,paint);
  box(0,.43,0,2.25,.21,4.13,black,g);
  const cabin=shell(1.34,1.96,.94,2.83,glass);cabin.position.z=.35;
  const roof=shell(2.25,2.08,.15,2.96,black);roof.position.z=.35;
  box(0,1.365,-1.6,2.08,.08,.87,paint,g);
  box(0,2.20,1.9,2.14,.12,.3,black,g);
  // Contrasting pillars, belt line, flush door handles, mirrors and side steps.
  for(const side of [-1,1]){
    box(side*.995,1.37,-.06,.075,.92,.105,black,g);
    box(side*.995,1.37,1.10,.075,.92,.10,black,g);
    box(side*1.002,1.38,1.63,.1,.87,.24,paint,g);
    box(side*1.02,1.32,.37,.04,.055,2.85,black,g);
    for(const dz of [-.32,.76])box(side*1.125,1.12,dz,.035,.045,.28,black,g);
    box(side*1.13,1.52,-.82,.29,.15,.3,black,g);
    box(side*1.19,.49,.1,.20,.1,2.15,black,g);
    for(const dz of [-1.3,1.3]){
      const arch=new THREE.Mesh(new THREE.TorusGeometry(.53,.075,5,16,Math.PI),black);
      arch.rotation.y=Math.PI/2;arch.position.set(side*1.14,.63,dz);g.add(arch);
      const axle=new THREE.Group();axle.position.set(side*1.14,.52,dz);g.add(axle);
      const tire=new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,.32,20),material(0x10151b));
      tire.rotation.z=Math.PI/2;axle.add(tire);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,.337,16),material(0x72818c));hub.rotation.z=Math.PI/2;axle.add(hub);
      for(let n=0;n<5;n++){
        const spoke=box(side*.181,-.265,0,.025,.53,.065,0xd9e6e9,axle);
        spoke.rotation.x=n*Math.PI/5;
      }
      const cap=new THREE.Mesh(new THREE.CylinderGeometry(.095,.095,.355,12),black);cap.rotation.z=Math.PI/2;axle.add(cap);
      g.userData.wheels??=[];g.userData.wheels.push(axle);
    }
    box(side*.78,1.11,-2.092,.54,.105,.035,0xd9f8ff,g,false,true);
    box(side*.98,.97,-2.095,.07,.20,.037,0xd9f8ff,g,false,true);
    box(side*.90,1.01,2.099,.25,.13,.04,0xff4f60,g,false,true);
    box(side*.86,.73,2.11,.14,.08,.04,0xfc6571,g,false,true);
  }
  box(0,.83,-2.104,1.04,.35,.045,black,g);
  for(const y of [.91,1.03,1.15])box(0,y,-2.137,.92,.023,.018,0x77868c,g);
  box(0,.50,-2.11,1.47,.19,.09,black,g);box(0,.50,2.11,1.55,.15,.08,black,g);
  box(0,1.07,2.115,1.31,.035,.025,0xfb6f78,g,false,true);
  const plateMap=textTexture('WDR','#def6ff','#17202a');
  for(const [dz,ry]of [[-2.17,Math.PI],[2.17,0]]){
    const badge=new THREE.Mesh(new THREE.PlaneGeometry(.62,.15),new THREE.MeshBasicMaterial({map:plateMap}));
    badge.position.set(0,.72,dz);badge.rotation.y=ry;g.add(badge);
  }
  const car={group:g,speed:0,label:'WDR Mini Rover'};cars.push(car);return car;
}

function blocked(x,z,r,ignoreCar=null){
  if((Math.abs(x)>108-r||Math.abs(z)>108-r)&&!isMoneyRegion(x,z,r))return true;
  if(colliders.some(b=>Math.hypot(x-clamp(x,b.x-b.w/2,b.x+b.w/2),z-clamp(z,b.z-b.d/2,b.z+b.d/2))<r))return true;
  return cars.some(car=>car!==ignoreCar&&Math.hypot(x-car.group.position.x,z-car.group.position.z)<r+1.4);
}
function move(pos,dx,dz,r,ignoreCar=null){
  let collided=false;
  if(!blocked(pos.x+dx,pos.z,r,ignoreCar))pos.x+=dx;else collided=true;
  if(!blocked(pos.x,pos.z+dz,r,ignoreCar))pos.z+=dz;else collided=true;
  return collided;
}
function toast(text){$('notice').textContent=text;$('notice').style.display='block';clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').style.display='none',4300);}
function visited(id){
  if(visits.has(id))return;visits.add(id);try{localStorage.setItem('wdr-city-visits',JSON.stringify([...visits]));}catch{}
  $('xp').textContent=visits.size*25+' exploration XP';toast('+25 exploration XP · a game reward, not money');
}
function closeDrawer(){taskSceneDispose?.();taskSceneDispose=null;clearDirectedScene();drawerOpen=false;taskActivity=null;$('drawer').classList.remove('task-work-drawer');$('drawer').style.display='none';keys.clear();renderer.domElement.focus();}
function panel(title,content){
  taskSceneDispose?.();taskSceneDispose=null;clearDirectedScene();
  window.dispatchEvent(new CustomEvent('nexen:station-open'));taskActivity=null;$('drawer').classList.remove('task-work-drawer');
  keys.clear();drawerOpen=true;$('drawer').innerHTML='<button class="close" aria-label="Close panel">×</button><h2>'+escapeHTML(title)+'</h2>'+content;$('drawer').style.display='block';$('drawer').querySelector('.close').onclick=closeDrawer;
}
function openParent(view){
  if(embedded){window.parent.postMessage({type:'nexen:open',view},location.origin);keys.clear();return true;}
  return false;
}
function mainLink(view,label='Open main GUI'){return '<a class="route-link" href="/#'+encodeURIComponent(view)+'">'+escapeHTML(label)+' ↗</a>';}
function directory(options={}){
  panel('Choose your next stop','<p>Walk or drive south to Da Money, or fast travel to a saved business. Buildings read the same tasks as Money Engine.</p><input id="station-filter" aria-label="Find a station or business" placeholder="Find your business or station…"><label><input id="business-only" type="checkbox" style="width:auto"> Businesses only</label><p id="station-count" class="hint"></p><div id="station-results" class="stationlist"></div><button id="station-more" class="toolbutton">Show more</button><p>WASD walks relative to the camera. E opens a terminal or enters a car. Space brakes. Exploration XP does not represent earnings or completed work.</p>');
  $('business-only').checked=options.businessOnly===true;
  let shown=30;
  function render(){
    const query=$('station-filter').value.toLocaleLowerCase(),businessOnly=$('business-only').checked;
    const found=stations.filter(s=>(!businessOnly||s.moneyBuilding)&&s.name.toLocaleLowerCase().includes(query));
    $('station-count').textContent=found.length+' stops · '+Math.min(shown,found.length)+' shown'+(moneyDistrict?.getState().stale?' · business connection unavailable':'');
    $('station-results').innerHTML=found.slice(0,shown).map(s=>'<button data-travel="'+escapeHTML(s.id)+'">'+escapeHTML(s.name)+'<small>'+escapeHTML(s.moneyBuilding?s.detail:'Fast travel to station')+'</small></button>').join('');
    $('station-more').hidden=shown>=found.length;
    $('station-results').querySelectorAll('[data-travel]').forEach(b=>b.onclick=()=>{const s=stations.find(s=>s.id===b.dataset.travel);if(!s)return;if(activeCar){activeCar.speed=0;activeCar=null;avatar.visible=true;}player.set(s.x+2.2,0,s.z+3);cameraYaw=0;cameraTarget.copy(player);closeDrawer();toast(s.name+' · walk onto the terminal and press E');});
  }
  $('station-filter').oninput=()=>{shown=30;render();};$('business-only').onchange=()=>{shown=30;render();};$('station-more').onclick=()=>{shown+=30;render();};$('station-results').refresh=render;render();
}
async function memory(){
  if(openParent('memory'))return;
  panel('NEXEN memory','<p>Search conversations already indexed. Original messages remain source material.</p><form id="memory-form" class="row"><input id="memory-query" placeholder="NEXEN, music, Lumipaw…" aria-label="Search memory"><button class="toolbutton">Search</button></form><div id="memory-results"></div>'+mainLink('memory','Open full memory GUI'));
  $('memory-form').onsubmit=async e=>{e.preventDefault();const output=$('memory-results');output.textContent='Searching local memory…';try{const r=await fetch('/api/memory?q='+encodeURIComponent($('memory-query').value));if(!r.ok)throw Error('Memory service returned '+r.status);const data=await r.json();output.innerHTML=(data.results||[]).map(h=>'<article class="hit"><strong>'+escapeHTML(h.title)+'</strong><small>'+escapeHTML(h.ts)+' · '+escapeHTML(h.role)+'</small><pre>'+escapeHTML(h.text)+'</pre></article>').join('')||'<p>No matching indexed conversations.</p>';}catch(err){output.textContent=err.message;}};
}
async function factory(){
  if(openParent('requests'))return;
  panel('NEXEN factory','<p>This terminal reads the real job queue. The city animation does not execute AI tasks.</p><div id="factory-live">Reading queue…</div>'+mainLink('requests','Open requests & task controls'));
  try{const r=await fetch('/api/hub');if(!r.ok)throw Error('Status service returned '+r.status);const {status:s={}}=await r.json();const live=$('factory-live');if(live)live.innerHTML='<div class="hit"><strong>'+escapeHTML(s.running_jobs??0)+' running · '+escapeHTML(s.queued_jobs??0)+' queued</strong><p>'+escapeHTML(s.failed_jobs??0)+' failed jobs · '+escapeHTML(s.awaiting_approval??0)+' awaiting approval</p><small>'+escapeHTML(s.compiled_workflows??0)+' compiled workflows · compilation does not mean executed</small></div>';}catch(err){const live=$('factory-live');if(live)live.textContent=err.message;}
}
async function nextTasks(refreshOnly=false){
  if(!refreshOnly)panel('Next Task building','<p>These are saved NEXEN tasks. Choose one to prepare both work intents and open its real guide.</p><div id="next-building-tasks">Reading the shared task records…</div><p id="next-building-checked" class="hint">Checks every 30 seconds while this menu is open.</p><a class="route-link" href="/next" target="_blank" rel="noopener">Full task workspace ↗</a>');
  if(!$('next-building-tasks'))return;
  const target=$('next-building-tasks'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const r=await fetch('/api/next',{credentials:'same-origin',signal:controller.signal});if(!r.ok)throw Error('Saved tasks unavailable ('+r.status+').');const data=await r.json();if(!Array.isArray(data.tasks))throw Error('Task list format unavailable.');if(!target.isConnected)return;target.replaceChildren();
    for(const task of data.tasks.filter(t=>Number.isSafeInteger(t?.id)&&t.id>0&&t.status!=='done')){const b=document.createElement('button');b.className='track';b.textContent='#'+task.id+' · '+String(task.text||'Saved task');const small=document.createElement('small');small.textContent=String(task.status||'unknown')+' · Open task work';b.append(small);b.onclick=()=>startTaskWork(taskWorkIntent(task));target.append(b);}
    if(!target.children.length)target.textContent='No open tasks in the current shared response. Add a task through the task room.';
    if($('next-building-checked'))$('next-building-checked').textContent='Shared tasks checked '+new Date().toLocaleTimeString()+' · refreshes every 30 seconds.';
  }catch(error){if(target.isConnected)target.textContent=error.name==='AbortError'?'Saved task check timed out. Try again.':error.message;}finally{clearTimeout(timer);}
}
function startTaskWork(intent){
  if(!Number.isSafeInteger(intent?.task_id)||intent.task_id<1||intent.url!=='/next?task_id='+intent.task_id){toast('Choose a saved task with a verified ID.');return;}
  if(activeCar){activeCar.speed=0;if(!exitCar())return;}
  const id=intent.task_id,avatarPrompt=String(intent.avatar_prompt||'').slice(0,1200),guidePrompt=String(intent.guide_prompt||'').slice(0,1200);
  panel('Task #'+id+' · work room','<span class="badge">PREPARED INTENTS · NO AUTOMATIC COMPLETION</span><details class="task-work-intents"><summary>View both work intents</summary><p><strong>Avatar activity:</strong> '+escapeHTML(avatarPrompt)+'</p><p><strong>Actual task / guide:</strong> '+escapeHTML(guidePrompt)+'</p></details><p class="task-work-note">A valid local model response selects an original avatar illustration. Real actions and completion stay in the task controls below.</p><a class="route-link" href="/next?task_id='+id+'" target="_blank" rel="noopener">Open task #'+id+' in a full workspace ↗</a><iframe class="task-work-frame" src="/next?task_id='+id+'" title="Actual NEXEN task '+id+' controls" allow="microphone; camera"></iframe>');
  $('drawer').classList.add('task-work-drawer');taskActivity=null;
  const sceneRoot=document.createElement('section');$('drawer').querySelector('.task-work-frame').before(sceneRoot);
  taskSceneDispose=mountTaskScene(sceneRoot,intent,applyDirectedScene,clearDirectedScene);
  toast('Task #'+id+' open · requesting a local scene illustration');
}
function clearDirectedScene(){
  if(taskSceneProp){avatar?.remove(taskSceneProp);const owned=new Set();taskSceneProp.traverse(object=>{if(object.geometry&&object.geometry!==boxGeometry)owned.add(object.geometry);});owned.forEach(geometry=>geometry.dispose());taskSceneProp=null;}
  taskActivity=null;
}
function applyDirectedScene(plan){
  clearDirectedScene();if(!drawerOpen||!avatar)return;
  taskActivity={task_id:plan.task_id,case_id:plan.case_id,scene:plan.scene,action:plan.action,receipt_id:plan.receipt_id,kind:'local_model_directed_illustration',executed:false,xp_awarded:0};
  taskSceneProp=new THREE.Group();avatar.add(taskSceneProp);
  if(plan.scene==='cleaning'){
    taskSceneProp.position.set(.52,.04,-.56);taskSceneProp.rotation.z=-.18;
    box(0,.18,0,.065,1.38,.065,0xa9845b,taskSceneProp);box(0,.02,0,.68,.16,.23,0xb9d5d9,taskSceneProp);
    for(let i=0;i<6;i++)box(-.29+i*.115,0,0,.04,.11,.25,0x78adc2,taskSceneProp);
    for(let i=0;i<4;i++){const speck=new THREE.Mesh(new THREE.IcosahedronGeometry(.045,0),material(0xb5d9e7));speck.position.set((i-1.5)*.28,.1,-.2);taskSceneProp.add(speck);}
  }else if(plan.scene==='coding'||plan.scene==='planning'){
    taskSceneProp.position.set(0,1.0,-.65);taskSceneProp.rotation.x=-.32;
    box(0,0,0,.95,.57,.065,plan.scene==='coding'?0x102e43:0xc1cfcf,taskSceneProp);
    box(0,.05,-.04,.83,.45,.018,plan.scene==='coding'?0x64b5ce:0xe3e6de,taskSceneProp,false,plan.scene==='coding');
    for(let i=0;i<3;i++)box(0,.1+i*.11,-.055,.58,.018,.012,plan.scene==='coding'?0xc5eefa:0x6d8d9d,taskSceneProp);
  }else if(plan.scene==='music'){
    taskSceneProp.position.set(0,.8,-.72);box(0,0,0,1.1,.22,.48,0x153b52,taskSceneProp);
    for(let i=0;i<4;i++)box(-.38+i*.25,.23,0,.11,.07,.25,i%2?0x92d4e3:0xb9aedf,taskSceneProp);
  }else if(plan.scene==='rest'){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.68,.018,5,40),material(0xa6d1c4,true));ring.rotation.x=Math.PI/2;ring.position.y=.045;taskSceneProp.add(ring);
  }
  toast('Task #'+plan.task_id+' · '+plan.scene+' scene from local model · illustration only');
}
function wardrobe(){
  const colors=[['Ocean blue','#286bbb'],['WDR black','#18283e'],['Mint','#329b8d'],['Violet','#7653ad'],['Ivory','#d8d9ce']];
  panel('WDR Supply','<span class="badge">FREE COSMETIC · NO PURCHASE</span><p>Your avatar, your WDR uniform. Choose a shirt color; it is saved in this browser.</p><div class="swatches">'+colors.map(([name,color])=>'<button aria-label="'+name+'" aria-pressed="'+('#'+torsoMaterial.color.getHexString()===color)+'" data-color="'+color+'" style="background:'+color+'"></button>').join('')+'</div><p>Original geometric avatar. Downloaded avatar models can be integrated when a verified asset is provided.</p>');
  $('drawer').querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{torsoMaterial.color.set(b.dataset.color);try{localStorage.setItem('wdr-shirt',b.dataset.color);}catch{}$('drawer').querySelectorAll('[data-color]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));toast('WDR uniform updated');});
}
async function music(){
  panel('WDR Sound','<p>Your indexed local tracks. Select a track and press play. Audio never starts on page load.</p><div id="music-player"></div><div id="tracks">Loading local library…</div>');
  audio.hidden=false;audio.controls=true;$('music-player').append(audio);
  try{
    const r=await fetch('/api/music');if(!r.ok)throw Error('Music library is unavailable ('+r.status+').');const data=await r.json();const holder=$('tracks');if(!holder)return;
    const tracks=Array.isArray(data.tracks)?data.tracks:[];
    holder.innerHTML=tracks.length?tracks.map((t,i)=>'<button class="track" data-track="'+i+'" aria-pressed="'+(String(t.id)===selectedTrack)+'">'+escapeHTML(t.title)+'<small>'+escapeHTML(t.collection||'Local library')+'</small></button>').join(''):'<p>No playable local tracks are indexed yet.</p>';
    holder.querySelectorAll('[data-track]').forEach(b=>b.onclick=async()=>{const track=tracks[Number(b.dataset.track)];try{const url=new URL(track.url,location.origin);if(url.origin!==location.origin||!['http:','https:'].includes(url.protocol))throw Error('Only local library audio is accepted.');audio.src=url.href;selectedTrack=String(track.id);$('musicdock').style.display='block';$('musicdock').querySelector('span').textContent=track.title;holder.querySelectorAll('[data-track]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));await audio.play();}catch(err){toast('Could not play this track: '+err.message);}});
  }catch(err){const holder=$('tracks');if(holder)holder.textContent=err.message;}
}
function station(s){
  visited(s.id);
  if(s.moneyBuilding)return moneyDistrict?.openStation(s);
  if(s.id==='memory')return memory();if(s.id==='requests')return factory();if(s.id==='wardrobe')return wardrobe();if(s.id==='music')return music();if(s.id==='next')return nextTasks();
  if(openParent(s.id))return;
  panel(s.name,'<p>'+escapeHTML(s.detail)+'</p>'+(s.id==='store'?'<p><a href="/money" target="_blank" rel="noopener">Open Money Engine</a> · <a href="/lookbook" target="_blank" rel="noopener">WDR lookbook</a> · <a href="/connections" target="_blank" rel="noopener">Required setup</a></p>':'')+mainLink(s.id,'Open '+s.name)+(s.id==='store'?'<p>Lumipaw ads remain stopped until checkout, an ad account, and launch readiness are configured. Authorized test ceiling: $50 total, with a $50/day maximum. This station does not spend money.</p>':''));
}
function exitCar(){
  if(!activeCar)return false;if(Math.abs(activeCar.speed)>1){toast('Brake to a stop before leaving the car.');return false;}
  const p=activeCar.group.position;let target=null;
  for(const [dx,dz]of [[3,0],[-3,0],[0,4],[0,-4],[4,4],[-4,-4]])if(!blocked(p.x+dx,p.z+dz,.45,activeCar)){target=[p.x+dx,p.z+dz];break;}
  if(!target){toast('Move the car into an open area to exit.');return false;}
  player.set(target[0],0,target[1]);activeCar.speed=0;activeCar=null;avatar.visible=true;return true;
}
function interact(){
  if(drawerOpen)return;
  if(activeCar){exitCar();return;}
  if(!nearby){toast('Approach a glowing station or a parked WDR car.');return;}
  if(nearby.car){activeCar=nearby.car;avatar.visible=false;cameraYaw=activeCar.group.rotation.y;toast('WDR Mini Rover · W/S accelerate · A/D steer · Space brake · V exit');}
  else station(nearby);
}
function updateNearby(){
  const p=activeCar?activeCar.group.position:player;nearby=null;let distance=5.5;
  if(!activeCar){for(const s of stations){const d=Math.hypot(p.x-s.x,p.z-s.z);if(d<distance){nearby=s;distance=d;}}for(const c of cars){const d=p.distanceTo(c.group.position);if(d<distance){nearby={car:c};distance=d;}}}
  const prompt=$('interact');prompt.style.display=(activeCar||nearby)?'block':'none';
  if(activeCar){prompt.querySelector('strong').textContent='V · Exit WDR Mini Rover';prompt.querySelector('small').textContent=Math.abs(activeCar.speed)>1?'Space to brake before exiting':'Parked · exit and explore';}
  else if(nearby){prompt.querySelector('strong').textContent=nearby.car?'E · Drive WDR Mini Rover':'E · '+nearby.name;prompt.querySelector('small').textContent=nearby.car?'Your ride through WDR City':'Open this NEXEN station';}
  $('movement').textContent=activeCar?'ARCADE DRIVING · WDR MINI ROVER':(keys.has('shift')?'SPRINTING · SHIFT':'ON FOOT · HOLD SHIFT TO SPRINT');$('speed').hidden=!activeCar;
  if(activeCar)$('speed').innerHTML=Math.round(Math.abs(activeCar.speed)*3.6)+'<i>KM/H</i>';
  $('district').textContent=p.z>120?'Da Money · your business district':p.z<-55?'WDR Creative District':p.z>45?'Supply & Commerce':p.x>15?'NEXEN Factory District':p.x<-15?'WDR Knowledge Quarter':'WDR Central';
}
function updateMap(){
  const ctx=$('minimap').getContext('2d'),w=300,h=256;ctx.clearRect(0,0,w,h);ctx.fillStyle='#0b1c2e';ctx.fillRect(0,0,w,h);
  const inBusiness=player.z>120, scale=inBusiness?.8:1.12;
  const toX=x=>w/2+(x-(inBusiness?player.x:0))*scale,toZ=z=>h/2+(z-(inBusiness?player.z:0))*scale;
  $('map-caption').textContent=inBusiness?'DA MONEY / LOCAL AREA / NORTH ↑':'WDR CENTRAL / NORTH ↑';
  ctx.fillStyle='#244257';for(const x of [-66,0,66])ctx.fillRect(toX(x-8.5),0,17*scale,h);for(const z of [-58,21,77])ctx.fillRect(0,toZ(z-8),w,16*scale);
  ctx.fillStyle='#3b5c70';for(const b of buildings)ctx.fillRect(toX(b.x-b.w/2),toZ(b.z-b.d/2),b.w*scale,b.d*scale);
  ctx.fillRect(toX(-47),toZ(-22),34*scale,24*scale);
  for(const s of stations){ctx.fillStyle='#'+new THREE.Color(s.color).getHexString();ctx.beginPath();ctx.arc(toX(s.x),toZ(s.z),3.5,0,Math.PI*2);ctx.fill();}
  for(const car of cars){ctx.fillStyle='#93b5c9';ctx.fillRect(toX(car.group.position.x)-2,toZ(car.group.position.z)-3,4,6);}
  const p=activeCar?activeCar.group.position:player,yaw=activeCar?activeCar.group.rotation.y:avatar.rotation.y;
  ctx.save();ctx.translate(toX(p.x),toZ(p.z));ctx.rotate(-yaw);ctx.fillStyle='#fff';ctx.shadowColor='#77ddff';ctx.shadowBlur=8;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(5,5);ctx.lineTo(0,3);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.restore();
}
async function refreshStatus(){
  if(statusBusy||document.hidden)return;statusBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  if($('next-building-tasks'))nextTasks(true);
  try{const r=await fetch('/api/hub',{credentials:'same-origin',signal:controller.signal});if(!r.ok)throw Error();const {status:s={}}=await r.json();const count=n=>Number.isSafeInteger(n)&&n>=0?n:'?';$('job-status').textContent=count(s.running_jobs)+' running / '+count(s.queued_jobs)+' queued';$('job-status').title='Real NEXEN job status · checked '+new Date().toLocaleTimeString();document.querySelector('.status').dataset.ready=String(Number.isSafeInteger(s.running_jobs)&&Number.isSafeInteger(s.queued_jobs));}
  catch{$('job-status').textContent='NEXEN status unavailable';document.querySelector('.status').dataset.ready='false';}
  finally{clearTimeout(timer);statusBusy=false;}
}
function reset(){if(activeCar){activeCar.speed=0;activeCar=null;}player.set(-2,0,34);avatar.visible=true;cameraYaw=0;cameraPitch=.32;cameraDistance=11;cameraTarget.copy(player);closeDrawer();toast('Returned to WDR Central');}
function controls(){
  window.addEventListener('nexen:workspace-focus',event=>{workspaceOpen=event.detail?.open===true;keys.clear();dragging=false;if(workspaceOpen&&drawerOpen){taskSceneDispose?.();taskSceneDispose=null;clearDirectedScene();drawerOpen=false;taskActivity=null;$('drawer').style.display='none';}});
  window.addEventListener('nexen:task-work',event=>startTaskWork(event.detail));
  window.addEventListener("nexen:cinema-focus",()=>{keys.clear();dragging=false;});
  const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','WDR city. WASD to walk, E to interact, drag to orbit.');
  addEventListener('keydown',e=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||e.target?.closest?.('.workspace-activity,.nv-panel,#nexen-task-workspace'))return;
    const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' '].includes(key))e.preventDefault();
    if(key==='escape'){closeDrawer();return;}if(drawerOpen||workspaceOpen)return;
    keys.add(key);if(e.repeat)return;if(key==='e')interact();if(key==='v'){if(activeCar)exitCar();else interact();}if(key==='m')directory();
  });
  addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));addEventListener('blur',()=>{keys.clear();dragging=false;});
  canvas.addEventListener('pointerdown',e=>{dragging=true;canvas.setPointerCapture(e.pointerId);canvas.focus();});
  canvas.addEventListener('pointermove',e=>{if(dragging){cameraYaw-=e.movementX*.006;cameraPitch=clamp(cameraPitch+e.movementY*.0035,.08,.85);}});
  canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointercancel',()=>dragging=false);
  canvas.addEventListener('wheel',e=>{e.preventDefault();cameraDistance=clamp(cameraDistance+e.deltaY*.008,5,20);},{passive:false});
  $('directory').onclick=directory;$('music-button').onclick=music;$('respawn').onclick=reset;$('interact').onclick=interact;$('touch-use').onclick=interact;
  $('motion').onclick=()=>{ambientMotion=!ambientMotion;updateMotion();};updateMotion();
  document.querySelectorAll('[data-key]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();keys.add(b.dataset.key);b.setPointerCapture(e.pointerId);};for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>keys.delete(b.dataset.key));});
  $('music-toggle').onclick=async()=>{if(audio.paused){try{await audio.play();}catch{toast('Select a local track in WDR Sound first.');}}else audio.pause();};
  audio.addEventListener('play',()=>$('music-toggle').textContent='Pause');audio.addEventListener('pause',()=>$('music-toggle').textContent='Play');audio.addEventListener('error',()=>toast('This audio file could not be played. Try another indexed track.'));
  addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{if(document.hidden)keys.clear();last=performance.now();});
}
function updateMotion(){$('motion').textContent='Ambient animation: '+(ambientMotion?'on':'off');}
function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
function frame(time){
  requestAnimationFrame(frame);if(document.hidden){last=time;return;}
  const dt=Math.min((time-last)/1000,.04);last=time;elapsed+=dt;hudClock+=dt;
  const down=(...names)=>names.some(n=>keys.has(n));
  const forward=drawerOpen||workspaceOpen?0:(down('w','arrowup')?1:0)-(down('s','arrowdown')?1:0);
  const side=drawerOpen||workspaceOpen?0:(down('d','arrowright')?1:0)-(down('a','arrowleft')?1:0);
  if(activeCar){
    const car=activeCar;
    if(down(' ')||drawerOpen||workspaceOpen)car.speed=THREE.MathUtils.damp(car.speed,0,8,dt);
    else if(forward)car.speed=clamp(car.speed+forward*11*dt,-9,24);
    else car.speed=THREE.MathUtils.damp(car.speed,0,1.4,dt);
    car.group.rotation.y-=side*clamp(car.speed/8,-1,1)*1.2*dt;
    const angle=car.group.rotation.y;
    if(move(car.group.position,-Math.sin(angle)*car.speed*dt,-Math.cos(angle)*car.speed*dt,1.55,car))car.speed*=.45;
    if(!dragging&&Math.abs(car.speed)>1){let delta=Math.atan2(Math.sin(angle-cameraYaw),Math.cos(angle-cameraYaw));cameraYaw+=delta*Math.min(dt*2,1);}
    for(const wheel of car.group.userData.wheels||[])wheel.rotation.x-=car.speed*dt/.5;
    player.copy(car.group.position);
  }else{
    const length=Math.hypot(forward,side)||1,speed=down('shift')?8.5:4.5;
    const dx=(-Math.sin(cameraYaw)*forward+Math.cos(cameraYaw)*side)/length*speed*dt;
    const dz=(-Math.cos(cameraYaw)*forward-Math.sin(cameraYaw)*side)/length*speed*dt;
    const before=player.clone();move(player,dx,dz,.43);const moved=player.distanceTo(before)>.001;
    if(moved){const angle=Math.atan2(-dx,-dz),delta=Math.atan2(Math.sin(angle-avatar.rotation.y),Math.cos(angle-avatar.rotation.y));avatar.rotation.y+=delta*Math.min(dt*14,1);step+=dt*speed*2.5;}
    const swing=moved?Math.sin(step)*.5:0;avatar.userData.limbs.forEach((limb,i)=>limb.rotation.x=swing*(i%2?1:-1)*(i>1?-1:1));
    if(taskActivity&&drawerOpen&&!moved){const workMotion=ambientMotion?Math.sin(elapsed*2.3)*.08:0;const rest=taskActivity.scene==='rest';avatar.userData.limbs[2].rotation.x=rest ? .03 : -1.05+workMotion;avatar.userData.limbs[3].rotation.x=rest ? .03 : -1.05-workMotion;if(taskActivity.scene==='cleaning'&&taskSceneProp)taskSceneProp.rotation.y=ambientMotion?Math.sin(elapsed*2.3)*.42:0;}
    avatar.position.copy(player);avatar.position.y=moved?Math.abs(Math.sin(step))*.055:0;
  }
  cameraTarget.lerp(player,1-Math.exp(-dt*8));const distance=cameraDistance*(activeCar?1.28:1),height=distance*Math.sin(cameraPitch)+3;
  camera.position.set(cameraTarget.x+Math.sin(cameraYaw)*distance, height, cameraTarget.z+Math.cos(cameraYaw)*distance);
  camera.lookAt(cameraTarget.x,activeCar?1.1:1.4,cameraTarget.z);
  if(ambientMotion)for(const item of animated){item.object.rotation.y+=dt*.65;item.object.position.y=item.base+Math.sin(elapsed*1.8)*.14;}
  if(hudClock>.12){updateNearby();updateMap();hudClock=0;}
  moneyDistrict?.update(time);
  renderer.render(scene,camera);
}
function boot(){
  try{
    scene=new THREE.Scene();scene.background=new THREE.Color(0x7fbbdd);scene.fog=new THREE.Fog(0x7fbbdd,80,245);
    camera=new THREE.PerspectiveCamera(57,innerWidth/innerHeight,.1,420);
    renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;$('world').append(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xc9ecff,0x406a84,2.4));const sun=new THREE.DirectionalLight(0xe2f3ff,2.8);sun.position.set(-35,75,25);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-65,right:65,top:65,bottom:-65,near:1,far:160});sun.shadow.bias=-.0007;sun.shadow.normalBias=.05;scene.add(sun);
    city();avatar=createAvatar();makeCar(4,35,0x65bbd6);makeCar(-65,4,0xc594df,Math.PI);makeCar(66,-44,0xe8c38a,0);makeCar(10,88,0x91d7b4,Math.PI);
    moneyDistrict=mountMoneyDistrict({THREE,scene,stations,colliders,buildings,player,panel,drawer:$('drawer'),directory,onUpdated:()=>$('station-results')?.refresh?.()});
    controls();resize();$('xp').textContent=visits.size*25+' exploration XP';$('loader').remove();refreshStatus();setInterval(refreshStatus,30000);requestAnimationFrame(frame);
    // Read-only state makes the running simulation inspectable without giving it PC command authority.
    window.WDRWorld=Object.freeze({getState:()=>({mode:activeCar?'driving':'walking',position:{x:player.x,z:player.z},stations:stations.map(({id,name,x,z})=>({id,name,x,z})),explorationXP:visits.size*25,taskActivity:taskActivity?{...taskActivity}:null,money:moneyDistrict?.getState(),nearby:nearby?.id||(nearby?.car?'car':null)})});
  }catch(err){
    $('loader')?.remove();const failure=document.createElement('div');failure.className='error';failure.innerHTML='<div><div class="eyebrow">WDR CITY</div><h1>The 3D renderer could not start.</h1><p>This world needs WebGL 2 and browser graphics acceleration.</p><p>'+escapeHTML(err.message)+'</p><a href="/">Open the NEXEN main GUI ↗</a></div>';document.body.append(failure);console.error(err);
  }
}
boot();
