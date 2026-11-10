"""Single-project FL Studio rendering with durable task and source lineage.

Only catalogued personal FLPs can be copied and rendered. No source code,
arbitrary CLI arguments, stems switch, cloud model or payment adapter is used.
"""
from __future__ import annotations
import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from typing import Literal
import uuid

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, ConfigDict, Field
from completion_memory import record_event, export_journal
from file_census import SingleWriter
from memory_bridge import _reject_links
from task_tracking import Tracker
from storage_policy import StoragePolicyError, require_output_path, tool_environment

BASE=Path(__file__).resolve().parent
ROOT=Path('H:/NEXEN/music')
INVENTORY=Path('H:/NEXEN/work/music-render-inventory-private.json')
FL_EXE=Path('F:/FL STUDIO 24/FL64.exe')
SOURCE_ROOT=Path('F:/LOCAL_USER MUSIC MAKING FOLDER')
DEPENDENCY=ROOT/'dependencies/mutagen-1.48.1-py3-none-any.whl'
DEPENDENCY_SHA='4f077fe87d3fc7fba259aa63d8c026b18382ca6a42ef37c61e16f1b1b5b82fe7'
MIN_FREE_BYTES=20*1024**3
MAX_PROJECT_BYTES=128*1024**2
MAX_AUDIO_BYTES=512*1024**2
MAX_ATTEMPTS=3
RENDER_TIMEOUT=1800
STEM_BLOCKER='Stems need a human FL export setup: mixer or playlist tracks, dry/wet effects, shared start/range and lossless WAV settings. MP3 or mixed WAV is not a stem export.'

def now():return datetime.now(timezone.utc).isoformat()
def hash_file(path,limit):
    _reject_links(path)
    if not path.is_file() or path.stat().st_size>limit:raise ValueError('File is missing or exceeds its size limit.')
    digest=hashlib.sha256();size=0
    with path.open('rb') as source:
        while data:=source.read(1024*1024):
            size+=len(data)
            if size>limit:raise ValueError('File changed beyond its size limit.')
            digest.update(data)
    return digest.hexdigest()

def checked_hash(path,limit):
    """Expose changed/missing local input as an actionable conflict, not a 500."""
    try:return hash_file(path,limit)
    except (ValueError,OSError):
        raise HTTPException(409,'The project or audio file is missing, changed, unreadable or outside its size limit. Review it before continuing.') from None

