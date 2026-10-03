"""H: fixtures only. No real model, account, task completion or worker launch."""
import asyncio
from contextlib import contextmanager
import copy
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import sys
import unittest
from unittest.mock import patch

from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
import app_auth
import kilo_bridge as module
from task_tracking import TaskCreate
from test_support import fixture_root

class DB:
    def __init__(self,path):self.path=path
    @contextmanager
    def connect(self):
        conn=sqlite3.connect(self.path,timeout=10);conn.row_factory=sqlite3.Row
        try:yield conn;conn.commit()
        except Exception:conn.rollback();raise
        finally:conn.close()
    def rows(self,sql,args=()):
        with self.connect() as conn:return [dict(row) for row in conn.execute(sql,args)]

class KiloBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=fixture_root());self.root=Path(self.temp.name)
        self.patches=[patch.object(module,'ROOT',self.root),patch.object(module,'JOBS',self.root/'jobs'),
                      patch.object(module,'INSTALL',self.root/'install.json')]
        for p in self.patches:p.start()
        self.db=DB(self.root/'fixture.sqlite3');self.bridge=module.KiloBridge(self.db)
        self.task=self.bridge.tracker.create(TaskCreate(text='Fixture: verify NEXEN workflow'))
        self.base_context={'documents':[{'path':'context/user.md','text':'Kilo Code on Windows; current local setup.'}],
                           'knowledge':{'status':'query_required'}}
        self.memory={'status':'ready','text':'SOURCE kb:1: verification guidance','citations':[{'id':'kb:1'}],
                     'warnings':[],'egress_policy':'local_only'}
        self.context_patch=patch.object(module,'context',side_effect=lambda project:copy.deepcopy(self.base_context));self.context_patch.start()
        self.memory_patch=patch('memory_runtime.context_for',return_value=self.memory);self.memory_call=self.memory_patch.start()
    async def asyncTearDown(self):
        if self.bridge.active:
            self.bridge.cancel(self.bridge.active)
            if self.bridge.worker:await self.bridge.worker
        self.memory_patch.stop();self.context_patch.stop()
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
        self.assertFalse(module.RUN_LOCK.locked())
    def request(self,**changes):return module.DraftRequest(**{'request_key':'a'*32,'task_id':self.task,**changes})

    async def test_prepare_loads_current_profile_and_typed_memory_without_task_mutation(self):
        before=self.bridge.tracker.get(self.task);receipt=self.bridge.prepare(self.request(kind='code'))
        self.memory_call.assert_called_once_with('Fixture: verify NEXEN workflow\n',task_type='code',pool='engineering')
        prompt=(self.root/'jobs'/receipt['id']/'prompt.txt').read_text()
        self.assertIn('Kilo Code on Windows',prompt);self.assertIn('SOURCE kb:1',prompt)
        self.assertLess(prompt.index('current local setup'),prompt.index('SOURCE kb:1'))
        self.assertEqual(receipt['knowledge_status'],'ready');self.assertFalse(receipt['executed'])
        self.assertEqual(self.bridge.tracker.get(self.task),before)

    async def test_prepare_is_idempotent_and_conflicting_reuse_is_rejected(self):
        first=self.bridge.prepare(self.request());again=self.bridge.prepare(self.request())
        self.assertEqual(first['id'],again['id']);self.assertEqual(len(self.db.rows('SELECT id FROM kilo_draft_jobs')),1)
        with self.assertRaises(HTTPException) as error:self.bridge.prepare(self.request(instructions='changed'))
        self.assertEqual(error.exception.status_code,409)

    async def test_invalid_task_and_request_fields_never_prepare(self):
        with self.assertRaises(HTTPException):self.bridge.prepare(self.request(task_id=999))
        for value in ({'task_id':True},{'task_id':'1'},{'project':'../private'},{'request_key':'bad'},{'command':'anything'}):
            with self.assertRaises(ValidationError):self.request(**value)
        with self.assertRaises(HTTPException):self.bridge.get('../secrets')

    async def test_cancel_prepared_job_never_starts_process(self):
        receipt=self.bridge.prepare(self.request());result=self.bridge.cancel(receipt['id'])
        self.assertEqual(result['status'],'cancelled')
        with patch.object(module.subprocess,'Popen') as spawn:
            again=await self.bridge.start(receipt['id'])
        self.assertEqual(again['status'],'cancelled');spawn.assert_not_called()

    async def test_cancel_during_configuration_releases_worker_without_generation(self):
        receipt=self.bridge.prepare(self.request())
        def config():self.bridge.cancelled.set();return True
        with patch.object(module,'verify_config',side_effect=config),patch.object(module.subprocess,'Popen') as spawn:
            await self.bridge.start(receipt['id']);await self.bridge.worker
        self.assertEqual(self.bridge.get(receipt['id'])['status'],'cancelled');spawn.assert_not_called()

    async def test_cross_process_lease_prevents_second_worker(self):
        receipt=self.bridge.prepare(self.request())
        with module.SingleWriter(self.root):
            with self.assertRaises(HTTPException) as error:await self.bridge.start(receipt['id'])
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.bridge.get(receipt['id'])['status'],'prepared')

    async def test_schema_error_or_changed_prompt_never_launches_model(self):
        receipt=self.bridge.prepare(self.request());folder=self.root/'jobs'/receipt['id']
        (folder/'prompt.txt').write_text('tampered')
        with patch.object(module,'verify_config',return_value=True),patch.object(module.subprocess,'Popen') as spawn:
            await self.bridge.start(receipt['id']);await self.bridge.worker
        spawn.assert_not_called();self.assertEqual(self.bridge.get(receipt['id'])['status'],'failed')

    async def test_status_preserves_healthy_jobs_when_one_receipt_is_unavailable(self):
        broken=self.bridge.prepare(self.request())
        healthy=self.bridge.prepare(self.request(request_key='b'*32))
        (self.root/'jobs'/broken['id']/'receipt.json').write_text('{malformed',encoding='utf-8')
        jobs={job['id']:job for job in self.bridge.status()['jobs']}
        self.assertEqual(jobs[broken['id']]['status'],'receipt_unavailable')
        self.assertFalse(jobs[broken['id']]['executed'])
        self.assertEqual(jobs[healthy['id']]['status'],'prepared')
        with patch.object(self.bridge,'get',side_effect=HTTPException(403,'fixture policy denial')):
            with self.assertRaises(HTTPException) as error:self.bridge.status()
        self.assertEqual(error.exception.status_code,403)

    async def test_routes_keep_origin_guard_and_actual_auth_gate(self):
        app=FastAPI();module.register(app,self.db)
        with TestClient(app,base_url='http://127.0.0.1:8788',client=('127.0.0.1',40100)) as client:
            self.assertEqual(client.get('/api/kilo/status',headers={'Host':'evil.invalid'}).status_code,403)
            self.assertEqual(client.post('/api/kilo/prepare',json=self.request().model_dump()).status_code,403)
        protected=FastAPI();auth=app_auth.AuthStore(self.root/'auth-fixture')
        with patch.object(app_auth,'AuthStore',return_value=auth):gate=app_auth.register(protected)
        @protected.middleware('http')
        async def protect(request,call_next):
            blocked=gate(request)
            return blocked if blocked is not None else await call_next(request)
        module.register(protected,self.db)
        with TestClient(protected,base_url='http://127.0.0.1:8788',client=('127.0.0.1',40100)) as client:
            self.assertEqual(client.get('/api/kilo/status').status_code,401)
            self.assertEqual(client.post('/api/kilo/prepare',json=self.request().model_dump(),headers={
                'Origin':'http://127.0.0.1:8788','X-Nexen-Action':'launch','X-Nexen-Service':auth.service_key}).status_code,401)

    async def test_recover_unavailable_receipt_preserves_other_jobs_without_retry(self):
        broken=self.bridge.prepare(self.request())
        healthy=self.bridge.prepare(self.request(request_key='b'*32))
        for receipt in (broken,healthy):
            receipt['status']='running';self.bridge.record(receipt)
        (self.root/'jobs'/broken['id']/'receipt.json').write_text('{malformed')
        self.bridge.recover()
        self.assertEqual({row['status'] for row in self.db.rows('SELECT status FROM kilo_draft_jobs')},{'interrupted'})
        self.assertEqual(self.bridge.get(healthy['id'])['status'],'interrupted')
        with patch.object(self.bridge,'get',side_effect=HTTPException(403,'Fixture denial')):
            with self.db.connect() as c:c.execute("UPDATE kilo_draft_jobs SET status='running' WHERE id=?",(healthy['id'],))
            with self.assertRaises(HTTPException) as error:self.bridge.recover()
            self.assertEqual(error.exception.status_code,403)

    async def test_shutdown_missing_receipt_signals_owned_thread(self):
        ident='c'*32;self.bridge.active=ident
        async def finish():
            while not self.bridge.cancelled.is_set():await asyncio.sleep(.005)
            self.bridge.active=None
        worker=asyncio.create_task(finish())
        with patch.object(self.bridge,'cancel',side_effect=HTTPException(409,'Fixture receipt missing')):
            await self.bridge.shutdown()
        await worker
        self.assertTrue(self.bridge.cancelled.is_set())
        self.assertIsNone(self.bridge.active)

    async def test_shutdown_does_not_swallow_unrelated_policy_failure(self):
        self.bridge.active='c'*32
        try:
            with patch.object(self.bridge,'cancel',side_effect=HTTPException(403,'Fixture denial')):
                with self.assertRaises(HTTPException) as error:await self.bridge.shutdown()
            self.assertEqual(error.exception.status_code,403)
            self.assertFalse(self.bridge.cancelled.is_set())
        finally:self.bridge.active=None

