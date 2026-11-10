"""Bounded, resumable local note ingestion from the existing metadata census.

Source text is evidence. This module never enqueues model analysis or execution.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time

from memory_bridge import redact, _reject_links
from text_utils import chunk_text, utcnow

BASE=Path(__file__).resolve().parent
MANIFEST=BASE/'data/source-roots.json'
TEXT={'.md','.markdown','.txt','.json','.jsonl','.csv','.tsv'}
ARCHIVES={'.rar','.zip','.7z','.tar','.gz'}
SKIP={'.git','.venv','venv','node_modules','__pycache__','.cache','cache','caches','temp','tmp','models','model','blobs','downloads','checkpoints','weights','logs','generated_workflows','test-work','work','dist','build','harnesses','library','nexen_tools'}


class SourceIngestion:
    def __init__(self,db,manifest=MANIFEST,census=None):
        self.db=db
        self.manifest=Path(manifest)
        self.census=Path(census or BASE/'data/census/census.sqlite3')
        self.settings=json.loads(self.manifest.read_text(encoding='utf-8-sig'))
        with db.connect() as c:
            c.executescript('''CREATE TABLE IF NOT EXISTS source_roots(path TEXT PRIMARY KEY,cursor INTEGER NOT NULL DEFAULT 0,last_discovered_at TEXT);
            CREATE TABLE IF NOT EXISTS source_queue(path TEXT PRIMARY KEY,root TEXT NOT NULL,state TEXT NOT NULL,reason TEXT,expected_size INTEGER,expected_mtime INTEGER,file_id INTEGER,sha256 TEXT,read_bytes INTEGER DEFAULT 0,text_chars INTEGER DEFAULT 0,attempts INTEGER DEFAULT 0,updated_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS source_pending ON source_queue(state,root,updated_at);
            CREATE TABLE IF NOT EXISTS source_passes(id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,stats_json TEXT NOT NULL);''')

    def classify(self,path):
        p=Path(path)
        parts={v.lower() for v in p.parts}
        if parts & SKIP:return 'excluded','cache_model_dependency_or_generated'
        name=p.name.lower()
        if name in {'state.json','status.json','manifest.json','package.json','package-lock.json','requirements.txt'} or name.endswith(('_state.json','_port.txt')) or name.startswith(('events.','errors.')):
            return 'excluded','generated_runtime_state_or_dependency_metadata'
        if p.name.lower().startswith('.env') or any(word in p.stem.lower() for word in ('credential','secret','api_key','token','password','auth-cache')):
            return 'excluded','credential_configuration'
        if p.suffix.lower() in ARCHIVES:return 'pending_archive','archive_requires_bounded_parser'
        if p.suffix.lower() not in TEXT:return 'excluded','unsupported_content_type'
        return 'pending','approved_text_evidence'

    def discover(self,per_root=250):
        if not self.census.is_file():return {'status':'census_unavailable','observed':0}
        observed=0
        with closing(sqlite3.connect(self.census.resolve().as_uri()+'?mode=ro',uri=True,timeout=3)) as source:
            source.execute('PRAGMA query_only=ON');source.execute('PRAGMA temp_store=MEMORY')
            for root in self.settings['roots']:
                if not root.get('enabled'):continue
                path=str(Path(root['path']))
                with self.db.connect() as c:
                    c.execute('INSERT OR IGNORE INTO source_roots(path) VALUES(?)',(path,))
                    cursor=c.execute('SELECT cursor FROM source_roots WHERE path=?',(path,)).fetchone()[0]
                prefix=path.rstrip('\\/')+'\\'
                rows=source.execute('SELECT rowid,path,size,modified_ns FROM files WHERE rowid>? AND path>=? AND path<? ORDER BY rowid LIMIT ?',(cursor,prefix,prefix+'\uffff',max(1,min(per_root,1000)))).fetchall()
                with self.db.connect() as c:
                    for ident,name,size,mtime in rows:
                        state,reason=self.classify(name)
                        if state=='pending' and size>1024*1024:state,reason='pending_large','file_exceeds_1_MiB_bounded_read'
                        c.execute('''INSERT INTO source_queue(path,root,state,reason,expected_size,expected_mtime,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(path) DO NOTHING''',(name,path,state,reason,size,mtime,utcnow()))
                    if rows:c.execute('UPDATE source_roots SET cursor=?,last_discovered_at=? WHERE path=?',(rows[-1][0],utcnow(),path))
                observed+=len(rows)
        return {'status':'snapshot_progress','observed':observed,'census_may_still_be_growing':True}

    def discover_top_level(self):
        """Catch original root notes added after the census snapshot; no recursion."""
        observed=0
        for root in self.settings['roots']:
            if not root.get('enabled'):continue
            path=Path(root['path'])
            try:
                _reject_links(path)
                with os.scandir(path) as entries:
                    candidates=[]
                    for i,entry in enumerate(entries):
                        if i>=150:break
                        if entry.is_file(follow_symlinks=False):candidates.append(Path(entry.path))
                with self.db.connect() as c:
                    for p in candidates:
                        st=p.stat();state,reason=self.classify(p)
                        if state=='pending' and st.st_size>1024*1024:state,reason='pending_large','file_exceeds_1_MiB_bounded_read'
                        c.execute('INSERT OR IGNORE INTO source_queue(path,root,state,reason,expected_size,expected_mtime,updated_at) VALUES(?,?,?,?,?,?,?)',(str(p),str(path),state,reason,st.st_size,st.st_mtime_ns,utcnow()))
                        observed+=1
            except (OSError,ValueError):continue
        return observed

    def reconcile_exclusions(self):
        """Remove only this worker's generated-text chunks after classification tightens."""
        with self.db.connect() as c:
            rows=c.execute("SELECT path,state,file_id FROM source_queue WHERE state IN ('pending','indexed','indexed_partial')").fetchall()
            for row in rows:
                state,reason=self.classify(row['path'])
                if state!='excluded':continue
                if row['file_id'] is not None:
                    c.execute('DELETE FROM chunks WHERE file_id=?',(row['file_id'],))
                    c.execute("UPDATE files SET extraction_status='excluded_generated',text_chars=0 WHERE id=?",(row['file_id'],))
                c.execute('UPDATE source_queue SET state=?,reason=?,text_chars=0,updated_at=? WHERE path=?',(state,reason,utcnow(),row['path']))

    def _read_one(self,item,remaining):
        p=Path(item['path']);root=Path(item['root']).resolve()
        _reject_links(p)
        p.resolve().relative_to(root)
        state,reason=self.classify(p)
        if state!='pending':return {'state':state,'reason':reason,'read_bytes':0}
        st=p.stat()
        if st.st_size>min(1024*1024,remaining):return {'state':'pending_large','reason':'current_size_exceeds_read_budget','read_bytes':0}
        # Read once, bounded by the verified size. A changed file is retried explicitly.
        with p.open('rb') as stream:raw=stream.read(st.st_size)
        after=p.stat()
        if len(raw)!=st.st_size or after.st_size!=st.st_size or after.st_mtime_ns!=st.st_mtime_ns:
            return {'state':'changed','reason':'source_changed_during_read','read_bytes':len(raw)}
        sha=hashlib.sha256(raw).hexdigest()
        text=redact(raw.decode('utf-8-sig',errors='replace')).replace('\x00',' ')
        partial=len(text)>180000
        text=text[:180000]
        status='source_partial' if partial else ('ok' if text.strip() else 'empty')
        with self.db.connect() as c:
            c.execute('''INSERT INTO files(path,size_bytes,mtime,sha256,extension,indexed_at,extraction_status,text_chars) VALUES(?,?,?,?,?,?,?,?)
              ON CONFLICT(path) DO UPDATE SET size_bytes=excluded.size_bytes,mtime=excluded.mtime,sha256=excluded.sha256,extension=excluded.extension,indexed_at=excluded.indexed_at,extraction_status=excluded.extraction_status,text_chars=excluded.text_chars''',(str(p),st.st_size,st.st_mtime,sha,p.suffix.lower(),utcnow(),status,len(text)))
            fid=c.execute('SELECT id FROM files WHERE path=?',(str(p),)).fetchone()[0]
            c.execute('DELETE FROM chunks WHERE file_id=?',(fid,))
            for i,chunk in enumerate(chunk_text(text)):
                c.execute('INSERT INTO chunks(file_id,chunk_index,text,created_at) VALUES(?,?,?,?)',(fid,i,chunk,utcnow()))
        return {'state':'indexed_partial' if partial else 'indexed','reason':'local_redacted_text_only_no_execution','read_bytes':len(raw),'text_chars':len(text),'file_id':fid,'sha256':sha}

    def run_pass(self,max_files=25,max_bytes=4*1024*1024,seconds=20,discover=True):
        from file_census import SingleWriter
        state_dir=self.manifest.parent/'source-ingestion';state_dir.mkdir(parents=True,exist_ok=True)
        with SingleWriter(state_dir):
            started=time.monotonic();stats={'files_attempted':0,'read_files':0,'read_bytes':0,'indexed':0,'errors':0,'execution_jobs_queued':0,'network_submissions':0}
            if discover:
                stats['discovery']=self.discover()
                stats['top_level_metadata_observed']=self.discover_top_level()
            self.reconcile_exclusions()
            limit=max(1,min(int(max_files),25));budget=max(0,min(int(max_bytes),4*1024*1024))
            # Root rotation gives original LIFE OS and NEXEN folders equal access to a pass.
            roots=[str(Path(r['path'])) for r in self.settings['roots'] if r.get('enabled')]
            candidates=[]
            with self.db.connect() as c:
                c.execute("UPDATE source_queue SET state='pending' WHERE state='working'")
                pools=[c.execute("SELECT * FROM source_queue WHERE root=? AND state='pending' ORDER BY (length(path)-length(replace(path,char(92),''))),path LIMIT ?",(root,limit)).fetchall() for root in roots]
            for i in range(limit):
                candidates.extend(dict(pool[i]) for pool in pools if i<len(pool))
            for item in candidates:
                if stats['files_attempted']>=limit or stats['read_bytes']>=budget or time.monotonic()-started>max(1,min(seconds,60)):break
                if item['expected_size']>budget-stats['read_bytes']:continue
                with self.db.connect() as c:c.execute("UPDATE source_queue SET state='working',attempts=attempts+1 WHERE path=?",(item['path'],))
                try:result=self._read_one(item,budget-stats['read_bytes'])
                except (OSError,ValueError) as exc:result={'state':'error','reason':type(exc).__name__,'read_bytes':0};stats['errors']+=1
                stats['files_attempted']+=1;stats['read_files']+=int(result['state'].startswith('indexed') or result['read_bytes']>0);stats['read_bytes']+=result['read_bytes']
                stats['indexed']+=int(result['state'].startswith('indexed'))
                with self.db.connect() as c:c.execute('UPDATE source_queue SET state=?,reason=?,read_bytes=?,text_chars=?,file_id=?,sha256=?,updated_at=? WHERE path=?',(result['state'],result['reason'],result['read_bytes'],result.get('text_chars',0),result.get('file_id'),result.get('sha256'),utcnow(),item['path']))
            stats['elapsed_seconds']=round(time.monotonic()-started,3)
            with self.db.connect() as c:c.execute('INSERT INTO source_passes(created_at,stats_json) VALUES(?,?)',(utcnow(),json.dumps(stats)))
            return {'pass':stats,'coverage':self.status()}

    def status(self):
        with self.db.connect() as c:
            counts=[dict(r) for r in c.execute('SELECT root,state,count(*) files,sum(read_bytes) read_bytes,sum(text_chars) text_chars FROM source_queue GROUP BY root,state')]
            reasons=[dict(r) for r in c.execute('SELECT state,reason,count(*) files FROM source_queue GROUP BY state,reason')]
            last=c.execute('SELECT created_at,stats_json FROM source_passes ORDER BY id DESC LIMIT 1').fetchone()
        return {'roots':self.settings['roots'],'coverage':counts,'reasons':reasons,'last_pass':{'created_at':last[0],**json.loads(last[1])} if last else None,'scope':'Only classified census entries and explicitly indexed text; census names do not mean content was read. Large files and archives remain pending. Indexed sources are not executed.','complete':False,'egress':'none','limits':{'files':25,'bytes':4194304,'bytes_per_file':1048576,'text_chars_per_file':180000}}


def register(app,db):
    worker=SourceIngestion(db)
    @app.get('/api/sources/status')
    def status():return worker.status()
    return worker


if __name__=='__main__':
    from nexen import DB
    parser=argparse.ArgumentParser();parser.add_argument('--status',action='store_true');args=parser.parse_args()
    worker=SourceIngestion(DB(str(BASE/'data/nexen.db')))
    print(json.dumps(worker.status() if args.status else worker.run_pass(),indent=2))