def atomic_json(path,data):
    path=require_output_path(path)
    temporary=path.with_name('.'+path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with temporary.open('x',encoding='utf-8') as stream:
            json.dump(data,stream,ensure_ascii=False,indent=2);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        if temporary.exists():temporary.unlink()

def mutagen_class():
    if hash_file(DEPENDENCY,1024*1024)!=DEPENDENCY_SHA:raise ValueError('The MP3 validator dependency needs verification.')
    if str(DEPENDENCY) not in sys.path:sys.path.insert(0,str(DEPENDENCY))
    from mutagen.mp3 import MP3
    return MP3

def inspect_mp3(path):
    """Verify a real MPEG Layer III stream, not just an .mp3 filename."""
    digest=hash_file(path,MAX_AUDIO_BYTES)
    if path.stat().st_size<1024:raise ValueError('The MP3 output is too small to validate.')
    info=mutagen_class()(path).info
    duration=float(info.length)
    if info.layer!=3 or info.sketchy or not math.isfinite(duration) or not 1<=duration<=7200:
        raise ValueError('The output is not a valid bounded MP3 stream.')
    if info.channels not in (1,2) or info.sample_rate not in (32000,44100,48000) or not 32000<=info.bitrate<=330000:
        raise ValueError('The MP3 stream settings are outside supported listening-copy bounds.')
    return {'validator':'mutagen-1.48.1','codec':'mp3','duration_seconds':duration,
            'bitrate_bps':info.bitrate,'sample_rate':info.sample_rate,'channels':info.channels,
            'sha256':digest,'bytes':path.stat().st_size,'stream_verified':True,
            'decoded_entire_file':False,'audible_mix_verified':False,
            'limitation':'Stream parsing does not prove every sample, plugin, vocal or effect is present. Listen to the full mix.'}

class NativeFL:
    def __init__(self,root=ROOT):self.root=require_output_path(root)
    def user_data_path(self):
        """Read FL's actual configured save root, without changing its settings."""
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Image-Line\Shared\Paths') as key:
            value,kind=winreg.QueryValueEx(key,'Shared data')
        if kind!=winreg.REG_SZ or not isinstance(value,str):
            raise StoragePolicyError('FL Studio needs a verified H: or F: user-data folder.')
        path=require_output_path(value)
        if not path.is_dir():raise StoragePolicyError('FL Studio user-data folder is unavailable; no fallback is allowed.')
        return path
    def profile_identity(self):
        """Bind a user-reported setup check to these actual paths and FL build."""
        paths={name:str(require_output_path(self.root/relative,within=self.root)) for name,relative in
               {'profile':'profile','roaming':'profile/roaming','local':'profile/local'}.items()}
        if not all(Path(value).is_dir() for value in paths.values()):
            raise StoragePolicyError('Open FL Studio using the NEXEN FL button, complete first-run setup and close FL before checking this profile.')
        _reject_links(FL_EXE);build=FL_EXE.stat()
        return {**paths,'user_data':str(self.user_data_path()),'executable':str(FL_EXE),
                'build_size':build.st_size,'build_modified_ns':build.st_mtime_ns}
    def confirm_profile_setup(self):
        """Record an explicit user check; never infer setup from empty folders."""
        identity=self.profile_identity()
        if self.running():raise StoragePolicyError('Save and close FL after first-run setup before confirming this check.')
        receipt={'schema_version':1,'basis':'user_reported_nexen_profile_opened_configured_and_closed',
                 'checked_at':now(),'identity':identity}
        atomic_json(self.root/'profile'/'fl-setup-check.json',receipt)
        return receipt
    def require_profile_setup(self):
        identity=self.profile_identity()
        try:
            path=require_output_path(self.root/'profile'/'fl-setup-check.json',within=self.root)
            with path.open('rb') as stream:raw=stream.read(16385)
            if len(raw)>16384:raise ValueError('Oversized profile receipt')
            receipt=json.loads(raw)
            if receipt.get('schema_version')!=1 or receipt.get('identity')!=identity or receipt.get('basis')!='user_reported_nexen_profile_opened_configured_and_closed':raise ValueError('Stale profile receipt')
        except (OSError,ValueError,AttributeError):
            raise StoragePolicyError('Complete the visible NEXEN FL profile setup check before background rendering. A folder alone is not an initialized profile.') from None
        return receipt
    def storage_status(self):
        result={'allowed_drives':['H:','F:'],'output_root':str(self.root/'exports'),
                'configured_paths_verified':False,'fl_user_data':None,
                'third_party_write_confinement':False,
                'scope':'NEXEN output, copied projects and redirected caches. Plugin-specific save paths still require inspection.'}
        try:
            require_output_path(self.root)
            result['fl_user_data']=str(self.user_data_path())
            result['configured_paths_verified']=True
        except (OSError,ValueError,ImportError) as error:
            result['blocker']=str(error) if isinstance(error,StoragePolicyError) else 'FL Studio storage settings could not be verified. No render may start.'
        return result
    def running(self):
        tasklist=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/tasklist.exe'
        result=subprocess.run([str(tasklist),'/FO','CSV','/NH'],capture_output=True,timeout=8,
                              creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode or len(result.stdout)>2*1024*1024:raise ValueError('Windows process inventory is unavailable.')
        rows=csv.reader(io.StringIO(result.stdout.decode('utf-8',errors='replace')))
        return any(row and row[0].casefold() in {'fl.exe','fl64.exe','flengine_x64.exe','flengine.exe'} for row in rows)
    def ready(self):
        require_output_path(self.root)
        self.user_data_path()
        _reject_links(FL_EXE)
        if not FL_EXE.is_file():raise ValueError('The configured F: FL Studio executable is missing.')
        self.require_profile_setup()
        mutagen_class()
    def launch(self,project,output):
        self.user_data_path()
        self.require_profile_setup()
        project=require_output_path(project,within=self.root)
        output=require_output_path(output,within=self.root)
        env=tool_environment(self.root)
        require_output_path(project,within=self.root)
        require_output_path(output,within=self.root)
        # The single-project command is documented by Image-Line. Bitrate,
        # range and tails come from the inspected FL export settings.
        argv=[str(FL_EXE),'/Emp3','/R',str(project),'/O'+str(output)]
        return subprocess.Popen(argv,cwd=FL_EXE.parent,env=env,stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))

class Enqueue(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_key:str=Field(pattern=r'^[a-f0-9]{32}$')
    project_id:str=Field(pattern=r'^[a-f0-9]{16}$')
    kind:Literal['mp3','stems']='mp3'
    persona:str|None=Field(default=None,max_length=120)
    genre:str|None=Field(default=None,max_length=120)

class Preflight(BaseModel):
    model_config=ConfigDict(extra='forbid')
    copied_project_load_checked:bool=Field(strict=True)
    missing_assets_resolved:bool=Field(strict=True)
    render_settings_checked:bool=Field(strict=True)
    user_data_off_c_checked:bool=Field(default=False,strict=True)
    user_data_hf_checked:bool=Field(default=False,strict=True)
    nexen_profile_setup_checked:bool=Field(default=False,strict=True)
    expected_duration_seconds:float|None=Field(default=None,gt=1,le=7200)
    notes:str=Field(default='',max_length=2000)

class ListenCheck(BaseModel):
    model_config=ConfigDict(extra='forbid')
    audible_mix_confirmed:bool=Field(strict=True)
    notes:str=Field(default='',max_length=2000)

class MusicRender:
    def __init__(self,db,*,root=ROOT,inventory=INVENTORY,source_root=SOURCE_ROOT,task_id=94,
                 adapter=None,validator=inspect_mp3,space=None,timeout=RENDER_TIMEOUT):
        self.db=db;self.root=require_output_path(root);self.inventory=Path(inventory);self.source_root=Path(source_root)
        _reject_links(self.root);self.root.mkdir(parents=True,exist_ok=True)
        self.task_id=task_id;self.tracker=Tracker(db);self.adapter=adapter or NativeFL(self.root)
        self.validator=validator;self.space=space or (lambda:shutil.disk_usage(self.root).free)
        self.timeout=timeout;self.lock=threading.RLock();self.stop=threading.Event()
        self.inventory_status={'status':'not_loaded','reason':'The reviewed project inventory has not been loaded.'}
        self.active=None;self.process=None;self.future=None;self.closing=False;self.executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='nexen-music-render')
        with db.connect() as c:
            c.executescript('''CREATE TABLE IF NOT EXISTS music_render_projects(
                id TEXT PRIMARY KEY,path TEXT NOT NULL,sha256 TEXT NOT NULL,metadata_json TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS music_render_jobs(
                id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,payload_hash TEXT NOT NULL,
                project_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,receipt_json TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS music_render_retries(parent_id TEXT PRIMARY KEY,child_id TEXT UNIQUE NOT NULL);''')

    def import_inventory(self):
        _reject_links(self.inventory)
        if self.inventory.stat().st_size>2*1024**2:raise ValueError('Inventory exceeds the bounded import size.')
        data=json.loads(self.inventory.read_text(encoding='utf-8-sig'))
        entries=data.get('pilot_candidates') if isinstance(data,dict) else None
        if not isinstance(entries,list) or len(entries)>2500:raise ValueError('A verified personal-project inventory is required.')
        accepted=[]
        for item in entries:
            if not isinstance(item,dict) or item.get('song_candidate') is not True:continue
            ident=item.get('candidate_id');digest=item.get('sha256');value=item.get('path')
            if not isinstance(ident,str) or not re.fullmatch('[a-f0-9]{16}',ident) or not isinstance(digest,str) or not re.fullmatch('[a-f0-9]{64}',digest) or not isinstance(value,str):
                raise ValueError('Inventory contains a malformed project identity.')
            path=Path(value);_reject_links(path)
            if not path.is_absolute() or not path.resolve().is_relative_to(self.source_root.resolve()) or path.suffix.lower()!='.flp':
                raise ValueError('Inventory project is outside the personal music root.')
            if any(part.lower() in {'backup','backups','autosave','templates','template'} for part in path.parts):continue
            if type(item.get('bytes')) is not int or not 0<item['bytes']<=MAX_PROJECT_BYTES:raise ValueError('Invalid project size.')
            accepted.append((ident,str(path),digest,json.dumps(item)))
        with self.db.connect() as c:
            for row in accepted:c.execute('''INSERT INTO music_render_projects VALUES(?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET path=excluded.path,sha256=excluded.sha256,metadata_json=excluded.metadata_json''',row)
        self.inventory_status={'status':'ready','accepted':len(accepted),'scope':'Reviewed personal candidates only; other libraries/backups need a bounded inventory pass.'}
        return self.inventory_status

    def projects(self):
        return [{'id':row['id'],'title':Path(row['path']).stem,'source_path':row['path'],'source_sha256':row['sha256']}
                for row in self.db.rows('SELECT * FROM music_render_projects ORDER BY id')]

    def get(self,ident):
        if not re.fullmatch('[a-f0-9]{32}',ident):raise HTTPException(404,'Render job not found.')
        rows=self.db.rows('SELECT receipt_json FROM music_render_jobs WHERE id=?',(ident,))
        if not rows:raise HTTPException(404,'Render job not found.')
        try:data=json.loads(rows[0]['receipt_json'])
        except (ValueError,TypeError):raise HTTPException(409,'Render receipt is unavailable.') from None
        if not isinstance(data,dict) or data.get('id')!=ident:raise HTTPException(409,'Render receipt is unavailable.')
        return data

    def folder(self,job):
        for name,length in (('project_id',16),('source_sha256',64),('id',32)):
            if not re.fullmatch('[a-f0-9]{'+str(length)+'}',str(job.get(name,''))):raise ValueError('Malformed render lineage.')
        result=require_output_path(self.root/'exports'/job['project_id']/job['source_sha256']/job['id'],within=self.root)
        return result

    def save(self,job):
        job['updated_at']=now()
        # SQLite is authoritative; file mirroring failure is explicit and can
        # never turn valid recorded audio into a fabricated missing result.
        with self.db.connect() as c:c.execute('UPDATE music_render_jobs SET status=?,receipt_json=? WHERE id=?',(job['status'],json.dumps(job),job['id']))
        try:atomic_json(self.folder(job)/'receipt.json',job)
        except OSError:
            job['receipt_mirror']='pending'
            with self.db.connect() as c:c.execute('UPDATE music_render_jobs SET receipt_json=? WHERE id=?',(json.dumps(job),job['id']))
        return job

    def record(self,job):
        event_key='music-render:'+job['id']+':'+job['status']
        outcome=json.dumps({'job_id':job['id'],'status':job['status'],'source_sha256':job['source_sha256'],
                            'task_id':self.task_id,'output':job.get('output'),'reason':job.get('reason'),
                            'persona':job.get('persona'),'genre':job.get('genre')},ensure_ascii=False)
        with self.db.connect() as c:
            added=record_event(c,event_key,'music_render',job['id'],'Music listening render: '+job['title'],job['status'],
                               outcome,basis='verified_mp3_stream; audible mix requires user check' if job.get('output') else 'local_render_status')
            if added:
                task=c.execute('SELECT status FROM hub_requests WHERE id=?',(self.task_id,)).fetchone()
                if task:c.execute('INSERT INTO task_history(request_id,old_status,new_status,outcome,created_at) VALUES(?,?,?,?,?)',
                                  (self.task_id,task[0],task[0],outcome,now()))
        export_journal(self.db)

    def enqueue(self,body,parent=None):
        body=Enqueue.model_validate(body)
        with self.lock:
            self.tracker.get(self.task_id)
            fingerprint=hashlib.sha256(body.model_dump_json(exclude={'request_key'}).encode()).hexdigest()
            previous=self.db.rows('SELECT id,payload_hash FROM music_render_jobs WHERE request_key=?',(body.request_key,))
            if previous:
                if previous[0]['payload_hash']!=fingerprint:raise HTTPException(409,'Request key belongs to another render.')
                return self.get(previous[0]['id'])
            entries=self.db.rows('SELECT * FROM music_render_projects WHERE id=?',(body.project_id,))
            if not entries:raise HTTPException(404,'Choose a catalogued personal project.')
            project=entries[0];source=Path(project['path']);_reject_links(source)
            if not source.resolve().is_relative_to(self.source_root.resolve()) or source.suffix.lower()!='.flp':raise HTTPException(409,'Project path no longer matches the reviewed music root.')
            if self.space()<MIN_FREE_BYTES:raise HTTPException(409,'Keep at least 20 GiB free on the render drive before making a job.')
            if checked_hash(source,MAX_PROJECT_BYTES)!=project['sha256']:raise HTTPException(409,'Source project changed. Refresh its reviewed inventory before rendering.')
            with source.open('rb') as stream:
                if stream.read(4)!=b'FLhd':raise HTTPException(409,'Project does not have a valid FLP header.')
            ident=uuid.uuid4().hex
            job={'id':ident,'project_id':body.project_id,'source_path':str(source),'source_sha256':project['sha256'],
                 'source_metadata':json.loads(project['metadata_json']),'title':source.stem,'task_id':self.task_id,
                 'kind':body.kind,'persona':body.persona,'genre':body.genre,'parent_job_id':parent.get('id') if parent else None,
                 'attempt':parent['attempt']+1 if parent else 1,'max_attempts':MAX_ATTEMPTS,
                 'status':'blocked' if body.kind=='stems' else 'needs_preflight','reason':STEM_BLOCKER if body.kind=='stems' else 'Inspect the copied project and export settings before starting.',
                 'created_at':now(),'updated_at':now(),'output':None,'render_process_started':False,'task_completed':False}
            folder=self.folder(job);folder.mkdir(parents=True,exist_ok=False);(folder/'audio').mkdir()
            if body.kind=='mp3':
                with source.open('rb') as src,(folder/'project.flp').open('xb') as dst:shutil.copyfileobj(src,dst,1024*1024)
                if checked_hash(folder/'project.flp',MAX_PROJECT_BYTES)!=project['sha256']:raise HTTPException(409,'Project changed while making the copy; job was not queued.')
                job['copied_project']=str(folder/'project.flp')
            with self.db.connect() as c:
                c.execute('INSERT INTO music_render_jobs VALUES(?,?,?,?,?,?,?)',
                          (ident,body.request_key,fingerprint,body.project_id,job['status'],job['created_at'],json.dumps(job)))
                if parent:c.execute('INSERT INTO music_render_retries VALUES(?,?)',(parent['id'],ident))
            self.save(job);self.record(job);return job

    def preflight(self,ident,body):
        body=Preflight.model_validate(body)
        with self.lock:
            job=self.get(ident)
            if job['kind']!='mp3':raise HTTPException(409,STEM_BLOCKER)
            if job['status'] not in {'needs_preflight','ready'}:raise HTTPException(409,'This render needs a new explicit retry before preflight.')
            checks=body.model_dump()
            job['preflight']={**checks,'storage_policy_version':2,'basis':'user_reported_copied_project_checks','checked_at':now()}
            job['copy_sha256']=checked_hash(self.folder(job)/'project.flp',MAX_PROJECT_BYTES)
            ready=all(checks[name] is True for name in ('copied_project_load_checked','missing_assets_resolved','render_settings_checked','user_data_hf_checked','nexen_profile_setup_checked'))
            if ready and hasattr(self.adapter,'confirm_profile_setup'):
                try:job['preflight']['profile_setup']=self.adapter.confirm_profile_setup()
                except (OSError,ValueError,subprocess.SubprocessError):raise HTTPException(409,'Open FL Studio from NEXEN, complete first-run setup in that profile, inspect the copied project and close FL before saving these checks.') from None
            job.update(status='ready' if ready else 'needs_preflight',reason='Ready for one explicit MP3 render.' if ready else 'Complete the missing copied-project checks. No FL process was started.')
            return self.save(job)

    def start(self,ident):
        with self.lock:
            if self.closing:raise HTTPException(409,'The render service is shutting down. Restart NEXEN before dispatching a job.')
            if self.active:raise HTTPException(409,'A music render is already active. Wait or cancel it.')
            job=self.get(ident)
            if job['kind']!='mp3' or job['status']!='ready':raise HTTPException(409,'Complete the copied-project preflight before starting this MP3 job.')
            if job.get('preflight',{}).get('storage_policy_version')!=2 or job['preflight'].get('user_data_hf_checked') is not True or job['preflight'].get('nexen_profile_setup_checked') is not True:
                raise HTTPException(409,'Review the H:/F:-only storage checks again. The older off-C check is insufficient.')
            lease=SingleWriter(self.root)
            try:lease.__enter__()
            except RuntimeError:raise HTTPException(409,'Another NEXEN music worker is active.') from None
            try:
                self.adapter.ready()
                if self.adapter.running():raise HTTPException(409,'Close FL Studio after saving your session. Existing FL processes will not be stopped.')
                if self.space()<MIN_FREE_BYTES:raise HTTPException(409,'The render drive has less than the required 20 GiB reserve.')
                if hash_file(Path(job['source_path']),MAX_PROJECT_BYTES)!=job['source_sha256']:raise HTTPException(409,'Original project changed since the reviewed inventory.')
                if hash_file(self.folder(job)/'project.flp',MAX_PROJECT_BYTES)!=job.get('copy_sha256'):raise HTTPException(409,'Copied project changed since preflight. Inspect it again.')
                if any((self.folder(job)/'audio').iterdir()):raise HTTPException(409,'Output directory is not empty; use a new retry job to preserve prior files.')
                self.stop.clear();self.active=ident;job.update(status='rendering',reason='Starting one copied-project render.',started_at=now())
                self.save(job)
                response=dict(job)
                self.future=self.executor.submit(self._run,job,lease)
                return response
            except StoragePolicyError as error:
                self.active=None;lease.__exit__(None,None,None)
                raise HTTPException(409,str(error)) from None
            except (OSError,ValueError,ImportError,subprocess.SubprocessError) as error:
                self.active=None;lease.__exit__(None,None,None)
                raise HTTPException(409,'FL Studio, MP3 validation or Windows process checks are unavailable. Resolve the local prerequisite before starting.') from None
            except Exception:
                self.active=None;lease.__exit__(None,None,None);raise

    def _stop_owned(self):
        process=self.process
        if process is None or process.poll() is not None:return
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)

    def _run(self,job,lease):
        ident=job['id']
        try:
            # Check again immediately before spawn; never delegate rendering
            # into an already-open unsaved FL Studio session.
            if self.stop.is_set():job.update(status='cancelled',reason='Cancelled before the render process started.');return
            if self.adapter.running():job.update(status='blocked',reason='FL Studio opened before dispatch. Save and close it, then make an explicit retry.');return
            folder=self.folder(job)
            if hash_file(folder/'project.flp',MAX_PROJECT_BYTES)!=job['copy_sha256']:
                job.update(status='blocked',reason='Copied project changed immediately before dispatch; no FL process was started.');return
            self.process=self.adapter.launch(folder/'project.flp',folder/'audio')
            if hasattr(self.adapter,'storage_status'):job['storage_at_launch']=self.adapter.storage_status()
            job.update(render_process_started=True,pid=self.process.pid,reason='FL Studio is rendering the copied project.');self.save(job)
            deadline=time.monotonic()+self.timeout
            while self.process.poll() is None:
                if self.stop.wait(.25):
                    self._stop_owned();job.update(status='cancelled',reason='Stopped only the render process started by this job.');return
                if self.space()<MIN_FREE_BYTES:
                    self._stop_owned();job.update(status='blocked',reason='Low output-drive space. The owned render was stopped; partial outputs remain.');return
                if time.monotonic()>=deadline:
                    self._stop_owned();job.update(status='blocked',reason='Render timed out. A plugin/sample dialog, activation issue or unsupported CLI behavior may need attention. Partial outputs remain; no automatic retry.');return
            job['exit_code']=self.process.returncode
            if self.process.returncode:
                job.update(status='failed',reason='FL Studio returned a nonzero exit code. Inspect the copied project for plugins, samples or activation issues.');return
            if self.stop.is_set():job.update(status='cancelled',reason='Cancelled before audio validation.');return
            job.update(status='validating',reason='Checking the actual MP3 stream.');self.save(job)
            audio=folder/'audio'/'project.mp3'
            if not audio.is_file():job.update(status='blocked',reason='FL exited without the expected MP3. CLI/settings or missing assets need inspection; no output is marked rendered.');return
            result=self.validator(audio)
            if self.stop.is_set():job.update(status='cancelled',reason='Cancelled during validation. The produced audio remains in this job folder and was not accepted.');return
            expected=job['preflight'].get('expected_duration_seconds')
            if expected and abs(result['duration_seconds']-expected)>max(5,expected*.05):
                job.update(status='blocked',reason='MP3 duration differs from the checked full-song range. Inspect selection, mode and tails.');return
            if hash_file(Path(job['source_path']),MAX_PROJECT_BYTES)!=job['source_sha256']:
                job.update(status='blocked',reason='Original project changed during the render. Preserve this output and reconcile versions.');return
            job.update(status='rendered',reason='MP3 stream verified. Listen to the complete mix before accepting it; stems are still separate.',
                       output={**result,'path':str(audio),'url':'/api/music-render/jobs/'+ident+'/audio'})
        except Exception as error:
            try:self._stop_owned()
            except Exception:job['owned_process_stop_unconfirmed']=True
            job.update(status='failed',reason='Render or audio validation failed; inspect the copied project and validator.',error_class=type(error).__name__)
        finally:
            try:
                job['finished_at']=now();self.save(job);self.record(job)
            finally:
                self.process=None
                with self.lock:self.active=None
                lease.__exit__(None,None,None)

    def cancel(self,ident):
        with self.lock:
            job=self.get(ident)
            if ident==self.active:self.stop.set();return {**job,'cancellation_requested':True}
            if job['status'] in {'needs_preflight','ready'}:
                job.update(status='cancelled',reason='Cancelled before process launch.');self.save(job);self.record(job)
            return job

    def retry(self,ident):
        with self.lock:
            job=self.get(ident)
            previous=self.db.rows('SELECT child_id FROM music_render_retries WHERE parent_id=?',(ident,))
            if previous:return self.get(previous[0]['child_id'])
            if job['kind']!='mp3' or job['status'] not in {'failed','blocked','interrupted','cancelled'}:raise HTTPException(409,'Only a stopped MP3 job can be retried.')
            if job['attempt']>=MAX_ATTEMPTS:raise HTTPException(409,'This retry chain reached its three-attempt limit. Resolve the project issue before a new reviewed plan.')
            return self.enqueue(Enqueue(request_key=uuid.uuid4().hex,project_id=job['project_id'],persona=job['persona'],genre=job['genre']),parent=job)

    def accept(self,ident,body):
        body=ListenCheck.model_validate(body)
        with self.lock:
            job=self.get(ident)
            if job['status']=='complete':return job
            if job['status']!='rendered' or not body.audible_mix_confirmed:raise HTTPException(409,'A verified MP3 and a full-mix listening confirmation are required.')
            if checked_hash(self.folder(job)/'audio/project.mp3',MAX_AUDIO_BYTES)!=job['output']['sha256']:raise HTTPException(409,'Audio changed since validation. It cannot be accepted under this receipt.')
            job.update(status='complete',reason='Listening copy accepted. This does not complete the entire library or the stem task.',
                       listening_check={'confirmed':True,'basis':'user_reported_full_mix_listen','notes':body.notes,'at':now()})
            self.save(job);self.record(job);return job

    def recover(self):
        # A saved PID is not ownership proof after restart. Do not kill it.
        for row in self.db.rows("SELECT id FROM music_render_jobs WHERE status IN ('rendering','validating')"):
            job=self.get(row['id']);job.update(status='interrupted',reason='NEXEN restarted during this job. Inspect FL and partial outputs; no automatic retry or PID-based termination.')
            self.save(job);self.record(job)

    async def shutdown(self):
        with self.lock:self.closing=True;self.stop.set()
        future=self.future
        try:
            if future and not future.done():await asyncio.to_thread(future.result,15)
        finally:self.executor.shutdown(wait=False,cancel_futures=True)

    def status(self):
        jobs=[]
        for row in self.db.rows('SELECT id FROM music_render_jobs ORDER BY created_at DESC LIMIT 50'):
            try:jobs.append(self.get(row['id']))
            except HTTPException as error:
                if error.status_code!=409:raise
                jobs.append({'id':row['id'],'status':'receipt_unavailable'})
        return {'task_id':self.task_id,'active_job':self.active,'projects':self.projects(),'jobs':jobs,'output_root':str(self.root/'exports'),
                'inventory_status':self.inventory_status,
                'storage':self.adapter.storage_status() if hasattr(self.adapter,'storage_status') else {'configured_paths_verified':False,'scope':'Injected adapter; native storage not checked.'},
                'free_bytes':self.space(),'reserve_bytes':MIN_FREE_BYTES,'fl_executable_exists':FL_EXE.is_file(),
                'automatic_mp3_adapter':True,'live_mp3_pilot_verified':any(j.get('output',{}).get('stream_verified') for j in jobs if j.get('output')),
                'stems_automated':False,'stems_blocker':STEM_BLOCKER,'whole_library_inventoried':False,
                'limits':'One explicit job at a time. No cloud calls, source edits, overwrite or automatic retries. FL user-data paths and plugin completeness require copied-project inspection.'}

