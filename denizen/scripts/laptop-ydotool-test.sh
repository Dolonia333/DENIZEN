#!/usr/bin/env bash
set -euo pipefail
if [ -f /tmp/denizen-gui.env ]; then set -a; source /tmp/denizen-gui.env; set +a; fi
export YDOTOOL_SOCKET="${XDG_RUNTIME_DIR}/ydotoold.sock"
W=1920; H=1080
echo "=== ydotool help mousemove ==="
ydotool help mousemove 2>&1 || true
echo "=== ydotool help click ==="
ydotool help click 2>&1 || true
echo "=== move center (960,540) ==="
AX=$((960 * 65535 / W))
AY=$((540 * 65535 / H))
echo "abs coords: $AX $AY"
ydotool mousemove --absolute "$AX" "$AY" 2>&1 && echo "flag --absolute ok" || echo "flag --absolute failed"
sleep 0.5
ydotool mousemove -a "$AX" "$AY" 2>&1 && echo "flag -a ok" || echo "flag -a failed"
sleep 0.5
echo "=== move safe center-right (1400,540) no click ==="
AX=$((1400 * 65535 / W))
AY=$((540 * 65535 / H))
ydotool mousemove --absolute "$AX" "$AY" 2>&1 || ydotool mousemove -a "$AX" "$AY" 2>&1 || true
