"""Shared prerequisite checks. Login claims never grant execution permissions."""
import json
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse
from execution_labels import requirement_class

BASE = Path(__file__).resolve().parent
CATALOG = (
    dict(id='browser-home', title='Set NEXEN as your browser startup page', state='setup_required',
         action='In Chrome, open Settings > On startup > Open a specific page, then add http://127.0.0.1:8788/. Optionally enable the Home button under Appearance with the same address.',
         url='http://127.0.0.1:8788/', blocks='Open NEXEN automatically when your browser starts',
         evidence='This browser preference needs a manual owner step; its saved setting has not been verified.', automatic_check=False),
    dict(id='supercool', title='Sign in to Supercool', state='login_required',
         action='Sign in in the Supercool tab. Then request a connection check.',
         url='https://supercool.com/login', blocks='Generate your actual-app walkthrough video',
         evidence='The Supercool tab showed its login form on September 9. No generation has been submitted.', automatic_check=False),
    dict(id='n8n', title='Finish n8n owner setup', state='setup_required',
         action='Create your local owner account, then connect a scoped NEXEN credential.',
         url='http://127.0.0.1:5678/', blocks='Run connected business workflows',
         evidence='Local n8n is installed; account and integration readiness are checked separately.', automatic_check=True),
    dict(id='amboras', title='Complete Lumipaw payment onboarding', state='setup_required',
         action='Open Amboras, choose Setup payments, and finish the provider steps as a US individual.',
         url='https://admin.amboras.com/home', blocks='Accept paid Lumipaw orders',
         evidence='Store access was observed; completed onboarding and checkout have not been verified.', automatic_check=False),
    dict(id='ads', title='Connect an advertising account', state='setup_required',
         action='Choose and connect your ad account after checkout and unit economics are verified.',
         url='/money', blocks='Launch a Lumipaw ad test',
         evidence='Your last account status was None yet. Both limits remain $50: daily and total, with no restart.', automatic_check=False),
    dict(id='phone', title='Repair private phone access', state='verification_failed',
         action='Resolve the private HTTPS certificate failure before enabling NEXEN phone access.',
         url='/problems', blocks='Access this NEXEN app from your phone',
         evidence='Strict HTTPS verification failed. NEXEN private phone access remains disabled.', automatic_check=False),
    dict(id='pc2', title='Bring PC2 back online', state='unavailable',
         action='Power on PC2 and its private connection, then verify the worker before assigning jobs.',
         url='/diagnostics', blocks='Dispatch work to PC2',
         evidence='No online, authenticated PC2 worker has been verified.', automatic_check=False),
)


def now():
    return datetime.now(timezone.utc).isoformat()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def n8n_probe():
    """Read only the public onboarding boolean; never collect credentials/settings."""
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open('http://127.0.0.1:5678/rest/settings', timeout=2) as response:
            data = json.loads(response.read(262144))
        setup = data.get('data', {}).get('userManagement', {}).get('showSetupOnFirstLoad')
        if setup is True:
            return dict(state='setup_required', evidence='n8n currently reports that initial owner setup is required.')
        if setup is False:
            return dict(state='integration_required', title='Connect n8n to NEXEN',
                        action='Sign in to n8n and configure a scoped NEXEN credential for connected business workflows.',
                        evidence='Owner setup is no longer requested. An authenticated integration has not been verified.')
        return dict(state='unverified', evidence='n8n responded without a recognized owner-setup indicator.')
    except (OSError, ValueError, AttributeError):
        return dict(state='unavailable', evidence='The local n8n setup check did not succeed. No integration is assumed ready.')


class Requirements:
    def __init__(self, db, probe=n8n_probe):
        self.db, self.probe = db, probe
        self.lock, self.cached_at, self.cached = threading.Lock(), 0, None
        with db.connect() as c:
            c.execute('''CREATE TABLE IF NOT EXISTS action_check_requests(
              provider TEXT PRIMARY KEY,requested_at TEXT NOT NULL,status TEXT NOT NULL)''')

    def status(self):
        with self.lock:
            if self.cached is None or time.monotonic()-self.cached_at >= 30:
                self.cached, self.cached_at = self.probe(), time.monotonic()
            observed = dict(self.cached)
        with self.db.connect() as c:
            requests = {r[0]: dict(requested_at=r[1], status=r[2]) for r in
                        c.execute('SELECT provider,requested_at,status FROM action_check_requests')}
        items = [dict(item, verified=False, executable=False, check_request=requests.get(item['id'])) for item in CATALOG]
        for item in items:
            if item['id'] == 'n8n':
                item.update(observed)
            # This module has no authorized provider executor or credential verifier yet.
            item['verified'] = False
            item['executable'] = False
            item.update(requirement_class(item))
        return dict(checked_at=now(), pending=items, pending_count=len(items),
                    policy='Dependent provider actions stay blocked until authentication, prerequisites and the executor are verified.',
                    coverage='n8n has a bounded local setup probe. Other entries reflect the latest recorded observations; browser logins need a new verification.',
                    voice='Read-aloud uses an installed local English voice after you enable it. A British voice is preferred when available; no phone-call provider is connected.')

    def require_connection(self, name):
        item = next((x for x in self.status()['pending'] if x['id'] == name), None)
        if item is None:
            raise HTTPException(404, 'Unknown connection')
        raise HTTPException(409, dict(code='connection_required', connection=name,
                                     message=item['action'], url=item['url'], executed=False))

    def request_check(self, name):
        if name not in {x['id'] for x in CATALOG}:
            raise HTTPException(404, 'Unknown connection')
        with self.db.connect() as c:
            c.execute('''INSERT INTO action_check_requests VALUES(?,?,'requested')
                         ON CONFLICT(provider) DO UPDATE SET requested_at=excluded.requested_at,status='requested' ''', (name, now()))
        with self.lock:
            self.cached_at = 0
        return dict(status='check_requested', connection=name, executed=False,
                    message='Connection check requested. This does not unlock an action or prove that login succeeded.')


def register(app, db):
    requirements = Requirements(db)

    @app.get('/connections', response_class=HTMLResponse)
    def connections():
        return (BASE/'connections.html').read_text(encoding='utf-8')

    @app.get('/api/action-required')
    def status():
        return requirements.status()

    @app.post('/api/action-required/{name}/check')
    def check(name: str, request: Request):
        from pc_control import validate_request
        validate_request(request, mutation=True)
        return requirements.request_check(name)

    @app.post('/api/action-required/{name}/run')
    def run(name: str, request: Request):
        from pc_control import validate_request
        validate_request(request, mutation=True)
        return requirements.require_connection(name)

    return requirements
