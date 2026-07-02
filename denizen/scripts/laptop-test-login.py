#!/usr/bin/env python3
import json, paramiko
s=paramiko.SSHClient(); s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('100.110.205.49', username='dolo', password='333', timeout=20)
# read creds from uploaded probe .env on laptop or hardcode test
payload = json.dumps({"username":"Dolonia","password":"333","team_code":"1921","email":"zionvanzandt@gmail.com"})
cmd = f'''bash -lc 'curl -sS -m 30 -X POST http://100.71.54.109:8081/api/visitor/auth/login -H "Content-Type: application/json" -d '{payload}' | head -c 400' '''
_,o,e=s.exec_command(cmd, timeout=45)
print(o.read().decode())
print(e.read().decode())
s.close()
