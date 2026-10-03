"""One owned, time-bounded provider process for background ingestion requests."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time

MAX_INPUT = 256 * 1024
MAX_OUTPUT = 1024 * 1024
MAX_ERROR = 64 * 1024
MAX_SECONDS = 120
ROOT = Path('H:/NEXEN/temp/supervisor-provider')


def worker_runtime():
    """Bypass Windows venv redirectors so the owned PID is the request worker."""
    base = Path(getattr(sys, '_base_executable', sys.executable)).resolve()
    expected = (Path(sys.base_prefix) / ('python.exe' if os.name == 'nt' else 'bin/python')).resolve()
    packages = Path(sys.prefix) / ('Lib/site-packages' if os.name == 'nt' else f'lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages')
    if not base.is_file() or not packages.is_dir() or (os.name == 'nt' and base != expected):
        raise ProviderRequestError('WorkerRuntimeUnavailable')
    return base, packages.resolve()


class ProviderRequestError(RuntimeError):
    """Safe child failure metadata without prompts, URLs or credentials."""
    def __init__(self, error_class, status_code=None):
        self.provider_error_class = error_class if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,79}', str(error_class)) else 'ProviderFailure'
        self.status_code = status_code if type(status_code) is int and 100 <= status_code <= 599 else None
        super().__init__('Background provider request did not complete.')


def run_request(payload, stop_requested, *, root=ROOT, max_seconds=MAX_SECONDS,
                popen=subprocess.Popen, clock=time.monotonic):
    """Send private input through stdin and stop only the process created here."""
    from storage_policy import require_output_path, tool_environment
    raw = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    if len(raw) > MAX_INPUT:
        raise ProviderRequestError('RequestTooLarge')
    if stop_requested():
        return None
    root = require_output_path(root)
    root.mkdir(parents=True, exist_ok=True)
    environment = tool_environment(root / 'profile')
    executable, packages = worker_runtime()
    environment['NEXEN_PROVIDER_PACKAGES'] = str(packages)
    with tempfile.TemporaryDirectory(prefix='request-', dir=root) as temporary:
        folder = require_output_path(temporary, within=root)
        output = require_output_path(folder/'response.json', within=root)
        errors = require_output_path(folder/'stderr.log', within=root)
        process = writer = None
        write_failed = threading.Event()
        try:
            with output.open('xb') as out, errors.open('xb') as err:
                if stop_requested():
                    return None
                process = popen([str(executable), '-I', '-S', '-B', str(Path(__file__).resolve()), '--worker'],
                                stdin=subprocess.PIPE, stdout=out, stderr=err,
                                cwd=str(Path(__file__).resolve().parent), env=environment,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                def feed():
                    try:
                        process.stdin.write(raw)
                        process.stdin.close()
                    except (OSError, ValueError):
                        write_failed.set()
                writer = threading.Thread(target=feed, daemon=True, name='nexen-provider-input')
                writer.start()
                deadline = clock() + max(.01, min(MAX_SECONDS, float(max_seconds)))
                while process.poll() is None:
                    if stop_requested():
                        return None
                    if clock() >= deadline:
                        raise ProviderRequestError('RequestDeadlineExceeded')
                    if output.stat().st_size > MAX_OUTPUT or errors.stat().st_size > MAX_ERROR:
                        raise ProviderRequestError('ResponseTooLarge')
                    time.sleep(.02)
                writer.join(timeout=1)
                if writer.is_alive() or write_failed.is_set() or process.returncode:
                    raise ProviderRequestError('WorkerFailed')
            if output.stat().st_size > MAX_OUTPUT or errors.stat().st_size > MAX_ERROR:
                raise ProviderRequestError('ResponseTooLarge')
            result = json.loads(output.read_text(encoding='utf-8'))
            if not isinstance(result, dict) or type(result.get('ok')) is not bool:
                raise ProviderRequestError('InvalidWorkerResponse')
            if not result['ok']:
                raise ProviderRequestError(result.get('error_class'), result.get('http_status'))
            value = result.get('text')
            if value is not None and not isinstance(value, str):
                raise ProviderRequestError('InvalidWorkerResponse')
            return value
        finally:
            # Never terminate a saved PID, sibling worker, model server or unrelated app.
            try:
                if process is not None and process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
            finally:
                if writer is not None:
                    writer.join(timeout=1)
                if (process is not None and process.stdin is not None and not process.stdin.closed
                        and (writer is None or not writer.is_alive())):
                    process.stdin.close()


def provider_text(data):
    """Execute a fixed provider request; no source imports or arbitrary commands."""
    import httpx
    if not isinstance(data, dict) or data.get('provider') not in {'ollama', 'openai', 'anthropic'}:
        raise ValueError('Invalid provider')
    if not isinstance(data.get('prompt'), str) or not isinstance(data.get('model'), str):
        raise ValueError('Invalid request')
    timeout = httpx.Timeout(MAX_SECONDS, connect=5, write=5, pool=5)
    if data['provider'] == 'ollama':
        if not isinstance(data.get('base_url'), str):
            raise ValueError('Invalid local endpoint')
        seconds = max(1, min(MAX_SECONDS, float(data.get('timeout_seconds', MAX_SECONDS))))
        response = httpx.post(data['base_url'].rstrip('/')+'/api/generate',
                              json={'model':data['model'], 'prompt':data['prompt'], 'stream':False},
                              timeout=httpx.Timeout(seconds, connect=5, write=5, pool=5))
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise ValueError('Invalid provider response')
        return body.get('response')
    if data['provider'] == 'openai':
        from openai import OpenAI
        with OpenAI(timeout=timeout, max_retries=0) as client:
            return client.responses.create(model=data['model'], input=data['prompt']).output_text
    import anthropic
    with anthropic.Anthropic(timeout=timeout, max_retries=0) as client:
        message = client.messages.create(model=data['model'], max_tokens=4000,
                                         messages=[{'role':'user', 'content':data['prompt']}])
        return ''.join(block.text for block in message.content if getattr(block, 'type', '') == 'text')


def main():
    if sys.argv[1:] != ['--worker']:
        raise SystemExit('This is a fixed internal provider worker.')
    try:
        # -I -S skips user/system site initialization and .pth execution. Restore
        # only the installed dependency directory chosen by the trusted parent.
        packages = Path(os.environ.get('NEXEN_PROVIDER_PACKAGES', ''))
        if not packages.is_absolute() or not packages.is_dir():
            raise ValueError('Missing worker dependencies')
        sys.path.insert(0, str(packages))
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise ValueError('Oversized input')
        text = provider_text(json.loads(raw.decode('utf-8')))
        if text is not None and not isinstance(text, str):
            raise ValueError('Invalid provider text')
        result = {'ok':True, 'text':text}
        encoded = json.dumps(result, ensure_ascii=False).encode('utf-8')
        if len(encoded) > MAX_OUTPUT:
            raise ValueError('Oversized response')
    except Exception as error:
        status = getattr(error, 'status_code', None)
        if status is None:
            status = getattr(getattr(error, 'response', None), 'status_code', None)
        result = {'ok':False, 'error_class':type(error).__name__}
        if type(status) is int and 100 <= status <= 599:
            result['http_status'] = status
        encoded = json.dumps(result).encode('utf-8')
    sys.stdout.buffer.write(encoded)


if __name__ == '__main__':
    main()
