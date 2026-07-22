#!/usr/bin/env python3
"""Audit every animated sheet referenced by the city plan for EXACT frame
grids. LimeZu animated objects are horizontal strips: width must be an exact
multiple of frame-width, height must equal frame-height (single row). A bad
fw/fh makes the anim show partial or doubled frames.

For each anim/animBand/vehicle:
  - load the real sheet dimensions
  - check w % fw == 0 and h % fh == 0  (grid divides cleanly)
  - report frame count and flag multi-row / non-square-frame oddities
  - GUESS the correct fw when the declared one doesn't divide (common LimeZu
    frame widths equal the sheet height, or a divisor that yields 4-16 frames)

Usage: py scripts/audit-sprite-frames.py
Exit 1 if any bad grid found.
"""

import json
import os
import sys

from PIL import Image

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(DEN, "assets", "limezu")
PLAN = os.path.join(DEN, "data", "city-plan.json")


def guess_fw(w, h):
    """Plausible frame widths: divisors of w giving 2-24 frames, preferring
    fw == h (LimeZu's common square-ish frames) then 16-multiples."""
    cands = [d for d in range(8, w + 1) if w % d == 0 and 2 <= w // d <= 24]
    cands.sort(key=lambda d: (abs(d - h), 0 if d % 16 == 0 else 1))
    return cands[:4]


def main():
    plan = json.load(open(PLAN, encoding="utf-8"))
    items = []
    for a in plan.get("anims", []):
        items.append(("anim", a.get("sheet"), a.get("fw", 16), a.get("fh", 16)))
    for a in plan.get("animBands", []):
        items.append(("band", a.get("sheet"), a.get("fw", 16), a.get("fh", 16)))
    for v in plan.get("vehicles", []):
        items.append(("vehicle", v.get("sheet"), v.get("fw", 48), v.get("fh", 32)))

    seen = {}
    bad = []
    for kind, sheet, fw, fh in items:
        if not sheet or sheet in seen:
            continue
        p = os.path.join(ASSETS, sheet.replace("/", os.sep))
        try:
            with Image.open(p) as im:
                w, h = im.size
        except Exception:
            bad.append(("MISSING", sheet, "", ""))
            continue
        seen[sheet] = (w, h, fw, fh)
        wok = (w % fw == 0)
        hok = (h % fh == 0)
        rows = h // fh if hok else "?"
        cols = w // fw if wok else "?"
        if not wok or not hok:
            bad.append(("BADGRID", sheet, f"sheet {w}x{h} declared fw={fw} fh={fh}",
                        f"guess fw in {guess_fw(w, h)} (h={h})"))
        elif rows != 1 and kind != "band":
            # multi-row anim strip is unusual — worth a look
            bad.append(("MULTIROW", sheet,
                        f"{w}x{h} -> {cols}x{rows} frames of {fw}x{fh}", ""))

    print(f"audited {len(seen)} distinct animated sheets")
    if not bad:
        print("all animation grids divide cleanly OK")
        return 0
    from collections import Counter
    print("issues:", dict(Counter(b[0] for b in bad)))
    for kind, sheet, a, b in bad:
        print(f"  {kind:9s} {os.path.basename(sheet):48s} {a}  {b}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
