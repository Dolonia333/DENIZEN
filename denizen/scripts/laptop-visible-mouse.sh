#!/usr/bin/env bash
# Safe visible mouse tour — center of screen only (avoids GNOME hot corners).
# Usage: bash laptop-visible-mouse.sh [steps] [pause_ms]

set -euo pipefail
STEPS="${1:-35}"
PAUSE_MS="${2:-600}"

if [ -f /tmp/denizen-gui.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /tmp/denizen-gui.env
  set +a
fi

export YDOTOOL_SOCKET="${YDOTOOL_SOCKET:-${XDG_RUNTIME_DIR}/ydotoold.sock}"

read -r W H <<< "$(xdotool getdisplaygeometry 2>/dev/null || echo '1920 1080')"
echo "visible-mouse: ${W}x${H} steps=${STEPS}"

if command -v ydotool >/dev/null 2>&1 && [ -S "$YDOTOOL_SOCKET" ]; then
  BACKEND=ydotool
else
  BACKEND=xdotool
fi
echo "backend=${BACKEND}"

# Reset virtual pointer to origin, then use relative moves as absolute (ydotool Wayland workaround).
yd_reset() {
  ydotool mousemove -x -9999999 -y -9999999 2>/dev/null || true
  sleep 0.05
  ydotool mousemove -x -9999999 -y -9999999 2>/dev/null || true
  sleep 0.05
}

yd_goto() {
  local px=$1 py=$2
  # Try pixel absolute first (Debian/Kali ydotool 1.0.x)
  if ydotool mousemove --absolute -x "$px" -y "$py" 2>/dev/null; then
    return 0
  fi
  if ydotool mousemove --absolute "$px" "$py" 2>/dev/null; then
    return 0
  fi
  # Fallback: reset + relative from 0,0
  yd_reset
  ydotool mousemove -x "$px" -y "$py"
}

move_abs() {
  local tx=$1 ty=$2
  if [ "$BACKEND" = ydotool ]; then
    yd_goto "$tx" "$ty"
  else
    xdotool mousemove --sync "$tx" "$ty"
  fi
}

animate_to() {
  local tx=$1 ty=$2
  local sx sy i nx ny
  sx=${SX:-$((W / 2))}
  sy=${SY:-$((H / 2))}
  for ((i = 1; i <= STEPS; i++)); do
    nx=$(( sx + (tx - sx) * i / STEPS ))
    ny=$(( sy + (ty - sy) * i / STEPS ))
    move_abs "$nx" "$ny"
    sleep 0.035
  done
  SX=$tx
  SY=$ty
}

pause_here() {
  sleep "$(awk "BEGIN {print $PAUSE_MS/1000}")"
}

# Safe zone — middle 60% of screen, never touch corners or edges
MX=$((W / 2))
MY=$((H / 2))
DX=$((W * 3 / 10))
DY=$((H * 3 / 10))

SX=$MX
SY=$MY
if [ "$BACKEND" = ydotool ]; then
  yd_reset
  yd_goto "$MX" "$MY"
  SX=$MX
  SY=$MY
else
  eval "$(xdotool getmouselocation --shell)"
  SX=$X
  SY=$Y
fi

# Draw a visible diamond in the center — no clicks (clicks caused resize/snap)
pts=(
  "$MX $((MY - DY))"
  "$((MX + DX)) $MY"
  "$MX $((MY + DY))"
  "$((MX - DX)) $MY"
  "$MX $MY"
)

for pt in "${pts[@]}"; do
  tx=$(echo "$pt" | awk '{print $1}')
  ty=$(echo "$pt" | awk '{print $2}')
  animate_to "$tx" "$ty"
  pause_here
done

echo "visible-mouse-done backend=${BACKEND} at ${SX},${SY} (no clicks — move only)"
