"""Class-only fixtures: importing this test does not construct the real app."""
import ast
import asyncio
from contextlib import contextmanager
from datetime import datetime
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import threading
import subprocess
import shutil
import types
import unittest
from unittest.mock import Mock, patch

import httpx
from test_support import fixture_root


source = Path(__file__).with_name('nexen.py')
tree = ast.parse(source.read_text(encoding='utf-8-sig'))
classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name in {'ModelRouter','MemoryContextError','Supervisor','Ingestor','Jarvis','ToolFabric'}]
module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *classes], type_ignores=[])
namespace = dict(asyncio=asyncio, httpx=httpx, json=json, logging=logging, os=os, re=re, threading=threading, subprocess=subprocess, shutil=shutil, Path=Path,
                 datetime=datetime, utcnow=lambda:datetime.now().isoformat())
exec(compile(ast.fix_missing_locations(module), str(source), 'exec'), namespace)
ModelRouter, MemoryContextError, Supervisor, Ingestor = (namespace[name] for name in ('ModelRouter','MemoryContextError','Supervisor','Ingestor'))
Jarvis = namespace['Jarvis']
ToolFabric = namespace['ToolFabric']


class JarvisFallbackTests(unittest.TestCase):
    def test_memory_failure_preserves_factual_report_without_any_provider_request(self):
        with tempfile.TemporaryDirectory(dir=fixture_root()) as temporary:
            path = Path(temporary)
            @contextmanager
            def connect():
                connection = sqlite3.connect(path/'fixture.sqlite')
                try:yield connection;connection.commit()
                finally:connection.close()
            with connect() as connection:
                connection.execute('CREATE TABLE jarvis_reports(report_date TEXT,body TEXT,created_at TEXT)')
            events = []
            db = types.SimpleNamespace(connect=connect, rows=lambda *a:[], scalar=lambda *a:3,
                                       event=lambda *args, **kwargs:events.append((args,kwargs)))
            cfg = {'paths':{'jarvis_reports':str(path/'reports')}, 'models':{'local_first':True}}
            router = ModelRouter(cfg, event=db.event)
            jarvis = Jarvis(db,cfg,router)
            def fail(*args):raise OSError('private source path')
            with patch.dict(sys.modules, {'memory_runtime':types.SimpleNamespace(enrich_prompt=fail)}), \
                 patch.object(router,'ollama',side_effect=AssertionError('No local submission')), \
                 patch.object(router,'openai',side_effect=AssertionError('No cloud submission')), \
                 patch.object(router,'anthropic',side_effect=AssertionError('No cloud submission')):
                report = jarvis.build()
            self.assertIn('files_indexed: 3',report)
            self.assertIn('Financial telemetry: not connected yet.',report)
            self.assertNotIn('private',report)
            self.assertIn('model_context_failure',[event[0][0] for event in events])
            self.assertIn('jarvis_report',[event[0][0] for event in events])
            with connect() as connection:
                self.assertEqual(connection.execute('SELECT body FROM jarvis_reports').fetchone()[0],report)
            self.assertEqual(next((path/'reports').glob('*.txt')).read_text(encoding='utf-8'),report)

    def test_empty_model_result_still_uses_existing_telemetry_fallback(self):
        worker = Jarvis.__new__(Jarvis)
        worker.snapshot = lambda:{'files_indexed':7}
        worker.router = types.SimpleNamespace(text=lambda prompt:None)
        class Connection:
            def execute(self,*args):pass
        @contextmanager
        def connect():yield Connection()
        worker.db = types.SimpleNamespace(rows=lambda *a:[],connect=connect,event=Mock())
        with tempfile.TemporaryDirectory(dir=fixture_root()) as temporary:
            worker.out = Path(temporary)
            report = worker.build()
        self.assertIn('files_indexed: 7',report)
        self.assertIn('Financial telemetry: not connected yet.',report)


class ModelRouterTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.cfg = {'models':{'local_first':True,'ollama':{'enabled':True,'base_url':'http://127.0.0.1:11434','model':'fixture'},
                    'openai':{'enabled':True,'model_fast':'fixture','model_hard':'fixture'},'anthropic':{'enabled':True,'model':'fixture'}}}
        self.router = ModelRouter(self.cfg, event=lambda *args, **kwargs:self.events.append((args,kwargs)))

    def test_failure_falls_back_and_records_only_sanitized_provider_metadata(self):
        error = httpx.HTTPStatusError('secret prompt, token=secret and private URL', request=httpx.Request('POST','https://example.invalid/?token=secret'), response=httpx.Response(503))
        client = types.SimpleNamespace(responses=types.SimpleNamespace(create=lambda **kw:types.SimpleNamespace(output_text='Fallback draft')))
        memory = types.SimpleNamespace(enrich_prompt=lambda text,kind:text)
        with patch.object(httpx, 'post', side_effect=error), patch.dict(sys.modules, {'memory_runtime':memory,'openai':types.SimpleNamespace(OpenAI=lambda **kwargs:client)}), patch.dict(os.environ, {'OPENAI_API_KEY':'fixture-key'}):
            self.assertEqual(self.router.text('secret request'), 'Fallback draft')
        self.assertEqual(len(self.events), 1)
        args, kwargs = self.events[0]
        self.assertEqual(args[2], 'WARNING')
        self.assertEqual(kwargs['data'], {'provider':'ollama','error_class':'HTTPStatusError','http_status':503})
        serialized = json.dumps(self.events)
        for secret in ('secret','example.invalid','fixture-key'): self.assertNotIn(secret, serialized)

    def test_disabled_and_missing_auth_are_not_failed_requests(self):
        self.cfg['models']['ollama']['enabled'] = False
        with patch.dict(os.environ, {}, clear=True), patch.object(httpx,'post',side_effect=AssertionError('No request')):
            self.assertIsNone(self.router.ollama('unused'))
            self.assertIsNone(self.router.openai('unused'))
            self.assertIsNone(self.router.anthropic('unused'))
        self.assertEqual(self.events, [])

    def test_each_cloud_failure_is_recorded_without_breaking_none_fallback(self):
        def fail(**kwargs): raise RuntimeError('credential and prompt must remain private')
        modules = {'openai':types.SimpleNamespace(OpenAI=fail), 'anthropic':types.SimpleNamespace(Anthropic=fail)}
        with patch.dict(sys.modules, modules), patch.dict(os.environ, {'OPENAI_API_KEY':'fixture','ANTHROPIC_API_KEY':'fixture'}):
            self.assertIsNone(self.router.openai('unused'))
            self.assertIsNone(self.router.anthropic('unused'))
        self.assertEqual([row[1]['data']['provider'] for row in self.events], ['openai','anthropic'])
        self.assertNotIn('credential', json.dumps(self.events))

    def test_memory_failure_is_distinct_and_stops_before_any_provider(self):
        def fail(*args): raise ValueError('private source text')
        with patch.dict(sys.modules, {'memory_runtime':types.SimpleNamespace(enrich_prompt=fail)}), patch.object(httpx,'post',side_effect=AssertionError('No model request')):
            with self.assertRaises(MemoryContextError) as error: self.router.text('private question')
        self.assertNotIn('private', str(error.exception))
        self.assertEqual(self.events[0][0][0], 'model_context_failure')

    def test_shutdown_stops_provider_fallback_after_inflight_request_returns(self):
        stop=threading.Event();router=ModelRouter(self.cfg,stop_requested=stop.is_set)
        def first(*args,**kwargs):
            stop.set()
            raise httpx.ReadTimeout('Fixture timeout')
        memory=types.SimpleNamespace(enrich_prompt=lambda text,kind:text)
        cloud=Mock(side_effect=AssertionError('No cloud call after stop'))
        with patch('supervisor_provider.run_request',side_effect=first) as request,patch.dict(sys.modules,{'memory_runtime':memory,'openai':types.SimpleNamespace(OpenAI=cloud),'anthropic':types.SimpleNamespace(Anthropic=cloud)}),patch.dict(os.environ,{'OPENAI_API_KEY':'fixture','ANTHROPIC_API_KEY':'fixture'}):
            self.assertIsNone(router.text('fixture'))
        request.assert_called_once()
        cloud.assert_not_called()

    def test_cloud_clients_have_explicit_timeout_and_no_retry_amplification(self):
        calls=[]
        def client(**kwargs):
            calls.append(kwargs)
            return types.SimpleNamespace(responses=types.SimpleNamespace(create=lambda **kw:types.SimpleNamespace(output_text='fixture')),
                                         messages=types.SimpleNamespace(create=lambda **kw:types.SimpleNamespace(content=[])))
        with patch.dict(sys.modules,{'openai':types.SimpleNamespace(OpenAI=client),'anthropic':types.SimpleNamespace(Anthropic=client)}),patch.dict(os.environ,{'OPENAI_API_KEY':'fixture','ANTHROPIC_API_KEY':'fixture'}):
            self.router.openai('fixture');self.router.anthropic('fixture')
        self.assertEqual(len(calls),2)
        for arguments in calls:
            self.assertEqual(arguments['max_retries'],0)
            self.assertEqual(arguments['timeout'].read,ModelRouter.REQUEST_TIMEOUT_SECONDS)
            self.assertEqual(arguments['timeout'].connect,ModelRouter.CONNECTION_TIMEOUT_SECONDS)
        self.assertEqual(self.router.request_timeout(99999).read,ModelRouter.REQUEST_TIMEOUT_SECONDS)

    def test_tool_probe_stops_before_another_version_attempt(self):
        stop=threading.Event();fabric=ToolFabric(None,{},stop_requested=stop.is_set)
        def probe(*args,**kwargs):
            stop.set()
            raise subprocess.TimeoutExpired('fixture',6)
        with patch.object(subprocess,'run',side_effect=probe) as run:
            self.assertEqual(fabric.probe('fixed-fixture.exe'),(None,'interrupted'))
        run.assert_called_once()


class SupervisorLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_idle_supervisor_stops_immediately_and_does_not_duplicate(self):
        worker = Supervisor.__new__(Supervisor)
        worker._stop_event = threading.Event()
        worker._thread = None
        worker.cfg = {'supervisor':{'loop_seconds':3600}}
        worker.db = types.SimpleNamespace(event=Mock())
        entered = threading.Event()
        worker.tick = lambda: entered.set()
        worker.recover_interrupted = Mock()
        worker.start()
        self.assertTrue(await asyncio.to_thread(entered.wait, 2))
        with self.assertRaises(RuntimeError): worker.start()
        await asyncio.wait_for(worker.shutdown(), 2)
        self.assertIsNone(worker._thread)
        worker.recover_interrupted.assert_called_once()
        self.assertTrue(worker._stop_event.is_set())

    async def test_scan_cooperatively_stops_before_reading_next_file(self):
        with tempfile.TemporaryDirectory(dir=fixture_root()) as temporary:
            Path(temporary,'fixture.txt').write_text('fixture', encoding='utf-8')
            db = types.SimpleNamespace(event=Mock())
            scanner = Ingestor(db, {'ingestion':{'extensions':['.txt'],'exclude_dir_names':[],'roots':[temporary]}})
            scanner.index_file = Mock(side_effect=AssertionError('No file should be indexed after stop'))
            scanner.scan(stop_requested=lambda:True)
            scanner.index_file.assert_not_called()
            self.assertEqual(db.event.call_args.args[0], 'scan_interrupted')


if __name__ == '__main__': unittest.main()
