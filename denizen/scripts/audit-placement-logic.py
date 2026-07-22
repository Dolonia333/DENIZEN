#!/usr/bin/env python3
"""Placement-logic audit — beyond "is the sprite cut right", checks whether
each sprite is placed on its LOGICAL surface, from semantic role (inferred
from the LimeZu filename) vs where it sits in the plan.

Role rules (LimeZu naming is descriptive):
  WALL_MOUNT  painting/frame/poster/clock/mirror/sign_hanging/whiteboard/
              cork/diploma/cert/mona_lisa  -> must abut a building's face
              (a solid building stamp within ~24px above its baseline)
  ROOF        roof_/antenna/satellite/chimney/solar/vent/water_tank/
              ac_unit/air_conditioner  -> must sit ON a building (overlapping
              a building stamp), not on open ground
  WATER       buoy/boat/ship/wave  -> must be on a water animBand/patch
  Everything else: GROUND (must be on a patch/road — the FLOATING check
  already covers grass-voids).

Reports counts + the worst offenders. Advisory (exit 0) — placement is
judgment-heavy, so this surfaces suspects for the visual agent pass.
"""

import json
import os
import sys

from PIL import Image

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(DEN, "assets", "limezu")
PLAN = os.path.join(DEN, "data", "city-plan.json")

WALL_KW = ("painting", "_frame", "poster", "clock", "mirror", "sign_hanging",
           "whiteboard", "cork", "diploma", "_cert", "mona_lisa", "wall_art",
           "_sign_new", "hanging_sign", "billboard")
ROOF_KW = ("roof_", "antenna", "satellite", "chimney", "solar", "_vent",
           "water_tank", "ac_unit", "air_conditioner", "rooftop")
WATER_KW = ("buoy", "_boat", "_ship", "sailboat")
BUILDING_KW = ("building", "house", "hotel", "hospital", "mall", "market",
               "store", "condo", "villa", "school", "station", "barn",
               "hangar", "barrack", "chapel", "office", "chapel", "chapel")


def role(img):
    n = img.lower()
    if any(k in n for k in WALL_KW):
        return "WALL"
    if any(k in n for k in ROOF_KW):
        return "ROOF"
    if any(k in n for k in WATER_KW):
        return "WATER"
    return "GROUND"


def is_building(img):
    return any(k in img.lower() for k in BUILDING_KW)


def rect(s, dims):
    p = os.path.join(ASSETS, s["img"].replace("/", os.sep))
    if p not in dims:
        try:
            with Image.open(p) as im:
                dims[p] = im.size
        except Exception:
            dims[p] = None
    d = dims[p]
    if not d:
        return None
    w, h = d
    o = s.get("origin", "bl")
    if o == "tl":
        return (s["x"], s["y"], w, h)
    if o == "bc":
        return (s["x"] - w // 2, s["y"] - h, w, h)
    return (s["x"], s["y"] - h, w, h)


def overlaps(a, b):
    return (a[0] < b[0] + b[2] and a[0] + a[2] > b[0]
            and a[1] < b[1] + b[3] and a[1] + a[3] > b[1])


def main():
    plan = json.load(open(PLAN, encoding="utf-8"))
    dims = {}
    stamps = plan.get("stamps", [])
    rects = [(s, rect(s, dims)) for s in stamps]
    buildings = [(s, r) for s, r in rects if r and is_building(s["img"])]
    water_zones = []
    for b in plan.get("animBands", []):
        water_zones.append((b["x"], b["y"], b["w"], b["h"]))
    for p in plan.get("patches", []):
        if p.get("tile") == "sand":  # beach sand — near water ok
            water_zones.append((p["x"], p["y"], p["w"], p["h"]))

    suspect = {"WALL": [], "ROOF": [], "WATER": []}
    for s, r in rects:
        if not r:
            continue
        role_ = role(s["img"])
        if role_ == "GROUND":
            continue
        name = os.path.basename(s["img"])
        if role_ == "ROOF":
            on_bldg = any(overlaps(r, br) for bs, br in buildings if bs is not s)
            if not on_bldg:
                suspect["ROOF"].append((name, s["x"], s["y"]))
        elif role_ == "WALL":
            # wall item should have a building whose base is just below/at it
            near = any(abs((br[1]) - (r[1] + r[3])) < 40 and br[0] - 40 < s["x"] < br[0] + br[2] + 40
                       for bs, br in buildings if bs is not s)
            # or overlapping a building (mounted on the face)
            near = near or any(overlaps(r, br) for bs, br in buildings if bs is not s)
            if not near:
                suspect["WALL"].append((name, s["x"], s["y"]))
        elif role_ == "WATER":
            inw = any(zx <= s["x"] <= zx + zw and zy <= s["y"] <= zy + zh
                      for zx, zy, zw, zh in water_zones)
            if not inw:
                suspect["WATER"].append((name, s["x"], s["y"]))

    print(f"placement-logic audit of {len(stamps)} stamps:")
    for role_, items in suspect.items():
        print(f"  {role_:6s} misplaced: {len(items)}")
        for name, x, y in items[:14]:
            print(f"     {name[:46]:46s} @({x},{y})")
        if len(items) > 14:
            print(f"     ... +{len(items)-14} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
