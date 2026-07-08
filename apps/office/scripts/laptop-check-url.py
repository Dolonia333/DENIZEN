#!/usr/bin/env python3
import paramiko
s=paramiko.SSHClient(); s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('100.110.205.49', username='dolo', password='333', timeout=20)
for url in ['http://100.71.54.109:8081/api/visitor/ping', 'http://127.0.0.1:8081/api/visitor/ping']:
    _,o,_=s.exec_command(f'bash -lc "curl -sS -m 5 -w \\nhttp=%{{http_code}} {url}"', timeout=15)
    print(url, '->', o.read().decode().strip())
s.close()
