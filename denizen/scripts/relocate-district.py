#!/usr/bin/env python3
"""Relocate / compress a district fragment's geometry as a whole.

Transforms every coordinate-bearing element (patches, roads, stamps, anims,
animBands, solids, labels, portals surface side, npcs, vehicle paths) by:
  new = origin + (old - pivot) * scale
where pivot defaults to the fragment's current min corner.

Usage:
  py scripts/relocate-district.py <file.json> --to X Y [--scale S]
  py scripts/relocate-district.py <file.json> --by DX DY [--scale S]
"""

import json
import sys


def frag_min(frag):
    xs, ys = [], []
    for p in frag.get("patches", []):
        xs.append(p["x"]); ys.append(p["y"])
    for s in frag.get("stamps", []):
        xs.append(s["x"]); ys.append(s["y"])
    for a in frag.get("anims", []) + frag.get("animBands", []):
        xs.append(a["x"]); ys.append(a["y"])
    for r in frag.get("roads", []) + frag.get("solids", []):
        xs.append(r["x"]); ys.append(r["y"])
    return (min(xs) if xs else 0, min(ys) if ys else 0)


def transform(frag, ox, oy, px, py, sx, sy):
    def tx(x): return round(ox + (x - px) * sx)
    def ty(y): return round(oy + (y - py) * sy)

    for p in frag.get("patches", []):
        p["x"], p["y"] = tx(p["x"]), ty(p["y"])
        p["w"], p["h"] = round(p["w"] * sx), round(p["h"] * sy)
    for r in frag.get("roads", []) + frag.get("solids", []):
        r["x"], r["y"] = tx(r["x"]), ty(r["y"])
        if "w" in r: r["w"] = round(r["w"] * sx)
        if "h" in r: r["h"] = round(r["h"] * sy)
    for s in frag.get("stamps", []):
        s["x"], s["y"] = tx(s["x"]), ty(s["y"])
    for a in frag.get("anims", []):
        a["x"], a["y"] = tx(a["x"]), ty(a["y"])
    for a in frag.get("animBands", []):
        a["x"], a["y"] = tx(a["x"]), ty(a["y"])
        a["w"], a["h"] = round(a["w"] * sx), round(a["h"] * sy)
    for l in frag.get("labels", []):
        l["x"], l["y"] = tx(l["x"]), ty(l["y"])
    for n in frag.get("npcs", []):
        n["x"], n["y"] = tx(n["x"]), ty(n["y"])
    for pt in frag.get("portals", []):
        pt["x0"], pt["x1"], pt["y"] = tx(pt["x0"]), tx(pt["x1"]), ty(pt["y"])
    for v in frag.get("vehicles", []):
        v["path"] = [[tx(x), ty(y)] for x, y in v["path"]]


def main():
    f = sys.argv[1]
    frag = json.load(open(f, encoding="utf-8"))
    scale = 1.0
    if "--scale" in sys.argv:
        scale = float(sys.argv[sys.argv.index("--scale") + 1])
    px, py = frag_min(frag)
    if "--to" in sys.argv:
        i = sys.argv.index("--to")
        ox, oy = float(sys.argv[i + 1]), float(sys.argv[i + 2])
    else:
        i = sys.argv.index("--by")
        dx, dy = float(sys.argv[i + 1]), float(sys.argv[i + 2])
        ox, oy = px + dx, py + dy
    transform(frag, ox, oy, px, py, scale, scale)
    json.dump(frag, open(f, "w", encoding="utf-8"), indent=1)
    nm = frag_min(frag)
    print(f"{f}: pivot ({px},{py}) scale {scale} -> new min {nm}")


if __name__ == "__main__":
    main()
