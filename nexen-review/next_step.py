"""One selected NEXEN task, explicit user completion and code-owned destinations.

This module never runs task text, submits provider work or marks other tasks done.
The video on /next is a browser-local captioned plan, not a recorded app session.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading
from typing import Literal
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from storage_policy import StoragePolicyError, require_output_path
from task_tracking import Tracker, TaskUpdate, now

BASE = Path(__file__).resolve().parent
VIDEO_ROOT = Path('H:/NEXEN/videos/next')
MAX_VIDEO_BYTES = 64 * 1024 * 1024
VIDEO_ID = re.compile(r'^[a-f0-9]{64}$')


def validate_webm(data):
    """Check bounded EBML/DocType/Segment headers; this does not decode frames."""
    def vint(offset, *, identifier=False):
        if offset >= len(data) or data[offset] == 0:
            raise ValueError('Missing EBML integer')
        first = data[offset]
        width = 9 - first.bit_length()
        if width > (4 if identifier else 8) or offset + width > len(data):
            raise ValueError('Truncated EBML integer')
        value = int.from_bytes(data[offset:offset + width], 'big')
        if not identifier:
            value &= (1 << (7 * width)) - 1
        return value, offset + width, width

    try:
        if data[:4] != b'\x1aE\xdf\xa3':
            raise ValueError('Missing EBML header')
        size, start, width = vint(4)
        end = start + size
        if size == (1 << (7 * width)) - 1 or not 1 <= size <= 4096 or end > len(data):
            raise ValueError('Invalid EBML header size')
        cursor, doctype = start, None
        while cursor < end:
            element, cursor, _ = vint(cursor, identifier=True)
            length, cursor, _ = vint(cursor)
            if cursor + length > end:
                raise ValueError('Truncated EBML element')
            if element == 0x4282:
                if doctype is not None:
                    raise ValueError('Duplicate document type')
                doctype = data[cursor:cursor + length]
            cursor += length
        if doctype != b'webm' or data[end:end + 4] != b'\x18S\x80g':
            raise ValueError('Not a WebM segment')
        size, payload, width = vint(end + 4)
        unknown = size == (1 << (7 * width)) - 1
        if payload >= len(data) or (not unknown and (size == 0 or payload + size != len(data))):
            raise ValueError('Empty or truncated WebM segment')
    except ValueError:
        raise HTTPException(415, 'The file is not a supported WebM video header. Generate the video on this page before saving.') from None


async def read_video_upload(request):
    """Read raw bytes with a declared-length check, stream cap and deadline."""
    for name in ('content-type', 'content-length', 'content-encoding'):
        if len(request.headers.getlist(name)) > 1:
            raise HTTPException(400, 'Duplicate upload headers are not supported.')
    declared = request.headers.get('content-type', '')
    if len(declared) > 150 or declared.split(';', 1)[0].strip().lower() != 'video/webm':
        raise HTTPException(415, 'Save the raw generated WebM video with Content-Type video/webm.')
    if request.headers.get('content-encoding', 'identity').lower() != 'identity':
        raise HTTPException(415, 'Compressed upload bodies are not supported.')
    length = request.headers.get('content-length')
    expected = None
    if length is not None:
        if not re.fullmatch(r'[0-9]{1,12}', length):
            raise HTTPException(400, 'Invalid video upload length.')
        expected = int(length)
        if expected > MAX_VIDEO_BYTES:
            raise HTTPException(413, 'Next-step videos must be 64 MiB or smaller.')
    data = bytearray()
    try:
        async with asyncio.timeout(45):
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_VIDEO_BYTES:
                    raise HTTPException(413, 'Next-step videos must be 64 MiB or smaller.')
                data.extend(chunk)
    except TimeoutError:
        raise HTTPException(408, 'Video upload timed out. No video was saved.') from None
    if not data or (expected is not None and len(data) != expected):
        raise HTTPException(400, 'The video is empty or its upload length does not match.')
    return bytes(data)


class NextVideos:
    """NEXEN-owned H/F storage; opaque content IDs never accept caller paths."""
    def __init__(self, root=None):
        self.root = require_output_path(root if root is not None else VIDEO_ROOT)
        self.lock = threading.Lock()

    def path(self, video_id, suffix='.webm'):
        if not VIDEO_ID.fullmatch(str(video_id)):
            raise HTTPException(404, 'Saved video not found.')
        return require_output_path(self.root / (video_id + suffix), within=self.root)

    def atomic_write(self, path, data):
        path = require_output_path(path, within=self.root)
        fd, temporary = tempfile.mkstemp(prefix='.next-video-', suffix='.tmp', dir=self.root)
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(data)
                out.flush()
                os.fsync(out.fileno())
            require_output_path(temporary, within=self.root)
            require_output_path(path, within=self.root)
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def put(self, data, task_id):
        if len(data) > MAX_VIDEO_BYTES:
            raise HTTPException(413, 'Next-step videos must be 64 MiB or smaller.')
        validate_webm(data)
        video_id = hashlib.sha256(data).hexdigest()
        with self.lock:
            root = require_output_path(self.root)
            root.mkdir(parents=True, exist_ok=True)
            path = self.path(video_id)
            duplicate = path.exists()
            if duplicate:
                if not path.is_file() or path.stat().st_size != len(data) or hashlib.sha256(path.read_bytes()).hexdigest() != video_id:
                    raise HTTPException(409, 'The saved video integrity check failed. No existing file was overwritten.')
            else:
                self.atomic_write(path, data)
            receipt_path = self.path(video_id, '.json')
            if receipt_path.exists():
                receipt = self.receipt(video_id)
            else:
                receipt = dict(id=video_id, sha256=video_id, task_id=task_id, bytes=len(data),
                               mime='video/webm', saved_at=now(), path=str(path), saved=True,
                               video_url='/api/next/videos/' + video_id,
                               receipt_url='/api/next/videos/' + video_id + '/receipt',
                               kind='captioned_task_plan', actual_app_recording=False,
                               validation='WebM header and stored byte hash checked; playback is checked in your browser.',
                               external_upload=False)
                self.atomic_write(receipt_path, json.dumps(receipt, ensure_ascii=False, indent=2).encode('utf-8'))
        return dict(video=receipt, duplicate=duplicate)

    def receipt(self, video_id):
        path = self.path(video_id, '.json')
        try:
            if path.stat().st_size > 8192:
                raise ValueError('Oversized receipt')
            receipt = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(receipt, dict) or receipt.get('id') != video_id or receipt.get('sha256') != video_id:
                raise ValueError('Invalid receipt')
            # Construct served paths from the code-owned root, never receipt text.
            receipt['path'] = str(self.path(video_id))
            receipt['video_url'] = '/api/next/videos/' + video_id
            receipt['receipt_url'] = receipt['video_url'] + '/receipt'
            return receipt
        except FileNotFoundError:
            raise HTTPException(404, 'Saved video receipt not found.') from None
        except (ValueError, TypeError):
            raise HTTPException(409, 'The saved video receipt needs review.') from None

    def file(self, video_id):
        receipt = self.receipt(video_id)
        path = self.path(video_id)
        if not path.is_file():
            raise HTTPException(404, 'Saved video file not found.')
        if not 0 < path.stat().st_size <= MAX_VIDEO_BYTES or path.stat().st_size != receipt.get('bytes'):
            raise HTTPException(409, 'The saved video size no longer matches its receipt.')
        return path

# Only these developer-owned mappings can resolve a task to a workspace. Neither
# its imported title nor next_step may introduce a URL, shell command or adapter.
WORKSPACES = {
    'daily': '/day', 'discord': '/', 'track-all': '/tasks',
    'completion-memory': '/tasks', 'gui-blockers': '/connections',
    'photo-vision-jarvis': '/problems', 'photos-life': '/problems',
    'photo-memories': '/problems', 'local-lab': '/lab',
    'music-catalog': '/lab', 'music-releases': '/lab', 'music-social': '/plans',
    'music-batch-stems': '/music-render',
    'strict-output-hf': '/storage',
    'wdr-world': '/game', 'wdr-avatar': '/game', 'wdr-cars': '/game',
    'wdr-factory': '/game', 'wdr-music': '/game', 'wdr-store': '/lookbook',
    'wdr-tv': '/game', 'shared-game-pc-actions': '/game',
    'memory-all': '/plans', 'source-conflicts': '/plans', 'f-scan': '/plans',
    'named-folders-ideas': '/plans', 'archives': '/plans',
    'education': '/guide', 'hermes-openclaw-guide': '/guide',
    'automation-ranking': '/money', 'store-supplier': '/money',
    'ad-cap': '/money', 'backlog-audit': '/plans',
    'handoff': '/api/hub/document/handoff', 'learning-links': '/plans',
}
PROVIDERS = {
    'n8n': ('n8n',), 'n8n-flows': ('n8n',), 'pc2': ('pc2',),
    'store-payment': ('amboras',), 'store-domain': ('amboras',),
    'store-v2': ('amboras',), 'ad-account': ('ads',),
    'ad-video': ('supercool',), 'walkthrough': ('supercool',),
    'ad-launch': ('amboras', 'ads'), 'mobile-private': ('phone',),
    'phone-encrypted': ('phone',),
}


class ActionBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: Literal['click', 'voice'] = 'click'


class CompletionBody(ActionBody):
    outcome: str = Field(default='', max_length=4000)


class SelectionBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    task_id: int = Field(gt=0, strict=True)


class NextSteps:
    def __init__(self, db, requirements=None, seeds=None):
        self.db, self.tracker, self.requirements = db, Tracker(db), requirements
        self.seeds = {}
        path = Path(seeds) if seeds is not None else BASE/'data'/'task-seeds.json'
        try:
            if path.stat().st_size <= 2*1024*1024:
                payload = json.loads(path.read_text(encoding='utf-8-sig'))
                tasks = payload.get('tasks', []) if isinstance(payload, dict) else []
                tasks = tasks if isinstance(tasks, list) else []
                self.seeds = {x['key']: x for x in tasks
                              if isinstance(x, dict) and isinstance(x.get('key'), str)}
        except (OSError, ValueError, TypeError):
            pass
        with db.connect() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS next_selection(
              slot INTEGER PRIMARY KEY CHECK(slot=1),task_id INTEGER NOT NULL,updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS next_completion_claims(
              task_id INTEGER NOT NULL,baseline_history INTEGER NOT NULL,
              state TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL,
              PRIMARY KEY(task_id,baseline_history));
            ''')

    def seed_key(self, task_id):
        return self.db.scalar('SELECT seed_key FROM task_details WHERE request_id=?', (task_id,)) or ''

    def task(self, task_id):
        item = self.tracker.get(task_id)
        key = self.seed_key(task_id)
        seed = self.seeds.get(key, {})
        urls = seed.get('source_urls', [])
        item['provenance'] = {
            'basis': 'task_seed' if seed else 'saved_task_and_history',
            'source': str(seed.get('source') or 'Saved local task; review its recorded history.'),
            'source_urls': [u for u in urls[:10] if isinstance(u, str)
                            and urlsplit(u).scheme == 'https'] if isinstance(urls, list) else [],
            'checked_date': seed.get('checked_date'), 'seed_key': key or None,
            'next_step_basis': 'Current saved task instruction; provider execution and results are checked separately.',
        }
        return item

    def select(self, task_id):
        self.tracker.get(task_id)
        with self.db.connect() as c:
            c.execute('''INSERT INTO next_selection VALUES(1,?,?) ON CONFLICT(slot)
                         DO UPDATE SET task_id=excluded.task_id,updated_at=excluded.updated_at''', (task_id, now()))
        return self.packet(task_id)

    def packet(self, task_id=None):
        # Housing is first in the choices and is the initial choice. A deliberate
        # selection stays selected even after completion until the user changes it.
        listing = self.tracker.list(include_done=False, limit=500)
        rows = listing['tasks']
        rent = self.db.scalar("SELECT r.id FROM task_details d JOIN hub_requests r ON r.id=d.request_id WHERE d.seed_key='rent' AND r.status!='done'")
        if rent is not None:
            if not any(t['id'] == rent for t in rows):
                rows.insert(0, self.tracker.get(rent))
            rows.sort(key=lambda t: t['id'] != rent)
        persisted = self.db.scalar('SELECT task_id FROM next_selection WHERE slot=1')
        chosen = task_id if task_id is not None else persisted
        if chosen is None:
            chosen = rows[0]['id'] if rows else None
        selected = None
        if chosen is not None:
            try:
                selected = self.task(chosen)
            except HTTPException:
                if task_id is not None:
                    raise
                selected = self.task(rows[0]['id']) if rows else None
        if selected and not any(t['id'] == selected['id'] for t in rows):
            rows.append({k: v for k, v in selected.items() if k not in ('history', 'provenance')})
        return dict(selected_task=selected, tasks=rows, total_open=listing['total'],
                    choices_truncated=listing['total'] > 500,
                    selection_persisted=bool(selected and selected['id'] == persisted),
                    action=self.action(selected) if selected else None,
                    coverage='Up to 500 open tasks, the housing priority and your selected task. See Tasks for the complete history.',
                    executed=False)

    def action(self, task):
        if task is None:
            raise HTTPException(404, 'Select an existing task first')
        base = dict(task_id=task['id'], executed=False, blockers=[], url=None)
        if task['status'] == 'done':
            return dict(base, status='completed', message='COMPLETED was recorded from your report. Reopen this same task in Task room if more work is needed.', url='/tasks')
        key = self.seed_key(task['id'])
        if key == 'rent' or key.startswith('rent-'):
            return dict(base, status='needs_human', url='/api/hub/document/rent',
                        message='Open the verified assistance guide, review the notice and make the actual contact. Record the outcome on this task; no call or payment is implied.')
        dependencies = PROVIDERS.get(key, ())
        if dependencies:
            try:
                provider = self.requirements() if callable(self.requirements) else self.requirements
                status = provider.status() if provider else {}
                observed = {i['id']: i for i in status.get('pending', []) if isinstance(i, dict) and 'id' in i}
            except Exception:
                observed = {}
            blockers = []
            for name in dependencies:
                record = observed.get(name)
                if not record or not (record.get('verified') is True and record.get('executable') is True):
                    blockers.append(dict(provider=name, state=record.get('state', 'unverified') if record else 'unverified',
                                         message=record.get('action', 'Verify the connection and executor in Connections.') if record else 'Connection status is unavailable. Verify it before proceeding.',
                                         evidence=record.get('evidence', '') if record else 'No verified readiness observation is available.'))
            if blockers:
                return dict(base, status='blocked', url='/connections', blockers=blockers,
                            message='This provider action is blocked. Finish the listed setup or login steps and verify the connection.')
            return dict(base, status='needs_adapter', url='/connections',
                        message='Connections report ready, but this page has no verified executor for that action. Nothing was submitted.')
        if task['status'] == 'blocked':
            return dict(base, status='blocked', url='/tasks',
                        message='This task is marked blocked. Review its next step and record what resolves the blocker before continuing.')
        if key in WORKSPACES:
            return dict(base, status='workspace_ready', url=WORKSPACES[key],
                        message='Open the connected NEXEN workspace to take the next step. Opening it does not complete this task or run a workflow.')
        return dict(base, status='needs_adapter', url='/tasks',
                    message='No verified task-specific executor is attached. Review the task in Task room or use Photo problem to clarify the next step.')

    def complete(self, task_id, body):
        # A durable claim excludes simultaneous/replayed completion requests. Its
        # history revision permits a fresh completion after an explicit reopen.
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT status FROM hub_requests WHERE id=?', (task_id,)).fetchone()
            if not row:
                raise HTTPException(404, 'Task not found')
            c.execute('''INSERT INTO next_selection VALUES(1,?,?) ON CONFLICT(slot)
                         DO UPDATE SET task_id=excluded.task_id,updated_at=excluded.updated_at''', (task_id, now()))
            revision = c.execute('SELECT coalesce(max(id),0) FROM task_history WHERE request_id=?', (task_id,)).fetchone()[0]
            already_done = row[0] == 'done'
            claimed = False
            if not already_done:
                claimed = c.execute("INSERT OR IGNORE INTO next_completion_claims VALUES(?,?,'started',?,?)",
                                    (task_id, revision, body.source, now())).rowcount == 1
        if already_done or not claimed:
            task = self.task(task_id)
            return dict(task=task, changed=False, celebrate=False, executed=False,
                        completion_basis='user_reported', action=self.action(task),
                        status='already_completed' if task['status'] == 'done' else 'completion_pending',
                        message='This task is already COMPLETED.' if task['status'] == 'done' else
                        'A completion request is already in progress or awaiting reconciliation. Refresh this task; no duplicate completion was submitted.')
        outcome = 'User reported via '+body.source+': '+(body.outcome.strip() or 'Marked this selected task COMPLETED.')
        try:
            self.tracker.update(task_id, TaskUpdate(status='done', outcome=outcome[:4000]))
        except Exception:
            # If history committed but its vault mirror failed, the completion is
            # still real. Otherwise permit an explicit later retry, never auto-run.
            if self.tracker.get(task_id)['status'] != 'done':
                with self.db.connect() as c:
                    c.execute('DELETE FROM next_completion_claims WHERE task_id=? AND baseline_history=?', (task_id, revision))
                raise
        with self.db.connect() as c:
            c.execute("UPDATE next_completion_claims SET state='completed' WHERE task_id=? AND baseline_history=?", (task_id, revision))
        task = self.task(task_id)
        return dict(task=task, changed=True, celebrate=True, executed=False,
                    completion_basis='user_reported', action=self.action(task), status='completed',
                    message='COMPLETED saved to this task and its local completion history. This records your report, not independent verification of an external result.')


def register(app, db):
    from pc_control import validate_request
    flow = NextSteps(db, requirements=lambda: getattr(app.state, 'requirements', None))
    videos = NextVideos()

    def response(value):
        return JSONResponse(value, headers={'Cache-Control': 'no-store'})

    @app.get('/next', response_class=HTMLResponse)
    def page(request: Request):
        validate_request(request)
        return HTMLResponse((BASE/'next.html').read_text(encoding='utf-8'), headers={'Cache-Control': 'no-store'})

    @app.get('/api/next')
    def listing(request: Request, task_id: int | None = None):
        validate_request(request)
        return response(flow.packet(task_id))

    @app.post('/api/next/select')
    def select(body: SelectionBody, request: Request):
        validate_request(request, mutation=True)
        return response(flow.select(body.task_id))

    @app.post('/api/next/{task_id}/complete')
    def complete(task_id: int, body: CompletionBody, request: Request):
        validate_request(request, mutation=True)
        return response(flow.complete(task_id, body))

    @app.post('/api/next/{task_id}/do')
    def do(task_id: int, body: ActionBody, request: Request):
        validate_request(request, mutation=True)
        return response(flow.action(flow.task(task_id)))

    @app.post('/api/next/{task_id}/video')
    async def save_video(task_id: int, request: Request):
        validate_request(request, mutation=True)
        # A real saved task is required, but a video never completes that task.
        flow.tracker.get(task_id)
        data = await read_video_upload(request)
        try:
            result = await run_in_threadpool(videos.put, data, task_id)
        except (OSError, StoragePolicyError):
            raise HTTPException(503, 'The approved H/F video folder is unavailable. No fallback drive was used; you can retry this same video.') from None
        return response(result)

    @app.get('/api/next/videos/{video_id}')
    def saved_video(video_id: str, request: Request):
        validate_request(request)
        try:
            path = videos.file(video_id)
        except (OSError, StoragePolicyError):
            raise HTTPException(503, 'The approved H/F video folder is unavailable.') from None
        return FileResponse(path, media_type='video/webm', headers={
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': 'inline', 'Cross-Origin-Resource-Policy': 'same-origin'})

    @app.get('/api/next/videos/{video_id}/receipt')
    def video_receipt(video_id: str, request: Request):
        validate_request(request)
        try:
            videos.file(video_id)
            value = videos.receipt(video_id)
        except (OSError, StoragePolicyError):
            raise HTTPException(503, 'The approved H/F video folder is unavailable.') from None
        return response(value)

    return flow