def register(app,db):
    from app_lifecycle import register_lifecycle
    from pc_control import validate_request
    service=MusicRender(db)
    def startup():
        service.recover()
        try:service.import_inventory()
        except (OSError,ValueError) as error:
            service.inventory_status={'status':'blocked','reason':'The reviewed personal-project inventory is unavailable or invalid.','error_class':type(error).__name__}
    register_lifecycle(app,startup=startup,shutdown=service.shutdown)
    @app.get('/music-render',response_class=HTMLResponse)
    def page(request:Request):validate_request(request);return PAGE
    @app.get('/api/music-render/status')
    def status(request:Request):validate_request(request);return service.status()
    @app.get('/api/music-render/projects')
    def projects(request:Request):validate_request(request);return {'projects':service.projects(),'inventory_status':service.inventory_status}
    @app.post('/api/music-render/jobs')
    def enqueue(body:Enqueue,request:Request):validate_request(request,mutation=True);return service.enqueue(body)
    @app.get('/api/music-render/jobs/{ident}')
    def get(ident:str,request:Request):validate_request(request);return service.get(ident)
    @app.post('/api/music-render/jobs/{ident}/preflight')
    def preflight(ident:str,body:Preflight,request:Request):validate_request(request,mutation=True);return service.preflight(ident,body)
    @app.post('/api/music-render/jobs/{ident}/start')
    def start(ident:str,request:Request):validate_request(request,mutation=True);return service.start(ident)
    @app.post('/api/music-render/jobs/{ident}/cancel')
    def cancel(ident:str,request:Request):validate_request(request,mutation=True);return service.cancel(ident)
    @app.post('/api/music-render/jobs/{ident}/retry')
    def retry(ident:str,request:Request):validate_request(request,mutation=True);return service.retry(ident)
    @app.post('/api/music-render/jobs/{ident}/accept')
    def accept(ident:str,body:ListenCheck,request:Request):validate_request(request,mutation=True);return service.accept(ident,body)
    @app.get('/api/music-render/jobs/{ident}/audio')
    def audio(ident:str,request:Request):
        validate_request(request);job=service.get(ident)
        if job['status'] not in {'rendered','complete'}:raise HTTPException(409,'Verified MP3 is not available yet.')
        path=service.folder(job)/'audio/project.mp3';_reject_links(path)
        if not path.is_file() or path.stat().st_size!=job['output']['bytes'] or hash_file(path,MAX_AUDIO_BYTES)!=job['output']['sha256']:raise HTTPException(409,'The saved audio is missing or changed.')
        return FileResponse(path,media_type='audio/mpeg')
    return service

