#!/usr/bin/env python3
"""Grid-align every tiled surface to the 16px LimeZu tile grid.

Tiled patches (sidewalk/grass/asphalt/sand) and roads render as repeated
16px tiles. If their origin/size is off-grid, the edge shows a partial tile
(a visible seam) — the classic "not pixel perfect" artifact. This snaps each
patch/road x,y to the nearest 16 and w,h up to the next 16, so every tiled
area aligns cleanly with no partial tiles. Operates on the d00-structure
fragment + every district fragment's patches/roads. Stamps are NOT touched
(their baseline precision is handled by the visual pixel audit).
"""

import glob
import json
import os

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECS = os.path.join(DEN, "data", "city-specs")
T = 16


def snap_floor(v):
    return int(round(v / T) * T)


def snap_ceil(v):
    return int((v + T - 1) // T * T)


def align(frag):
    n = 0
    for p in frag.get("patches", []):
        ox, oy, ow, oh = p["x"], p["y"], p["w"], p["h"]
        p["x"], p["y"] = snap_floor(ox), snap_floor(oy)
        p["w"], p["h"] = snap_ceil(ow), snap_ceil(oh)
        if (p["x"], p["y"], p["w"], p["h"]) != (ox, oy, ow, oh):
            n += 1
    for r in frag.get("roads", []):
        ox, oy = r["x"], r["y"]
        r["x"], r["y"] = snap_floor(ox), snap_floor(oy)
        if "w" in r:
            r["w"] = snap_ceil(r["w"])
        if "h" in r:
            r["h"] = snap_ceil(r["h"])
        if (r["x"], r["y"]) != (ox, oy):
            n += 1
    return n


def main():
    total = 0
    for f in sorted(glob.glob(os.path.join(SPECS, "d*.json"))):
        frag = json.load(open(f, encoding="utf-8"))
        n = align(frag)
        if n:
            json.dump(frag, open(f, "w", encoding="utf-8"), indent=1)
            print(f"  {os.path.basename(f):24s} aligned {n} surfaces")
            total += n
    print(f"grid-aligned {total} tiled surfaces to {T}px")


if __name__ == "__main__":
    main()
