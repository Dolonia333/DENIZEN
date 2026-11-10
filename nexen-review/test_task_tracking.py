import json
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
import task_tracking as module
from task_tracking import Tracker, TaskCreate, TaskUpdate

ROOT = Path(__file__).resolve().parent / 'work' / 'task-tests'
ROOT.mkdir(parents=True, exist_ok=True)


class DB:
    def __init__(self, path):
        self.path = path
        self.memory_vault = Path(path).parent / 'fixture-vault'
    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA journal_mode=MEMORY')
        c.execute('PRAGMA synchronous=OFF')
        try:
            yield c
            c.commit()
        finally:
            c.close()
    def rows(self, sql, args=()):
        with self.connect() as c:
            return [dict(x) for x in c.execute(sql, args).fetchall()]
    def scalar(self, sql, args=()):
        with self.connect() as c:
            return c.execute(sql, args).fetchone()[0]


class TrackingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT)
        self.path = Path(self.temp.name)
        self.db = DB(self.path / 'test.sqlite3')
        self.tracker = Tracker(self.db)
    def tearDown(self):
        self.temp.cleanup()

    def test_existing_request_retained_and_reopen_persists(self):
        with self.db.connect() as c:
            c.execute("INSERT INTO hub_requests(text,status,created_at) VALUES('Original user request','planned','2026-01-01')")
        request_id = self.tracker.list()['tasks'][0]['id']
        for status in ('in_progress', 'blocked', 'done'):
            self.tracker.update(request_id, TaskUpdate(status=status))
        closed = Tracker(self.db).get(request_id)
        self.assertEqual(closed['status'], 'done')
        self.assertIsNotNone(closed['completed_at'])
        self.assertEqual(self.tracker.list()['total'], 0)
        reopened = Tracker(self.db).update(request_id, TaskUpdate(status='in_progress', next_step='Try again'))
        self.assertEqual(reopened['text'], 'Original user request')
        self.assertEqual(reopened['created_at'], '2026-01-01')
        self.assertIsNone(reopened['completed_at'])
        self.assertEqual(len(reopened['history']), 4)
        self.assertEqual(self.tracker.list()['total'], 1)

    def test_followup_outcome_and_date_history_are_durable(self):
        ident = self.tracker.create(TaskCreate(text='Call a service'))
        self.tracker.update(ident, TaskUpdate(outcome='Reached receptionist; callback requested', reminder_date='2026-10-01'))
        reopened = Tracker(self.db).get(ident)
        self.assertEqual(reopened['reminder_date'], '2026-10-01')
        self.assertIn('callback', reopened['history'][0]['outcome'])
        self.tracker.update(ident, TaskUpdate(reminder_date=None))
        self.assertIsNone(Tracker(self.db).get(ident)['reminder_date'])
        self.assertEqual(len(Tracker(self.db).get(ident)['history']), 2)

    def test_seed_idempotence_never_reopens_completed_user_task(self):
        seed = self.path / 'seed.json'
        seed.write_text(json.dumps({'tasks': [{'key':'test-urgent','text':'Fixture urgent task','priority':'urgent','pinned':True,'due':'2026-10-01','next_action':'Take the next step','status':'blocked'}]}), encoding='utf-8')
        self.tracker.seed(seed)
        item = self.tracker.list()['tasks'][0]
        self.assertEqual(item['status'], 'blocked')
        self.assertEqual(item['due_date'], '2026-10-01')
        self.tracker.update(item['id'], TaskUpdate(status='done'))
        Tracker(self.db).seed(seed)
        self.assertEqual(self.tracker.list(True)['total'], 1)
        self.assertEqual(self.tracker.get(item['id'])['status'], 'done')

    def test_validation_and_pinned_sorting(self):
        with self.assertRaises(ValidationError):
            TaskUpdate(status='automatically_paid')
        with self.assertRaises(ValidationError):
            TaskUpdate(due_date='not-a-date')
        with self.assertRaises(ValidationError):
            TaskUpdate(command='shell')
        self.tracker.create(TaskCreate(text='Normal task'))
        pinned = self.tracker.create(TaskCreate(text='Pinned urgent', priority='urgent'), pinned=True)
        self.assertEqual(self.tracker.list()['tasks'][0]['id'], pinned)

    def test_seed_metadata_and_canonical_alias_precedence(self):
        seed = self.path / 'metadata-seed.json'
        seed.write_text(json.dumps({'tasks': [{'key':'metadata','text':'Preserve canonical fields','source':'active user request','source_urls':['https://example.org/'],'checked_date':'2026-09-09','due':'2026-10-02','due_date':'2026-10-01','next_action':'old alias','next_step':'current next step'}]}), encoding='utf-8')
        self.assertEqual(self.tracker.seed(seed), 1)
        item = self.tracker.list()['tasks'][0]
        self.assertEqual(item['due_date'], '2026-10-01')
        self.assertEqual(item['next_step'], 'current next step')

    def test_completion_reopen_memory_is_redacted_and_retrievable(self):
        from memory_bridge import SharedMemory
        ident = self.tracker.create(TaskCreate(text='Fixture wardrobe build'))
        complete = self.tracker.update(ident, TaskUpdate(status='done', outcome='password=fixture-private-value on DESKTOP-FIXTURE01'))
        self.assertEqual(complete['memory_sync']['status'], 'ready')
        self.tracker.update(ident, TaskUpdate(status='planned'))
        records = self.db.rows('SELECT * FROM completion_memory ORDER BY id')
        self.assertEqual([r['status'] for r in records], ['done','reopened'])
        self.assertTrue(all(r['basis']=='user_marked' for r in records))
        self.assertNotIn('fixture-private-value', records[0]['body'])
        self.assertNotIn('DESKTOP-FIXTURE01', records[0]['body'])
        self.assertIn('not independent proof', records[0]['body'])
        journal = self.db.memory_vault / 'Plans' / 'NEXEN Completion History'
        self.assertEqual(len(list(journal.glob('*.md'))), 2)
        context = SharedMemory(export_db=self.path/'missing.sqlite3', knowledge_db=self.db.path, vault=self.db.memory_vault).build_context('wardrobe')
        self.assertEqual(context['citations'][0]['kind'], 'completion')
        self.assertEqual(context['citations'][0]['status'], 'reopened')
        self.assertIn('REOPENED', context['text'])
        self.assertFalse(context['citations'][0]['provenance'][0]['external_execution_verified'])

    def test_unowned_journal_is_preserved_and_completion_still_commits(self):
        journal = self.db.memory_vault / 'Plans' / 'NEXEN Completion History'
        journal.mkdir(parents=True)
        original = journal / 'existing.md'
        original.write_text('Keep this user note', encoding='utf-8')
        ident = self.tracker.create(TaskCreate(text='Fixture source-preservation'))
        result = self.tracker.update(ident, TaskUpdate(status='done'))
        self.assertEqual(result['status'], 'done')
        self.assertEqual(result['memory_sync']['status'], 'conflict')
        self.assertEqual(original.read_text(encoding='utf-8'), 'Keep this user note')
        self.assertEqual(self.db.scalar('SELECT count(*) FROM completion_memory WHERE exported_at IS NULL'), 1)

    def test_http_local_guard_and_persistent_update(self):
        app = FastAPI()
        with patch.object(module, 'BASE', self.path):
            module.register(app, self.db)
        client = TestClient(app, base_url='http://127.0.0.1:8788', client=('127.0.0.1', 50000))
        self.assertEqual(client.get('/tasks').status_code, 200)
        self.assertEqual(client.get('/api/tasks', headers={'Host':'external.example'}).status_code, 403)
        self.assertEqual(client.post('/api/tasks', json={'text':'HTTP fixture'}).status_code, 403)
        headers = {'Origin':'http://127.0.0.1:8788', 'X-Nexen-Action':'launch'}
        made = client.post('/api/tasks', headers=headers, json={'text':'HTTP fixture'})
        self.assertEqual(made.status_code, 200)
        ident = made.json()['id']
        changed = client.patch('/api/tasks/' + str(ident), headers=headers, json={'status':'done'})
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(client.get('/api/tasks?include_done=true').json()['tasks'][0]['status'], 'done')
        self.assertEqual(client.patch('/api/tasks/' + str(ident), headers=headers, json={'status':'invalid'}).status_code, 422)
        self.assertEqual(client.get('/api/tasks/999999').status_code, 404)


if __name__ == '__main__':
    unittest.main()
