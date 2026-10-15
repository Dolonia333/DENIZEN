/* Execute the actual changed handlers against small in-memory DOM fixtures. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const root=dirname(fileURLToPath(import.meta.url));
const read=name=>readFileSync(join(root,name),'utf8');

class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.listeners={};this.disabled=false;this.dataset={};this._text='';}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(item=>item.textContent).join('');}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this._text='';this.children=[...items];}
  addEventListener(name,handler){this.listeners[name]=handler;}
}

function contextPacket(title){return {text:'Evidence '+title,citations:title?[{source_id:title,title}]:[],
  flow:{subject:'Fixture subject',stages:[{id:'answer',label:'Model answer',status:'prepared',tooltip:'A draft'}]},
  data_sufficiency:'partial',warnings:[]};}

test('a new model packet replaces old visible citations and saved references',async()=>{
  const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)};
  get('question').value='Fixture task';get('pool').value='commerce';get('model').value='fixture:model';
  const pending=[],requests=[];
  const sandbox={document:{getElementById:get,createElement:tag=>new Element(tag)},AbortController,setTimeout,clearTimeout,
    fetch:async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});assert.ok(pending.length,'Expected a mocked local response');return {status:200,ok:true,json:async()=>pending.shift()}}};
  const code=read('world-assets/knowledge-flow.js').split('Promise.allSettled(')[0];
  vm.runInNewContext(code,sandbox);
  pending.push(contextPacket('retrieval-source'));
  await get('retrieve').onclick();
  assert.match(get('sources').textContent,/retrieval-source/);
  pending.push({text:'New cited model answer',context_packet:contextPacket('answer-source')});
  await get('generate').onclick();
  assert.match(get('sources').textContent,/answer-source/);
  assert.doesNotMatch(get('sources').textContent,/retrieval-source/);
  assert.equal(get('answer').textContent,'New cited model answer');
  pending.push({id:42});await get('save').onclick();
  assert.match(requests.at(-1).body.text,/answer-source/);
  assert.doesNotMatch(requests.at(-1).body.text,/retrieval-source/);
  pending.push({text:'No source answer',context_packet:contextPacket('')});
  await get('generate').onclick();
  assert.match(get('sources').textContent,/No matching indexed evidence/);
  assert.doesNotMatch(get('sources').textContent,/answer-source/);
  pending.push({text:'Malformed reply',context_packet:{text:'bad',citations:[]}});
  await get('generate').onclick();
  assert.equal(get('answer').textContent,'No source answer');
  assert.match(get('sources').textContent,/No matching indexed evidence/);
});

test('readiness selection restores focus to the newly rendered matching button',()=>{
  const list={children:[],querySelectorAll(){return this.children}};
  const document={activeElement:null,body:{kind:'body'}};
  const original={dataset:{id:'pc2'},closest(){return this}};list.children=[original];document.activeElement=original;
  const sandbox={busy:false,selected:null,$:selector=>{assert.equal(selector,'#list');return list},
    render:()=>{document.activeElement=document.body;list.children=['n8n','pc2'].map(id=>({dataset:{id},focus(){document.activeElement=this}}))}};
  const handler=read('v1-readiness.html').match(/\$\('#list'\)\.onclick=(.*?);\$\('#refresh'\)/s)?.[1];
  assert.ok(handler,'Readiness click handler exists');
  vm.runInNewContext("$('#list').onclick="+handler,sandbox);
  list.onclick({target:original});
  assert.equal(sandbox.selected,'pc2');
  assert.equal(document.activeElement,list.children[1]);
  sandbox.busy=true;list.onclick({target:{closest:()=>({dataset:{id:'n8n'}})}});
  assert.equal(sandbox.selected,'pc2','Busy state preserves selection');
});

for(const focused of [true,false])test('money selection '+(focused?'restores keyboard focus':'does not steal unrelated focus'),()=>{
  const document={body:{kind:'body'},activeElement:null};
  const old={kind:'old-button'};const unrelated={kind:'input'};
  const tracks={children:[old],contains(value){return this.children.includes(value)},querySelector(){return this.children[0]}};
  document.activeElement=focused?old:unrelated;
  const nodes={'money-tracks':tracks,'money-task-track':{},'money-context-query':{}};
  const sandbox={document,state:{track:'all',taskLimit:30},byId:id=>nodes[id],
    renderTracks:()=>{if(tracks.contains(document.activeElement))document.activeElement=document.body;tracks.children=[{focus(){document.activeElement=this}}]},
    renderTasks:()=>{},selectedTrack:()=>({id:'music',title:'Music'}),invalidateMemory:()=>{}};
  const source=read('world-assets/money-workspace.js');
  const handler=source.slice(source.indexOf('function chooseTrack(id)'),source.indexOf('function renderTracks()'));
  assert.ok(handler.startsWith('function chooseTrack(id)'));
  vm.runInNewContext(handler+'\nchooseTrack("music");',sandbox);
  assert.equal(sandbox.state.track,'music');assert.equal(sandbox.state.taskLimit,12);
  assert.equal(document.activeElement,focused?tracks.children[0]:unrelated);
  assert.equal(nodes['money-task-track'].value,'music');
});
