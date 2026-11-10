import asyncio
from contextlib import contextmanager
from html.parser import HTMLParser
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
import httpx
from pydantic import ValidationError

from agents_console import AgentsConsole, HandoffBody, TARGETS, CURRENT_CORRECTION, profile_context, register


class DB:
    def __init__(self,path):self.path=path
    @contextmanager
    def connect(self):
        c=sqlite3.connect(self.path);c.row_factory=sqlite3.Row
        try:
            with c:yield c
        finally:c.close()
    def rows(self,sql,params=()):
        with self.connect() as c:return [dict(r) for r in c.execute(sql,params)]
    def scalar(self,sql,params=()):
        with self.connect() as c:return c.execute(sql,params).fetchone()[0]


class AgentConsoleTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.db=DB(self.root/'tasks.sqlite3');self.context_calls=[]
        self.console=self.make_console()
    def tearDown(self):self.temp.cleanup()
    def context(self,query,task_type,pool):
        self.context_calls.append((query,task_type,pool))
        return {'egress_policy':'local_only','status':'ready','text':'Archived evidence: superseded desktop setup proposal. password=fictional-secret',
                'citations':[{'source_id':'chunk-17','title':'Old plan','kind':'knowledge','ts':'2026-08-01'}]}
    def profile(self,project):
        return {'documents':[{'source':'context/user.md','sha256':'a'*64,'text':'Current profile for '+project}],'warnings':[]}
    def make_console(self,**kwargs):
        return AgentsConsole(self.db,root=self.root/'packets',context_loader=kwargs.pop('context_loader',self.context),
                             profile_loader=kwargs.pop('profile_loader',self.profile),readiness_loader=kwargs.pop('readiness_loader',lambda:{'providers':[]}),**kwargs)
    def body(self,**values):return {'prompt':'Implement a Windows Kilo workflow','target':'kilo','project':'nexen','task_type':'workflow',**values}

    def test_shared_task_and_packet_persist_without_dispatch(self):
        one=self.console.prepare(self.body());two=self.console.prepare(self.body())
        self.assertEqual(one['id'],two['id']);self.assertEqual(one['task_id'],two['task_id'])
        self.assertEqual(self.db.scalar('SELECT count(*) FROM hub_requests'),1)
        self.assertEqual(self.db.scalar('SELECT count(*) FROM agent_handoffs'),1)
        self.assertEqual(self.make_console().get(one['id'])['prompt'],one['prompt'])
        self.assertEqual(one['target_url'],'/kilo?task_id='+str(one['task_id']))
        self.assertFalse(one['executed']);self.assertEqual(one['model_calls'],0);self.assertEqual(one['cloud_submissions'],0)
        self.assertEqual(self.context_calls[0][2],'engineering')
        self.assertTrue((self.root/'packets'/(one['id']+'.json')).is_file())

    def test_current_windows_correction_precedes_archived_context(self):
        packet=self.console.prepare(self.body())
        self.assertLess(packet['prompt'].index(CURRENT_CORRECTION),packet['prompt'].index('Archived evidence'))
        self.assertNotIn('fictional-secret',packet['prompt'])
        self.assertEqual(packet['context']['citations'][0]['source_id'],'chunk-17')
        self.assertEqual(packet['profile'][0]['sha256'],'a'*64)

    def test_every_role_uses_same_task_and_stays_planned(self):
        packet=self.console.prepare(self.body())
        plan=packet['team_plan']
        self.assertEqual([x['role'] for x in plan['roles']],['planner','researcher','coder','reviewer'])
        self.assertTrue(all(x['task_id']==packet['task_id'] and x['status']=='planned' and not x['dispatched'] for x in plan['roles']))
        self.assertFalse(plan['dispatcher_connected'])
        self.assertEqual(plan['limits'],{'max_depth':1,'max_concurrent':2,'max_gpu_jobs':1})
        self.assertEqual(packet['budget']['openrouter_proposed_lifetime_cents'],1000)
        self.assertFalse(packet['budget']['automatic_paid_requests'])

    def test_existing_task_is_not_marked_done_or_duplicated(self):
        first=self.console.prepare(self.body())
        with self.db.connect() as c:c.execute("UPDATE hub_requests SET status='blocked' WHERE id=?",(first['task_id'],))
        second=self.console.prepare(self.body(prompt='Review the existing task',task_id=first['task_id'],target='claude'))
        self.assertEqual(second['task']['status'],'blocked')
        self.assertEqual(self.db.scalar('SELECT count(*) FROM hub_requests'),1)
        with self.assertRaises(HTTPException):self.console.prepare(self.body(task_id=99999))

    def test_unknown_target_fields_and_paths_are_rejected(self):
        for data in [self.body(target='shell'),self.body(target_url='https://evil.test'),self.body(task_id=True),self.body(prompt='  ')]:
            with self.assertRaises(ValidationError):HandoffBody.model_validate(data)
        for ident in ['../secrets','x'*64,'1','/etc/passwd']:
            with self.assertRaises(HTTPException):self.console.get(ident)
        console=self.make_console(readiness_loader=lambda:{'providers':[{'id':'claude','url':'https://evil.test','authentication_verified':True,'cloud_execution_enabled':True}]})
        row=next(x for x in console.status()['providers'] if x['id']=='claude')
        self.assertEqual(row['url'],TARGETS['claude']['url']);self.assertFalse(row['authentication_verified']);self.assertFalse(row['cloud_execution_enabled'])

    def test_memory_unavailable_is_explicit_not_fabricated(self):
        def fail(*args):raise OSError('fixture unavailable')
        packet=self.make_console(context_loader=fail).prepare(self.body())
        self.assertEqual(packet['context']['status'],'unavailable')
        self.assertFalse(packet['context']['citations'])
        self.assertTrue(packet['warnings'])

    def test_large_profile_is_bounded_before_read_and_artifact_integrity_checked(self):
        profile_root=self.root/'profile';(profile_root/'context').mkdir(parents=True)
        (profile_root/'context/user.md').write_text('x'*70000)
        profile=profile_context('nexen',profile_root)
        self.assertFalse(profile['documents']);self.assertTrue(profile['warnings'])
        packet=self.console.prepare(self.body())
        with self.db.connect() as c:c.execute("UPDATE agent_handoffs SET packet_json='{}' WHERE id=?",(packet['id'],))
        with self.assertRaises(HTTPException):self.console.get(packet['id'])

    def test_api_requires_origin_for_preparation(self):
        app=FastAPI()
        with patch('agents_console.AgentsConsole',return_value=self.console):register(app,self.db)
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://127.0.0.1:8788') as client:
                self.assertEqual((await client.get('/agents')).status_code,200)
                self.assertEqual((await client.post('/api/agents/handoffs',json=self.body())).status_code,403)
                result=await client.post('/api/agents/handoffs',json=self.body(),headers={'Origin':'http://127.0.0.1:8788','X-Nexen-Action':'launch'})
                self.assertEqual(result.status_code,200)
                self.assertEqual((await client.get('/api/agents/handoffs/'+result.json()['id'])).status_code,200)
                self.assertEqual((await client.post('/api/agents/run',json={})).status_code,404)
                self.assertEqual((await client.get('/api/agents/status',headers={'Host':'evil.test'})).status_code,403)
        asyncio.run(run())

    def test_target_markup_exposes_each_supported_provider_once(self):
        class TargetOptions(HTMLParser):
            def __init__(self):
                super().__init__()
                self.inside=False
                self.current=None
                self.options=[]
            def handle_starttag(self,tag,attrs):
                values=dict(attrs)
                if tag=='select' and values.get('id')=='target':self.inside=True
                if tag=='option' and self.inside:
                    self.current={'value':values.get('value'),'label':''}
                    self.options.append(self.current)
            def handle_data(self,data):
                if self.current is not None:self.current['label']+=data
            def handle_endtag(self,tag):
                if tag=='option':self.current=None
                if tag=='select':self.inside=False
        parser=TargetOptions()
        parser.feed((Path(__file__).parent/'agents-console.html').read_text(encoding='utf-8'))
        values=[item['value'] for item in parser.options]
        self.assertEqual(set(values),set(TARGETS))
        self.assertEqual(len(values),len(set(values)))
        self.assertEqual(parser.options[0],{'value':'kilo','label':'Kilo Code'})
        self.assertEqual(next(item for item in parser.options if item['value']=='codex')['label'],'Codex')


if __name__=='__main__':unittest.main()
