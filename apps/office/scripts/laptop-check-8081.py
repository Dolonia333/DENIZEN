#!/usr/bin/env python3
import paramiko
s=paramiko.SSHClient(); s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('100.110.205.49', username='dolo', password='333', timeout=20)
_,o,_=s.exec_command('bash -lc "curl -sS -m 3 -o /dev/null -w %{http_code} http://127.0.0.1:8081/ 2>&1; echo; pgrep -af Denizen 2>/dev/null | head -2"', timeout=15)
print(o.read().decode())
s.close()