class KiloOutputTests(unittest.TestCase):
    def test_only_finished_non_error_draft_is_accepted(self):
        rows=[{'type':'text','part':{'text':'A proposed workflow draft.'},'sessionID':'fixture'},
              {'type':'step_finish','part':{'reason':'stop'}}]
        raw='\n'.join(json.dumps(row) for row in rows).encode()
        self.assertEqual(module.parse_events(raw),('A proposed workflow draft.','fixture'))
        for bad in (b'',b'x'*(module.MAX_OUTPUT+1),raw+b'\n'+json.dumps({'type':'error'}).encode(),
                    raw.replace(b'A proposed workflow draft.',b'Maximum steps for this agent have been reached')):
            with self.assertRaises(ValueError):module.parse_events(bad)

    def test_config_rejects_cloud_or_tool_policy_changes_and_wrong_types(self):
        good={'model':module.MODEL,'small_model':module.MODEL,'enabled_providers':['ollama'],
              'permission':{'*':'deny'},'share':'disabled','autoupdate':False,'plugin':[],'mcp':{},
              'provider':{'ollama':{'npm':'@ai-sdk/openai-compatible','options':{'baseURL':'http://127.0.0.1:11434/v1'},
                          'models':{'dolphin3:latest':{'tool_call':False,'limit':{'context':8192,'output':600}}}}},
              'agent':{'nexen-draft':{'permission':{'*':'deny'},'model':module.MODEL,'steps':2}}}
        self.assertTrue(module.valid_config(good))
        for change in ({'enabled_providers':['openrouter']},{'permission':{'*':'allow'}},{'provider':[]},{'agent':None}):
            self.assertFalse(module.valid_config({**good,**change}))
        altered=copy.deepcopy(good);altered['provider']['ollama']['npm']='unexpected-provider'
        self.assertFalse(module.valid_config(altered))

    def test_cli_missing_ids_fail_before_opening_real_database(self):
        for action,flag in (('prepare','--task-id'),('run','--job-id')):
            with self.subTest(action=action),patch.object(sys,'argv',['kilo_bridge.py',action]), \
                 patch.object(sys,'stderr',new_callable=io.StringIO) as error,patch.object(module,'KiloBridge') as bridge:
                with self.assertRaises(SystemExit) as exited:module.main()
                self.assertEqual(exited.exception.code,2)
                self.assertIn(flag+' is required',error.getvalue())
                bridge.assert_not_called()

if __name__=='__main__':unittest.main()
