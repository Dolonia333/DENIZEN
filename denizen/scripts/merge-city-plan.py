#!/usr/bin/env python3
"""Merge data/city-specs/d*.json district fragments into data/city-plan.json.

Adds arterial connector roads and the subway teleport portals (wired to the
D3 Station Square stair entrances). Validates every referenced asset exists.
Run after editing any district fragment.
"""

import glob
import json
import os

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECS = os.path.join(DEN, "data", "city-specs")
OUT = os.path.join(DEN, "data", "city-plan.json")

merged = {"worldSize": {"w": 6144, "h": 5632}, "patches": [], "roads": [],
          "stamps": [], "anims": [], "animBands": [], "solids": [],
          "labels": [], "portals": []}

for f in sorted(glob.glob(os.path.join(SPECS, "d*.json"))):
    frag = json.load(open(f, encoding="utf-8"))
    for k in merged:
        if k == "worldSize":
            continue
        merged[k].extend(frag.get(k, []))

# Avenue connectors (old city -> D1 -> D3)
merged["roads"] += [
    {"x": 3940, "y": 1880, "w": 160, "h": 64},
    {"x": 5100, "y": 1880, "w": 100, "h": 64},
]

# Subway teleports: D3 stair entrances <-> underground platforms
d3 = json.load(open(os.path.join(SPECS, "d3-station.json"), encoding="utf-8"))
stairs = sorted([s for s in d3["stamps"] if "tairs" in s["img"]], key=lambda s: s["x"])
w_ent, e_ent = stairs[0], stairs[-1]
merged["portals"] += [
    {"x0": w_ent["x"], "x1": w_ent["x"] + 48, "y": w_ent["y"] + 8, "teleport": {"x": 728, "y": 5400}},
    {"x0": e_ent["x"], "x1": e_ent["x"] + 48, "y": e_ent["y"] + 8, "teleport": {"x": 4024, "y": 5400}},
    {"x0": 704, "x1": 752, "y": 5344, "teleport": {"x": w_ent["x"] + 24, "y": w_ent["y"] + 40}},
    {"x0": 4000, "x1": 4048, "y": 5344, "teleport": {"x": e_ent["x"] + 24, "y": e_ent["y"] + 40}},
]

missing = []
for s in merged["stamps"]:
    if not os.path.exists(os.path.join(DEN, "assets", "limezu", s["img"].replace("/", os.sep))):
        missing.append(s["img"])
for a in merged["anims"] + merged["animBands"]:
    key = a.get("sheet")
    if key and not os.path.exists(os.path.join(DEN, "assets", "limezu", key.replace("/", os.sep))):
        missing.append(key)

json.dump(merged, open(OUT, "w", encoding="utf-8"), indent=1)
print("merged:", {k: len(v) for k, v in merged.items() if isinstance(v, list)})
print("missing:", len(missing))
for m in missing[:10]:
    print("  MISS", m)
