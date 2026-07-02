#!/usr/bin/env python3
"""Launch Denizen + click inside its window (window-relative, not screen guesses)."""
from __future__ import annotations

import sys
from pathlib import Path
import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'
ROOT = Path(__file__).resolve().parent
REMOTE = '/tmp/denizen-laptop-inspect'


def run(ssh, cmd, timeout=180):
    _, o, e = ssh.exec_command(cmd, timeout=timeout)
    out = o.read().decode('utf-8', errors='replace')
    err = e.read().decode('utf-8', errors='replace')
    code = o.channel.recv_exit_status()
    print(out)
    if err.strip():
        print('stderr:', err[:600])
    return code


def upload(ssh, name):
    body = (ROOT / name).read_text(encoding='utf-8').replace('\r\n', '\n')
    sftp = ssh.open_sftp()
    path = f'{REMOTE}/{name}'
    with sftp.file(path, 'w') as f:
        f.write(body)
    sftp.chmod(path, 0o755)
    sftp.close()


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=20)
    run(ssh, f'mkdir -p {REMOTE}')

    for f in ('laptop-mouse-lib.sh', 'laptop-get-scale.py', 'laptop-click-denizen-window.sh'):
        upload(ssh, f)

    inner = f'''
      PID=$(pgrep -u dolo -n gnome-shell 2>/dev/null || pgrep -u dolo -n gnome-session)
      tr "\\0" "\\n" < /proc/$PID/environ | grep -E "^(DISPLAY|WAYLAND|XAUTHORITY|DBUS|XDG)=" > /tmp/denizen-gui.env
      set -a; source /tmp/denizen-gui.env; set +a
      export YDOTOOL_SOCKET="$XDG_RUNTIME_DIR/ydotoold.sock"
      pkill -x ydotoold 2>/dev/null; sleep 0.3
      echo 333 | sudo -S chmod 0666 /dev/uinput 2>/dev/null || true
      nohup ydotoold --socket-path="$YDOTOOL_SOCKET" >> {REMOTE}/ydotoold.log 2>&1 &
      sleep 1
      mkdir -p {REMOTE}
      python3 {REMOTE}/laptop-get-scale.py > {REMOTE}/calibration.json
      cat {REMOTE}/calibration.json
      if ! pgrep -f Denizen.AppImage >/dev/null; then
        systemd-run --user --collect --setenv=DISPLAY="$DISPLAY" --setenv=WAYLAND_DISPLAY="$WAYLAND_DISPLAY" \\
          --setenv=XAUTHORITY="$XAUTHORITY" --setenv=DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \\
          --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \\
          "$HOME/Applications/Denizen.AppImage" >> {REMOTE}/denizen.log 2>&1
        echo "Launched Denizen, waiting..."
        sleep 25
      fi
      cp {REMOTE}/laptop-mouse-lib.sh {REMOTE}/mouse-lib.sh
      bash {REMOTE}/laptop-click-denizen-window.sh
    '''
    code = run(ssh, f"bash -lc '{inner}'", timeout=240)
    ssh.close()
    sys.exit(code)


if __name__ == '__main__':
    main()
