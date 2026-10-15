"""Durable, single-owner consumption of prepared local Kilo drafts only."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import re
import time
import uuid

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse
from file_census import SingleWriter
from kilo_bridge import ROOT as KILO_ROOT, MAX_RUN_SECONDS, save

BASE = Path(__file__).resolve().parent
STATE = Path('H:/NEXEN/state/continuity')
TERMINAL = {'draft_ready', 'failed', 'cancelled', 'interrupted'}
ACTIVE_WAIT_SECONDS = MAX_RUN_SECONDS + 15
SHUTDOWN_WAIT_SECONDS = ACTIVE_WAIT_SECONDS + 5


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class ContinuityWorker:
    def __init__(self, db, kilo, mode, *, state_dir=STATE, kilo_root=KILO_ROOT,
                 base=BASE, interval=10, clock=time.time):
        self.db, self.kilo, self.mode = db, kilo, mode
        self.state_dir, self.kilo_root, self.base = Path(state_dir), Path(kilo_root), Path(base)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.interval, self.clock = max(.05, interval), clock
        self.owner = uuid.uuid4().hex
        self.lease = None
        self.loop_task = None
        self.wake = asyncio.Event()
        self.stopping = False
        self.active = None
        self.last_heartbeat = None
        self.health = 'not_started'
        self.cycle_lock = asyncio.Lock()
        self.logger = logging.getLogger('nexen.continuity.' + self.owner)
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False
        handler = RotatingFileHandler(self.state_dir / 'worker.log', maxBytes=262144, backupCount=2, encoding='utf-8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
        self.logger.addHandler(handler)
        with db.connect() as c:
            c.executescript('''CREATE TABLE IF NOT EXISTS continuity_settings(
              id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL, last_error TEXT);
            CREATE TABLE IF NOT EXISTS continuity_receipts(
              job_id TEXT PRIMARY KEY, task_id INTEGER NOT NULL, owner TEXT NOT NULL,
              state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
              claimed_at TEXT NOT NULL, finished_at TEXT, result_status TEXT,
              detail TEXT NOT NULL DEFAULT '');''')
            c.execute('INSERT OR IGNORE INTO continuity_settings(id,enabled,updated_at) VALUES(1,0,?)', (timestamp(),))

    def settings(self):
        return self.db.rows('SELECT * FROM continuity_settings WHERE id=1')[0]

    def set_enabled(self, enabled):
        with self.db.connect() as c:
            c.execute('UPDATE continuity_settings SET enabled=?,updated_at=?,last_error=NULL WHERE id=1',
                      (int(enabled), timestamp()))
        self.wake.set()
        self.logger.info('mode=%s', 'enabled' if enabled else 'paused')
        return self.status()

    def gate(self):
        if not self.settings()['enabled']:
            return 'paused'
        # Read existing controls; never remove or rewrite another owner's pause marker.
        if (self.base / 'data/PAUSE_AUTONOMY').exists():
            return 'external_pause'
        if self.mode is None:
            return 'automatic_mode_unavailable'
        try:
            reason = self.mode.gate()
        except Exception:
            return 'automatic_mode_unavailable'
        return 'ready' if reason == 'ready' else 'automatic_' + str(reason)[:60]

    def update_receipt(self, ident, state, *, attempts=None, detail='', result_status=None):
        with self.db.connect() as c:
            c.execute('''UPDATE continuity_receipts SET state=?,attempts=COALESCE(?,attempts),
              detail=?,result_status=?,finished_at=? WHERE job_id=?''',
              (state, attempts, detail, result_status, None if state in {'claimed','running'} else timestamp(), ident))

    def heartbeat(self, health=None):
        if health:
            self.health = health
        self.last_heartbeat = self.clock()
        save(self.state_dir / 'status.json', {
            'schema': 'nexen.continuity.v1', 'owner': self.owner, 'health': self.health,
            'heartbeat_at': timestamp(), 'active_job': self.active,
            'enabled': bool(self.settings()['enabled']), 'singleton_owned': self.lease is not None,
            'cloud_enabled': False, 'paid_spend': 0,
        })

    async def start(self):
        if self.loop_task and not self.loop_task.done():
            return False
        lease = SingleWriter(self.state_dir)
        try:
            lease.__enter__()
        except RuntimeError:
            self.health = 'another_worker_owns_lock'
            return False
        self.lease = lease
        self.stopping = False
        self.loop_task = asyncio.create_task(self.run_loop())
        return True

    def recover_owned(self):
        """Only terminalize this feature's stale claims, after the Kilo lock is free."""
        stale = self.db.rows("SELECT * FROM continuity_receipts WHERE state IN ('claimed','running') AND owner<>?", (self.owner,))
        if not stale:
            return True
        try:
            with SingleWriter(self.kilo_root):
                for row in stale:
                    try:
                        receipt = self.kilo.get(row['job_id'])
                    except HTTPException as error:
                        if error.status_code not in {404, 409}:
                            raise
                        self.update_receipt(row['job_id'], 'interrupted',
                                            detail='Previous draft receipt is unavailable; no automatic retry.')
                        continue
                    state = receipt.get('status')
                    if state == 'running' and row['state'] == 'running' and row['attempts'] == 1:
                        receipt.update(status='interrupted', error='The continuity worker stopped during this owned draft. No automatic retry was made.')
                        self.kilo.record(receipt)
                        state = 'interrupted'
                    self.update_receipt(row['job_id'], state if state in TERMINAL else 'interrupted',
                                        result_status=state, detail='Recovered only a previous continuity claim; no retry.')
            return True
        except RuntimeError:
            return False

    def next_job(self):
        rows = self.db.rows('''SELECT j.id FROM kilo_draft_jobs j
          LEFT JOIN continuity_receipts r ON r.job_id=j.id
          WHERE j.status='prepared' AND r.job_id IS NULL ORDER BY j.created_at,j.id LIMIT 1''')
        return rows[0]['id'] if rows else None

    async def cycle(self):
        """One existing job at most. No task generation or self-reprompt path exists."""
        async with self.cycle_lock:
            if self.lease is None:
                return 'not_owner'
            if self.stopping:
                return 'stopping'
            if not self.recover_owned():
                return 'waiting_for_existing_kilo'
            reason = self.gate()
            if reason != 'ready':
                return reason
            if self.kilo.active:
                return 'waiting_for_existing_kilo'
            ident = self.next_job()
            if not ident:
                return 'waiting_for_prepared_job'
            if not re.fullmatch('[a-f0-9]{32}', ident):
                raise ValueError('Invalid prepared job identifier')
            receipt = self.kilo.get(ident)
            if receipt.get('status') != 'prepared' or receipt.get('attempts') != 0:
                with self.db.connect() as c:
                    c.execute('INSERT OR IGNORE INTO continuity_receipts(job_id,task_id,owner,state,claimed_at,detail) VALUES(?,?,?,?,?,?)',
                              (ident, receipt['task_id'], self.owner, 'skipped', timestamp(), 'Job is no longer a fresh prepared draft.'))
                return 'skipped_nonfresh_job'
            with self.db.connect() as c:
                cursor = c.execute('INSERT OR IGNORE INTO continuity_receipts(job_id,task_id,owner,state,claimed_at) VALUES(?,?,?,?,?)',
                                   (ident, receipt['task_id'], self.owner, 'claimed', timestamp()))
                if cursor.rowcount != 1:
                    return 'already_claimed'
            # Recheck durable controls immediately before asking the fixed adapter to start.
            if self.gate() != 'ready' or self.stopping:
                with self.db.connect() as c:
                    c.execute("DELETE FROM continuity_receipts WHERE job_id=? AND owner=? AND state='claimed' AND attempts=0", (ident, self.owner))
                return 'paused_before_start'
            try:
                started = await self.kilo.start(ident)
            except HTTPException as error:
                if error.status_code == 409:
                    with self.db.connect() as c:
                        c.execute("DELETE FROM continuity_receipts WHERE job_id=? AND owner=? AND state='claimed' AND attempts=0", (ident, self.owner))
                    return 'waiting_for_existing_kilo'
                self.update_receipt(ident, 'failed', detail='The Kilo adapter refused this draft; manual review is required.')
                raise
            except Exception:
                self.update_receipt(ident, 'interrupted', detail='Adapter startup did not complete; no automatic retry.')
                raise
            if started.get('status') != 'running' or self.kilo.active != ident:
                self.update_receipt(ident, 'skipped', result_status=started.get('status'), detail='The draft was claimed or completed outside this worker.')
                return 'job_changed_before_start'
            self.active = ident
            self.update_receipt(ident, 'running', attempts=1, result_status='running')
            self.logger.info('job=%s task=%s started', ident, receipt['task_id'])
            self.heartbeat('running_local_draft')
            # Kilo owns its bounded subprocess timeout and lock. Pause prevents NEXT job;
            # it does not interrupt a harmless in-progress draft or release its GPU early.
            deadline = time.monotonic() + ACTIVE_WAIT_SECONDS
            while self.kilo.active == ident:
                if time.monotonic() >= deadline:
                    self.stop_owned(ident)
                    self.update_receipt(ident, 'interrupted', attempts=1,
                                        detail='Adapter exceeded its bounded completion wait; manual review is required. No retry.')
                    self.active = None
                    return 'adapter_completion_timeout'
                await asyncio.sleep(min(1, self.interval))
                self.heartbeat('finishing_current_draft' if self.gate() != 'ready' else 'running_local_draft')
            result = self.kilo.get(ident)
            state = result.get('status')
            outcome = state if state in TERMINAL else 'interrupted'
            self.update_receipt(ident, outcome, attempts=1, result_status=state,
                                detail='Local draft recorded; original task unchanged.' if outcome == 'draft_ready' else 'Draft did not complete. It will not be retried automatically.')
            self.active = None
            self.logger.info('job=%s result=%s', ident, outcome)
            return outcome

    async def run_loop(self):
        try:
            while not self.stopping:
                try:
                    result = await self.cycle()
                    self.heartbeat(result)
                except Exception as error:
                    # A worker infrastructure fault pauses this worker persistently.
                    # Never log prompts, provider output or exception text containing data.
                    with self.db.connect() as c:
                        c.execute('UPDATE continuity_settings SET enabled=0,last_error=?,updated_at=? WHERE id=1',
                                  ('Worker fault: ' + type(error).__name__ + '. Review before resuming.', timestamp()))
                    self.logger.error('worker_fault=%s', type(error).__name__)
                    self.heartbeat('fault_paused')
                self.wake.clear()
                try:
                    await asyncio.wait_for(self.wake.wait(), timeout=self.interval)
                except asyncio.TimeoutError:
                    pass
        finally:
            self.health = 'stopped'
            if self.lease:
                self.lease.__exit__()
                self.lease = None
            self.heartbeat('stopped')

    def stop_owned(self, ident):
        """Request cancellation without letting a missing receipt prevent signalling."""
        if self.kilo.active != ident:
            return
        try:
            self.kilo.cancel(ident)
        except Exception:
            self.logger.error('shutdown_cancel_failed')
            signal = getattr(self.kilo, 'request_stop', None)
            if callable(signal):
                try:
                    signal(ident)
                except Exception:
                    self.logger.error('shutdown_signal_failed')

    async def shutdown(self):
        self.stopping = True
        self.wake.set()
        try:
            # Cancel only this worker's active Kilo job, never a manual job.
            if self.active and self.kilo.active == self.active:
                self.stop_owned(self.active)
            if self.loop_task:
                try:
                    await asyncio.wait_for(self.loop_task, timeout=SHUTDOWN_WAIT_SECONDS)
                except asyncio.TimeoutError:
                    if self.active:
                        self.update_receipt(self.active, 'interrupted',
                                            detail='Shutdown wait expired; the draft requires manual review. No automatic retry.')
                        self.active = None
                    self.logger.error('shutdown_wait_expired')
        finally:
            try:
                # The normal loop releases this already. Also cover a worker
                # with no loop or a loop which failed during its final cleanup.
                if self.lease and (self.loop_task is None or self.loop_task.done()):
                    lease, self.lease = self.lease, None
                    lease.__exit__()
            finally:
                if self.loop_task is not None and self.loop_task.done():
                    self.loop_task = None
                for handler in tuple(self.logger.handlers):
                    try:
                        handler.close()
                    finally:
                        self.logger.removeHandler(handler)

    def status(self):
        settings = self.settings()
        rows = self.db.rows('SELECT * FROM continuity_receipts ORDER BY claimed_at DESC LIMIT 20')
        counts = {row['state']: row['n'] for row in self.db.rows('SELECT state,count(*) n FROM continuity_receipts GROUP BY state')}
        waiting = self.db.rows("SELECT count(*) n FROM kilo_draft_jobs j LEFT JOIN continuity_receipts r ON r.job_id=j.id WHERE j.status='prepared' AND r.job_id IS NULL")[0]['n']
        alive = bool(self.lease and self.loop_task and not self.loop_task.done())
        return {'enabled': bool(settings['enabled']), 'worker_running': alive, 'singleton_owned': self.lease is not None,
                'health': self.health, 'gate': self.gate(), 'active_job': self.active,
                'last_heartbeat': self.last_heartbeat, 'last_error': settings['last_error'],
                'prepared_jobs_waiting': waiting, 'receipts': rows, 'counts': counts,
                'limits': {'jobs_per_cycle': 1, 'max_concurrent_kilo_jobs': 1, 'attempts_per_job': 1,
                           'automatic_retry': False, 'automatic_reprompt': False, 'automatic_paid_requests': False},
                'scope': 'Existing prepared Kilo read-only drafts. Tasks remain unchanged; drafts require review.',
                'gpu_scope': 'The Kilo adapter lock covers Kilo jobs. Unrelated model callers need separate coordination.',
                'pause_detail': 'Pause is durable and prevents the next draft. A running draft can finish; app shutdown cancels only this worker’s current draft.',
                'cloud': {'enabled': False, 'blockers': ['Provider key, fixed lifetime budget and a reviewed executor are not verified.']},
                'uptime': 'Runs while this Windows PC is awake and NEXEN is running.',
                'links': {'prepare': '/kilo', 'tasks': '/tasks', 'agents': '/agents', 'automatic': '/automatic-mode'}}


def register(app, db, kilo, mode):
    from app_lifecycle import register_lifecycle
    from pc_control import validate_request
    worker = ContinuityWorker(db, kilo, mode)
    register_lifecycle(app, startup=worker.start, shutdown=worker.shutdown)

    @app.get('/continuity', response_class=HTMLResponse)
    def page(request: Request):
        validate_request(request)
        return (BASE / 'continuity.html').read_text(encoding='utf-8')

    @app.get('/api/continuity/status')
    def status(request: Request):
        validate_request(request)
        return worker.status()

    @app.post('/api/continuity/enable')
    async def enable(request: Request):
        validate_request(request, mutation=True)
        return worker.set_enabled(True)

    @app.post('/api/continuity/pause')
    async def pause(request: Request):
        validate_request(request, mutation=True)
        return worker.set_enabled(False)

    return worker
