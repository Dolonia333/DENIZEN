"""Business tracks over canonical NEXEN tasks; no provider or execution adapter.

Only saved user links and exact, code-owned seed keys classify a task. Imported
text never selects an action. Creation writes the existing task tables and its
track/receipt in one transaction; all subsequent edits use the shared Tracker.
"""
from datetime import date
import hashlib
import json
import uuid

from fastapi import HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from task_tracking import TaskCreate, Tracker, now


TRACKS = (
    dict(id='housing', title='Housing & immediate needs', kind='needs', pool='life',
         description='Essential obligations and support follow-ups. These are needs, not income.'),
    dict(id='lumipaw', title='Lumipaw', kind='business', pool='commerce',
         description='Product evidence, store, checkout, ad drafts and a bounded first test.'),
    dict(id='wdr', title='WDR brand & world', kind='business', pool='game',
         description='Brand, offers, visual assets and the WDR world; revenue remains unverified.'),
    dict(id='music', title='Music & releases', kind='business', pool='music',
         description='Catalog, release assets, distribution and reviewed social content.'),
    dict(id='nexen-product', title='NEXEN product & systems', kind='product', pool='engineering',
         description='The program, workflows and infrastructure supporting your plans.'),
    dict(id='other', title='Other money plans', kind='research', pool='commerce',
         description='Additional opportunities and research. Add or attach a concrete next action.'),
)
TRACK_BY_ID = {row['id']: row for row in TRACKS}
SEED_GROUPS = {
    'housing': ('rent', 'rent-calls', 'rent-agency-211info', 'rent-agency-our-just-future',
                'rent-agency-sei', 'rent-agency-el-programa-hispano', 'rent-agency-irco',
                'rent-agency-svdp-portland', 'rent-legal-screen'),
    'lumipaw': ('store-supplier', 'store-domain', 'store-payment', 'store-v2', 'ad-account',
                'ad-cap', 'ad-video', 'ad-launch'),
    'wdr': ('wdr-world', 'wdr-avatar', 'wdr-cars', 'wdr-store', 'wdr-factory', 'wdr-music', 'wdr-tv'),
    'music': ('music-catalog', 'music-releases', 'music-social', 'music-tools', 'music-batch-stems', 'discord'),
    'nexen-product': ('n8n', 'n8n-flows', 'claude', 'omniroute', 'fallback', 'pc2', 'openclaw',
        'deepseek', 'crush', 'blackbox', 'coderabbit', 'memory-all', 'memory-obsidian',
        'source-conflicts', 'f-scan', 'archives', 'videos-notes', 'skills-photo', 'models',
        'screenpipe', 'hermes-openclaw-guide', 'telegram', 'discord-approvals', 'pc-control',
        'autonomy', 'global-exit', 'f-migration', 'storage', 'popups', 'pc-performance',
        'vm-reinstall', 'local-lab', 'gui-blockers', 'track-all', 'public-product', 'exe',
        'walkthrough', 'handoff', 'backlog-audit', 'codebunny', 'learning-links',
        'nexen-password', 'phone-encrypted', 'photo-vision-jarvis', 'mobile-private',
        'phone-escalation', 'named-folders-ideas', 'taskbar-logo', 'shared-game-pc-actions',
        'completion-memory', 'models-h-migration', 'kb-versioned-review',
        'skills-earned-progress', 'voice-evidence-action-chain'),
    'other': ('automation-ranking', 'investment-evidence-readiness'),
}
SEED_TRACKS = {seed: track for track, seeds in SEED_GROUPS.items() for seed in seeds}
OPPORTUNITY_SEEDS = {'lumipaw': 'lumipaw', 'wdr-brand': 'wdr', 'music-release': 'music'}


class TrackBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    track_id: str = Field(min_length=1, max_length=64, pattern=r'^[a-z0-9-]+$')


class WorkspaceTaskBody(TaskCreate):
    track_id: str = Field(min_length=1, max_length=64, pattern=r'^[a-z0-9-]+$')
    request_key: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')


def dict_rows(cursor):
    """Support the app DB and tuple-row fixture connections alike."""
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


