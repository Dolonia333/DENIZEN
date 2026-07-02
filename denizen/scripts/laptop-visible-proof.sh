#!/usr/bin/env bash
set -eo pipefail
if [ -f /tmp/denizen-gui.env ]; then set -a; source /tmp/denizen-gui.env; set +a; fi
export YDOTOOL_SOCKET="${XDG_RUNTIME_DIR:-/run/user/1000}/ydotoold.sock"

echo "=== mouse start ==="
xdotool getmouselocation 2>&1

echo "=== ydotool move to 300,800 ==="
ydotool mousemove -x -9999999 -y -9999999 2>/dev/null || true
sleep 0.05
ydotool mousemove -x -9999999 -y -9999999 2>/dev/null || true
sleep 0.05
ydotool mousemove -x 300 -y 800 2>&1 || true
sleep 0.4
echo "=== mouse after move to 300,800 ==="
xdotool getmouselocation 2>&1

echo "=== screen flash (very visible) ==="
OUT=$(xrandr 2>/dev/null | awk '/ connected/{print $1; exit}')
if [ -n "$OUT" ]; then
  xrandr --output "$OUT" --brightness 0.2 2>&1 || true
  sleep 0.35
  xrandr --output "$OUT" --brightness 1.0 2>&1 || true
  echo "flashed $OUT"
else
  echo "no output for flash"
fi

echo "=== open terminal ==="
if command -v gnome-terminal >/dev/null 2>&1; then
  gnome-terminal -- bash -c 'echo "=== DENIZEN AGENT CONNECTED ==="; echo "Remote control is working."; exec bash' &
  echo "gnome-terminal launched"
else
  echo "no gnome-terminal"
fi

notify-send -u critical -t 15000 "Denizen Agent" "Screen flashed + terminal opened. Remote control works." 2>/dev/null || true
echo "=== done ==="
