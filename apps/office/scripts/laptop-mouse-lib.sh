#!/usr/bin/env bash
# ydotool helpers — reset-to-origin then relative move (Wayland-safe).
set -eo pipefail
if [ -f /tmp/denizen-gui.env ]; then set -a; source /tmp/denizen-gui.env; set +a; fi
export YDOTOOL_SOCKET="${YDOTOOL_SOCKET:-${XDG_RUNTIME_DIR}/ydotoold.sock}"

yd_reset() {
  ydotool mousemove -x -9999999 -y -9999999 2>/dev/null || true
  sleep 0.07
  ydotool mousemove -x -9999999 -y -9999999 2>/dev/null || true
  sleep 0.07
}

yd_move_px() {
  local px=$1 py=$2
  yd_reset
  ydotool mousemove -x "$px" -y "$py"
}

yd_click_px() {
  yd_move_px "$1" "$2"
  sleep 0.18
  ydotool click 0x01
}
