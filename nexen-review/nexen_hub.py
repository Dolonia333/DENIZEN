"""Local NEXEN hub: real reports, skill discovery, requests and mission state."""
import hashlib
import json
import sqlite3
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path
from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE=Path(__file__).resolve().parent
DISCORD=Path('F:/WDR_LIFEOS/KNOWLEDGE_BASE/knowledge.sqlite3')

class RequestText(BaseModel):
    text: str=Field(min_length=1,max_length=4000)

class AutonomyMode(BaseModel):
    paused:bool

def mount_available_assets(app, prefix, directory, name):
    """Keep missing optional assets from preventing access to setup pages."""
    if Path(directory).is_dir():
        app.mount(prefix, StaticFiles(directory=directory), name=name)
        return True
    return False


def save_digest(report, path):
    """Persist the generated digest even before the data directory exists."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding='utf-8')

def register(app,db,sup):
    from app_auth import register as register_auth
    auth_gate = register_auth(app)
    @app.middleware('http')
    async def local_only(request:Request,call_next):
        from pc_control import validate_request
        try:
            from private_access import normalize_private_request
            normalize_private_request(request)
            validate_request(request)
            if request.method not in ('GET','HEAD','OPTIONS'):
                origin=request.headers.getlist('origin')
                if origin != ['http://'+request.headers.get('host','')]:
                    raise HTTPException(403,'Local writes require the same-origin NEXEN page.')
        except HTTPException as exc:
            return JSONResponse({'detail':exc.detail},status_code=exc.status_code)
        from starlette.concurrency import run_in_threadpool
        denied = await run_in_threadpool(auth_gate,request)
        if denied is not None:return denied
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['Referrer-Policy'] = 'same-origin'
        return response
    from pc_control import register as register_pc
    register_pc(app,db)
    from local_media import register as register_media
    register_media(app)
    from local_lab import register as register_lab
    register_lab(app)
    from memory_runtime import register as register_memory
    register_memory(app)
    from task_tracking import register as register_tasks
    register_tasks(app,db)
    from daily_plan import register as register_day
    register_day(app,db)
    from photo_inbox import register as register_photos
    photos = register_photos(app,db)
    from life_runtime import register as register_life
    register_life(app,db,photos)
    from problem_cases import register as register_cases
    app.state.problem_cases = register_cases(app,db,photos)
    from daily_checkin import register as register_checkin
    register_checkin(app,db)
    from plan_compiler import register as register_plans
    register_plans(app,db)
    from source_ingestion import register as register_sources
    sup.source_worker = register_sources(app,db)
    from action_requirements import register as register_requirements
    app.state.requirements = register_requirements(app,db)
    from automatic_mode import register as register_automatic
    app.state.automatic_mode = register_automatic(app,db,sup)
    from desktop_adapter import register as register_desktop
    app.state.desktop_adapter = register_desktop(app,db)
    from voice_runtime import register as register_voice
    register_voice(app,db)
    from next_step import register as register_next
    app.state.next_steps = register_next(app,db)
    from storage_runtime import register as register_storage
    register_storage(app)
    from development_runtime import register as register_development
    register_development(app)
    from code_review import register as register_code_review
    register_code_review(app,db)
    from task_scene import register as register_task_scene
    register_task_scene(app,db)
    from agentic_os import register as register_agentic_os
    register_agentic_os(app,db)
    from v1_readiness import register as register_v1_readiness
    app.state.readiness = register_v1_readiness(app,db)
    from kilo_bridge import register as register_kilo
    app.state.kilo = register_kilo(app,db)
    from continuity_worker import register as register_continuity
    app.state.continuity = register_continuity(app,db,app.state.kilo,app.state.automatic_mode)
    from handoff_runtime import register as register_handoff
    app.state.handoff = register_handoff(app,db)
    from agents_console import register as register_agents_console
    app.state.agents_console = register_agents_console(app,db)
    from youtube_memory import register as register_youtube_memory
    app.state.youtube_memory = register_youtube_memory(app,db)
    @app.get('/youtube-memory', response_class=HTMLResponse)
    def youtube_memory_page(request:Request):
        from pc_control import validate_request
        validate_request(request)
        return (BASE/'youtube-memory.html').read_text(encoding='utf-8')
    from money_engine import register as register_money
    app.state.money_engine = register_money(app,db)
    from music_render import register as register_music_render
    app.state.music_render = register_music_render(app,db)
    from wdr_lookbook import register as register_lookbook
    register_lookbook(app)
    mount_available_assets(app,'/branding','F:/NEXEN_GAME/branding','branding')
    mount_available_assets(app,'/vendor',BASE/'vendor','vendor')
    app.mount('/world-assets',StaticFiles(directory=BASE/'world-assets',check_dir=False),name='world-assets')
    with db.connect() as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS hub_skills(
          id TEXT PRIMARY KEY,name TEXT,collection TEXT,path TEXT,sha256 TEXT,description TEXT);
          CREATE TABLE IF NOT EXISTS hub_requests(
          id INTEGER PRIMARY KEY,text TEXT,status TEXT DEFAULT 'planned',created_at TEXT);
          CREATE TABLE IF NOT EXISTS hub_state(key TEXT PRIMARY KEY,value TEXT);''')

    def refresh_skills():
        if (BASE/'data/MIGRATION_LIBRARY_PENDING').exists() or not (BASE/'library').is_dir():
            with db.connect() as c:
                count=c.execute('SELECT count(*) FROM hub_skills').fetchone()[0]
            return {'count':count,'status':'Existing references retained while the library is unavailable or migrating.'}
        rows=[]
        root=BASE/'library'
        for collection in sorted(root.iterdir()) if root.exists() else []:
            if not collection.is_dir(): continue
            paths=collection.rglob('*.md') if collection.name=='agency-agents' else collection.rglob('SKILL.md')
            for p in paths:
                if '.git' in p.parts or p.is_symlink() or not p.resolve().is_relative_to(root.resolve()): continue
                if collection.name=='agency-agents' and (p.parent==collection or p.name.lower() in ('readme.md','agents.md','claude.md')): continue
                raw=p.read_bytes(); text=raw.decode('utf-8',errors='replace')
                title=next((line.lstrip('# ').strip() for line in text.splitlines() if line.startswith('# ')),p.parent.name if p.name=='SKILL.md' else p.stem)
                ident=hashlib.sha256(str(p.relative_to(root)).encode()).hexdigest()[:24]
                desc=' '.join(line.strip() for line in text.splitlines() if line.strip() and not line.startswith(('#','---')))[:350]
                rows.append((ident,title,collection.name,str(p),hashlib.sha256(raw).hexdigest(),desc))
        with db.connect() as c:
            c.execute('DELETE FROM hub_skills')
            c.executemany('INSERT INTO hub_skills VALUES(?,?,?,?,?,?)',rows)
        return {'count':len(rows),'status':'Reference library indexed; supporting scripts are not executed.'}

    def digest():
        report={'generated_at':datetime.now(timezone.utc).isoformat(),'source':str(DISCORD),'messages':[],'status':'not_connected'}
        if DISCORD.is_file():
            try:
                with closing(sqlite3.connect(DISCORD.resolve().as_uri()+'?mode=ro',uri=True,timeout=2)) as c:
                    c.row_factory=sqlite3.Row
                    c.execute('PRAGMA query_only=ON')
                    # Edits supersede earlier versions; deleted messages stay out of the digest.
                    rows=c.execute('''SELECT m.message_id,m.guild_id,m.channel_id,m.channel_name,m.content,m.created_at
                        FROM discord_messages m JOIN (SELECT message_id,MAX(version) v FROM discord_messages GROUP BY message_id) latest
                        ON m.message_id=latest.message_id AND m.version=latest.v
                        WHERE m.deleted=0 ORDER BY m.created_at DESC LIMIT 100''').fetchall()
                since=datetime.now(timezone.utc)-timedelta(hours=24)
                for row in rows:
                    r=dict(row)
                    try:
                        stamp=datetime.fromisoformat(r['created_at'].replace('Z','+00:00'))
                        if stamp.tzinfo is None: stamp=stamp.replace(tzinfo=timezone.utc)
                        if stamp<since: continue
                    except (ValueError,AttributeError): continue
                    r['content']=r.get('content') or ''
                    r['url']=f"https://discord.com/channels/{r['guild_id']}/{r['channel_id']}/{r['message_id']}"
                    report['messages'].append(r)
                report['status']='ready'
                report['coverage']='Up to 100 latest locally ingested messages, filtered to the last 24 hours. Does not fetch Discord live.'
            except sqlite3.Error as exc: report['error']=str(exc)
        save_digest(report, BASE/'data/discord-digest.json')
        db.event('discord_digest','Local Discord digest refreshed',data={'messages':len(report['messages']),'status':report['status']})
        return report

    def brief():
        s=sup.jarvis.snapshot()
        return ('Your NEXEN briefing\n\n'
            f"{s['files_indexed']} files indexed. {s['knowledge_items']} extracted notes.\n"
            f"{s['queued_jobs']} analysis jobs waiting; {s['failed_jobs']} failed.\n"
            f"{s['compiled_workflows']} workflow proposals prepared. These are not running business automations.\n"
            f"{s['awaiting_approval']} decisions waiting.\n\n"
            'First priority: rent assistance and the deadline on your written notice. Review Today and Tasks for next actions.\n'
            'Revenue and ad spending are not connected. Paid cloud fallbacks are disabled.\n'
            'NEXEN is running from F:. Check the live inventory status for scan health; full content ingestion is incomplete.')

    @app.get('/api/hub')
    def hub_status():
        return {'status':sup.jarvis.snapshot(),'skills':db.scalar('SELECT count(*) FROM hub_skills'),
            'collections':db.rows('SELECT collection,count(*) count FROM hub_skills GROUP BY collection'),
            'requests':db.rows('SELECT * FROM hub_requests ORDER BY id DESC LIMIT 30'),
            'brief':brief(),'points':db.scalar("SELECT count(*) FROM jobs WHERE status='done'") or 0}

    control_cache={'at':0,'services':[]}

    @app.get('/api/hub/control')
    def control_status():
        services=[('Original NEXEN',8770),('Multi-AI',8791),('LYFE',8792),('OmniRoute',20128),('Ollama',11434),('Screenpipe',3030),('OpenClaw',18789),('n8n',5678)]
        def probe(item):
            name,port=item
            try:
                with socket.create_connection(('127.0.0.1',port),timeout=.4):pass
                status='reachable';detail='Local port responds. Provider login and task execution need separate verification.'
            except OSError:status='unavailable';detail='No response on the configured local port.'
            return {'name':name,'url':f'http://127.0.0.1:{port}/','status':status,'detail':detail}
        if time.monotonic()-control_cache['at']>15:
            with ThreadPoolExecutor(max_workers=8) as pool:control_cache['services']=list(pool.map(probe,services))
            control_cache['at']=time.monotonic()
        memory={'messages':None,'conversations':None,'sources':None,'status':'not_indexed'}
        path=BASE/'data/exports/exports.sqlite3'
        if path.exists():
            try:
                with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=2)) as c:
                    memory={'messages':c.execute('SELECT count(*) FROM messages').fetchone()[0],
                        'conversations':c.execute('SELECT count(DISTINCT platform||conversation) FROM messages').fetchone()[0],
                        'sources':c.execute('SELECT count(DISTINCT source) FROM provenance').fetchone()[0],'status':'indexed'}
            except sqlite3.Error:memory['status']='temporarily_unavailable'
        def state(name):
            try:return json.loads((BASE/'data'/name).read_text(encoding='utf-8'))
            except (OSError,ValueError):return {'status':'unavailable'}
        return {'checked_at':datetime.now(timezone.utc).isoformat(),'services':control_cache['services'],'memory':memory,
            'census':state('census/status.json'),'watchdog':state('watchdog/status.json'),
            'autonomy':{'paused':(BASE/'data/PAUSE_AUTONOMY').exists(),'detail':'Pause takes effect between tasks; the dashboard remains available.'},
            'ads':{'status':'setup_required','detail':'No advertising account connected. Payment setup and checkout verification remain pending. No ad campaign launched by this integration.','daily_cap':50,'total_cap':50},
            'pc':{'status':'desktop_launch_available','detail':'Verified desktop app launch buttons and local operations are connected. Arbitrary mouse, keyboard and shell control are not connected.'}}

    @app.post('/api/hub/autonomy')
    def autonomy(mode:AutonomyMode,request:Request):
        from pc_control import validate_request
        validate_request(request,mutation=True)
        marker=BASE/'data/PAUSE_AUTONOMY'
        if not mode.paused and app.state.automatic_mode.maintenance()['active']:
            raise HTTPException(409,'Model migration is still being verified. Check Storage + models before resuming.')
        if mode.paused:marker.touch()
        else:marker.unlink(missing_ok=True)
        db.event('autonomy_pause' if mode.paused else 'autonomy_resume','Local autonomy pause requested' if mode.paused else 'Local autonomy resumed')
        return {'paused':mode.paused,'message':'Pause takes effect between tasks. The dashboard remains running.' if mode.paused else 'Local scheduled work can resume.'}

    @app.get('/api/hub/document/{name}',response_class=HTMLResponse)
    def document(name:str):
        names={'master':'NEXEN-MASTER.md','prompts':'NEXEN-PROMPTS.md','map':'NEXEN-MAP.html','lumipaw':'LUMIPAW-LAUNCH.md','handoff':'NEXEN-HANDOFF.md','rent':'RENT-ASSISTANCE.md','video':'NEXEN-VIDEO-BRIEF.md','drive-report':'F-AND-CLAUDE-REPORT.md','quality':'NEXEN-QUALITY-PLAN.md'}
        curated={'benefits':'BENEFITS-AND-STABILITY-PLAN.md','credit':'CREDIT-RECOVERY-PLAN.md',
                 'wdr-business':'WDR-BUSINESS-SETUP-PLAN.md','architecture-current':'NEXEN-ARCHITECTURE-CURRENT.md'}
        if name not in names and name not in curated:raise HTTPException(404,'Unknown document')
        p=Path('H:/NEXEN/knowledge')/curated[name] if name in curated else BASE/names[name]
        if not p.exists():raise HTTPException(404,'Document not yet available')
        text=p.read_text(encoding='utf-8-sig')
        if name=='map':return text
        return '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0c1420;color:#e5eef6;font:16px/1.65 system-ui;margin:30px;max-width:1000px}a{color:#abe7ff}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style><nav><a href="/" target="_top">NEXEN home</a> · <a href="/money" target="_top">Money Engine</a> · <a href="/tasks" target="_top">Shared tasks</a></nav><pre>'+escape(text)+'</pre>'

    @app.get('/api/skills')
    def skills(q:str=''):
        return db.rows('SELECT id,name,collection,description FROM hub_skills WHERE name LIKE ? OR description LIKE ? ORDER BY name LIMIT 100',('%'+q[:200]+'%','%'+q[:200]+'%'))

    @app.get('/skills/{skill_id}',response_class=HTMLResponse)
    def skill(skill_id:str):
        rows=db.rows('SELECT * FROM hub_skills WHERE id=?',(skill_id,))
        if not rows: raise HTTPException(404,'Skill not found')
        p=Path(rows[0]['path'])
        if p.is_symlink() or not p.resolve().is_relative_to((BASE/'library').resolve()): raise HTTPException(403,'Invalid skill path')
        return '<meta charset="utf-8"><a href="/">Back to NEXEN</a><h1>'+escape(rows[0]['name'])+'</h1><p>Reference material. Commands shown here are not automatically executed.</p><pre style="white-space:pre-wrap">'+escape(p.read_text(encoding='utf-8',errors='replace'))+'</pre>'

    @app.post('/api/hub/skills')
    def update_skills(): return refresh_skills()

    @app.post('/api/hub/digest')
    def make_digest(): return digest()

    @app.get('/api/hub/digest')
    def read_digest():
        p=BASE/'data/discord-digest.json'
        return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {'status':'not_generated','messages':[]}

    @app.post('/api/hub/request')
    def request(payload:RequestText):
        text=payload.text.strip()
        if text.lower()=='/digest': return digest()
        if text.lower()=='/skills': return refresh_skills()
        if text.lower() in ('/status','/jarvis'): return {'report':brief()}
        # Free text becomes a proposal, never a shell command.
        with db.connect() as c:
            cur=c.execute('INSERT INTO hub_requests(text,status,created_at) VALUES(?,?,?)',(text,'planned',datetime.now(timezone.utc).isoformat()))
        return {'id':cur.lastrowid,'status':'planned','message':'Saved as a request. An execution adapter is required before it can run.'}

    @app.get('/',response_class=HTMLResponse)
    def home(): return (BASE/'hub.html').read_text(encoding='utf-8')

    @app.get('/game',response_class=HTMLResponse)
    def game(): return (BASE/'game.html').read_text(encoding='utf-8')

    @app.get('/api/memory')
    def memory(q:str=''):
        path=BASE/'data/exports/exports.sqlite3'
        if not path.exists(): return {'results':[],'status':'not_indexed'}
        # Quote tokens as FTS literals; user text cannot introduce SQL or FTS operators.
        terms=q[:200].split()[:12]
        if not terms:return {'results':[],'status':'ready'}
        query=' AND '.join('"'+t.replace('"','""')+'"' for t in terms)
        with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=5)) as c:
            c.row_factory=sqlite3.Row
            rows=c.execute('SELECT m.title,m.role,m.ts,substr(m.text,1,3000) text FROM search s JOIN messages m ON m.key=s.key WHERE search MATCH ? ORDER BY m.ts DESC LIMIT 20',(query,)).fetchall()
        return {'results':[dict(r) for r in rows],'status':'ready','coverage':'Imported conversation text; results clipped to 3000 characters.'}

    @app.get('/guide',response_class=HTMLResponse)
    def guide():
        return '''<meta charset="utf-8"><style>body{font:18px/1.6 system-ui;max-width:850px;margin:50px auto;background:#10151b;color:#e4eff3}a{color:#85eed6}</style>
        <a href="/">Back to NEXEN</a><h1>Using your NEXEN</h1>
        <h2>Start your day</h2><p>Open Discord Digest first. It shows messages already captured by your existing NEXEN Discord integration. Refreshing it does not send any messages.</p>
        <h2>Turn an idea into work</h2><p>Enter your request on the home screen or in the mission room. It appears in your request list. A planned request is not a completed automation.</p>
        <h2>Use your skills</h2><p>Search the skills library for a task such as video, design, research or testing. Read the matching procedure. Reference files are indexed; their scripts and external services need separate setup.</p>
        <h2>Choose an AI</h2><p>Use your existing Multi-AI screen to compare answers. OpenClaw is an execution agent for supported tool tasks. Ollama runs local models. OmniRoute is the provider router; it does not remove provider usage limits. Codex is already signed in through ChatGPT.</p>
        <h2>Mission room</h2><p>Use W/A/S/D to walk, Shift to sprint, E to enter a nearby car and V to exit. Stations open the same features as the control center. Exploration points represent visited locations, not completed work or money.</p>
        <h2>Payments</h2><p>Use Amboras or the ad provider's checkout and billing page. Never paste a credit-card number into NEXEN's task field.</p>
        <h2>What is still being built</h2><p>Direct business execution, automatic Claude-to-Codex handoff, PC2 leasing, full archive ingestion, and the advanced memory compiler are pending. Check the connection status and recorded execution evidence for each tool.</p>'''

    refresh_skills()
    digest()
