"""Hourly local handoff fixtures on H:. No models, accounts or original file edits."""
import asyncio
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import app_auth
import handoff_runtime as m
from task_tracking import Tracker,TaskCreate,TaskUpdate


class DB:
    def __init__(self,path):self.path=path;self.memory_vault=path.parent/'vault'
    @contextmanager
    def connect(self):
        c=sqlite3.connect(self.path,timeout=10);c.row_factory=sqlite3.Row
        try:
            with c:yield c
        finally:c.close()
    def rows(self,sql,args=()):
        with self.connect() as c:return [dict(r) for r in c.execute(sql,args)]


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory(dir='H:/NEXEN/temp');self.root=Path(self.temp.name)
        self.db=DB(self.root/'tasks.sqlite3');self.tracker=Tracker(self.db);self.now=1788970000.
        self.state=self.root/'state';self.state.mkdir();self.profile=self.root/'user.md'
        self.profile.write_text('Windows. Kilo Code. password=fixture-secret-token and desktop-privatefixture',encoding='utf-8')
        self.base=self.root/'app';(self.base/'data').mkdir(parents=True)
        self.task=self.tracker.create(TaskCreate(text='Fixture task password=fixture-private-key',priority='urgent'))
        self.workers=[];self.runtime=self.make()
    def make(self,**kwargs):
        runtime=m.HandoffRuntime(self.db,root=self.root/'handoffs',state=self.state,profile=self.profile,base=self.base,clock=lambda:self.now,interval=.05,**kwargs)
        self.workers.append(runtime);return runtime
    async def asyncTearDown(self):
        for worker in self.workers:await worker.shutdown()
        self.temp.cleanup()
    def payload(self,runtime=None):
        runtime=runtime or self.runtime;latest=runtime.latest()
        return json.loads((runtime.root/(latest['snapshot']+'.json')).read_text())
    async def test_startup_checkpoint_then_hourly_only_and_singleton(self):
        self.assertTrue(await self.runtime.start());first=self.runtime.latest();self.assertIsNotNone(first)
        self.assertFalse(await self.runtime.start());self.assertFalse(await self.make().start())
        self.now+=3599;self.assertEqual(self.runtime.checkpoint()['reason'],'not_due')
        self.assertEqual(self.runtime.latest(),first)
        completed=asyncio.Event();loop=asyncio.get_running_loop();original=self.runtime.checkpoint
        def observe(*args,**kwargs):
            result=original(*args,**kwargs)
            if result.get('written'):loop.call_soon_threadsafe(completed.set)
            return result
        with patch.object(self.runtime,'checkpoint',side_effect=observe):
            self.now+=1
            await asyncio.wait_for(completed.wait(),timeout=10)
        self.assertNotEqual(self.runtime.latest()['snapshot'],first['snapshot'])
        self.assertEqual(len(list(self.runtime.root.glob('handoff-*.json'))),2)
    async def test_task_record_is_authoritative_no_completion_or_egress_mutation(self):
        before=self.tracker.get(self.task)
        await self.runtime.start();data=self.payload()
        self.assertEqual(self.tracker.get(self.task),before)
        self.assertEqual(data['tasks'][0]['status'],'planned');self.assertEqual(data['task_mutations'],0)
        text=json.dumps(data);self.assertNotIn('fixture-private-key',text);self.assertNotIn('fixture-secret-token',text);self.assertNotIn('desktop-privatefixture',text)
        self.assertIn('Windows',data['replacement_agent_instructions']);self.assertFalse(data['raw_exports_included'])
        self.tracker.update(self.task,TaskUpdate(status='done',outcome='Explicit fixture user completion'))
        self.now+=3600;self.runtime.checkpoint();data=self.payload()
        self.assertEqual(data['tasks'][0]['status'],'done');self.assertIn('not independently verified execution',data['tasks'][0]['completion_basis'])
    async def test_inputs_bounded_filtered_and_handoff_links_only(self):
        for i in range(12):self.tracker.create(TaskCreate(text='Other fixture '+str(i)))
        (self.state/'code-review.json').write_text(json.dumps({'status':'review_complete','pr_verified':True,'pr_url':'https://untrusted.invalid/steal','token':'do-not-copy','snapshot_sha256':'a'*64}))
        (self.state/'openrouter-install.json').write_text(json.dumps({'key_verified':True,'api_key':'do-not-copy-key','model_url':'http://private-host/'}))
        with self.db.connect() as c:
            c.execute('CREATE TABLE agent_handoffs(id TEXT,target TEXT,task_id INTEGER,created_at TEXT,packet_json TEXT)')
            c.execute('INSERT INTO agent_handoffs VALUES(?,?,?,?,?)',('a'*64,'kilo',self.task,'2026-09-09','RAW PRIVATE EXPORT'))
        await self.runtime.start();data=self.payload();text=json.dumps(data)
        self.assertEqual(len(data['tasks']),10);self.assertIsNone(data['review']['pr_url'])
        for secret in ('do-not-copy','RAW PRIVATE EXPORT','private-host','untrusted.invalid'):self.assertNotIn(secret,text)
        self.assertEqual(data['prepared_handoff']['url'],'/api/agents/handoffs/'+'a'*64)
        self.assertTrue(data['providers']['openrouter']['key_verified']);self.assertFalse(data['providers']['openrouter']['automatic_paid_requests'])
        self.assertTrue(data['sources'])
        self.assertTrue(all(source.get('sha256') is None or len(source['sha256'])==64 for source in data['sources']))
    async def test_partial_write_keeps_previous_atomic_latest_and_allows_immediate_retry(self):
        await self.runtime.start();before=self.runtime.latest();original=self.runtime.atomic
        def fail(name,raw):
            if name.endswith('.md'):raise OSError('private fixture failure')
            return original(name,raw)
        self.now+=3600
        with patch.object(self.runtime,'atomic',side_effect=fail):result=self.runtime.checkpoint()
        self.assertEqual(result['reason'],'write_failed');self.assertEqual(self.runtime.latest(),before)
        self.assertNotIn('private fixture failure',self.runtime.last_error)
        self.assertTrue(self.runtime.checkpoint()['written'])
        self.assertEqual(self.runtime.checkpoint()['reason'],'not_due')
    async def test_failed_initial_checkpoint_retries_on_next_worker_interval(self):
        with patch.object(self.runtime,'atomic',side_effect=OSError('Fixture unavailable output')):
            await self.runtime.start()
        self.assertIsNone(self.runtime.last_attempt)
        self.assertIsNone(self.runtime.latest())
        for _ in range(100):
            if self.runtime.latest():break
            await asyncio.sleep(.01)
        self.assertIsNotNone(self.runtime.latest())
        self.assertEqual(self.runtime.last_attempt,self.now)
    async def test_atomic_replace_failure_preserves_existing_bytes(self):
        await self.runtime.start();path=self.runtime.root/'LATEST.json';before=path.read_bytes()
        with patch.object(m.os,'replace',side_effect=OSError('fixture')):
            with self.assertRaises(OSError):self.runtime.atomic('LATEST.json',b'changed')
        self.assertEqual(path.read_bytes(),before);self.assertEqual(list(self.runtime.root.glob('.*.tmp')),[])
    async def test_retention_only_exact_owned_pairs_and_protects_latest_after_clock_change(self):
        runtime=self.make(retention=2);await runtime.start()
        unknown=runtime.root/'notes.md';unknown.write_text('keep original')
        fake=runtime.root/'handoff-20200101T000000000000Z-aaaaaaaaaaaa.json';fake.write_text('{}')
        for _ in range(3):self.now+=3600;runtime.checkpoint()
        self.assertEqual(len([p for p in runtime.root.glob('handoff-*.json') if p!=fake]),2)
        self.assertTrue(unknown.exists());self.assertEqual(fake.read_text(),'{}')
        self.now-=86400;runtime.checkpoint(startup=True)
        self.assertIsNotNone(runtime.latest());self.assertEqual(len([p for p in runtime.root.glob('handoff-*.json') if p!=fake]),2)
    async def test_pause_markers_remain_and_checkpoint_is_not_model_work(self):
        marker=self.base/'data/PAUSE_AUTONOMY';marker.write_text('existing user pause')
        await self.runtime.start();data=self.payload()
        self.assertTrue(data['pause_markers']['autonomy']);self.assertEqual(marker.read_text(),'existing user pause')
        self.assertEqual((data['model_calls'],data['cloud_submissions'],data['task_mutations']),(0,0,0))
    async def test_bad_or_oversized_sources_are_unknown_not_crashes(self):
        self.profile.write_bytes(b'\xff\xfeinvalid');(self.state/'kilo-install.json').write_text('x'*70000)
        await self.runtime.start();data=self.payload()
        self.assertEqual(data['current_preferences'],'');self.assertTrue(data['warnings'])
        self.assertFalse(data['providers']['kilo']['live_draft_verified'])
    async def test_modified_snapshot_is_not_reported_as_valid_latest(self):
        await self.runtime.start();latest=self.runtime.latest()
        (self.runtime.root/(latest['snapshot']+'.md')).write_text('tampered')
        self.assertIsNone(self.runtime.latest());self.assertIsNone(self.runtime.status()['latest'])