class MoneyWorkspace:
    def __init__(self, db, engine):
        self.db, self.engine = db, engine
        self.tracker = Tracker(db)
        with db.connect() as c:
            c.executescript('''
                CREATE TABLE IF NOT EXISTS money_task_tracks(
                  task_id INTEGER PRIMARY KEY REFERENCES hub_requests(id),
                  track_id TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS money_task_creation_receipts(
                  request_key TEXT PRIMARY KEY, body_sha256 TEXT NOT NULL,
                  task_id INTEGER NOT NULL REFERENCES hub_requests(id),created_at TEXT NOT NULL);
            ''')

    def catalog(self):
        """Every existing opportunity is represented, including user additions."""
        opportunities = self.engine.opportunities()
        with self.db.connect() as c:
            seeds = {row[0]: row[1] for row in c.execute('SELECT id,seed_key FROM money_opportunities')}
        tracks = {row['id']: dict(row, opportunity_ids=[]) for row in TRACKS}
        aliases = {}
        for item in opportunities:
            alias = 'opportunity-' + str(item['id'])
            track_id = OPPORTUNITY_SEEDS.get(seeds.get(item['id']), alias)
            aliases[alias] = track_id
            if track_id not in tracks:
                tracks[track_id] = dict(id=track_id, title=item['title'], kind='opportunity',
                    description=item.get('next_step') or 'Saved opportunity; attach a next action.',
                    pool={'music': 'music', 'brand': 'game'}.get(item.get('category'), 'commerce'),
                    opportunity_ids=[])
            tracks[track_id]['opportunity_ids'].append(item['id'])
        return tracks, aliases, opportunities

    @staticmethod
    def normalize_track(track_id, tracks, aliases):
        canonical = aliases.get(track_id, track_id)
        if canonical not in tracks:
            raise HTTPException(404, 'Unknown money track or opportunity.')
        return canonical

    @staticmethod
    def assignment(seed_key, saved_track, tracks):
        if saved_track in tracks:
            return dict(basis='saved_link', track_id=saved_track, seed_key=seed_key)
        mapped = SEED_TRACKS.get(seed_key)
        if mapped:
            return dict(basis='seed_key', track_id=mapped, seed_key=seed_key)
        return dict(basis='unassigned', track_id=None, seed_key=seed_key)

    def workspace(self, offset=0, limit=500):
        offset, limit = max(0, offset), max(1, min(500, limit))
        tracks, _, opportunities = self.catalog()
        with self.db.connect() as c:
            totals = dict_rows(c.execute('''SELECT count(*) total,
                coalesce(sum(coalesce(status,'planned')!='done'),0) open,
                coalesce(sum(status='done'),0) done,
                coalesce(sum(status='blocked'),0) blocked FROM hub_requests'''))[0]
            rows = dict_rows(c.execute('''SELECT r.id,substr(r.text,1,12000) text,
                coalesce(r.status,'planned') status,r.created_at,
                coalesce(d.priority,'normal') priority,d.due_date,
                substr(coalesce(d.next_step,''),1,2000) next_step,d.reminder_date,
                d.updated_at,d.completed_at,coalesce(d.pinned,0) pinned,d.seed_key,
                l.track_id saved_track,(length(r.text)>12000) text_truncated
                FROM hub_requests r LEFT JOIN task_details d ON d.request_id=r.id
                LEFT JOIN money_task_tracks l ON l.task_id=r.id
                ORDER BY (coalesce(r.status,'planned')='done'),coalesce(d.pinned,0) DESC,
                  CASE d.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'low' THEN 3 ELSE 2 END,
                  coalesce(d.due_date,'9999-12-31'),r.id DESC LIMIT ? OFFSET ?''', (limit, offset)))
        for track in tracks.values():
            track.update(tasks=[], next_task=None, open_count=0, done_count=0, blocked_count=0,
                         counts_scope='loaded_task_page')
        unassigned, urgent = [], []
        today = date.today().isoformat()
        for task in rows:
            task['assignment'] = self.assignment(task.pop('seed_key'), task.pop('saved_track'), tracks)
            task['track_id'] = task['assignment']['track_id']
            task['status_source'] = 'saved_task_and_history'
            task['provider_verified'] = False
            task['task_url'] = '/tasks'
            task['next_url'] = '/next?task_id=' + str(task['id'])
            if task['status'] != 'done' and (task['priority'] == 'urgent' or
                    (task['due_date'] and task['due_date'] <= today)):
                urgent.append(task)
            if task['track_id'] is None:
                unassigned.append(task)
                continue
            track = tracks[task['track_id']]
            track['tasks'].append(task)
            track['done_count' if task['status'] == 'done' else 'open_count'] += 1
            track['blocked_count'] += int(task['status'] == 'blocked')
            if task['status'] != 'done' and track['next_task'] is None:
                track['next_task'] = task
        has_more = offset + len(rows) < totals['total']
        return dict(updated_at=now(), tracks=list(tracks.values()), opportunities=opportunities,
            summary=dict(total_tasks=totals['total'], open_tasks=totals['open'], done_tasks=totals['done'],
                blocked_tasks=totals['blocked'], loaded_tasks=len(rows), assigned_loaded=len(rows)-len(unassigned),
                unassigned_loaded=len(unassigned), urgent_loaded=len(urgent), opportunity_count=len(opportunities),
                income_verified=False, completion_scope='Saved task statuses; completion does not verify revenue or providers.'),
            urgent_tasks=urgent, unassigned_tasks=unassigned,
            coverage=dict(source='canonical_hub_requests_and_task_details', offset=offset, limit=limit,
                total=totals['total'], loaded=len(rows), truncated=(offset > 0 or has_more),
                has_more=has_more, next_offset=offset+len(rows) if has_more else None,
                counts_scope='Track and urgent counts cover this page; summary task totals cover the whole task database.',
                classification='Saved track link first, then exact seed key. No keyword inference.',
                keyword_fallback_used=False, plans_scope='Registered tasks and saved opportunities; not a claim that every export idea is registered.',
                unassigned_url='/tasks', opportunities_loaded=len(opportunities)),
            executed=False, paid_requests=0)

    def link(self, task_id, track_id):
        tracks, aliases, _ = self.catalog()
        canonical = self.normalize_track(track_id, tracks, aliases)
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            if not c.execute('SELECT 1 FROM hub_requests WHERE id=?', (task_id,)).fetchone():
                raise HTTPException(404, 'Task not found.')
            c.execute('''INSERT INTO money_task_tracks VALUES(?,?,?) ON CONFLICT(task_id)
                DO UPDATE SET track_id=excluded.track_id,updated_at=excluded.updated_at''', (task_id, canonical, now()))
        return dict(task_id=task_id, track_id=canonical,
                    assignment=dict(basis='saved_link', track_id=canonical), executed=False)

    def create(self, body):
        """Atomically create one canonical planned task, link, and replay receipt.

        Tracker.create currently opens its own transaction, so it cannot compose
        with a link atomically. This small insertion uses the same validated
        TaskCreate schema. No update or completion behavior is implemented here.
        """
        tracks, aliases, _ = self.catalog()
        canonical = self.normalize_track(body.track_id, tracks, aliases)
        values = body.model_dump(exclude={'track_id', 'request_key'}, mode='json')
        task_body = TaskCreate.model_validate(values)
        values['text'] = task_body.text.strip()
        if not values['text']:
            raise HTTPException(422, 'Task text cannot be blank.')
        fingerprint = hashlib.sha256(json.dumps(dict(values, track_id=canonical),
            sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')).hexdigest()
        request_key = body.request_key or uuid.uuid4().hex
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            receipt = c.execute('SELECT body_sha256,task_id FROM money_task_creation_receipts WHERE request_key=?',
                                (request_key,)).fetchone()
            if receipt:
                if receipt[0] != fingerprint:
                    raise HTTPException(409, 'This request key already belongs to different task content.')
                task_id, created = receipt[1], False
            else:
                stamp = now()
                task_id = c.execute('INSERT INTO hub_requests(text,status,created_at) VALUES(?,?,?)',
                                    (values['text'], 'planned', stamp)).lastrowid
                c.execute('''INSERT INTO task_details(request_id,seed_key,priority,due_date,next_step,
                    reminder_date,updated_at,pinned) VALUES(?,?,?,?,?,?,?,0)''',
                    (task_id, 'money-workspace:'+request_key, values['priority'], values['due_date'],
                     values['next_step'], values['reminder_date'], stamp))
                c.execute('INSERT INTO money_task_tracks VALUES(?,?,?)', (task_id, canonical, stamp))
                c.execute('INSERT INTO money_task_creation_receipts VALUES(?,?,?,?)',
                          (request_key, fingerprint, task_id, stamp))
                created = True
            linked = c.execute('SELECT track_id FROM money_task_tracks WHERE task_id=?', (task_id,)).fetchone()
        return dict(task_id=task_id, task=self.tracker.get(task_id),
                    track_id=linked[0] if linked else canonical, request_key=request_key,
                    created=created, replayed=not created, executed=False)


def register(app, db, engine):
    from pc_control import validate_request
    workspace = MoneyWorkspace(db, engine)

    @app.get('/api/money/workspace')
    def status(request: Request, offset: int = Query(default=0, ge=0),
               limit: int = Query(default=500, ge=1, le=500)):
        validate_request(request)
        return workspace.workspace(offset, limit)

    @app.post('/api/money/tasks/{task_id}/track')
    def link(task_id: int, body: TrackBody, request: Request):
        validate_request(request, mutation=True)
        return workspace.link(task_id, body.track_id)

    @app.post('/api/money/tasks')
    def create(body: WorkspaceTaskBody, request: Request):
        validate_request(request, mutation=True)
        return workspace.create(body)

    return workspace
