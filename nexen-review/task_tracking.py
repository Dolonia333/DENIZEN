"""Persistent local task tracking layered over the existing hub request history."""
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal
import json
from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field

BASE = Path(__file__).resolve().parent
Status = Literal['planned', 'in_progress', 'blocked', 'done']
Priority = Literal['urgent', 'high', 'normal', 'low']


def now():
    return datetime.now(timezone.utc).isoformat()


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Status | None = None
    priority: Priority | None = None
    due_date: date | None = None
    next_step: str | None = Field(default=None, max_length=2000)
    reminder_date: date | None = None
    outcome: str | None = Field(default=None, max_length=4000)


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=12000)
    priority: Priority = 'normal'
    due_date: date | None = None
    next_step: str = Field(default='', max_length=2000)
    reminder_date: date | None = None


class Tracker:
    def __init__(self, db):
        self.db = db
        with db.connect() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS hub_requests(
              id INTEGER PRIMARY KEY,text TEXT,status TEXT DEFAULT 'planned',created_at TEXT);
            CREATE TABLE IF NOT EXISTS task_details(
              request_id INTEGER PRIMARY KEY REFERENCES hub_requests(id),
              seed_key TEXT UNIQUE,priority TEXT NOT NULL DEFAULT 'normal',
              due_date TEXT,next_step TEXT NOT NULL DEFAULT '',reminder_date TEXT,
              updated_at TEXT NOT NULL,completed_at TEXT,pinned INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS task_history(
              id INTEGER PRIMARY KEY,request_id INTEGER NOT NULL REFERENCES hub_requests(id),
              old_status TEXT,new_status TEXT,outcome TEXT,reminder_date TEXT,created_at TEXT NOT NULL);
            ''')
            from completion_memory import ensure_schema
            ensure_schema(c)

    def get(self, request_id):
        rows = self.db.rows('''SELECT r.*,coalesce(d.priority,'normal') priority,
          d.due_date,coalesce(d.next_step,'') next_step,d.reminder_date,d.updated_at,
          d.completed_at,coalesce(d.pinned,0) pinned FROM hub_requests r
          LEFT JOIN task_details d ON d.request_id=r.id WHERE r.id=?''', (request_id,))
        if not rows:
            raise HTTPException(404, 'Task not found')
        item = rows[0]
        item['history'] = self.db.rows('SELECT * FROM task_history WHERE request_id=? ORDER BY id DESC LIMIT 100', (request_id,))
        return item

    def list(self, include_done=False, offset=0, limit=200):
        where = '' if include_done else "WHERE coalesce(r.status,'planned')!='done'"
        rows = self.db.rows('''SELECT r.*,coalesce(d.priority,'normal') priority,
          d.due_date,coalesce(d.next_step,'') next_step,d.reminder_date,d.updated_at,
          d.completed_at,coalesce(d.pinned,0) pinned FROM hub_requests r
          LEFT JOIN task_details d ON d.request_id=r.id ''' + where + '''
          ORDER BY (r.status='done'),coalesce(d.pinned,0) DESC,
          CASE d.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'low' THEN 3 ELSE 2 END,
          coalesce(d.due_date,'9999-12-31'),r.id DESC LIMIT ? OFFSET ?''', (limit, offset))
        total = self.db.scalar('SELECT count(*) FROM hub_requests r ' + where)
        counts = self.db.rows('SELECT status,count(*) count FROM hub_requests GROUP BY status')
        return {'tasks': rows, 'total': total, 'offset': offset, 'limit': limit,
                'counts': {r['status']: r['count'] for r in counts}, 'today': date.today().isoformat(),
                'reminders': 'Dates are tracked locally. No automatic calls, messages, or payments are made.'}

    def create(self, body, seed_key=None, pinned=False, initial_status='planned'):
        initial_status = TaskUpdate(status=initial_status).status
        text = body.text.strip()
        if not text:
            raise HTTPException(422, 'Task text cannot be blank')
        with self.db.connect() as c:
            # Serialize seed insertion so two startups cannot create duplicates.
            c.execute('BEGIN IMMEDIATE')
            if seed_key:
                existing = c.execute('SELECT request_id FROM task_details WHERE seed_key=?', (seed_key,)).fetchone()
                if existing:
                    return int(existing[0])
            request_id = c.execute('INSERT INTO hub_requests(text,status,created_at) VALUES(?,?,?)', (text, initial_status, now())).lastrowid
            c.execute('''INSERT INTO task_details(request_id,seed_key,priority,due_date,next_step,reminder_date,updated_at,pinned)
                VALUES(?,?,?,?,?,?,?,?)''', (request_id, seed_key, body.priority,
                body.due_date.isoformat() if body.due_date else None, body.next_step,
                body.reminder_date.isoformat() if body.reminder_date else None, now(), int(pinned)))
            return request_id

    def update(self, request_id, body):
        values = body.model_dump(exclude_unset=True, mode='json')
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT status FROM hub_requests WHERE id=?', (request_id,)).fetchone()
            if not row:
                raise HTTPException(404, 'Task not found')
            old_status = row[0]
            new_status = values.get('status') or old_status
            c.execute('INSERT OR IGNORE INTO task_details(request_id,updated_at) VALUES(?,?)', (request_id, now()))
            # Explicit user updates are the only path to done; reopening retains history.
            c.execute('UPDATE hub_requests SET status=? WHERE id=?', (new_status, request_id))
            fields = {'updated_at': now()}
            for key in ('priority', 'due_date', 'next_step', 'reminder_date'):
                if key in values:
                    value = values[key]
                    if key in ('priority', 'next_step') and value is None:
                        raise HTTPException(422, key + ' cannot be null')
                    fields[key] = value
            if new_status != old_status:
                fields['completed_at'] = now() if new_status == 'done' else None
            c.execute('UPDATE task_details SET ' + ','.join(key + '=?' for key in fields) + ' WHERE request_id=?', tuple(fields.values()) + (request_id,))
            if new_status != old_status or values.get('outcome') or 'reminder_date' in values:
                reminder = c.execute('SELECT reminder_date FROM task_details WHERE request_id=?', (request_id,)).fetchone()[0]
                history_id=c.execute('INSERT INTO task_history(request_id,old_status,new_status,outcome,reminder_date,created_at) VALUES(?,?,?,?,?,?)',
                    (request_id, old_status, new_status, values.get('outcome') or '', reminder, now()))
                history_id=history_id.lastrowid
                if new_status=='done' or old_status=='done':
                    from completion_memory import record_event
                    title=c.execute('SELECT text FROM hub_requests WHERE id=?',(request_id,)).fetchone()[0]
                    record_event(c,'task-history:'+str(history_id),'task',request_id,title,'done' if new_status=='done' else 'reopened',values.get('outcome') or '')
        from completion_memory import export_journal
        result=self.get(request_id)
        result['memory_sync']=export_journal(self.db)
        return result

    def seed(self, path):
        if not Path(path).is_file():
            return 0
        payload = json.loads(Path(path).read_text(encoding='utf-8-sig'))
        count = 0
        for source in payload.get('tasks', []):
            item = dict(source)
            if 'due' in item:
                item.setdefault('due_date',item.pop('due'))
            if 'next_action' in item:
                item.setdefault('next_step',item.pop('next_action'))
            key = item.get('key')
            if not isinstance(key, str) or not key.strip():
                continue
            known_metadata={'key','pinned','status','source','source_urls','checked_date'}
            body = TaskCreate.model_validate({k: v for k, v in item.items() if k not in known_metadata})
            self.create(body, seed_key=key, pinned=bool(item.get('pinned', False)), initial_status=item.get('status', 'planned'))
            count += 1
        return count


PAGE = r'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NEXEN · Tasks</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;color:#eaf2ff;background:#090e1b}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 10% 0,#23366977,transparent 60%),radial-gradient(ellipse at 90% 30%,#38285966,transparent 60%)}main{max-width:1150px;margin:auto;padding:32px 22px}a{color:#a7dfff}header{display:flex;justify-content:space-between;gap:20px;align-items:center}h1{font-size:38px;letter-spacing:-1.5px;margin:12px 0}p{color:#acb9d2;line-height:1.6}.glass{background:#d9e9ff0a;border:1px solid #def0ff21;border-radius:22px;box-shadow:0 20px 50px #0002;backdrop-filter:blur(16px)}.toolbar{padding:18px;margin:22px 0;display:flex;gap:12px;flex-wrap:wrap;align-items:center}.cards{display:grid;gap:16px}.card{padding:24px}.urgent{border-color:#ffb96966;background:linear-gradient(120deg,#ffb15c12,#eaffff08)}.row{display:flex;justify-content:space-between;gap:15px;align-items:start}.completed .title{text-decoration:line-through;text-decoration-color:#a9efc9;animation:completion-in .55s ease both}.completion-label{color:#a9efc9;letter-spacing:2px;font-size:12px;font-weight:800}@keyframes completion-in{from{opacity:.25;transform:translateX(-7px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.completed .title{animation:none}}.title{font-size:19px;font-weight:650;white-space:pre-wrap;overflow-wrap:anywhere}.tag{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#a5d8ff}.due{color:#ffc887}.muted{font-size:13px;color:#a5b4cd}button,input,select,textarea{font:inherit;color:inherit;background:#0b1326;border:1px solid #a8c7ff38;border-radius:11px;padding:10px 13px}button{cursor:pointer;background:#b4dbff16}button:hover{background:#b4dbff30}button:disabled{opacity:.5;cursor:wait}.primary{background:#bddeff;color:#0d1e34}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#b2c2d9}textarea{min-height:80px;width:100%;resize:vertical}details{margin-top:18px}summary{cursor:pointer;color:#b8d9ff}.full{grid-column:1/-1}.actions{display:flex;gap:12px;align-items:center;margin-top:16px}.history{padding:10px 0;border-top:1px solid #ffffff13;white-space:pre-wrap}#error{color:#ffbf9c}#newform{padding:20px;margin-bottom:22px}.spacer{flex:1}@media(max-width:650px){.grid{grid-template-columns:1fr}header{display:block}.row{display:block}h1{font-size:32px}}
</style><main><header><div><a href="/">← NEXEN Home</a><div class="tag" style="margin-top:24px">Your work · kept until you finish</div><h1>Task room</h1><p>Priorities, human steps, deadlines, and follow-ups in one persistent list.</p></div><div class="glass" style="padding:18px"><b id="stats">Loading</b><p class="muted">Private to this local NEXEN program.</p></div></header>
<div class="toolbar glass"><label style="flex-direction:row"><input type="checkbox" id="done" checked> Include completed</label><input id="search" placeholder="Filter loaded tasks"><span class="spacer"></span><button id="new">+ Add task</button><button id="refresh">Refresh</button></div><p id="error" role="status"></p>
<form id="newform" class="glass" hidden><label>What needs doing?<textarea id="newtext" required maxlength="12000"></textarea></label><div class="actions"><button class="primary">Save task</button><button type="button" id="cancel">Cancel</button></div></form><div id="cards" class="cards"></div><div class="actions"><button id="more" hidden>Load more</button><span id="count" class="muted"></span></div><p class="muted">Reminder dates and call outcomes are saved here. NEXEN does not place calls or make payments from this page.</p></main>
<script>
const $=s=>document.querySelector(s);let rows=[],total=0;const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json','X-Nexen-Action':'launch',...options.headers}});const x=await r.json();if(!r.ok)throw Error(typeof x.detail==='string'?x.detail:JSON.stringify(x.detail));return x}
function opt(values,current){return values.map(x=>`<option value="${x}" ${x===current?'selected':''}>${x.replaceAll('_',' ')}</option>`).join('')}
function render(){const q=$('#search').value.toLowerCase();$('#cards').innerHTML=rows.filter(t=>(t.text+' '+t.next_step).toLowerCase().includes(q)).map(t=>`<article class="card glass ${t.priority==='urgent'&&t.status!=='done'?'urgent':''} ${t.status==='done'?'completed':''}" data-id="${t.id}"><div class="row"><div><div class="tag">${esc(t.priority)} · ${t.status==='done'?'COMPLETED':esc(t.status).replaceAll('_',' ')} · #${t.id}</div><div class="title">${esc(t.text)}</div></div><div class="due">${t.due_date?'Due '+esc(t.due_date):''}</div></div>${t.next_step?'<p><b>Next human step:</b> '+esc(t.next_step)+'</p>':''}${t.reminder_date?'<p class="muted">Follow up: '+esc(t.reminder_date)+'</p>':''}<div class="actions"><button class="completebtn">${t.status==='done'?'Reopen':'Mark COMPLETED'}</button>${t.status==='done'?'<span class="completion-label">COMPLETED</span>':''}</div><details><summary>Update task · record outcome</summary><form class="edit"><div class="grid"><label>Status<select name="status">${opt(['planned','in_progress','blocked','done'],t.status)}</select></label><label>Priority<select name="priority">${opt(['urgent','high','normal','low'],t.priority)}</select></label><label>Due date<input type="date" name="due_date" value="${esc(t.due_date)}"></label><label class="full">Next step you need to take<textarea name="next_step" maxlength="2000">${esc(t.next_step)}</textarea></label><label>Next reminder / follow-up<input type="date" name="reminder_date" value="${esc(t.reminder_date)}"></label><label class="full">Call or follow-up outcome<textarea name="outcome" maxlength="4000" placeholder="Who you contacted, what happened, and the next action."></textarea></label></div><div class="actions"><button class="primary">Save changes</button><button type="button" class="historybtn">View history</button><span class="muted result"></span></div><div class="historybox"></div></form></details></article>`).join('');$('#more').hidden=rows.length>=total;$('#count').textContent=`${rows.length} of ${total} tasks loaded`;}
async function load(more=false){try{$('#error').textContent='';const x=await api('/api/tasks?include_done='+$('#done').checked+'&offset='+(more?rows.length:0));rows=more?rows.concat(x.tasks):x.tasks;total=x.total;$('#stats').textContent=Object.entries(x.counts).map(([s,n])=>n+' '+s.replaceAll('_',' ')).join(' · ')||'No tasks yet';render()}catch(e){$('#error').textContent=e.message}}
$('#cards').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,id=Number(f.closest('article').dataset.id),b=f.querySelector('button'),v=Object.fromEntries(new FormData(f));v.due_date=v.due_date||null;v.reminder_date=v.reminder_date||null;b.disabled=true;try{const x=await api('/api/tasks/'+id,{method:'PATCH',body:JSON.stringify(v)});rows=rows.map(t=>t.id===id?x:t);f.querySelector('.result').textContent='Saved';await load()}catch(err){f.querySelector('.result').textContent=err.message}finally{b.disabled=false}});
$('#cards').addEventListener('click',async e=>{if(e.target.classList.contains('completebtn')){const button=e.target,card=button.closest('article'),id=Number(card.dataset.id),item=rows.find(t=>t.id===id);button.disabled=true;try{await api('/api/tasks/'+id,{method:'PATCH',body:JSON.stringify({status:item.status==='done'?'planned':'done'})});await load()}catch(err){$('#error').textContent=err.message;button.disabled=false}return;}if(!e.target.classList.contains('historybtn'))return;const a=e.target.closest('article'),box=a.querySelector('.historybox');try{const x=await api('/api/tasks/'+a.dataset.id);box.innerHTML=x.history.map(h=>`<div class="history"><b>${esc(h.created_at)}</b> · ${esc(h.old_status)} → ${esc(h.new_status)}<br>${esc(h.outcome)}${h.reminder_date?'<br>Next follow-up: '+esc(h.reminder_date):''}</div>`).join('')||'<p class="muted">No recorded updates yet.</p>'}catch(err){box.textContent=err.message}});
$('#new').onclick=()=>$('#newform').hidden=false;$('#cancel').onclick=()=>$('#newform').hidden=true;$('#newform').onsubmit=async e=>{e.preventDefault();try{await api('/api/tasks',{method:'POST',body:JSON.stringify({text:$('#newtext').value})});$('#newtext').value='';$('#newform').hidden=true;await load()}catch(err){$('#error').textContent=err.message}};$('#done').onchange=()=>load();$('#search').oninput=render;$('#refresh').onclick=()=>load();$('#more').onclick=()=>load(true);load();
</script></html>'''


def register(app, db):
    from pc_control import validate_request
    tracker = Tracker(db)
    tracker.seed(BASE / 'data' / 'task-seeds.json')

    @app.get('/tasks', response_class=HTMLResponse)
    def page(request: Request):
        validate_request(request)
        return PAGE

    @app.get('/api/tasks')
    def listing(request: Request, include_done: bool = False, offset: int = 0, limit: int = 200):
        validate_request(request)
        return tracker.list(include_done, max(0, offset), max(1, min(500, limit)))

    @app.get('/api/tasks/{request_id}')
    def one(request_id: int, request: Request):
        validate_request(request)
        return tracker.get(request_id)

    @app.post('/api/tasks')
    def create(body: TaskCreate, request: Request):
        validate_request(request, mutation=True)
        return tracker.get(tracker.create(body))

    @app.patch('/api/tasks/{request_id}')
    def update(request_id: int, body: TaskUpdate, request: Request):
        validate_request(request, mutation=True)
        return tracker.update(request_id, body)

    return tracker
