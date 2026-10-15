"""Local photo inbox. Captions are user notes; image understanding is pending."""
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import re
import struct
import tempfile
import uuid

from fastapi import HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

MAX_BYTES = 8 * 1024 * 1024
INBOX_ROOT = Path('F:/NEXEN_GAME/NEXEN_Autonomy_v0.1/data/photo-inbox')
TYPES = {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}
STATUS = 'awaiting_visual_analysis'
ID = re.compile(r'^[a-f0-9]{32}$')
HASH = re.compile(r'^[a-f0-9]{64}$')


def now(): return datetime.now(timezone.utc).isoformat()


def identify(data):
    """Header/container validation, not OCR or a claim to interpret the picture."""
    if len(data)>=33 and data.startswith(b'\x89PNG\r\n\x1a\n') and data[12:16]==b'IHDR':
        if struct.unpack('>I',data[8:12])[0] != 13:
            raise HTTPException(415,'Invalid PNG header.')
        width,height=struct.unpack('>II',data[16:24])
        if width==0 or height==0:
            raise HTTPException(415,'Invalid PNG dimensions.')
        return 'image/png'
    if len(data)>=4 and data.startswith(b'\xff\xd8\xff') and data.endswith(b'\xff\xd9'):
        return 'image/jpeg'
    if len(data)>=20 and data[:4]==b'RIFF' and data[8:12]==b'WEBP' and data[12:16] in (b'VP8 ',b'VP8L',b'VP8X'):
        if struct.unpack('<I',data[4:8])[0]+8 != len(data):
            raise HTTPException(415,'Invalid WebP container size.')
        return 'image/webp'
    raise HTTPException(415,'Choose a PNG, JPEG or WebP image. The file header was not recognized.')


async def read_upload(request):
    declared=request.headers.get('content-type','').split(';',1)[0].lower().strip()
    if declared not in TYPES:
        raise HTTPException(415,'Upload the raw PNG, JPEG or WebP file with its matching image Content-Type.')
    length=request.headers.get('content-length')
    if length is not None:
        try: expected=int(length)
        except ValueError: raise HTTPException(400,'Invalid upload length.')
        if expected<0: raise HTTPException(400,'Invalid upload length.')
        if expected>MAX_BYTES: raise HTTPException(413,'Photos must be 8 MiB or smaller.')
    data=bytearray()
    async for chunk in request.stream():
        if len(data)+len(chunk)>MAX_BYTES:
            raise HTTPException(413,'Photos must be 8 MiB or smaller.')
        data.extend(chunk)
    if not data: raise HTTPException(400,'The photo upload is empty.')
    if length is not None and len(data)!=expected: raise HTTPException(400,'The upload length does not match the body.')
    return bytes(data),declared


def _check_root(root):
    root=Path(root).absolute()
    if os.name=='nt' and root.drive.lower()!='f:':
        raise ValueError('Photo inbox storage must stay on F:')
    for item in (root,*root.parents):
        if item.exists() and (item.is_symlink() or getattr(item,'is_junction',lambda:False)()):
            raise ValueError('Photo storage cannot use a linked directory')
    return root.resolve()


