"""Persistent intent for the existing bounded local supervisor, never source execution."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
import time

from fastapi import Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

BASE = Path(__file__).resolve().parent
MIGRATION_STATE = Path('H:/NEXEN/state/ollama-migration.json')
MIGRATION_PAUSES = Path('H:/NEXEN/state/migration-pause-state.json')
GOALS = {'lumipaw': ('amboras', 'ads'), 'local': (), 'walkthrough': ('supercool',),
         'phone': ('phone',), 'pc2': ('pc2',)}


class ModeBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: bool = Field(strict=True)
    goal: Literal[tuple(GOALS)] | None = None


class ReminderBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['enable', 'stop', 'acknowledge', 'snooze']
    minutes: int = Field(default=10, ge=10, le=240, strict=True)


class AutomaticMode:
    def __init__(self, db, sup, *, base=BASE, migration_state=MIGRATION_STATE,
                 migration_pauses=MIGRATION_PAUSES, clock=time.time, running=None):
        self.db, self.sup, self.base = db, sup, Path(base)
        self.migration_state, self.migration_pauses = Path(migration_state), Path(migration_pauses)
        self.pause = self.base / 'data/PAUSE_AUTONOMY'
        self.clock = clock
        self.running = running or (lambda: any(t.name == 'nexen-supervisor' and t.is_alive() for t in threading.enumerate()))
        self.lock = threading.RLock()
        self.busy = False
        with db.connect() as c:
            c.executescript('''CREATE TABLE IF NOT EXISTS automatic_mode_state(
              id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL,goal TEXT NOT NULL,
              changed_at REAL NOT NULL,ticks_started INTEGER NOT NULL DEFAULT 0,
              ticks_completed INTEGER NOT NULL DEFAULT 0,ticks_failed INTEGER NOT NULL DEFAULT 0,
              ticks_deferred INTEGER NOT NULL DEFAULT 0,last_started REAL,last_finished REAL,
              reminders_enabled INTEGER NOT NULL DEFAULT 0,snoozed_until REAL NOT NULL DEFAULT 0,
              acknowledged_fingerprint TEXT NOT NULL DEFAULT '');''')
            # The user already explicitly requested persistent 24/7 local work.
            c.execute("INSERT OR IGNORE INTO automatic_mode_state(id,enabled,goal,changed_at) VALUES(1,1,'lumipaw',?)", (clock(),))

    def settings(self):
        with self.db.connect() as c:
            c.row_factory = sqlite3.Row
            return dict(c.execute('SELECT * FROM automatic_mode_state WHERE id=1').fetchone())

    def maintenance(self):
        if not self.migration_state.exists() and not self.migration_pauses.exists():
            return {'active': False, 'state': 'none', 'detail': 'No model migration maintenance is recorded.'}
        try:
            data = json.loads(self.migration_state.read_text(encoding='utf-8-sig'))
            state = data.get('status', 'unverified')
            verified = state in {'active', 'activation_verified'} and (data.get('activation_verified') is True or data.get('active_in_ollama') is True)
            rollback = state == 'rolled_back' and data.get('rollback_verified') is True
            active = not (verified or rollback)
        except (OSError, ValueError, AttributeError):
            active, state = True, 'unverified'
        return {'active': active, 'state': str(state)[:60],
                'detail': 'Model migration must finish verified activation or verified rollback before local analysis resumes.' if active else 'Model cutover or rollback is recorded as verified; remaining pause markers still apply.'}

    def gate(self):
        cfg = getattr(self.sup, 'cfg', {}).get('models', {})
        if any(cfg.get(name, {}).get('enabled') for name in ('openai', 'anthropic')):
            return 'cloud_configuration_requires_review'
        if not self.settings()['enabled']:
            return 'off'
        if self.maintenance()['active']:
            return 'maintenance'
        if self.pause.exists():
            return 'paused'
        return 'ready'

    def set_mode(self, body):
        # Never remove a generic pause marker: it may belong to a user or migration.
        # The scoped tick guard enforces Off without creating ambiguous file ownership.
        with self.lock, self.db.connect() as c:
            c.execute('UPDATE automatic_mode_state SET enabled=?,goal=COALESCE(?,goal),changed_at=? WHERE id=1',
                      (int(body.enabled), body.goal, self.clock()))

    def tick(self, original):
        reason = self.gate()
        if reason != 'ready':
            with self.db.connect() as c:
                c.execute('UPDATE automatic_mode_state SET ticks_deferred=ticks_deferred+1 WHERE id=1')
            return
        with self.lock:
            self.busy = True
        with self.db.connect() as c:
            c.execute('UPDATE automatic_mode_state SET ticks_started=ticks_started+1,last_started=? WHERE id=1', (self.clock(),))
        try:
            value = original()
        except Exception:
            with self.db.connect() as c:
                c.execute('UPDATE automatic_mode_state SET ticks_failed=ticks_failed+1,last_finished=? WHERE id=1', (self.clock(),))
            raise
        else:
            with self.db.connect() as c:
                c.execute('UPDATE automatic_mode_state SET ticks_completed=ticks_completed+1,last_finished=? WHERE id=1', (self.clock(),))
            return value
        finally:
            with self.lock:
                self.busy = False

    def status(self, requirements=None):
        s = self.settings()
        observed = requirements.status() if requirements is not None else {'pending': []}
        chosen = GOALS.get(s['goal'], ())
        pending = [item for ident in chosen for item in observed.get('pending', []) if item.get('id') == ident and not item.get('verified')]
        fingerprint = hashlib.sha256(json.dumps([(x.get('id'), x.get('state'), x.get('action')) for x in pending], sort_keys=True).encode()).hexdigest()
        gate, alive, busy = self.gate(), bool(self.running()), self.busy
        if gate != 'ready':
            state = gate
        elif not alive:
            state = 'supervisor_unavailable'
        elif busy:
            state = 'running_local_work'
        elif pending:
            state = 'waiting_for_login_or_setup'
        else:
            state = 'local_work_ready'
        labels = {'off': 'Automatic Mode is off', 'maintenance': 'Waiting for model maintenance',
                  'paused': 'Local work is manually or externally paused',
                  'cloud_configuration_requires_review': 'Cloud routing needs a separate review',
                  'supervisor_unavailable': 'Supervisor is not running', 'running_local_work': 'Running local work',
                  'waiting_for_login_or_setup': 'Waiting for login or setup for your selected goal',
                  'local_work_ready': 'Local work is ready for its next scheduled pass'}
        return {'enabled': bool(s['enabled']), 'goal': s['goal'], 'state': state, 'label': labels[state],
                'local_work_permitted': gate == 'ready', 'supervisor_running': alive,
                'current_tick_running': busy, 'stop_takes_effect_before_next_pass': True,
                'stop_detail': 'Off prevents the next supervisor pass. A pass already running can finish. The existing local pause control can also stop between tasks.',
                'maintenance': self.maintenance(), 'pause_marker_present': self.pause.exists(),
                'primary_blockers': pending, 'other_connections': [x for x in observed.get('pending', []) if x.get('id') not in chosen],
                'requirements_coverage': observed.get('coverage', 'Connection checks have not been attached yet.'),
                'counters': {k: s[k] for k in ('ticks_started', 'ticks_completed', 'ticks_failed', 'ticks_deferred', 'last_started', 'last_finished')},
                'counter_scope': 'Supervisor passes since this feature was installed; not completed tasks, revenue, or total project completion.',
                'available_local_work': ['Bounded source indexing', 'Local analysis queue', 'Installed-tool discovery', 'Draft workflow compilation', 'Local daily brief'],
                'unavailable_execution': ['Provider ad launch or payment', 'Unrestricted multi-app PC control', 'Shutdown-time processing'],
                'money_limits': {'daily_cap_cents': 5000, 'total_cap_cents': 5000, 'auto_restart': False, 'spending_enabled': False},
                'reminders': {'enabled': bool(s['reminders_enabled']), 'repeat_seconds': 600,
                              'snoozed_until': s['snoozed_until'], 'acknowledged': s['acknowledged_fingerprint'] == fingerprint,
                              'due': bool(pending) and bool(s['reminders_enabled']) and s['snoozed_until'] <= self.clock() and s['acknowledged_fingerprint'] != fingerprint,
                              'delivery': 'Open page and a user-enabled installed local browser voice; no phone call or background voice claim.'},
                'uptime': 'This PC must remain awake, and the NEXEN watchdog must remain running.'}

    def reminder(self, body, requirements=None):
        status = self.status(requirements)
        fingerprint = hashlib.sha256(json.dumps([(x.get('id'), x.get('state'), x.get('action')) for x in status['primary_blockers']], sort_keys=True).encode()).hexdigest()
        with self.db.connect() as c:
            if body.action == 'enable':
                c.execute("UPDATE automatic_mode_state SET reminders_enabled=1,acknowledged_fingerprint='',snoozed_until=0 WHERE id=1")
            elif body.action == 'stop':
                c.execute('UPDATE automatic_mode_state SET reminders_enabled=0 WHERE id=1')
            elif body.action == 'acknowledge':
                c.execute('UPDATE automatic_mode_state SET acknowledged_fingerprint=? WHERE id=1', (fingerprint,))
            else:
                c.execute('UPDATE automatic_mode_state SET snoozed_until=? WHERE id=1', (self.clock() + body.minutes * 60,))


def register(app, db, sup):
    if getattr(sup, '_nexen_automatic_mode', None) is not None:
        return sup._nexen_automatic_mode
    mode = AutomaticMode(db, sup)
    original_tick = sup.tick
    sup.tick = lambda: mode.tick(original_tick)
    sup._nexen_automatic_mode = mode

    def requirements():
        return getattr(app.state, 'requirements', None)

    @app.get('/automatic-mode', response_class=HTMLResponse)
    def page():
        return (BASE / 'automatic-mode.html').read_text(encoding='utf-8')

    @app.get('/api/automatic-mode')
    def status():
        return mode.status(requirements())

    @app.post('/api/automatic-mode')
    def update(body: ModeBody, request: Request):
        from pc_control import validate_request
        validate_request(request, mutation=True)
        mode.set_mode(body)
        return mode.status(requirements())

    @app.post('/api/automatic-mode/reminders')
    def reminder(body: ReminderBody, request: Request):
        from pc_control import validate_request
        validate_request(request, mutation=True)
        mode.reminder(body, requirements())
        return mode.status(requirements())

    return mode
