#!/usr/bin/env python3
"""Full Modern Exteriors extraction — every 16x16 theme, all singles,
all animated sheets, terrains, and vehicles.

Target layout (all under assets/limezu/ext/):
  themes/<NN_Name>.png            the 24 merged theme sheets
  singles/<theme>/<file>.png      every per-sprite single (12,500+)
  animated/<file>.png             453 animated sheets + 10 terrains
  vehicles/<file>.png             73 animated vehicle sheets

Idempotent: skips files that already exist with matching size.
"""

import os
import re
import zipfile

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP = r"C:/Users/zionv/Downloads/all sprite files/modernexteriors-win.zip"
OUT = os.path.join(DEN, "assets", "limezu", "ext")

z = zipfile.ZipFile(ZIP)
names = z.namelist()

written = skipped = 0


def put(data, *path):
    global written, skipped
    dest = os.path.join(OUT, *path)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) == len(data):
        skipped += 1
        return
    with open(dest, "wb") as fh:
        fh.write(data)
    written += 1


THEME_RE = re.compile(
    r"Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/(\d+_[^/]+?)(_16x16)?\.png$")
SINGLE_RE = re.compile(
    r"Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/(\d+_[^/]+?)_Singles_16x16/([^/]+\.png)$")
ANIM_RE = re.compile(
    r"Modern_Exteriors_16x16/Animated_16x16/(Animated_sheets_16x16|Animated_Terrains_16x16)/(.+\.png)$")
VEH_RE = re.compile(
    r"Modern_Exteriors_16x16/Animated_16x16/Vehicles_16x16/(.+\.png)$")

for n in names:
    if n.endswith("/") or "desktop.ini" in n or "Old_Sorting" in n:
        continue
    m = THEME_RE.match(n)
    if m:
        put(z.read(n), "themes", f"{m.group(1)}.png")
        continue
    m = SINGLE_RE.match(n)
    if m:
        theme = m.group(1).lower()
        put(z.read(n), "singles", theme, os.path.basename(m.group(2)))
        continue
    m = ANIM_RE.match(n)
    if m:
        put(z.read(n), "animated", os.path.basename(m.group(2)))
        continue
    m = VEH_RE.match(n)
    if m:
        put(z.read(n), "vehicles", os.path.basename(m.group(1)))
        continue

print(f"written {written}, skipped {skipped}")
# quick summary
for sub in ("themes", "animated", "vehicles"):
    p = os.path.join(OUT, sub)
    print(sub, len(os.listdir(p)) if os.path.exists(p) else 0)
sing = os.path.join(OUT, "singles")
if os.path.exists(sing):
    total = sum(len(files) for _, _, files in os.walk(sing))
    print("singles total", total, "in", len(os.listdir(sing)), "themes")
