#!/usr/bin/env python3
"""Upload and run input diagnostics on laptop."""
from pathlib import Path
import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'
REMOTE = '/tmp/denizen-laptop-inspect/input-diagnose.sh'
ROOT = Path(__file__).resolve().parent

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd, t=60):
    _, o, e = ssh.exec_command(cmd, timeout=t)
    out = o.read().decode()
    err = e.read().decode().strip()
    code = o.channel.recv_exit_status()
    return code, out, err

run("mkdir -p /tmp/denizen-laptop-inspect")
code, out, err = run(
    "bash -lc '"
    "PID=$(pgrep -u dolo -n gnome-shell 2>/dev/null || pgrep -u dolo -n gnome-session); "
    "tr \"\\0\" \"\\n\" < /proc/$PID/environ | "
    "grep -E \"^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR)=\" "
    "> /tmp/denizen-gui.env; cat /tmp/denizen-gui.env'"
)
print('env refresh exit', code)
print(out)
if err:
    print('env err:', err)

body = (ROOT / 'laptop-input-diagnose.sh').read_text().replace('\r\n', '\n')
sftp = ssh.open_sftp()
with sftp.file(REMOTE, 'w') as f:
    f.write(body)
sftp.chmod(REMOTE, 0o755)
sftp.close()

code, out, err = run(f'bash -lc "bash {REMOTE}"', t=90)
print(out)
if err:
    print('stderr:', err[:1200])
print('exit', code)
ssh.close()
