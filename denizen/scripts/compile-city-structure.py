#!/usr/bin/env python3
"""City structure compiler — GENERATES the base urban layer from a declarative
grid spec, so structure comes from code (not agent guesswork). Emits
data/city-specs/d00-structure.json: continuous paved sidewalk under the urban
core + a connecting asphalt road grid forming real blocks.

Renders first (low depth) so district stamps sit ON the paved city floor
instead of floating on grass. Grass stays the world default outside the
paved cores (parks, rural edges).

Edit CORE_SLABS / ROADS below and re-run; then merge-city-plan.py.
"""

import json
import os

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(DEN, "data", "city-specs", "d00-structure.json")

# Paved sidewalk slabs forming ONE CONTINUOUS urban floor. depth 0.87:
# above the world grass (0), below district patches (~0.9) and stamps.
#
# DESIGN: big OVERLAPPING rectangles that fully tile the urban core with zero
# interior gaps. Overlap is harmless (same tile + depth); grass slivers between
# ad-hoc slabs were the real "broken/gappy" bug. Carved ONLY around the two
# rural pockets that must stay green:
#   - farm  x226-928  y704-1145  (sits on bare world grass, NO self-cover)
#   - camping x2688-3872 y160-1040 (self-covers with its own grass patch)
# The green SOUTH (park/residential/beach/graveyard, y>3200) is left unpaved;
# each of those districts draws its own ground.
CORE_SLABS = [
    # MAIN BAND — the whole urban midriff, full width, no gaps possible. Sits
    # BELOW farm(y<=1145) and camping(y<=1040) so it never bleeds into them.
    (0,    1480, 6656, 1780),
    # Downtown spur up to the band (between farm x<928 and camping x>2688).
    (1744, 560,  936,  960),
    # Under-camping connector: fills the strip below camping down to the band.
    (2540, 1040, 1640, 480),
    # NE shopping + station mass up to the band.
    (3952, 896,  2320, 624),
    # West apron: paved fabric below the farm, joining plaza/food-market north.
    (0,    1145, 2016, 352),
]

# ── REGULAR CITY GRID ─────────────────────────────────────────────────────
# Streets on a fixed lattice so the urban core divides into even, buildable
# blocks (the skeleton the districts get built onto). The renderer auto-draws a
# 16px sidewalk around every road, so each street reads as asphalt + sidewalks.
#
# Anchored to what already exists so nothing has to move: one E-W street sits on
# the main avenue (y1880, the HQ + traffic) and one N-S street on the central
# artery (x2560). Grid lives BELOW the rural pockets (farm y<=1145, camping
# y<=1040) and ABOVE the green south (y>3300).
# NOTE: every value is a multiple of 16 so road cells snap to the tile grid —
# the curb autotiler in full-world.js keys cells on a 16px lattice.
STREET = 64
GRID_X0, GRID_X1 = 0, 6656        # full width
GRID_Y0, GRID_Y1 = 1152, 3296     # urban-core band (clears farm/camping + south)
VLINES = [64, 896, 1728, 2560, 3392, 4224, 5056, 5888]   # N-S streets (x, 832 apart, 2560 = central artery)
HLINES = [1200, 1872, 2560, 3248]                        # E-W streets (y, ~680 apart, 1872 = main avenue)
# A few N-S streets extend UP to frame the downtown + shopping spurs.
VSPUR_TOP = {1728: 544, 2560: 544, 4224: 880, 5056: 880}  # x -> street top y


def gen_grid():
    """Emit the lattice as (x, y, w, h) asphalt roads."""
    roads = []
    for x in VLINES:                       # vertical (N-S) streets
        top = VSPUR_TOP.get(x, GRID_Y0)
        roads.append((x, top, STREET, GRID_Y1 - top))
    for y in HLINES:                       # horizontal (E-W) streets
        roads.append((GRID_X0, y, GRID_X1 - GRID_X0, STREET))
    return roads


ROADS = gen_grid()


TREE = "ext/singles/3_city_props/ME_Singles_City_Props_16x16_Tree_9.png"
LAMP = "ext/singles/3_city_props/ME_Singles_City_Props_16x16_Street_Lamp_1.png"


def in_slab(x, y):
    """True if (x,y) sits on a paved slab (so street furniture stays on
    sidewalk, never floats on grass)."""
    for sx, sy, sw, sh in CORE_SLABS:
        if sx <= x <= sx + sw and sy <= y <= sy + sh:
            return True
    return False


def street_furniture():
    """Line the major roads with alternating trees + lamps on their paved
    shoulders (grammar: props hug the sidewalk edges). Deterministic."""
    out = []
    for i, (x, y, w, h) in enumerate(ROADS):
        horizontal = w >= h
        if horizontal:
            for j, px in enumerate(range(x + 40, x + w - 40, 180)):
                for py in (y - 22, y + h + 46):   # both shoulders
                    if in_slab(px, py):
                        img = TREE if (j % 2 == 0) else LAMP
                        out.append({"img": img, "x": px, "y": py,
                                    "origin": "bc", "solid": True})
        else:
            for j, py in enumerate(range(y + 60, y + h - 40, 200)):
                for px in (x - 22, x + w + 46):
                    if in_slab(px, py):
                        img = TREE if (j % 2 == 0) else LAMP
                        out.append({"img": img, "x": px, "y": py,
                                    "origin": "bc", "solid": True})
    return out


def main():
    stamps = street_furniture()
    frag = {
        "_doc": "GENERATED by compile-city-structure.py — do not hand-edit; "
                "edit the script's CORE_SLABS / ROADS and re-run.",
        "patches": [
            {"tile": "sidewalk", "x": x, "y": y, "w": w, "h": h, "depth": 0.87}
            for (x, y, w, h) in CORE_SLABS
        ],
        "roads": [
            {"x": x, "y": y, "w": w, "h": h} for (x, y, w, h) in ROADS
        ],
        "stamps": stamps, "anims": [], "animBands": [],
        "solids": [], "labels": [], "portals": [], "npcs": [], "vehicles": [],
    }
    json.dump(frag, open(OUT, "w", encoding="utf-8"), indent=1)
    print(f"wrote {OUT}: {len(CORE_SLABS)} paved slabs, {len(ROADS)} roads")


if __name__ == "__main__":
    main()
