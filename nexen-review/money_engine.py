"""Local opportunity planning and unit economics; contains no provider executor."""
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal
import json
import sqlite3

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

BASE = Path(__file__).resolve().parent
DAILY_CAP_CENTS = 5000
TOTAL_CAP_CENTS = 5000
Cents = Annotated[int, Field(strict=True, ge=0, le=10_000_000)]
Stage = Literal['research', 'ready', 'active', 'blocked', 'completed']
COST_FIELDS = ('supplier_cost_cents', 'shipping_cents', 'packaging_cents',
               'payment_fees_cents', 'refund_reserve_cents')


def now():
    return datetime.now(timezone.utc).isoformat()


class Inputs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    price_cents: Annotated[int, Field(strict=True, ge=1, le=10_000_000)] = 3499
    supplier_cost_cents: Cents | None = None
    shipping_cents: Cents | None = None
    packaging_cents: Cents | None = None
    payment_fees_cents: Cents | None = None
    refund_reserve_cents: Cents | None = None


class OpportunityCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=160)
    category: Literal['store', 'brand', 'music', 'service', 'other'] = 'other'
    status: Stage = 'research'
    evidence: str = Field(default='', max_length=4000)
    next_step: str = Field(default='', max_length=2000)

    @field_validator('title')
    @classmethod
    def title_not_blank(cls, value):
        if not value.strip():
            raise ValueError('Enter an opportunity title')
        return value.strip()


class OpportunityUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Stage
    evidence: str = Field(default='', max_length=4000)
    next_step: str = Field(default='', max_length=2000)


def calculate(inputs):
    values = Inputs.model_validate(inputs).model_dump()
    missing = [key for key in COST_FIELDS if values[key] is None]
    result = dict(complete=not missing, missing=missing, landed_cost_cents=None,
                  variable_cost_cents=None, contribution_before_ads_cents=None,
                  break_even_cac_cents=None, orders_to_cover_50=None,
                  scenario_only=True, excludes=['fixed overhead', 'taxes'],
                  forecast=False)
    if missing:
        result['reason'] = 'Enter every per-order cost; blank costs are unknown.'
        return result
    result['landed_cost_cents'] = sum(values[k] for k in COST_FIELDS[:3])
    result['variable_cost_cents'] = sum(values[k] for k in COST_FIELDS)
    margin = values['price_cents'] - result['variable_cost_cents']
    result['contribution_before_ads_cents'] = margin
    if margin > 0:
        result['break_even_cac_cents'] = margin
        result['orders_to_cover_50'] = (TOTAL_CAP_CENTS + margin - 1) // margin
        result['reason'] = 'Positive contribution in this scenario; demand and actual costs remain unverified.'
    else:
        result['reason'] = 'No positive contribution before advertising. These inputs cannot cover ad spending.'
    return result


