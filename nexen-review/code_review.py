"""Read-only review workspace entrypoint. Never uploads or requests a review."""
import json
import re
from pathlib import Path

from fastapi import Request
from fastapi.responses import HTMLResponse

BASE = Path(__file__).resolve().parent
RECEIPT = Path('H:/NEXEN/state/code-review.json')
REPOSITORY_URL = 'https://github.com/dbgamerboy/nexen-code-review'
CODERABBIT_URL = 'https://app.coderabbit.ai/settings/repositories'
MAX_RECEIPT_BYTES = 64 * 1024
STATES = {
    'not_recorded': 'No review receipt yet',
    'preparing': 'Preparing source snapshot',
    'uploading': 'Uploading selected source',
    'uploaded': 'Source upload recorded',
    'pr_open': 'Pull request opened',
    'review_requested': 'Review request recorded',
    'review_running': 'Review running as last observed',
    'review_complete': 'Review result recorded',
    'blocked': 'Review needs attention',
    'failed': 'Review attempt failed',
}
CHECK_STATES = {'passed', 'failed', 'pending', 'not_run', 'unknown'}


def _text(value, limit=1500):
    return value[:limit] if isinstance(value, str) else ''


def _lines(value):
    if not isinstance(value, list):
        return []
    return [_text(item, 600) for item in value[:40] if isinstance(item, str)]


def _sha(value, size):
    return value.lower() if isinstance(value, str) and re.fullmatch('[0-9a-fA-F]{%d}' % size, value) else None


def verified_pr(value, verified):
    if verified is not True or not isinstance(value, str):
        return None
    pattern = re.escape(REPOSITORY_URL) + r'/pull/[1-9][0-9]{0,11}'
    return value if re.fullmatch(pattern, value) else None


class CodeReview:
    def __init__(self, receipt_path=RECEIPT):
        self.receipt_path = Path(receipt_path)

    def status(self):
        data, receipt_state = {}, 'missing'
        try:
            with self.receipt_path.open('rb') as stream:
                raw = stream.read(MAX_RECEIPT_BYTES + 1)
            if len(raw) > MAX_RECEIPT_BYTES:
                raise ValueError('oversized receipt')
            data = json.loads(raw.decode('utf-8-sig'))
            if not isinstance(data, dict):
                raise ValueError('receipt must be an object')
            receipt_state = 'available'
        except FileNotFoundError:
            pass
        except (OSError, UnicodeError, ValueError):
            data, receipt_state = {}, 'unavailable'
        state = data.get('status')
        state = state if isinstance(state, str) and state in STATES else 'not_recorded'
        pr = verified_pr(data.get('pr_url'), data.get('pr_verified'))
        checks = []
        raw_checks = data.get('checks')
        if isinstance(raw_checks, list):
            for item in raw_checks[:30]:
                if isinstance(item, dict):
                    candidate = item.get('status')
                    check_state = candidate if isinstance(candidate, str) and candidate in CHECK_STATES else 'unknown'
                    checks.append({'name': _text(item.get('name'), 160), 'status': check_state,
                                   'scope': _text(item.get('scope'), 800)})
        count = data.get('files_uploaded')
        return {
            'receipt_state': receipt_state,
            'status': state,
            'status_label': STATES[state],
            'checked_at': _text(data.get('checked_at'), 80) or None,
            'repository_url': REPOSITORY_URL,
            'coderabbit_url': CODERABBIT_URL,
            'review_url': pr or CODERABBIT_URL,
            'pr_url': pr,
            'pr_verified': pr is not None,
            'snapshot_sha256': _sha(data.get('snapshot_sha256'), 64),
            'source_commit': _sha(data.get('source_commit'), 40),
            'files_uploaded': count if type(count) is int and 0 <= count <= 100000 else None,
            'scope': _lines(data.get('scope')),
            'exclusions': _lines(data.get('exclusions')),
            'checks': checks,
            'detail': _text(data.get('detail')),
            'status_source': 'Last local operator receipt; this page does not poll GitHub or CodeRabbit.',
            'can_upload_source': False,
            'can_request_cloud_review': False,
            'notice': 'Opening the workspace does not start an automated review. A review covers only its recorded snapshot and scope; it does not establish overall completion or autonomous PC control.',
        }


def register(app, db):
    from pc_control import validate_request
    review = CodeReview()

    @app.get('/code-review', response_class=HTMLResponse)
    def page(request: Request):
        validate_request(request)
        return (BASE / 'code-review.html').read_text(encoding='utf-8')

    @app.get('/api/code-review/status')
    def status(request: Request):
        validate_request(request)
        return review.status()

    return review
