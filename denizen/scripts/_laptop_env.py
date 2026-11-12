"""Read laptop SSH settings from the environment. No defaults on purpose.

Required: LAPTOP_SSH_HOST, LAPTOP_SSH_USER, and either LAPTOP_SSH_KEY (path to a
private key) or LAPTOP_SSH_PASS. Prefer key auth.
"""
import os
import sys


def connect_kwargs():
    host = os.environ.get('LAPTOP_SSH_HOST')
    user = os.environ.get('LAPTOP_SSH_USER')
    key = os.environ.get('LAPTOP_SSH_KEY')
    pw = os.environ.get('LAPTOP_SSH_PASS')
    missing = [n for n, v in (('LAPTOP_SSH_HOST', host), ('LAPTOP_SSH_USER', user)) if not v]
    if not key and not pw:
        missing.append('LAPTOP_SSH_KEY (or LAPTOP_SSH_PASS)')
    if missing:
        sys.exit('Missing required environment variables: ' + ', '.join(missing))
    kw = {'hostname': host, 'username': user, 'timeout': 20}
    if key:
        kw['key_filename'] = key
    else:
        kw['password'] = pw
    return kw
