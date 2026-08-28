#!/usr/bin/env python3
"""Exterior district compiler — turns a declarative district SPEC into a city
fragment (`data/city-specs/...json`) instead of hand-stamping XY by eye.

Architecture, spec format and pass contracts: docs/EXTERIOR-COMPILER.md

    python3 scripts/compile-exterior-district.py --spec data/city-specs/biome-specs/beach.json

This is the W0-D scaffold: the spec loader, validator, catalog footprint
lookup, occupancy grid, pass pipeline and fragment emitter are REAL. The
fill passes C-H are registered no-op hooks (see TODO markers) so the CLI
runs end to end today and W2-A can land placement logic one pass at a time
without touching the plumbing.

Stamps are emitted as catalog ids (`me` / `prefer`), never as `img` paths —
`merge-city-plan.py` stays the single place where ids resolve to PNGs.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

DEN = Path(__file__).resolve().parents[1]
CAT = DEN / "data" / "limezu-visual-catalog"
RULES_PATH = CAT / "placement-rules.json"          # W0-A output
INDEX_PATH = CAT / "placement-index.json"          # resolve_limezu_me_stamps.py
ME_TO_SINGLES = CAT / "me-to-singles.json"
GROUPS_DIR = CAT / "groups"                        # W1-C grp.* recipes
SPECS_DIR = DEN / "data" / "city-specs"
DEFAULT_OUT_DIR = SPECS_DIR / "generated"

# The played world (data/city-plan.json worldSize). Districts must fit inside.
WORLD = {"w": 6656, "h": 6400}
TILE = 16
PATCH_TILES = {"grass", "sidewalk", "asphalt", "sand"}   # full-world.js TILE_KEYS
FRAGMENT_LISTS = ("patches", "roads", "stamps", "anims", "animBands",
                  "solids", "labels", "portals", "npcs", "vehicles")

# Occupancy cell flags.
RESERVED = 1    # circulation / keep-clear: nothing may be placed
SOLID = 2       # a solid footprint stands here
DECOR = 4       # a walkable decal/prop stands here
CLEAR = 8       # clearance halo around a solid (soft: decor may still land)


# ── spec loading + validation ────────────────────────────────────────────────

def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def load_rules(verbose: bool = False) -> dict:
    """placement-rules.json (W0-A). Missing = compile with built-in defaults so
    this script is usable before gate G0 lands the rules file."""
    rules = load_json(RULES_PATH)
    if rules is None:
        print(f"warn: {RULES_PATH.relative_to(DEN)} not found — "
              "compiling with built-in defaults (biome/role filters disabled)")
        return {}
    if verbose:
        print(f"rules: {RULES_PATH.relative_to(DEN)} "
              f"v{rules.get('version', '?')} "
              f"biomes={len(rules.get('biomes') or {})} "
              f"roles={len(rules.get('roles') or {})}")
    return rules


PASS_KEYS = ("A_ground", "B_skeleton", "C_landmarks", "D_groups",
             "E_props", "F_canopy", "G_detail", "H_life")


def validate_spec(spec: dict, rules: dict) -> tuple[list[str], list[str]]:
    """Structural + semantic checks. Returns (errors, warnings).

    Errors abort the compile; warnings are printed and ignored. Everything the
    spec declares in LOCAL district coordinates is bounds-checked here so no
    pass has to defend against off-district rects.
    """
    errs: list[str] = []
    warns: list[str] = []

    for key in ("id", "district", "biome", "bbox"):
        if not spec.get(key):
            errs.append(f"spec.{key} is required")

    bbox = spec.get("bbox") or {}
    if errs and not bbox:
        return errs, warns
    for key in ("x", "y", "w", "h"):
        if not isinstance(bbox.get(key), int):
            errs.append(f"spec.bbox.{key} must be an int (px)")
    if errs:
        return errs, warns

    if bbox["w"] <= 0 or bbox["h"] <= 0:
        errs.append("spec.bbox w/h must be positive")
    if bbox["x"] < 0 or bbox["y"] < 0:
        errs.append("spec.bbox origin is negative")
    if bbox["x"] + bbox["w"] > WORLD["w"] or bbox["y"] + bbox["h"] > WORLD["h"]:
        errs.append(f"spec.bbox exceeds world {WORLD['w']}x{WORLD['h']} (OFFWORLD)")
    # Only the ORIGIN has to be on the lattice: pass A snaps patch sizes up, but
    # an off-grid origin shifts the whole grout grid and reads as broken seams.
    for key in ("x", "y"):
        if bbox[key] % TILE:
            warns.append(f"spec.bbox.{key}={bbox[key]} is off the {TILE}px tile grid "
                         "(ground seams will not line up with neighbouring districts)")

    if not isinstance(spec.get("seed", 0), int):
        errs.append("spec.seed must be an int")

    biome = spec.get("biome")
    known_biomes = rules.get("biomes") or {}
    if known_biomes and biome not in known_biomes:
        warns.append(f"biome '{biome}' is not in placement-rules.json biomes "
                     f"({', '.join(sorted(known_biomes)[:6])}…)")

    ground = spec.get("ground") or {}
    base_tile = ((ground.get("base") or {}).get("tile"))
    if not base_tile:
        errs.append("spec.ground.base.tile is required (grass|sidewalk|asphalt|sand)")
    elif base_tile not in PATCH_TILES:
        errs.append(f"spec.ground.base.tile '{base_tile}' unknown; "
                    f"full-world.js renders {sorted(PATCH_TILES)}")
    for i, layer in enumerate(ground.get("layers") or []):
        errs += _rect_errors(f"ground.layers[{i}].rect", layer.get("rect"), bbox)
        if layer.get("tile") not in PATCH_TILES:
            errs.append(f"ground.layers[{i}].tile '{layer.get('tile')}' unknown")

    zone_ids = set()
    for i, zone in enumerate(spec.get("zones") or []):
        zid = zone.get("id")
        if not zid:
            errs.append(f"zones[{i}].id is required")
        elif zid in zone_ids:
            errs.append(f"zones[{i}].id '{zid}' is duplicated")
        zone_ids.add(zid)
        errs += _rect_errors(f"zones[{i}].rect", zone.get("rect"), bbox)
        density = zone.get("density", 0)
        if not isinstance(density, (int, float)) or not 0 <= density <= 1:
            errs.append(f"zones[{i}].density must be 0..1")

    for i, res in enumerate(spec.get("reserve") or []):
        errs += _rect_errors(f"reserve[{i}].rect", res.get("rect"), bbox)

    for i, slot in enumerate(spec.get("slots") or []):
        if slot.get("zone") and slot["zone"] not in zone_ids:
            errs.append(f"slots[{i}].zone '{slot['zone']}' is not a declared zone")
        at = slot.get("at")
        if not (isinstance(at, list) and len(at) == 2 and all(isinstance(v, int) for v in at)):
            errs.append(f"slots[{i}].at must be [x, y] local ints")
        elif not (0 <= at[0] <= bbox["w"] and 0 <= at[1] <= bbox["h"]):
            errs.append(f"slots[{i}].at {at} is outside the district bbox")
        pick = slot.get("pick") or {}
        if not (pick.get("me") or pick.get("exs") or pick.get("group")):
            errs.append(f"slots[{i}].pick needs one of me / exs / group")

    for key in (spec.get("passes") or {}):
        if key not in PASS_KEYS:
            warns.append(f"passes.{key} is not a known pass ({', '.join(PASS_KEYS)})")

    return errs, warns


def _rect_errors(label: str, rect, bbox: dict) -> list[str]:
    if not (isinstance(rect, list) and len(rect) == 4 and all(isinstance(v, int) for v in rect)):
        return [f"{label} must be [x, y, w, h] local ints"]
    x, y, w, h = rect
    if w <= 0 or h <= 0:
        return [f"{label} has non-positive size"]
    if x < 0 or y < 0 or x + w > bbox["w"] or y + h > bbox["h"]:
        return [f"{label} {rect} escapes the district bbox {bbox['w']}x{bbox['h']}"]
    return []


# ── catalog footprints ───────────────────────────────────────────────────────

class Catalog:
    """Compile-time footprint oracle.

    Sizes come from the catalog (`placement-index.json` carries every Single's
    w/h), NOT from opening PNGs — so a compile stays fast and needs no PIL.
    """

    def __init__(self) -> None:
        self.index = load_json(INDEX_PATH) or {"me": {}, "exs": {}}
        self.me = self.index.get("me") or {}
        self.exs = self.index.get("exs") or {}
        self._variants: dict | None = None
        self.misses: list[str] = []

    @property
    def ready(self) -> bool:
        return bool(self.me or self.exs)

    def _variant_list(self, me_id: str) -> list[dict]:
        if self._variants is None:
            data = load_json(ME_TO_SINGLES) or {}
            self._variants = data.get("links") or {}
        return self._variants.get(me_id) or []

    def footprint(self, me: str | None = None, exs: str | None = None,
                  prefer: str | None = None) -> tuple[int, int] | None:
        """(w, h) of the PNG a stamp will resolve to, or None if unknown."""
        if exs:
            entry = self.exs.get(exs)
            if not entry:
                self.misses.append(exs)
                return None
            return (entry.get("w") or TILE, entry.get("h") or TILE)
        if not me:
            return None
        entry = self.me.get(me)
        if not entry:
            self.misses.append(me)
            return None
        target = entry.get("exs")
        if prefer:
            low = prefer.lower()
            for v in self._variant_list(me):
                path = (v.get("path") or v.get("basename") or "").lower()
                if low in path:
                    target = v.get("id") or target
                    break
        sized = self.exs.get(target or "")
        if sized:
            return (sized.get("w") or TILE, sized.get("h") or TILE)
        self.misses.append(me)
        return None


# ── occupancy grid ───────────────────────────────────────────────────────────

class Occupancy:
    """16px cell grid over the district: what surface each cell is, and what
    already stands on it. This is what lets fill passes place blind and still
    come out clean against `check-city-plan.py` (OVERLAP / FLOATING / ROADBLOCK).
    """

    def __init__(self, bbox: dict) -> None:
        self.x0, self.y0 = bbox["x"], bbox["y"]
        self.cw = (bbox["w"] + TILE - 1) // TILE
        self.ch = (bbox["h"] + TILE - 1) // TILE
        self.flags = bytearray(self.cw * self.ch)
        self.surface: list[str | None] = [None] * (self.cw * self.ch)
        self.solid_rects: list[tuple[int, int, int, int]] = []

    def _cell_span(self, rect: tuple[int, int, int, int]):
        """World rect → inclusive cell index ranges, clipped to the district."""
        x, y, w, h = rect
        cx0 = max(0, (x - self.x0) // TILE)
        cy0 = max(0, (y - self.y0) // TILE)
        cx1 = min(self.cw - 1, (x + w - 1 - self.x0) // TILE)
        cy1 = min(self.ch - 1, (y + h - 1 - self.y0) // TILE)
        return cx0, cy0, cx1, cy1

    def _cells(self, rect):
        cx0, cy0, cx1, cy1 = self._cell_span(rect)
        for cy in range(cy0, cy1 + 1):
            row = cy * self.cw
            for cx in range(cx0, cx1 + 1):
                yield row + cx

    def paint_surface(self, rect, tile: str) -> None:
        for i in self._cells(rect):
            self.surface[i] = tile

    def surface_at(self, px: int, py: int) -> str | None:
        cx, cy = (px - self.x0) // TILE, (py - self.y0) // TILE
        if not (0 <= cx < self.cw and 0 <= cy < self.ch):
            return None
        return self.surface[cy * self.cw + cx]

    def surfaces_under(self, rect) -> set[str | None]:
        return {self.surface[i] for i in self._cells(rect)}

    def mark(self, rect, flag: int) -> None:
        for i in self._cells(rect):
            self.flags[i] |= flag

    def is_free(self, rect, blocked: int = RESERVED | SOLID) -> bool:
        return all(not (self.flags[i] & blocked) for i in self._cells(rect))

    def claim(self, rect, flag: int = SOLID, halo: int = 0) -> None:
        self.mark(rect, flag)
        if flag & SOLID:
            self.solid_rects.append(tuple(rect))
        if halo:
            x, y, w, h = rect
            self.mark((x - halo, y - halo, w + 2 * halo, h + 2 * halo), CLEAR)

    def overlap_ratio(self, rect) -> float:
        """Worst overlap of `rect` against already-claimed solids, as a fraction
        of the smaller sprite — the exact metric check-city-plan.py flags at 35%.
        """
        worst = 0.0
        ax, ay, aw, ah = rect
        for bx, by, bw, bh in self.solid_rects:
            ox = max(0, min(ax + aw, bx + bw) - max(ax, bx))
            oy = max(0, min(ay + ah, by + bh) - max(ay, by))
            if not ox or not oy:
                continue
            smaller = min(aw * ah, bw * bh)
            if smaller:
                worst = max(worst, ox * oy / smaller)
        return worst

    def stats(self) -> dict:
        used = sum(1 for f in self.flags if f & (SOLID | DECOR))
        return {"cells": self.cw * self.ch, "occupied_cells": used,
                "reserved_cells": sum(1 for f in self.flags if f & RESERVED)}


# ── compile context ──────────────────────────────────────────────────────────

class Ctx:
    def __init__(self, spec: dict, rules: dict, catalog: Catalog, seed: int,
                 verbose: bool = False) -> None:
        self.spec = spec
        self.rules = rules
        self.cat = catalog
        self.bbox = spec["bbox"]
        self.occ = Occupancy(self.bbox)
        self.seed = seed
        self.verbose = verbose
        self.frag = {k: [] for k in FRAGMENT_LISTS}
        self.stats: dict[str, dict] = {}
        self.zones = {z["id"]: z for z in (spec.get("zones") or [])}

    def rng(self, pass_letter: str, salt: str = "") -> random.Random:
        """One deterministic stream per pass (and per zone/recipe), so adding a
        pass never reshuffles what earlier passes already placed."""
        return random.Random(f"{self.seed}:{self.spec['id']}:{pass_letter}:{salt}")

    def world(self, local: list[int]) -> tuple[int, ...]:
        """Local district coords → world coords. Specs are relocatable: only
        bbox carries an absolute position."""
        if len(local) == 2:
            return (self.bbox["x"] + local[0], self.bbox["y"] + local[1])
        x, y, w, h = local
        return (self.bbox["x"] + x, self.bbox["y"] + y, w, h)

    def pass_cfg(self, key: str) -> dict:
        return (self.spec.get("passes") or {}).get(key) or {}

    def enabled(self, key: str) -> bool:
        return self.pass_cfg(key).get("enabled", True)


# ── passes ───────────────────────────────────────────────────────────────────

def pass_a_ground(ctx: Ctx) -> dict:
    """A — Ground. Base patch + declared overlay slabs, and the surface map
    every later pass queries. Runs first so nothing can end up FLOATING.
    """
    ground = ctx.spec.get("ground") or {}
    base = ground.get("base") or {}
    bx, by, bw, bh = ctx.bbox["x"], ctx.bbox["y"], ctx.bbox["w"], ctx.bbox["h"]
    base_rect = _snap16(bx, by, bw, bh)
    ctx.frag["patches"].append({"tile": base["tile"], "x": base_rect[0], "y": base_rect[1],
                                "w": base_rect[2], "h": base_rect[3],
                                "depth": base.get("depth", 0.9)})
    ctx.occ.paint_surface(base_rect, base["tile"])

    for layer in ground.get("layers") or []:
        rect = _snap16(*ctx.world(layer["rect"]))
        ctx.frag["patches"].append({"tile": layer["tile"], "x": rect[0], "y": rect[1],
                                    "w": rect[2], "h": rect[3],
                                    "depth": layer.get("depth", 0.91)})
        ctx.occ.paint_surface(rect, layer["tile"])

    return {"patches": len(ctx.frag["patches"])}


def pass_b_skeleton(ctx: Ctx) -> dict:
    """B — Skeleton. Circulation: keep-clear reservations, walkable paths and
    the district's own roads. Reserving before any prop lands is what keeps
    walkways open and solids off the lanes (ROADBLOCK).
    """
    reserved = 0
    for res in ctx.spec.get("reserve") or []:
        ctx.occ.mark(ctx.world(res["rect"]), RESERVED)
        reserved += 1

    roads = 0
    for road in (ctx.pass_cfg("B_skeleton").get("roads") or []):
        x, y, w, h = ctx.world(road["rect"])
        ctx.frag["roads"].append({"x": x, "y": y, "w": w, "h": h})
        ctx.occ.mark((x - TILE, y - TILE, w + 2 * TILE, h + 2 * TILE), RESERVED)
        roads += 1

    # TODO(W2-A): auto-route paths between district entrances and slot anchors
    # (A* on the free cells), emit them as `path_tile` patches, and reserve the
    # corridor. Today only spec-declared reserves/roads are honoured.
    return {"reserved": reserved, "roads": roads}


def pass_c_landmarks(ctx: Ctx) -> dict:
    """C — Landmarks. Largest footprints first, from `slots` (explicit anchors)
    then from the biome's building/landmark pool. Big, inflexible pieces claim
    space before anything small can box them out.
    """
    # TODO(W2-A): for each slot, resolve pick → footprint via ctx.cat, snap the
    # anchor to the facing surface, reject on ctx.occ.overlap_ratio() > 0.2,
    # claim with a doorway halo, then emit {me, prefer, x, y, origin, solid}.
    return {"placed": 0, "skipped_slots": len(ctx.spec.get("slots") or []), "todo": True}


def pass_d_groups(ctx: Ctx) -> dict:
    """D — Groups. Expand `grp.*` recipes (volley court, bamboo bar + stools,
    stage + barriers + speakers) as ATOMIC multi-stamp assemblies: all member
    stamps land at recipe-relative offsets or the whole group is rejected.
    Fixes mistake #1 (stamp collage instead of composed scenes).
    """
    # TODO(W1-C/W2-A): load recipes from GROUPS_DIR, test the group's union
    # footprint against the occupancy, then emit every member stamp.
    return {"groups": 0, "stamps": 0, "recipes_available": _count_recipes(), "todo": True}


def pass_e_props(ctx: Ctx) -> dict:
    """E — Props. Per-zone scatter of role-matched, surface-matched props at the
    zone's density, using a jittered-grid / Poisson-disc sample. Variant choice
    is coverage-aware so a district spends unused Singles instead of repeating
    the same six PNGs (mistake #2).
    """
    # TODO(W2-A): candidate pool = enriched me.* filtered by biome + role +
    # surface; sample anchors from ctx.rng('E', zone_id); enforce zone spacing.
    return {"placed": 0, "zones": len(ctx.zones), "todo": True}


def pass_f_canopy(ctx: Ctx) -> dict:
    """F — Canopy. Overhead cover (palms, trees, umbrellas, awnings) last among
    the solids: it overhangs what pass E placed, so it must see the ground props
    to avoid burying an interactable or blocking a sightline.
    """
    # TODO(W2-A): place on CLEAR-tolerant cells with canopy spacing, skip cells
    # adjacent to slot doorways, keep the shade footprint inside the zone.
    return {"placed": 0, "todo": True}


def pass_g_detail(ctx: Ctx) -> dict:
    """G — Detail. High-count, zero-collision dressing (shells, starfish, sand
    holes, litter, decals) into whatever cells are still empty. Never solid, so
    it cannot create an OVERLAP defect.
    """
    # TODO(W2-A): fill to a target free-cell ratio using DECOR-only claims.
    return {"placed": 0, "todo": True}


def pass_h_life(ctx: Ctx) -> dict:
    """H — Life. Anims, animBands (water/shore), vehicles, labels, portals, NPC
    patrol hints and `interact` tags on stamps placed by C-G. Runs last because
    interaction attaches to the objects the earlier passes chose.
    """
    label = ctx.spec.get("label")
    if label:
        lx, ly = ctx.world(ctx.spec.get("label_at") or [ctx.bbox["w"] // 2, 24])
        ctx.frag["labels"].append({"x": lx, "y": ly, "text": label})

    # TODO(W4-A): emit anims/animBands from the biome's animated inventory and
    # attach interact verbs (sit / enter / read / shop) to eligible stamps.
    return {"labels": len(ctx.frag["labels"]), "anims": 0, "todo": True}


PASSES = [
    ("A_ground", pass_a_ground),
    ("B_skeleton", pass_b_skeleton),
    ("C_landmarks", pass_c_landmarks),
    ("D_groups", pass_d_groups),
    ("E_props", pass_e_props),
    ("F_canopy", pass_f_canopy),
    ("G_detail", pass_g_detail),
    ("H_life", pass_h_life),
]


def _count_recipes() -> int:
    return len(list(GROUPS_DIR.glob("grp.*.json"))) if GROUPS_DIR.exists() else 0


def _snap16(x: int, y: int, w: int, h: int) -> tuple[int, int, int, int]:
    """Snap a rect to the tile grid (origin down, size up) so every patch shares
    one grout lattice — off-grid patches are why ground read as 'broken' seams.
    """
    x0, y0 = (x // TILE) * TILE, (y // TILE) * TILE
    return (x0, y0,
            ((x + w + TILE - 1) // TILE) * TILE - x0,
            ((y + h + TILE - 1) // TILE) * TILE - y0)


# ── emit ─────────────────────────────────────────────────────────────────────

def compile_spec(spec: dict, rules: dict, seed: int, only: set[str] | None = None,
                 verbose: bool = False) -> tuple[dict, Ctx]:
    ctx = Ctx(spec, rules, Catalog(), seed, verbose=verbose)
    if not ctx.cat.ready:
        print(f"warn: {INDEX_PATH.relative_to(DEN)} missing — footprints unavailable; "
              "run `python3 scripts/resolve_limezu_me_stamps.py` first")

    for key, fn in PASSES:
        if only and key not in only:
            ctx.stats[key] = {"skipped": "not selected"}
            continue
        if not ctx.enabled(key):
            ctx.stats[key] = {"skipped": "disabled in spec"}
            continue
        ctx.stats[key] = fn(ctx)
        if verbose:
            print(f"  pass {key:12s} {ctx.stats[key]}")

    frag = {
        "_doc": f"GENERATED by scripts/compile-exterior-district.py from "
                f"{spec.get('_spec_path', 'spec')} — do not hand-edit; edit the spec and recompile.",
        "district": spec["district"],
        "id": spec["id"],
        "biome": spec["biome"],
        "bbox": dict(spec["bbox"]),
        "_compiled": {
            "spec": spec.get("_spec_path"),
            "seed": seed,
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "rules": rules.get("version") if rules else None,
            "passes": ctx.stats,
            "occupancy": ctx.occ.stats(),
            "catalog_misses": sorted(set(ctx.cat.misses))[:20],
        },
    }
    frag.update({k: ctx.frag[k] for k in FRAGMENT_LISTS})
    return frag, ctx


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Compile an exterior district spec into a city-plan fragment.")
    ap.add_argument("--spec", required=True,
                    help="district spec JSON (e.g. data/city-specs/biome-specs/beach.json)")
    ap.add_argument("--out", help="fragment output path (default: spec.out or "
                                 "data/city-specs/generated/<id>.json)")
    ap.add_argument("--seed", type=int, help="override spec.seed (deterministic compile)")
    ap.add_argument("--passes", help="comma-separated subset, e.g. A_ground,B_skeleton")
    ap.add_argument("--validate-only", action="store_true", help="check the spec, emit nothing")
    ap.add_argument("--dry-run", action="store_true", help="compile but do not write the fragment")
    ap.add_argument("--qa", action="store_true", help="run check-city-plan.py on the fragment")
    ap.add_argument("--stats-json", help="also write the per-pass stats block here")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    spec_path = Path(args.spec)
    if not spec_path.is_absolute():
        spec_path = (DEN / spec_path) if not spec_path.exists() else spec_path.resolve()
    spec = load_json(spec_path)
    if spec is None:
        print(f"error: spec not found: {args.spec}", file=sys.stderr)
        return 2
    try:
        spec["_spec_path"] = str(spec_path.relative_to(DEN)).replace(os.sep, "/")
    except ValueError:
        spec["_spec_path"] = str(spec_path)

    rules = load_rules(verbose=args.verbose)
    errs, warns = validate_spec(spec, rules)
    for w in warns:
        print(f"warn: {w}")
    if errs:
        for e in errs:
            print(f"error: {e}", file=sys.stderr)
        print(f"spec INVALID: {len(errs)} error(s)", file=sys.stderr)
        return 1
    print(f"spec OK: {spec['id']} ({spec['district']}) biome={spec['biome']} "
          f"{spec['bbox']['w']}x{spec['bbox']['h']} @({spec['bbox']['x']},{spec['bbox']['y']})")
    if args.validate_only:
        return 0

    seed = args.seed if args.seed is not None else spec.get("seed", 0)
    only = {p.strip() for p in args.passes.split(",")} if args.passes else None
    frag, ctx = compile_spec(spec, rules, seed, only=only, verbose=args.verbose)

    counts = {k: len(frag[k]) for k in FRAGMENT_LISTS if frag[k]}
    print(f"compiled seed={seed}: {counts or 'empty fragment'}")
    todo = [k for k, v in ctx.stats.items() if v.get("todo")]
    if todo:
        print(f"stub passes (no fill logic yet): {', '.join(todo)}")

    out = Path(args.out) if args.out else None
    if out is None:
        out = DEN / spec["out"] if spec.get("out") else DEFAULT_OUT_DIR / f"{spec['id']}.json"
    if not out.is_absolute():
        out = DEN / out

    if args.dry_run:
        print(f"dry-run: would write {out}")
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(frag, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(DEN) if out.is_relative_to(DEN) else out}")

    if args.stats_json:
        stats_path = Path(args.stats_json)
        if not stats_path.is_absolute():
            stats_path = DEN / stats_path
        stats_path.parent.mkdir(parents=True, exist_ok=True)
        stats_path.write_text(json.dumps(frag["_compiled"], indent=2) + "\n", encoding="utf-8")
        print(f"wrote {stats_path}")

    if args.qa:
        qa = subprocess.run([sys.executable, str(DEN / "scripts" / "check-city-plan.py"), str(out)],
                            capture_output=True, text=True)
        print(qa.stdout.strip() or qa.stderr.strip())
        return qa.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
