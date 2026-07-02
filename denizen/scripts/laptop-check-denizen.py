#!/usr/bin/env python3
"""Quick SSH check of Denizen launch log on laptop."""
import paramiko
s = paramiko.SSHClient()
s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('100.110.205.49', username='dolo', password='333', timeout=20)
for cmd in [
    'tail -20 /tmp/denizen-laptop-inspect/denizen.log 2>/dev/null || echo no-log',
    'pgrep -af Denizen || echo not-running',
    'curl -sS -m 3 http://127.0.0.1:8081/api/visitor/ping 2>&1 || true',
]:
    print('---', cmd)
    _, o, e = s.exec_command(cmd, timeout=15)
    print(o.read().decode().strip())
s.close()
