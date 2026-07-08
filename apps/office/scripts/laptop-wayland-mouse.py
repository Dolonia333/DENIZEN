#!/usr/bin/env python3
"""Install ydotoold on laptop and run visible mouse via Wayland uinput."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'
REMOTE_OUT = '/tmp/denizen-laptop-inspect'
ROOT = Path(__file__).resolve().parent


def run(ssh, cmd, timeout=120):
    print(f'\n$ {cmd[:240]}')
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print('stderr:', err.rstrip()[:600])
    print(f'exit {code}')
    return code, out, err


def gui_env_cmd(inner: str) -> str:
    return f'''bash -lc '
      PID=$(pgrep -u dolo -n gnome-shell 2>/dev/null || pgrep -u dolo -n gnome-session 2>/dev/null)
      tr "\\0" "\\n" < /proc/$PID/environ | grep -E "^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR)=" > /tmp/denizen-gui.env
      set -a; source /tmp/denizen-gui.env; set +a
      {inner}
    ' '''


def connect():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=20)
    run(ssh, f'mkdir -p {REMOTE_OUT}')
    return ssh


def ensure_ydotool(ssh):
    run(ssh, "bash -lc 'which ydotool || (echo 333 | sudo -S apt-get install -y ydotool)'", timeout=120)
    run(ssh, gui_env_cmd(r'''
      SOCK="$XDG_RUNTIME_DIR/ydotoold.sock"
      pkill -x ydotoold 2>/dev/null || true
      sleep 0.5
      echo 333 | sudo -S pkill -x ydotoold 2>/dev/null || true
      sleep 0.3
      echo 333 | sudo -S chmod 0666 /dev/uinput 2>/dev/null || true
      rm -f "$SOCK"
      nohup ydotoold --socket-path="$SOCK" >> /tmp/denizen-laptop-inspect/ydotoold.log 2>&1 &
      sleep 1
      ls -la "$SOCK" 2>&1 || true
      export YDOTOOL_SOCKET="$SOCK"
      pgrep -a ydotoold || true
      ydotool help 2>&1 | head -3 || true
      ydotool mousemove --absolute 32767 32767 2>&1 || ydotool mousemove 32767 32767 2>&1 || true
    '''), timeout=30)


def upload_script(ssh):
    local = ROOT / 'laptop-visible-mouse.sh'
    body = local.read_text(encoding='utf-8').replace('\r\n', '\n').replace('\r', '\n')
    remote = f'{REMOTE_OUT}/visible-mouse.sh'
    sftp = ssh.open_sftp()
    with sftp.file(remote, 'w') as fh:
        fh.write(body)
    sftp.chmod(remote, 0o755)
    sftp.close()


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'setup-and-tour'
    ssh = connect()

    if action in ('setup', 'setup-and-tour'):
        ensure_ydotool(ssh)

    if action in ('setup-and-tour', 'visible-tour', 'show'):
        upload_script(ssh)
        steps = sys.argv[2] if len(sys.argv) > 2 else '40'
        code, _, _ = run(ssh, gui_env_cmd(f'''
          export YDOTOOL_SOCKET="$XDG_RUNTIME_DIR/ydotoold.sock"
          notify-send -t 8000 "Denizen Agent" "Moving mouse in the CENTER of the screen (no corner clicks)" 2>/dev/null || true
          bash {REMOTE_OUT}/visible-mouse.sh {steps} 500
        '''), timeout=180)
        ssh.close()
        if code != 0:
            sys.exit(code)
        print(json.dumps({'ok': True, 'backend': 'ydotool', 'host': HOST}, indent=2))
        return

    ssh.close()


if __name__ == '__main__':
    main()
