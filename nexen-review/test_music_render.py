"""H-only isolated files and fake processes. No DAW is launched by these tests."""
import asyncio
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import Mock,patch

from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
import app_auth
import music_render as m
from task_tracking import TaskCreate
from test_support import fixture_root


class DB:
    def __init__(self,path):self.path=path;self.memory_vault=path.parent/'vault'
    @contextmanager
    def connect(self):
        c=sqlite3.connect(self.path,timeout=5);c.row_factory=sqlite3.Row
        try:
            with c:yield c
        finally:c.close()
    def rows(self,sql,args=()):
        with self.connect() as c:return [dict(row) for row in c.execute(sql,args)]

class Process:
    pid=98765
    def __init__(self,*,running=False,code=0):self.returncode=None if running else code;self.terminated=False;self.killed=False
    def poll(self):return self.returncode
    def terminate(self):self.terminated=True;self.returncode=-1
    def kill(self):self.killed=True;self.returncode=-9
    def wait(self,timeout=None):return self.returncode

class Adapter:
    def __init__(self):self.busy=False;self.process=Process();self.launches=[];self.write_output=True
    def ready(self):pass
    def running(self):return self.busy
    def launch(self,project,output):
        self.launches.append((project,output))
        if self.write_output:(output/'project.mp3').write_bytes(b'fixture audio'*300)
        return self.process

class RenderTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=fixture_root());self.root=Path(self.temp.name)
        self.source_root=self.root/'songs';self.source_root.mkdir();self.source=self.source_root/'Fixture Song.flp'
        self.source.write_bytes(b'FLhd'+b'fixture project'*100)
        self.digest=hashlib.sha256(self.source.read_bytes()).hexdigest();self.project='a'*16
        self.inventory=self.root/'inventory.json';self.write_inventory()
        self.db=DB(self.root/'fixture.sqlite3');self.adapter=Adapter()
        self.service=m.MusicRender(self.db,root=self.root/'output',source_root=self.source_root,inventory=self.inventory,
                                   adapter=self.adapter,validator=self.validate,space=lambda:40*1024**3,task_id=1,timeout=.05)
        self.service.tracker.create(TaskCreate(text='Export library listening copies and stems'))
        self.service.import_inventory()
    def tearDown(self):
        asyncio.run(self.service.shutdown());self.temp.cleanup()
    def write_inventory(self):
        self.inventory.write_text(json.dumps({'pilot_candidates':[{'candidate_id':self.project,'path':str(self.source),
          'sha256':self.digest,'bytes':self.source.stat().st_size,'song_candidate':True}]}))
    def validate(self,path):return {'codec':'mp3','duration_seconds':60.,'bitrate_bps':128000,'sample_rate':44100,'channels':2,
        'sha256':m.hash_file(path,m.MAX_AUDIO_BYTES),'bytes':path.stat().st_size,'stream_verified':True,'audible_mix_verified':False}
    def enqueue(self,**changes):return self.service.enqueue(m.Enqueue(**{'project_id':self.project,'request_key':'b'*32,**changes}))
    def ready(self,job=None):
        job=job or self.enqueue()
        return self.service.preflight(job['id'],m.Preflight(copied_project_load_checked=True,missing_assets_resolved=True,
              render_settings_checked=True,user_data_hf_checked=True,nexen_profile_setup_checked=True,expected_duration_seconds=60))
    def run_job(self,job):
        self.service.start(job['id']);self.service.future.result(timeout=5);return self.service.get(job['id'])

    def test_enqueue_copies_hashes_idempotently_and_preserves_task_and_source(self):
        before=self.service.tracker.get(1);job=self.enqueue();again=self.enqueue()
        self.assertEqual(job['id'],again['id']);self.assertEqual(job['status'],'needs_preflight')
        self.assertEqual(Path(job['copied_project']).read_bytes(),self.source.read_bytes())
        self.assertEqual(m.hash_file(self.source,m.MAX_PROJECT_BYTES),self.digest)
        after=self.service.tracker.get(1);self.assertEqual(before['status'],after['status']);self.assertEqual(len(after['history']),1)
        self.assertEqual(len(self.db.rows('SELECT * FROM music_render_jobs')),1)
        with self.assertRaises(HTTPException):self.enqueue(kind='stems')
        self.assertEqual(self.adapter.launches,[])

    def test_request_rejects_paths_shell_and_unknown_fields(self):
        for change in ({'project_id':'../song.flp'},{'source_path':str(self.source)},{'command':'anything'},{'kind':'wav'}):
            with self.subTest(change=change),self.assertRaises(ValidationError):self.enqueue(**change)

    def test_stems_are_explicitly_blocked_and_never_launched(self):
        job=self.enqueue(kind='stems');self.assertEqual(job['status'],'blocked');self.assertIn('lossless WAV',job['reason'])
        with self.assertRaises(HTTPException):self.service.start(job['id'])
        self.assertIsNone(job['output']);self.assertEqual(self.adapter.launches,[])

    def test_existing_fl_and_low_disk_block_without_stopping_unowned_process(self):
        job=self.ready();self.adapter.busy=True
        with self.assertRaises(HTTPException):self.service.start(job['id'])
        self.assertFalse(self.adapter.process.terminated);self.assertIsNone(self.service.active)
        self.adapter.busy=False;self.service.space=lambda:1
        with self.assertRaises(HTTPException):self.service.start(job['id'])
        self.assertEqual(self.adapter.launches,[])

    def test_old_off_c_check_and_stale_receipt_do_not_authorize_a_render(self):
        job=self.enqueue()
        checks=m.Preflight(copied_project_load_checked=True,missing_assets_resolved=True,
                           render_settings_checked=True,user_data_off_c_checked=True)
        self.assertEqual(self.service.preflight(job['id'],checks)['status'],'needs_preflight')
        with self.assertRaises(HTTPException):self.service.start(job['id'])
        ready=self.ready(job);ready['preflight'].pop('storage_policy_version');self.service.save(ready)
        with self.assertRaises(HTTPException) as error:self.service.start(job['id'])
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.adapter.launches,[])

    def test_storage_policy_failure_stops_before_dispatch(self):
        job=self.ready()
        with patch.object(self.adapter,'ready',side_effect=m.StoragePolicyError('NEXEN saves only to H: or F:.')):
            with self.assertRaises(HTTPException) as error:self.service.start(job['id'])
        self.assertEqual(error.exception.status_code,409)
        self.assertIn('H: or F:',error.exception.detail)
        self.assertIsNone(self.service.active);self.assertEqual(self.adapter.launches,[])

    def test_profile_process_probe_timeout_is_a_setup_conflict(self):
        job=self.enqueue()
        with patch.object(self.adapter,'confirm_profile_setup',create=True,side_effect=m.subprocess.TimeoutExpired('tasklist',8)):
            with self.assertRaises(HTTPException) as error:self.ready(job)
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.service.get(job['id'])['status'],'needs_preflight')
        self.assertEqual(self.adapter.launches,[])

    def test_hash_validation_failures_are_conflicts_without_job_completion(self):
        with patch.object(m,'hash_file',side_effect=ValueError('fixture missing source')):
            with self.assertRaises(HTTPException) as error:self.enqueue()
        self.assertEqual(error.exception.status_code,409)
        original=m.hash_file
        def fail_copy(path,limit):
            if path.name=='project.flp':raise ValueError('fixture copy grew')
            return original(path,limit)
        with patch.object(m,'hash_file',side_effect=fail_copy):
            with self.assertRaises(HTTPException) as error:self.enqueue()
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.db.rows('SELECT * FROM music_render_jobs'),[])
        job=self.enqueue()
        with patch.object(m,'hash_file',side_effect=ValueError('fixture missing copy')):
            with self.assertRaises(HTTPException) as error:self.ready(job)
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.service.get(job['id'])['status'],'needs_preflight')
        rendered=self.run_job(self.ready(job))
        with patch.object(m,'hash_file',side_effect=ValueError('fixture audio oversized')):
            with self.assertRaises(HTTPException) as error:self.service.accept(rendered['id'],m.ListenCheck(audible_mix_confirmed=True))
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.service.get(job['id'])['status'],'rendered')

    def test_source_change_and_copy_change_require_new_preflight(self):
        job=self.ready();copy=Path(job['copied_project']);copy.write_bytes(b'FLhdchanged')
        with self.assertRaises(HTTPException):self.service.start(job['id'])
        self.ready(job);self.source.write_bytes(b'FLhdnew source')
        with self.assertRaises(HTTPException):self.service.start(job['id'])
        self.assertEqual(self.adapter.launches,[])

    def test_verified_audio_is_linked_to_memory_and_requires_listen_without_global_completion(self):
        job=self.run_job(self.ready());self.assertEqual(job['status'],'rendered')
        self.assertTrue(job['output']['stream_verified']);self.assertFalse(job['task_completed'])
        self.assertEqual(job['output']['bitrate_bps'],128000)
        self.assertEqual(m.hash_file(self.source,m.MAX_PROJECT_BYTES),self.digest)
        with self.assertRaises(HTTPException):self.service.accept(job['id'],m.ListenCheck(audible_mix_confirmed=False))
        complete=self.service.accept(job['id'],m.ListenCheck(audible_mix_confirmed=True,notes='Fixture full mix checked'))
        again=self.service.accept(job['id'],m.ListenCheck(audible_mix_confirmed=True))
        self.assertEqual(complete,again);self.assertEqual(complete['status'],'complete')
        self.assertEqual(self.service.tracker.get(1)['status'],'planned')
        self.assertTrue(self.db.rows("SELECT * FROM completion_memory WHERE event_key=?",('music-render:'+job['id']+':complete',)))
        self.assertTrue(any(self.db.memory_vault.rglob('event-*.md')))

    def test_missing_output_nonzero_exit_and_bad_stream_never_report_rendered(self):
        for mode in ('missing','exit','invalid'):
            job=self.ready(self.enqueue(request_key={'missing':'c','exit':'d','invalid':'e'}[mode]*32))
            self.adapter.write_output=mode!='missing';self.adapter.process=Process(code=4 if mode=='exit' else 0)
            if mode=='invalid':self.service.validator=lambda path:(_ for _ in ()).throw(ValueError('invalid stream'))
            result=self.run_job(job);self.assertIn(result['status'],{'blocked','failed'});self.assertIsNone(result['output'])

    def test_timeout_stops_only_owned_process_and_retry_is_bounded_idempotent(self):
        self.adapter.process=Process(running=True);job=self.run_job(self.ready())
        self.assertEqual(job['status'],'blocked');self.assertTrue(self.adapter.process.terminated)
        second=self.service.retry(job['id']);self.assertEqual(second['attempt'],2)
        self.assertEqual(second['parent_job_id'],job['id']);self.assertEqual(self.service.retry(job['id'])['id'],second['id'])
        self.assertNotEqual(second['copied_project'],job['copied_project'])
        self.service.cancel(second['id']);third=self.service.retry(second['id']);self.service.cancel(third['id'])
        with self.assertRaises(HTTPException):self.service.retry(third['id'])

    def test_cancel_during_validation_preserves_audio_without_acceptance(self):
        def validate(path):self.service.stop.set();return self.validate(path)
        self.service.validator=validate;job=self.run_job(self.ready())
        self.assertEqual(job['status'],'cancelled');self.assertIsNone(job['output'])
        self.assertTrue((self.service.folder(job)/'audio/project.mp3').exists())

    def test_cancel_running_job_stops_its_process_and_rejects_second_dispatch(self):
        self.service.timeout=5;self.adapter.process=Process(running=True)
        first=self.ready();second=self.ready(self.enqueue(request_key='d'*32));self.service.start(first['id'])
        until=time.monotonic()+2
        while not self.adapter.launches and time.monotonic()<until:time.sleep(.01)
        with self.assertRaises(HTTPException):self.service.start(second['id'])
        self.service.cancel(first['id']);self.service.future.result(timeout=5)
        self.assertTrue(self.adapter.process.terminated)
        self.assertEqual(self.service.get(first['id'])['status'],'cancelled')
        self.assertEqual(self.service.get(second['id'])['status'],'ready')

    def test_prerequisite_failure_is_controlled_and_releases_lease(self):
        job=self.ready()
        with patch.object(self.adapter,'ready',side_effect=ValueError('private path')):
            with self.assertRaises(HTTPException) as error:self.service.start(job['id'])
        self.assertEqual(error.exception.status_code,409);self.assertNotIn('private path',error.exception.detail)
        self.assertIsNone(self.service.active)
        self.assertEqual(self.run_job(job)['status'],'rendered')

    def test_bad_receipt_does_not_hide_other_status_and_persona_lineage(self):
        job=self.enqueue(persona='Future persona label',genre='Future genre')
        with self.db.connect() as connection:connection.execute('UPDATE music_render_jobs SET receipt_json=? WHERE id=?',('{bad',job['id']))
        other=self.enqueue(request_key='d'*32)
        status=self.service.status();rows={row['id']:row for row in status['jobs']}
        self.assertEqual(rows[job['id']]['status'],'receipt_unavailable');self.assertEqual(rows[other['id']]['status'],'needs_preflight')

    def test_output_is_never_overwritten_and_cross_process_lease_is_respected(self):
        job=self.ready();audio=self.service.folder(job)/'audio/project.mp3';audio.write_bytes(b'preserve')
        with self.assertRaises(HTTPException):self.service.start(job['id'])
        self.assertEqual(audio.read_bytes(),b'preserve');audio.unlink()
        with m.SingleWriter(self.service.root):
            with self.assertRaises(HTTPException):self.service.start(job['id'])
        self.assertEqual(self.adapter.launches,[])

    def test_recovery_records_interruption_without_using_saved_pid(self):
        job=self.ready();job.update(status='rendering',pid=1234);self.service.save(job)
        self.service.recover();self.assertEqual(self.service.get(job['id'])['status'],'interrupted')
        self.assertFalse(self.adapter.process.terminated);self.assertEqual(self.adapter.launches,[])

    def test_shutdown_always_closes_executor_and_preserves_worker_failure(self):
        for error in (TimeoutError('bounded wait expired'),RuntimeError('worker failed')):
            with self.subTest(error=type(error).__name__):
                self.service.future=types.SimpleNamespace(done=lambda:False,result=Mock(side_effect=error))
                try:
                    with patch.object(self.service.executor,'shutdown',wraps=self.service.executor.shutdown) as close:
                        with self.assertRaises(type(error)):asyncio.run(self.service.shutdown())
                        close.assert_called_once_with(wait=False,cancel_futures=True)
                    self.assertTrue(self.service.stop.is_set());self.assertTrue(self.service.closing)
                finally:self.service.future=None

    def test_new_source_version_preserves_old_job_lineage(self):
        old=self.enqueue();self.source.write_bytes(b'FLhdnew valid version');self.digest=m.hash_file(self.source,m.MAX_PROJECT_BYTES);self.write_inventory()
        self.service.import_inventory();new=self.enqueue(request_key='f'*32)
        self.assertNotEqual(old['source_sha256'],new['source_sha256']);self.assertEqual(self.service.get(old['id'])['source_sha256'],old['source_sha256'])

    def test_routes_require_password_session_and_same_origin_before_dispatch(self):
        app=FastAPI();store=app_auth.AuthStore(self.root/'auth')
        with patch.object(app_auth,'AuthStore',return_value=store):gate=app_auth.register(app)
        @app.middleware('http')
        async def auth(request,call_next):
            rejected=gate(request);return rejected if rejected is not None else await call_next(request)
        with patch.object(m,'MusicRender',return_value=self.service):m.register(app,self.db)
        with TestClient(app,base_url='http://127.0.0.1:8788',client=('127.0.0.1',44444)) as client:
            self.assertEqual(client.get('/api/music-render/status').status_code,401)
            client.cookies.set(app_auth.COOKIE,store.setup('fixture-music-password-123456'))
            self.assertEqual(client.get('/music-render').status_code,200)
            body={'project_id':self.project,'request_key':'a'*32}
            self.assertEqual(client.post('/api/music-render/jobs',json=body).status_code,403)
            headers={'Origin':'http://127.0.0.1:8788','X-Nexen-Action':'launch'}
            response=client.post('/api/music-render/jobs',json=body,headers=headers);self.assertEqual(response.status_code,200)
            self.assertEqual(client.post('/api/music-render/jobs',json={**body,'source_path':'C:/private'},headers=headers).status_code,422)
            self.assertEqual(client.get('/api/music-render/status',headers={'Host':'evil.invalid'}).status_code,403)
        self.assertEqual(self.adapter.launches,[])

