#!/usr/bin/env python3
"""Probe HP laptop (Tailscale) for GUI session and Denizen."""
import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'

def run(ssh, cmd, timeout=30):
    print(f'\n$ {cmd}')
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print('stderr:', err.rstrip())
    return stdout.channel.recv_exit_status(), out, err

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

run(ssh, 'hostname && who && w | head -5')
run(ssh, 'ls -la ~/Applications/Denizen.AppImage 2>/dev/null || ls -la ~/denizen-deploy 2>/dev/null | head -3')
run(ssh, 'pgrep -af "Denizen|Xorg|wayland|electron" || true')
run(ssh, 'for f in /tmp/.X11-unix/X*; do echo "X sock: $f"; done 2>/dev/null; ls /tmp/.X11-unix/ 2>/dev/null')
run(ssh, 'grep -r DISPLAY= /proc/$(pgrep -u dolo -n Xorg 2>/dev/null)/environ 2>/dev/null | tr "\\0" "\\n" | grep DISPLAY || echo no-xorg-for-dolo')
run(ssh, 'export DISPLAY=:0; xdotool getdisplaygeometry 2>&1 || export DISPLAY=:1; xdotool getdisplaygeometry 2>&1')
run(ssh, 'curl -sS -m 3 http://127.0.0.1:8081/api/health 2>&1 | head -c 120 || echo no-8081')

ssh.close()
print('\nDone.')
