#!/usr/bin/env python3
from pathlib import Path
import paramiko
ROOT = Path(__file__).resolve().parent
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('100.110.205.49', username='dolo', password='333', timeout=20)
body = (ROOT / 'laptop-window-find.sh').read_text().replace('\r\n', '\n')
sftp = ssh.open_sftp()
with sftp.file('/tmp/denizen-laptop-inspect/window-find.sh', 'w') as f:
    f.write(body)
sftp.chmod('/tmp/denizen-laptop-inspect/window-find.sh', 0o755)
sftp.close()
_, o, _ = ssh.exec_command('bash -lc "bash /tmp/denizen-laptop-inspect/window-find.sh"', timeout=30)
print(o.read().decode())
ssh.close()
