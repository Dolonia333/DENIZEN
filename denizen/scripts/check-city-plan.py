#!/usr/bin/env python3
"""City plan QA — automatic defect detection for district fragments and the
merged plan. Catches what eyeballing misses:

  OVERLAP    two solid stamps whose sprite rects overlap substantially
  FLOATING   a stamp with no ground patch/road under its baseline (grass-void)
  ROADBLOCK  a solid that covers a road's driving lane
  OFFWORLD   anything outside the world bounds
  BADANIM    anim sheet whose dimensions aren't divisible by fw/fh

Usage:
  py scripts/check-city-plan.py                       # checks data/city-plan.json
  py scripts/check-city-plan.py data/city-specs/d7-park.json
Exit code 1 if any defect found (usable as a merge gate).
"""

import json
import os
import sys

from PIL import Image

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(DEN, "assets", "limezu")

# Ground types that count as "real ground" under urban structures.
URBAN_TILES = {"sidewalk", "asphalt", "sand"}


def sprite_rect(s, dims_cache):
    p = os.path.join(ASSETS, s["img"].replace("/", os.sep))
    if p not in dims_cache:
        try:
            with Image.open(p) as im:
                dims_cache[p] = im.size
        except Exception:
            dims_cache[p] = None
    d = dims_cache[p]
    if d is None:
        return None
    w, h = d
    origin = s.get("origin", "bl")
    if origin == "tl":
        return (s["x"], s["y"], w, h)
    if origin == "bc":
        return (s["x"] - w // 2, s["y"] - h, w, h)
    return (s["x"], s["y"] - h, w, h)


def overlap_area(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ox = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    oy = max(0, min(ay + ah, by + bh) - max(ay, by))
    return ox * oy


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(DEN, "data", "city-plan.json")
    plan = json.load(open(src, encoding="utf-8"))
    world_w = plan.get("worldSize", {}).get("w", 6144)
    world_h = plan.get("worldSize", {}).get("h", 6400)
    defects = []
    dims = {}

    stamps = plan.get("stamps", [])
    rects = []
    for s in stamps:
        r = sprite_rect(s, dims)
        if r is None:
            defects.append(("MISSING", s["img"], ""))
            continue
        rects.append((s, r))
        if r[0] < 0 or r[1] < 0 or r[0] + r[2] > world_w or r[1] + r[3] > world_h:
            defects.append(("OFFWORLD", s["img"], f"rect {r}"))

    # Overlaps: only flag pairs where BOTH are solid buildings/props and the
    # overlap exceeds 35% of the smaller sprite (decor layering is fine).
    solid_rects = [(s, r) for s, r in rects if s.get("solid")]
    for i in range(len(solid_rects)):
        for j in range(i + 1, len(solid_rects)):
            s1, r1 = solid_rects[i]
            s2, r2 = solid_rects[j]
            oa = overlap_area(r1, r2)
            smaller = min(r1[2] * r1[3], r2[2] * r2[3])
            if smaller and oa / smaller > 0.35:
                defects.append(("OVERLAP",
                                f"{os.path.basename(s1['img'])} @({s1['x']},{s1['y']})",
                                f"vs {os.path.basename(s2['img'])} @({s2['x']},{s2['y']}) {int(100*oa/smaller)}%"))

    # Floating: solid stamps whose baseline center has no urban patch/road
    # beneath (grass counts as valid ground only if a grass patch is declared
    # or the stamp is a nature prop — heuristic: trees/bushes/rocks skip).
    NATURE = ("tree", "bush", "rock", "flower", "plant", "grass", "hedge")
    grounds = []
    for p in plan.get("patches", []):
        grounds.append((p["x"], p["y"], p["w"], p["h"]))
    for r in plan.get("roads", []):
        grounds.append((r["x"] - 16, r["y"] - 16, r["w"] + 32, r["h"] + 32))
    for s, rct in rects:
        if not s.get("solid"):
            continue
        name = s["img"].lower()
        if any(n in name for n in NATURE):
            continue
        bx = rct[0] + rct[2] // 2
        by = rct[1] + rct[3] - 4
        if not any(gx <= bx <= gx + gw and gy <= by <= gy + gh for gx, gy, gw, gh in grounds):
            defects.append(("FLOATING", os.path.basename(s["img"]), f"base ({bx},{by}) on bare grass"))

    # Road blockers
    for r in plan.get("roads", []):
        lane = (r["x"], r["y"], r["w"], r["h"])
        for sol in plan.get("solids", []):
            srect = (sol["x"], sol["y"], sol.get("w", 0), sol.get("h", 0))
            if overlap_area(lane, srect) > 24 * 24:
                defects.append(("ROADBLOCK", f"solid {srect}", f"covers road {lane}"))

    # Anim frame math
    for a in plan.get("anims", []) + plan.get("animBands", []) + plan.get("vehicles", []):
        sheet = a.get("sheet")
        if not sheet:
            continue
        p = os.path.join(ASSETS, sheet.replace("/", os.sep))
        try:
            with Image.open(p) as im:
                w, h = im.size
        except Exception:
            defects.append(("MISSING", sheet, ""))
            continue
        fw, fh = a.get("fw", 16), a.get("fh", 16)
        if w % fw or h % fh:
            defects.append(("BADANIM", sheet, f"{w}x{h} not divisible by {fw}x{fh}"))

    print(f"checked {src}: {len(stamps)} stamps")
    counts = {}
    for kind, a, b in defects:
        counts[kind] = counts.get(kind, 0) + 1
    print("defects:", counts or "none")
    for kind, a, b in defects[:40]:
        print(f"  {kind:9s} {a}  {b}")
    if len(defects) > 40:
        print(f"  ... and {len(defects) - 40} more")
    sys.exit(1 if defects else 0)


if __name__ == "__main__":
    main()