class NativeContracts(unittest.TestCase):
    def test_fixed_cli_has_no_shell_or_stems_or_bitrate_switch(self):
        with tempfile.TemporaryDirectory(dir=fixture_root()) as directory:
            root=Path(directory);adapter=m.NativeFL(root)
            with patch.object(adapter,'user_data_path',return_value=root),patch.object(adapter,'require_profile_setup',return_value={}),patch.object(m.subprocess,'Popen') as spawn:
                adapter.launch(root/'project.flp',root/'audio')
            args,kwargs=spawn.call_args
            self.assertEqual(args[0],[str(m.FL_EXE),'/Emp3','/R',str(root/'project.flp'),'/O'+str(root/'audio')])
            self.assertNotIn('shell',kwargs);self.assertEqual(kwargs['env']['TEMP'],str(root/'temp'))
            self.assertTrue(all(Path(kwargs['env'][key]).is_relative_to(root) for key in ('TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA')))

    def test_actual_registry_setting_is_validated_before_any_spawn(self):
        import winreg
        with tempfile.TemporaryDirectory(dir=fixture_root()) as directory:
            root=Path(directory);adapter=m.NativeFL(root)
            with patch.object(winreg,'OpenKey') as opened,patch.object(winreg,'QueryValueEx') as query,patch.object(m.subprocess,'Popen') as spawn:
                for path,kind in [('C:/Users/example/Documents/FL Studio',winreg.REG_SZ),
                                  ('D:/Music',winreg.REG_SZ),('E:/Music',winreg.REG_SZ),
                                  ('H:/missing-folder-fixture-20260909',winreg.REG_SZ),
                                  (str(root),winreg.REG_EXPAND_SZ)]:
                    query.return_value=(path,kind)
                    with self.subTest(path=path,kind=kind),self.assertRaises(m.StoragePolicyError):
                        adapter.launch(root/'project.flp',root/'audio')
                    self.assertFalse(adapter.storage_status()['configured_paths_verified'])
                spawn.assert_not_called()
                query.return_value=(str(root),winreg.REG_SZ)
                self.assertEqual(adapter.user_data_path(),root.resolve())
                self.assertTrue(adapter.storage_status()['configured_paths_verified'])
                self.assertFalse(adapter.storage_status()['third_party_write_confinement'])
                opened.assert_called_with(winreg.HKEY_CURRENT_USER,r'Software\Image-Line\Shared\Paths')
                query.side_effect=FileNotFoundError('fixture missing registry')
                self.assertFalse(adapter.storage_status()['configured_paths_verified'])

    def test_empty_or_changed_profile_never_authorizes_background_render(self):
        with tempfile.TemporaryDirectory(dir=fixture_root()) as directory:
            root=Path(directory);adapter=m.NativeFL(root);exe=root/'FL64.exe';exe.write_bytes(b'fixture executable')
            m.tool_environment(root)
            with patch.object(m,'FL_EXE',exe),patch.object(adapter,'user_data_path',return_value=root),patch.object(adapter,'running',return_value=False),patch.object(m.subprocess,'Popen') as spawn:
                with self.assertRaises(m.StoragePolicyError):adapter.launch(root/'project.flp',root/'audio')
                spawn.assert_not_called()
                receipt=adapter.confirm_profile_setup()
                self.assertTrue(receipt['basis'].startswith('user_reported_'))
                self.assertEqual(adapter.require_profile_setup(),receipt)
                exe.write_bytes(b'fixture changed executable')
                with self.assertRaises(m.StoragePolicyError):adapter.launch(root/'project.flp',root/'audio')
                spawn.assert_not_called()

    def test_real_mutagen_parser_accepts_synthetic_mp3_headers_and_rejects_text(self):
        if not m.DEPENDENCY.is_file():self.skipTest('Pinned MP3 validator wheel is not installed; no parser validation claimed.')
        with tempfile.TemporaryDirectory(dir=fixture_root()) as directory:
            path=Path(directory)/'fixture.mp3'
            path.write_bytes((b'\xff\xfb\x90\x00'+b'\x00'*413)*100)
            result=m.inspect_mp3(path)
            self.assertEqual(result['codec'],'mp3');self.assertEqual(result['bitrate_bps'],128000)
            self.assertFalse(result['audible_mix_verified']);self.assertFalse(result['decoded_entire_file'])
            path.write_bytes(b'not an MP3'*300)
            with self.assertRaises(Exception):m.inspect_mp3(path)

if __name__=='__main__':unittest.main()
