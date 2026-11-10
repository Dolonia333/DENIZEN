import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
import app_auth
import memory_runtime
import plan_compiler as module

ROOT = Path(os.environ.get('NEXEN_TEST_PLAN_ROOT', Path(__file__).resolve().parent / 'work' / 'plan-source-tests')).resolve()
ROOT.mkdir(parents=True, exist_ok=True)

def packet(ident,**extra):
    return {'id':ident,'title':'Fixture '+ident,'prompt':'Reference fixture','status':'prepared','executed':False,'task_ids':[],'citations':[],**extra}

class DB:
    def rows(self,*args):return [{'id':1,'text':'WDR game fixture','status':'planned','created_at':'2026-09-09'}]

class PlanSourcesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='case-', dir=ROOT)
        self.base = Path(self.temporary.name).resolve()
        self.assertTrue(self.base.is_relative_to(ROOT.resolve()))
        self.addCleanup(self.temporary.cleanup)
        self.modules=self.base/'modules';self.sources=self.base/'sources';self.modules.mkdir();self.sources.mkdir()
        self.report=self.base/'report.md';self.report.write_text('Source report <script>do not execute</script>',encoding='utf-8')
    def save(self,folder,ident,**extra):
        p=folder/(ident+'.json');p.write_text(json.dumps(packet(ident,**extra)),encoding='utf-8');return p
    def test_module_history_cannot_hide_nineteen_source_packets(self):
        for i in range(43):self.save(self.modules,'game-'+str(i))
        for i in range(19):self.save(self.sources,'source-'+format(i,'020x'),source={'modified_at':'historical-mtime','timestamp_basis':'file mtime, not message date'})
        (self.sources/'prompt-catalog.json').write_text(json.dumps({'prompts':[1]}),encoding='utf-8')
        result=module.list_prepared_packages(self.modules,self.sources)
        self.assertEqual(result['counts'],{'module':40,'source':19})
        self.assertEqual(len(result['packages']),59)
        self.assertTrue(all(p['status']=='prepared' and p['executed'] is False for p in result['packages']))
        self.assertTrue(all(p['source']['timestamp_basis']=='file mtime, not message date' for p in result['packages'] if p['package_kind']=='source'))
    def test_invalid_oversized_and_nonprepared_sources_are_skipped(self):
        self.save(self.sources,'source-'+format(1,'020x'))
        self.save(self.sources,'source-'+format(2,'020x'),executed=True,status='done')
        (self.sources/('source-'+format(3,'020x')+'.json')).write_text('x'*100000,encoding='utf-8')
        (self.sources/('source-'+format(4,'020x')+'.json')).write_text('{bad json',encoding='utf-8')
        result=module.list_prepared_packages(self.modules,self.sources)
        self.assertEqual(result['counts']['source'],1)
        self.assertEqual(len(result['warnings']),3)
    def test_fixed_artifacts_are_authenticated_and_compile_stays_prepared(self):
        self.save(self.sources,'source-'+format(1,'020x'))
        (self.sources/'prompt-catalog.json').write_text(json.dumps({'prompts':[{'id':'fixture-prompt'}]}),encoding='utf-8')
        app=FastAPI();store=app_auth.AuthStore(self.base/'auth')
        with patch.object(app_auth,'AuthStore',lambda:store):gate=app_auth.register(app)
        @app.middleware('http')
        async def auth(request,call_next):
            response=gate(request)
            return response if response is not None else await call_next(request)
        original=module.PlanCompiler
        with patch.object(module,'PlanCompiler',lambda db,memory:original(db,memory,self.modules)),patch.object(memory_runtime,'context_for',lambda *args:{'text':'Fixture local context','citations':[]}):
            module.register(app,DB())
        client=TestClient(app,base_url='http://127.0.0.1:8788')
        with patch.object(module,'EXACT_ROOT',self.sources),patch.object(module,'EXACT_REPORT',self.report):
            for path in ('/api/plans','/api/plans/exact-catalog','/api/plans/exact-report'):
                self.assertEqual(client.get(path).status_code,401)
            client.cookies.set(app_auth.COOKIE,store.setup('fixture-password-123456'))
            data=client.get('/api/plans').json()
            self.assertEqual(data['counts']['source'],1)
            catalog=client.get('/api/plans/exact-catalog?path=F:/not-the-selected-file')
            self.assertEqual(catalog.json()['prompts'][0]['id'],'fixture-prompt')
            self.assertEqual(catalog.headers['cache-control'],'no-store')
            report=client.get('/api/plans/exact-report')
            self.assertEqual(report.status_code,200)
            self.assertIn('&lt;script&gt;',report.text)
            self.assertNotIn('<script>',report.text)
            invalid=client.post('/api/plans/compile',json={'modules':['not-a-module']})
            self.assertEqual(invalid.status_code,422)
            compiled=client.post('/api/plans/compile',json={'modules':['game']})
            self.assertEqual(compiled.status_code,200)
            self.assertEqual(compiled.json()['status'],'prepared');self.assertFalse(compiled.json()['executed'])
            refreshed=client.get('/api/plans').json()
            self.assertEqual(refreshed['counts'],{'module':1,'source':1})

if __name__=='__main__':unittest.main()
