#!/usr/bin/env python3
"""Run highly visible proof-of-control on laptop (flash + terminal)."""
from pathlib import Path
import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'
REMOTE = '/tmp/denizen-laptop-inspect/visible-proof.sh'
ROOT = Path(__file__).resolve().parent

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

_, o, _ = ssh.exec_command(
    "bash -lc 'PID=$(pgrep -u dolo -n gnome-shell); "
    "tr \"\\0\" \"\\n\" < /proc/$PID/environ | "
    "grep -E \"^(DISPLAY|WAYLAND|XAUTHORITY|DBUS|XDG)=\" > /tmp/denizen-gui.env'",
    timeout=15,
)
o.channel.recv_exit_status()

body = (ROOT / 'laptop-visible-proof.sh').read_text().replace('\r\n', '\n')
sftp = ssh.open_sftp()
ssh.exec_command('mkdir -p /tmp/denizen-laptop-inspect', timeout=10)
with sftp.file(REMOTE, 'w') as f:
    f.write(body)
sftp.chmod(REMOTE, 0o755)
sftp.close()

_, o, e = ssh.exec_command(f'bash -lc "bash {REMOTE}"', timeout=45)
print(o.read().decode())
err = e.read().decode().strip()
if err:
    print('stderr:', err[:600])
print('exit', o.channel.recv_exit_status())
ssh.close()
