#!/usr/bin/env python3
"""Parse GNOME Mutter display scale from laptop."""
import re, subprocess, json

raw = subprocess.check_output([
    "gdbus", "call", "--session",
    "--dest", "org.gnome.Mutter.DisplayConfig",
    "--object-path", "/org/gnome/Mutter/DisplayConfig",
    "--method", "org.gnome.Mutter.DisplayConfig.GetCurrentState",
], text=True)

# logical monitors tuple: (x, y, scale, transform, is-primary, ...)
for m in re.finditer(r"\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+)\s*,\s*(True|False)", raw):
    x, y, sc, tr, prim = m.groups()
    if prim == 'True':
        scale = float(sc)
        break
else:
    scale = 1.0

print(json.dumps({"scale": scale, "width": 1920, "height": 1080}))