PAGE='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NEXEN · Music renders</title>
<style>*{box-sizing:border-box}body{margin:0;background:#071623;color:#e3f3ff;font:16px/1.55 system-ui}main{max-width:1080px;margin:auto;padding:28px}a{color:#8bdbff}h1{font-size:40px;margin-bottom:0}p,small{color:#b0c8db}section,article{background:#102a40;border:1px solid #376782;border-radius:18px;padding:20px;margin:18px 0}button,select,input{font:inherit;border-radius:8px;border:1px solid #598dad;padding:10px;background:#0b2032;color:inherit}button{cursor:pointer;margin:5px}button:disabled{opacity:.5;cursor:wait}label{display:block;margin:10px 0}code{overflow-wrap:anywhere}audio{width:100%}.status{color:#9fe6ff}#notice{min-height:28px}details{margin:14px 0}</style>
<main><a href="/" target="_top">NEXEN home</a> · <a href="/tasks" target="_top">Task 94 and history</a><h1>Music renders.</h1><p>Make listening copies. Preserve every original project and keep stems separate.</p><p id="notice" role="status">Loading the render queue…</p><p id="error" role="alert"></p>
<section aria-labelledby="storage-title"><h2 id="storage-title">Saves stay on H: or F:</h2><p id="storage" role="status">Checking configured output and FL user-data folders…</p><p>NEXEN rejects other drives and redirected output folders. Plugin-specific saves and Windows-managed files are outside this path guard.</p></section><section><h2>Create a project copy</h2><label>Reviewed personal song <select id="project"></select></label><button id="queue">Queue MP3 listening copy</button><button id="stems">Record stem export setup</button><p>Only reviewed song candidates appear here. The rest of the library, backups and templates need a bounded inventory pass.</p></section>
<section><h2>Before the first render</h2><button id="setup-fl">Open FL for profile setup</button><p>This opens FL with the same H: profile used for rendering. Finish any setup or plugin dialogs, then close FL normally. This check is your report of the visible setup; NEXEN cannot infer it from an empty folder.</p><p>Inspect the job's copied FLP in FL Studio. Resolve missing samples/plugins, check full-song range, tails and MP3 settings, and confirm FL and plugin save locations are on H: or F:. Save the original session and close FL before pressing Start.</p><p>Actual bitrate and duration are read from the output. A working MP3 does not prove the intended vocal and effects are present; listen before accepting the mix.</p></section><div id="jobs"></div></main><script>
const el=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let locked=false,signature='';
async function api(url,body){const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Nexen-Action':'launch'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.detail||'Request failed');return d}
async function refresh(){if(locked)return;try{const data=await api('/api/music-render/status');const storage=data.storage||{};el('storage').textContent=storage.configured_paths_verified?'Renders: '+storage.output_root+' · FL user data: '+storage.fl_user_data:(storage.blocker||'Storage settings are not verified; rendering is blocked.');if(!el('project').options.length)el('project').innerHTML=data.projects.map(p=>`<option value="${p.id}">${esc(p.title)}</option>`).join('');el('queue').disabled=el('stems').disabled=!data.projects.length;const next=JSON.stringify(data.jobs.map(j=>[j.id,j.status,j.updated_at]));el('notice').textContent=(data.active_job?'One render active. ':'Queue ready. ')+data.jobs.length+' recorded jobs · '+Math.floor(data.free_bytes/1024**3)+' GiB free';if(next===signature)return;signature=next;el('jobs').innerHTML=data.jobs.map(j=>`<article data-id="${j.id}"><h2>${esc(j.title)}</h2><strong class="status">${esc(j.status.replaceAll('_',' '))}</strong><p>${esc(j.reason)}</p><small>Attempt ${j.attempt}/${j.max_attempts} · ${esc(j.kind)} · Task ${j.task_id}</small>${j.copied_project?`<details><summary>Copied project and source identity</summary><code>${esc(j.copied_project)}</code><p>Original SHA-256: ${esc(j.source_sha256)}</p></details>`:''}${['needs_preflight','ready'].includes(j.status)?`<details><summary>Copied-project checks</summary>${[['copied_project_load_checked','The copied project opens correctly'],['missing_assets_resolved','No unresolved samples or plugins'],['render_settings_checked','Full-song MP3 range and export settings checked'],['user_data_hf_checked','FL user data, plugin saves and backups are set to H: or F:'],['nexen_profile_setup_checked','I opened FL with the NEXEN button, finished first-run setup, checked this copied project and closed FL normally']].map(([k,t])=>`<label><input type="checkbox" name="${k}" ${j.preflight?.[k]?'checked':''}> ${t}</label>`).join('')}<button data-action="preflight">Save checks</button></details>`:''}${j.status==='ready'?'<button data-action="start">Start one MP3 render</button>':''}${['needs_preflight','ready','rendering','validating'].includes(j.status)?'<button data-action="cancel">Cancel job</button>':''}${['failed','blocked','cancelled','interrupted'].includes(j.status)&&j.kind==='mp3'?'<button data-action="retry">Create a fresh retry copy</button>':''}${j.output?`<p>${Math.round(j.output.duration_seconds)} seconds · ${Math.round(j.output.bitrate_bps/1000)} kbps · ${j.output.sample_rate} Hz</p><audio controls preload="none" src="${esc(j.output.url)}"></audio>${j.status==='rendered'?'<label><input type="checkbox" name="listened"> I listened to the full mix; intended vocals, instruments and effects are present.</label><button data-action="accept">Accept listening copy</button>':''}`:''}</article>`).join('')}catch(e){el('error').textContent=e.message}}
async function create(kind){if(locked)return;locked=true;el('error').textContent='';try{await api('/api/music-render/jobs',{project_id:el('project').value,kind,request_key:crypto.randomUUID().replaceAll('-','')})}catch(e){el('error').textContent=e.message}finally{locked=false;refresh()}}
el('setup-fl').onclick=async()=>{if(locked)return;locked=true;el('setup-fl').disabled=true;try{const result=await api('/api/pc/launch',{id:'flstudio'});el('notice').textContent=result.message}catch(error){el('error').textContent=error.message}finally{locked=false;el('setup-fl').disabled=false}};el('queue').onclick=()=>create('mp3');el('stems').onclick=()=>create('stems');el('jobs').onclick=async e=>{const action=e.target.dataset.action;if(!action||locked)return;const card=e.target.closest('article');let body={};if(action==='preflight')for(const k of ['copied_project_load_checked','missing_assets_resolved','render_settings_checked','user_data_hf_checked','nexen_profile_setup_checked'])body[k]=card.querySelector(`[name="${k}"]`).checked;if(action==='accept')body.audible_mix_confirmed=card.querySelector('[name="listened"]').checked;locked=true;el('error').textContent='';e.target.disabled=true;try{await api('/api/music-render/jobs/'+card.dataset.id+'/'+action,body)}catch(error){el('error').textContent=error.message}finally{locked=false;e.target.disabled=false;refresh()}};refresh();setInterval(refresh,3000);
</script></html>'''

class LocalDB:
    @contextmanager
    def connect(self):
        connection=sqlite3.connect(BASE/'data/nexen.db',timeout=10);connection.row_factory=sqlite3.Row
        try:
            with connection:yield connection
        finally:connection.close()
    def rows(self,sql,args=()):
        with self.connect() as connection:return [dict(row) for row in connection.execute(sql,args)]

def main():
    parser=argparse.ArgumentParser(description='NEXEN reviewed FL project queue. Run requires a saved copied-project preflight from /music-render.')
    parser.add_argument('action',choices=['status','enqueue','run','retry'])
    parser.add_argument('--project-id')
    parser.add_argument('--job-id')
    parser.add_argument('--kind',choices=['mp3','stems'],default='mp3')
    args=parser.parse_args()
    if args.action=='enqueue' and not args.project_id:parser.error('--project-id is required for enqueue')
    if args.action in {'run','retry'} and not args.job_id:parser.error('--job-id is required')
    service=MusicRender(LocalDB())
    try:
        service.import_inventory()
        if args.action=='status':result=service.status()
        elif args.action=='enqueue':result=service.enqueue(Enqueue(project_id=args.project_id,kind=args.kind,request_key=uuid.uuid4().hex))
        elif args.action=='retry':result=service.retry(args.job_id)
        else:
            service.start(args.job_id)
            service.future.result(timeout=RENDER_TIMEOUT+60)
            result=service.get(args.job_id)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    finally:asyncio.run(service.shutdown())

if __name__=='__main__':main()
