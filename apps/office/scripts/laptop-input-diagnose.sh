#!/usr/bin/env bash
set -eo pipefail

if [ -f /tmp/denizen-gui.env ]; then set -a; source /tmp/denizen-gui.env; set +a; fi
export YDOTOOL_SOCKET="${XDG_RUNTIME_DIR:-/run/user/1000}/ydotoold.sock"

echo "=== session ==="
echo "DISPLAY=${DISPLAY:-?} WAYLAND=${WAYLAND_DISPLAY:-?}"
echo "=== geometry ==="
xdotool getdisplaygeometry 2>&1 || true
echo "=== mouse before ==="
xdotool getmouselocation 2>&1 || true
echo "=== ydotool ==="
which ydotool ydotoold 2>/dev/null || true
pgrep -a ydotoold || echo "no ydotoold"
ls -la "$YDOTOOL_SOCKET" 2>&1 || true
echo "=== help mousemove ==="
ydotool help mousemove 2>&1 || true

W=$(xdotool getdisplaygeometry 2>/dev/null | awk '{print $1}')
H=$(xdotool getdisplaygeometry 2>/dev/null | awk '{print $2}')
W=${W:-1920}; H=${H:-1080}
CX=$((W/2)); CY=$((H/2))
echo "=== test A: reset + relative to center ($CX,$CY) ==="
ydotool mousemove -x -9999999 -y -9999999 2>&1 || true
sleep 0.1
ydotool mousemove -x -9999999 -y -9999999 2>&1 || true
sleep 0.1
ydotool mousemove -x "$CX" -y "$CY" 2>&1 || true
sleep 0.5
echo "mouse after A:"
xdotool getmouselocation 2>&1 || true

echo "=== test B: absolute -x -y center ==="
ydotool mousemove --absolute -x "$CX" -y "$CY" 2>&1 || true
sleep 0.5
echo "mouse after B:"
xdotool getmouselocation 2>&1 || true

echo "=== test C: visible notify (proves SSH session reaches GUI) ==="
notify-send -u critical -t 10000 "Denizen test" "If you see this popup, remote control reaches your desktop." 2>&1 || true

echo "=== test D: open run dialog (Super not used — Alt+F2) ==="
ydotool key 56:1 68:1 68:0 56:0 2>&1 || true
sleep 1
ydotool type "echo REMOTE_CONTROL_WORKS" 2>&1 || true
sleep 0.3
ydotool key 28:1 28:0 2>&1 || true

echo "=== monitors ==="
gsettings get org.gnome.mutter experimental-features 2>/dev/null || true
xrandr 2>&1 | head -20 || true

echo "=== done ==="
