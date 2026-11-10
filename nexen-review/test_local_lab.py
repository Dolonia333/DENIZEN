import unittest
import sqlite3
import sys
import types
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
import local_lab


class LocalLabContracts(unittest.TestCase):
    def client_for(self, payloads):
        app = FastAPI()
        local_lab.register(app)
        seen = []
        def respond(request):
            seen.append(request.url.path)
            return httpx.Response(200, json=payloads[len(seen)-1])
        transport = httpx.MockTransport(respond)
        original = httpx.AsyncClient
        factory = lambda **kwargs: original(transport=transport, **kwargs)
        return TestClient(app), patch('local_lab.httpx.AsyncClient', side_effect=factory), seen

    def test_malformed_model_containers_report_unavailable(self):
        for payload in ([], None, 'bad', {'models':None}, {'models':'bad'}):
            with self.subTest(payload=payload):
                client, mocked, seen = self.client_for([payload])
                with mocked:
                    response = client.get('/api/lab/models')
                self.assertEqual(response.status_code, 503)
                self.assertEqual(seen, ['/api/tags'])

    def test_mixed_model_entries_skip_invalid_and_preserve_valid(self):
        client, mocked, _ = self.client_for([{'models':[None,'bad',{'name':4},{'name':'local','size':20}]}])
        with mocked:
            response = client.get('/api/lab/models')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['models'], [{'name':'local','size':20}])

    def test_memory_failures_return_controlled_error_before_model_submission(self):
        for error in (ValueError('private source'), OSError('private path'), sqlite3.OperationalError('private database')):
            for stage in ('context_for', 'prompt_with_context'):
                with self.subTest(error=type(error).__name__, stage=stage):
                    client, mocked, seen = self.client_for([{'models':[{'name':'local'}]}])
                    memory = types.SimpleNamespace(context_for=lambda *a:{'text':'fixture'}, prompt_with_context=lambda *a:'fixture')
                    def fail(*args, **kwargs):raise error
                    setattr(memory, stage, fail)
                    with mocked, patch.dict(sys.modules, {'memory_runtime':memory}):
                        response = client.post('/api/lab/chat', json={'model':'local','text':'fixture'})
                    self.assertEqual(response.status_code, 503)
                    self.assertIn('memory context', response.json()['detail'])
                    self.assertNotIn('private', response.text)
                    self.assertEqual(seen, ['/api/tags'])

    def test_malformed_response_objects_return_controlled_model_error(self):
        memory = types.SimpleNamespace(context_for=lambda *a:{'text':'fixture'}, prompt_with_context=lambda *a:'fixture')
        for payload in ([], None, {'message':[]}, {'message':None}):
            with self.subTest(payload=payload):
                client, mocked, seen = self.client_for([{'models':[{'name':'local'}]}, payload])
                with mocked, patch.dict(sys.modules, {'memory_runtime':memory}):
                    response = client.post('/api/lab/chat', json={'model':'local','text':'fixture'})
                self.assertEqual(response.status_code, 502)
                self.assertEqual(seen, ['/api/tags','/api/chat'])


if __name__ == '__main__': unittest.main()
