"""User-authored daily notes and transparent cosmetic progress. Local storage only."""
from datetime import date, datetime, timezone
import json
from pathlib import Path
import re
import uuid

from fastapi import HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

BASE = Path(__file__).resolve().parent
XP_PER_CHECKIN = 5
XP_PER_TASK = 10
XP_PER_LEVEL = 100


def now():
    return datetime.now(timezone.utc).isoformat()


class CheckInBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    day: date = Field(alias='date')
    mood: int | None = Field(default=None, strict=True, ge=1, le=5)
    energy: int | None = Field(default=None, strict=True, ge=1, le=5)
    feeling_text: str = Field(default='', max_length=4000)
    meal_notes: str = Field(default='', max_length=4000)

    @field_validator('day', mode='before')
    @classmethod
    def calendar_date(cls, value):
        if type(value) is date:
            return value
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError('Use a calendar date in YYYY-MM-DD format.')
        return value

    @field_validator('day')
    @classmethod
    def no_future_checkin(cls, value):
        if value > date.today():
            raise ValueError('A check-in describes today or an earlier day, not a future day.')
        return value

    @field_validator('feeling_text', 'meal_notes')
    @classmethod
    def plain_notes(cls, value):
        return value.strip()


def as_dict(cursor, row):
    return dict(zip((column[0] for column in cursor.description), row)) if row is not None else None


def one(connection, sql, args=()):
    cursor = connection.execute(sql, args)
    return as_dict(cursor, cursor.fetchone())


def all_rows(connection, sql, args=()):
    cursor = connection.execute(sql, args)
    return [as_dict(cursor, row) for row in cursor.fetchall()]


