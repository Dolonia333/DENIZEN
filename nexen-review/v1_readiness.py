"""Factual connection checklist over existing tasks and bounded local receipts.

Reported setup completion never verifies a connector or grants execution rights.
Only code-owned destinations and receipt filenames are accepted here.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import socket
import subprocess
import threading
import time
import urllib.request

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field

from task_tracking import Tracker, TaskCreate, TaskUpdate
from execution_labels import readiness_class

BASE=Path(__file__).resolve().parent
STATE=Path('H:/NEXEN/state')
OBSERVED='2026-09-09'
CATALOG=(
 ('browser-home','NEXEN browser startup page','v1-browser-homepage','In Chrome, open Settings > On startup > Open a specific page, then add http://127.0.0.1:8788/. Optionally enable the Home button under Appearance with the same address.','http://127.0.0.1:8788/','Open NEXEN','Desktop setup'),
 ('nexen','NEXEN local server',None,'Return to the dashboard. The checks below show which connected features still need setup.','/','Open NEXEN','Local runtime'),
 ('ollama','Ollama local models',None,'Open the local lab to use the verified model. Individual models and tasks have separate checks.','/lab','Open local models','Local runtime'),
 ('openrouter','OpenRouter account, key and spending cap','v1-openrouter-ready','Sign in, create a restricted key and choose your cap. Funding alone does not verify the model route.','https://openrouter.ai/settings/credits','Open OpenRouter','Cloud models'),
 ('kilo','Kilo coding workspace','v1-kilo-ready','Open Kilo, check its configured local model and review the latest bounded draft test.','/kilo','Open Kilo','Coding'),
 ('omniroute','OmniRoute provider routing','omniroute','Open OmniRoute and verify an authenticated model route and its usage limits.','http://127.0.0.1:20128','Open OmniRoute','Model routing'),
 ('n8n','n8n login and connected workflow','n8n-flows','Finish owner login, add a scoped NEXEN credential and verify one imported workflow end to end.','http://127.0.0.1:5678','Open n8n','Workflows'),
 ('claude_mem','Claude memory session capture','v1-claude-memory-capture','Run one native Claude session through the H profile and verify its captured observation and local summary.','/connections','Memory connections','Memory'),
 ('memsearch','Local memory search',None,'Search the indexed notes. Expand coverage deliberately after the current subset is verified.','/plans','Open knowledge plans','Memory'),
 ('phone','Private phone connection','phone-encrypted','Resolve the private HTTPS certificate failure, then test password-protected phone access.','/connections','Phone setup','Remote access'),
 ('pc2','PC2 worker connection','pc2','Bring PC2 online through the private connection, then verify its authenticated worker with a bounded test.','/diagnostics','Open diagnostics','Remote access'),
 ('desktop','Real PC task execution','pc-control','Open the dedicated PC control page. Manual controls and autonomous task execution require separate checks.','/desktop','Open PC controls','Desktop actions'),
 ('youtube','YouTube source to working workflow','v1-youtube-workflow-ready','Open the saved tutorial, inspect the compile error or draft and verify a supported workflow run.','/youtube-memory','Open YouTube memory','Workflows'),
 ('coderabbit','CodeRabbit review','v1-coderabbit-review','Open the review account and inspect the latest completed review receipt before calling the code reviewed.','https://app.coderabbit.ai/settings','Open CodeRabbit','Code review'),
 ('amboras','Lumipaw checkout','store-payment','Finish payment onboarding as a US individual and verify a real checkout test.','https://admin.amboras.com/home','Open Amboras','Store'),
 ('ads','Advertising account and test cap','ad-account','Connect the chosen ad account after checkout and unit economics are verified. The existing daily and total caps both remain $50.','/money','Open Money Engine','Store'),
 ('supercool','Supercool login and walkthrough','walkthrough','Sign in, then verify an actual app walkthrough generation.','https://supercool.com/login','Open Supercool','Video'),
)
RECEIPTS={key:name for key,name in (
 ('openrouter','openrouter-install.json'),('kilo','kilo-install.json'),
 ('omniroute','omniroute-install.json'),('n8n','n8n-integration.json'),
 ('claude_mem','claude-mem-install.json'),('memsearch','memsearch-install.json'),
 ('phone','phone-access-verification.json'),('pc2','pc2-worker-verification.json'),
 ('desktop','desktop-execution-verification.json'),('coderabbit','code-review.json'),
 ('ollama','qwen-lightweight-verification.json'))}

def now(): return datetime.now(timezone.utc).isoformat()
def read_json(path,limit=131072):
    try:
        path=Path(path)
        if path.is_symlink() or path.stat().st_size>limit: return {}
        data=json.loads(path.read_text(encoding='utf-8-sig'))
        return data if isinstance(data,dict) else {}
    except (OSError,ValueError,TypeError): return {}

def date_value(value):
    if not isinstance(value,str) or len(value)>40: return None
    try: return datetime.fromisoformat(value.replace('Z','+00:00')).isoformat()
    except ValueError: return None

def count(value): return value if type(value) is int and 0<=value<=1_000_000 else None
def object_value(value): return value if isinstance(value,dict) else {}

def local_adapter_availability(connections):
    """Inspect only fixed local adapter files/config; no process or model is run."""
    result={'ollama':False,'kilo':False}
    if connections.get('ollama') is True:
        try:
            from action_requirements import NoRedirect
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
            with opener.open('http://127.0.0.1:11434/api/tags',timeout=2) as response:
                raw=response.read(131073)
            if len(raw)>131072:return result
            payload=json.loads(raw)
            models=payload.get('models') if isinstance(payload,dict) else None
            if not isinstance(models,list):return result
            names={item.get('name') for item in models if isinstance(item,dict) and isinstance(item.get('name'),str)}
            result['ollama']='qwen3.5:2b-q4_K_M' in names
            from kilo_bridge import BINARY, ROOT, read_json as read_kilo_json, valid_config
            result['kilo']='dolphin3:latest' in names and BINARY.is_file() and valid_config(read_kilo_json(ROOT/'kilo.json'))
        except (ImportError,OSError,ValueError,TypeError):
            pass
    return result

def live_connections(private_config=Path('H:/NEXEN/config/private-pc2.json')):
    result={'checked_at':now()}
    for name,port in (('nexen',8788),('ollama',11434),('omniroute',20128),('n8n',5678),('claude_mem',37777)):
        try:
            with socket.create_connection(('127.0.0.1',port),timeout=.4): result[name]=True
        except OSError: result[name]=False
    # Read-only daemon status. Never echo peer names, addresses or account data.
    conf=read_json(private_config,8192)
    result['pc2']=None
    if conf.get('node_id') or conf.get('hostname'):
        cli=Path('C:/Program Files/Tailscale/tailscale.exe')
        if cli.is_file():
            try:
                run=subprocess.run([str(cli),'status','--json'],capture_output=True,timeout=3,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                if run.returncode==0 and len(run.stdout)<=2_000_000:
                    peers=json.loads(run.stdout).get('Peer',{})
                    matches=[p for key,p in peers.items() if
                        (conf.get('node_id') and (key==conf['node_id'] or p.get('ID')==conf['node_id'] or conf['node_id'] in p.get('TailscaleIPs',[]))) or
                        (conf.get('hostname') and str(p.get('HostName','')).lower()==str(conf['hostname']).lower())]
                    if len(matches)==1: result['pc2']=matches[0].get('Online') is True
            except (OSError,ValueError,subprocess.TimeoutExpired,AttributeError,TypeError): pass
    return result

class ReportBody(BaseModel):
    model_config=ConfigDict(extra='forbid')
    completed: bool=Field(strict=True)
    outcome: str=Field(default='',max_length=600)

class Readiness:
    def __init__(self,db,requirements=None,desktop=None,state=STATE,probe=live_connections,
                 adapter_probe=local_adapter_availability):
        self.db,self.tracker=db,Tracker(db)
        self.requirements,self.desktop=requirements,desktop
        self.state,self.probe=Path(state),probe
        self.adapter_probe=adapter_probe
        self.lock=threading.RLock()
        self.probe_lock=threading.Lock()
        self.cache,self.cached_at,self.cache_generation={},0,0
        self.tasks={}
        for ident,title,key,next_step,*_ in CATALOG:
            if key:
                self.tasks[ident]=self.tracker.create(TaskCreate(text=title,priority='high',next_step=next_step),seed_key=key)

    def connection_snapshot(self,refresh=False):
        with self.lock:
            generation=self.cache_generation
            if not refresh and self.cache and time.monotonic()-self.cached_at<=30:
                return dict(self.cache)
        # Slow socket/daemon checks must not hold the task-report lock. A
        # dedicated lock serializes probes and coalesces overlapping refreshes.
        with self.probe_lock:
            with self.lock:
                if self.cache and time.monotonic()-self.cached_at<=30 and (
                        not refresh or self.cache_generation!=generation):
                    return dict(self.cache)
            try:
                fresh=self.probe()
                if not isinstance(fresh,dict):
                    raise ValueError('The connection probe did not return a snapshot.')
            except Exception:
                fresh={'checked_at':now()}
            with self.lock:
                self.cache,self.cached_at=fresh,time.monotonic()
                self.cache_generation+=1
            return dict(self.cache)

    def packet(self,refresh=False):
        connections=self.connection_snapshot(refresh)
        try: available_adapters=self.adapter_probe(connections)
        except Exception: available_adapters={}
        prerequisites={}
        if self.requirements:
            try: prerequisites={x['id']:x for x in self.requirements.status().get('pending',[])}
            except Exception: pass
        try:
            videos=self.db.rows('SELECT id,status,compile_status,updated_at FROM youtube_sources ORDER BY updated_at DESC LIMIT 25')
        except Exception: videos=[]
        items=[]
        for ident,title,key,step,url,label,group in CATALOG:
            row=dict(id=ident,title=title,next_step=step,url=url,button_label=label,group=group,
                verified=False,status='needs_check',observed_at=OBSERVED,evidence_basis='dated_observation',
                evidence='No successful end-to-end verification is recorded.',receipt_present=False,
                task=None,reported_complete=False,execution_unlocked=False)
            receipt=read_json(self.state/RECEIPTS[ident]) if ident in RECEIPTS else {}
            if receipt:
                row.update(receipt_present=True,receipt_name=RECEIPTS[ident],
                    observed_at=date_value(receipt.get('checked_at') or receipt.get('verified_at')) or OBSERVED,
                    evidence_basis='saved_receipt')
            if ident in self.tasks:
                task=self.tracker.get(self.tasks[ident])
                row['task']={k:task.get(k) for k in ('id','status','updated_at','completed_at')}
                row['task']['title']=str(task.get('text',''))[:800]
                row['reported_complete']=task['status']=='done'
            if ident=='browser-home':
                row['evidence']='This browser preference needs a manual owner step. Its saved setting has not been verified.'
            elif ident=='nexen':
                row['evidence']='The NEXEN local server is not reachable by the current port check.'
                if connections.get('nexen') is True: row['evidence']='The local NEXEN server is reachable. This service check does not verify all connected features.'
                row['verification_scope']='local_server_reachability_only'
            elif ident=='ollama':
                row['verified']=connections.get('ollama') is True and object_value(receipt.get('text_test')).get('passed') is True and receipt.get('manifest_dependencies_verified') is True
                row['evidence']='Model server reachability and successful generation are separate checks.'
                if row['verified']: row['evidence']='The local model service is reachable and the saved Qwen receipt records a successful text generation test with verified model files. Other models, OCR accuracy and automatic workflows are not covered.'
                row['verification_scope']='service_reachability_and_recorded_qwen_text_test'
            elif ident=='openrouter':
                row['evidence']='The credits page was opened. Login, a usable restricted key, selected cap and funding are not verified.'
                if receipt.get('browser_sign_in_verified') is True:
                    row['evidence']='Browser sign-in is confirmed. Billing setup is in progress; funding, a usable restricted key and the model route remain unverified.'
                    row['next_step']='Finish billing setup, configure a restricted key and spending cap, then verify a bounded model route.'
                if receipt.get('user_reported_credit_usd') == '10.00':
                    row['evidence']='You reported adding $10. Browser sign-in is confirmed; the restricted API key, spending cap and a successful model route still need verification.'
                    row['next_step']='Configure a restricted API key and the $10 total cap, then verify one bounded request.'
                row['verified']=all(receipt.get(k) is True for k in ('auth_verified','key_verified','spending_cap_verified','route_verified'))
                if row['verified']: row['evidence']='The saved receipt verifies authentication, restricted-key use, spending cap and a model route. It does not authorize new spending.'
            elif ident=='kilo':
                row['verified']=receipt.get('verified') is True and receipt.get('live_draft_verified') is True
                row['evidence']='Kilo setup and a bounded local draft are not fully verified.'
                if receipt.get('installed') is True: row['evidence']='Kilo is installed. Configuration and an actual local draft are checked separately.'
                if row['verified']: row['evidence']='A bounded local draft passed in the saved receipt. Continuous work and cloud authentication are separate.'
            elif ident=='omniroute':
                row['verified']=receipt.get('routing_verified') is True and receipt.get('auth_verified') is True
                row['evidence']='Dashboard reachability does not prove an authenticated model route or unlimited usage.'
                if receipt.get('user_reported_setup_complete') is True:
                    row['evidence']='You reported OmniRoute setup complete. Its dashboard is reachable; an authenticated model request and its usage limits still need verification.'
            elif ident=='n8n':
                row['verified']=all(receipt.get(k) is True for k in ('auth_verified','workflow_published','run_verified'))
                status=prerequisites.get('n8n',{}).get('state')
                row['evidence']='n8n is installed. Workflow publication, scoped authentication and a successful run are unverified.'
                if status=='setup_required': row['evidence']='The local n8n check still requests owner setup. No authenticated workflow run is verified.'
                elif status=='integration_required': row['evidence']='n8n no longer requests first-owner setup. Scoped authentication, publication and a workflow run remain unverified.'
                if row['verified']: row['evidence']='The saved receipt verifies authentication, workflow publication and a completed test run.'
                health_verified=(receipt.get('workflow_id')=='nexenLocalHealthV1' and all(
                    receipt.get(k) is True for k in ('health_workflow_verified','workflow_imported',
                                                    'workflow_published','run_verified','local_only')))
                row['local_health_workflow']={
                    'verified':health_verified,
                    'schedule_loaded':health_verified and receipt.get('schedule_loaded') is True,
                    'scheduled_run_verified':health_verified and receipt.get('scheduled_run_verified') is True,
                    'scope':'One local service-health workflow; not a business or advertisement workflow.'}
                if health_verified:
                    schedule=('A scheduled run is also recorded.' if receipt.get('scheduled_run_verified') is True else
                              'Its schedule is loaded; a periodic run has not been verified.' if receipt.get('schedule_loaded') is True else
                              'Schedule activation has not been verified.')
                    row['evidence']='One local health workflow was imported and published, and its manual run passed. '+schedule+' Business workflow execution remains unverified.'
                    if not row['verified']:
                        row['evidence']+=' Scoped NEXEN authentication also remains unverified.'
                        row['next_step']='Sign in to n8n and configure a scoped NEXEN integration for business workflows. The existing local health workflow is already published.'
            elif ident=='claude_mem':
                row['verified']=receipt.get('native_hook_session_tested') is True and receipt.get('observer_inference_tested') is True and receipt.get('verified') is True
                row['evidence']='Native Claude session capture and observer inference remain unverified.'
                if receipt.get('persisted_memory_search_verified') is True:
                    row['evidence']='Local worker storage/search and restart persistence passed. Native Claude hook capture and observer inference remain unverified.'
                if row['verified']: row['evidence']='The saved receipt verifies native-session capture and observer inference.'
            elif ident=='memsearch':
                row['verified']=receipt.get('verified') is True and receipt.get('synthetic_query_passed') is True
                files,chunks=count(receipt.get('files')),count(receipt.get('indexed_chunks_this_pass'))
                row['evidence']='Local semantic search has no verified receipt yet.'
                if row['verified']:
                    row['evidence']=f'Local search passed for {files if files is not None else "a bounded set of"} Markdown sources; the recorded pass indexed {chunks if chunks is not None else "bounded"} chunks. This is partial knowledge coverage.'
            elif ident=='phone':
                row['verified']=all(receipt.get(k) is True for k in ('tls_verified','owner_auth_verified','phone_test_verified'))
                row['evidence']='The last strict HTTPS check failed. Private phone access has not been verified.'
                if row['verified']: row['evidence']='The saved receipt verifies TLS, owner authentication and a phone test.'
            elif ident=='pc2':
                row['verified']=receipt.get('worker_authenticated') is True and receipt.get('bounded_task_verified') is True and connections.get('pc2') is True
                row['evidence']='PC2 private connection status is unknown. No authenticated worker task is verified.'
                if connections.get('pc2') is True: row['evidence']='The private connection reports PC2 online. Reachability alone does not verify an authenticated worker.'
                elif connections.get('pc2') is False: row['evidence']='The private connection currently reports PC2 offline. Worker execution remains unavailable.'
                if row['verified']: row['evidence']='PC2 is online and the saved receipt verifies an authenticated bounded worker task.'
            elif ident=='desktop':
                row['verified']=receipt.get('task_executor_verified') is True
                row['evidence']='The current adapter supports deliberate manual moves and a limited test click area. Autonomous desktop task execution is not verified.'
                if row['verified']: row['evidence']='A task executor passed the saved bounded test. Its configured scope still applies.'
            elif ident=='youtube':
                row['evidence']='No tutorial source and executable workflow have been verified together.'
                if videos:
                    latest=videos[0];row.update(observed_at=date_value(latest['updated_at']) or OBSERVED,evidence_basis='saved_source_state')
                    ready=sum(v['status']=='ready' for v in videos)
                    state=latest['compile_status'] if latest['compile_status'] in ('ready','draft_ready','blocked','cancelled','failed','running','queued','not_started') else 'unverified'
                    row['evidence']=f'{ready} of the latest {len(videos)} saved sources have retrieved evidence. Latest compilation: {state}. A draft alone is not an executed workflow.'
                    if state=='draft_ready': row['evidence']=f'{ready} of the latest {len(videos)} saved sources have retrieved evidence. A cited draft is saved; source coverage may be partial. No workflow execution is verified.'
            elif ident=='coderabbit':
                row['verified']=receipt.get('review_completed') is True or receipt.get('status')=='review_complete'
                row['evidence']='A review source snapshot was prepared. The latest completed CodeRabbit review is not verified by this page.'
                if receipt.get('status')=='review_running': row['evidence']='The source review is running on the recorded pull request. A completed review and validated fixes are still pending.'
                if row['verified']: row['evidence']='A completed review is recorded. Findings still require current-code validation and do not prove all code is correct.'
            elif ident=='amboras': row['evidence']='Store access was observed. Completed payment onboarding and checkout are not verified.'
            elif ident=='ads': row['evidence']='The last confirmed advertising-account status was none connected. Existing limits are $50/day and $50 total, with no automatic restart.'
            elif ident=='supercool': row['evidence']='The last verified browser state was a login form. An actual app walkthrough has not been generated.'
            if ident in connections:
                row.update(endpoint_reachable=connections[ident],connection_checked_at=connections.get('checked_at'))
            row['status']='verified' if row['verified'] else ('reported_done_needs_check' if row['reported_complete'] else 'needs_check')
            if ident=='nexen' and connections.get('nexen') is True: row['status']='service_reachable'
            row.update(readiness_class(row,prerequisites.get(ident),available_adapters))
            items.append(row)
        pending=[x for x in items if not x['verified'] and x['status']!='service_reachable']
        focus=next((x['id'] for x in pending if not x['reported_complete']),None) or (pending[0]['id'] if pending else None)
        return dict(checked_at=now(),connection_checked_at=connections.get('checked_at'),items=items,
            verified_count=sum(x['verified'] for x in items),blocker_count=len(pending),next_id=focus,
            execution_counts={kind:sum(x['execution_class']==kind for x in items)
                              for kind in ('HUMAN','BLOCKED','AUTOMATABLE')},
            policy='Your checklist reports are stored in the existing task history. They never verify a connection, enable an executor or authorize a payment.',
            coverage='Connection reachability is checked locally. Capability checks use dated receipts and saved state; missing evidence remains unverified.')

    def report(self,ident,body):
        if ident not in self.tasks: raise HTTPException(404,'No setup task for this item.')
        outcome=body.outcome.strip()
        if body.completed and not outcome: raise HTTPException(422,'Briefly describe the setup step you completed. Do not enter a key or password.')
        with self.lock:
            task=self.tracker.get(self.tasks[ident]);status='done' if body.completed else 'planned'
            if task['status']==status: return dict(changed=False,task_id=task['id'],task_status=status,verification_changed=False,execution_unlocked=False)
            self.tracker.update(task['id'],TaskUpdate(status=status,outcome='user_reported: '+(outcome or 'Reopened setup checklist item.')))
        return dict(changed=True,task_id=task['id'],task_status=status,verification_changed=False,execution_unlocked=False)

def register(app,db):
    from pc_control import validate_request
    readiness=Readiness(db,getattr(app.state,'requirements',None),getattr(app.state,'desktop_adapter',None))
    @app.get('/readiness',response_class=HTMLResponse)
    def page(request:Request):
        validate_request(request)
        return (BASE/'v1-readiness.html').read_text(encoding='utf-8')
    @app.get('/api/readiness')
    def status(request:Request):
        validate_request(request);return readiness.packet()
    @app.post('/api/readiness/refresh')
    def refresh(request:Request):
        validate_request(request,mutation=True);return readiness.packet(refresh=True)
    @app.post('/api/readiness/{ident}/report')
    def report(ident:str,body:ReportBody,request:Request):
        validate_request(request,mutation=True);return readiness.report(ident,body)
    return readiness
