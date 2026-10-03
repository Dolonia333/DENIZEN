"""Classifications describe evidence and never grant execution permission."""
from contextlib import contextmanager
from pathlib import Path
import json
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from action_requirements import Requirements
from execution_labels import requirement_class, readiness_class
from v1_readiness import Readiness, RECEIPTS
import v1_readiness


class DB:
    def __init__(self, path):
        self.path=path
        self.memory_vault=path.parent/'vault'
    @contextmanager
    def connect(self):
        c=sqlite3.connect(self.path)
        c.row_factory=sqlite3.Row
        try:
            with c:yield c
        finally:c.close()
    def rows(self,sql,args=()):
        with self.connect() as c:return [dict(row) for row in c.execute(sql,args)]
    def scalar(self,sql,args=()):
        with self.connect() as c:
            row=c.execute(sql,args).fetchone()
            return row[0] if row else None


class ExecutionLabelTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.db=DB(self.root/'test.sqlite3')
        self.requirements=Requirements(self.db,probe=lambda:{'state':'integration_required'})
        self.readiness=Readiness(self.db,requirements=self.requirements,state=self.root,
            probe=lambda:{'nexen':True,'n8n':True,'ollama':True,'pc2':False},
            adapter_probe=lambda connections:{'ollama':True,'kilo':True})
    def tearDown(self):self.temp.cleanup()
    def item(self,name):return next(row for row in self.readiness.packet()['items'] if row['id']==name)
    def receipt(self,name,**data):(self.root/RECEIPTS[name]).write_text(json.dumps(data),encoding='utf-8')

    def test_login_physical_and_failure_are_distinct_and_flags_unchanged(self):
        items={item['id']:item for item in self.requirements.status()['pending']}
        for name in ('amboras','ads','supercool','n8n','pc2','browser-home'):
            self.assertEqual(items[name]['execution_class'],'HUMAN')
        self.assertEqual(items['phone']['execution_class'],'BLOCKED')
        self.assertTrue(all(not item['verified'] and not item['executable'] for item in items.values()))
        self.assertEqual(requirement_class({'id':'n8n','state':'unavailable'})['execution_class'],'BLOCKED')
        self.assertEqual(requirement_class({'state':[]})['execution_class'],'BLOCKED')

    def test_only_named_available_verified_adapter_is_automatable(self):
        row={'id':'ollama','verified':False,'endpoint_reachable':True}
        self.assertEqual(readiness_class(row,available_adapters={'ollama':True})['execution_class'],'BLOCKED')
        row['verified']=True
        for available in ({},{'ollama':False},{'ollama':'true'}):
            self.assertEqual(readiness_class(row,available_adapters=available)['execution_class'],'BLOCKED')
        self.assertEqual(readiness_class(row,available_adapters={'ollama':True})['execution_class'],'AUTOMATABLE')
        for ident in ('openrouter','omniroute','n8n','phone','pc2'):
            result=readiness_class({'id':ident,'verified':True,'endpoint_reachable':True},available_adapters={ident:True})
            self.assertNotEqual(result['execution_class'],'AUTOMATABLE')

    def test_readiness_joins_scoped_receipt_and_current_adapter(self):
        self.assertEqual(self.item('ollama')['execution_class'],'BLOCKED')
        self.receipt('ollama',text_test={'passed':True},manifest_dependencies_verified=True)
        self.assertEqual(self.item('ollama')['execution_class'],'AUTOMATABLE')
        self.receipt('kilo',verified=True,live_draft_verified=True)
        self.assertEqual(self.item('kilo')['execution_class'],'AUTOMATABLE')
        self.readiness.adapter_probe=lambda connections:{'ollama':False,'kilo':False}
        self.assertEqual(self.item('ollama')['execution_class'],'BLOCKED')
        self.assertEqual(self.item('kilo')['execution_class'],'BLOCKED')
        self.assertTrue(all(not row['execution_unlocked'] for row in self.readiness.packet()['items']))

    def test_local_health_workflow_proof_is_retained_without_verifying_business_execution(self):
        self.receipt('n8n',workflow_id='nexenLocalHealthV1',health_workflow_verified=True,
                     workflow_imported=True,workflow_published=True,run_verified=True,local_only=True,
                     schedule_loaded=True,scheduled_run_verified=False,auth_verified=False)
        item=self.item('n8n')
        self.assertTrue(item['local_health_workflow']['verified'])
        self.assertTrue(item['local_health_workflow']['schedule_loaded'])
        self.assertFalse(item['local_health_workflow']['scheduled_run_verified'])
        self.assertIn('manual run passed',item['evidence'])
        self.assertIn('Business workflow execution remains unverified',item['evidence'])
        self.assertFalse(item['verified'])
        self.assertEqual(item['execution_class'],'HUMAN')

    def test_homepage_task_is_persistent_human_and_does_not_modify_browser(self):
        ident=self.readiness.tasks['browser-home']
        before=self.db.scalar('SELECT count(*) FROM hub_requests')
        other=Readiness(self.db,state=self.root,probe=lambda:{},adapter_probe=lambda connections:{})
        self.assertEqual(other.tasks['browser-home'],ident)
        self.assertEqual(self.db.scalar('SELECT count(*) FROM hub_requests'),before)
        item=self.item('browser-home')
        self.assertEqual(item['execution_class'],'HUMAN')
        self.assertIn('Settings > On startup',item['next_step'])
        self.assertEqual(item['url'],'http://127.0.0.1:8788/')

    def test_failed_live_availability_probe_fails_closed(self):
        self.receipt('ollama',text_test={'passed':True},manifest_dependencies_verified=True)
        with patch.object(self.readiness,'adapter_probe',side_effect=OSError('fixture unavailable')):
            self.assertEqual(self.item('ollama')['execution_class'],'BLOCKED')

    def test_current_model_inventory_is_required_without_model_execution(self):
        class Response:
            def __init__(self,payload):self.payload=payload
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return json.dumps(self.payload).encode('utf-8')
        calls=[]
        for names,expected in (([],False),(['qwen3.5:2b-q4_K_M','dolphin3:latest'],True)):
            def open_fixture(url,timeout):
                calls.append(url)
                return Response({'models':[{'name':name} for name in names]})
            with patch.object(v1_readiness.urllib.request,'build_opener',return_value=SimpleNamespace(open=open_fixture)), \
                 patch('kilo_bridge.BINARY',SimpleNamespace(is_file=lambda:True)), \
                 patch('kilo_bridge.read_json',return_value={}), patch('kilo_bridge.valid_config',return_value=True):
                self.assertEqual(v1_readiness.local_adapter_availability({'ollama':True}),
                                 {'ollama':expected,'kilo':expected})
        self.assertEqual(calls,['http://127.0.0.1:11434/api/tags']*2)


if __name__=='__main__':unittest.main()
