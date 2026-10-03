import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
import asyncio
import httpx
from fastapi import FastAPI

from pydantic import ValidationError
from money_engine import Engine, Inputs, OpportunityCreate, OpportunityUpdate, calculate, register


class DB:
    def __init__(self, path): self.path = path
    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path)
        try:
            with connection:
                yield connection
        finally:
            connection.close()


class MoneyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = DB(str(Path(self.temp.name) / 'test.sqlite3'))
        self.engine = Engine(self.db)

    def tearDown(self): self.temp.cleanup()

    def scenario(self, supplier=1000):
        return dict(price_cents=3499, supplier_cost_cents=supplier, shipping_cents=500,
                    packaging_cents=100, payment_fees_cents=130, refund_reserve_cents=200)

    def test_unknown_is_not_zero(self):
        r = calculate(Inputs().model_dump())
        self.assertFalse(r['complete'])
        self.assertEqual(len(r['missing']), 5)
        self.assertIsNone(r['contribution_before_ads_cents'])
        self.assertIsNone(r['orders_to_cover_50'])

    def test_exact_contribution_and_ceiling(self):
        r = calculate(self.scenario())
        self.assertEqual(r['landed_cost_cents'], 1600)
        self.assertEqual(r['variable_cost_cents'], 1930)
        self.assertEqual(r['contribution_before_ads_cents'], 1569)
        self.assertEqual(r['break_even_cac_cents'], 1569)
        self.assertEqual(r['orders_to_cover_50'], 4)

    def test_zero_and_loss_margin(self):
        for supplier, margin in [(2569, 0), (3000, -431)]:
            r = calculate(self.scenario(supplier))
            self.assertEqual(r['contribution_before_ads_cents'], margin)
            self.assertIsNone(r['orders_to_cover_50'])
            self.assertIsNone(r['break_even_cac_cents'])

    def test_rejects_nan_float_bool_negative_and_cap_override(self):
        for v in [float('nan'), float('inf'), 1.3, True, -1, '12', 10000001]:
            with self.assertRaises(ValidationError): Inputs(supplier_cost_cents=v)
        with self.assertRaises(ValidationError): Inputs(price_cents=0)
        with self.assertRaises(ValidationError): Inputs(total_cap_cents=500000)
        with self.assertRaises(ValidationError): OpportunityUpdate(status='verified')

    def test_persistence_reopen_and_seed_idempotence(self):
        self.engine.save_inputs(Inputs(**self.scenario()))
        ident = self.engine.create(OpportunityCreate(title='Test offer', next_step='Validate price'))
        self.engine.update(ident, OpportunityUpdate(status='completed', evidence='Local note'))
        fresh = Engine(self.db)
        self.assertEqual(len(fresh.opportunities()), 4)
        self.assertEqual(fresh.inputs()['values'], self.scenario())
        self.assertEqual(fresh.opportunities()[-1]['status'], 'completed')
        fresh.update(ident, OpportunityUpdate(status='research', next_step='Recheck evidence'))
        self.assertEqual(Engine(self.db).opportunities()[-1]['status'], 'research')

    def test_local_status_cannot_verify_or_spend(self):
        with self.db.connect() as c:
            c.execute('CREATE TABLE hub_requests(id INTEGER PRIMARY KEY,text TEXT,status TEXT)')
            c.executemany('INSERT INTO hub_requests(text,status) VALUES(?,?)', [('Lumipaw setup','done'), ('Music release','planned'), ('Unrelated task','done')])
        for item in self.engine.opportunities():
            self.engine.update(item['id'], OpportunityUpdate(status='active', evidence='I marked this ready'))
        x = self.engine.status()
        self.assertEqual(x['task_progress']['total'], 2)
        self.assertEqual(x['task_progress']['percent'], 50)
        self.assertFalse(x['readiness']['can_execute_ads'])
        self.assertFalse(x['readiness']['checkout_verified'])
        self.assertTrue(all(not g['provider_verified'] for g in x['gates']))
        self.assertIsNone(x['revenue']['actual_cents'])
        self.assertIsNone(x['budget']['actual_spend_cents'])
        self.assertEqual(x['budget']['total_cap_cents'], 5000)
        self.assertFalse(x['budget']['automatically_restarts'])

    def test_status_only_patch_preserves_notes_and_explicit_empty_clears(self):
        ident = self.engine.create(OpportunityCreate(title='Existing offer', evidence='Supplier quote', next_step='Check delivery'))
        async def exercise():
            app = FastAPI()
            register(app, self.db)
            transport = httpx.ASGITransport(app=app, client=('127.0.0.1', 51000))
            headers = {'Origin':'http://127.0.0.1:8788', 'X-Nexen-Action':'launch'}
            async with httpx.AsyncClient(transport=transport, base_url='http://127.0.0.1:8788') as client:
                response = await client.patch(f'/api/money/opportunities/{ident}', json={'status':'active'}, headers=headers)
                self.assertEqual(response.status_code, 200)
                saved = next(x for x in response.json()['opportunities'] if x['id'] == ident)
                self.assertEqual(saved['evidence'], 'Supplier quote')
                self.assertEqual(saved['next_step'], 'Check delivery')
                response = await client.patch(f'/api/money/opportunities/{ident}', json={'status':'blocked','evidence':''}, headers=headers)
                saved = next(x for x in response.json()['opportunities'] if x['id'] == ident)
                self.assertEqual(saved['evidence'], '')
                self.assertEqual(saved['next_step'], 'Check delivery')
                self.assertEqual((await client.patch(f'/api/money/opportunities/{ident}', json={'status':'active','next_step':None}, headers=headers)).status_code, 422)
        asyncio.run(exercise())

    def test_routes_validate_origin_and_serve_real_state(self):
        async def exercise():
            app = FastAPI()
            register(app, self.db)
            transport = httpx.ASGITransport(app=app, client=('127.0.0.1', 51000))
            async with httpx.AsyncClient(transport=transport, base_url='http://127.0.0.1:8788') as client:
                page = await client.get('/money')
                self.assertEqual(page.status_code, 200)
                self.assertIn('Money Engine', page.text)
                status = await client.get('/api/money/status')
                self.assertEqual(status.status_code, 200)
                self.assertEqual(len(status.json()['opportunities']), 3)
                denied = await client.post('/api/money/inputs', json=self.scenario())
                self.assertEqual(denied.status_code, 403)
                headers = {'Origin':'http://127.0.0.1:8788', 'X-Nexen-Action':'launch'}
                saved = await client.post('/api/money/inputs', json=self.scenario(), headers=headers)
                self.assertEqual(saved.status_code, 200)
                self.assertEqual(saved.json()['calculator']['orders_to_cover_50'], 4)
                override = await client.post('/api/money/inputs', json={'total_cap_cents':10000}, headers=headers)
                self.assertEqual(override.status_code, 422)
                cross = await client.post('/api/money/inputs', json=self.scenario(), headers=dict(headers, Origin='https://example.test'))
                self.assertEqual(cross.status_code, 403)
        asyncio.run(exercise())


if __name__ == '__main__': unittest.main()
