#!/usr/bin/env python3
import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

cmds = [
    "PID=$(pgrep -u dolo -n gnome-shell 2>/dev/null || pgrep -u dolo -n gnome-session); tr '\\0' '\\n' < /proc/$PID/environ | grep -E '^(DISPLAY|WAYLAND|XAUTHORITY|DBUS|XDG)' > /tmp/denizen-gui.env",
    "set -a; source /tmp/denizen-gui.env; set +a; which xdotool ydotool dotool wtype 2>/dev/null; ydotool --version 2>&1; pgrep -a ydotoold || echo no-ydotoold; ls -la /dev/uinput 2>&1; groups; echo WAYLAND=$WAYLAND_DISPLAY; xdotool getmouselocation 2>&1",
    "echo 333 | sudo -S apt-get install -y ydotool 2>&1 | tail -5",
]

for c in cmds:
    print('---', c[:80])
    _, o, e = ssh.exec_command(f"bash -lc '{c}'", timeout=120)
    print(o.read().decode())
    err = e.read().decode().strip()
    if err:
        print('stderr:', err[:400])

ssh.close()
