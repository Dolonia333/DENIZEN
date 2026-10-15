import asyncio
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from pydantic import ValidationError
import automatic_mode as am


class DB:
    def __init__(self, path): self.path = path
    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path)
        try:
            with conn: yield conn
        finally:
            conn.close()


class Requirements:
    def __init__(self):
        self.items = [dict(id=x, state='setup_required', title=x, action='Complete '+x,
                           verified=False, url='/connections') for x in ('amboras', 'ads', 'phone', 'supercool', 'pc2', 'n8n')]
    def status(self): return {'pending': self.items, 'coverage': 'Fixture observations only'}


class ModeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='automatic-mode-')
        self.base = Path(self.temp.name)
        (self.base/'data').mkdir()
        self.db = DB(str(self.base/'test.sqlite'))
        self.sup = SimpleNamespace(cfg={'models': {'openai': {'enabled': False}, 'anthropic': {'enabled': False}}})
        self.now = 10000.0
        self.opts = dict(base=self.base, migration_state=self.base/'migration.json',
                         migration_pauses=self.base/'migration-pauses.json', clock=lambda:self.now, running=lambda:True)
        self.mode = am.AutomaticMode(self.db, self.sup, **self.opts)
        self.requirements = Requirements()

    def tearDown(self): self.temp.cleanup()

    def test_defaults_preserve_authorized_enabled_intent_and_goal_scope(self):
        s = self.mode.status(self.requirements)
        self.assertTrue(s['enabled'])
        self.assertTrue(s['local_work_permitted'])
        self.assertEqual([x['id'] for x in s['primary_blockers']], ['amboras', 'ads'])
        self.assertEqual(len(s['other_connections']), 4)
        self.assertFalse(s['money_limits']['spending_enabled'])
        self.assertEqual(s['money_limits']['total_cap_cents'], 5000)

    def test_goal_vocabulary_matches_catalog_and_unknown_stored_goal_is_tolerated(self):
        for goal in am.GOALS:
            self.assertEqual(am.ModeBody(enabled=True, goal=goal).goal, goal)
        with self.db.connect() as c:
            c.execute("UPDATE automatic_mode_state SET goal='retired-goal'")
        result = self.mode.status(self.requirements)
        self.assertEqual(result['primary_blockers'], [])
        self.assertEqual(result['goal'], 'retired-goal')
        self.assertFalse(result['money_limits']['spending_enabled'])

    def test_migration_failed_unverified_and_partial_state_never_resume(self):
        called = []
        p = self.opts['migration_state']
        for data in [{'status':'failed'}, {'status':'copying','active_in_ollama':True},
                     {'status':'copying','activation_verified':True}, {'status':'active','active_in_ollama':False}]:
            p.write_text(json.dumps(data))
            self.mode.set_mode(am.ModeBody(enabled=True))
            self.assertEqual(self.mode.gate(), 'maintenance')
            self.mode.tick(lambda:called.append(True))
        p.write_text('{broken')
        self.assertEqual(self.mode.gate(), 'maintenance')
        self.assertEqual(called, [])

    def test_verified_cutover_keeps_independent_manual_pause(self):
        self.opts['migration_state'].write_text(json.dumps({'status':'active','active_in_ollama':True}))
        self.mode.pause.write_text('manual pause preserved')
        self.mode.set_mode(am.ModeBody(enabled=True))
        self.assertEqual(self.mode.gate(), 'paused')
        self.assertEqual(self.mode.pause.read_text(), 'manual pause preserved')
        self.mode.pause.unlink()
        self.assertEqual(self.mode.gate(), 'ready')

    def test_explicit_verified_rollback_and_off_persist_across_restart(self):
        self.opts['migration_state'].write_text(json.dumps({'status':'rolled_back','rollback_verified':True}))
        self.mode.set_mode(am.ModeBody(enabled=False, goal='local'))
        calls = []
        self.mode.tick(lambda:calls.append(True))
        reopened = am.AutomaticMode(self.db, self.sup, **self.opts)
        self.assertFalse(reopened.settings()['enabled'])
        self.assertEqual(reopened.gate(), 'off')
        self.assertEqual(calls, [])
        reopened.set_mode(am.ModeBody(enabled=True))
        self.assertEqual(reopened.tick(lambda:'bounded pass'), 'bounded pass')

    def test_pass_counters_are_real_and_errors_propagate(self):
        self.assertEqual(self.mode.tick(lambda:17), 17)
        def bad(): raise RuntimeError('fixture failure')
        with self.assertRaises(RuntimeError): self.mode.tick(bad)
        s = self.mode.status()
        self.assertEqual(s['counters']['ticks_started'], 2)
        self.assertEqual(s['counters']['ticks_completed'], 1)
        self.assertEqual(s['counters']['ticks_failed'], 1)
        self.assertFalse(s['current_tick_running'])

    def test_cloud_routing_does_not_silently_gain_permission(self):
        self.sup.cfg['models']['openai']['enabled'] = True
        self.assertEqual(self.mode.gate(), 'cloud_configuration_requires_review')
        called = []
        self.mode.tick(lambda:called.append(True))
        self.assertEqual(called, [])

    def test_reminder_ack_snooze_stop_persist_without_verifying_connection(self):
        self.mode.reminder(am.ReminderBody(action='enable'), self.requirements)
        self.assertTrue(self.mode.status(self.requirements)['reminders']['due'])
        self.mode.reminder(am.ReminderBody(action='acknowledge'), self.requirements)
        self.assertFalse(self.mode.status(self.requirements)['reminders']['due'])
        self.assertEqual(len(self.mode.status(self.requirements)['primary_blockers']), 2)
        self.mode.reminder(am.ReminderBody(action='enable'), self.requirements)
        self.mode.reminder(am.ReminderBody(action='snooze',minutes=10), self.requirements)
        self.assertFalse(self.mode.status(self.requirements)['reminders']['due'])
        self.now += 601
        self.assertTrue(self.mode.status(self.requirements)['reminders']['due'])
        self.mode.reminder(am.ReminderBody(action='stop'), self.requirements)
        self.assertFalse(am.AutomaticMode(self.db,self.sup,**self.opts).status(self.requirements)['reminders']['enabled'])

    def test_api_requires_same_origin_action_and_register_is_idempotent(self):
        async def scenario():
            app = FastAPI(); app.state.requirements = self.requirements
            self.sup.tick = lambda:'original'
            original = am.AutomaticMode
            factory = lambda db,sup:original(db,sup,**self.opts)
            with patch.object(am,'AutomaticMode',factory):
                first = am.register(app,self.db,self.sup)
                self.assertIs(first,am.register(app,self.db,self.sup))
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,client=('127.0.0.1',1)),base_url='http://127.0.0.1:8788') as client:
                self.assertEqual((await client.post('/api/automatic-mode',json={'enabled':False})).status_code,403)
                headers={'Origin':'http://127.0.0.1:8788','X-Nexen-Action':'launch'}
                r=await client.post('/api/automatic-mode',json={'enabled':False},headers=headers)
                self.assertEqual(r.status_code,200); self.assertFalse(r.json()['enabled'])
                self.assertIsNone(self.sup.tick())
                r=await client.post('/api/automatic-mode',json={'enabled':True,'spend':50},headers=headers)
                self.assertEqual(r.status_code,422)
                self.assertEqual((await client.post('/api/automatic-mode',json={'enabled':True},headers={**headers,'Origin':'https://example.test'})).status_code,403)
                await client.post('/api/automatic-mode',json={'enabled':True},headers=headers)
                self.assertEqual(self.sup.tick(),'original')
        asyncio.run(scenario())

    def test_strict_inputs(self):
        for value in ('true', 1, None):
            with self.assertRaises(ValidationError): am.ModeBody(enabled=value)
        with self.assertRaises(ValidationError): am.ModeBody(enabled=True,goal='unknown')
        with self.assertRaises(ValidationError): am.ReminderBody(action='snooze',minutes=1)


if __name__ == '__main__': unittest.main()
