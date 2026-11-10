"""Read a bounded development checkpoint alongside actual model transfer state."""
import json
from pathlib import Path
from fastapi import HTTPException

CHECKPOINT=Path('H:/NEXEN/state/development.json')

def register(app):
    @app.get('/api/development/status')
    def status():
        from storage_runtime import read_migration
        try:
            with CHECKPOINT.open('rb') as stream: raw=stream.read(65537)
            if len(raw)>65536: raise ValueError('Oversized checkpoint')
            data=json.loads(raw)
            if not isinstance(data,dict): raise ValueError('Invalid checkpoint')
            checkpoint={key:str(data.get(key,''))[:1500] for key in ('updated_at','title','detail')}
            checkpoint['steps']=[{'label':str(x.get('label',''))[:200], 'status':str(x.get('status',''))[:100]}
                                 for x in data.get('steps',[])[:12] if isinstance(x,dict)]
        except (OSError,ValueError,TypeError):
            checkpoint={'title':'Development checkpoint unavailable','detail':'The application remains available. Check tasks for saved work.','updated_at':'','steps':[]}
        return {'checkpoint':checkpoint,'model_transfer':read_migration(),
                'scope':'A dated development checkpoint and actual transfer counters; not proof an agent is continually controlling the PC.'}
