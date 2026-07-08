#!/usr/bin/env bash
set -eo pipefail
if [ -f /tmp/denizen-gui.env ]; then set -a; source /tmp/denizen-gui.env; set +a; fi

echo "=== xdotool search Denizen ==="
xdotool search --name Denizen 2>&1 || true
WID=$(xdotool search --name Denizen 2>/dev/null | head -1)
if [ -n "$WID" ]; then
  xdotool getwindowgeometry "$WID" 2>&1
  xdotool getwindowname "$WID" 2>&1
fi

echo "=== gdbus titles ==="
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval \
  'global.get_window_actors().map(a => a.meta_window.get_title()).filter(Boolean).join(" | ")' 2>&1
