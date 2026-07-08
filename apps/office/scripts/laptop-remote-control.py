#!/usr/bin/env python3
"""
Remote laptop control (HP81081D via Tailscale SSH).

Actions:
  fix-all          — setup + playwright UI drive (recommended)
  playwright [url] — visible Chromium clicks real Denizen UI
  launch           — start Denizen AppImage on laptop
  click-phone      — window-relative click (phone FAB area)
  click-profile    — window-relative click (Citizen ID area)
  windows          — list / find windows
  setup            — ydotoold + wmctrl + deploy scripts
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'
REMOTE = '/tmp/denizen-laptop-inspect'
PROBE = '/tmp/denizen-laptop-probe'
ROOT = Path(__file__).resolve().parent
DENIZEN = ROOT.parent
DEFAULT_URL = 'http://100.71.54.109:8081'

SCRIPTS = (
    'laptop-mouse-lib.sh',
    'laptop-find-window.sh',
    'laptop-click-in-window.sh',
    'laptop-get-scale.py',
    'laptop-playwright-visible.mjs',
)


def run(ssh, cmd, timeout=120):
    print(f'\n$ {cmd[:260]}')
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip().encode('ascii', errors='replace').decode())
    if err.strip():
        print('stderr:', err.rstrip()[:900].encode('ascii', errors='replace').decode())
    print(f'exit {code}')
    return code, out, err


def gui_wrap(inner: str) -> str:
    return f'''bash -lc '
      PID=$(pgrep -u dolo -n gnome-shell 2>/dev/null || pgrep -u dolo -n gnome-session 2>/dev/null)
      tr "\\0" "\\n" < /proc/$PID/environ | grep -E "^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR)=" > /tmp/denizen-gui.env
      set -a; source /tmp/denizen-gui.env; set +a
      {inner}
    ' '''


def connect():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f'Connecting to laptop {HOST}...')
    ssh.connect(HOST, username=USER, password=PASS, timeout=20)
    run(ssh, f'mkdir -p {REMOTE} {PROBE}/scripts/lib {PROBE}/reports/laptop-ui')
    return ssh


def upload_scripts(ssh):
    sftp = ssh.open_sftp()
    for name in SCRIPTS:
        body = (ROOT / name).read_text(encoding='utf-8').replace('\r\n', '\n')
        dest = f'{REMOTE}/{name}' if name.endswith('.sh') or name.endswith('.py') else f'{PROBE}/scripts/{name}'
        with sftp.file(dest, 'w') as fh:
            fh.write(body)
        if name.endswith('.sh'):
            sftp.chmod(dest, 0o755)
    # mouse-lib alias
    with sftp.file(f'{REMOTE}/mouse-lib.sh', 'w') as fh:
        fh.write((ROOT / 'laptop-mouse-lib.sh').read_text(encoding='utf-8').replace('\r\n', '\n'))
    sftp.chmod(f'{REMOTE}/mouse-lib.sh', 0o755)
    # probe login
    body = (ROOT / 'lib' / 'probe-login.mjs').read_text(encoding='utf-8').replace('\r\n', '\n')
    with sftp.file(f'{PROBE}/scripts/lib/probe-login.mjs', 'w') as fh:
        fh.write(body)
    env_src = DENIZEN / '.env'
    if env_src.exists():
        with sftp.file(f'{PROBE}/.env', 'w') as fh:
            fh.write(env_src.read_text(encoding='utf-8').replace('\r\n', '\n'))
    pkg = {'name': 'denizen-laptop-probe', 'private': True, 'type': 'module',
           'dependencies': {'playwright': '^1.49.0'}}
    with sftp.file(f'{PROBE}/package.json', 'w') as fh:
        fh.write(json.dumps(pkg, indent=2))
    sftp.close()


def setup(ssh):
    upload_scripts(ssh)
    run(ssh, gui_wrap(f'''
      echo 333 | sudo -S apt-get install -y ydotool wmctrl 2>&1 | tail -4
      echo 333 | sudo -S chmod 0666 /dev/uinput 2>/dev/null || true
      SOCK="$XDG_RUNTIME_DIR/ydotoold.sock"
      pkill -x ydotoold 2>/dev/null || true
      sleep 0.3
      rm -f "$SOCK"
      nohup ydotoold --socket-path="$SOCK" >> {REMOTE}/ydotoold.log 2>&1 &
      sleep 1
      ls -la "$SOCK" 2>&1 || true
      ln -sf {REMOTE}/laptop-mouse-lib.sh {REMOTE}/mouse-lib.sh
      ln -sf {REMOTE}/laptop-find-window.sh {REMOTE}/find-window.sh
      ln -sf {REMOTE}/laptop-click-in-window.sh {REMOTE}/click-in-window.sh
      python3 {REMOTE}/laptop-get-scale.py > {REMOTE}/calibration.json 2>/dev/null || echo '{{"scale":1}}' > {REMOTE}/calibration.json
      cat {REMOTE}/calibration.json
    '''), timeout=180)


def launch_denizen(ssh):
    run(ssh, gui_wrap(f'''
      if pgrep -f Denizen.AppImage >/dev/null; then echo already-running; exit 0; fi
      systemd-run --user --collect \\
        --setenv=DISPLAY="$DISPLAY" --setenv=WAYLAND_DISPLAY="$WAYLAND_DISPLAY" \\
        --setenv=XAUTHORITY="$XAUTHORITY" --setenv=DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \\
        --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \\
        "$HOME/Applications/Denizen.AppImage" >> {REMOTE}/denizen.log 2>&1
      echo "Waiting for Denizen..."
      for i in $(seq 1 30); do
        pgrep -f Denizen.AppImage >/dev/null && break
        sleep 1
      done
      pgrep -af Denizen || true
      curl -sS -m 5 http://127.0.0.1:8081/api/visitor/ping 2>&1 || echo local-8081-down
    '''), timeout=120)


def run_playwright(ssh, base_url: str):
    upload_scripts(ssh)
    return run(ssh, gui_wrap(f'''
      cd {PROBE}
      export DENIZEN_URL="{base_url}"
      export CHROMIUM_PATH="/usr/bin/chromium"
      if [ ! -d node_modules/playwright ]; then
        npm install --omit=dev 2>&1 | tail -6
        npx playwright install chromium 2>&1 | tail -4 || true
      fi
      node scripts/laptop-playwright-visible.mjs "$DENIZEN_URL"
    '''), timeout=600)


def window_click(ssh, rx: str, ry: str, pattern: str = 'denizen'):
    upload_scripts(ssh)
    run(ssh, gui_wrap(f'''
      export YDOTOOL_SOCKET="$XDG_RUNTIME_DIR/ydotoold.sock"
      bash {REMOTE}/laptop-click-in-window.sh "{pattern}" {rx} {ry}
    '''), timeout=60)


def list_windows(ssh):
    upload_scripts(ssh)
    run(ssh, gui_wrap(f'bash {REMOTE}/laptop-find-window.sh denizen'), timeout=30)
    run(ssh, gui_wrap('wmctrl -lG 2>/dev/null | head -15 || echo no-wmctrl'), timeout=20)


def pull_review(ssh):
    local_dir = DENIZEN / 'reports' / 'laptop-ui'
    local_dir.mkdir(parents=True, exist_ok=True)
    sftp = ssh.open_sftp()
    remote_dir = f'{PROBE}/reports/laptop-ui'
    pulled = []
    try:
        for name in sftp.listdir(remote_dir):
            if not (name.endswith('.png') or name.endswith('.json')):
                continue
            sftp.get(f'{remote_dir}/{name}', str(local_dir / name))
            pulled.append(name)
    except OSError as e:
        print('pull warning:', e)
    sftp.close()
    print(json.dumps({'pulled': sorted(pulled)}, indent=2))
    return pulled


def review(ssh, base_url: str):
    setup(ssh)
    launch_denizen(ssh)
    code, _, _ = run_playwright(ssh, base_url)
    pulled = pull_review(ssh)
    review_path = None
    for name in sorted(pulled, reverse=True):
        if name.startswith('review-') and name.endswith('.json'):
            review_path = DENIZEN / 'reports' / 'laptop-ui' / name
            break
    if review_path and review_path.exists():
        text = review_path.read_text(encoding='utf-8')
        print(text.encode('ascii', errors='replace').decode())
    return code, pulled


def fix_all(ssh, base_url: str):
    setup(ssh)
    launch_denizen(ssh)
    code, _, _ = run_playwright(ssh, base_url)
    if code != 0:
        print('Playwright failed — trying window-relative clicks on AppImage...')
        run(ssh, gui_wrap(f'sleep 3; bash {REMOTE}/laptop-find-window.sh denizen'), timeout=30)
        window_click(ssh, '92', '92', 'denizen')
        window_click(ssh, '50', '55', 'denizen')
    pull_review(ssh)
    print(json.dumps({'ok': code == 0, 'action': 'fix-all', 'url': base_url}, indent=2))
    return code


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'fix-all'
    base_url = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_URL
    ssh = connect()
    try:
        if action == 'setup':
            setup(ssh)
        elif action == 'launch':
            setup(ssh)
            launch_denizen(ssh)
        elif action in ('playwright', 'ui'):
            setup(ssh)
            code, _, _ = run_playwright(ssh, base_url)
            pull_review(ssh)
            sys.exit(code)
        elif action == 'review':
            code, _ = review(ssh, base_url)
            sys.exit(code)
        elif action == 'windows':
            setup(ssh)
            list_windows(ssh)
        elif action == 'click-phone':
            setup(ssh)
            window_click(ssh, '92', '92')
        elif action == 'click-profile':
            setup(ssh)
            window_click(ssh, '50', '55')
        elif action == 'fix-all':
            code = fix_all(ssh, base_url)
            sys.exit(0 if code == 0 else 1)
        else:
            print(f'Unknown: {action}')
            print('Try: fix-all | review | playwright [url] | launch | click-phone | click-profile | windows | setup')
            sys.exit(1)
    finally:
        ssh.close()


if __name__ == '__main__':
    main()
