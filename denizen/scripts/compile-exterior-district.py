#!/usr/bin/env python3
"""Exterior district compiler — turns a declarative district SPEC into a city
fragment (`data/city-specs/...json`) instead of hand-stamping XY by eye.

Architecture, spec format and pass contracts: docs/EXTERIOR-COMPILER.md

    python3 scripts/compile-exterior-district.py --spec data/city-specs/biome-specs/beach.json

Spec vocabulary (biome / role / slot / density / palette / interact names) is
owned by data/limezu-visual-catalog/placement-rules.json — this script is its
consumer and validates every spec against it.

This is the W0-D scaffold: the spec loader, rules-aware validator, catalog
footprint oracle, occupancy grid with surface map, slot resolution, pass
pipeline and fragment emitter are REAL. The fill passes C-G are registered
no-op hooks (see TODO markers) so the CLI runs end to end today and W2-A can
land placement logic one pass at a time without touching the plumbing.

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
from pathlib import Path

DEN = Path(__file__).resolve().parents[1]
CAT = DEN / "data" / "limezu-visual-catalog"
RULES_PATH = CAT / "placement-rules.json"          # W0-A
INDEX_PATH = CAT / "placement-index.json"          # resolve_limezu_me_stamps.py
ME_TO_SINGLES = CAT / "me-to-singles.json"
GROUPS_DIR = CAT / "groups"                        # W1-C grp.* recipes
SPECS_DIR = DEN / "data" / "city-specs"
DEFAULT_OUT_DIR = SPECS_DIR / "generated"
ASSETS = DEN / "assets" / "limezu"

# The played world (data/city-plan.json worldSize). Districts must fit inside.
WORLD = {"w": 6656, "h": 6400}
TILE = 16
# The only ground tiles src/full-world.js can paint (TILE_KEYS).
PAINTABLE_TILES = {"grass", "sidewalk", "asphalt", "sand"}
FRAGMENT_LISTS = ("patches", "roads", "stamps", "anims", "animBands",
                  "solids", "labels", "portals", "npcs", "vehicles")

# Occupancy cell flags.
RESERVED = 1    # circulation / keep-clear: nothing may be placed
SOLID = 2       # a solid footprint stands here
DECOR = 4       # a walkable decal/prop stands here
CLEAR = 8       # clearance halo around a solid (soft: decor may still land)
UNWALKABLE = 16  # water and the like: only water_prop / boats may sit here

PASS_KEYS = ("A_ground", "B_skeleton", "C_landmarks", "D_groups",
             "E_props", "F_canopy", "G_detail", "H_life")


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def load_rules(verbose: bool = False) -> dict:
    """placement-rules.json (W0-A). Missing = compile with built-in defaults so
    this script stays usable before gate G0 lands the rules file."""
    rules = load_json(RULES_PATH)
    if rules is None:
        print(f"warn: {RULES_PATH.relative_to(DEN)} not found — compiling with "
              "built-in defaults (biome/role/slot validation disabled)")
        return {}
    if verbose:
        print(f"rules: {RULES_PATH.relative_to(DEN)} v{rules.get('version', '?')} "
              f"biomes={_vocab_count(rules, 'biomes')} roles={_vocab_count(rules, 'roles')} "
              f"slots={_vocab_count(rules, 'slots')}")
    return rules


def _vocab(rules: dict, key: str) -> set[str]:
    """Vocabulary names from a rules section, minus its `_doc` prose key."""
    return {k for k in (rules.get(key) or {}) if not k.startswith("_")}


def _vocab_count(rules: dict, key: str) -> int:
    return len(_vocab(rules, key))


# ── geometry helpers ─────────────────────────────────────────────────────────

def as_rect(obj, label: str) -> tuple[int, int, int, int] | None:
    """Accept either {"x","y","w","h"} (placement-rules style) or
    {"rect": [x,y,w,h]} (compact). Returns None if neither is well-formed."""
    if not isinstance(obj, dict):
        return None
    if isinstance(obj.get("rect"), list) and len(obj["rect"]) == 4:
        vals = obj["rect"]
    elif all(k in obj for k in ("x", "y", "w", "h")):
        vals = [obj["x"], obj["y"], obj["w"], obj["h"]]
    else:
        return None
    return tuple(vals) if all(isinstance(v, int) for v in vals) else None


def as_point(obj, label: str) -> tuple[int, int] | None:
    """Accept {"x":..,"y":..} or [x, y]."""
    if isinstance(obj, dict) and isinstance(obj.get("x"), int) and isinstance(obj.get("y"), int):
        return (obj["x"], obj["y"])
    if isinstance(obj, list) and len(obj) == 2 and all(isinstance(v, int) for v in obj):
        return (obj[0], obj[1])
    return None


def snap16(x: int, y: int, w: int, h: int) -> tuple[int, int, int, int]:
    """Snap a rect to the tile grid (origin down, size up) so every patch shares
    one grout lattice — off-grid patches are why ground read as broken seams.
    """
    x0, y0 = (x // TILE) * TILE, (y // TILE) * TILE
    return (x0, y0,
            ((x + w + TILE - 1) // TILE) * TILE - x0,
            ((y + h + TILE - 1) // TILE) * TILE - y0)


# ── validation ───────────────────────────────────────────────────────────────

def validate_spec(spec: dict, rules: dict, catalog: "Catalog") -> tuple[list[str], list[str]]:
    """Structural checks + semantic checks against placement-rules vocabularies.

    Errors abort the compile; warnings print and are ignored. Everything a pass
    later reads is bounds-checked here, so no pass has to defend against bad
    input. Vocabulary checks self-disable when placement-rules.json is absent.
    """
    errs: list[str] = []
    warns: list[str] = []

    for key in ("id", "district", "biome", "bbox"):
        if not spec.get(key):
            errs.append(f"spec.{key} is required")

    bbox = as_rect(spec.get("bbox") or {}, "bbox")
    if bbox is None:
        errs.append("spec.bbox must be {x, y, w, h} ints")
        return errs, warns
    bx, by, bw, bh = bbox
    if bw <= 0 or bh <= 0:
        errs.append("spec.bbox w/h must be positive")
    if bx < 0 or by < 0:
        errs.append("spec.bbox origin is negative")
    if bx + bw > WORLD["w"] or by + bh > WORLD["h"]:
        errs.append(f"spec.bbox exceeds world {WORLD['w']}x{WORLD['h']} (OFFWORLD)")
    if errs:
        return errs, warns
    # Only the ORIGIN must sit on the lattice: pass A snaps sizes up, but an
    # off-grid origin shifts the grout grid and reads as broken seams.
    for name, val in (("x", bx), ("y", by)):
        if val % TILE:
            warns.append(f"spec.bbox.{name}={val} is off the {TILE}px tile grid "
                         "(ground seams will not line up with neighbouring districts)")

    coords = (spec.get("compiler") or {}).get("coords", "world")
    if coords not in ("world", "local"):
        errs.append(f"compiler.coords '{coords}' must be 'world' or 'local'")
    seed = (spec.get("compiler") or {}).get("seed", 0)
    if not isinstance(seed, int):
        errs.append("compiler.seed must be an int")

    biomes, palettes = _vocab(rules, "biomes"), _vocab(rules, "palettes")
    surfaces, slots_v = _vocab(rules, "surfaces"), _vocab(rules, "slots")
    roles, levels = _vocab(rules, "roles"), _vocab(rules, "density")
    verbs = _vocab(rules, "interact")

    if biomes and spec["biome"] not in biomes:
        warns.append(f"biome '{spec['biome']}' is not in placement-rules biomes")
    for key in ("palette", "palette_secondary"):
        if spec.get(key) and palettes and spec[key] not in palettes:
            warns.append(f"{key} '{spec[key]}' is not in placement-rules palettes")

    # surfaces[] — the ground plan.
    if not (spec.get("surfaces") or []):
        errs.append("spec.surfaces[] is required (the district needs ground, "
                    "or every solid lands FLOATING)")
    for i, srf in enumerate(spec.get("surfaces") or []):
        name = srf.get("surface")
        if not name:
            errs.append(f"surfaces[{i}].surface is required")
        elif surfaces and name not in surfaces:
            errs.append(f"surfaces[{i}].surface '{name}' is not a placement-rules surface")
        elif not surfaces and name not in PAINTABLE_TILES and name != "water":
            errs.append(f"surfaces[{i}].surface '{name}' is not renderable")
        errs += _rect_errors(f"surfaces[{i}]", srf, bbox, coords)
        if name == "water" and not srf.get("anim"):
            warns.append(f"surfaces[{i}] is water with no `anim` sheet — "
                         "pass A can only reserve it, not render it")

    # slots[] — scatter targets.
    slot_names = set()
    for i, slot in enumerate(spec.get("slots") or []):
        arch = slot.get("slot")
        if not arch:
            errs.append(f"slots[{i}].slot (archetype) is required")
        elif slots_v and arch not in slots_v:
            errs.append(f"slots[{i}].slot '{arch}' is not a placement-rules slot archetype")
        sid = slot.get("name") or arch
        if sid in slot_names:
            errs.append(f"slots[{i}] name '{sid}' is duplicated; give each slot a unique `name`")
        slot_names.add(sid)
        if as_rect(slot, "") is not None:
            errs += _rect_errors(f"slots[{i}]", slot, bbox, coords)
        elif not (slot.get("surface") or slot.get("between")):
            errs.append(f"slots[{i}] needs a rect, a `surface`, or `between` "
                        "(nothing to derive its area from)")
        if slot.get("surface") and surfaces and slot["surface"] not in surfaces:
            errs.append(f"slots[{i}].surface '{slot['surface']}' is not a placement-rules surface")
        for role, level in (slot.get("density") or {}).items():
            if roles and role not in roles:
                errs.append(f"slots[{i}].density role '{role}' is not a placement-rules role")
            if levels and level not in levels:
                errs.append(f"slots[{i}].density.{role} level '{level}' is not one of "
                            f"{sorted(levels)}")

    # landmarks[] — pinned anchors.
    for i, lm in enumerate(spec.get("landmarks") or []):
        if not (lm.get("me") or lm.get("exs") or lm.get("grp")):
            errs.append(f"landmarks[{i}] needs one of me / exs / grp")
        at = as_point(lm.get("at"), "")
        if at is None:
            errs.append(f"landmarks[{i}].at must be {{x, y}} ints")
        else:
            errs += _point_errors(f"landmarks[{i}].at", at, bbox, coords)
        if lm.get("me") and catalog.ready and catalog.footprint(me=lm["me"]) is None:
            errs.append(f"landmarks[{i}].me '{lm['me']}' is not in the placement index "
                        "(merge would fail to resolve it)")
        if lm.get("grp") and not _recipe_path(lm["grp"]).exists():
            warns.append(f"landmarks[{i}].grp '{lm['grp']}' has no recipe yet (W1-C)")
        if lm.get("interact") and verbs and lm["interact"] not in verbs:
            warns.append(f"landmarks[{i}].interact '{lm['interact']}' is not a known verb")

    # groups[] — recipe placements.
    for i, grp in enumerate(spec.get("groups") or []):
        if not grp.get("grp"):
            errs.append(f"groups[{i}].grp is required")
        elif not _recipe_path(grp["grp"]).exists():
            warns.append(f"groups[{i}].grp '{grp['grp']}' has no recipe yet (W1-C)")
        if grp.get("slot") and slot_names and grp["slot"] not in slot_names:
            errs.append(f"groups[{i}].slot '{grp['slot']}' is not a declared slot")
        if not isinstance(grp.get("count", 1), int) or grp.get("count", 1) < 1:
            errs.append(f"groups[{i}].count must be a positive int")

    for verb, targets in (spec.get("interactions") or {}).items():
        if verbs and verb not in verbs:
            warns.append(f"interactions.{verb} is not a placement-rules verb")
        if not (targets == "auto" or isinstance(targets, list)):
            errs.append(f"interactions.{verb} must be 'auto' or a list of ids")

    for i, kc in enumerate((spec.get("constraints") or {}).get("keep_clear") or []):
        errs += _rect_errors(f"constraints.keep_clear[{i}]", kc, bbox, coords)

    for i, road in enumerate(spec.get("roads") or []):
        errs += _rect_errors(f"roads[{i}]", road, bbox, coords)

    for key in (spec.get("passes") or {}):
        if key not in PASS_KEYS:
            warns.append(f"passes.{key} is not a known pass ({', '.join(PASS_KEYS)})")

    return errs, warns


def _rect_errors(label: str, obj, bbox, coords: str) -> list[str]:
    rect = as_rect(obj, label)
    if rect is None:
        return [f"{label} needs a rect: {{x, y, w, h}} or {{rect: [x, y, w, h]}} ints"]
    x, y, w, h = rect
    if w <= 0 or h <= 0:
        return [f"{label} has non-positive size"]
    bx, by, bw, bh = bbox
    if coords == "world":
        x, y = x - bx, y - by
    if x < 0 or y < 0 or x + w > bw or y + h > bh:
        return [f"{label} {rect} escapes the district bbox ({bw}x{bh}, coords={coords})"]
    return []


def _point_errors(label: str, point, bbox, coords: str) -> list[str]:
    x, y = point
    bx, by, bw, bh = bbox
    if coords == "world":
        x, y = x - bx, y - by
    if not (0 <= x <= bw and 0 <= y <= bh):
        return [f"{label} {point} is outside the district bbox (coords={coords})"]
    return []


def _recipe_path(grp_id: str) -> Path:
    return GROUPS_DIR / f"{grp_id}.json"


# ── catalog footprints ───────────────────────────────────────────────────────

class Catalog:
    """Compile-time footprint oracle.

    Sizes come from the catalog (`placement-index.json` carries every Single's
    w/h), NOT from opening PNGs — so a compile stays fast and needs no PIL.
    """

    def __init__(self) -> None:
        index = load_json(INDEX_PATH) or {}
        self.me = index.get("me") or {}
        self.exs = index.get("exs") or {}
        self._variants: dict | None = None
        self.misses: list[str] = []

    @property
    def ready(self) -> bool:
        return bool(self.me or self.exs)

    def _variant_list(self, me_id: str) -> list[dict]:
        if self._variants is None:
            self._variants = (load_json(ME_TO_SINGLES) or {}).get("links") or {}
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
                if low in (v.get("path") or v.get("basename") or "").lower():
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

    def __init__(self, bbox: tuple[int, int, int, int]) -> None:
        self.x0, self.y0, w, h = bbox
        self.cw = (w + TILE - 1) // TILE
        self.ch = (h + TILE - 1) // TILE
        self.flags = bytearray(self.cw * self.ch)
        self.surface: list[str | None] = [None] * (self.cw * self.ch)
        self.solid_rects: list[tuple[int, int, int, int]] = []

    def _cells(self, rect):
        x, y, w, h = rect
        cx0 = max(0, (x - self.x0) // TILE)
        cy0 = max(0, (y - self.y0) // TILE)
        cx1 = min(self.cw - 1, (x + w - 1 - self.x0) // TILE)
        cy1 = min(self.ch - 1, (y + h - 1 - self.y0) // TILE)
        for cy in range(cy0, cy1 + 1):
            row = cy * self.cw
            for cx in range(cx0, cx1 + 1):
                yield row + cx

    def paint_surface(self, rect, surface: str) -> None:
        for i in self._cells(rect):
            self.surface[i] = surface

    def surface_at(self, px: int, py: int) -> str | None:
        cx, cy = (px - self.x0) // TILE, (py - self.y0) // TILE
        if not (0 <= cx < self.cw and 0 <= cy < self.ch):
            return None
        return self.surface[cy * self.cw + cx]

    def surfaces_under(self, rect) -> set[str | None]:
        return {self.surface[i] for i in self._cells(rect)}

    def cells_of_surface(self, surface: str) -> list[int]:
        return [i for i, s in enumerate(self.surface) if s == surface]

    def mark(self, rect, flag: int) -> None:
        for i in self._cells(rect):
            self.flags[i] |= flag

    def mark_cells(self, cells, flag: int) -> None:
        for i in cells:
            self.flags[i] |= flag

    def is_free(self, rect, blocked: int = RESERVED | SOLID) -> bool:
        return all(not (self.flags[i] & blocked) for i in self._cells(rect))

    def free_cells(self, cells, blocked: int = RESERVED | SOLID) -> list[int]:
        return [i for i in cells if not (self.flags[i] & blocked)]

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
        total = self.cw * self.ch
        occupied = sum(1 for f in self.flags if f & (SOLID | DECOR))
        return {
            "cells": total,
            "occupied_cells": occupied,
            "reserved_cells": sum(1 for f in self.flags if f & RESERVED),
            "unwalkable_cells": sum(1 for f in self.flags if f & UNWALKABLE),
            "free_ratio": round(1 - occupied / total, 3) if total else 0,
        }


# ── compile context ──────────────────────────────────────────────────────────

class Ctx:
    def __init__(self, spec: dict, rules: dict, catalog: Catalog, seed: int,
                 verbose: bool = False) -> None:
        self.spec = spec
        self.rules = rules
        self.cat = catalog
        self.bbox = as_rect(spec["bbox"], "bbox")
        self.coords = (spec.get("compiler") or {}).get("coords", "world")
        self.occ = Occupancy(self.bbox)
        self.seed = seed
        self.verbose = verbose
        self.frag: dict[str, list] = {k: [] for k in FRAGMENT_LISTS}
        self.stats: dict[str, dict] = {}
        self.slot_cells: dict[str, list[int]] = {}   # slot name → cell indices

    def rng(self, pass_letter: str, salt: str = "") -> random.Random:
        """One deterministic stream per pass (and per slot/recipe), so adding a
        pass never reshuffles what earlier passes already placed."""
        return random.Random(f"{self.seed}:{self.spec['id']}:{pass_letter}:{salt}")

    def rect(self, obj) -> tuple[int, int, int, int]:
        """Spec rect → world rect, honouring compiler.coords."""
        x, y, w, h = as_rect(obj, "")
        if self.coords == "local":
            x, y = x + self.bbox[0], y + self.bbox[1]
        return (x, y, w, h)

    def point(self, obj) -> tuple[int, int]:
        x, y = as_point(obj, "")
        if self.coords == "local":
            x, y = x + self.bbox[0], y + self.bbox[1]
        return (x, y)

    def surface_rule(self, surface: str) -> dict:
        return ((self.rules.get("surfaces") or {}).get(surface)) or {}

    def density_rule(self, level: str) -> dict:
        return ((self.rules.get("density") or {}).get(level)) or {}

    def slot_rule(self, archetype: str) -> dict:
        return ((self.rules.get("slots") or {}).get(archetype)) or {}

    def pass_cfg(self, key: str) -> dict:
        return (self.spec.get("passes") or {}).get(key) or {}

    def enabled(self, key: str) -> bool:
        return self.pass_cfg(key).get("enabled", True)


# ── passes ───────────────────────────────────────────────────────────────────

def pass_a_ground(ctx: Ctx) -> dict:
    """A — Ground. `surfaces[]` become patches (paintable tiles) or animBands
    (water), plus the surface map every later pass queries. Runs first so
    nothing can end up FLOATING and no pass has to guess what it stands on.
    """
    patches = water = 0
    for srf in ctx.spec.get("surfaces") or []:
        name = srf["surface"]
        rect = snap16(*ctx.rect(srf))
        rule = ctx.surface_rule(name)
        depth = srf.get("depth", rule.get("default_depth", 0.9))
        ctx.occ.paint_surface(rect, name)

        if name in PAINTABLE_TILES:
            ctx.frag["patches"].append({"tile": name, "x": rect[0], "y": rect[1],
                                        "w": rect[2], "h": rect[3], "depth": depth})
            patches += 1
        else:
            # Not a paintable tile (water): reserve it and let pass H animate it.
            ctx.occ.mark(rect, UNWALKABLE | RESERVED)
            water += 1
        if rule.get("walkable") is False:
            ctx.occ.mark(rect, UNWALKABLE | RESERVED)

    return {"patches": patches, "unpaintable_surfaces": water}


def pass_b_skeleton(ctx: Ctx) -> dict:
    """B — Skeleton. Circulation and slot geometry, before anything can block
    it: keep-clear reservations, district roads, and resolving each declared
    slot into the concrete cell set that passes E-G scatter into.
    """
    kept = 0
    for kc in (ctx.spec.get("constraints") or {}).get("keep_clear") or []:
        ctx.occ.mark(ctx.rect(kc), RESERVED)
        kept += 1

    roads = 0
    for road in ctx.spec.get("roads") or []:
        x, y, w, h = ctx.rect(road)
        ctx.frag["roads"].append({"x": x, "y": y, "w": w, "h": h})
        # Reserve the lane plus a tile of shoulder so no later pass can drop a
        # solid into traffic (ROADBLOCK).
        ctx.occ.mark((x - TILE, y - TILE, w + 2 * TILE, h + 2 * TILE), RESERVED)
        roads += 1

    resolved = {}
    for slot in ctx.spec.get("slots") or []:
        name = slot.get("name") or slot["slot"]
        rule = ctx.slot_rule(slot["slot"])
        if as_rect(slot, "") is not None:
            cells = list(ctx.occ._cells(ctx.rect(slot)))
        elif slot.get("surface"):
            cells = ctx.occ.cells_of_surface(slot["surface"])
        else:
            # TODO(W2-A): `between: [a, b]` / derived_from surface_boundary —
            # walk the surface map for cells of A adjacent to B and dilate by
            # the archetype's band_px. Skipped for now, so shore_line-style
            # slots resolve empty rather than wrong.
            cells = []
        ctx.slot_cells[name] = ctx.occ.free_cells(cells)
        resolved[name] = {"archetype": slot["slot"], "cells": len(ctx.slot_cells[name]),
                          "derived_from": rule.get("derived_from")}

    # TODO(W2-A): auto-route paths between district entrances and landmark
    # anchors (A* over free cells), emit them as patches and reserve the
    # corridor. Today only spec-declared keep_clear/roads are honoured.
    return {"keep_clear": kept, "roads": roads, "slots": resolved}


def pass_c_landmarks(ctx: Ctx) -> dict:
    """C — Landmarks. Pinned hero objects from `landmarks[]`, largest footprint
    first. Big, inflexible pieces claim space before anything small can box
    them out; `pin: true` means the anchor is authoritative and must not drift.
    """
    # TODO(W2-A): resolve me/exs → footprint via ctx.cat, snap the anchor to the
    # accepted surface, reject when ctx.occ.overlap_ratio() exceeds the rules'
    # reject_on overlap threshold, claim with an entrance halo, then emit
    # {me, prefer?, x, y, origin, solid}.
    return {"placed": 0, "pending": len(ctx.spec.get("landmarks") or []), "todo": True}


def pass_d_groups(ctx: Ctx) -> dict:
    """D — Groups. Expand `grp.*` recipes (volley court, campfire set, station
    stairs) as ATOMIC multi-stamp assemblies: all members land at their
    recipe-relative tile offsets, or the whole group is rejected. Fixes mistake
    #1 (stamp collage instead of composed scenes) and coverage tier D (fragment
    Singles must never be stamped solo).

    Placement is W2-A's job. This pass currently only PRE-VALIDATES each recipe
    so the handoff cannot fail on data problems: every piece must resolve in the
    catalog and every offset must fit the declared footprint.
    """
    wanted = 0
    checked = 0
    problems: list[str] = []
    for entry in ctx.spec.get("groups") or []:
        wanted += entry.get("count", 1)
        recipe = load_json(_recipe_path(entry["grp"]))
        if recipe is None:
            continue
        checked += 1
        fp = recipe.get("footprint_tiles") or {}
        for piece in recipe.get("pieces") or []:
            if not ctx.cat.footprint(me=piece.get("me"), exs=piece.get("exs")):
                problems.append(f"{entry['grp']}:{piece.get('role')} unresolvable")
            dx, dy = piece.get("dx", 0), piece.get("dy", 0)
            pw = (piece.get("w") or TILE + TILE - 1) // TILE
            ph = (piece.get("h") or TILE + TILE - 1) // TILE
            if fp.get("w") and (dx + pw > fp["w"] or dy + ph > fp["h"]):
                problems.append(f"{entry['grp']}:{piece.get('role')} "
                                f"offset ({dx},{dy}) escapes footprint "
                                f"{fp.get('w')}x{fp.get('h')} tiles")

    # TODO(W2-A): for each entry, sample `count` anchors from the slot's free
    # cells, test the recipe's union footprint via ctx.occ.overlap_ratio(), then
    # emit every piece at anchor + (dx, dy) * TILE with the piece's origin/solid.
    stats = {"groups": 0, "stamps": 0, "pending": wanted,
             "recipes_checked": checked, "recipes_available": _count_recipes(),
             "todo": True}
    if problems:
        stats["recipe_problems"] = problems[:10]
    return stats


def pass_e_props(ctx: Ctx) -> dict:
    """E — Props. Per-slot scatter of role-matched, surface-matched props at the
    slot's per-role density level (sparse…packed → target_coverage, spacing
    multiplier, jitter). Variant choice is coverage-aware so a district spends
    unused Singles instead of repeating the same six PNGs (mistake #2).
    """
    # TODO(W2-A): candidate pool = enriched me.* (W1-A) filtered by biome
    # forbid_tags, the slot archetype's roles and the surface's roles_allowed;
    # sample anchors from ctx.rng('E', slot_name) over ctx.slot_cells.
    return {"placed": 0, "slots": len(ctx.slot_cells), "todo": True}


def pass_f_canopy(ctx: Ctx) -> dict:
    """F — Canopy. Overhead cover (palms, parasols, awnings, tents) last among
    the solids: it overhangs what pass E placed, so it must see the ground props
    to avoid burying an interactable or blocking a sightline. The rules give
    canopy `layer: overhead` with a y-sort depth bias, and its tile stays
    walkable — so it claims CLEAR, not SOLID.
    """
    # TODO(W2-A): place on CLEAR-tolerant cells at the role's spacing_px scaled
    # by the density level's min_spacing_mult; keep the shade inside the slot.
    return {"placed": 0, "todo": True}


def pass_g_detail(ctx: Ctx) -> dict:
    """G — Detail. High-count, zero-collision dressing (shells, starfish, sand
    holes, litter, decals) into cells that are still empty. Claims DECOR only
    and never sets `solid`, so it cannot create an OVERLAP defect.
    """
    # TODO(W2-A): fill to the density level's target_coverage over free cells.
    return {"placed": 0, "todo": True}


def pass_h_life(ctx: Ctx) -> dict:
    """H — Life. Anims, animBands (water/shore), vehicles, labels, portals, NPC
    anchors and `interact` verbs on the stamps C-G chose. Runs last because
    interaction attaches to objects earlier passes selected.
    """
    label = ctx.spec.get("label")
    if label:
        at = ctx.spec.get("label_at") or {"x": ctx.bbox[2] // 2, "y": 24}
        lx, ly = ctx.point(at) if ctx.coords == "local" else as_point(at, "")
        ctx.frag["labels"].append({"x": lx, "y": ly, "text": label})

    bad = []
    for anim in ctx.spec.get("anims") or []:
        x, y = ctx.point(anim.get("at") or anim)
        entry = {"sheet": anim["sheet"], "fw": anim.get("fw", 16), "fh": anim.get("fh", 16),
                 "x": x, "y": y, "fps": anim.get("fps", 4)}
        if anim.get("depth") is not None:
            entry["depth"] = anim["depth"]
        bad += _anim_frame_errors(entry)
        ctx.frag["anims"].append(entry)

    # Water surfaces declared in pass A become animated bands here.
    for srf in ctx.spec.get("surfaces") or []:
        if srf["surface"] in PAINTABLE_TILES or not srf.get("anim"):
            continue
        x, y, w, h = snap16(*ctx.rect(srf))
        rule = ctx.surface_rule(srf["surface"])
        band = {"sheet": srf["anim"], "fw": srf.get("fw", 64), "fh": srf.get("fh", 64),
                "x": x, "y": y, "w": w, "h": h, "fps": srf.get("fps", 5),
                "depth": srf.get("depth", rule.get("default_depth", 0.95))}
        if srf.get("shore"):
            band["shore"] = srf["shore"]
        bad += _anim_frame_errors(band)
        ctx.frag["animBands"].append(band)

    for name in bad:
        print(f"warn: anim sheet {name}")

    # TODO(W4-A): attach interact verbs from spec.interactions to the stamps
    # placed by C-G ('auto' = every stamp whose role/tags match the verb's
    # rules entry), and emit npc_anchor spawn hints.
    return {"labels": len(ctx.frag["labels"]), "anims": len(ctx.frag["anims"]),
            "animBands": len(ctx.frag["animBands"]),
            "interactions_pending": len(ctx.spec.get("interactions") or {}), "todo": True}


def _anim_frame_errors(entry: dict) -> list[str]:
    """Pre-empt the BADANIM defect: sheet must exist and divide by fw/fh.
    Uses PIL only if it is installed — footprints never need it."""
    path = ASSETS / entry["sheet"].replace("/", os.sep)
    if not path.exists():
        return [f"{entry['sheet']} not found"]
    try:
        from PIL import Image
    except ImportError:
        return []
    with Image.open(path) as im:
        w, h = im.size
    if w % entry["fw"] or h % entry["fh"]:
        return [f"{entry['sheet']} is {w}x{h}, not divisible by "
                f"{entry['fw']}x{entry['fh']} (BADANIM)"]
    return []


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


# ── emit ─────────────────────────────────────────────────────────────────────

def compile_spec(spec: dict, rules: dict, catalog: Catalog, seed: int,
                 only: set[str] | None = None, verbose: bool = False) -> tuple[dict, Ctx]:
    ctx = Ctx(spec, rules, catalog, seed, verbose=verbose)

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

    bx, by, bw, bh = ctx.bbox
    frag = {
        "_doc": f"GENERATED by scripts/compile-exterior-district.py from "
                f"{spec.get('_spec_path', 'spec')} — do not hand-edit; "
                f"edit the spec and recompile.",
        "district": spec["district"],
        "id": spec["id"],
        "biome": spec["biome"],
        "bbox": {"x": bx, "y": by, "w": bw, "h": bh},
        "_compiled": {
            # No timestamp on purpose: same spec + seed + catalog must produce a
            # byte-identical fragment, so recompiles show no diff noise.
            "spec": spec.get("_spec_path"),
            "seed": seed,
            "rules_version": rules.get("version"),
            "coords": ctx.coords,
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
    ap.add_argument("--out", help="fragment output path (default: compiler.out, else "
                                 "data/city-specs/generated/<id>.json)")
    ap.add_argument("--seed", type=int, help="override compiler.seed (deterministic compile)")
    ap.add_argument("--passes", help="comma-separated subset, e.g. A_ground,B_skeleton")
    ap.add_argument("--validate-only", action="store_true", help="check the spec, emit nothing")
    ap.add_argument("--dry-run", action="store_true", help="compile but do not write the fragment")
    ap.add_argument("--qa", action="store_true", help="run check-city-plan.py on the fragment")
    ap.add_argument("--stats-json", help="also write the _compiled stats block here")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    spec_path = Path(args.spec)
    if not spec_path.is_absolute() and not spec_path.exists():
        spec_path = DEN / spec_path
    spec = load_json(spec_path)
    if spec is None:
        print(f"error: spec not found: {args.spec}", file=sys.stderr)
        return 2
    try:
        spec["_spec_path"] = str(spec_path.resolve().relative_to(DEN)).replace(os.sep, "/")
    except ValueError:
        spec["_spec_path"] = str(spec_path)

    rules = load_rules(verbose=args.verbose)
    catalog = Catalog()
    if not catalog.ready:
        print(f"warn: {INDEX_PATH.relative_to(DEN)} missing — footprints unavailable; "
              "run `python3 scripts/resolve_limezu_me_stamps.py` first")

    errs, warns = validate_spec(spec, rules, catalog)
    for w in warns:
        print(f"warn: {w}")
    if errs:
        for e in errs:
            print(f"error: {e}", file=sys.stderr)
        print(f"spec INVALID: {len(errs)} error(s)", file=sys.stderr)
        return 1
    bx, by, bw, bh = as_rect(spec["bbox"], "bbox")
    print(f"spec OK: {spec['id']} ({spec['district']}) biome={spec['biome']} "
          f"{bw}x{bh} @({bx},{by})")
    if args.validate_only:
        return 0

    seed = args.seed if args.seed is not None else (spec.get("compiler") or {}).get("seed", 0)
    only = {p.strip() for p in args.passes.split(",")} if args.passes else None
    frag, ctx = compile_spec(spec, rules, catalog, seed, only=only, verbose=args.verbose)

    counts = {k: len(frag[k]) for k in FRAGMENT_LISTS if frag[k]}
    print(f"compiled seed={seed}: {counts or 'empty fragment'}")
    todo = [k for k, v in ctx.stats.items() if v.get("todo")]
    if todo:
        print(f"stub passes (no fill logic yet): {', '.join(todo)}")
    if ctx.cat.misses:
        print(f"catalog misses: {len(set(ctx.cat.misses))}")

    out = Path(args.out) if args.out else None
    if out is None:
        declared = (spec.get("compiler") or {}).get("out")
        out = (DEN / declared) if declared else DEFAULT_OUT_DIR / f"{spec['id']}.json"
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
