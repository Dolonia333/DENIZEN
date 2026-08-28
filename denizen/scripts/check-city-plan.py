#!/usr/bin/env python3
"""City plan QA — automatic defect detection for district fragments and the
merged plan. Catches what eyeballing misses:

  OVERLAP         two solid stamps whose sprite rects overlap substantially
  FLOATING        a stamp with no ground patch/road under its baseline (grass-void)
  ROADBLOCK       a solid that covers a road's driving lane
  OFFWORLD        anything outside the world bounds
  BADANIM         anim sheet whose dimensions aren't divisible by fw/fh
  BIOME_MISMATCH  a stamp's me.* biome doesn't match the biome of the district
                  it's stamped in (advisory by default — see --strict-biome)
  GROUP_SOLO      a `group_only` me.* stamped alone, with no `grp` recipe id
                  (always advisory — group emission is W1-C/W2-A work in
                  progress, so this never fails the gate on its own)

Biome resolution (first match wins) for BIOME_MISMATCH:
  1. the stamp's own `biome` field, if the compiler ever writes one
  2. the checked file's top-level `biome` field (compiler-generated single-
     district fragments, e.g. data/city-specs/generated/d18-*.json, carry
     this — see docs/EXTERIOR-COMPILER.md)
  3. whichever data/city-specs/d*.json bbox (smallest area wins on overlap)
     contains the stamp's (x, y), mapped to a biome via placement-rules.json
     biomes.*.districts
Stamps whose biome can't be resolved by any of the above are skipped (not
flagged) — this is a best-effort heuristic, not a hard requirement, and
district bboxes are known to be stale in places (EXTERIOR-MISTAKES.md #4).

Usage:
  py scripts/check-city-plan.py                      # checks data/city-plan.json
  py scripts/check-city-plan.py data/city-specs/d7-park.json
  py scripts/check-city-plan.py --strict-biome        # BIOME_MISMATCH also fails the gate (exit 1)
  py scripts/check-city-plan.py --warnings-only       # force BIOME_MISMATCH to stay advisory
                                                       # (exit 0) even if --strict-biome is also passed
  py scripts/check-city-plan.py --coverage-min 300    # exit 1 if unique `exs.*` stamps < 300 (CI gate)

Exit code 1 if any hard defect is found — OVERLAP / FLOATING / ROADBLOCK /
OFFWORLD / BADANIM / MISSING, plus BIOME_MISMATCH when --strict-biome is set
(unless --warnings-only overrides it), plus a coverage shortfall when
--coverage-min is set. BIOME_MISMATCH (by default) and GROUP_SOLO (always)
are printed as advisories and do not affect the exit code, so existing
callers (merge-city-plan.py, compile-exterior-district.py --qa) stay green.
"""

import argparse
import json
import os
import sys

from PIL import Image

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(DEN, "assets", "limezu")
CAT = os.path.join(DEN, "data", "limezu-visual-catalog")
RULES_PATH = os.path.join(CAT, "placement-rules.json")          # W0-A biome map
ENRICHED_PATH = os.path.join(CAT, "me-placement-enriched.jsonl")  # W1-A role/biome per me.*
ME_TO_SINGLES_PATH = os.path.join(CAT, "me-to-singles.json")     # me.* -> Singles basenames
SPECS_DIR = os.path.join(DEN, "data", "city-specs")

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


