#!/usr/bin/env python3
"""Offline city-district renderer — composes a district fragment JSON into a
PNG exactly as the game would draw it (patches, roads, stamps with baseline
origins and y-sort, first frame of anims/animBands). Gives layout agents eyes:
render, look, adjust the JSON, re-render.

Usage:
  py scripts/render-city-preview.py data/city-specs/d7-park.json [out.png]
  py scripts/render-city-preview.py --plan            # full data/city-plan.json
"""

import json
import os
import sys

from PIL import Image

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(DEN, "assets", "limezu")

TILE_COLORS = {
    "grass": (106, 190, 92),
    "sidewalk": (200, 200, 198),
    "asphalt": (85, 81, 83),
    "sand": (230, 178, 87),
}


def first_frame(path, fw, fh):
    im = Image.open(path).convert("RGBA")
    return im.crop((0, 0, min(fw, im.width), min(fh, im.height)))


def render(frag, pad=64):
    xs, ys = [], []

    def track(x, y, w=0, h=0):
        xs.extend([x, x + w])
        ys.extend([y, y + h])

    for p in frag.get("patches", []):
        track(p["x"], p["y"], p["w"], p["h"])
    for r in frag.get("roads", []):
        track(r["x"], r["y"], r["w"], r["h"])
    for s in frag.get("stamps", []):
        track(s["x"], s["y"] - 220, 320, 260)
    for a in frag.get("anims", []) + frag.get("animBands", []):
        track(a["x"], a.get("y", 0), a.get("w", 64), a.get("h", 64))
    if not xs:
        raise SystemExit("empty fragment")
    x0, y0 = min(xs) - pad, min(ys) - pad
    x1, y1 = max(xs) + pad, max(ys) + pad
    W, H = int(x1 - x0), int(y1 - y0)
    canvas = Image.new("RGBA", (W, H), TILE_COLORS["grass"] + (255,))

    def fill(x, y, w, h, color):
        Image.Image.paste(canvas, Image.new("RGBA", (int(w), int(h)), color + (255,)),
                          (int(x - x0), int(y - y0)))

    for p in sorted(frag.get("patches", []), key=lambda q: q.get("depth", 0.9)):
        fill(p["x"], p["y"], p["w"], p["h"], TILE_COLORS.get(p["tile"], (150, 150, 150)))
    for r in frag.get("roads", []):
        fill(r["x"] - 16, r["y"] - 16, r["w"] + 32, r["h"] + 32, TILE_COLORS["sidewalk"])
        fill(r["x"], r["y"], r["w"], r["h"], TILE_COLORS["asphalt"])

    for b in frag.get("animBands", []):
        f = first_frame(os.path.join(ASSETS, b["sheet"]), b.get("fw", 16), b.get("fh", 16))
        for yy in range(int(b["y"]), int(b["y"] + b["h"]), b.get("fh", 16)):
            for xx in range(int(b["x"]), int(b["x"] + b["w"]), b.get("fw", 16)):
                canvas.alpha_composite(f, (int(xx - x0), int(yy - y0)))

    drawables = []
    for s in frag.get("stamps", []):
        p = os.path.join(ASSETS, s["img"])
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGBA")
        origin = s.get("origin", "bl")
        if origin == "tl":
            px, py, base = s["x"], s["y"], s["y"] + im.height
        elif origin == "bc":
            px, py, base = s["x"] - im.width // 2, s["y"] - im.height, s["y"]
        else:
            px, py, base = s["x"], s["y"] - im.height, s["y"]
        drawables.append((s.get("depth", base), px, py, im))
    for a in frag.get("anims", []):
        p = os.path.join(ASSETS, a["sheet"])
        if not os.path.exists(p):
            continue
        f = first_frame(p, a.get("fw", 16), a.get("fh", 16))
        origin = a.get("origin", "bc")
        if origin == "tl":
            px, py, base = a["x"], a["y"], a["y"] + f.height
        else:
            px, py, base = a["x"] - f.width // 2, a["y"] - f.height, a["y"]
        drawables.append((a.get("depth", base), px, py, f))
    for depth, px, py, im in sorted(drawables, key=lambda d: d[0]):
        canvas.alpha_composite(im, (int(px - x0), int(py - y0)))

    return canvas


if __name__ == "__main__":
    if "--plan" in sys.argv:
        src = os.path.join(DEN, "data", "city-plan.json")
        out = os.path.join(DEN, "data", "city-specs", "preview-full.png")
    else:
        src = sys.argv[1]
        out = sys.argv[2] if len(sys.argv) > 2 else src.replace(".json", "-preview.png")
    frag = json.load(open(src, encoding="utf-8"))
    img = render(frag)
    # keep previews manageable
    if img.width > 3000:
        img = img.resize((img.width // 2, img.height // 2), Image.NEAREST)
    img.save(out)
    print(out, img.size)
