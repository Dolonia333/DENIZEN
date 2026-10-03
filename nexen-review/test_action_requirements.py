"""Isolated local fixtures; no provider calls, logins or execution."""
import asyncio
from contextlib import contextmanager
import io
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.request
import urllib.response
from email.message import Message

import httpx
from fastapi import FastAPI, HTTPException
import action_requirements as ar


class DB:
    def __init__(self, path): self.path = path

    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path)
        try:
            with c:
                yield c
        finally:
            c.close()


class RequirementsTests(unittest.TestCase):
    def setUp(self):
        # Fixture files stay on the canonical F: project drive.
        parent = ar.BASE / 'work' / 'tests'
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='requirements-', dir=parent)
        self.db = DB(str(Path(self.temp.name) / 'requirements.sqlite3'))
        self.probe = Mock(return_value={'state': 'setup_required'})
        self.requirements = ar.Requirements(self.db, probe=self.probe)

    def tearDown(self):
        self.temp.cleanup()

    def test_unknown_provider_does_not_enqueue(self):
        with self.assertRaises(HTTPException) as error:
            self.requirements.request_check('unknown-provider')
        self.assertEqual(error.exception.status_code, 404)
        self.probe.assert_not_called()
        with self.db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM action_check_requests').fetchone()[0], 0)
        with self.assertRaises(HTTPException) as error:
            self.requirements.require_connection('unknown-provider')
        self.assertEqual(error.exception.status_code, 404)

    def test_requested_check_persists_and_never_verifies(self):
        for _ in range(2):
            result = self.requirements.request_check('amboras')
            self.assertEqual(result['status'], 'check_requested')
            self.assertFalse(result['executed'])
        fresh = ar.Requirements(self.db, probe=self.probe)
        row = next(x for x in fresh.status()['pending'] if x['id'] == 'amboras')
        self.assertEqual(row['check_request']['status'], 'requested')
        self.assertFalse(row['verified'])
        self.assertFalse(row['executable'])
        with self.db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM action_check_requests').fetchone()[0], 1)

    def test_owner_setup_is_separate_from_integration(self):
        for state in ('setup_required', 'integration_required', 'unavailable', 'unverified'):
            r = ar.Requirements(self.db, probe=lambda: dict(state=state))
            item = next(x for x in r.status()['pending'] if x['id'] == 'n8n')
            self.assertEqual(item['state'], state)
            self.assertFalse(item['verified'])
            self.assertFalse(item['executable'])
            with self.assertRaises(HTTPException) as error:
                r.require_connection('n8n')
            self.assertEqual(error.exception.status_code, 409)
            self.assertFalse(error.exception.detail['executed'])

    def test_observation_cannot_unlock_execution(self):
        r = ar.Requirements(self.db, probe=lambda: dict(state='integration_required', verified=True, executable=True))
        self.assertTrue(all(not x['verified'] and not x['executable'] for x in r.status()['pending']))
        for item in ar.CATALOG:
            with self.assertRaises(HTTPException) as error:
                r.require_connection(item['id'])
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(error.exception.detail['code'], 'connection_required')

    def test_cached_probe_and_explicit_refresh(self):
        with patch.object(ar.time, 'monotonic', return_value=100):
            self.requirements.status()
            self.requirements.status()
            self.assertEqual(self.probe.call_count, 1)
            self.requirements.request_check('n8n')
            self.requirements.status()
            self.assertEqual(self.probe.call_count, 2)

    def test_probe_only_interprets_exact_onboarding_boolean(self):
        for value, expected in ((True, 'setup_required'), (False, 'integration_required'), (1, 'unverified'), (None, 'unverified')):
            data = {'data': {'userManagement': {'showSetupOnFirstLoad': value}, 'credential': 'fixture-secret-never-return'}}
            open_mock = Mock(return_value=io.BytesIO(json.dumps(data).encode()))
            with patch.object(ar.urllib.request, 'build_opener', return_value=SimpleNamespace(open=open_mock)):
                result = ar.n8n_probe()
            open_mock.assert_called_once_with('http://127.0.0.1:5678/rest/settings', timeout=2)
            self.assertEqual(result['state'], expected)
            self.assertNotIn('fixture-secret', json.dumps(result))

    def test_probe_failure_does_not_assume_ready(self):
        for body in (b'not-json', b'[]', b'{"data":null}'):
            with patch.object(ar.urllib.request, 'build_opener', return_value=SimpleNamespace(open=Mock(return_value=io.BytesIO(body)))):
                self.assertEqual(ar.n8n_probe()['state'], 'unavailable')
        with patch.object(ar.urllib.request, 'build_opener', return_value=SimpleNamespace(open=Mock(side_effect=OSError('fixture offline')))):
            self.assertEqual(ar.n8n_probe()['state'], 'unavailable')

    def test_n8n_probe_refuses_redirect_without_second_request(self):
        seen = []
        class FixtureHTTP(urllib.request.HTTPHandler):
            def http_open(self, request):
                seen.append(request.full_url)
                headers = Message()
                headers['Location'] = 'http://outside.example.test/settings'
                response = urllib.response.addinfourl(io.BytesIO(b''), headers, request.full_url, code=302)
                response.msg = 'Found'
                return response
        build = urllib.request.build_opener
        with patch.object(ar.urllib.request, 'build_opener', side_effect=lambda *handlers: build(*handlers, FixtureHTTP())):
            result = ar.n8n_probe()
        self.assertEqual(result['state'], 'unavailable')
        self.assertEqual(seen, ['http://127.0.0.1:5678/rest/settings'])

    def test_route_mutation_guard_and_409(self):
        async def exercise():
            app = FastAPI()
            with patch.object(ar, 'Requirements', return_value=self.requirements):
                ar.register(app, self.db)
            transport = httpx.ASGITransport(app=app, client=('127.0.0.1', 51000))
            async with httpx.AsyncClient(transport=transport, base_url='http://127.0.0.1:8788') as client:
                headers = {'Origin': 'http://127.0.0.1:8788', 'X-Nexen-Action': 'launch'}
                denied = await client.post('/api/action-required/n8n/check')
                self.assertEqual(denied.status_code, 403)
                cross = await client.post('/api/action-required/n8n/check', headers=dict(headers, Origin='https://example.test'))
                self.assertEqual(cross.status_code, 403)
                result = await client.post('/api/action-required/n8n/check', headers=headers)
                self.assertEqual(result.status_code, 200)
                self.assertFalse(result.json()['executed'])
                unknown = await client.post('/api/action-required/unknown/check', headers=headers)
                self.assertEqual(unknown.status_code, 404)
                blocked = await client.post('/api/action-required/n8n/run', headers=headers)
                self.assertEqual(blocked.status_code, 409)
                self.assertFalse(blocked.json()['detail']['executed'])
                status = await client.get('/api/action-required')
                self.assertTrue(all(not x['verified'] for x in status.json()['pending']))
        asyncio.run(exercise())


if __name__ == '__main__': unittest.main()
