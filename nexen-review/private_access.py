"""Authenticate the fixed private Tailscale proxy before normalizing local guards.

Configuration and identity remain in the local data file. This module never
enables Serve, requests certificates, exposes configuration, or changes ports.
"""
import hmac
import ipaddress
import json
from pathlib import Path
from fastapi import HTTPException, Request

CONFIG = Path(__file__).resolve().parent / 'data' / 'private-access.json'
LOCAL_HOSTS = {'127.0.0.1:8788', 'localhost:8788', '[::1]:8788'}


def configuration():
    try:
        value = json.loads(CONFIG.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def status():
    conf = configuration()
    return {'enabled': conf.get('enabled') is True,
            'scope': 'private_tailnet_only', 'requires_tailscale_on_phone': True,
            'password_required': True, 'encrypted_access_required': True}


def normalize_private_request(request: Request) -> bool:
    """Return True only after authenticating the private proxy's owner identity.

    Uvicorn must run with proxy_headers=False so request.client is the actual
    loopback proxy peer, never a caller-supplied X-Forwarded-For address.
    Browser navigation may omit Origin; mutations must supply the exact HTTPS
    origin. Identity-bearing requests with rewritten/ambiguous hosts fail closed.
    """
    if request.scope.get('_nexen_private_normalized') is True:
        return True
    raw = list(request.scope.get('headers', []))
    def values(name):
        return [v.decode('latin-1') for k, v in raw if k.lower() == name]
    def reject():
        raise HTTPException(403, 'Private access is unavailable or the request is not authorized.')
    hosts = values(b'host')
    identities = values(b'tailscale-user-login')
    if len(hosts) != 1:
        reject()
    host = hosts[0].lower()
    # A plain local request retains the existing PC/auth guards. A proxy identity
    # on a local Host is ambiguous and must not gain the local-only setup path.
    if host in LOCAL_HOSTS:
        if identities:
            reject()
        request.state.private_access = False
        return False
    conf = configuration()
    allowed = conf.get('allowed_host', '')
    login = conf.get('allowed_tailscale_user_login', '')
    valid_config = (conf.get('enabled') is True and conf.get('protocol') == 'https'
        and conf.get('port') == 443 and isinstance(allowed, str)
        and allowed == allowed.lower() and allowed.endswith('.ts.net')
        and not any(c in allowed for c in '/:@ \t\r\n')
        and isinstance(login, str) and bool(login.strip()))
    if not valid_config or host not in {allowed, allowed + ':443'}:
        reject()
    if conf.get('allowed_origin') != 'https://' + allowed:
        reject()
    try:
        loopback = request.client is not None and ipaddress.ip_address(request.client.host).is_loopback
    except ValueError:
        loopback = False
    if not loopback or len(identities) != 1 or not identities[0]:
        reject()
    if not hmac.compare_digest(identities[0].encode('utf-8'), login.encode('utf-8')):
        reject()
    origins = values(b'origin')
    if len(origins) > 1 or (origins and origins[0] != conf['allowed_origin']):
        reject()
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and len(origins) != 1:
        reject()
    remove = {b'host', b'origin', b'x-forwarded-for', b'x-forwarded-host',
              b'x-forwarded-proto', b'forwarded', b'x-nexen-service'}
    headers = [(k, v) for k, v in raw if k.lower() not in remove]
    headers.append((b'host', b'127.0.0.1:8788'))
    if origins:
        headers.append((b'origin', b'http://127.0.0.1:8788'))
    request.scope['headers'] = headers
    request.scope['_nexen_private_normalized'] = True
    request.state.private_access = True
    for name in ('_headers', '_url', '_base_url'):
        request.__dict__.pop(name, None)
    return True
