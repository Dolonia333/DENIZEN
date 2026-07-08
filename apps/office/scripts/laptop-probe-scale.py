#!/usr/bin/env python3
"""Probe GNOME display scale + ydotool coordinate accuracy on laptop."""
import paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'

PROBE = r'''
PID=$(pgrep -u dolo -n gnome-shell 2>/dev/null || pgrep -u dolo -n gnome-session)
tr '\0' '\n' < /proc/$PID/environ | grep -E '^(DISPLAY|WAYLAND|XAUTHORITY|DBUS|XDG)=' > /tmp/denizen-gui.env
set -a; source /tmp/denizen-gui.env; set +a
export YDOTOOL_SOCKET="$XDG_RUNTIME_DIR/ydotoold.sock"

echo "=== gsettings scale ==="
gsettings get org.gnome.desktop.interface scaling-factor 2>/dev/null || true
gsettings get org.gnome.desktop.interface text-scaling-factor 2>/dev/null || true
gsettings get org.gnome.mutter experimental-features 2>/dev/null || true

echo "=== xrandr ==="
xrandr --query 2>/dev/null | head -5

echo "=== xdotool geometry ==="
xdotool getdisplaygeometry 2>&1

echo "=== mutter display (scale per monitor) ==="
python3 <<'PY'
import json, subprocess
try:
    out = subprocess.check_output([
        "gdbus", "call", "--session",
        "--dest", "org.gnome.Mutter.DisplayConfig",
        "--object-path", "/org/gnome/Mutter/DisplayConfig",
        "--method", "org.gnome.Mutter.DisplayConfig.GetCurrentState"
    ], text=True, stderr=subprocess.STDOUT)
    # parse scale from output — look for (d) scale values
    print(out[:2000])
except Exception as e:
    print("mutter call failed:", e)
PY

echo "=== ydotool debug center ==="
W=$(xdotool getdisplaygeometry | awk '{print $1}')
H=$(xdotool getdisplaygeometry | awk '{print $2}')
CX=$((W/2)); CY=$((H/2))
ydotool mousemove -x -9999999 -y -9999999 2>/dev/null; sleep 0.05
ydotool mousemove -x -9999999 -y -9999999 2>/dev/null; sleep 0.05
ydotool mousemove -x "$CX" -y "$CY" 2>&1
sleep 0.3
echo "xdotool reports:" $(xdotool getmouselocation 2>&1)
ydotool debug mousemove -x "$CX" -y "$CY" 2>&1 || true
'''

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)
_, o, e = ssh.exec_command(f'bash -lc {repr(PROBE)}', timeout=45)
print(o.read().decode())
err = e.read().decode().strip()
if err:
    print('stderr:', err[:500])
ssh.close()
