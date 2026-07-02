#!/usr/bin/env python3
"""Upload probe script and run on laptop."""
from pathlib import Path
import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'
ROOT = Path(__file__).resolve().parent

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

for name in ('laptop-probe-scale.sh',):
    body = (ROOT / name).read_text().replace('\r\n', '\n')
    remote = f'/tmp/denizen-laptop-inspect/{name}'
    sftp = ssh.open_sftp()
    with sftp.file(remote, 'w') as f:
        f.write(body)
    sftp.chmod(remote, 0o755)
    sftp.close()
    _, o, e = ssh.exec_command(f'bash -lc "bash {remote}"', timeout=60)
    print(o.read().decode())
    err = e.read().decode().strip()
    if err:
        print('stderr:', err[:400])
ssh.close()
