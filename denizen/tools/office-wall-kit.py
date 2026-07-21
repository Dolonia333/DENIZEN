#!/usr/bin/env python3
"""Office wall kit — cuts LimeZu Room_Builder_Office wall BLOCKS and proves
assembly against the official gallery example.

LimeZu walls are 9-slice BLOCKS, not tiles: a 3x2 unit (left edge / middle /
right edge, x 2 rows tall) whose white cap, navy outline, and face art are one
continuous painting. Any renderer that tiles a single 32px strip or draws
procedural rectangles produces seams ("lines in the wall"). This tool:

  1. cuts the block columns into assets/modern_office/wallkit/
  2. writes data/office-wall-kit.json (the manifest the runtime mirrors)
  3. assembles a sample wall (left + mids + right, cap row + N face rows)
  4. renders it side-by-side with a crop of the itch.io example map for
     pixel comparison (scratch output, pass --compare <example.png>)

Usage:  py tools/office-wall-kit.py [--compare path\to\example.png]
"""

import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEN = os.path.dirname(HERE)
SHEET = os.path.join(DEN, "assets", "Room_Builder_Office_32x32.png")
OUT_DIR = os.path.join(DEN, "assets", "modern_office", "wallkit")
MANIFEST = os.path.join(DEN, "data", "office-wall-kit.json")

# Block anatomy on the sheet (32px tiles). Verified by 5x zoom inspection:
# rows 11-12 = white wall block, rows 9-10 = brick block. Column roles:
# 0 = left edge, 1 = middle (tiles horizontally), 2 = right edge,
# 3 = single-column wall (both edges).
KIT = {
    "white": {"sheet_y": 352, "cols": {"left": 0, "mid": 32, "right": 64, "single": 96}},
    "brick": {"sheet_y": 288, "cols": {"left": 0, "mid": 32, "right": 64, "single": 96}},
}
COL_W = 32
CAP_ROW_H = 32   # first block row: white cap + face start
FACE_ROW_H = 32  # second block row: pure face (repeatable vertically)


def cut_kit(sheet):
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {"_doc": __doc__.strip().splitlines()[0], "colW": COL_W,
                "capRowH": CAP_ROW_H, "faceRowH": FACE_ROW_H, "styles": {}}
    for style, spec in KIT.items():
        y = spec["sheet_y"]
        entry = {"pieces": {}}
        for role, x in spec["cols"].items():
            cap = sheet.crop((x, y, x + COL_W, y + CAP_ROW_H))
            face = sheet.crop((x, y + CAP_ROW_H, x + COL_W, y + CAP_ROW_H + FACE_ROW_H))
            cap_name = f"{style}_{role}_cap.png"
            face_name = f"{style}_{role}_face.png"
            cap.save(os.path.join(OUT_DIR, cap_name))
            face.save(os.path.join(OUT_DIR, face_name))
            entry["pieces"][role] = {
                "cap": cap_name, "face": face_name,
                "sheet_rect_cap": [x, y, COL_W, CAP_ROW_H],
                "sheet_rect_face": [x, y + CAP_ROW_H, COL_W, FACE_ROW_H],
            }
        manifest["styles"][style] = entry
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    return manifest


# Repeatable face region per style (verified by adversarial pixel review):
# white: 30px — the wallpaper has a 6-row period, 30 % 6 == 0, only the 2px
#        navy border must be excluded.
# brick: 24px — courses run an 8px rhythm and the bottom 4px are AO shading +
#        navy border; 30px duplicated the AO line mid-wall and squashed a
#        course (30 = 3*8 + 6). 24 = 3 clean courses.
REPEAT_H_BY_STYLE = {"white": 30, "brick": 24}


def assemble(sheet, style, width_cols, face_rows=2):
    """Compose a wall strip exactly like the runtime: [left][mid...][right].
    Vertically: cap row, then (face_rows-1) repeats of the BORDERLESS face
    region (30px — repeating the full 32px row leaks the block's bottom navy
    border into the middle of the wall as a seam), then one full face row
    whose baked border closes the wall against the floor."""
    spec = KIT[style]
    y = spec["sheet_y"]
    repeat_h = REPEAT_H_BY_STYLE[style]
    h = CAP_ROW_H + (face_rows - 1) * repeat_h + FACE_ROW_H
    out = Image.new("RGBA", (width_cols * COL_W, h), (0, 0, 0, 0))
    for i in range(width_cols):
        if width_cols == 1:
            role = "single"
        elif i == 0:
            role = "left"
        elif i == width_cols - 1:
            role = "right"
        else:
            role = "mid"
        x = spec["cols"][role]
        cap = sheet.crop((x, y, x + COL_W, y + CAP_ROW_H))
        face_repeat = sheet.crop((x, y + CAP_ROW_H, x + COL_W, y + CAP_ROW_H + repeat_h))
        face_final = sheet.crop((x, y + CAP_ROW_H, x + COL_W, y + CAP_ROW_H + FACE_ROW_H))
        out.paste(cap, (i * COL_W, 0))
        yy = CAP_ROW_H
        for _ in range(face_rows - 1):
            out.paste(face_repeat, (i * COL_W, yy))
            yy += repeat_h
        out.paste(face_final, (i * COL_W, yy))
    return out


def main():
    sheet = Image.open(SHEET).convert("RGBA")
    manifest = cut_kit(sheet)
    print(f"kit cut -> {OUT_DIR} ({sum(len(s['pieces']) for s in manifest['styles'].values()) * 2} pngs)")
    print(f"manifest -> {MANIFEST}")

    strip = assemble(sheet, "white", 10, face_rows=2)
    brick = assemble(sheet, "brick", 6, face_rows=2)
    preview = Image.new("RGBA", (max(strip.width, brick.width) + 16,
                                 strip.height + brick.height + 24), (30, 30, 46, 255))
    preview.paste(strip, (8, 8), strip)
    preview.paste(brick, (8, strip.height + 16), brick)

    if "--compare" in sys.argv:
        ref_path = sys.argv[sys.argv.index("--compare") + 1]
        ref = Image.open(ref_path).convert("RGBA")
        combo = Image.new("RGBA", (max(preview.width, ref.width),
                                   preview.height + ref.height + 8), (30, 30, 46, 255))
        combo.paste(preview, (0, 0), preview)
        combo.paste(ref, (0, preview.height + 8), ref)
        preview = combo

    s = 3
    preview = preview.resize((preview.width * s, preview.height * s), Image.NEAREST)
    out_path = os.path.join(HERE, "wall-kit-preview.png")
    preview.save(out_path)
    print(f"preview -> {out_path}")


if __name__ == "__main__":
    main()
