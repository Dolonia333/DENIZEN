from contextlib import contextmanager
from pathlib import Path
import json,sqlite3,tempfile,unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
import app_auth
import v1_readiness as m
from task_tracking import TaskCreate,TaskUpdate
from test_support import fixture_root

class DB:
    def __init__(self,path):self.path=path;self.memory_vault=path.parent/'vault'
    @contextmanager
    def connect(self):
        c=sqlite3.connect(self.path,timeout=15);c.row_factory=sqlite3.Row
        try:yield c;c.commit()
        finally:c.close()
    def rows(self,sql,args=()):
        with self.connect() as c:return [dict(r) for r in c.execute(sql,args)]
    def scalar(self,sql,args=()):
        with self.connect() as c:
            r=c.execute(sql,args).fetchone();return r[0] if r else None

class Tests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(dir=fixture_root(),prefix='readiness-')
        self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name);self.db=DB(self.root/'db.sqlite')
        self.state=self.root/'state';self.state.mkdir()
        self.probe=lambda:{'checked_at':'2026-09-09T00:00:00+00:00','pc2':True,'n8n':True,'omniroute':False}
        self.flow=m.Readiness(self.db,state=self.state,probe=self.probe,adapter_probe=lambda connections:{})
    def receipt(self,name,**kwargs):(self.state/m.RECEIPTS[name]).write_text(json.dumps(kwargs),encoding='utf-8')
    def item(self,name):return next(i for i in self.flow.packet()['items'] if i['id']==name)
    def test_slow_probe_does_not_block_reporting_and_overlapping_refreshes_coalesce(self):
        started,release,second_waiting=threading.Event(),threading.Event(),threading.Event()
        calls=[]
        class ProbeLock:
            def __init__(self):self.lock=threading.Lock();self.entries=0
            def __enter__(self):
                self.entries+=1
                if self.entries==2:second_waiting.set()
                self.lock.acquire()
            def __exit__(self,*args):self.lock.release()
        def probe():
            calls.append(len(calls)+1)
            if len(calls)==1:
                started.set()
                if not release.wait(5):raise RuntimeError('Fixture probe was not released')
            return {'checked_at':'fixture','n8n':True,'generation':len(calls)}
        self.flow.probe=probe;self.flow.probe_lock=ProbeLock()
        with ThreadPoolExecutor(max_workers=3) as pool:
            first=pool.submit(self.flow.connection_snapshot,True)
            try:
                self.assertTrue(started.wait(2))
                second=pool.submit(self.flow.connection_snapshot,True)
                self.assertTrue(second_waiting.wait(2))
                report=pool.submit(self.flow.report,'n8n',m.ReportBody(completed=True,outcome='Fixture setup report.'))
                self.assertTrue(report.result(timeout=2)['changed'])
                self.assertFalse(first.done())
            finally:release.set()
            self.assertEqual(first.result(timeout=2),second.result(timeout=2))
        self.assertEqual(calls,[1])
        self.assertEqual(self.flow.connection_snapshot()['generation'],1)
        self.assertEqual(self.flow.connection_snapshot(True)['generation'],2)
        self.assertEqual(calls,[1,2])
    def test_probe_failure_publishes_fallback_and_releases_probe_lock(self):
        self.flow.probe=lambda:(_ for _ in ()).throw(OSError('Fixture unavailable'))
        fallback=self.flow.connection_snapshot(True)
        self.assertIn('checked_at',fallback)
        self.assertGreater(self.flow.cached_at,0)
        self.flow.probe=lambda:{'checked_at':'recovered','n8n':True}
        self.assertEqual(self.flow.connection_snapshot(True)['checked_at'],'recovered')
    def test_seed_idempotency_preserves_task_history_and_next_step(self):
        ident=self.flow.tasks['pc2'];self.flow.tracker.update(ident,TaskUpdate(status='blocked',next_step='Keep my existing next action.',outcome='Existing evidence.'))
        count=self.db.scalar('SELECT count(*) FROM hub_requests')
        second=m.Readiness(self.db,state=self.state,probe=self.probe);second.packet();second.packet()
        self.assertEqual(second.tasks['pc2'],ident);self.assertEqual(self.db.scalar('SELECT count(*) FROM hub_requests'),count)
        task=second.tracker.get(ident);self.assertEqual(task['status'],'blocked');self.assertEqual(task['next_step'],'Keep my existing next action.');self.assertEqual(len(task['history']),1)
    def test_partial_install_or_generic_verified_flag_does_not_verify_capability(self):
        self.receipt('openrouter',verified=True,browser_sign_in_verified=True)
        self.receipt('kilo',verified=True,installed=True,live_draft_verified=False)
        self.receipt('claude_mem',verified=True,persisted_memory_search_verified=True,native_hook_session_tested=False,observer_inference_tested=False)
        for name in ('openrouter','kilo','claude_mem'):self.assertFalse(self.item(name)['verified'])
        self.assertIn('Browser sign-in is confirmed',self.item('openrouter')['evidence'])
    def test_memsearch_receipt_is_bounded_and_refreshes_without_restart(self):
        self.assertFalse(self.item('memsearch')['verified'])
        self.receipt('memsearch',verified=True,synthetic_query_passed=True,files=4,indexed_chunks_this_pass=15,checked_at='2026-09-09T15:00:00Z',secret='fixture-DO-NOT-OUTPUT')
        item=self.item('memsearch');self.assertTrue(item['verified']);self.assertIn('4 Markdown',item['evidence']);self.assertIn('15 chunks',item['evidence']);self.assertNotIn('fixture-DO-NOT-OUTPUT',json.dumps(item))
        self.assertIsNone(item['task'])
    def test_completion_persists_once_without_changing_verification(self):
        body=m.ReportBody(completed=True,outcome='Owner setup finished; testing still needed.')
        first=self.flow.report('n8n',body);again=self.flow.report('n8n',body)
        self.assertTrue(first['changed']);self.assertFalse(again['changed']);self.assertFalse(first['execution_unlocked'])
        task=self.flow.tracker.get(first['task_id']);self.assertEqual(len(task['history']),1);self.assertTrue(task['history'][0]['outcome'].startswith('user_reported:'))
        self.assertEqual(self.db.scalar('SELECT count(*) FROM completion_memory'),1)
        restarted=m.Readiness(self.db,state=self.state,probe=self.probe)
        item=next(i for i in restarted.packet()['items'] if i['id']=='n8n');self.assertTrue(item['reported_complete']);self.assertFalse(item['verified'])
        reopened=restarted.report('n8n',m.ReportBody(completed=False));self.assertEqual(reopened['task_id'],first['task_id']);self.assertEqual(len(restarted.tracker.get(first['task_id'])['history']),2)
    def test_completion_requires_report_and_known_task(self):
        with self.assertRaises(HTTPException):self.flow.report('n8n',m.ReportBody(completed=True,outcome=' '))
        with self.assertRaises(HTTPException):self.flow.report('memsearch',m.ReportBody(completed=True,outcome='done'))
        with self.assertRaises(HTTPException):self.flow.report('../../anything',m.ReportBody(completed=False))
    def test_pc2_reachability_is_not_worker_readiness(self):
        item=self.item('pc2');self.assertTrue(item['endpoint_reachable']);self.assertFalse(item['verified'])
        self.receipt('pc2',worker_authenticated=True,bounded_task_verified=True)
        self.assertTrue(self.item('pc2')['verified'])
        self.flow.probe=lambda:{'pc2':False,'checked_at':'fixture'};self.flow.connection_snapshot(True)
        self.assertFalse(self.item('pc2')['verified'])
    def test_bad_receipt_is_unverified_and_no_arbitrary_fields_are_exposed(self):
        (self.state/m.RECEIPTS['phone']).write_text('{malformed')
        self.assertFalse(self.item('phone')['verified'])
        self.receipt('phone',verified=True,token='private-token',allowed_host='private.example')
        text=json.dumps(self.flow.packet());self.assertNotIn('private-token',text);self.assertNotIn('private.example',text)
    def test_review_running_and_youtube_draft_are_not_completed_execution(self):
        self.receipt('coderabbit',status='review_running',pr_verified=True)
        self.assertFalse(self.item('coderabbit')['verified']);self.assertIn('review is running',self.item('coderabbit')['evidence'])
        with self.db.connect() as c:
            c.execute('CREATE TABLE youtube_sources(id TEXT,status TEXT,compile_status TEXT,updated_at TEXT)')
            c.execute("INSERT INTO youtube_sources VALUES('fixture','ready','ready','2026-09-09T12:00:00Z')")
        self.assertFalse(self.item('youtube')['verified']);self.assertIn('Latest compilation: ready',self.item('youtube')['evidence'])
        with self.db.connect() as c:c.execute("UPDATE youtube_sources SET compile_status='draft_ready'")
        self.assertIn('cited draft is saved',self.item('youtube')['evidence']);self.assertFalse(self.item('youtube')['verified'])
        for status in ('blocked','cancelled'):
            with self.db.connect() as c:c.execute('UPDATE youtube_sources SET compile_status=?',(status,))
            self.assertIn('Latest compilation: '+status,self.item('youtube')['evidence'])
    def test_local_service_does_not_imply_all_features_or_models_ready(self):
        self.flow.probe=lambda:{'nexen':True,'ollama':True,'checked_at':'2026-09-09T00:00:00Z'}
        self.flow.connection_snapshot(True)
        self.assertEqual(self.item('nexen')['status'],'service_reachable');self.assertFalse(self.item('nexen')['verified'])
        self.assertFalse(self.item('ollama')['verified'])
        self.receipt('ollama',text_test={'passed':True},manifest_dependencies_verified=True)
        self.assertTrue(self.item('ollama')['verified']);self.assertIn('Other models',self.item('ollama')['evidence'])
        self.receipt('ollama',text_test='bad shape',manifest_dependencies_verified=True)
        self.assertFalse(self.item('ollama')['verified'])
    def test_youtube_action_targets_registered_memory_workspace(self):
        self.assertEqual(self.item('youtube')['url'],'/youtube-memory')
        source=(m.BASE/'nexen_hub.py').read_text(encoding='utf-8')
        self.assertIn("@app.get('/youtube-memory'",source)
    def test_live_probe_never_returns_private_peer_identity(self):
        conf=self.root/'private.json';conf.write_text(json.dumps({'hostname':'private-fixture'}))
        payload={'Peer':{'peer-key':{'HostName':'private-fixture','Online':True,'TailscaleIPs':['192.0.2.8']}}}
        class Result:returncode=0;stdout=json.dumps(payload).encode()
        with patch.object(m.socket,'create_connection',side_effect=OSError),patch.object(m.subprocess,'run',return_value=Result()),patch.object(m.Path,'is_file',return_value=True):
            result=m.live_connections(conf)
        self.assertTrue(result['pc2']);self.assertNotIn('private-fixture',json.dumps(result));self.assertNotIn('192.0.2.8',json.dumps(result))
    def test_routes_require_session_and_same_origin_mutation(self):
        app=FastAPI();store=app_auth.AuthStore(self.root/'auth')
        with patch.object(app_auth,'AuthStore',lambda:store):gate=app_auth.register(app)
        @app.middleware('http')
        async def auth(request,call_next):
            result=gate(request);return result if result is not None else await call_next(request)
        with patch.object(m,'Readiness',return_value=self.flow):m.register(app,self.db)
        client=TestClient(app,base_url='http://127.0.0.1:8788',client=('127.0.0.1',54444))
        self.assertEqual(client.get('/api/readiness').status_code,401)
        client.cookies.set(app_auth.COOKIE,store.setup('fixture-only-password-123456'))
        self.assertEqual(client.get('/readiness').status_code,200)
        self.assertEqual(client.get('/api/readiness').status_code,200)
        body={'completed':True,'outcome':'Finished the fixture setup step.'}
        self.assertEqual(client.post('/api/readiness/n8n/report',json=body).status_code,403)
        headers={'Origin':'http://127.0.0.1:8788','X-Nexen-Action':'launch'}
        self.assertEqual(client.post('/api/readiness/n8n/report',json=body,headers=headers).status_code,200)
        self.assertEqual(client.post('/api/readiness/refresh',json={},headers=headers).status_code,200)
        self.assertEqual(client.post('/api/readiness/n8n/report',json=body,headers={**headers,'Origin':'https://untrusted.invalid'}).status_code,403)

if __name__=='__main__':unittest.main()
