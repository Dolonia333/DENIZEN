#!/usr/bin/env python3
"""Merge data/city-specs/d*.json district fragments into data/city-plan.json.

Adds arterial connector roads and the subway teleport portals (wired to the
D3 Station Square stair entrances). Validates every referenced asset exists.
Run after editing any district fragment.
"""

import glob
import json
import os
import sys

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

# Resolve exterior catalog ids (me.* / exs.*) → img paths before footprint math.
import sys
sys.path.insert(0, os.path.join(DEN, "scripts"))
from resolve_limezu_me_stamps import (  # noqa: E402
    OUT_INDEX,
    build_placement_index,
    resolve_stamps,
)

if not os.path.exists(OUT_INDEX):
    idx = build_placement_index()
    json.dump(idx, open(OUT_INDEX, "w", encoding="utf-8"), indent=2)
    open(OUT_INDEX, "a", encoding="utf-8").write("\n")

merged["stamps"], _me_errs = resolve_stamps(merged["stamps"])
if _me_errs:
    print("me/exs resolve errors:", len(_me_errs))
    for e in _me_errs[:10]:
        print(" ", e)

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


def _overlap_area(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ox = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    oy = max(0, min(ay + ah, by + bh) - max(ay, by))
    return ox * oy


def _base_in_obstacle(s):
    """True if structure furniture collides with a district obstacle.

    Uses baseline point (legacy) OR substantial sprite overlap so lamps/trees
    that stand just outside a building footprint but visually sit inside it
    still get pruned.
    """
    bx, by = s["x"], s["y"]          # furniture is origin "bc": (x,y) is the base
    fr = _rect(s)
    for rx, ry, rw, rh in _obstacles:
        # inset 2px — tighter than before so curb-side props near facades prune
        if rx + 2 <= bx <= rx + rw - 2 and ry + 2 <= by <= ry + rh:
            return True
        if fr:
            oa = _overlap_area(fr, (rx, ry, rw, rh))
            smaller = fr[2] * fr[3]
            if smaller and oa / smaller > 0.25:
                return True
    return False


_before = len(merged["stamps"])
merged["stamps"] = [s for s in merged["stamps"]
                    if not (id(s) in _struct_ids and _base_in_obstacle(s))]
_pruned = _before - len(merged["stamps"])

# --- Nudge buildings off the grid streets -------------------------------------
# Districts were placed before the street grid, so some buildings straddle a
# street. Shift each on-road building perpendicular to that street just far
# enough to clear it — but ONLY if the new spot hits no road and overlaps no
# other building. So it can only improve, never create a new collision.
_roads = [(r["x"], r["y"], r.get("w", 0), r.get("h", 0)) for r in merged["roads"]]
_BLD_KW = ("building", "house", "hotel", "hospital", "mall", "market", "store",
           "condo", "villa", "school", "_station", "barn", "hangar", "office",
           "police", "fire_station", "museum", "apartment", "bank", "chapel",
           "post_office", "warehouse", "silo", "farmhouse")


def _ov(a, b):
    return (a[0] < b[0] + b[2] and a[0] + a[2] > b[0]
            and a[1] < b[1] + b[3] and a[1] + a[3] > b[1])


def _hits_road(rect):
    return any(_ov(rect, r) for r in _roads)


def _is_bld(img):
    return any(k in img.lower() for k in _BLD_KW)


_bld = [(s, _rect(s)) for s in merged["stamps"] if _is_bld(s["img"])]
_bld = [(s, r) for s, r in _bld if r]
_nudged = 0
for s, r in _bld:
    road = next((rd for rd in _roads if _ov(r, rd)), None)
    if not road:
        continue
    rx, ry, rw, rh = road
    if rw >= rh:                              # horizontal street: push up/down
        up = ry - (r[1] + r[3]) - 4
        dn = (ry + rh) - r[1] + 4
        d = up if abs(up) <= abs(dn) else dn
        cand, nx, ny = (r[0], r[1] + d, r[2], r[3]), s["x"], s["y"] + d
    else:                                    # vertical street: push left/right
        lf = rx - (r[0] + r[2]) - 4
        rt = (rx + rw) - r[0] + 4
        d = lf if abs(lf) <= abs(rt) else rt
        cand, nx, ny = (r[0] + d, r[1], r[2], r[3]), s["x"] + d, s["y"]
    if _hits_road(cand) or any(_ov(cand, br) for bs, br in _bld if bs is not s):
        continue
    s["x"], s["y"] = nx, ny
    _nudged += 1

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
print(f"nudged {_nudged} buildings off the streets")
print("missing:", len(missing))
for m in missing[:10]:
    print("  MISS", m)

# QA gate (advisory print; exit code left to check-city-plan when run alone)
import subprocess
qa = subprocess.run(
    [sys.executable, os.path.join(DEN, "scripts", "check-city-plan.py"), OUT],
    capture_output=True, text=True,
)
print(qa.stdout.strip() or qa.stderr.strip())
if qa.returncode:
    print("(merge wrote plan anyway — re-run check-city-plan.py until clean)")
