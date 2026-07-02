#!/usr/bin/env python3
"""Upload find-window script and run on laptop."""
from pathlib import Path
import paramiko

ROOT = Path(__file__).resolve().parent
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('100.110.205.49', username='dolo', password='333', timeout=20)

def gui_refresh():
    ssh.exec_command(
        "bash -lc 'PID=$(pgrep -u dolo -n gnome-shell); "
        "tr \"\\0\" \"\\n\" < /proc/$PID/environ | grep -E \"^(DISPLAY|WAYLAND|XAUTHORITY|DBUS|XDG)=\" > /tmp/denizen-gui.env'",
        timeout=15,
    )

gui_refresh()
body = (ROOT / 'laptop-find-window.sh').read_text().replace('\r\n', '\n')
sftp = ssh.open_sftp()
remote = '/tmp/denizen-laptop-inspect/find-window.sh'
with sftp.file(remote, 'w') as f:
    f.write(body)
sftp.chmod(remote, 0o755)
sftp.close()

_, o, _ = ssh.exec_command(f'bash -lc "bash {remote}"', timeout=30)
print(o.read().decode('utf-8', errors='replace'))
ssh.close()
