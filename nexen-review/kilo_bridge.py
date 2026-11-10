"""Bounded Kilo draft jobs tied to existing NEXEN tasks; no automatic deployment."""
from __future__ import annotations
import argparse
import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import threading
import time
from typing import Literal
import uuid

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field
from agentic_os import context, safe_path
from task_tracking import Tracker
from file_census import SingleWriter

BASE=Path(__file__).resolve().parent
ROOT=Path('H:/NEXEN/integrations/kilo')
JOBS=ROOT/'jobs'
INSTALL=Path('H:/NEXEN/state/kilo-install.json')
BINARY=Path('F:/Apps/npm-global/node_modules/@kilocode/cli/node_modules/@kilocode/cli-windows-x64-baseline/bin/kilo.exe')
MODEL='ollama/dolphin3:latest'
RUN_LOCK=threading.Lock()
MAX_OUTPUT=1024*1024
MAX_RUN_SECONDS=150

def now():return datetime.now(timezone.utc).isoformat()
def sha(text):return hashlib.sha256(text.encode('utf-8')).hexdigest()

def save(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(temporary,path)

def read_json(path,limit=65536):
    try:
        with path.open('rb') as stream:raw=stream.read(limit+1)
        data=json.loads(raw.decode('utf-8-sig')) if len(raw)<=limit else None
        return data if isinstance(data,dict) else {}
    except (OSError,ValueError,UnicodeError):return {}

def environment():
    env={k:v for k,v in os.environ.items() if not k.startswith('KILO_')}
    for key in ('OPENROUTER_API_KEY','ANTHROPIC_API_KEY','OPENAI_API_KEY'):env.pop(key,None)
    directories={'TEMP':Path('H:/NEXEN/temp'),'TMP':Path('H:/NEXEN/temp'),
                 'XDG_CONFIG_HOME':ROOT/'xdg-config','XDG_DATA_HOME':ROOT/'xdg-data',
                 'XDG_CACHE_HOME':ROOT/'xdg-cache','XDG_STATE_HOME':ROOT/'xdg-state',
                 'KILO_TEST_HOME':ROOT/'profile','USERPROFILE':ROOT/'profile',
                 'APPDATA':ROOT/'appdata','LOCALAPPDATA':ROOT/'localappdata','KILO_CONFIG_DIR':ROOT/'config'}
    for name,path in directories.items():path.mkdir(parents=True,exist_ok=True);env[name]=str(path)
    env['KILO_CONFIG']=str(ROOT/'kilo.json')
    for name in ('PROJECT_CONFIG','DEFAULT_PLUGINS','EXTERNAL_SKILLS','CLAUDE_CODE','CLAUDE_CODE_SKILLS',
                 'AUTOUPDATE','MODELS_FETCH','CODEBASE_INDEXING','LSP_DOWNLOAD','PRESENCE','SESSION_INGEST','SHARE','SKILL_SHELL'):
        env['KILO_DISABLE_'+name]='1'
    env.update(KILO_TELEMETRY_LEVEL='off',KILO_NO_DAEMON='1',KILO_REMOTE='false',PYTHONDONTWRITEBYTECODE='1')
    return env

def valid_config(data):
    if not isinstance(data,dict):return False
    if not all(isinstance(data.get(key),dict) for key in ('provider','agent')):return False
    provider=data.get('provider',{}).get('ollama',{})
    agent=data.get('agent',{}).get('nexen-draft',{})
    if not isinstance(provider,dict) or not isinstance(agent,dict) or not isinstance(provider.get('options'),dict):return False
    models=provider.get('models')
    model=models.get('dolphin3:latest') if isinstance(models,dict) else None
    if not isinstance(model,dict) or not isinstance(model.get('limit'),dict):return False
    return (data.get('model')==MODEL and data.get('small_model')==MODEL and
            data.get('enabled_providers')==['ollama'] and data.get('permission')=={'*':'deny'} and
            data.get('share')=='disabled' and data.get('autoupdate') is False and
            not data.get('plugin') and not data.get('mcp') and
            provider.get('npm')=='@ai-sdk/openai-compatible' and not model.get('provider') and
            model.get('tool_call') is False and model['limit'].get('context')==8192 and
            model['limit'].get('output')==600 and
            provider.get('options',{}).get('baseURL')=='http://127.0.0.1:11434/v1' and
            agent.get('permission')=={'*':'deny'} and agent.get('model')==MODEL and agent.get('steps')==2)

def verify_config():
    if not BINARY.is_file():raise ValueError('The installed Kilo executable is missing.')
    if not valid_config(read_json(ROOT/'kilo.json')):raise ValueError('The local-only Kilo configuration needs review.')
    result=subprocess.run([str(BINARY),'--pure','debug','config'],cwd=ROOT,env=environment(),
                          stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20,
                          creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if result.returncode or len(result.stdout)>131072:raise ValueError('Kilo did not validate its configuration.')
    data=json.loads(result.stdout.decode('utf-8-sig'))
    if not isinstance(data,dict) or not valid_config(data):raise ValueError('Resolved Kilo permissions or provider differ from the reviewed profile.')
    return True

def parse_events(raw):
    if len(raw)>MAX_OUTPUT:raise ValueError('Kilo output exceeded the local draft limit.')
    texts=[];finished=False;session=None
    for line in raw.decode('utf-8-sig').splitlines():
        try:event=json.loads(line)
        except ValueError:continue
        if not isinstance(event,dict):continue
        if event.get('type')=='error':raise ValueError('Kilo reported a provider or permission error. The private local log contains details.')
        part=event.get('part') or {}
        if not isinstance(part,dict):continue
        if event.get('type')=='text' and isinstance(part.get('text'),str):texts.append(part['text'])
        if event.get('type')=='step_finish' and part.get('reason')=='stop':finished=True
        if isinstance(event.get('sessionID'),str):session=event['sessionID'][:120]
    answer='\n\n'.join(texts).strip()
    if not finished or not answer or 'Maximum steps for this agent have been reached' in answer:
        raise ValueError('Kilo stopped without a usable draft. No code or task was changed.')
    return answer[:30000],session

class DraftRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:str=Field(pattern=r'^[a-f0-9]{32}$')
    task_id:int=Field(gt=0,strict=True)
    project:Literal['nexen','wdr','lumipaw','music','life']='nexen'
    kind:Literal['code','workflow','guide']='workflow'
    instructions:str=Field(default='',max_length=2000)

class KiloBridge:
    def __init__(self,db):
        self.db=db;self.tracker=Tracker(db);self.active=None;self.process=None;self.cancelled=threading.Event();self.lease=None;self.worker=None
        ROOT.mkdir(parents=True,exist_ok=True)
        with db.connect() as c:c.execute('''CREATE TABLE IF NOT EXISTS kilo_draft_jobs(
            id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,payload_hash TEXT NOT NULL,
            task_id INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL)''')

    def status(self):
        receipt=read_json(INSTALL)
        allowed=('status','installed','version','config_verified','local_endpoint_ready','local_model_available',
                 'live_draft_verified','verified','provider','model','context_loaded','continuous_worker_running',
                 'cloud_auth_verified','blockers','checked_at')
        result={key:receipt.get(key) for key in allowed}
        result.update(continuous_worker_running=False,active_job=self.active,paid_fallback_enabled=False,
                      task_execution=False,queue_mode='Prepare a task draft, then explicitly run one bounded local job.')
        jobs=[]
        for row in self.db.rows('SELECT id FROM kilo_draft_jobs ORDER BY created_at DESC LIMIT 10'):
            try:jobs.append(self.get(row['id']))
            except HTTPException as error:
                if error.status_code!=409:raise
                jobs.append({'id':row['id'],'status':'receipt_unavailable','executed':False})
        result['jobs']=jobs
        return result

    def get(self,ident):
        if not re.fullmatch('[a-f0-9]{32}',ident):raise HTTPException(404,'Kilo draft not found.')
        if not self.db.rows('SELECT id FROM kilo_draft_jobs WHERE id=?',(ident,)):raise HTTPException(404,'Kilo draft not found.')
        receipt=read_json(safe_path(JOBS,ident+'/receipt.json'))
        if not receipt:raise HTTPException(409,'This draft receipt is unavailable; its task remains unchanged.')
        return receipt

    def prepare(self,body):
        fingerprint=sha(body.model_dump_json(exclude={'request_key'}))
        existing=self.db.rows('SELECT id,payload_hash FROM kilo_draft_jobs WHERE request_key=?',(body.request_key,))
        if existing:
            if existing[0]['payload_hash']!=fingerprint:raise HTTPException(409,'Request key already belongs to another draft.')
            return self.get(existing[0]['id'])
        task=self.tracker.get(body.task_id)
        query=(task['text']+'\n'+body.instructions)[:2500]
        packet=context(body.project)
        try:
            from memory_runtime import context_for
            memory=context_for(query,task_type='code' if body.kind=='code' else 'workflow',
                               pool={'nexen':'engineering','wdr':'game','lumipaw':'commerce','music':'music','life':'life'}[body.project])
            packet['knowledge']={key:memory.get(key) for key in ('text','citations','status','warnings','data_sufficiency','source_scope','egress_policy')}
        except Exception as error:packet['knowledge']={'status':'unavailable','error_type':type(error).__name__}
        # The current confirmed profile is first; retrieved old notes cannot replace it.
        packet.update(task_id=body.task_id,task_text=task['text'][:3500],kind=body.kind,
                      instructions=body.instructions,source_precedence='Current explicit user profile before retrieved historical notes.',
                      photo_scope='Only existing retrieved text summaries are available; raw photos are not sent by this adapter.')
        encoded=json.dumps(packet,ensure_ascii=False)
        if len(encoded)>24000:
            packet['knowledge']={'status':'context_too_large','detail':'Narrow the task to retrieve a smaller relevant packet.'}
            encoded=json.dumps(packet,ensure_ascii=False)
        prompt=('Prepare a concise '+body.kind+' draft for the saved task. Return it directly without tools. '
                'Cite only supplied task/source references and include checks and missing prerequisites. '
                'This is Kilo Code on Windows. '
                'Do not claim execution, deployment, completed tasks, payments or income. '
                'CURRENT CONTEXT AND EVIDENCE:\n'+encoded)
        ident=uuid.uuid4().hex;folder=safe_path(JOBS,ident);folder.mkdir(parents=True,exist_ok=False)
        (folder/'context.json').write_text(encoded,encoding='utf-8')
        (folder/'prompt.txt').write_text(prompt,encoding='utf-8')
        receipt={'id':ident,'task_id':body.task_id,'project':body.project,'kind':body.kind,'status':'prepared',
                 'created_at':now(),'updated_at':now(),'model':MODEL,'context_sha256':sha(encoded),'prompt_sha256':sha(prompt),
                 'sources':[d['path'] for d in packet.get('documents',[])],'knowledge_status':packet.get('knowledge',{}).get('status','retrieved'),
                 'executed':False,'paid_spend':0,'draft':None,'error':None,'attempts':0}
        save(folder/'receipt.json',receipt)
        try:
            with self.db.connect() as c:c.execute('INSERT INTO kilo_draft_jobs VALUES(?,?,?,?,?,?)',
                                                  (ident,body.request_key,fingerprint,body.task_id,'prepared',receipt['created_at']))
        except sqlite3.IntegrityError:
            existing=self.db.rows('SELECT id,payload_hash FROM kilo_draft_jobs WHERE request_key=?',(body.request_key,))
            if existing and existing[0]['payload_hash']==fingerprint:return self.get(existing[0]['id'])
            raise HTTPException(409,'Another preparation claimed this request key.')
        return receipt

    def record(self,receipt):
        receipt['updated_at']=now();save(safe_path(JOBS,receipt['id']+'/receipt.json'),receipt)
        with self.db.connect() as c:c.execute('UPDATE kilo_draft_jobs SET status=? WHERE id=?',(receipt['status'],receipt['id']))

    async def start(self,ident):
        receipt=self.get(ident)
        if receipt['status']!='prepared':return receipt
        if not RUN_LOCK.acquire(blocking=False):raise HTTPException(409,'A Kilo draft is already running.')
        try:
            self.lease=SingleWriter(ROOT);self.lease.__enter__()
            receipt=self.get(ident)
            if receipt['status']!='prepared':
                self.lease.__exit__();self.lease=None;RUN_LOCK.release();return receipt
            self.active=ident;self.cancelled.clear();receipt['status']='running';receipt['attempts']=1;self.record(receipt)
            self.worker=asyncio.create_task(asyncio.to_thread(self.run,receipt))
            self.worker.add_done_callback(lambda worker:worker.exception() if not worker.cancelled() else None)
        except BaseException as error:
            if self.lease and self.lease.file and not self.lease.file.closed:self.lease.__exit__()
            self.lease=None;self.active=None;RUN_LOCK.release()
            if isinstance(error,RuntimeError):raise HTTPException(409,'Another Kilo process owns the draft worker. Wait or cancel that job.') from error
            raise
        return self.get(ident)

    def run(self,receipt):
        folder=safe_path(JOBS,receipt['id']);started=time.monotonic()
        try:
            verify_config()
            if self.cancelled.is_set() or (folder/'cancel.requested').exists():raise InterruptedError('Draft cancelled before generation.')
            prompt=(folder/'prompt.txt').read_text(encoding='utf-8')
            if sha(prompt)!=receipt['prompt_sha256'] or len(prompt)>30000:raise ValueError('Saved prompt changed or exceeds the bounded input limit.')
            argv=[str(BINARY),'--pure','run',prompt,'--model',MODEL,'--agent','nexen-draft','--format','json',
                  '--title','NEXEN task '+str(receipt['task_id'])+' '+receipt['kind']+' draft','--dir',str(folder)]
            with (folder/'events.jsonl').open('wb') as output,(folder/'stderr.log').open('wb') as errors:
                self.process=subprocess.Popen(argv,cwd=folder,env=environment(),stdout=output,stderr=errors,
                                              creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                while self.process.poll() is None:
                    if self.cancelled.is_set() or (folder/'cancel.requested').exists():raise InterruptedError('Draft cancelled by the user.')
                    if time.monotonic()-started>MAX_RUN_SECONDS:raise TimeoutError('The bounded Kilo draft timed out.')
                    if max((folder/'events.jsonl').stat().st_size,(folder/'stderr.log').stat().st_size)>MAX_OUTPUT:raise ValueError('Kilo draft output exceeded its limit.')
                    time.sleep(.2)
                code=self.process.returncode
            if code:raise ValueError('Kilo exited without a verified draft. The local log has details.')
            answer,session=parse_events((folder/'events.jsonl').read_bytes())
            (folder/'draft.md').write_text(answer,encoding='utf-8')
            receipt.update(status='draft_ready',draft=answer,session_id=session,draft_sha256=sha(answer))
        except InterruptedError as error:receipt.update(status='cancelled',error=str(error))
        except (ValueError,TimeoutError) as error:receipt.update(status='failed',error=str(error))
        except Exception:receipt.update(status='failed',error='The local draft adapter failed. No code or task was changed.')
        finally:
            try:
                if self.process and self.process.poll() is None:self.process.kill();self.process.wait(timeout=5)
                self.process=None;receipt['duration_seconds']=round(time.monotonic()-started,3);self.record(receipt)
            finally:
                self.active=None
                if self.lease:self.lease.__exit__();self.lease=None
                RUN_LOCK.release()

    def cancel(self,ident):
        receipt=self.get(ident)
        if receipt['status']=='running':
            safe_path(JOBS,ident+'/cancel.requested').write_text(now(),encoding='utf-8')
            if self.active==ident:self.cancelled.set()
        elif receipt['status']=='prepared':receipt['status']='cancelled';self.record(receipt)
        return self.get(ident)

    def recover(self):
        try:
            with SingleWriter(ROOT):
                for row in self.db.rows("SELECT id FROM kilo_draft_jobs WHERE status='running'"):
                    try:
                        receipt=self.get(row['id'])
                    except HTTPException as error:
                        if error.status_code not in {404,409}:raise
                        with self.db.connect() as c:
                            c.execute("UPDATE kilo_draft_jobs SET status='interrupted' WHERE id=? AND status='running'",(row['id'],))
                        continue
                    receipt.update(status='interrupted',error='NEXEN restarted during this draft. No automatic retry was made.');self.record(receipt)
        except RuntimeError:return

    def request_stop(self,ident):
        """Signal only this instance's active thread even if its receipt is unreadable."""
        if self.active==ident:self.cancelled.set()

    async def shutdown(self):
        if self.active:
            try:self.cancel(self.active)
            except HTTPException as error:
                if error.status_code not in {404,409}:raise
                self.request_stop(self.active)
        deadline=time.monotonic()+30
        while self.active and time.monotonic()<deadline:await asyncio.sleep(.1)

def register(app,db):
    from app_lifecycle import register_lifecycle
    from pc_control import validate_request
    bridge=KiloBridge(db)
    register_lifecycle(app, startup=bridge.recover, shutdown=bridge.shutdown)
    @app.get('/kilo',response_class=HTMLResponse)
    def page(request:Request):validate_request(request);return (BASE/'kilo.html').read_text(encoding='utf-8')
    @app.get('/api/kilo/status')
    def status(request:Request):
        validate_request(request)
        result = bridge.status()
        controller = getattr(app.state, 'continuity', None)
        if controller is not None:
            state = controller.status()
            result['continuous_worker_running'] = state['worker_running']
            result['continuity_enabled'] = state['enabled']
            result['continuity_gate'] = state['gate']
            result['queue_mode'] = 'prepared-drafts' if state['enabled'] else 'explicit-run'
        return result
    @app.post('/api/kilo/prepare',status_code=201)
    def prepare(body:DraftRequest,request:Request):validate_request(request,mutation=True);return bridge.prepare(body)
    @app.get('/api/kilo/jobs/{ident}')
    def get(ident:str,request:Request):validate_request(request);return bridge.get(ident)
    @app.post('/api/kilo/jobs/{ident}/run',status_code=202)
    async def run(ident:str,request:Request):validate_request(request,mutation=True);return await bridge.start(ident)
    @app.post('/api/kilo/jobs/{ident}/cancel')
    def cancel(ident:str,request:Request):validate_request(request,mutation=True);return bridge.cancel(ident)
    return bridge

class LocalDB:
    @contextmanager
    def connect(self):
        connection=sqlite3.connect(BASE/'data/nexen.db',timeout=10);connection.row_factory=sqlite3.Row
        try:yield connection;connection.commit()
        except Exception:connection.rollback();raise
        finally:connection.close()
    def rows(self,sql,args=()):
        with self.connect() as connection:return [dict(row) for row in connection.execute(sql,args)]

def main():
    parser=argparse.ArgumentParser(description='Prepare or run one local Kilo draft for an existing NEXEN task.')
    parser.add_argument('action',choices=['status','prepare','run'])
    parser.add_argument('--task-id',type=int)
    parser.add_argument('--project',choices=['nexen','wdr','lumipaw','music','life'],default='nexen')
    parser.add_argument('--kind',choices=['code','workflow','guide'],default='workflow')
    parser.add_argument('--job-id')
    args=parser.parse_args()
    if args.action=='prepare' and not args.task_id:parser.error('--task-id is required for prepare')
    if args.action=='run' and not args.job_id:parser.error('--job-id is required for run')
    bridge=KiloBridge(LocalDB())
    if args.action=='status':result=bridge.status()
    elif args.action=='prepare':result=bridge.prepare(DraftRequest(request_key=uuid.uuid4().hex,task_id=args.task_id,project=args.project,kind=args.kind))
    else:
        async def one():
            await bridge.start(args.job_id)
            while bridge.active:await asyncio.sleep(.2)
            return bridge.get(args.job_id)
        result=asyncio.run(one())
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
