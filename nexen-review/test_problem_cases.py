import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import uuid
import zlib

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import app_auth
import problem_cases as module
from photo_inbox import PhotoStore
from task_tracking import TaskCreate
from test_next_step import DB

ROOT = Path(__file__).resolve().parent / 'work' / 'problem-case-tests'
ROOT.mkdir(parents=True, exist_ok=True)


def png(color):
    def chunk(kind, data):
        return struct.pack('>I', len(data))+kind+data+struct.pack('>I', zlib.crc32(kind+data))
    return (b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
            +chunk(b'IDAT', zlib.compress(bytes([0, color, 40, 70])))+chunk(b'IEND', b''))


class Model:
    def __init__(self):
        self.calls = []
        self.image_calls = 0
        self.active = 0
        self.maximum_active = 0
        self.fail_image = None
        self.fail_guide = False
        self.block = None
        self.entered = asyncio.Event()
        self.check_failure = False

    async def check(self, model):
        if self.check_failure:
            raise ValueError('Fixture model unavailable')

    async def ask(self, model, system, prompt, image=None):
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        self.calls.append({'system': system, 'prompt': prompt, 'image': image is not None})
        try:
            self.entered.set()
            if self.block:
                await self.block.wait()
            await asyncio.sleep(0)
            if image is not None:
                self.image_calls += 1
                if self.image_calls == self.fail_image:
                    raise ValueError('Fixture photo response failed')
                return 'Visible evidence: fixture '+str(self.image_calls)+'. Legible text: none. Uncertainty: fixture image.'
            if self.fail_guide:
                raise ValueError('Fixture combined guide failed')
            return 'DRAFT: take one fixture step. Source fixture-source and photos 1–2. No actions executed.'
        finally:
            self.active -= 1


class CaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        asyncio.get_running_loop().set_debug(False)
        self.temporary = tempfile.TemporaryDirectory(prefix='case-', dir=ROOT)
        self.root = Path(self.temporary.name).resolve()
        self.assertTrue(self.root.is_relative_to(ROOT.resolve()))
        self.addCleanup(self.temporary.cleanup)
        self.db = DB(self.root/'case.db')
        self.photos = PhotoStore(self.db, self.root/'photos')
        self.model = Model()
        self.context_calls = []
        def context(query):
            self.context_calls.append(query)
            return {'text': 'Relevant fixture knowledge. SOURCE fixture-source.',
                    'citations': [{'source_id': 'fixture-source', 'title': 'Fixture reference', 'ts': '2026-09-09'}]}
        self.cases = module.Cases(self.db, self.photos, model=self.model, context=context)

    async def asyncTearDown(self):
        await self.cases.shutdown()
        await asyncio.sleep(0)
        self.assertFalse(module.WORKER_LOCK.locked())

    def body(self, count=2, **kwargs):
        ids = [self.photos.put(png(i+1), 'image/png')['photo']['id'] for i in range(count)]
        return module.CaseInput(request_key=uuid.uuid4().hex, title='Fixture life situation', note='User goal and context.',
                                photos=[{'photo_id': ident, 'note': 'Photo note '+str(i+1)} for i, ident in enumerate(ids)], **kwargs)

    async def run_case(self, ident):
        result = await self.cases.start(ident)
        if result['started']:
            await self.cases.task
            await asyncio.sleep(0)
        return self.cases.get(ident)

    async def test_one_to_twenty_ordered_photos_and_idempotent_creation(self):
        body = self.body(20)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.cases.create(body), range(4)))
        self.assertEqual(len({r['case']['id'] for r in results}), 1)
        self.assertEqual(sum(not r['duplicate'] for r in results), 1)
        self.assertEqual(self.db.scalar('SELECT count(*) FROM hub_requests'), 1)
        self.assertEqual([p['photo_id'] for p in results[0]['case']['photos']], [p.photo_id for p in body.photos])
        self.assertEqual([p['position'] for p in results[0]['case']['photos']], list(range(1, 21)))
        payload = body.model_dump(); payload['title'] = 'Changed payload'
        with self.assertRaises(HTTPException): self.cases.create(module.CaseInput(**payload))
        for count in (0, 21):
            invalid = body.model_dump(); invalid['photos'] = [] if count == 0 else body.model_dump()['photos']+[body.model_dump()['photos'][0]]
            with self.assertRaises(ValueError): module.CaseInput(**invalid)
        invalid = body.model_dump(); invalid['photos'] = [invalid['photos'][0]]*2
        with self.assertRaises(ValueError): module.CaseInput(**invalid)
        invalid = body.model_dump(); invalid['photos'][0]['path'] = 'F:/arbitrary.png'
        with self.assertRaises(ValueError): module.CaseInput(**invalid)

    async def test_sequential_summaries_then_guide_with_context_without_completion(self):
        ident = self.cases.create(self.body())['case']['id']
        result = await self.run_case(ident)
        self.assertEqual(result['status'], 'guide_ready')
        self.assertEqual(result['guide_status'], 'draft_ready')
        self.assertEqual(result['summaries_ready'], 2)
        self.assertEqual([c['image'] for c in self.model.calls], [True, True, False])
        self.assertEqual(self.model.maximum_active, 1)
        self.assertEqual([json.loads(c['prompt'])['photo_number'] for c in self.model.calls[:2]], [1, 2])
        self.assertIn('fixture-source', self.model.calls[-1]['prompt'])
        self.assertEqual(len(self.context_calls), 1)
        self.assertEqual(result['task_status'], 'planned')
        self.assertEqual(result['stage'], 'draft_review')
        self.assertEqual([s['id'] for s in result['flow']['stages']], ['context', 'knowledge', 'transcripts', 'suggestions', 'answer', 'combined'])
        self.assertEqual(len(result['photos'][0]['original_sha256']), 64)
        self.assertTrue(result['photos'][0]['original_uploaded_at'])
        self.assertTrue(result['knowledge']['retrieved_at'])
        self.assertFalse(result['executed'])
        self.assertEqual(self.db.scalar('SELECT count(*) FROM task_history'), 0)
        self.assertFalse((await self.cases.start(ident))['started'])
        self.assertEqual(len(self.model.calls), 3)

    async def test_photo_failure_retry_resumes_only_unfinished_photos(self):
        ident = self.cases.create(self.body(3))['case']['id']
        self.model.fail_image = 2
        failed = await self.run_case(ident)
        self.assertEqual(failed['status'], 'failed'); self.assertEqual(failed['summaries_ready'], 1)
        first_summary = failed['photos'][0]['summary']
        self.model.fail_image = None
        ready = await self.run_case(ident)
        self.assertEqual(ready['status'], 'guide_ready')
        self.assertEqual(ready['photos'][0]['summary'], first_summary)
        self.assertEqual(self.model.image_calls, 4)
        self.assertEqual(len(self.model.calls), 5)

    async def test_twenty_long_summaries_fit_one_bounded_combined_request(self):
        body = self.body(20).model_copy(update={'title': 'T'*160, 'note': 'N'*3000})
        ident = self.cases.create(body)['case']['id']
        original_ask = self.model.ask
        async def long_summary(model, system, prompt, image=None):
            result = await original_ask(model, system, prompt, image)
            return 'Evidence and uncertain draft OCR. '*140 if image is not None else result
        self.model.ask = long_summary
        self.cases.context = lambda query: {'text': 'K'*4000, 'citations': []}
        ready = await self.run_case(ident)
        self.assertEqual(ready['status'], 'guide_ready')
        self.assertEqual(ready['summaries_ready'], 20)
        self.assertEqual(len(self.model.calls), 21)
        self.assertLessEqual(len(self.model.calls[-1]['prompt']), 23000)
        self.assertIn('"summary_truncated": true', self.model.calls[-1]['prompt'])

    async def test_failed_guide_retry_does_not_repeat_image_calls(self):
        ident = self.cases.create(self.body())['case']['id']
        self.model.fail_guide = True
        failed = await self.run_case(ident)
        self.assertEqual(failed['guide_status'], 'failed'); self.assertEqual(failed['summaries_ready'], 2)
        self.model.fail_guide = False
        self.assertEqual((await self.run_case(ident))['status'], 'guide_ready')
        self.assertEqual(self.model.image_calls, 2)
        self.assertEqual(len(self.model.calls), 4)

    async def test_duplicate_start_single_worker_and_explicit_stop(self):
        first = self.cases.create(self.body())['case']['id']
        second = self.cases.create(self.body())['case']['id']
        self.model.block = asyncio.Event()
        await self.cases.start(first); await self.model.entered.wait()
        self.assertFalse((await self.cases.start(first))['started'])
        with self.assertRaises(HTTPException): await self.cases.start(second)
        self.cases.stop(first); await self.cases.task; await asyncio.sleep(0)
        paused = self.cases.get(first)
        self.assertEqual(paused['status'], 'paused'); self.assertEqual(paused['summaries_ready'], 0)
        self.assertEqual(self.cases.get(second)['status'], 'ready')

    async def test_immediate_stop_before_coroutine_start_releases_worker(self):
        ident = self.cases.create(self.body(1))['case']['id']
        await self.cases.start(ident); self.cases.stop(ident)
        await asyncio.gather(self.cases.task, return_exceptions=True); await asyncio.sleep(0)
        self.assertFalse(module.WORKER_LOCK.locked())
        self.assertEqual(self.cases.get(ident)['status'], 'paused')
        self.assertEqual(len(self.model.calls), 0)
        self.assertEqual((await self.run_case(ident))['status'], 'guide_ready')

    async def test_restart_recovery_preserves_saved_summaries_without_autostart(self):
        ident = self.cases.create(self.body())['case']['id']
        with self.db.connect() as c:
            c.execute("UPDATE problem_cases SET status='running' WHERE id=?", (ident,))
            c.execute("UPDATE problem_case_photos SET status='summary_ready',summary='Saved fixture evidence' WHERE case_id=? AND position=1", (ident,))
            c.execute("UPDATE problem_case_photos SET status='running' WHERE case_id=? AND position=2", (ident,))
        restarted = module.Cases(self.db, self.photos, model=self.model, context=self.cases.context)
        restarted.recover()
        result = restarted.get(ident)
        self.assertEqual(result['status'], 'interrupted')
        self.assertEqual(result['photos'][0]['summary'], 'Saved fixture evidence')
        self.assertEqual(result['photos'][1]['status'], 'interrupted')
        self.assertEqual(len(self.model.calls), 0)

    async def test_integrity_or_missing_model_stops_before_image_submission(self):
        body = self.body(1); ident = self.cases.create(body)['case']['id']
        path, _ = self.photos.file(body.photos[0].photo_id)
        path.write_bytes(path.read_bytes()+b'fixture modification')
        self.assertEqual((await self.run_case(ident))['status'], 'failed')
        self.assertEqual(len(self.model.calls), 0)
        other = self.cases.create(body.model_copy(update={'request_key': uuid.uuid4().hex}))['case']['id']
        self.model.check_failure = True
        self.assertEqual((await self.run_case(other))['status'], 'failed')
        self.assertEqual(len(self.model.calls), 0)

    async def test_existing_completed_task_status_is_preserved(self):
        task_id = self.cases.tracker.create(TaskCreate(text='Existing completed fixture'), initial_status='done')
        ident = self.cases.create(self.body(1, task_id=task_id))['case']['id']
        self.assertEqual((await self.run_case(ident))['task_status'], 'done')
        self.assertEqual(self.db.scalar('SELECT count(*) FROM task_history'), 0)
        self.assertEqual(self.db.scalar('SELECT count(*) FROM hub_requests'), 1)

    async def test_routes_require_auth_and_origin_and_reject_server_paths(self):
        app = FastAPI(); store = app_auth.AuthStore(self.root/'auth')
        with patch.object(app_auth, 'AuthStore', lambda: store): gate = app_auth.register(app)
        @app.middleware('http')
        async def authenticate(request, call_next):
            response = gate(request)
            return response if response is not None else await call_next(request)
        module.register(app, self.db, self.photos)
        client = TestClient(app, base_url='http://127.0.0.1:8788', client=('127.0.0.1', 54321))
        self.assertEqual(client.get('/api/problem-cases').status_code, 401)
        client.cookies.set(app_auth.COOKIE, store.setup('fixture-only-password-123456'))
        self.assertEqual(client.get('/problem-cases').status_code, 200)
        self.assertIn('photo_prompt', client.get('/api/problem-cases/prompts').json())
        body = self.body().model_dump()
        self.assertEqual(client.post('/api/problem-cases', json=body).status_code, 403)
        headers = {'Origin': 'http://127.0.0.1:8788'}
        result = client.post('/api/problem-cases', json=body, headers=headers)
        self.assertEqual(result.status_code, 200)
        case = result.json()['case']
        self.assertEqual(client.get('/api/problem-cases/by-task/'+str(case['task_id'])).json()['cases'][0]['id'], case['id'])
        body['path'] = 'F:/never-accept-a-path.png'
        self.assertEqual(client.post('/api/problem-cases', json=body, headers=headers).status_code, 422)
        self.assertEqual(client.post('/api/problem-cases/'+str(case['id'])+'/start', headers={'Origin': 'https://untrusted.invalid'}).status_code, 403)
        self.assertEqual(client.get('/api/problem-cases/999').status_code, 404)


if __name__ == '__main__':
    unittest.main()