class RouteTests(unittest.TestCase):
    def test_status_and_checkpoint_keep_session_and_origin_guards(self):
        from app_lifecycle import lifespan
        with tempfile.TemporaryDirectory(dir='H:/NEXEN/temp') as directory:
            root=Path(directory);db=DB(root/'fixture.sqlite3');Tracker(db)
            runtime=m.HandoffRuntime(db,root=root/'handoff',state=root/'state',profile=root/'profile.md',base=root)
            app=FastAPI(lifespan=lifespan);store=app_auth.AuthStore(root/'auth')
            with patch.object(app_auth,'AuthStore',return_value=store):gate=app_auth.register(app)
            @app.middleware('http')
            async def guard(request,call_next):
                denied=gate(request);return denied if denied is not None else await call_next(request)
            with patch.object(m,'HandoffRuntime',return_value=runtime):m.register(app,db)
            with TestClient(app,base_url='http://127.0.0.1:8788',client=('127.0.0.1',44000)) as client:
                self.assertEqual(client.get('/api/handoff/status').status_code,401)
                client.cookies.set(app_auth.COOKIE,store.setup('fixture-only-password-123456'))
                self.assertEqual(client.get('/api/handoff/status').status_code,200)
                self.assertEqual(client.post('/api/handoff/checkpoint').status_code,403)
                headers={'Origin':'http://127.0.0.1:8788','X-Nexen-Action':'launch'}
                self.assertEqual(client.post('/api/handoff/checkpoint',headers=headers).status_code,200)
                self.assertEqual(client.post('/api/handoff/checkpoint',headers={**headers,'Origin':'https://evil.invalid'}).status_code,403)


if __name__=='__main__':unittest.main()
