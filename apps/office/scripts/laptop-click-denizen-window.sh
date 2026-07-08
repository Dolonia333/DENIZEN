#!/usr/bin/env bash
# Click inside the Denizen AppImage window using window-relative coords (not blind screen pixels).
set -eo pipefail
if [ -f /tmp/denizen-gui.env ]; then set -a; source /tmp/denizen-gui.env; set +a; fi
export YDOTOOL_SOCKET="${XDG_RUNTIME_DIR:-/run/user/1000}/ydotoold.sock"
source /tmp/denizen-laptop-inspect/mouse-lib.sh 2>/dev/null || source "$(dirname "$0")/laptop-mouse-lib.sh"

# JSON: {x,y,width,height,title} for first Denizen window
WIN=$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval "
const wins = global.get_window_actors().filter(a => {
  const t = a.meta_window.get_title() || '';
  return /denizen/i.test(t);
});
if (!wins.length) 'null';
else {
  const r = wins[0].meta_window.get_frame_rect();
  JSON.stringify({x:r.x, y:r.y, width:r.width, height:r.height, title: wins[0].meta_window.get_title()});
}
" 2>/dev/null | tail -1 | sed "s/^('true', '//;s/')$//;s/^('false', '//;s/')$//" | tr -d "'")

echo "window: $WIN"
if [ -z "$WIN" ] || [ "$WIN" = "null" ]; then
  notify-send "Denizen Agent" "Open Denizen AppImage first" 2>/dev/null || true
  echo "no-denizen-window"
  exit 1
fi

WX=$(python3 -c "import json; w=json.loads('''$WIN'''); print(w['x'])")
WY=$(python3 -c "import json; w=json.loads('''$WIN'''); print(w['y'])")
WW=$(python3 -c "import json; w=json.loads('''$WIN'''); print(w['width'])")
WH=$(python3 -c "import json; w=json.loads('''$WIN'''); print(w['height'])")

# Phone FAB ~ bottom-right inside Denizen window
FX=$((WX + WW - 56))
FY=$((WY + WH - 56))
echo "FAB target: $FX,$FY (window ${WX},${WY} ${WW}x${WH})"

notify-send "Denizen Agent" "Clicking phone button in Denizen window" 2>/dev/null || true
yd_click_px "$FX" "$FY"
sleep 0.8

# Citizen ID tile ~ upper-left area of phone grid (approx)
CX=$((WX + WW / 2 - 80))
CY=$((WY + WH / 2 + 40))
echo "Profile target: $CX,$CY"
yd_click_px "$CX" "$CY"
echo "denizen-window-clicks-done"
