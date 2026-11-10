"""Isolated task/workspace integration tests; no live services or model calls."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
import httpx

from money_engine import Engine, OpportunityCreate
from money_workspace import MoneyWorkspace, WorkspaceTaskBody, register, SEED_GROUPS, SEED_TRACKS
from task_tracking import TaskCreate, TaskUpdate


class DB:
    def __init__(self, path):
        self.path = path

    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        try:
            with c:
                yield c
        finally:
            c.close()

    def rows(self, sql, params=()):
        with self.connect() as c:
            return [dict(row) for row in c.execute(sql, params)]

    def scalar(self, sql, params=()):
        with self.connect() as c:
            row = c.execute(sql, params).fetchone()
            return row[0] if row else None


class MoneyWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db = DB(self.root / 'tasks.sqlite3')
        self.engine = Engine(self.db)
        self.workspace = MoneyWorkspace(self.db, self.engine)

    def tearDown(self):
        self.temp.cleanup()

    def task(self, text='A bounded next action', key=None, status='planned', priority='normal'):
        return self.workspace.tracker.create(TaskCreate(text=text, priority=priority),
                                             seed_key=key, initial_status=status)

    def body(self, **values):
        return WorkspaceTaskBody(text='Review product photo rights', track_id='lumipaw',
                                 request_key='a' * 32, **values)

    def test_exact_seed_mapping_all_tracks_and_no_keyword_inference(self):
        keys = {'housing': 'rent-calls', 'lumipaw': 'store-supplier', 'wdr': 'wdr-store',
                'music': 'music-releases', 'nexen-product': 'public-product', 'other': 'automation-ranking'}
        ids = {track: self.task(key=key) for track, key in keys.items()}
        unknown = self.task('Lumipaw and music in an unrelated historical note')
        result = self.workspace.workspace()
        tracks = {row['id']: row for row in result['tracks']}
        for track, ident in ids.items():
            self.assertEqual(tracks[track]['tasks'][0]['id'], ident)
            self.assertEqual(tracks[track]['tasks'][0]['assignment']['basis'], 'seed_key')
        self.assertEqual(result['unassigned_tasks'][0]['id'], unknown)
        self.assertEqual(tracks['housing']['kind'], 'needs')
        self.assertFalse(result['coverage']['keyword_fallback_used'])
        self.assertFalse(result['summary']['income_verified'])
        self.assertEqual(sum(map(len, SEED_GROUPS.values())), len(SEED_TRACKS))

    def test_saved_link_wins_and_survives_reconstruction_without_task_mutation(self):
        ident = self.task(key='store-payment', status='blocked')
        before = self.workspace.tracker.get(ident)
        self.workspace.link(ident, 'music')
        fresh = MoneyWorkspace(self.db, self.engine).workspace()
        music = next(row for row in fresh['tracks'] if row['id'] == 'music')
        task = music['tasks'][0]
        self.assertEqual(task['id'], ident)
        self.assertEqual(task['assignment']['basis'], 'saved_link')
        self.assertEqual(self.workspace.tracker.get(ident), before)
        self.assertEqual(music['blocked_count'], 1)

    def test_all_opportunities_kept_and_seed_alias_uses_existing_business(self):
        ident = self.engine.create(OpportunityCreate(title='Original new service', category='service'))
        task_id = self.task()
        self.workspace.link(task_id, 'opportunity-' + str(ident))
        result = self.workspace.workspace()
        track = next(row for row in result['tracks'] if row['id'] == 'opportunity-' + str(ident))
        self.assertEqual(track['title'], 'Original new service')
        self.assertEqual(track['opportunity_ids'], [ident])
        self.assertEqual(track['tasks'][0]['id'], task_id)
        self.assertEqual(sorted(i for row in result['tracks'] for i in row['opportunity_ids']),
                         sorted(item['id'] for item in self.engine.opportunities()))
        lumipaw_id = result['tracks'][1]['opportunity_ids'][0]
        self.assertEqual(self.workspace.link(task_id, 'opportunity-' + str(lumipaw_id))['track_id'], 'lumipaw')

    def test_completion_and_reopen_read_authoritative_tracker_history(self):
        ident = self.task(key='ad-video')
        with patch('completion_memory.export_journal', return_value={'status': 'fixture'}):
            self.workspace.tracker.update(ident, TaskUpdate(status='done', outcome='Prepared reviewed draft'))
            completed = self.workspace.workspace()['tracks'][1]
            self.assertEqual(completed['done_count'], 1)
            self.assertIsNone(completed['next_task'])
            self.workspace.tracker.update(ident, TaskUpdate(status='planned', outcome='Replace one asset'))
        reopened = self.workspace.workspace()['tracks'][1]
        self.assertEqual(reopened['open_count'], 1)
        self.assertEqual(reopened['done_count'], 0)
        self.assertEqual(reopened['next_task']['id'], ident)
        self.assertEqual(len(self.workspace.tracker.get(ident)['history']), 2)
        self.assertFalse(reopened['next_task']['provider_verified'])

    def test_pagination_discloses_scope_and_unassigned_never_disappear(self):
        ids = {self.task(text='Legacy task ' + str(i)) for i in range(4)}
        pages = [self.workspace.workspace(offset, 2) for offset in (0, 2)]
        self.assertEqual({task['id'] for page in pages for task in page['unassigned_tasks']}, ids)
        self.assertEqual(pages[0]['summary']['total_tasks'], 4)
        self.assertEqual(pages[0]['summary']['loaded_tasks'], 2)
        self.assertEqual(pages[0]['coverage']['next_offset'], 2)
        self.assertTrue(pages[0]['coverage']['truncated'])
        self.assertTrue(pages[1]['coverage']['truncated'])
        self.assertFalse(pages[1]['coverage']['has_more'])
        self.assertIsNone(pages[1]['coverage']['next_offset'])

    def test_urgent_done_excluded_and_next_action_order_is_saved_priority(self):
        normal = self.task(key='store-supplier')
        urgent = self.task(key='store-domain', priority='urgent')
        self.task(key='store-payment', status='done', priority='urgent')
        result = self.workspace.workspace()
        self.assertEqual([row['id'] for row in result['urgent_tasks']], [urgent])
        track = result['tracks'][1]
        self.assertEqual(track['next_task']['id'], urgent)
        self.assertEqual((track['open_count'], track['done_count']), (2, 1))
        self.assertIn(normal, [row['id'] for row in track['tasks']])

    def test_create_is_atomic_idempotent_and_replay_preserves_later_edits(self):
        first = self.workspace.create(self.body())
        self.assertTrue(first['created'])
        self.assertFalse(first['executed'])
        self.workspace.link(first['task_id'], 'other')
        with patch('completion_memory.export_journal', return_value={'status': 'fixture'}):
            self.workspace.tracker.update(first['task_id'], TaskUpdate(status='done'))
        replay = MoneyWorkspace(self.db, self.engine).create(self.body())
        self.assertEqual(replay['task_id'], first['task_id'])
        self.assertEqual(replay['track_id'], 'other')
        self.assertEqual(replay['task']['status'], 'done')
        self.assertTrue(replay['replayed'])
        self.assertEqual(self.db.scalar('SELECT count(*) FROM hub_requests'), 1)
        changed = self.body().model_copy(update={'next_step': 'Changed content'})
        with self.assertRaises(HTTPException) as conflict:
            self.workspace.create(changed)
        self.assertEqual(conflict.exception.status_code, 409)

    def test_creation_rolls_back_if_track_insert_fails(self):
        with self.db.connect() as c:
            c.execute("CREATE TRIGGER reject_link BEFORE INSERT ON money_task_tracks BEGIN SELECT RAISE(ABORT,'fixture fault'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.workspace.create(self.body())
        for table in ('hub_requests', 'task_details', 'money_task_tracks', 'money_task_creation_receipts'):
            self.assertEqual(self.db.scalar('SELECT count(*) FROM ' + table), 0)

    def test_concurrent_same_request_creates_once(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: self.workspace.create(self.body()), range(2)))
        self.assertEqual(results[0]['task_id'], results[1]['task_id'])
        self.assertEqual(sum(item['created'] for item in results), 1)
        self.assertEqual(self.db.scalar('SELECT count(*) FROM hub_requests'), 1)

    def test_unknown_ids_rejected_before_any_task_changes(self):
        ident = self.task()
        for task_id, track_id in [(999, 'music'), (ident, 'unknown'), (ident, 'opportunity-999')]:
            with self.assertRaises(HTTPException) as missing:
                self.workspace.link(task_id, track_id)
            self.assertEqual(missing.exception.status_code, 404)
        with self.assertRaises(HTTPException):
            self.workspace.create(self.body().model_copy(update={'track_id': 'unknown'}))
        self.assertEqual(self.db.scalar('SELECT count(*) FROM hub_requests'), 1)
        self.assertEqual(self.db.scalar('SELECT count(*) FROM money_task_tracks'), 0)

    def test_real_auth_gate_origin_and_http_contract(self):
        import app_auth
        store = app_auth.AuthStore(self.root / 'auth')
        token = store.setup('fixture-password-only-123')
        app = FastAPI()
        with patch.object(app_auth, 'AuthStore', return_value=store):
            gate = app_auth.register(app)

        @app.middleware('http')
        async def auth(request, call_next):
            denied = gate(request)
            return denied if denied is not None else await call_next(request)

        register(app, self.db, self.engine)

        async def exercise():
            headers = {'Origin': 'http://127.0.0.1:8788', 'X-Nexen-Action': 'launch'}
            transport = httpx.ASGITransport(app=app, client=('127.0.0.1', 54000))
            async with httpx.AsyncClient(transport=transport, base_url='http://127.0.0.1:8788') as client:
                self.assertEqual((await client.get('/api/money/workspace')).status_code, 401)
                self.assertEqual((await client.post('/api/money/tasks', json=self.body().model_dump(mode='json'), headers=headers)).status_code, 401)
                client.cookies.set(app_auth.COOKIE, token)
                self.assertEqual((await client.get('/api/money/workspace?limit=501')).status_code, 422)
                self.assertEqual((await client.post('/api/money/tasks', json=self.body().model_dump(mode='json'))).status_code, 403)
                denied = await client.post('/api/money/tasks', json=self.body().model_dump(mode='json'),
                                           headers=dict(headers, Origin='https://example.test'))
                self.assertEqual(denied.status_code, 403)
                created = await client.post('/api/money/tasks', json=self.body().model_dump(mode='json'), headers=headers)
                self.assertEqual(created.status_code, 200)
                ident = created.json()['task_id']
                linked = await client.post(f'/api/money/tasks/{ident}/track', json={'track_id': 'music'}, headers=headers)
                self.assertEqual(linked.json()['track_id'], 'music')
                self.assertFalse(linked.json()['executed'])
                result = (await client.get('/api/money/workspace')).json()
                self.assertEqual(result['summary']['total_tasks'], 1)
                self.assertEqual(next(t for t in result['tracks'] if t['id'] == 'music')['tasks'][0]['id'], ident)
                self.assertEqual((await client.post('/api/money/tasks', json=dict(self.body().model_dump(mode='json'), status='done'), headers=headers)).status_code, 422)
            remote = httpx.ASGITransport(app=app, client=('192.0.2.10', 54000))
            async with httpx.AsyncClient(transport=remote, base_url='http://127.0.0.1:8788', cookies={app_auth.COOKIE: token}) as client:
                self.assertEqual((await client.get('/api/money/workspace')).status_code, 403)
        asyncio.run(exercise())


if __name__ == '__main__':
    unittest.main()
