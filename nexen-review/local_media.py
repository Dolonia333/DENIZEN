"""Local music only: fixed library roots and opaque IDs, never arbitrary file serving."""
from pathlib import Path
import hashlib
from fastapi import HTTPException, Request
from fastapi.responses import FileResponse
from pc_control import validate_request

ROOTS=(Path('F:/05_AI/LOCAL_USER 2026 demo'),Path('F:/05_AI/LOCAL_USER - WDR Choppa'))
TYPES={'.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac'}

def catalog():
    tracks={}
    for root in ROOTS:
        if not root.is_dir():continue
        for p in root.iterdir():
            if p.suffix.lower() not in TYPES or not p.is_file() or p.is_symlink():continue
            if not p.resolve().is_relative_to(root.resolve()):continue
            key=hashlib.sha256(str(p).encode()).hexdigest()[:24]
            tracks[key]={'id':key,'title':p.stem,'collection':root.name,'bytes':p.stat().st_size,'path':p,'url':f'/api/music/{key}/stream'}
    return tracks

def register(app):
    @app.get('/api/music')
    def list_music(request:Request):
        validate_request(request)
        return {'tracks':[{k:v for k,v in t.items() if k!='path'} for t in catalog().values()],
            'coverage':'Two identified local demo folders. Private local playback; no upload or streaming-service connection.'}

    @app.get('/api/music/{track_id}/stream')
    def stream(track_id:str,request:Request):
        validate_request(request)
        track=catalog().get(track_id)
        if not track:raise HTTPException(404,'Track not in the local music library')
        return FileResponse(track['path'],media_type=TYPES[track['path'].suffix.lower()])
