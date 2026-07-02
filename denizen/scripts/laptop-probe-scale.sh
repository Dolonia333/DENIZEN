#!/usr/bin/env bash
set -eo pipefail
PID=$(pgrep -u dolo -n gnome-shell 2>/dev/null || pgrep -u dolo -n gnome-session)
tr '\0' '\n' < /proc/$PID/environ | grep -E '^(DISPLAY|WAYLAND|XAUTHORITY|DBUS|XDG)=' > /tmp/denizen-gui.env
set -a; source /tmp/denizen-gui.env; set +a
export YDOTOOL_SOCKET="$XDG_RUNTIME_DIR/ydotoold.sock"

echo "=== gsettings ==="
gsettings get org.gnome.desktop.interface scaling-factor 2>/dev/null || true
gsettings get org.gnome.desktop.interface text-scaling-factor 2>/dev/null || true
gsettings get org.gnome.mutter experimental-features 2>/dev/null || true

echo "=== xrandr ==="
xrandr --query 2>/dev/null | head -6

W=$(xdotool getdisplaygeometry | awk '{print $1}')
H=$(xdotool getdisplaygeometry | awk '{print $2}')
echo "xdotool geometry: ${W}x${H}"

echo "=== mutter scale (python) ==="
python3 <<'PY'
import re, subprocess
raw = subprocess.check_output([
    "gdbus", "call", "--session",
    "--dest", "org.gnome.Mutter.DisplayConfig",
    "--object-path", "/org/gnome/Mutter/DisplayConfig",
    "--method", "org.gnome.Mutter.DisplayConfig.GetCurrentState",
], text=True)
scales = re.findall(r"(\d+\.?\d*)\s*,\s*(\d+)\s*,\s*(\d+)", raw)
# find doubles that look like scale (1.0, 1.25, 1.5, 2.0)
for m in re.finditer(r"(\d+(?:\.\d+)?)", raw):
    pass
# simpler: look for common scale values in output
for s in ("1.25", "1.5", "1.75", "2", "1.0", "1"):
    if s in raw:
        print("found scale token:", s)
print("raw snippet:", raw[:800])
PY

echo "=== calibrate: move to logical center ${W}/2 ${H}/2 ==="
CX=$((W/2)); CY=$((H/2))
ydotool mousemove -x -9999999 -y -9999999 2>/dev/null || true
sleep 0.08
ydotool mousemove -x -9999999 -y -9999999 2>/dev/null || true
sleep 0.08
ydotool mousemove -x "$CX" -y "$CY"
notify-send "Calibrate" "Should be CENTER (${CX},${CY})" 2>/dev/null || true
sleep 1
ydotool mousemove -x -9999999 -y -9999999 2>/dev/null || true
sleep 0.08
ydotool mousemove -x -9999999 -y -9999999 2>/dev/null || true
sleep 0.08
ydotool mousemove -x 200 -y 200
notify-send "Calibrate" "Should be TOP-LEFT area (200,200)" 2>/dev/null || true
