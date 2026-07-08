#!/usr/bin/env python3
import paramiko
s=paramiko.SSHClient(); s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect('100.110.205.49', username='dolo', password='333', timeout=20)
cmds = [
    'ls -d /home/dolo/multbot/denizen /home/dolo/OneDrive/Desktop/multbot/denizen 2>/dev/null || echo NO_REPO',
    'test -d /home/dolo/multbot/denizen/node_modules/playwright && echo HAS_PW || echo NO_PW',
    'command -v chromium chromium-browser google-chrome 2>/dev/null || true',
]
for c in cmds:
    _,o,_=s.exec_command(f'bash -lc "{c}"', timeout=20)
    print(c, '->', o.read().decode().strip())
s.close()
