#!/usr/bin/env python3
"""W6-A — compile the catalog coverage showcase district (d99).

Every me.* in the visual catalog that is linked to a pixel-perfect Single but
has never been stamped anywhere in the city is an *orphan*: cataloged, tagged,
renderable, and invisible. This compiler sweeps the orphans up and lays them
out as an open-air museum in whatever world space is genuinely empty, so Tier A
(buildings) and Tier B (props/nature/vehicles) coverage reflects the catalog we
actually have instead of the subset the hand-authored districts happened to use.

Reads:
  data/limezu-visual-catalog/registry.jsonl            me.* catalog (category/sheet)
  data/limezu-visual-catalog/me-placement-enriched.jsonl  role / biome / group_only
  data/limezu-visual-catalog/placement-index.json      me.* -> img (what can be drawn)
  data/limezu-visual-catalog/placement-rules.json      role spacing, biome surfaces
  data/limezu-visual-catalog/ext-singles-pixelperfect.jsonl  exs.* -> me.* back-links
  data/city-plan.json                                  live plan: usage + occupancy

Writes:
  data/city-specs/generated/d99-catalog-showcase.json  (merge with
  `scripts/merge-city-plan.py --include-generated`)

How it stays out of the city's way:
  * Orphan detection ignores stamps this compiler emitted (they carry
    `"showcase": true`), so re-running is idempotent — the showcase never
    counts itself as coverage and never blocks its own zones.
  * Zones are discovered at runtime by carving maximal empty rectangles out of
    an occupancy grid built from every existing stamp footprint, road, solid
    and ground patch in data/city-plan.json. Nothing is hardcoded, so the
    showcase moves as the city grows.
  * Within a zone, orphans are shelf-packed by their true sprite rects, so no
    two stamps overlap and check-city-plan.py's OVERLAP gate stays green. Each
    biome segment starts on a fresh shelf row and gets its own ground patch,
    which also keeps solid stamps off bare grass (the FLOATING gate).

Usage:
  python3 scripts/compile-coverage-showcase.py -v
  python3 scripts/compile-coverage-showcase.py --skip-group-only
  python3 scripts/compile-coverage-showcase.py --max-stamps 500 --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

DEN = Path(__file__).resolve().parents[1]
CAT = DEN / "data" / "limezu-visual-catalog"
ASSETS = DEN / "assets" / "limezu"
REGISTRY_PATH = CAT / "registry.jsonl"
ENRICHED_PATH = CAT / "me-placement-enriched.jsonl"
INDEX_PATH = CAT / "placement-index.json"
RULES_PATH = CAT / "placement-rules.json"
SINGLES_PATH = CAT / "ext-singles-pixelperfect.jsonl"
COVERAGE_PATH = CAT / "coverage-report.json"
CITY_PLAN_PATH = DEN / "data" / "city-plan.json"
OUT_PATH = DEN / "data" / "city-specs" / "generated" / "d99-catalog-showcase.json"

DISTRICT_ID = "d99-catalog-showcase"
DISTRICT_NAME = "D99 Catalog Showcase (orphan me.* coverage district)"
LABEL_ROOT = "CATALOG SHOWCASE"

TILE = 16                 # world tile size; every stamp lands on this grid
GRID_CELL = 32            # occupancy raster for free-space discovery
ZONE_MARGIN = 16          # inset from a free rect's edge
LABEL_BAND = 32           # top strip of a zone segment kept clear for its label
MIN_ZONE_W = 256
MIN_ZONE_H = 192
MICRO_ZONE_W = 128        # second-pass pockets, for leftover small props
MICRO_ZONE_H = 96
MAX_ZONES = 32
MAX_CARVES = 200          # free-rect carving attempts before giving up
GAP_MIN, GAP_MAX = 8, 32   # role spacing_px is clamped into this range
DEFAULT_GAP = 16

# Roles whose stamps get collision. Buildings are the whole point of Tier A, so
# they stay solid; everything else stays walkable so a visitor can stroll the
# aisles (and so decor layering never trips the OVERLAP gate).
SOLID_ROLES = {"landmark", "building_shell", "facade"}

# Ground paint per biome: first paintable surface the biome declares.
PAINTABLE = ("grass", "sand", "sidewalk", "asphalt")
TILE_DEPTH = {"grass": 0.85, "sand": 0.86, "sidewalk": 0.87, "asphalt": 1.1}

TIER_B_CATEGORIES = {"prop", "nature", "vehicle"}


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------
def load_jsonl(path: Path) -> list[dict]:
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def img_path_to_rel(path: str) -> str:
    p = path.replace("\\", "/")
    prefix = "assets/limezu/"
    return p[len(prefix):] if p.startswith(prefix) else p


class Dims:
    """img (relative to assets/limezu) -> (w, h), memoized."""

    def __init__(self) -> None:
        self._cache: dict[str, tuple[int, int] | None] = {}

    def get(self, img: str) -> tuple[int, int] | None:
        if img not in self._cache:
            try:
                with Image.open(ASSETS / img.replace("/", os.sep)) as im:
                    self._cache[img] = im.size
            except Exception:
                self._cache[img] = None
        return self._cache[img]


def stamp_rect(stamp: dict, dims: Dims) -> tuple[int, int, int, int] | None:
    """Same origin math as check-city-plan.py, so occupancy == what QA sees."""
    img = stamp.get("img")
    if not img:
        return None
    d = dims.get(img)
    if not d:
        return None
    w, h = d
    origin = stamp.get("origin", "bl")
    if origin == "tl":
        return (stamp["x"], stamp["y"], w, h)
    if origin == "bc":
        return (stamp["x"] - w // 2, stamp["y"] - h, w, h)
    return (stamp["x"], stamp["y"] - h, w, h)


# --------------------------------------------------------------------------
# coverage
# --------------------------------------------------------------------------
def used_me_ids(plan: dict, singles: dict[str, dict]) -> set[str]:
    """me.* considered 'used' by report-ext-catalog-coverage.py: referenced by
    a stamp's `me`, or vision-linked to a Single a stamp resolves to. Stamps
    this compiler emitted are excluded so the showcase can't feed itself."""
    singles_by_img = {img_path_to_rel(s["path"]): s["id"] for s in singles.values()}
    used_exs: set[str] = set()
    used_me: set[str] = set()
    for s in plan.get("stamps", []):
        if s.get("showcase"):
            continue
        if s.get("me"):
            used_me.add(s["me"])
        if s.get("exs"):
            used_exs.add(s["exs"])
            continue
        img = s.get("img")
        if img and img in singles_by_img:
            used_exs.add(singles_by_img[img])
    for exs_id in used_exs:
        row = singles.get(exs_id)
        me_id = ((row or {}).get("vision_link") or {}).get("me_id")
        if me_id:
            used_me.add(me_id)
    return used_me