class Engine:
    def __init__(self, db):
        self.db = db
        with db.connect() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS money_inputs(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS money_opportunities(id INTEGER PRIMARY KEY,seed_key TEXT UNIQUE,title TEXT NOT NULL,
              category TEXT NOT NULL,status TEXT NOT NULL,evidence TEXT NOT NULL,next_step TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
            ''')
            c.execute('INSERT OR IGNORE INTO money_inputs VALUES(1,?,?)', (json.dumps(Inputs().model_dump()), now()))
            seeds = [
                ('lumipaw', 'Lumipaw store', 'store', 'blocked', 'Product price observed in Amboras: $34.99. Supplier terms, checkout and sales tracking are unverified.', 'Confirm landed cost and shipping, then complete payment onboarding and test checkout.'),
                ('wdr-brand', 'WDR brand', 'brand', 'research', 'Idea from your plans. Demand, offer, costs and revenue have not been verified.', 'Choose one offer and gather evidence of customer demand.'),
                ('music-release', 'Music release', 'music', 'research', 'Idea from your music plans. Distribution, release readiness and revenue are unverified.', 'Select one finished release, confirm rights and delivery assets, and set a release date.')]
            for key, title, category, status, evidence, next_step in seeds:
                c.execute('''INSERT OR IGNORE INTO money_opportunities
                  (seed_key,title,category,status,evidence,next_step,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)''',
                  (key, title, category, status, evidence, next_step, now(), now()))

    def inputs(self):
        with self.db.connect() as c:
            row = c.execute('SELECT payload,updated_at FROM money_inputs WHERE id=1').fetchone()
        return {'values': Inputs.model_validate_json(row[0]).model_dump(), 'updated_at': row[1],
                'source': 'Manual scenario inputs; initial price observed in Amboras, not a live price feed.'}

    def save_inputs(self, body):
        with self.db.connect() as c:
            c.execute('UPDATE money_inputs SET payload=?,updated_at=? WHERE id=1', (body.model_dump_json(), now()))
        return self.status()

    def opportunities(self):
        with self.db.connect() as c:
            cur = c.execute('SELECT id,title,category,status,evidence,next_step,created_at,updated_at FROM money_opportunities ORDER BY id')
            names = [x[0] for x in cur.description]
            return [dict(zip(names, r), status_source='user_reported', provider_verified=False) for r in cur.fetchall()]

    def create(self, body):
        with self.db.connect() as c:
            if c.execute('SELECT count(*) FROM money_opportunities').fetchone()[0] >= 500:
                raise HTTPException(409, 'Opportunity limit reached (500). Update an existing opportunity.')
            return c.execute('''INSERT INTO money_opportunities(title,category,status,evidence,next_step,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?)''', (body.title, body.category, body.status, body.evidence, body.next_step, now(), now())).lastrowid

    def update(self, opportunity_id, body):
        # PATCH omission preserves saved notes; an explicitly supplied empty
        # string still clears that field. Column names are code-owned.
        fields = [name for name in ('status', 'evidence', 'next_step') if name in body.model_fields_set]
        assignments = ','.join(name+'=?' for name in fields)
        with self.db.connect() as c:
            cur = c.execute('UPDATE money_opportunities SET '+assignments+',updated_at=? WHERE id=?',
                            (*[getattr(body, name) for name in fields], now(), opportunity_id))
            if not cur.rowcount:
                raise HTTPException(404, 'Opportunity not found')

    def progress(self):
        scope = 'Tracked tasks mentioning Lumipaw, dropshipping, music release or WDR brand; not overall code completion.'
        try:
            with self.db.connect() as c:
                row = c.execute("""SELECT count(*),coalesce(sum(status='done'),0) FROM hub_requests WHERE
                  lower(text) LIKE '%lumipaw%' OR lower(text) LIKE '%dropship%' OR
                  lower(text) LIKE '%music release%' OR lower(text) LIKE '%wdr brand%'""").fetchone()
            total, done = int(row[0]), int(row[1])
            return dict(available=True, total=total, completed=done, percent=round(100 * done / total, 1) if total else None, scope=scope)
        except sqlite3.OperationalError:
            return dict(available=False, total=None, completed=None, percent=None, scope=scope)

    def status(self):
        values = self.inputs()
        gates = [
            dict(id='supplier', title='Confirm fulfillment costs', detail='Supplier cost, delivery window, packaging and shipping evidence are missing.', href='https://admin.amboras.com/products', action='Open products', state='unverified'),
            dict(id='returns', title='Confirm refund and return terms', detail='Record your supplier return terms and per-order refund reserve before a paid test.', href='https://admin.amboras.com/online-store', action='Open store', state='unverified'),
            dict(id='checkout', title='Finish payments and test checkout', detail='In Amboras, open Setup payments. Onboarding and a successful end-to-end checkout are not verified.', href='https://admin.amboras.com/home', action='Open Amboras setup', state='incomplete'),
            dict(id='ads', title='Connect an advertising account', detail='No advertising account is connected. Account setup, billing and campaign review require your login.', href='https://ads.tiktok.com/resources/help/article/create-tiktok-ads-manager-account?lang=en-GB', action='TikTok setup guide', state='not_connected'),
            dict(id='measurement', title='Connect order and ad reporting', detail='No revenue or ad-spend connector is available. Actual revenue and spending are unknown.', href='/tasks', action='Track the next step', state='not_connected')]
        return dict(updated_at=now(), inputs=values, calculator=calculate(values['values']), opportunities=self.opportunities(),
                    task_progress=self.progress(), gates=[dict(g, provider_verified=False) for g in gates],
                    readiness=dict(can_execute_ads=False, checkout_verified=False, revenue_connected=False, blockers=len(gates)),
                    budget=dict(daily_cap_cents=DAILY_CAP_CENTS, total_cap_cents=TOTAL_CAP_CENTS,
                                automatically_restarts=False, actual_spend_cents=None,
                                provider_enforcement_verified=False, execution_enabled=False),
                    revenue=dict(actual_cents=None, status='not_connected'),
                    sources=dict(formula='https://legacy.sba.gov/business-guide/plan-your-business/calculate-your-startup-costs/break-even-point'),
                    notice='Statuses and notes are saved locally. Marking work complete does not verify a provider, launch an ad, or make a payment.')


def register(app, db):
    from pc_control import validate_request
    engine = Engine(db)

    @app.get('/money', response_class=HTMLResponse)
    def money_page(request: Request):
        validate_request(request)
        return (BASE / 'money.html').read_text(encoding='utf-8')

    @app.get('/api/money/status')
    def status(request: Request):
        validate_request(request)
        return engine.status()

    @app.post('/api/money/inputs')
    def inputs(body: Inputs, request: Request):
        validate_request(request, mutation=True)
        return engine.save_inputs(body)

    @app.post('/api/money/opportunities')
    def create(body: OpportunityCreate, request: Request):
        validate_request(request, mutation=True)
        return {'id': engine.create(body), 'opportunities': engine.opportunities()}

    @app.patch('/api/money/opportunities/{opportunity_id}')
    def update(opportunity_id: int, body: OpportunityUpdate, request: Request):
        validate_request(request, mutation=True)
        engine.update(opportunity_id, body)
        return {'opportunities': engine.opportunities()}

    from money_workspace import register as register_workspace
    register_workspace(app, db, engine)

    return engine
