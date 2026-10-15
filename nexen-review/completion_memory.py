"""Durable local status evidence and an owned Obsidian completion journal."""
from datetime import datetime, timezone
import hashlib
import html
import json
import os
from pathlib import Path
import tempfile
import threading

VAULT = Path("F:/NEXEN_MEMORY")
_EXPORT_LOCK = threading.Lock()


def ensure_schema(c):
    c.execute("""CREATE TABLE IF NOT EXISTS completion_memory(
        id INTEGER PRIMARY KEY, event_key TEXT UNIQUE NOT NULL,
        entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, title TEXT NOT NULL,
        status TEXT NOT NULL, body TEXT NOT NULL, basis TEXT NOT NULL,
        created_at TEXT NOT NULL, exported_at TEXT, exported_sha TEXT)""")


def record_event(c, event_key, entity_kind, entity_id, title, status, outcome='', basis='user_marked'):
    from memory_bridge import redact
    ensure_schema(c)
    label = 'COMPLETED' if status == 'done' else ('REOPENED' if status == 'reopened' else status.upper())
    safe_title = redact(title)[:12000]
    body = ('Status: '+label+'\nTask: '+safe_title+'\nCompletion basis: '+basis+
            '\nThis records a local status update, not independent proof of calls, payments or external execution.'+
            ('\nOutcome: '+redact(outcome)[:4000] if outcome else ''))
    cur = c.execute("""INSERT OR IGNORE INTO completion_memory
        (event_key,entity_kind,entity_id,title,status,body,basis,created_at)
        VALUES(?,?,?,?,?,?,?,?)""", (event_key,entity_kind,str(entity_id),safe_title,status,body,basis,datetime.now(timezone.utc).isoformat()))
    return cur.lastrowid if cur.rowcount else None


def export_journal(db, vault=None, limit=50):
    """A failed mirror never rolls back a saved completion; pending rows retry later."""
    if not _EXPORT_LOCK.acquire(blocking=False):
        return {'status':'pending','exported':0,'reason':'Another journal export is running'}
    try:
        root=Path(vault or getattr(db,'memory_vault',None) or VAULT)/'Plans'/'NEXEN Completion History'
        from memory_bridge import _reject_links
        _reject_links(root)
        marker=root/'.nexen-completion-owner.json'
        _reject_links(marker)
        if root.exists() and not marker.exists() and any(root.iterdir()):
            return {'status':'conflict','exported':0,'reason':'Existing journal folder is not exporter-owned'}
        root.mkdir(parents=True,exist_ok=True)
        if not marker.exists():
            with marker.open('x',encoding='utf-8') as stream:json.dump({'owner':'nexen-completion-v1'},stream)
        if json.loads(marker.read_text(encoding='utf-8')).get('owner')!='nexen-completion-v1':
            return {'status':'conflict','exported':0,'reason':'Journal owner mismatch'}
        with db.connect() as c:
            ensure_schema(c)
            rows=c.execute('SELECT id,event_key,title,status,body,basis,created_at FROM completion_memory WHERE exported_at IS NULL ORDER BY id LIMIT ?', (max(1,min(limit,500)),)).fetchall()
        exported,conflicts=0,[]
        for row in rows:
            ident,key,title,status,body,basis,created=row
            def quote(value):return html.escape(str(value),quote=False).replace('[','&#91;').replace(']','&#93;').replace('!','&#33;')
            text='---\nnexen_completion_event: '+str(ident)+'\nsource_id: '+json.dumps(key)+'\nstatus: '+json.dumps(status)+'\nrecorded_at: '+json.dumps(created)+'\n---\n\n# '+('COMPLETED' if status=='done' else status.upper())+'\n\n'+'\n'.join('> '+line for line in quote(body).splitlines())+'\n'
            content=text.encode('utf-8');sha=hashlib.sha256(content).hexdigest();path=root/f'event-{ident:08d}.md'
            _reject_links(path)
            if path.exists():
                if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
                    conflicts.append(ident);continue
            else:
                fd,tmp=tempfile.mkstemp(prefix='.completion-',suffix='.tmp',dir=root)
                try:
                    with os.fdopen(fd,'wb') as stream:stream.write(content)
                    # Windows rename refuses an existing destination: preserve user files.
                    os.rename(tmp,path)
                finally:
                    if os.path.exists(tmp):os.unlink(tmp)
            with db.connect() as c:c.execute('UPDATE completion_memory SET exported_at=?,exported_sha=? WHERE id=?', (datetime.now(timezone.utc).isoformat(),sha,ident))
            exported+=1
        return {'status':'conflict' if conflicts else 'ready','exported':exported,'conflict_event_ids':conflicts,'egress':'none'}
    except Exception as exc:
        return {'status':'pending','exported':0,'error_type':type(exc).__name__,'reason':'Completion is saved in the local database; Obsidian mirror needs retry'}
    finally:_EXPORT_LOCK.release()
