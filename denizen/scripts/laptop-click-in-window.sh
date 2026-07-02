#!/usr/bin/env bash
# Click a point inside a window found by laptop-find-window.sh
# Usage: click-in-window.sh <pattern> <rel_x_pct> <rel_y_pct> [click=1]
set -eo pipefail
if [ -f /tmp/denizen-gui.env ]; then set -a; source /tmp/denizen-gui.env; set +a; fi
export YDOTOOL_SOCKET="${XDG_RUNTIME_DIR:-/run/user/1000}/ydotoold.sock"

DIR="$(dirname "$0")"
source "$DIR/mouse-lib.sh"

PATTERN="${1:-denizen}"
RX="${2:-92}"   # percent from left
RY="${3:-92}"   # percent from top
DOC="${4:-1}"

LINE=$(bash "$DIR/laptop-find-window.sh" "$PATTERN" 2>/dev/null | grep -E '^(gnome|wmctrl|xdotool):' | head -1)
if [ -z "$LINE" ]; then
  echo "window-not-found:$PATTERN"
  notify-send "Denizen" "Window not found: $PATTERN" 2>/dev/null || true
  exit 1
fi

PAYLOAD=${LINE#*:}
# payload: x,y,w,h,"title" or x,y,w,h,titlejson
WX=$(echo "$PAYLOAD" | cut -d, -f1)
WY=$(echo "$PAYLOAD" | cut -d, -f2)
WW=$(echo "$PAYLOAD" | cut -d, -f3)
WH=$(echo "$PAYLOAD" | cut -d, -f4)
TITLE=$(echo "$PAYLOAD" | cut -d, -f5- | tr -d '"')

TX=$((WX + WW * RX / 100))
TY=$((WY + WH * RY / 100))
echo "window=$TITLE rect=${WX},${WY},${WW}x${WH} click=${TX},${TY} (${RX}%,${RY}%)"

notify-send "Denizen Agent" "Click ${RX}%,${RY}% in ${TITLE:-window}" 2>/dev/null || true
yd_move_px "$TX" "$TY"
sleep 0.2
if [ "$DOC" = "1" ]; then
  ydotool click 0x01
fi
echo "clicked:$TX,$TY"
