"""Shared, local memory entry point for NEXEN model calls and browser tools."""
from pathlib import Path
import threading
from typing import Literal

from fastapi import HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field

from memory_bridge import SharedMemory

BASE = Path(__file__).resolve().parent
VAULT = Path('F:/NEXEN_MEMORY')
_sync_lock = threading.Lock()


def shared_memory():
    return SharedMemory(BASE / 'data/exports/exports.sqlite3', vault=VAULT,
                        knowledge_db=BASE / 'data/nexen.db')


def context_for(query, task_type='code', pool=None):
    from knowledge_flow import flow_for
    packet = shared_memory().build_context(query, task_type=task_type,
                                          max_chars=6000, limit=5,pool=pool)
    packet['flow'] = flow_for(packet)
    return packet


def enrich_prompt(prompt, task_type='code', pool=None):
    packet = context_for(prompt, task_type, pool)
    return prompt_with_context(prompt, packet)


def prompt_with_context(prompt, packet):
    context = packet.get('text', '')
    if not context:
        raise ValueError('Shared memory returned no context. Check the memory index.')
    from knowledge_flow import answer_instructions
    return (answer_instructions() + '\n\nNEXEN SHARED CONTEXT\n' + context +
            '\nEND SHARED CONTEXT\n\nCURRENT REQUEST\n' + prompt)


class ContextRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    query: str = Field(min_length=1, max_length=12000)
    task_type: Literal['code', 'workflow', 'automation'] = 'code'
    pool: Literal['all','commerce','music','life','game','voice','automation','engineering'] | None = None


def register(app):
    @app.get('/memory-pools', response_class=HTMLResponse)
    def memory_workspace():
        return (BASE/'memory-pools.html').read_text(encoding='utf-8')

    @app.post('/api/memory/context')
    def memory_context(body: ContextRequest):
        return context_for(body.query, body.task_type,body.pool)

    @app.get('/api/memory/pools')
    def pools():
        from memory_pools import POOLS
        return {'pools':[{'id':key,'label':value['label']} for key,value in POOLS.items()],
                'storage':'Existing conversation, source-note, file-chunk and completion indexes; no duplicate knowledge database.',
                'context_route':'/api/memory/context','local_only':True}

    @app.post('/api/memory/sync')
    def sync_memory():
        if not _sync_lock.acquire(blocking=False):
            raise HTTPException(409, 'An Obsidian memory refresh is already running.')
        try:
            return shared_memory().sync_vault()
        finally:
            _sync_lock.release()

    @app.get('/api/memory/bridge')
    def memory_bridge_status():
        return {
            'vault': str(VAULT),
            'vault_exists': VAULT.is_dir(),
            'context_route': '/api/memory/context',
            'sync_route': '/api/memory/sync',
            'local_lab': 'attached',
            'model_router': 'attached',
            'external_harnesses': 'separate_adapter_required',
            'scope': 'Relevant indexed sources and selected current decisions; not every file on F:.',
            'egress': 'none',
        }