class CheckIns:
    def __init__(self, db):
        self.db = db
        with db.connect() as connection:
            connection.executescript('''
            CREATE TABLE IF NOT EXISTS daily_checkins(
              checkin_date TEXT PRIMARY KEY,mood INTEGER,energy INTEGER,
              feeling_text TEXT NOT NULL DEFAULT '',meal_notes TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
              revision INTEGER NOT NULL,last_receipt TEXT NOT NULL,
              CHECK(mood IS NULL OR mood BETWEEN 1 AND 5),
              CHECK(energy IS NULL OR energy BETWEEN 1 AND 5));
            CREATE TABLE IF NOT EXISTS daily_checkin_history(
              receipt_id TEXT PRIMARY KEY,checkin_date TEXT NOT NULL,
              revision INTEGER NOT NULL,event TEXT NOT NULL,
              previous_json TEXT,current_json TEXT NOT NULL,created_at TEXT NOT NULL,
              UNIQUE(checkin_date,revision));
            CREATE INDEX IF NOT EXISTS checkin_history_date ON daily_checkin_history(checkin_date,revision);
            ''')

    @staticmethod
    def public(row):
        if row is None:
            return None
        return {**row, 'date':row['checkin_date'], 'basis':'User-authored local check-in'}

    def progress(self, connection=None):
        if connection is None:
            with self.db.connect() as connection:
                return self.progress(connection)
        days = connection.execute('SELECT count(*) FROM daily_checkins').fetchone()[0]
        tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('hub_requests','task_history')")}
        tasks = None
        if tables == {'hub_requests', 'task_history'}:
            # A seeded/imported done label alone is not a recorded completion.
            # Reopening stops that task counting; later re-completion still counts once.
            tasks = connection.execute('''SELECT count(*) FROM hub_requests r
                WHERE r.status='done' AND EXISTS(SELECT 1 FROM task_history h
                WHERE h.request_id=r.id AND h.new_status='done' AND coalesce(h.old_status,'planned')!='done')''').fetchone()[0]
        xp = days * XP_PER_CHECKIN + tasks * XP_PER_TASK if tasks is not None else None
        return {'checkin_days':days, 'completed_tasks':tasks, 'tracker_available':tasks is not None,
                'checkin_xp':days * XP_PER_CHECKIN, 'task_xp':tasks * XP_PER_TASK if tasks is not None else None,
                'total_xp':xp, 'level':xp // XP_PER_LEVEL + 1 if xp is not None else None,
                'level_xp':xp % XP_PER_LEVEL if xp is not None else None, 'level_size':XP_PER_LEVEL,
                'to_next_level':XP_PER_LEVEL - xp % XP_PER_LEVEL if xp is not None else None,
                'formula':{'per_checkin_date':XP_PER_CHECKIN, 'per_completed_task':XP_PER_TASK, 'per_level':XP_PER_LEVEL},
                'basis':'User-reported completion records and saved check-in dates. Cosmetic progress only.',
                'rules':[
                    'Each saved date counts once. Editing or resaving it adds no extra XP.',
                    'A task counts once only while marked done and with a recorded transition to done in Tracker history.',
                    'Reopening a task removes its contribution until it is marked done again; repeated completions never multiply its points.',
                    'Reading, game exploration, pending tasks and higher mood or energy ratings earn no points.',
                    'Level does not measure health, ability, income or financial readiness.']}

    def snapshot(self, day=None, recent_limit=7):
        selected = day or date.today()
        with self.db.connect() as connection:
            entry = one(connection, 'SELECT * FROM daily_checkins WHERE checkin_date=?', (selected.isoformat(),))
            recent = all_rows(connection, 'SELECT checkin_date,mood,energy,updated_at,revision FROM daily_checkins ORDER BY checkin_date DESC LIMIT ?', (max(1,min(30,recent_limit)),))
            return {'date':selected.isoformat(), 'today':date.today().isoformat(), 'entry':self.public(entry),
                    'recent':recent, 'progress':self.progress(connection), 'checked_at':now(),
                    'privacy':'These notes are stored locally in NEXEN. This page does not send them to a model or outside service.'}

    def save(self, body):
        day = body.day.isoformat()
        values = {'checkin_date':day, 'mood':body.mood, 'energy':body.energy,
                  'feeling_text':body.feeling_text, 'meal_notes':body.meal_notes}
        with self.db.connect() as connection:
            connection.execute('BEGIN IMMEDIATE')
            previous = one(connection, 'SELECT * FROM daily_checkins WHERE checkin_date=?', (day,))
            changed = previous is None or any(previous[key] != value for key,value in values.items())
            if not changed:
                return {'entry':self.public(previous), 'changed':False, 'created':False,
                        'receipt_id':previous['last_receipt'], 'new_checkin_xp':0,
                        'progress':self.progress(connection), 'message':'Already saved. No extra check-in points were added.'}
            receipt = uuid.uuid4().hex
            stamp = now()
            revision = previous['revision'] + 1 if previous else 1
            current = {**values, 'created_at':previous['created_at'] if previous else stamp,
                       'updated_at':stamp, 'revision':revision, 'last_receipt':receipt}
            connection.execute('''INSERT INTO daily_checkins(checkin_date,mood,energy,feeling_text,meal_notes,created_at,updated_at,revision,last_receipt)
                VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(checkin_date) DO UPDATE SET mood=excluded.mood,
                energy=excluded.energy,feeling_text=excluded.feeling_text,meal_notes=excluded.meal_notes,
                updated_at=excluded.updated_at,revision=excluded.revision,last_receipt=excluded.last_receipt''',
                tuple(current[key] for key in ('checkin_date','mood','energy','feeling_text','meal_notes','created_at','updated_at','revision','last_receipt')))
            connection.execute('''INSERT INTO daily_checkin_history(receipt_id,checkin_date,revision,event,previous_json,current_json,created_at)
                VALUES(?,?,?,?,?,?,?)''', (receipt,day,revision,'updated' if previous else 'created',
                json.dumps(previous,ensure_ascii=False) if previous else None,json.dumps(current,ensure_ascii=False),stamp))
            return {'entry':self.public(current), 'changed':True, 'created':previous is None,
                    'receipt_id':receipt, 'new_checkin_xp':XP_PER_CHECKIN if previous is None else 0,
                    'progress':self.progress(connection),
                    'message':'Daily check-in saved. 5 cosmetic XP for this date.' if previous is None else 'Check-in updated. Its earlier version is kept in history; no extra points were added.'}

    def history(self, day, offset=0, limit=30):
        with self.db.connect() as connection:
            total = connection.execute('SELECT count(*) FROM daily_checkin_history WHERE checkin_date=?',(day.isoformat(),)).fetchone()[0]
            rows = all_rows(connection, '''SELECT * FROM daily_checkin_history WHERE checkin_date=?
                ORDER BY revision DESC LIMIT ? OFFSET ?''',(day.isoformat(),limit,offset))
            for row in rows:
                previous_raw = row.pop('previous_json')
                row['previous'] = json.loads(previous_raw) if previous_raw else None
                row['current'] = json.loads(row.pop('current_json'))
            return {'date':day.isoformat(), 'history':rows, 'total':total, 'offset':offset, 'limit':limit}


def register(app, db):
    from pc_control import validate_request
    checkins = CheckIns(db)

    @app.get('/check-in', response_class=HTMLResponse)
    def page(request: Request):
        validate_request(request)
        return (BASE / 'check-in.html').read_text(encoding='utf-8')

    @app.get('/api/check-in')
    def current(request: Request, day: date | None = Query(default=None, alias='date')):
        validate_request(request)
        return checkins.snapshot(day)

    @app.post('/api/check-in')
    def save(body: CheckInBody, request: Request):
        validate_request(request, mutation=True)
        return checkins.save(body)

    @app.get('/api/check-in/history')
    def history(request: Request, day: date = Query(alias='date'), offset: int = Query(default=0, ge=0), limit: int = Query(default=30, ge=1, le=100)):
        validate_request(request)
        return checkins.history(day, offset, limit)

    return checkins