# --------------------------------------------------------------------------
# free space
# --------------------------------------------------------------------------
def build_occupancy(plan: dict, dims: Dims, world_w: int, world_h: int) -> list[list[int]]:
    gw, gh = world_w // GRID_CELL, world_h // GRID_CELL
    occ = [[0] * gw for _ in range(gh)]

    def mark(x: int, y: int, w: int, h: int, pad: int = 24) -> None:
        if w <= 0 or h <= 0:
            return
        x -= pad
        y -= pad
        w += pad * 2
        h += pad * 2
        for gy in range(max(0, y // GRID_CELL), min(gh, (y + h - 1) // GRID_CELL + 1)):
            row = occ[gy]
            for gx in range(max(0, x // GRID_CELL), min(gw, (x + w - 1) // GRID_CELL + 1)):
                row[gx] = 1

    for s in plan.get("stamps", []):
        if s.get("showcase"):
            continue
        r = stamp_rect(s, dims)
        if r:
            mark(*r)
    for r in plan.get("roads", []):
        mark(r["x"], r["y"], r.get("w", 0), r.get("h", 0))
    for s in plan.get("solids", []):
        mark(s["x"], s["y"], s.get("w", 0), s.get("h", 0))
    for p in plan.get("patches", []):
        if p.get("showcase"):
            continue
        mark(p["x"], p["y"], p.get("w", 0), p.get("h", 0))
    for lab in plan.get("labels", []):
        if lab.get("showcase"):
            continue
        mark(lab["x"] - 128, lab["y"] - 32, 256, 64)
    for n in plan.get("npcs", []):
        mark(n.get("x", 0) - 32, n.get("y", 0) - 32, 64, 64)
    for pt in plan.get("portals", []):
        mark(pt.get("x0", 0) - 16, pt.get("y", 0) - 32, (pt.get("x1", 0) - pt.get("x0", 0)) + 32, 64)
    return occ


def largest_empty_rect(occ: list[list[int]]) -> tuple[int, int, int, int] | None:
    """Maximal all-zero rectangle (largest-rectangle-in-histogram sweep)."""
    gh, gw = len(occ), len(occ[0])
    heights = [0] * gw
    best = None
    for gy in range(gh):
        for gx in range(gw):
            heights[gx] = 0 if occ[gy][gx] else heights[gx] + 1
        stack: list[tuple[int, int]] = []
        for gx in range(gw + 1):
            h_cur = heights[gx] if gx < gw else 0
            start = gx
            while stack and stack[-1][1] >= h_cur:
                s0, h0 = stack.pop()
                area = h0 * (gx - s0)
                if best is None or area > best[0]:
                    best = (area, s0, gy - h0 + 1, gx - s0, h0)
                start = s0
            stack.append((start, h_cur))
    if not best:
        return None
    _area, gx, gy, gw_, gh_ = best
    return (gx * GRID_CELL, gy * GRID_CELL, gw_ * GRID_CELL, gh_ * GRID_CELL)


def carve_zones(occ: list[list[int]], min_w: int, min_h: int,
                max_zones: int, first_id: int = 1) -> list[dict]:
    """Carve disjoint empty rectangles out of `occ`, biggest first. Each one
    becomes a showcase zone with its own packing cursor; carved cells are
    marked occupied so a later call (smaller thresholds) sees only what is
    genuinely still free."""
    zones = []
    margin = ZONE_MARGIN if min_w >= MIN_ZONE_W else ZONE_MARGIN // 2
    for _ in range(MAX_CARVES):
        if len(zones) >= max_zones:
            break
        rect = largest_empty_rect(occ)
        if not rect:
            break
        x, y, w, h = rect
        if w * h < min_w * min_h:
            break
        for gy in range(y // GRID_CELL, (y + h) // GRID_CELL):
            for gx in range(x // GRID_CELL, (x + w) // GRID_CELL):
                occ[gy][gx] = 1
        # A wide-but-shallow strip can't hold an exhibit; consume it (so the
        # carve makes progress) and keep looking for a usable rect.
        if w < min_w or h < min_h:
            continue
        zones.append({
            "id": f"z{first_id + len(zones)}",
            "x": x + margin,
            "y": y + margin,
            "w": w - 2 * margin,
            "h": h - 2 * margin,
            "raw": rect,
            "cursor_y": y + margin,
            "segments": [],
        })
    return zones


# --------------------------------------------------------------------------
# item model
# --------------------------------------------------------------------------
def role_gap(role: str, roles: dict) -> int:
    """Aisle gap between neighbours. Role spacing_px is a *density* hint tuned
    for a lived-in district (landmark = 256px apart); a museum aisle only needs
    enough air to read each sprite as its own exhibit, so clamp it."""
    spacing = (roles.get(role) or {}).get("spacing_px")
    if spacing is None:
        return DEFAULT_GAP
    return max(GAP_MIN, min(GAP_MAX, int(spacing) or GAP_MIN))


def biome_tile(biome: str, biomes: dict) -> str:
    surfaces = (biomes.get(biome) or {}).get("surfaces") or []
    for s in surfaces:
        if s in PAINTABLE:
            return s
    return "grass"


def collect_orphans(args, reg: list[dict], enriched: dict, index_me: dict,
                    used: set[str], dims: Dims, roles: dict) -> tuple[list[dict], Counter]:
    skipped: Counter = Counter()
    items = []
    for r in sorted(reg, key=lambda r: r["id"]):
        me_id = r["id"]
        if me_id in used:
            continue
        entry = index_me.get(me_id)
        if not entry:
            skipped["no_linked_single"] += 1
            continue
        img = entry.get("img")
        d = dims.get(img) if img else None
        if not d:
            skipped["image_missing"] += 1
            continue
        enr = enriched.get(me_id) or {}
        if enr.get("group_only") and args.skip_group_only:
            skipped["group_only"] += 1
            continue
        role = enr.get("role") or ""
        category = r.get("category") or enr.get("category") or "prop"
        biome = enr.get("biome_primary") or "universal"
        allowed = enr.get("biomes_allowed") or []
        if allowed and biome not in allowed:
            biome = allowed[0]
        items.append({
            "me": me_id,
            "img": img,
            "exs": entry.get("exs"),
            "w": d[0],
            "h": d[1],
            "role": role,
            "category": category,
            "biome": biome,
            "group_only": bool(enr.get("group_only")),
            "solid": role in SOLID_ROLES or (not role and category == "building"),
            "gap": role_gap(role, roles),
            "sheet": r.get("sheet"),
        })
    return items, skipped


def sort_key(it: dict) -> tuple:
    """Tallest first so each shelf row holds sprites of similar height — that
    is what keeps the packing dense enough to fit the whole orphan set in the
    scraps of empty world we have. Category is the tie-break, so same-size
    siblings (a row of sedans, a row of shopfronts) still land side by side."""
    return (-it["h"], it["category"], -it["w"], it["me"])


# --------------------------------------------------------------------------
# packing
# --------------------------------------------------------------------------
def align(v: int) -> int:
    return (v // TILE) * TILE


def pack_biome(items: list[dict], zone: dict, biome: str) -> list[dict]:
    """Shelf-pack as many items as fit into the zone below its cursor.

    Returns the placed items (each gains x/y/rect); the caller keeps the rest.
    Every biome starts on a fresh shelf row, so segments never share a row and
    their ground patches never overlap.
    """
    x0, y0 = zone["x"], zone["y"]
    right = x0 + zone["w"]
    bottom = y0 + zone["h"]
    cur_y = align(max(zone["cursor_y"], y0)) + LABEL_BAND
    cur_x = x0
    row_h = 0
    placed: list[dict] = []
    leftovers: list[dict] = []

    for it in items:
        w, h, gap = it["w"], it["h"], it["gap"]
        if w > zone["w"]:
            leftovers.append(it)
            continue
        if cur_x + w > right and row_h:                    # wrap to next shelf
            cur_y = cur_y + row_h + gap
            cur_x, row_h = x0, 0
        if cur_y + h > bottom:                             # zone is full
            leftovers.append(it)
            continue
        px, py = align(cur_x), align(cur_y)
        it = dict(it)
        it["x"] = px
        it["y"] = py + h                                   # origin 'bl'
        it["rect"] = (px, py, w, h)
        it["zone"] = zone["id"]
        placed.append(it)
        cur_x = px + w + gap
        row_h = max(row_h, h)

    items[:] = leftovers
    if placed:
        seg_top = min(p["rect"][1] for p in placed)
        seg_bottom = max(p["rect"][1] + p["rect"][3] for p in placed)
        zone["segments"].append({
            "biome": biome,
            "y0": seg_top - LABEL_BAND,
            "y1": seg_bottom,
            "count": len(placed),
        })
        zone["cursor_y"] = seg_bottom + GAP_MAX
    return placed


def pack_all(items: list[dict], zones: list[dict], verbose: bool) -> tuple[list[dict], list[dict]]:
    by_biome: dict[str, list[dict]] = defaultdict(list)
    for it in items:
        by_biome[it["biome"]].append(it)
    for group in by_biome.values():
        group.sort(key=sort_key)

    # Biggest biome first: it gets first pick of the biggest zone.
    order = sorted(by_biome, key=lambda b: -sum(i["w"] * i["h"] for i in by_biome[b]))
    placed_all: list[dict] = []
    for biome in order:
        remaining = by_biome[biome]
        for zone in zones:
            if not remaining:
                break
            got = pack_biome(remaining, zone, biome)
            placed_all.extend(got)
            if verbose and got:
                print(f"    {biome:<12} -> zone {zone['id']} "
                      f"({len(got)} stamps, cursor y={zone['cursor_y']})")
    unplaced = [it for group in by_biome.values() for it in group]
    return placed_all, unplaced


# --------------------------------------------------------------------------
# emit
# --------------------------------------------------------------------------
def build_fragment(placed: list[dict], zones: list[dict], biomes: dict,
                   before: dict, args) -> dict:
    stamps = []
    for it in sorted(placed, key=lambda i: (i["rect"][1], i["rect"][0])):
        stamp = {
            "me": it["me"],
            "x": it["x"],
            "y": it["y"],
            "origin": "bl",
            "solid": bool(it["solid"]),
            "biome": it["biome"],
            "showcase": True,
            "zone": it["zone"],
            "category": it["category"],
        }
        if it["group_only"]:
            stamp["group_only_exhibit"] = True
        stamps.append(stamp)

    patches, labels = [], []
    for zone in zones:
        for seg in zone["segments"]:
            tile = biome_tile(seg["biome"], biomes)
            patches.append({
                "tile": tile,
                "x": zone["x"] - TILE,
                "y": seg["y0"],
                "w": zone["w"] + 2 * TILE,
                "h": seg["y1"] - seg["y0"] + TILE,
                "depth": TILE_DEPTH.get(tile, 0.87),
                "showcase": True,
            })
            labels.append({
                "x": zone["x"] + 8,
                "y": seg["y0"] + 20,
                "text": f"{LABEL_ROOT} — {seg['biome'].upper().replace('_', ' ')}",
                "showcase": True,
            })

    used_zones = [z for z in zones if z["segments"]]
    if used_zones:
        x0 = min(z["x"] for z in used_zones)
        y0 = min(z["y"] for z in used_zones)
        x1 = max(z["x"] + z["w"] for z in used_zones)
        y1 = max(z["y"] + z["h"] for z in used_zones)
        bbox = {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}
    else:
        bbox = {"x": 0, "y": 0, "w": 0, "h": 0}

    by_category = Counter(s["category"] for s in stamps)
    by_biome = Counter(s["biome"] for s in stamps)
    return {
        "_doc": ("GENERATED by scripts/compile-coverage-showcase.py — do not hand-edit; "
                 "re-run the compiler. Places every orphan me.* (cataloged, linked to a "
                 "Single, never stamped) in empty world space to lift Tier A/B coverage."),
        "district": DISTRICT_NAME,
        "id": DISTRICT_ID,
        "bbox": bbox,
        "_compiled": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "compiler": "scripts/compile-coverage-showcase.py",
            "sources": {
                "registry": str(REGISTRY_PATH.relative_to(DEN)),
                "enriched": str(ENRICHED_PATH.relative_to(DEN)),
                "placement_index": str(INDEX_PATH.relative_to(DEN)),
                "city_plan": str(CITY_PLAN_PATH.relative_to(DEN)),
            },
            "options": {
                "skip_group_only": args.skip_group_only,
                "max_stamps": args.max_stamps,
            },
            "zones": [
                {"id": z["id"], "rect": list(z["raw"]),
                 "segments": [{"biome": s["biome"], "count": s["count"]} for s in z["segments"]]}
                for z in used_zones
            ],
            "stamps": len(stamps),
            "by_category": dict(sorted(by_category.items(), key=lambda kv: -kv[1])),
            "by_biome": dict(sorted(by_biome.items(), key=lambda kv: -kv[1])),
            "coverage_before": before,
        },
        "patches": patches,
        "roads": [],
        "stamps": stamps,
        "anims": [],
        "animBands": [],
        "solids": [],
        "labels": labels,
        "portals": [],
        "npcs": [],
        "vehicles": [],
    }


def self_check(placed: list[dict], world_w: int, world_h: int) -> list[str]:
    """Catch OVERLAP / OFFWORLD before check-city-plan.py does."""
    problems = []
    rects = [(it["me"], it["rect"], it["solid"]) for it in placed]
    for me_id, (x, y, w, h), _solid in rects:
        if x < 0 or y < 0 or x + w > world_w or y + h > world_h:
            problems.append(f"OFFWORLD {me_id} rect ({x},{y},{w},{h})")
    solid = [r for r in rects if r[2]]
    solid.sort(key=lambda r: r[1][0])
    for i, (id_a, ra, _) in enumerate(solid):
        for id_b, rb, _ in solid[i + 1:]:
            if rb[0] >= ra[0] + ra[2]:
                break
            ox = min(ra[0] + ra[2], rb[0] + rb[2]) - max(ra[0], rb[0])
            oy = min(ra[1] + ra[3], rb[1] + rb[3]) - max(ra[1], rb[1])
            if ox > 0 and oy > 0:
                smaller = min(ra[2] * ra[3], rb[2] * rb[3])
                if smaller and (ox * oy) / smaller > 0.35:
                    problems.append(f"OVERLAP {id_a} vs {id_b}")
    return problems


def verify_merged(plan: dict, dims: Dims, world_w: int, world_h: int) -> list[str]:
    """Re-run check-city-plan.py's hard gates, scoped to showcase stamps.

    The merged plan is shared with every other district compiler, so a global
    `defects: none` can be spoiled by someone else's work in progress. This
    answers the narrower question: does the showcase itself land clean?
    """
    problems = []
    showcase, others = [], []
    for s in plan.get("stamps", []):
        r = stamp_rect(s, dims)
        if not r:
            continue
        (showcase if s.get("showcase") else others).append((s, r))
    if not showcase:
        problems.append("no showcase stamps in the merged plan — was it merged with "
                        "--include-generated?")
        return problems

    for s, (x, y, w, h) in showcase:
        if x < 0 or y < 0 or x + w > world_w or y + h > world_h:
            problems.append(f"OFFWORLD {s.get('me')} rect ({x},{y},{w},{h})")

    def overlap(a, b):
        ox = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
        oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
        return max(0, ox) * max(0, oy)

    # Any intersection with a non-showcase stamp means zone discovery put an
    # exhibit on top of the real city — stricter than the 35% OVERLAP gate.
    for s, r in showcase:
        for o, ro in others:
            if overlap(r, ro):
                problems.append(f"ZONE_COLLISION {s.get('me')} @({s['x']},{s['y']}) "
                                f"over {os.path.basename(o.get('img', '?'))}")
                break

    solid_show = [(s, r) for s, r in showcase if s.get("solid")]
    for i, (s1, r1) in enumerate(solid_show):
        for s2, r2 in solid_show[i + 1:]:
            oa = overlap(r1, r2)
            smaller = min(r1[2] * r1[3], r2[2] * r2[3])
            if smaller and oa / smaller > 0.35:
                problems.append(f"OVERLAP {s1.get('me')} vs {s2.get('me')}")

    grounds = [(p["x"], p["y"], p["w"], p["h"]) for p in plan.get("patches", [])]
    grounds += [(r["x"] - 16, r["y"] - 16, r["w"] + 32, r["h"] + 32) for r in plan.get("roads", [])]
    NATURE = ("tree", "bush", "rock", "flower", "plant", "grass", "hedge")
    for s, (x, y, w, h) in solid_show:
        if any(n in s.get("img", "").lower() for n in NATURE):
            continue
        bx, by = x + w // 2, y + h - 4
        if not any(gx <= bx <= gx + gw and gy <= by <= gy + gh for gx, gy, gw, gh in grounds):
            problems.append(f"FLOATING {s.get('me')} base ({bx},{by})")
    return problems


# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-v", "--verbose", action="store_true", help="per-zone packing detail")
    ap.add_argument("--out", default=str(OUT_PATH), help=f"output fragment (default: {OUT_PATH.relative_to(DEN)})")
    ap.add_argument("--max-stamps", type=int, default=2000, help="cap on emitted stamps (default: 2000)")
    ap.add_argument("--skip-group-only", action="store_true",
                    help="drop me.* the catalog marks group_only (they read best inside a "
                         "grp.* recipe; placed solo they trip check-city-plan's advisory "
                         "GROUP_SOLO, which never fails the gate)")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--verify-merged", action="store_true",
                    help="skip compiling; re-check data/city-plan.json's hard QA gates "
                         "scoped to the showcase stamps already merged into it")
    args = ap.parse_args()

    registry = load_jsonl(REGISTRY_PATH)
    enriched = {r["me"]: r for r in load_jsonl(ENRICHED_PATH) if r.get("me")}
    index_me = (load_json(INDEX_PATH) or {}).get("me") or {}
    rules = load_json(RULES_PATH)
    roles = {k: v for k, v in (rules.get("roles") or {}).items() if isinstance(v, dict)}
    biomes = {k: v for k, v in (rules.get("biomes") or {}).items() if isinstance(v, dict)}
    singles = {s["id"]: s for s in load_jsonl(SINGLES_PATH)}
    plan = load_json(CITY_PLAN_PATH)
    world_w = (plan.get("worldSize") or {}).get("w", 6656)
    world_h = (plan.get("worldSize") or {}).get("h", 6400)

    if not registry or not index_me:
        print("ERROR: catalog inputs missing — run build-limezu-singles-catalog / "
              "resolve_limezu_me_stamps first")
        return 1

    if args.verify_merged:
        problems = verify_merged(plan, Dims(), world_w, world_h)
        n = sum(1 for s in plan.get("stamps", []) if s.get("showcase"))
        print(f"verify-merged: {n} showcase stamps in {CITY_PLAN_PATH.relative_to(DEN)}")
        if problems:
            print(f"  {len(problems)} problem(s):")
            for p in problems[:30]:
                print("   ", p)
            return 1
        print("  showcase defects: none (OFFWORLD / ZONE_COLLISION / OVERLAP / FLOATING)")
        return 0

    used = used_me_ids(plan, singles)
    items, skipped = collect_orphans(args, registry, enriched, index_me, used, Dims(), roles)

    building_total = sum(1 for r in registry if r.get("category") == "building")
    tier_b_total = sum(1 for r in registry if r.get("category") in TIER_B_CATEGORIES)
    before = {
        "me_used": len(used),
        "me_total": len(registry),
        "tier_a_used": sum(1 for r in registry if r.get("category") == "building" and r["id"] in used),
        "tier_a_total": building_total,
        "tier_b_used": sum(1 for r in registry if r.get("category") in TIER_B_CATEGORIES and r["id"] in used),
        "tier_b_total": tier_b_total,
    }

    print(f"orphans: {len(items)} placeable me.* "
          f"({skipped['no_linked_single']} unused me.* have no linked Single and cannot be "
          f"drawn at all)")
    if skipped:
        print("  skipped:", dict(skipped))

    if len(items) > args.max_stamps:
        items.sort(key=lambda it: (0 if it["category"] == "building" else
                                   1 if it["category"] in TIER_B_CATEGORIES else 2, it["me"]))
        dropped = len(items) - args.max_stamps
        items = items[:args.max_stamps]
        print(f"  capped at --max-stamps {args.max_stamps} (dropped {dropped}, "
              f"Tier A/B kept first)")

    dims = Dims()
    occ = build_occupancy(plan, dims, world_w, world_h)
    zones = carve_zones(occ, MIN_ZONE_W, MIN_ZONE_H, MAX_ZONES)
    print(f"zones: {len(zones)} empty rect(s) found, "
          f"{sum(z['w'] * z['h'] for z in zones):,} px2 usable")
    if args.verbose:
        for z in zones:
            print(f"  {z['id']}: x={z['x']} y={z['y']} w={z['w']} h={z['h']}")
    if not zones:
        print("ERROR: no empty world space left for a showcase district")
        return 1

    if args.verbose:
        print("packing:")
    placed, unplaced = pack_all(items, zones, args.verbose)

    # Second pass: the leftovers are small props by now, so scrape the world
    # for pocket-sized gaps the first (building-sized) threshold skipped.
    if unplaced:
        micro = carve_zones(occ, MICRO_ZONE_W, MICRO_ZONE_H, MAX_ZONES, first_id=len(zones) + 1)
        if micro:
            if args.verbose:
                print(f"  {len(unplaced)} leftover(s) -> {len(micro)} pocket zone(s)")
            more, unplaced = pack_all(unplaced, micro, args.verbose)
            placed.extend(more)
            zones.extend(micro)

    fragment = build_fragment(placed, zones, biomes, before, args)
    problems = self_check(placed, world_w, world_h)
    if problems:
        print(f"SELF-CHECK FAILED ({len(problems)}):")
        for p in problems[:20]:
            print("  ", p)
        return 1

    placed_ids = {it["me"] for it in placed}
    after_a = before["tier_a_used"] + sum(1 for it in placed if it["category"] == "building")
    after_b = before["tier_b_used"] + sum(1 for it in placed if it["category"] in TIER_B_CATEGORIES)

    print(f"placed: {len(placed)} stamps across "
          f"{sum(1 for z in zones if z['segments'])} zone(s), "
          f"{len(fragment['patches'])} ground patches, {len(fragment['labels'])} labels")
    if unplaced:
        print(f"  unplaced (no empty space left): {len(unplaced)} — "
              f"{dict(Counter(i['category'] for i in unplaced))}")
    print(f"tier A buildings: {before['tier_a_used']}/{building_total} "
          f"({100.0 * before['tier_a_used'] / building_total:.2f}%) -> "
          f"{after_a}/{building_total} ({100.0 * after_a / building_total:.2f}%)")
    print(f"tier B props/nature/vehicles: {before['tier_b_used']}/{tier_b_total} "
          f"({100.0 * before['tier_b_used'] / tier_b_total:.2f}%) -> "
          f"{after_b}/{tier_b_total} ({100.0 * after_b / tier_b_total:.2f}%)")
    print(f"me.* overall: {before['me_used']}/{len(registry)} -> "
          f"{before['me_used'] + len(placed_ids)}/{len(registry)}")

    if args.verbose:
        print("by category:", dict(Counter(i["category"] for i in placed).most_common()))
        print("by biome:   ", dict(Counter(i["biome"] for i in placed).most_common()))

    if args.dry_run:
        print("--dry-run: nothing written")
        return 0

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fragment, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(DEN) if out.is_absolute() else out}")
    print("next: python3 scripts/merge-city-plan.py --include-generated && "
          "python3 scripts/check-city-plan.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
