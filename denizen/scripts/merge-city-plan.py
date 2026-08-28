#!/usr/bin/env python3
"""Merge data/city-specs/d*.json district fragments into data/city-plan.json.

Adds arterial connector roads and the subway teleport portals (wired to the
D3 Station Square stair entrances). Validates every referenced asset exists.
Run after editing any district fragment.

Compiler-generated fragments (scripts/compile-exterior-district.py) write to
data/city-specs/generated/*.json, deliberately OUTSIDE the default `d*.json`
glob so a WIP compile can't disturb the hand-authored city. Pass
--include-generated to also merge data/city-specs/generated/d*.json once a
compiled district is ready to promote (see docs/EXTERIOR-COMPILER.md).

--compiler-replaces HAND is the surgical alternative to --include-generated:
for every hand district data/city-specs/d{N}-*.json that has a matching
data/city-specs/generated/d{N}-compiled.json, it takes ONLY stamps/anims/
labels from the compiled fragment (dropping the hand district's own
stamps/anims/labels), while patches/roads/solids/animBands/portals/npcs/
vehicles still come from the hand fragment — UNLESS the compiled fragment's
spec set compiler.full_bbox: true, in which case the compiler repainted the
district's entire ground plane and its patches are used instead of the
hand file's (stale/partial) ones. Districts with no compiled counterpart are
merged unchanged. See docs/EXTERIOR-COMPILER.md.
"""

import argparse
import glob
import json
import os
import re
import sys

from PIL import Image

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECS = os.path.join(DEN, "data", "city-specs")
GENERATED = os.path.join(SPECS, "generated")
ASSETS = os.path.join(DEN, "assets", "limezu")
OUT = os.path.join(DEN, "data", "city-plan.json")

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument("--include-generated", action="store_true",
                help="also merge data/city-specs/generated/d*.json "
                     "(compiler-generated district fragments)")
ap.add_argument("--compiler-replaces", choices=["HAND"], default=None,
                help="HAND: for each hand district with a matching "
                     "data/city-specs/generated/d{N}-compiled.json, replace "
                     "its stamps/anims/labels with the compiled fragment's "
                     "(patches/roads/solids/portals/npcs/vehicles still come "
                     "from the hand file, unless the spec painted full_bbox)")
args = ap.parse_args()
if args.compiler_replaces and args.include_generated:
    print("note: --compiler-replaces already folds in every matching "
          "generated/d*-compiled.json; ignoring --include-generated")
    args.include_generated = False

merged = {"worldSize": {"w": 6656, "h": 6400}, "patches": [], "roads": [],
          "stamps": [], "anims": [], "animBands": [], "solids": [],
          "labels": [], "portals": [], "npcs": [], "vehicles": []}

# d00-structure furniture (auto-placed trees/lamps) is placed knowing only the
# roads, not the districts — so where a road passes THROUGH a district it drops
# props onto buildings. Tag those stamps here so we can prune the collisions
# post-merge, once every district's stamps are known.
_struct_furniture = []

# --compiler-replaces HAND: build district-number -> compiled-fragment-path
# map so the loop below can splice each hand district's stamps/anims/labels
# for the compiler's, district by district.
_replace_map = {}
if args.compiler_replaces == "HAND":
    for gf in sorted(glob.glob(os.path.join(GENERATED, "d*-compiled.json"))):
        m = re.match(r"^d(\d+)-compiled\.json$", os.path.basename(gf))
        if m:
            _replace_map[int(m.group(1))] = gf
    print(f"--compiler-replaces HAND: {len(_replace_map)} compiled district(s) "
          f"available: {sorted(_replace_map)}")

_frag_files = sorted(glob.glob(os.path.join(SPECS, "d*.json")))
_generated_files = sorted(glob.glob(os.path.join(GENERATED, "d*.json"))) if args.include_generated else []
_frag_files += _generated_files
if args.include_generated:
    print(f"including {len(_generated_files)} generated fragment(s): "
          f"{[os.path.basename(f) for f in _generated_files]}")

