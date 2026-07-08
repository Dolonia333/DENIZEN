#!/usr/bin/env bash
# Find window geometry on GNOME — tries Shell Eval, wmctrl, xdotool.
set -eo pipefail
if [ -f /tmp/denizen-gui.env ]; then set -a; source /tmp/denizen-gui.env; set +a; fi

PATTERN="${1:-(?i)denizen}"

find_gnome() {
  local raw ok payload
  raw=$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval \
    "(()=>{try{var a=global.get_window_actors();for(var i=0;i<a.length;i++){var t=a[i].meta_window.get_title()||'';if(/${PATTERN}/.test(t)){var r=a[i].meta_window.get_frame_rect();return r.x+','+r.y+','+r.width+','+r.height+','+JSON.stringify(t);}}return 'NONE';}catch(e){return 'ERR:'+e;}})()" 2>/dev/null || true)
  ok=$(echo "$raw" | sed -n "s/^(\(true\|false\), '\(.*\)')/\2/p" | tail -1)
  if [ -z "$ok" ]; then
    ok=$(echo "$raw" | grep -oP "(?<=\('true', ')[^']+" | tail -1 || true)
  fi
  if [ -n "$ok" ] && [ "$ok" != "NONE" ] && [[ "$ok" != ERR:* ]]; then
    echo "gnome:$ok"
    return 0
  fi
  return 1
}

find_wmctrl() {
  command -v wmctrl >/dev/null 2>&1 || return 1
  local line
  line=$(wmctrl -lG 2>/dev/null | grep -i denizen | head -1)
  [ -n "$line" ] || return 1
  # id desktop pid x y w h host title...
  local x y w h title
  x=$(echo "$line" | awk '{print $5}')
  y=$(echo "$line" | awk '{print $6}')
  w=$(echo "$line" | awk '{print $7}')
  h=$(echo "$line" | awk '{print $8}')
  title=$(echo "$line" | cut -d' ' -f9-)
  echo "wmctrl:${x},${y},${w},${h},\"${title}\""
}

find_xdotool() {
  local wid
  wid=$(xdotool search --onlyvisible --name Denizen 2>/dev/null | head -1)
  [ -n "$wid" ] || return 1
  eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)"
  local title
  title=$(xdotool getwindowname "$wid" 2>/dev/null || echo Denizen)
  echo "xdotool:${X},${Y},${WIDTH},${HEIGHT},\"${title}\""
}

list_all_titles() {
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval \
    "(()=>{try{return global.get_window_actors().map(a=>a.meta_window.get_title()).filter(Boolean).join('|');}catch(e){return String(e);}})()" 2>/dev/null || true
}

echo "=== titles ==="
list_all_titles
echo "=== find ==="
find_gnome || find_wmctrl || find_xdotool || echo "NOTFOUND"
