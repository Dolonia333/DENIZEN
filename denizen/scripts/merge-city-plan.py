#!/usr/bin/env python3
"""Merge data/city-specs/d*.json district fragments into data/city-plan.json.

Adds arterial connector roads and the subway teleport portals (wired to the
D3 Station Square stair entrances). Validates every referenced asset exists.
Run after editing any district fragment.
"""

import glob
import json
import os

from PIL import Image

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECS = os.path.join(DEN, "data", "city-specs")
ASSETS = os.path.join(DEN, "assets", "limezu")
OUT = os.path.join(DEN, "data", "city-plan.json")

merged = {"worldSize": {"w": 6656, "h": 6400}, "patches": [], "roads": [],
          "stamps": [], "anims": [], "animBands": [], "solids": [],
          "labels": [], "portals": [], "npcs": [], "vehicles": []}

# d00-structure furniture (auto-placed trees/lamps) is placed knowing only the
# roads, not the districts — so where a road passes THROUGH a district it drops
# props onto buildings. Tag those stamps here so we can prune the collisions
# post-merge, once every district's stamps are known.
_struct_furniture = []

for f in sorted(glob.glob(os.path.join(SPECS, "d*.json"))):
    frag = json.load(open(f, encoding="utf-8"))
    is_struct = os.path.basename(f).startswith("d00")
    for k in merged:
        if k == "worldSize":
            continue
        if k == "stamps" and is_struct:
            for s in frag.get("stamps", []):
                _struct_furniture.append(s)
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

# Shop interior doors: surface building -> interior room landing, per d16
d15 = json.load(open(os.path.join(SPECS, "d15-downtown.json"), encoding="utf-8"))
_h = [st for st in d15["stamps"] if "Hotel_1" in st["img"]]
hotel_door = (_h[0]["x"] + 136, _h[0]["y"]) if _h else (2250, 1450)
SHOP_DOORS = [
    ((4560, 1880), (1000, 6085)),   # D1 MARKET -> grocery
    ((4700, 1880), (1600, 6085)),   # D1 MARKET 2 -> clothing
    ((4480, 2056), (2200, 6085)),   # kiosk plaza -> ice cream
    ((5560, 1860), (2800, 6085)),   # Station Square -> museum
    (hotel_door, (3400, 6085)),     # D15 hotel -> lobby
]
for (sx, sy), (ix, iy) in SHOP_DOORS:
    merged["portals"].append({"x0": sx - 24, "x1": sx + 24, "y": sy, "teleport": {"x": ix, "y": iy}})
# Re-point d16's placeholder hotel exit to the real hotel front
for pt in merged["portals"]:
    t = pt.get("teleport") or {}
    if t.get("x") == 4640 and t.get("y") == 1880:
        t["x"], t["y"] = hotel_door[0], hotel_door[1] + 20

# --- Prune structure furniture that lands on district buildings ---------------
# A tree/lamp whose base point falls inside a real building footprint is wrong
# (the road-shoulder generator can't see districts). Drop those specific stamps.
_dim_cache = {}


def _dims(img):
    if img not in _dim_cache:
        try:
            with Image.open(os.path.join(ASSETS, img.replace("/", os.sep))) as im:
                _dim_cache[img] = im.size
        except Exception:
            _dim_cache[img] = None
    return _dim_cache[img]


def _rect(s):
    d = _dims(s["img"])
    if not d:
        return None
    w, h = d
    o = s.get("origin", "bl")
    if o == "tl":
        return (s["x"], s["y"], w, h)
    if o == "bc":
        return (s["x"] - w // 2, s["y"] - h, w, h)
    return (s["x"], s["y"] - h, w, h)


_struct_ids = {id(s) for s in _struct_furniture}
# Obstacle footprints = every SOLID non-structure stamp (buildings AND placed
# props: tents, vehicles, barriers, district trees...). Districts landscape
# themselves, so auto street-furniture should survive only on open pavement.
_obstacles = []
for s in merged["stamps"]:
    if id(s) in _struct_ids or not s.get("solid"):
        continue
    r = _rect(s)
    if r and r[2] * r[3] > 24 * 24:   # ignore tiny decals
        _obstacles.append(r)


def _base_in_obstacle(s):
    bx, by = s["x"], s["y"]          # furniture is origin "bc": (x,y) is the base
    for rx, ry, rw, rh in _obstacles:
        # inset 6px so props legitimately hugging an edge survive
        if rx + 6 <= bx <= rx + rw - 6 and ry + 6 <= by <= ry + rh:
            return True
    return False


_before = len(merged["stamps"])
merged["stamps"] = [s for s in merged["stamps"]
                    if not (id(s) in _struct_ids and _base_in_obstacle(s))]
_pruned = _before - len(merged["stamps"])

missing = []
for s in merged["stamps"]:
    if not os.path.exists(os.path.join(DEN, "assets", "limezu", s["img"].replace("/", os.sep))):
        missing.append(s["img"])
for a in merged["anims"] + merged["animBands"] + merged["vehicles"]:
    key = a.get("sheet")
    if key and not os.path.exists(os.path.join(DEN, "assets", "limezu", key.replace("/", os.sep))):
        missing.append(key)

json.dump(merged, open(OUT, "w", encoding="utf-8"), indent=1)
print("merged:", {k: len(v) for k, v in merged.items() if isinstance(v, list)})
print(f"pruned {_pruned} structure props off building footprints")
print("missing:", len(missing))
for m in missing[:10]:
    print("  MISS", m)
