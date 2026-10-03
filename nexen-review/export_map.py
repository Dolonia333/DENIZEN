"""Read-only export census and provenance-preserving conversation index. No source execution."""
import os, re, json, sqlite3, zipfile, hashlib, argparse
from pathlib import Path
from datetime import datetime, timezone

BASE=Path(__file__).resolve().parent/'data'/'exports'
BASE.mkdir(parents=True,exist_ok=True)
DB=BASE/'exports.sqlite3'
RX=re.compile(r'^conversations(?:-\d+)?\.json$',re.I)
def connect():
    c=sqlite3.connect(DB,timeout=30)
    c.executescript('''CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,size INTEGER,modified REAL,kind TEXT,status TEXT);
    CREATE TABLE IF NOT EXISTS messages(key TEXT PRIMARY KEY,platform TEXT,conversation TEXT,title TEXT,role TEXT,ts TEXT,text TEXT);
    CREATE TABLE IF NOT EXISTS provenance(key TEXT,source TEXT,member TEXT,PRIMARY KEY(key,source,member));
    CREATE TABLE IF NOT EXISTS errors(path TEXT,error TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(key UNINDEXED,text);
    CREATE TABLE IF NOT EXISTS decisions(topic TEXT PRIMARY KEY,selected TEXT,reason TEXT,superseded TEXT);''')
    return c
def stamp(x):
    if isinstance(x,(int,float)):
        if x>100_000_000_000:x/=1000
        try:return datetime.fromtimestamp(x,timezone.utc).isoformat()
        except (ValueError,OSError):return ''
    return str(x or '')
def ingest(c,data,source,member):
    count=0
    if isinstance(data,dict): data=[data] if 'messages' in data else data.get('conversations',[])
    if not isinstance(data,list): return 0
    for conv in data:
        if not isinstance(conv,dict):continue
        cid=conv.get('id') or conv.get('uuid') or conv.get('conversation_id') or ''
        title=conv.get('title') or conv.get('name') or ''
        platform='chatgpt' if 'mapping' in conv else ('claude-code' if 'messages' in conv else 'claude')
        entries=[x.get('message') for x in conv.get('mapping',{}).values()] if platform=='chatgpt' else conv.get('chat_messages',conv.get('messages',[]))
        for m in entries:
            if not isinstance(m,dict):continue
            content=m.get('content',{})
            if isinstance(content,dict): body='\n'.join(x for x in content.get('parts',[]) if isinstance(x,str))
            elif isinstance(content,list):body='\n'.join(x.get('text','') for x in content if isinstance(x,dict) and isinstance(x.get('text',''),str))
            else:body=str(content or '')
            body=m.get('text') or body
            if not body:continue
            role=m.get('author',{}).get('role') or m.get('sender') or m.get('role','')
            if role=='human':role='user'
            ts=stamp(m.get('create_time') or m.get('created_at') or m.get('timestamp'))
            key=hashlib.sha256(json.dumps([platform,cid,m.get('id') or m.get('uuid'),role,ts,body],ensure_ascii=False).encode()).hexdigest()
            cur=c.execute('INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?,?)',(key,platform,cid,title,role,ts,body))
            if cur.rowcount:c.execute('INSERT INTO search VALUES(?,?)',(key,body));count+=1
            c.execute('INSERT OR IGNORE INTO provenance VALUES(?,?,?)',(key,str(source),member))
    return count
def inspect(c,p):
    try:
        stat=p.stat();kind='archive' if p.suffix.lower()=='.zip' else 'export'
        prev=c.execute('SELECT size,modified,status FROM files WHERE path=?',(str(p),)).fetchone()
        if prev and prev==(stat.st_size,stat.st_mtime,'indexed'):return
        c.execute('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?)',(str(p),stat.st_size,stat.st_mtime,kind,'inventoried'))
        if kind=='archive':
            with zipfile.ZipFile(p) as z:
                members=[i for i in z.infolist() if RX.match(Path(i.filename).name)]
                for i in members:
                    if i.file_size>256*1024**2:raise ValueError('Conversation member exceeds 256 MiB parser limit; retained for streaming follow-up')
                    with z.open(i) as f:ingest(c,json.load(f),p,i.filename)
        else:
            if stat.st_size>256*1024**2:raise ValueError('Export exceeds 256 MiB parser limit')
            with p.open(encoding='utf-8-sig') as f:ingest(c,json.load(f),p,'')
        c.execute('UPDATE files SET status=? WHERE path=?',('indexed',str(p)));c.commit()
    except Exception as e:
        c.rollback();c.execute('INSERT INTO errors VALUES(?,?)',(str(p),str(e)));c.commit()
def scan(roots):
    c=connect();seen=0
    def error(e):c.execute('INSERT INTO errors VALUES(?,?)',(str(e.filename),str(e)));c.commit()
    for root in roots:
        for folder,dirs,files in os.walk(root,followlinks=False,onerror=error):
            dirs[:]=[d for d in dirs if d.lower() not in {'.git','node_modules','.venv','$recycle.bin','system volume information'} and not getattr(Path(folder)/d, 'is_junction', lambda: False)() and not (Path(folder)/d).is_symlink()]
            for name in files:
                seen+=1;p=Path(folder)/name
                if RX.match(name) or (name.startswith('imported-claude') and p.suffix.lower()=='.json') or p.suffix.lower()=='.zip':inspect(c,p)
                if seen%1000==0:report(c,seen,False)
    report(c,seen,True);c.close()
def report(c,seen,complete):
    result={'updated':datetime.now(timezone.utc).isoformat(),'discovery_complete':complete,'files_seen':seen,'archives_and_exports':c.execute('SELECT count(*) FROM files').fetchone()[0],'messages':c.execute('SELECT count(*) FROM messages').fetchone()[0],'conversations':c.execute('SELECT count(DISTINCT platform||conversation) FROM messages').fetchone()[0],'errors':c.execute('SELECT count(*) FROM errors').fetchone()[0],'rule':'Message timestamps establish chronology. File modification time is discovery evidence only. Semantic conflicts require a reasoned decision; originals are never deleted.'}
    (BASE/'status.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('roots',nargs='+');args=p.parse_args();scan(args.roots)