class PhotoStore:
    def __init__(self,db,root=INBOX_ROOT):
        self.db=db;self.root=_check_root(root);self.root.mkdir(parents=True,exist_ok=True)
        with db.connect() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS photo_inbox(
              id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, mime TEXT NOT NULL,
              bytes INTEGER NOT NULL, created_at TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'awaiting_visual_analysis');
            CREATE TABLE IF NOT EXISTS photo_notes(
              id INTEGER PRIMARY KEY, photo_id TEXT NOT NULL, caption TEXT NOT NULL,
              create_plan INTEGER NOT NULL DEFAULT 0, request_id INTEGER,
              created_at TEXT NOT NULL, UNIQUE(photo_id,caption,create_plan));
            CREATE INDEX IF NOT EXISTS photo_notes_photo ON photo_notes(photo_id,id);
            CREATE TABLE IF NOT EXISTS hub_requests(
              id INTEGER PRIMARY KEY,text TEXT,status TEXT DEFAULT 'planned',created_at TEXT);
            ''')

    def _path(self,sha,mime):
        if not HASH.fullmatch(str(sha)) or mime not in TYPES: raise HTTPException(404,'Photo not found.')
        _check_root(self.root)
        path=self.root/(sha+TYPES[mime])
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise HTTPException(409,'The photo storage entry is not a regular file.')
        if not path.resolve().is_relative_to(self.root): raise HTTPException(404,'Photo not found.')
        return path

    def _write(self,path,data,sha):
        if path.exists():
            if path.stat().st_size!=len(data) or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
                raise HTTPException(409,'Stored photo integrity check failed; no existing file was overwritten.')
            return
        fd,tmp=tempfile.mkstemp(prefix='.upload-',suffix='.tmp',dir=self.root)
        try:
            with os.fdopen(fd,'wb') as out:
                out.write(data);out.flush();os.fsync(out.fileno())
            os.replace(tmp,path)
        finally:
            if os.path.exists(tmp):os.unlink(tmp)

    @staticmethod
    def _public(row):
        item=dict(row)
        item['image_url']='/api/photos/'+item['id']+'/image'
        item['analysis_status']=item['status']
        return item

    def put(self,data,declared):
        if not data:raise HTTPException(400,'The photo upload is empty.')
        if len(data)>MAX_BYTES:raise HTTPException(413,'Photos must be 8 MiB or smaller.')
        mime=identify(data)
        if declared!=mime:raise HTTPException(415,'The declared image type does not match the file header.')
        sha=hashlib.sha256(data).hexdigest();path=self._path(sha,mime)
        with self.db.connect() as c:
            # Serializes same-hash uploads and gives duplicate uploads one stable ID.
            c.execute('BEGIN IMMEDIATE')
            previous=c.execute('SELECT * FROM photo_inbox WHERE sha256=?',(sha,)).fetchone()
            self._write(path,data,sha)
            if previous:return {'photo':self._public(previous),'duplicate':True}
            ident=uuid.uuid4().hex
            c.execute('INSERT INTO photo_inbox(id,sha256,mime,bytes,created_at,status) VALUES(?,?,?,?,?,?)',
                (ident,sha,mime,len(data),now(),STATUS))
            row=c.execute('SELECT * FROM photo_inbox WHERE id=?',(ident,)).fetchone()
            return {'photo':self._public(row),'duplicate':False}

    def get(self,ident):
        if not ID.fullmatch(str(ident)):raise HTTPException(404,'Photo not found.')
        with self.db.connect() as c:
            row=c.execute('SELECT * FROM photo_inbox WHERE id=?',(ident,)).fetchone()
            if not row:raise HTTPException(404,'Photo not found.')
            result=self._public(row)
            result['notes']=[dict(n) for n in c.execute('SELECT id,caption,create_plan,request_id,created_at FROM photo_notes WHERE photo_id=? ORDER BY id DESC',(ident,))]
        return result

    def file(self,ident):
        item=self.get(ident);path=self._path(item['sha256'],item['mime'])
        if not path.is_file():raise HTTPException(404,'The indexed photo file is unavailable.')
        return path,item['mime']

    def list(self,limit=60,offset=0):
        limit=max(1,min(int(limit),100));offset=max(0,int(offset))
        with self.db.connect() as c:
            rows=c.execute('''SELECT p.*,
              (SELECT caption FROM photo_notes n WHERE n.photo_id=p.id ORDER BY n.id DESC LIMIT 1) AS caption,
              (SELECT count(*) FROM photo_notes n WHERE n.photo_id=p.id) AS note_count,
              (SELECT request_id FROM photo_notes n WHERE n.photo_id=p.id AND request_id IS NOT NULL ORDER BY n.id DESC LIMIT 1) AS request_id
              FROM photo_inbox p ORDER BY p.created_at DESC,p.id LIMIT ? OFFSET ?''',(limit,offset)).fetchall()
            total=c.execute('SELECT count(*) FROM photo_inbox').fetchone()[0]
            pending=c.execute('SELECT count(*) FROM photo_inbox WHERE status=?',(STATUS,)).fetchone()[0]
        return {'items':[self._public(r) for r in rows],'total':total,'pending_analysis':pending,
                'offset':offset,'limit':limit,'analysis_worker':'not_configured',
                'message':'Images are stored locally. Captions are user notes; image content has not been analyzed.'}

    def note(self,ident,caption,create_plan=False):
        if not ID.fullmatch(str(ident)):raise HTTPException(404,'Photo not found.')
        caption=str(caption).strip()
        if not caption or len(caption)>3000:raise HTTPException(422,'A caption must contain 1 to 3000 characters.')
        with self.db.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            photo=c.execute('SELECT * FROM photo_inbox WHERE id=?',(ident,)).fetchone()
            if not photo:raise HTTPException(404,'Photo not found.')
            previous=c.execute('SELECT * FROM photo_notes WHERE photo_id=? AND caption=? AND create_plan=?',
                (ident,caption,int(bool(create_plan)))).fetchone()
            if previous:return {'note':dict(previous),'duplicate':True,'analysis_status':photo['status']}
            request_id=None;created=now()
            if create_plan:
                text=('NEXEN Life photo note\n\nUser caption:\n'+caption+
                    '\n\nSource: photo '+ident+'; SHA-256 '+photo['sha256']+'; uploaded '+photo['created_at']+'.'+
                    '\nImage analysis: awaiting_visual_analysis. This planned request comes from the user caption, not inferred image content.')
                request_id=c.execute('INSERT INTO hub_requests(text,status,created_at) VALUES(?,?,?)',(text,'planned',created)).lastrowid
            note_id=c.execute('INSERT INTO photo_notes(photo_id,caption,create_plan,request_id,created_at) VALUES(?,?,?,?,?)',
                (ident,caption,int(bool(create_plan)),request_id,created)).lastrowid
            note=c.execute('SELECT * FROM photo_notes WHERE id=?',(note_id,)).fetchone()
            return {'note':dict(note),'duplicate':False,'analysis_status':photo['status']}


class CaptionBody(BaseModel):
    model_config=ConfigDict(extra='forbid')
    caption:str=Field(min_length=1,max_length=3000)
    create_plan:bool=False


def _guard(request,write=False):
    # Reuse the existing local Host/client guard. Its mutation mode is specific
    # to desktop launches, so photo writes use the same-origin part separately.
    from pc_control import validate_request
    validate_request(request)
    if write and request.headers.getlist('origin')!=['http://'+request.headers.get('host','')]:
        raise HTTPException(403,'Photo writes require the same-origin NEXEN page.')


def register(app,db,*,inbox_root=INBOX_ROOT):
    store=PhotoStore(db,inbox_root)

    @app.get('/photos',response_class=HTMLResponse)
    def photos_page(request:Request):
        _guard(request)
        return HTMLResponse((Path(__file__).parent/'photos.html').read_text(encoding='utf-8'),headers={'Cache-Control':'no-store'})

    @app.get('/api/photos')
    def list_photos(request:Request,limit:int=Query(60,ge=1,le=100),offset:int=Query(0,ge=0)):
        _guard(request);return store.list(limit,offset)

    @app.get('/api/photos/queue')
    def analysis_queue(request:Request):
        _guard(request);result=store.list()
        return {**result,'items':[item for item in result['items'] if item['status']==STATUS]}

    @app.post('/api/photos')
    async def upload_photo(request:Request):
        _guard(request,write=True)
        data,declared=await read_upload(request)
        result=await run_in_threadpool(store.put,data,declared)
        return JSONResponse(result,status_code=200 if result['duplicate'] else 201)

    @app.get('/api/photos/{ident}')
    def get_photo(ident:str,request:Request):
        _guard(request);return store.get(ident)

    @app.get('/api/photos/{ident}/image')
    def photo_image(ident:str,request:Request):
        _guard(request);path,mime=store.file(ident)
        return FileResponse(path,media_type=mime,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
            'Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline; filename="nexen-photo'+TYPES[mime]+'"'})

    @app.post('/api/photos/{ident}/note')
    def add_note(ident:str,body:CaptionBody,request:Request):
        _guard(request,write=True)
        return store.note(ident,body.caption,body.create_plan)

    return store
