#!/usr/bin/env python3
"""
Run headed Playwright on the laptop (correct UI clicks, visible browser window).
Bundles probe scripts to /tmp and runs with GNOME session env.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'
REMOTE = '/tmp/denizen-laptop-probe'
ROOT = Path(__file__).resolve().parent
DENIZEN = ROOT.parent


def run(ssh, cmd, timeout=300):
    print(f'\n$ {cmd[:200]}')
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip().encode('ascii', errors='replace').decode())
    if err.strip():
        print('stderr:', err.rstrip()[:1000])
    print(f'exit {code}')
    return code, out, err


def upload_tree(ssh):
    sftp = ssh.open_sftp()
    run(ssh, f'mkdir -p {REMOTE}/scripts/lib {REMOTE}/reports')

    files = [
        (ROOT / 'laptop-playwright-visible.mjs', f'{REMOTE}/scripts/laptop-playwright-visible.mjs'),
        (ROOT / 'lib' / 'probe-login.mjs', f'{REMOTE}/scripts/lib/probe-login.mjs'),
        (ROOT / 'laptop-get-scale.py', f'{REMOTE}/scripts/laptop-get-scale.py'),
        (ROOT / 'laptop-mouse-lib.sh', f'{REMOTE}/scripts/laptop-mouse-lib.sh'),
    ]
    env_src = DENIZEN / '.env'
    if env_src.exists():
        files.append((env_src, f'{REMOTE}/.env'))

    for local, remote in files:
        body = local.read_text(encoding='utf-8').replace('\r\n', '\n')
        with sftp.file(remote, 'w') as fh:
            fh.write(body)

    pkg = {
        'name': 'denizen-laptop-probe',
        'private': True,
        'type': 'module',
        'dependencies': {'playwright': '^1.49.0'},
    }
    with sftp.file(f'{REMOTE}/package.json', 'w') as fh:
        fh.write(json.dumps(pkg, indent=2))

    sftp.close()


def main():
    base_url = sys.argv[1] if len(sys.argv) > 1 else 'https://denizen.dolonia.cloud'
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=20)

    upload_tree(ssh)

    inner = f'''
      PID=$(pgrep -u dolo -n gnome-shell 2>/dev/null || pgrep -u dolo -n gnome-session)
      tr "\\0" "\\n" < /proc/$PID/environ | grep -E "^(DISPLAY|WAYLAND|XAUTHORITY|DBUS|XDG)=" > /tmp/denizen-gui.env
      set -a; source /tmp/denizen-gui.env; set +a
      cd {REMOTE}
      if [ ! -d node_modules/playwright ]; then
        npm install --omit=dev 2>&1 | tail -8
        npx playwright install chromium 2>&1 | tail -5
      fi
      python3 scripts/laptop-get-scale.py > /tmp/denizen-laptop-inspect/calibration.json 2>/dev/null || echo '{{"scale":1}}' > /tmp/denizen-laptop-inspect/calibration.json
      cat /tmp/denizen-laptop-inspect/calibration.json
      export DENIZEN_URL="{base_url}"
      node scripts/laptop-playwright-visible.mjs "$DENIZEN_URL"
    '''

    code, _, _ = run(ssh, f"bash -lc '{inner}'", timeout=600)
    ssh.close()
    sys.exit(code)


if __name__ == '__main__':
    main()