def load_enriched_catalog():
    """me.* -> enrichment record (role / biome_primary / biomes_allowed /
    group_only / ...) from W1-A's me-placement-enriched.jsonl. Returns {} if
    the catalog hasn't been generated yet — biome/group checks just no-op."""
    catalog = {}
    if not os.path.exists(ENRICHED_PATH):
        return catalog
    with open(ENRICHED_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if rec.get("me"):
                catalog[rec["me"]] = rec
    return catalog


def load_basename_to_me():
    """Singles basename (e.g. '21_Beach_16x16_Ball.png') -> me.* id, so a
    stamp that only carries a raw `img` path (pre-catalog hand stamps) can
    still be resolved to a catalog entry for the biome/group checks."""
    mapping = {}
    if not os.path.exists(ME_TO_SINGLES_PATH):
        return mapping
    data = json.load(open(ME_TO_SINGLES_PATH, encoding="utf-8"))
    for me_id, entries in (data.get("links") or {}).items():
        for e in entries:
            bn = e.get("basename")
            if bn:
                mapping[bn] = me_id
    return mapping


def resolve_me(stamp, basename_to_me):
    """A stamp's catalog id: its own `me`, or one resolved from `img` via
    me-to-singles.json. Returns None if neither is available."""
    if stamp.get("me"):
        return stamp["me"]
    img = stamp.get("img")
    if img:
        return basename_to_me.get(os.path.basename(img))
    return None


def load_district_biomes():
    """(district_id, biome, (x, y, w, h)) for every data/city-specs/d*.json
    that both has a `bbox` and is named in placement-rules.json
    biomes.*.districts. Sorted smallest-area-first so a narrower district
    wins a point-in-rect tie over a larger/stale encompassing bbox
    (EXTERIOR-MISTAKES.md #4: camping's bbox is known to be oversized)."""
    district_biome = {}
    if os.path.exists(RULES_PATH):
        rules = json.load(open(RULES_PATH, encoding="utf-8"))
        for biome_name, biome in (rules.get("biomes") or {}).items():
            if not isinstance(biome, dict):
                continue
            for district_id in biome.get("districts") or []:
                district_biome[district_id] = biome_name

    districts = []
    if os.path.isdir(SPECS_DIR):
        for fn in sorted(os.listdir(SPECS_DIR)):
            if not fn.endswith(".json"):
                continue
            district_id = fn[:-len(".json")]
            biome = district_biome.get(district_id)
            if not biome:
                continue
            try:
                spec = json.load(open(os.path.join(SPECS_DIR, fn), encoding="utf-8"))
            except Exception:
                continue
            bbox = spec.get("bbox")
            if not bbox:
                continue
            if "x0" in bbox:
                rect = (bbox["x0"], bbox["y0"], bbox["x1"] - bbox["x0"], bbox["y1"] - bbox["y0"])
            else:
                rect = (bbox["x"], bbox["y"], bbox["w"], bbox["h"])
            districts.append((district_id, biome, rect))
    districts.sort(key=lambda d: d[2][2] * d[2][3])
    return districts


def biome_for_point(x, y, districts):
    for _district_id, biome, (rx, ry, rw, rh) in districts:
        if rx <= x <= rx + rw and ry <= y <= ry + rh:
            return biome
    return None


def biome_for_stamp(stamp, plan_biome, districts):
    """First match wins: the stamp's own `biome`, then the checked file's
    top-level `biome` (compiler-generated single-district fragments), then
    bbox-based district inference. None if nothing resolves it."""
    if stamp.get("biome"):
        return stamp["biome"]
    if plan_biome:
        return plan_biome
    return biome_for_point(stamp.get("x", 0), stamp.get("y", 0), districts)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("src", nargs="?", default=os.path.join(DEN, "data", "city-plan.json"),
                     help="plan/fragment json to check (default: data/city-plan.json)")
    ap.add_argument("--strict-biome", action="store_true",
                     help="BIOME_MISMATCH contributes to the exit code (default: advisory only)")
    ap.add_argument("--warnings-only", action="store_true",
                     help="force BIOME_MISMATCH to stay advisory (exit 0), overriding --strict-biome")
    ap.add_argument("--coverage-min", type=int, default=None, metavar="N",
                     help="exit 1 if the plan's unique exs.* stamp count is below N (CI coverage gate)")
    args = ap.parse_args()

    src = args.src
    plan = json.load(open(src, encoding="utf-8"))
    world_w = plan.get("worldSize", {}).get("w", 6656)
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

    # BIOME_MISMATCH / GROUP_SOLO — driven by W1-A's enriched catalog. Both are
    # best-effort advisories: see the module docstring for biome resolution
    # order and why GROUP_SOLO never fails the gate on its own.
    catalog = load_enriched_catalog()
    biome_defects = []
    group_defects = []
    if catalog:
        basename_to_me = load_basename_to_me()
        districts = load_district_biomes()
        plan_biome = plan.get("biome")
        for s in stamps:
            me_id = resolve_me(s, basename_to_me)
            if not me_id:
                continue
            rec = catalog.get(me_id)
            if not rec:
                continue

            if rec.get("group_only") and not s.get("grp"):
                group_defects.append((
                    "GROUP_SOLO", me_id,
                    f"stamped solo @({s.get('x')},{s.get('y')}) but catalog marks it group_only",
                ))

            biome = biome_for_stamp(s, plan_biome, districts)
            if biome is None:
                continue
            allowed = rec.get("biomes_allowed") or [rec.get("biome_primary")]
            if biome not in allowed:
                biome_defects.append((
                    "BIOME_MISMATCH", me_id,
                    f"district biome '{biome}' not in {allowed} @({s.get('x')},{s.get('y')})",
                ))

    biome_is_hard = args.strict_biome and not args.warnings_only
    if biome_is_hard:
        defects.extend(biome_defects)

    print(f"checked {src}: {len(stamps)} stamps")
    counts = {}
    for kind, a, b in defects:
        counts[kind] = counts.get(kind, 0) + 1
    print("defects:", counts or "none")
    for kind, a, b in defects[:40]:
        print(f"  {kind:9s} {a}  {b}")
    if len(defects) > 40:
        print(f"  ... and {len(defects) - 40} more")

    if not biome_is_hard and biome_defects:
        print(f"\nadvisory BIOME_MISMATCH ({len(biome_defects)}) — pass --strict-biome to fail the gate on these:")
        for kind, a, b in biome_defects[:20]:
            print(f"  {kind:14s} {a}  {b}")
        if len(biome_defects) > 20:
            print(f"  ... and {len(biome_defects) - 20} more")

    if group_defects:
        print(f"\nadvisory GROUP_SOLO ({len(group_defects)}) — group_only me.* stamped without a grp.* recipe:")
        for kind, a, b in group_defects[:20]:
            print(f"  {kind:14s} {a}  {b}")
        if len(group_defects) > 20:
            print(f"  ... and {len(group_defects) - 20} more")

    exit_code = 1 if defects else 0

    if args.coverage_min is not None:
        unique_exs = {s["exs"] for s in stamps if s.get("exs")}
        print(f"\ncoverage: {len(unique_exs)} unique exs.* stamped (--coverage-min {args.coverage_min})")
        if len(unique_exs) < args.coverage_min:
            print(f"  COVERAGE_GATE  fail — {len(unique_exs)} < {args.coverage_min}")
            exit_code = 1

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
