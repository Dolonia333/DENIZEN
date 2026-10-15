"""Read-only view of fixed NEXEN storage locations and the migration journal.

The owning app supplies authentication. Journal paths are data for display,
never paths to open. A copied byte count does not establish model readiness.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import stat

from fastapi.responses import HTMLResponse

BASE = Path(__file__).resolve().parent
MIGRATION_STATE = Path('H:/NEXEN/state/ollama-migration.json')
PREFERRED_ROOT = Path('H:/NEXEN')
PREFERRED_MODELS = Path('H:/NEXEN/models/ollama')
KNOWLEDGE_BASE = Path('F:/WDR_LIFEOS/KNOWLEDGE_BASE')
SHARED_MEMORY = Path('F:/NEXEN_MEMORY')
DRIVE_ROOTS = ('C:/', 'D:/', 'E:/', 'F:/', 'H:/')
MAX_STATE_BYTES = 256 * 1024
MAX_COUNTER = 2**63 - 1


def counter(value):
    return value if type(value) is int and 0 <= value <= MAX_COUNTER else None


def short_text(value, maximum=600):
    if not isinstance(value, str):
        return None
    return ''.join(c for c in value if c >= ' ' or c in '\n\t')[:maximum]


def read_migration(path=None):
    """Bounded read of the fixed journal. Optional path is for local fixtures."""
    journal = Path(path) if path is not None else MIGRATION_STATE
    unavailable = {'available': False, 'status': 'not_reported',
                   'detail': 'No migration journal is available yet. Transfer state is unconfirmed.',
                   'copy_percent': None, 'verification_percent': None,
                   'reported_complete': False, 'counts_complete': False, 'warnings': [],
                   'source': None, 'destination': None, 'current_file': None,
                   'started_at': None, 'finished_at': None, 'error': None,
                   'total_bytes': None, 'copied_bytes': None, 'verified_files': None,
                   'total_files': None, 'model_readiness': None}
    try:
        info = journal.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400 or not stat.S_ISREG(info.st_mode):
            raise ValueError('The journal is not a regular local file.')
        if info.st_size > MAX_STATE_BYTES:
            raise ValueError('The journal exceeds the bounded read limit.')
        with journal.open('rb') as stream:
            raw = stream.read(MAX_STATE_BYTES + 1)
        if len(raw) > MAX_STATE_BYTES:
            raise ValueError('The journal exceeds the bounded read limit.')
        data = json.loads(raw.decode('utf-8-sig'))
        if not isinstance(data, dict):
            raise ValueError('The journal must be a JSON object.')
    except FileNotFoundError:
        return unavailable
    except (OSError, ValueError, UnicodeError) as exc:
        unavailable.update(status='unavailable', detail='Migration journal cannot be read safely. It may be updating; refresh will retry.')
        return unavailable

    result = {'available': True, 'status': short_text(data.get('status'), 80) or 'unknown',
              'detail': 'Progress reported by the local model-migration journal.', 'warnings': []}
    for key in ('source', 'destination', 'current_file', 'started_at', 'finished_at', 'error'):
        result[key] = short_text(data.get(key))
    for key in ('total_bytes', 'copied_bytes', 'verified_files', 'total_files'):
        result[key] = counter(data.get(key))
        if key in data and result[key] is None:
            result['warnings'].append(f'{key} is invalid; its progress is not shown.')
    total, copied = result['total_bytes'], result['copied_bytes']
    files, verified = result['total_files'], result['verified_files']
    result['copy_percent'] = round(copied / total * 100, 2) if total and copied is not None and copied <= total else None
    result['verification_percent'] = round(verified / files * 100, 2) if files and verified is not None and verified <= files else None
    if total is not None and copied is not None and copied > total:
        result['warnings'].append('Copied bytes exceed the reported total; progress is unconfirmed.')
    if files is not None and verified is not None and verified > files:
        result['warnings'].append('Verified files exceed the reported total; progress is unconfirmed.')
    result['reported_complete'] = result['status'].lower() in ('complete', 'completed', 'done', 'verified')
    result['counts_complete'] = bool(total and files and copied == total and verified == files)
    if result['reported_complete'] and not result['counts_complete']:
        result['warnings'].append('Journal reports completion, but complete copy and verification counts are not available.')
    result['model_readiness'] = 'not_checked'
    return result


def drive_status(disk_usage=None):
    probe = disk_usage or shutil.disk_usage
    drives = []
    for root in DRIVE_ROOTS:
        record = {'drive': root[:2], 'available': False, 'total_bytes': None,
                  'used_bytes': None, 'free_bytes': None, 'used_percent': None}
        try:
            usage = probe(root)
            total, used, free = (counter(getattr(usage, key)) for key in ('total', 'used', 'free'))
            if total is None or total == 0 or used is None or free is None or used > total or free > total:
                raise ValueError('Invalid disk counters')
            record.update(available=True, total_bytes=total, used_bytes=used, free_bytes=free,
                          used_percent=round(used / total * 100, 2))
        except (OSError, ValueError, AttributeError):
            record['detail'] = 'Drive unavailable or free-space probe failed.'
        drives.append(record)
    return drives


def location(path, role):
    try:
        present = path.is_dir()
    except OSError:
        present = False
    return {'path': str(path), 'present': present, 'role': role}


def storage_status():
    return {'checked_at': datetime.now(timezone.utc).isoformat(), 'read_only': True,
            'poll_seconds': 30, 'drives': drive_status(), 'migration': read_migration(),
            'locations': {
                'preferred_root': location(PREFERRED_ROOT, 'Preferred new storage structure'),
                'preferred_models': location(PREFERRED_MODELS, 'Preferred Ollama model destination'),
                'runtime': location(BASE, 'This running module and app files'),
                'knowledge_base': location(KNOWLEDGE_BASE, 'Original knowledge base on F:'),
                'shared_memory': location(SHARED_MEMORY, 'Shared NEXEN memory on F:')},
            'scope': 'Fixed drive free-space checks and a bounded migration-journal read. No folder scans, deletion or model API calls.',
            'knowledge_note': 'The H: move is for models. The original knowledge base and shared memory remain on F:. Directory presence does not verify every file.',
            'readiness_note': 'Copy and verification percentages measure this model transfer only. They do not measure application completion or confirm a loaded model.'}


def register(app):
    # The owning app's existing global middleware protects both routes.
    @app.get('/storage', response_class=HTMLResponse)
    def page():
        return HTMLResponse((BASE / 'storage.html').read_text(encoding='utf-8'), headers={'Cache-Control': 'no-store'})

    @app.get('/api/storage/status')
    def status():
        return storage_status()
