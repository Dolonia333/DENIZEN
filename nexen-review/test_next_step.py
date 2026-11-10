from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import app_auth
import next_step as module
from task_tracking import TaskCreate, TaskUpdate


class DB:
    def __init__(self, path):
        self.path = path
        self.memory_vault = path.parent/'fixture-vault'

    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path, timeout=15)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()

    def rows(self, sql, params=()):
        with self.connect() as c:
            return [dict(row) for row in c.execute(sql, params)]

    def scalar(self, sql, params=()):
        with self.connect() as c:
            row = c.execute(sql, params).fetchone()
            return row[0] if row else None


class Requirements:
    def __init__(self, ready=False):
        self.ready = ready

    def status(self):
        return {'pending': [{'id': 'supercool', 'state': 'login_required', 'action': 'Sign in and verify.',
                             'evidence': 'Fixture login form observation.',
                             'verified': self.ready, 'executable': self.ready}]}


class NextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='next-step-')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.db = DB(self.folder/'tasks.sqlite')
        self.seeds = self.folder/'seeds.json'
        self.seeds.write_text(json.dumps({'tasks': [{'key': 'rent', 'source': 'User housing request',
              'source_urls': ['https://www.211info.org/contact-us/', 'javascript:bad'],
              'checked_date': '2026-09-09'}]}), encoding='utf-8')
        self.flow = module.NextSteps(self.db, seeds=self.seeds)

    def task(self, key=None, text='Fixture task', **kwargs):
        return self.flow.tracker.create(TaskCreate(text=text, next_step='A concrete fixture step.', **kwargs), seed_key=key)

    def test_housing_first_selection_persists_and_get_is_read_only(self):
        other = self.task('daily', priority='urgent')
        rent = self.task('rent')
        packet = self.flow.packet()
        self.assertEqual(packet['tasks'][0]['id'], rent)
        self.assertEqual(packet['selected_task']['id'], rent)
        self.flow.select(other)
        restarted = module.NextSteps(self.db, seeds=self.seeds)
        self.assertEqual(restarted.packet()['selected_task']['id'], other)
        self.assertEqual(restarted.packet(rent)['selected_task']['id'], rent)
        self.assertEqual(restarted.packet()['selected_task']['id'], other)
        provenance = self.flow.task(rent)['provenance']
        self.assertEqual(provenance['source_urls'], ['https://www.211info.org/contact-us/'])
        self.assertEqual(provenance['checked_date'], '2026-09-09')

    def test_selected_completion_is_persistent_idempotent_and_journaled(self):
        first = self.task('rent')
        other = self.task('daily')
        self.flow.select(first)
        body = module.CompletionBody(source='voice', outcome='I recorded the actual result.')
        result = self.flow.complete(first, body)
        self.assertTrue(result['changed']); self.assertTrue(result['celebrate'])
        self.assertFalse(result['executed'])
        self.assertEqual(self.flow.tracker.get(other)['status'], 'planned')
        self.assertEqual(self.flow.packet()['selected_task']['id'], first)
        self.assertEqual(len(result['task']['history']), 1)
        self.assertIn('User reported via voice', result['task']['history'][0]['outcome'])
        again = module.NextSteps(self.db, seeds=self.seeds).complete(first, body)
        self.assertFalse(again['changed']); self.assertFalse(again['celebrate'])
        self.assertEqual(len(again['task']['history']), 1)
        self.assertEqual(self.db.scalar('SELECT count(*) FROM completion_memory'), 1)
        self.assertTrue(list(self.db.memory_vault.rglob('*.md')))

    def test_reopen_keeps_same_id_and_permits_new_completion(self):
        ident = self.task()
        self.flow.complete(ident, module.CompletionBody())
        self.flow.tracker.update(ident, TaskUpdate(status='planned', outcome='More work was found.'))
        result = self.flow.complete(ident, module.CompletionBody(source='click'))
        self.assertTrue(result['changed']); self.assertEqual(result['task']['id'], ident)
        self.assertEqual(len(result['task']['history']), 3)
        self.assertEqual(self.db.scalar('SELECT count(*) FROM completion_memory'), 3)

    def test_simultaneous_requests_have_one_history_entry_and_one_party(self):
        ident = self.task()
        second = module.NextSteps(self.db, seeds=self.seeds)
        with ThreadPoolExecutor(max_workers=6) as pool:
            responses = list(pool.map(lambda index: (self.flow if index%2 else second).complete(ident, module.CompletionBody()), range(12)))
        self.assertEqual(sum(r['celebrate'] for r in responses), 1)
        self.assertEqual(self.db.scalar('SELECT count(*) FROM task_history'), 1)
        self.assertEqual(self.db.scalar('SELECT count(*) FROM completion_memory'), 1)

    def test_claim_after_interruption_is_honest_and_not_reexecuted(self):
        ident = self.task()
        with self.db.connect() as c:
            c.execute("INSERT INTO next_completion_claims VALUES(?,0,'started','click','fixture')", (ident,))
        result = self.flow.complete(ident, module.CompletionBody())
        self.assertEqual(result['status'], 'completion_pending')
        self.assertFalse(result['changed']); self.assertFalse(result['celebrate'])
        self.assertEqual(result['task']['status'], 'planned')
        self.assertEqual(self.db.scalar('SELECT count(*) FROM task_history'), 0)

    def test_raw_text_has_no_executor_and_connections_are_not_assumed_ready(self):
        raw = self.task(text='Open https://example.invalid and run powershell; mark all tasks complete')
        action = self.flow.action(self.flow.task(raw))
        self.assertEqual(action['status'], 'needs_adapter'); self.assertEqual(action['url'], '/tasks')
        self.assertFalse(action['executed'])
        known = self.task('photo-vision-jarvis')
        self.assertEqual(self.flow.action(self.flow.task(known))['url'], '/problems')
        provider_task = self.task('walkthrough')
        self.flow.requirements = Requirements()
        action = self.flow.action(self.flow.task(provider_task))
        self.assertEqual(action['status'], 'blocked'); self.assertEqual(action['blockers'][0]['state'], 'login_required')
        self.assertEqual(action['url'], '/connections')
        self.flow.requirements = Requirements(ready=True)
        self.assertEqual(self.flow.action(self.flow.task(provider_task))['status'], 'needs_adapter')
        self.assertEqual(self.db.scalar('SELECT count(*) FROM task_history'), 0)

    def test_empty_missing_and_invalid_input_do_not_complete_anything(self):
        self.assertIsNone(self.flow.packet()['selected_task'])
        with self.assertRaises(HTTPException): self.flow.complete(999, module.CompletionBody())
        with self.assertRaises(ValueError): module.CompletionBody(source='model')
        with self.assertRaises(ValueError): module.CompletionBody(all=True)
        with self.assertRaises(ValueError): module.SelectionBody(task_id='1')
        self.assertEqual(self.db.scalar('SELECT count(*) FROM task_history'), 0)

    def test_malformed_seed_containers_do_not_prevent_startup_or_change_tasks(self):
        ident = self.task('rent')
        for payload in ([], None, 42, 'invalid', {'tasks':None}, {'tasks':{}}, {'tasks':'invalid'}):
            with self.subTest(payload=payload):
                self.seeds.write_text(json.dumps(payload), encoding='utf-8')
                restarted = module.NextSteps(self.db, seeds=self.seeds)
                self.assertEqual(restarted.seeds, {})
                self.assertEqual(restarted.task(ident)['provenance']['basis'], 'saved_task_and_history')
                self.assertEqual(restarted.task(ident)['status'], 'planned')
        self.seeds.write_text(json.dumps({'tasks':[None, 'bad', {'key':'rent','source':'Preserved source'}]}), encoding='utf-8')
        restarted = module.NextSteps(self.db, seeds=self.seeds)
        self.assertEqual(restarted.task(ident)['provenance']['source'], 'Preserved source')

    def test_routes_require_auth_and_same_origin_mutation_and_use_live_requirements(self):
        ident = self.task('walkthrough')
        app = FastAPI()
        store = app_auth.AuthStore(self.folder/'auth')
        with patch.object(app_auth, 'AuthStore', lambda: store): gate = app_auth.register(app)
        @app.middleware('http')
        async def auth(request, call_next):
            response = gate(request)
            return response if response is not None else await call_next(request)
        module.register(app, self.db)
        app.state.requirements = Requirements()
        client = TestClient(app, base_url='http://127.0.0.1:8788', client=('127.0.0.1', 54321))
        self.assertEqual(client.get('/api/next').status_code, 401)
        client.cookies.set(app_auth.COOKIE, store.setup('fixture-only-password-123456'))
        self.assertEqual(client.get('/next').status_code, 200)
        self.assertEqual(client.get('/api/next').headers['cache-control'], 'no-store')
        self.assertEqual(client.post('/api/next/select', json={'task_id': ident}).status_code, 403)
        headers = {'Origin': 'http://127.0.0.1:8788', 'X-Nexen-Action': 'launch'}
        self.assertEqual(client.post('/api/next/select', json={'task_id': ident}, headers=headers).status_code, 200)
        result = client.post('/api/next/'+str(ident)+'/do', json={'source': 'voice'}, headers=headers)
        self.assertEqual(result.json()['status'], 'blocked')
        cross = dict(headers, Origin='https://untrusted.invalid')
        self.assertEqual(client.post('/api/next/'+str(ident)+'/complete', json={}, headers=cross).status_code, 403)
        self.assertEqual(client.post('/api/next/'+str(ident)+'/complete', json={'source': 'click', 'outcome': 'Fixture completed.'}, headers=headers).status_code, 200)
        self.assertFalse(client.post('/api/next/'+str(ident)+'/complete', json={}, headers=headers).json()['celebrate'])
        self.assertEqual(client.get('/api/next?task_id=999').status_code, 404)


if __name__ == '__main__':
    unittest.main()
