#!/usr/bin/env python3
"""Debug ydotool mouse coordinates on laptop."""
import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

tests = r'''
PID=$(pgrep -u dolo -n gnome-shell 2>/dev/null || pgrep -u dolo -n gnome-session)
tr '\0' '\n' < /proc/$PID/environ | grep -E '^(DISPLAY|WAYLAND|XAUTHORITY|DBUS|XDG)=' > /tmp/denizen-gui.env
set -a; source /tmp/denizen-gui.env; set +a
export YDOTOOL_SOCKET="$XDG_RUNTIME_DIR/ydotoold.sock"
W=1920; H=1080
echo "help mousemove:"
ydotool help mousemove 2>&1
echo "--- test center ---"
CX=$((W/2)); CY=$((H/2))
AX=$((CX * 65535 / W))
AY=$((CY * 65535 / H))
echo "pixel $CX $CY -> abs $AX $AY"
ydotool mousemove --absolute $AX $AY 2>&1
sleep 1
echo "--- test bottom-right safe ---"
PX=$((W-200)); PY=$((H-200))
AX=$((PX * 65535 / W))
AY=$((PY * 65535 / H))
echo "pixel $PX $PY -> abs $AX $AY"
ydotool mousemove --absolute $AX $AY 2>&1
'''

_, o, e = ssh.exec_command(f"bash -lc '{tests}'", timeout=40)
print(o.read().decode())
err = e.read().decode().strip()
if err:
    print('stderr:', err)
ssh.close()