_REPLACED_KEYS = ("stamps", "anims", "labels")
_replace_log = []

for f in _frag_files:
    frag = json.load(open(f, encoding="utf-8"))
    base = os.path.basename(f)
    is_struct = base.startswith("d00")

    dist_num = None
    dm = re.match(r"^d(\d+)-", base)
    if dm:
        dist_num = int(dm.group(1))
    replacement = _replace_map.get(dist_num) if dist_num is not None else None

    gen_frag = None
    prefer_generated_patches = False
    if replacement:
        gen_frag = json.load(open(replacement, encoding="utf-8"))
        spec_path = gen_frag.get("_compiled", {}).get("spec")
        if spec_path:
            spec_full = spec_path if os.path.isabs(spec_path) else os.path.join(DEN, spec_path)
            if os.path.exists(spec_full):
                spec = json.load(open(spec_full, encoding="utf-8"))
                prefer_generated_patches = bool(spec.get("compiler", {}).get("full_bbox"))

    for k in merged:
        if k == "worldSize":
            continue
        if replacement and k in _REPLACED_KEYS:
            continue  # dropped from hand; the compiled fragment supplies these below
        if replacement and k == "patches" and prefer_generated_patches:
            continue  # compiler repainted the whole bbox; use its patches instead
        if k == "stamps" and is_struct:
            for s in frag.get("stamps", []):
                _struct_furniture.append(s)
        merged[k].extend(frag.get(k, []))

    if gen_frag:
        for k in _REPLACED_KEYS:
            merged[k].extend(gen_frag.get(k, []))
        if prefer_generated_patches:
            merged["patches"].extend(gen_frag.get("patches", []))
        _replace_log.append(
            f"  D{dist_num}: {base} -> {os.path.basename(replacement)}  "
            f"stamps {len(frag.get('stamps', []))}->{len(gen_frag.get('stamps', []))}, "
            f"anims {len(frag.get('anims', []))}->{len(gen_frag.get('anims', []))}, "
            f"labels {len(frag.get('labels', []))}->{len(gen_frag.get('labels', []))}, "
            f"patches from {'generated (' + str(len(gen_frag.get('patches', []))) + ')' if prefer_generated_patches else 'hand (' + str(len(frag.get('patches', []))) + ')'}"
        )

if _replace_log:
    print("compiler-replaces summary:")
    for line in _replace_log:
        print(line)

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
# props: tents, vehicles, barriers, district trees, compiler-placed decor...).
# Districts landscape themselves, so auto street-furniture should survive only
# on open pavement. No minimum-size floor: compiler-generated districts pack
# small solid decor (16x16 rocks, flowers, wood scraps) densely enough near
# roads that a "tiny decals don't matter" floor let auto lamps/trees land
# right on top of them (see docs/EXTERIOR-COMPILER.md — merge-time collisions).
_obstacles = []
for s in merged["stamps"]:
    if id(s) in _struct_ids or not s.get("solid"):
        continue
    r = _rect(s)
    if r and r[2] * r[3] > 0:
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
            # ratio vs whichever rect is smaller — a tiny compiler-placed decal
            # fully swallowed by a big lamp footprint is just as much a defect
            # as a big building swallowing a chunk of a lamp
            smaller = min(fr[2] * fr[3], rw * rh)
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
# _BLD_KW catches some non-building props by folder-name coincidence (e.g.
# "Stands_1" bleachers live under the school/ catalog folder, "Tree_House_1"
# under villas/). Guard the nudge against ALL solid stamps, not just other
# _is_bld matches, so a nudge can't shove one of these onto a compiler-placed
# decor item that wasn't there when this heuristic was written.
_all_solid = [(s, _rect(s)) for s in merged["stamps"] if s.get("solid")]
_all_solid = [(s, r) for s, r in _all_solid if r]
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
    if (_hits_road(cand)
            or any(_ov(cand, orect) for os_, orect in _all_solid if os_ is not s)):
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
