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
ENRICHED_PATH = CAT / "me-placement-enriched.jsonl"  # W1-A role/biome per me.*
PALETTE_MAP_PATH = CAT / "variant-palette-map.json"  # W1-B colour → palette
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

# Overlap a fill pass refuses, as a fraction of the smaller sprite.
# check-city-plan.py flags 0.35, so rejecting above 0.30 leaves the merge's own
# nudges some headroom before a compiled district can go dirty.
OVERLAP_REJECT = 0.30
# Runtime collider height for `solid: true` (src/full-world.js clamps a stamp's
# collision box to a 24px band at its baseline), so that — not the whole sprite
# rect — is what a fill pass claims on the occupancy grid.
COLLIDER_PX = 24
DENSITY_LEVELS = ("sparse", "light", "medium", "dense", "packed")

# Tier-D guard: ids that only read correctly inside a grp.* recipe. The
# enrichment's `group_only` catches most; these tokens catch the modular
# autotile pieces, sheet examples and bare shadows it does not.
TIER_D_TOKENS = ("modular", "example", "_lines", "_line_", "segment", "shadow")

# Roles whose usable pool is filed under a broader role by the enrichment: a
# pool float is `decor_small`, a parasol `furniture_ext`. A fallback row must
# still carry one of the requested role's own `tags_any`, so a bucket never
# becomes a water_prop.
ROLE_FALLBACKS = {
    "water_prop": ("decor_small", "vehicle"),
    "canopy": ("furniture_ext", "decor_small"),
}


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


def sprite_rect(x: int, y: int, w: int, h: int, origin: str) -> tuple[int, int, int, int]:
    """The world rect a stamp's PNG will cover. Mirrors src/full-world.js and
    check-city-plan.py exactly, so the compiler's overlap test and the QA gate
    measure the same pixels."""
    if origin == "tl":
        return (x, y, w, h)
    if origin == "bc":
        return (x - w // 2, y - h, w, h)
    return (x, y - h, w, h)          # bl (default): baseline placement


def collider_rect(rect: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """The band a `solid: true` stamp actually blocks: full width, 24px at the
    baseline. A palm's canopy overhangs; only its trunk row is occupied."""
    x, y, w, h = rect
    band = min(h, COLLIDER_PX)
    return (x, y + h - band, w, band)


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

    def variants(self, me_id: str) -> list[dict]:
        """Every Single linked to a `me.*`, in catalog order (deterministic)."""
        return self._variant_list(me_id)

    def knows(self, me: str | None = None, exs: str | None = None) -> bool:
        """Is this id resolvable? Unlike footprint() this does NOT record a miss —
        a fill pass probing thousands of catalog ids for a pool is not a defect.
        """
        if exs:
            return exs in self.exs
        entry = self.me.get(me or "")
        return bool(entry and entry.get("exs") in self.exs)

    def single_id(self, me: str | None = None, exs: str | None = None,
                  prefer: str | None = None) -> str | None:
        """The exs.* a stamp will resolve to — the unit coverage counts."""
        if exs:
            return exs
        entry = self.me.get(me or "")
        if not entry:
            return None
        if prefer:
            low = prefer.lower()
            for v in self._variant_list(me or ""):
                if low in (v.get("path") or v.get("basename") or "").lower():
                    return v.get("id") or entry.get("exs")
        return entry.get("exs")

    def img(self, me: str | None = None, exs: str | None = None,
            prefer: str | None = None) -> str | None:
        """The PNG path merge-city-plan.py will resolve a stamp to. Used only by
        --qa, which needs `img` to hand the fragment to check-city-plan.py."""
        single = self.single_id(me=me, exs=exs, prefer=prefer)
        entry = self.exs.get(single or "")
        if entry and entry.get("img"):
            return entry["img"]
        return (self.me.get(me or "") or {}).get("img")

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


# ── candidate pool ───────────────────────────────────────────────────────────

class Pool:
    """The scatter passes' asset oracle: enriched `me.*` rows (W1-A) filtered to
    a (biome, role, surface) triple, plus palette-scored variant choice (W1-B).

    Nothing here knows about coordinates. It answers two questions only: *which
    ids may stand here*, and *which Single of that id best fits the district's
    colour story and has not been spent yet*.
    """

    def __init__(self, catalog: Catalog, rules: dict) -> None:
        self.cat = catalog
        self.rules = rules
        self._rows: dict[str, dict] | None = None
        self._by_role: dict[str, list[dict]] = {}
        self._palettes: dict | None = None
        self._tokens: list[str] | None = None

    # -- data -----------------------------------------------------------------

    def _load(self) -> None:
        if self._rows is not None:
            return
        self._rows = {}
        if not ENRICHED_PATH.exists():
            return
        for line in ENRICHED_PATH.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            self._rows[row["me"]] = row
            self._by_role.setdefault(row.get("role") or "?", []).append(row)

    @property
    def ready(self) -> bool:
        self._load()
        return bool(self._rows)

    def row(self, me_id: str) -> dict:
        self._load()
        return (self._rows or {}).get(me_id) or {}

    def _palette_tokens(self) -> tuple[dict, list[str]]:
        if self._palettes is None:
            pmap = load_json(PALETTE_MAP_PATH) or {}
            self._palettes = pmap.get("palettes") or (self.rules.get("palettes") or {})
            self._tokens = (pmap.get("color_tokens")
                            or self.rules.get("color_tokens") or [])
        return self._palettes, (self._tokens or [])

    # -- filtering ------------------------------------------------------------

    def _role_rule(self, role: str) -> dict:
        return ((self.rules.get("roles") or {}).get(role)) or {}

    def _surface_rule(self, surface: str) -> dict:
        return ((self.rules.get("surfaces") or {}).get(surface)) or {}

    def surface_allows(self, surface: str, role: str) -> bool:
        """Both directions of the surface contract: the role accepts the surface
        and the surface accepts the role."""
        role_surfaces = self._role_rule(role).get("surfaces")
        if role_surfaces is not None and surface not in role_surfaces:
            return False
        allowed = self._surface_rule(surface).get("roles_allowed")
        return allowed is None or role in allowed

    def row_fits_surface(self, row: dict, surface: str) -> bool:
        """A row's own primary surface is a hard constraint only across the
        walkable/unwalkable line: a pool float must stay on water and a sand
        mound must stay off it, but a sunbed filed under `grass` is fine on sand.
        """
        prim = row.get("surface")
        if prim and self._surface_rule(prim).get("walkable") is False:
            return prim == surface
        return self._surface_rule(surface).get("walkable") is not False

    def _tier_d(self, row: dict) -> bool:
        if row.get("group_only"):
            return True
        tags = set(row.get("tags") or [])
        if tags & {"modular", "example", "corner", "middle", "side"}:
            return True
        return any(tok in row["me"] for tok in TIER_D_TOKENS)

    def candidates(self, biome: str, role: str, surface: str, *,
                   forbid_tags=(), palettes=(), exclude=()) -> list[dict]:
        """Rows that may be scattered as `role` on `surface` in `biome`.

        A row keeps its own primary surface as a hard constraint only when that
        surface is unwalkable (a pool float must stay on water); otherwise the
        role's rules entry decides, which is what lets a sunbed filed under
        `grass` land on the beach.
        """
        self._load()
        if not self._rows or not self.surface_allows(surface, role):
            return []
        want = self._role_rule(role)
        want_tags = set(want.get("tags_any") or [])
        forbid = set(forbid_tags)
        roles = [role] + [r for r in ROLE_FALLBACKS.get(role, ()) if r != role]
        out: list[dict] = []
        for src in roles:
            for row in self._by_role.get(src, []):
                me_id = row["me"]
                if me_id in exclude or self._tier_d(row):
                    continue
                if not (biome in (row.get("biomes_allowed") or [])
                        or row.get("biome_primary") == "universal"):
                    continue
                tags = set(row.get("tags") or [])
                if tags & forbid:
                    continue
                # A fallback role has to earn the promotion with a matching tag.
                if src != role and want_tags and not (tags & want_tags):
                    continue
                if not self.row_fits_surface(row, surface):
                    continue
                if not self.cat.knows(me=me_id):
                    continue
                out.append(row)
        # A district reads as one place when its props share a colour story, so
        # the palettes are tiers, not a set: fall back to the secondary palette
        # only when the primary has nothing to offer. Mixing them is how a beach
        # ends up with pine trees on it (they score on `festive_market`).
        for palette in palettes:
            aligned = [r for r in out
                       if palette in (r.get("palette_affinity") or ())]
            if aligned:
                out = aligned
                break
        out.sort(key=lambda r: r["me"])
        return out

    # -- variant choice -------------------------------------------------------

    def palette_score(self, text: str, palettes) -> float:
        """How well a Single's colour tokens fit the district palette order."""
        pal_defs, tokens = self._palette_tokens()
        low = text.lower()
        found = [t for t in tokens if t in low]
        if not found:
            return 0.35            # colourless / neutral art: never penalised
        best = 0.0
        for rank, name in enumerate(palettes):
            spec = pal_defs.get(name) or {}
            weights = spec.get("token_weights") or spec.get("tokens") or {}
            avoid = set(spec.get("avoid") or [])
            fade = 1.0 if rank == 0 else 0.6
            for tok in found:
                if tok in avoid:
                    best = max(best, -0.5)
                else:
                    best = max(best, fade * float(weights.get(tok, 0.1)))
        return best

    def pick_single(self, me_id: str, palettes, used: set[str],
                    rng: random.Random) -> tuple[str | None, tuple[int, int]]:
        """Pick the Single to stamp for `me_id`: same footprint as the id's
        canonical variant (so a 'Grey_Shell' family never yields a signboard),
        palette-scored, and biased hard toward Singles the district has not spent
        yet — that is how a compile grows coverage instead of repeating six PNGs.

        Returns (`prefer` basename or None, (w, h)).
        """
        base = self.cat.footprint(me=me_id) or (TILE, TILE)
        variants = [v for v in self.cat.variants(me_id)
                    if (v.get("w"), v.get("h")) == base]
        if not variants:
            return (None, base)
        scored = []
        for v in variants:
            name = v.get("basename") or v.get("id") or ""
            score = self.palette_score(name, palettes)
            if v.get("id") in used:
                score -= 1.0
            scored.append((score + rng.random() * 1e-3, name, v))
        scored.sort(key=lambda t: (-t[0], t[1]))
        chosen = scored[0][2]
        prefer = chosen.get("basename") if len(variants) > 1 else None
        return (prefer, base)


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

    def cell_origin(self, i: int) -> tuple[int, int]:
        """World top-left of cell `i`."""
        return (self.x0 + (i % self.cw) * TILE, self.y0 + (i // self.cw) * TILE)

    def cell_at(self, px: int, py: int) -> int | None:
        cx, cy = (px - self.x0) // TILE, (py - self.y0) // TILE
        if not (0 <= cx < self.cw and 0 <= cy < self.ch):
            return None
        return cy * self.cw + cx

    def neighbours(self, i: int):
        cx, cy = i % self.cw, i // self.cw
        for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            if 0 <= nx < self.cw and 0 <= ny < self.ch:
                yield ny * self.cw + nx

    def claim(self, rect, flag: int = SOLID, halo: int = 0) -> None:
        self.mark(rect, flag)
        if flag & SOLID:
            self.solid_rects.append(tuple(rect))
        if halo:
            x, y, w, h = rect
            self.mark((x - halo, y - halo, w + 2 * halo, h + 2 * halo), CLEAR)

    def claim_stamp(self, rect, flag: int = SOLID, halo: int = 0) -> None:
        """Claim a stamp: its collider band takes the cells, but the FULL sprite
        rect is what overlap_ratio() (and therefore the QA gate) compares. Keeping
        those two apart is why a 64x80 palm costs one tile row instead of five.
        """
        self.mark(collider_rect(rect) if flag & SOLID else rect, flag)
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
        self.slot_cells: dict[str, list[int]] = {}   # slot name → free cells
        self.slots: dict[str, dict] = {}             # slot name → resolved slot
        self.pool = Pool(catalog, rules)
        # What C-G actually placed, in order: the stamp dict itself (so pass H
        # can attach an interact verb to it) plus the metadata H needs to decide.
        self.placed: list[dict] = []
        self.used_singles: set[str] = set()
        self.used_me: dict[str, int] = {}
        self.anchors: dict[str, list[tuple[int, int]]] = {}   # role key → anchors

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

    def role_rule(self, role: str) -> dict:
        return ((self.rules.get("roles") or {}).get(role)) or {}

    def density_rule(self, level: str) -> dict:
        return ((self.rules.get("density") or {}).get(level)) or {}

    def slot_rule(self, archetype: str) -> dict:
        return ((self.rules.get("slots") or {}).get(archetype)) or {}

    def pass_cfg(self, key: str) -> dict:
        return (self.spec.get("passes") or {}).get(key) or {}

    def enabled(self, key: str) -> bool:
        return self.pass_cfg(key).get("enabled", True)

    # -- spec-declared vocabulary --------------------------------------------

    def biome_rule(self) -> dict:
        return ((self.rules.get("biomes") or {}).get(self.spec["biome"])) or {}

    def forbid_tags(self) -> tuple[str, ...]:
        return tuple(self.biome_rule().get("forbid_tags") or ())

    def palettes(self) -> tuple[str, ...]:
        """Palette preference order: primary first, then secondary."""
        return tuple(p for p in (self.spec.get("palette"),
                                 self.spec.get("palette_secondary")) if p)

    def constraint(self, key: str, default=None):
        return (self.spec.get("constraints") or {}).get(key, default)

    def reserved_ids(self) -> set[str]:
        """Ids a later pass owns by name in the spec. Pass E must not spend the
        parasol pass F was told to use, or F arrives to an empty catalog."""
        out: set[str] = set()
        for key in ("F_canopy", "G_detail"):
            out.update(self.pass_cfg(key).get("candidates") or [])
        return out

    # -- compile budgets (constraints{}) -------------------------------------

    def stamps_left(self) -> int:
        cap = self.constraint("max_stamps")
        if not isinstance(cap, int):
            return 1 << 30
        return max(0, cap - len(self.frag["stamps"]))

    def cells_left(self) -> int:
        """Cells the district may still occupy under min_free_cell_ratio."""
        total = self.occ.cw * self.occ.ch
        floor = self.constraint("min_free_cell_ratio")
        if not isinstance(floor, (int, float)) or not total:
            return 1 << 30
        occupied = sum(1 for f in self.occ.flags if f & (SOLID | DECOR))
        return int(total * (1 - float(floor))) - occupied

    def solid_cells_left(self) -> int:
        total = self.occ.cw * self.occ.ch
        cap = self.constraint("max_solid_cell_ratio")
        if not isinstance(cap, (int, float)) or not total:
            return 1 << 30
        return int(total * float(cap)) - sum(1 for f in self.occ.flags if f & SOLID)

    def emit(self, *, x: int, y: int, origin: str, role: str,
             me: str | None = None, exs: str | None = None,
             prefer: str | None = None, solid: bool = False,
             interact: str | None = None, depth: float | None = None,
             grp: str | None = None, single: str | None = None,
             row: dict | None = None, primary: bool = True) -> dict:
        """Append one stamp (catalog id only — never an `img` path) and remember
        what it was, for pass H and the coverage stats."""
        stamp: dict = {"me": me} if me else {"exs": exs}
        if prefer and me:
            stamp["prefer"] = prefer
        stamp.update({"x": x, "y": y, "origin": origin})
        if solid:
            stamp["solid"] = True
        if depth is not None:
            stamp["depth"] = depth
        if interact:
            stamp["interact"] = interact
        self.frag["stamps"].append(stamp)
        single = single or self.cat.single_id(me=me, exs=exs, prefer=prefer)
        row = row if row is not None else self.pool.row(me or "")
        self.placed.append({"stamp": stamp, "me": me, "single": single, "role": role,
                            "grp": grp, "tags": tuple(row.get("tags") or ()),
                            "interact_default": row.get("interact"),
                            "primary": primary})
        if single:
            self.used_singles.add(single)
        if me:
            self.used_me[me] = self.used_me.get(me, 0) + 1
        return stamp


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
        between = slot.get("between") or rule.get("between")
        if as_rect(slot, "") is not None:
            cells = list(ctx.occ._cells(ctx.rect(slot)))
        elif slot.get("surface"):
            cells = ctx.occ.cells_of_surface(slot["surface"])
        elif between and len(between) == 2:
            cells = surface_band(ctx.occ, between[0], between[1],
                                 slot.get("band_px", rule.get("band_px", 48)))
        else:
            cells = []
        # Two views of a slot: the walkable cells a scatter pass may stand on,
        # and every cell in the band — a shore_line reaches across the waterline,
        # and only a water_prop may use that half.
        ctx.slot_cells[name] = ctx.occ.free_cells(cells)
        ctx.slots[name] = {"spec": slot, "archetype": slot["slot"], "rule": rule,
                           "all": cells, "cells": ctx.slot_cells[name]}
        resolved[name] = {"archetype": slot["slot"], "cells": len(ctx.slot_cells[name]),
                          "derived_from": rule.get("derived_from")}
        if between:
            resolved[name]["band_cells"] = len(cells)

    # TODO(W2-B): auto-route paths between district entrances and landmark
    # anchors (A* over free cells), emit them as patches and reserve the
    # corridor. Today only spec-declared keep_clear/roads are honoured.
    return {"keep_clear": kept, "roads": roads, "slots": resolved}


def surface_band(occ: Occupancy, a: str, b: str, band_px: int) -> list[int]:
    """`between: [a, b]` — the boundary band between two surfaces.

    Seeds are cells of `a` orthogonally touching a cell of `b`, then the band
    grows `band_px` wide across BOTH surfaces: a shore_line slot must own the wet
    sand and the first strip of water, because the shells go on one and the
    floats on the other.
    """
    seeds = [i for i, srf in enumerate(occ.surface) if srf == a
             and any(occ.surface[j] == b for j in occ.neighbours(i))]
    # The seed row is the band's first row, so a 48px band grows 2 more.
    steps = max(0, band_px // TILE - 1)
    band = dict.fromkeys(seeds, 0)
    frontier, depth = seeds, 0
    while frontier and depth < steps:
        depth += 1
        nxt = []
        for i in frontier:
            for j in occ.neighbours(i):
                if j not in band and occ.surface[j] in (a, b):
                    band[j] = depth
                    nxt.append(j)
        frontier = nxt
    return sorted(band)


# ── placement primitives (shared by C-G) ─────────────────────────────────────

def in_grid(occ: Occupancy, rect) -> bool:
    """Every cell the rect touches exists in the district grid — otherwise the
    stamp leans out of its own district and the occupancy claim silently clips."""
    x, y, w, h = rect
    return (occ.cell_at(x, y) is not None
            and occ.cell_at(x + w - 1, y + h - 1) is not None)


def in_world(rect) -> bool:
    x, y, w, h = rect
    return x >= 0 and y >= 0 and x + w <= WORLD["w"] and y + h <= WORLD["h"]


def depth_for(rule: dict, rect) -> float | None:
    """Explicit depth only where the rules ask for one: a canopy must draw above
    the props it shades, a decal below everything. Otherwise the runtime's
    default (baseline y) is already right."""
    spec = rule.get("depth") or {}
    if spec.get("mode") == "y_sort_bias":
        return (rect[1] + rect[3]) + float(spec.get("bias", 0))
    if spec.get("mode") == "fixed":
        return float(spec.get("value", 0.9))
    return None


def anchor_point(occ: Occupancy, cell: int, origin: str, align: str,
                 jitter_px: int, rng: random.Random) -> tuple[int, int]:
    """Where in a cell a stamp with this anchor stands. `align: free` props get
    sub-tile jitter so a scatter does not read as a checkerboard."""
    cx, cy = occ.cell_origin(cell)
    if origin == "tl":
        px, py = cx, cy
    elif origin == "bc":
        px, py = cx + TILE // 2, cy + TILE
    else:                                  # bl
        px, py = cx, cy + TILE
    if align == "free" and jitter_px:
        spread = max(1, min(jitter_px, TILE) // 2)
        px += rng.randint(-spread, spread)
        py += rng.randint(-spread, spread)
    elif align != "free":
        px, py = (px // TILE) * TILE + (TILE // 2 if origin == "bc" else 0), py
    return (px, py)


def fits(ctx: Ctx, rect, *, solid: bool, blocked: int = RESERVED | SOLID,
         overlap: float = OVERLAP_REJECT) -> bool:
    """The one accept/reject test every fill pass shares.

    What must be free is the GROUND the sprite stands on, not the whole PNG: a
    palm's canopy and a parasol's shade are supposed to overhang the props under
    them. Overlap, on the other hand, is measured on the full sprite rect for
    solids, because that is the pair check-city-plan.py flags at 35%.
    """
    ground = collider_rect(rect)
    if not (in_world(rect) and in_grid(ctx.occ, ground)):
        return False
    if not ctx.occ.is_free(ground, blocked):
        return False
    return not solid or ctx.occ.overlap_ratio(rect) <= overlap


def spaced(ctx: Ctx, key: str, x: int, y: int, min_px: float) -> bool:
    """Role spacing, so a `dense` scatter still reads as arranged, not dumped."""
    if min_px <= 0:
        return True
    for ax, ay in ctx.anchors.get(key, ()):
        if abs(ax - x) < min_px and abs(ay - y) < min_px:
            return False
    return True


def slot_cells_for_role(ctx: Ctx, slot: dict, role: str) -> dict[str, list[int]]:
    """The slot's still-usable cells, grouped by surface, for one role.

    Unwalkable surfaces stay in play here (that is the only way a water_prop can
    reach the sea), but only for roles the surface's `roles_allowed` admits.
    """
    out: dict[str, list[int]] = {}
    for i in slot["all"]:
        srf = ctx.occ.surface[i]
        if not srf or not ctx.pool.surface_allows(srf, role):
            continue
        walkable = ctx.surface_rule(srf).get("walkable") is not False
        blocked = (RESERVED | SOLID | DECOR) if walkable else (SOLID | DECOR)
        if ctx.occ.flags[i] & blocked:
            continue
        out.setdefault(srf, []).append(i)
    return out


def role_is_solid(rule: dict) -> bool:
    """`collision: footprint` blocks movement too — the runtime only knows
    solid/not, so both become `solid: true` and both cost occupancy."""
    return rule.get("collision") in ("solid", "footprint")


def scatter(ctx: Ctx, pass_letter: str, slot_name: str, role: str, level: str,
            *, only: list[str] | None = None, exclude=(), flag: int = DECOR,
            solid: bool | None = None, cap: int | None = None) -> dict:
    """The shared E/F/G loop: fill one slot with one role at one density level.

    Density is resolved through the rules (`props_per_kilopx2` over the slot's
    usable area, `min_spacing_mult` scaling the role's own `spacing_px`,
    `jitter_px`), so `dense` means the same thing in every district. Candidates
    rotate least-used-first, which is what turns a compile into coverage.
    """
    slot = ctx.slots[slot_name]
    rule = ctx.role_rule(role)
    dens = ctx.density_rule(level)
    by_surface = slot_cells_for_role(ctx, slot, role)
    if not by_surface:
        return {"placed": 0, "skipped": "no usable cells"}

    cands: dict[str, list[dict]] = {}
    for srf in sorted(by_surface):
        if only is not None:
            # A spec-named candidate list is authoritative about WHAT to place,
            # but not about standing a sand mound in the sea.
            rows = [ctx.pool.row(me) or {"me": me} for me in only
                    if me not in exclude and ctx.cat.knows(me=me)]
            rows = [r for r in rows if ctx.pool.row_fits_surface(r, srf)]
        else:
            rows = ctx.pool.candidates(ctx.spec["biome"], role, srf,
                                       forbid_tags=ctx.forbid_tags(),
                                       palettes=ctx.palettes(), exclude=exclude)
        if rows:
            cands[srf] = rows
    if not cands:
        return {"placed": 0, "skipped": "no candidates", "cells": sum(
            len(v) for v in by_surface.values())}

    cells = [(i, srf) for srf in sorted(cands) for i in by_surface[srf]]
    area_kpx = len(cells) * TILE * TILE / 1000.0
    want = int(round(area_kpx * float(dens.get("props_per_kilopx2", 0.1)))) or 1
    if cap is not None:
        want = min(want, cap)
    want = min(want, ctx.stamps_left())
    if want <= 0:
        return {"placed": 0, "skipped": "stamp budget spent"}

    rng = ctx.rng(pass_letter, f"{slot_name}:{role}")
    rng.shuffle(cells)
    spacing = float(rule.get("spacing_px", 0)) * float(dens.get("min_spacing_mult", 1.0))
    origin = rule.get("anchor") or (ctx.rules.get("defaults") or {}).get("anchor", "bl")
    align = rule.get("align") or (ctx.rules.get("defaults") or {}).get("align", "tile16")
    is_solid = role_is_solid(rule) if solid is None else solid
    key = f"{slot_name}:{role}"
    order = {srf: sorted(rows, key=lambda r: (ctx.used_me.get(r["me"], 0),
                                              rng.random(), r["me"]))
             for srf, rows in cands.items()}

    placed = attempts = 0
    for cell, srf in cells:
        if placed >= want:
            break
        # Spend the least-used id first, rotating the tie-break so a candidate
        # that keeps failing to fit does not stall the whole role.
        pool = order[srf]
        row = min(enumerate(pool),
                  key=lambda t: (ctx.used_me.get(t[1]["me"], 0),
                                 (t[0] - attempts) % len(pool)))[1]
        attempts += 1
        me_id = row["me"]
        prefer, fp = ctx.pool.pick_single(me_id, ctx.palettes(),
                                          ctx.used_singles, rng)
        px, py = anchor_point(ctx.occ, cell, origin, align,
                              int(dens.get("jitter_px", 0)), rng)
        rect = sprite_rect(px, py, fp[0], fp[1], origin)
        # Water IS reserved (pass A marks it unwalkable), so a water-surface role
        # is the one case where RESERVED does not mean "hands off".
        wet = ctx.surface_rule(srf).get("walkable") is False
        blocked = (SOLID | DECOR) if wet else (RESERVED | SOLID)
        if not (spaced(ctx, key, px, py, spacing)
                and fits(ctx, rect, solid=is_solid, blocked=blocked)):
            continue
        cost = len(list(ctx.occ._cells(collider_rect(rect) if is_solid else rect)))
        if cost > ctx.cells_left() or (is_solid and cost > ctx.solid_cells_left()):
            break
        ctx.occ.claim_stamp(rect, SOLID if is_solid else flag,
                            halo=TILE if is_solid else 0)
        ctx.emit(me=me_id, prefer=prefer, x=px, y=py, origin=origin, role=role,
                 solid=is_solid, depth=depth_for(rule, rect), row=row)
        ctx.anchors.setdefault(key, []).append((px, py))
        placed += 1
    return {"placed": placed, "want": want, "attempts": attempts,
            "pool": sum(len(v) for v in cands.values())}


def scatter_slots(ctx: Ctx, pass_letter: str, role: str, **kw) -> dict:
    """Run `role` across every slot that declares a density for it."""
    stats: dict[str, dict] = {}
    placed = 0
    for name, slot in ctx.slots.items():
        level = (slot["spec"].get("density") or {}).get(role)
        if not level:
            continue
        stats[name] = scatter(ctx, pass_letter, name, role, level, **kw)
        placed += stats[name]["placed"]
    return {"placed": placed, "by_slot": stats}


# ── passes C-G ───────────────────────────────────────────────────────────────

def pass_c_landmarks(ctx: Ctx) -> dict:
    """C — Landmarks. Pinned hero objects from `landmarks[]`, largest footprint
    first. Big, inflexible pieces claim space before anything small can box
    them out; `pin: true` means the anchor is authoritative and must not drift.
    """
    entries = ctx.spec.get("landmarks") or []
    ranked = []
    for i, lm in enumerate(entries):
        if lm.get("grp"):
            fp_tiles = (load_json(_recipe_path(lm["grp"])) or {}).get("footprint_tiles") or {}
            size = ((fp_tiles.get("w") or 1) * TILE, (fp_tiles.get("h") or 1) * TILE)
        else:
            size = ctx.cat.footprint(me=lm.get("me"), exs=lm.get("exs"),
                                     prefer=lm.get("prefer")) or (TILE, TILE)
        ranked.append((-(size[0] * size[1]), i, lm, size))
    ranked.sort()

    placed = groups = 0
    rejected: list[str] = []
    for _, _, lm, size in ranked:
        if ctx.stamps_left() <= 0:
            rejected.append("stamp budget spent")
            break
        ax, ay = ctx.point(lm["at"])
        if lm.get("grp"):
            recipe = load_json(_recipe_path(lm["grp"]))
            if recipe is None:
                rejected.append(f"{lm['grp']}: no recipe")
                continue
            n = place_group(ctx, lm["grp"], recipe, ax, ay,
                            interact=lm.get("interact"))
            if n:
                groups, placed = groups + 1, placed + n
            else:
                rejected.append(f"{lm['grp']} @({ax},{ay}): blocked")
            continue

        me_id = lm.get("me")
        row = ctx.pool.row(me_id or "")
        role = lm.get("role") or row.get("role") or "landmark"
        rule = ctx.role_rule(role)
        origin = lm.get("anchor") or rule.get("anchor") or "bl"
        is_solid = bool(lm.get("solid", role_is_solid(rule)))
        prefer = lm.get("prefer")
        if prefer is None and me_id:
            prefer, size = ctx.pool.pick_single(me_id, ctx.palettes(),
                                                ctx.used_singles,
                                                ctx.rng("C", me_id))
        align = rule.get("align") or "tile16"
        pinned = bool(lm.get("pin"))
        if not pinned and align != "free":
            # Snap so the SPRITE lands on the lattice, not just the anchor.
            rect = sprite_rect(ax, ay, size[0], size[1], origin)
            dx, dy = rect[0] % TILE, rect[1] % TILE
            ax, ay = ax - dx, ay - dy

        spot = landmark_spot(ctx, ax, ay, size, origin, role, is_solid, pinned)
        if spot is None:
            rejected.append(f"{me_id or lm.get('exs')} @({ax},{ay}): "
                            "no accepting surface / overlaps a claim")
            continue
        ax, ay = spot
        rect = sprite_rect(ax, ay, size[0], size[1], origin)
        ctx.occ.claim_stamp(rect, SOLID if is_solid else DECOR, halo=TILE)
        if lm.get("interact"):
            # Keep the counter/door approach walkable: an unreachable shop is a
            # bug the QA gate cannot see.
            ctx.occ.mark((rect[0], rect[1] + rect[3], rect[2], TILE), RESERVED)
        ctx.emit(me=me_id, exs=lm.get("exs"), prefer=prefer, x=ax, y=ay,
                 origin=origin, role=role, solid=is_solid,
                 interact=lm.get("interact"), depth=depth_for(rule, rect), row=row)
        placed += 1

    stats = {"placed": placed, "groups": groups, "pending": len(entries) - placed - groups}
    if rejected:
        stats["rejected"] = rejected[:10]
    return stats


def landmark_spot(ctx: Ctx, ax: int, ay: int, size, origin: str, role: str,
                  is_solid: bool, pinned: bool) -> tuple[int, int] | None:
    """Snap a landmark anchor to a cell whose surface the object accepts.

    A pinned anchor may not drift — it either works where the spec put it or it
    is dropped, because emitting it anyway is how a district gets an OVERLAP.
    """
    def ok(x: int, y: int) -> bool:
        rect = sprite_rect(x, y, size[0], size[1], origin)
        probe = (x, y - 1) if origin != "tl" else (x, y + 1)
        srf = ctx.occ.surface_at(*probe)
        if not srf or not ctx.pool.surface_allows(srf, role):
            return False
        return fits(ctx, rect, solid=is_solid)

    if ok(ax, ay):
        return (ax, ay)
    if pinned:
        return None
    for ring in range(1, 4):
        for dy in range(-ring, ring + 1):
            for dx in range(-ring, ring + 1):
                if max(abs(dx), abs(dy)) != ring:
                    continue
                x, y = ax + dx * TILE, ay + dy * TILE
                if ok(x, y):
                    return (x, y)
    return None


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
    wanted = groups = stamps = checked = 0
    problems: list[str] = []
    rejected: list[str] = []
    for entry in ctx.spec.get("groups") or []:
        count = entry.get("count", 1)
        wanted += count
        recipe = load_json(_recipe_path(entry["grp"]))
        if recipe is None:
            rejected.append(f"{entry['grp']}: no recipe")
            continue
        checked += 1
        problems += recipe_problems(ctx, entry["grp"], recipe)

        slot_name = entry.get("slot")
        anchors = group_anchors(ctx, entry["grp"], recipe, slot_name)
        landed = 0
        for ax, ay in anchors:
            if landed >= count or ctx.stamps_left() <= 0:
                break
            n = place_group(ctx, entry["grp"], recipe, ax, ay,
                            interact=entry.get("interact"))
            if n:
                landed, stamps = landed + 1, stamps + n
        groups += landed
        if landed < count:
            rejected.append(f"{entry['grp']}: {landed}/{count} placed in "
                            f"{slot_name or 'district'} ({len(anchors)} anchors tried)")

    stats = {"groups": groups, "stamps": stamps, "pending": wanted - groups,
             "recipes_checked": checked, "recipes_available": _count_recipes()}
    if problems:
        stats["recipe_problems"] = problems[:10]
    if rejected:
        stats["rejected"] = rejected[:10]
    return stats


def recipe_problems(ctx: Ctx, grp_id: str, recipe: dict) -> list[str]:
    """Pre-validate a recipe: every piece must resolve in the catalog and every
    offset must fit the declared footprint. Data problems surface as stats, not
    as a silently thinner group."""
    problems: list[str] = []
    fp = recipe.get("footprint_tiles") or {}
    for piece in recipe.get("pieces") or []:
        if not (piece_size(ctx, piece) and (piece.get("me") or piece.get("exs"))):
            problems.append(f"{grp_id}:{piece.get('role')} unresolvable")
        dx, dy = piece.get("dx", 0), piece.get("dy", 0)
        pw = ((piece.get("w") or TILE) + TILE - 1) // TILE
        ph = ((piece.get("h") or TILE) + TILE - 1) // TILE
        if fp.get("w") and (dx + pw > fp["w"] or dy + ph > fp["h"]):
            problems.append(f"{grp_id}:{piece.get('role')} offset ({dx},{dy}) "
                            f"escapes footprint {fp.get('w')}x{fp.get('h')} tiles")
    return problems


def piece_size(ctx: Ctx, piece: dict) -> tuple[int, int] | None:
    """A recipe piece carries its own w/h (that is what the offsets were authored
    against); the catalog is the fallback and the cross-check."""
    if piece.get("w") and piece.get("h"):
        return (piece["w"], piece["h"])
    return ctx.cat.footprint(me=piece.get("me"), exs=piece.get("exs"))


def group_anchors(ctx: Ctx, grp_id: str, recipe: dict,
                  slot_name: str | None) -> list[tuple[int, int]]:
    """Candidate top-left anchors for a recipe, in a deterministic order."""
    fp = recipe.get("footprint_tiles") or {}
    tw, th = (fp.get("w") or 1) * TILE, (fp.get("h") or 1) * TILE
    slot = ctx.slots.get(slot_name or "")
    cells = slot["cells"] if slot else ctx.occ.free_cells(range(len(ctx.occ.flags)))
    spots = []
    for i in cells:
        x, y = ctx.occ.cell_origin(i)
        if in_grid(ctx.occ, (x, y, tw, th)):
            spots.append((x, y))
    rng = ctx.rng("D", grp_id)
    rng.shuffle(spots)
    return spots


def place_group(ctx: Ctx, grp_id: str, recipe: dict, ax: int, ay: int,
                interact: str | None = None) -> int:
    """Place a `grp.*` recipe ATOMICALLY at top-left (ax, ay).

    Every piece lands at `anchor + (dx, dy) x 16` or none of them does. That is
    the fix for mistake #1 (stamp collage instead of composed scenes) and for
    coverage tier D: a modular court-line tile is only ever legal here.
    """
    fp = recipe.get("footprint_tiles") or {}
    union = (ax, ay, (fp.get("w") or 1) * TILE, (fp.get("h") or 1) * TILE)
    if not (in_world(union) and in_grid(ctx.occ, union)):
        return 0
    # Circulation is absolute: a group may not straddle a keep_clear or a lane.
    if not ctx.occ.is_free(union, RESERVED):
        return 0
    want_surface = recipe.get("surface")
    if want_surface:
        under = [ctx.occ.surface[i] for i in ctx.occ._cells(union)]
        if sum(1 for s in under if s == want_surface) < 0.8 * len(under):
            return 0

    planned = []
    for piece in recipe.get("pieces") or []:
        size = piece_size(ctx, piece)
        if not size:
            return 0
        origin = piece.get("origin") or "tl"
        px = ax + piece.get("dx", 0) * TILE
        py = ay + piece.get("dy", 0) * TILE
        rect = sprite_rect(px, py, size[0], size[1], origin)
        solid = bool(piece.get("solid"))
        # Pieces overlap each OTHER by design (that is what makes a scene), so a
        # piece is only tested against what earlier passes claimed.
        if not fits(ctx, rect, solid=solid,
                    blocked=RESERVED | SOLID if solid else RESERVED):
            return 0
        planned.append((piece, px, py, origin, rect, solid))

    cost = sum(len(list(ctx.occ._cells(collider_rect(r) if s else r)))
               for _, _, _, _, r, s in planned)
    if cost > ctx.cells_left() or len(planned) > ctx.stamps_left():
        return 0

    # One verb per group, on its first solid piece (the thing a player walks up
    # to) — or on its first piece at all if the recipe is all decals.
    primary = interact or recipe.get("interact")
    verb_at = next((i for i, p in enumerate(planned) if p[5]), 0) if primary else -1
    for idx, (piece, px, py, origin, rect, solid) in enumerate(planned):
        ctx.occ.claim_stamp(rect, SOLID if solid else DECOR)
        role = piece.get("role") or recipe.get("category") or "fragment"
        verb = primary if idx == verb_at else None
        ctx.emit(me=piece.get("me"), exs=piece.get("exs"),
                 prefer=piece.get("basename"), x=px, y=py, origin=origin,
                 role=role, solid=solid, interact=verb, grp=grp_id,
                 single=piece.get("exs"), primary=idx == max(verb_at, 0))
    return len(planned)


def pass_e_props(ctx: Ctx) -> dict:
    """E — Props. Per-slot scatter of role-matched, surface-matched props at the
    slot's per-role density level (sparse…packed → target_coverage, spacing
    multiplier, jitter). Variant choice is coverage-aware so a district spends
    unused Singles instead of repeating the same six PNGs (mistake #2).
    """
    if not ctx.pool.ready:
        return {"placed": 0, "skipped": f"{ENRICHED_PATH.name} missing (W1-A)"}
    reserved = ctx.reserved_ids()
    placed = 0
    by_slot: dict[str, dict] = {}
    for name, slot in ctx.slots.items():
        arch_roles = set(slot["rule"].get("roles") or ())
        out: dict[str, object] = {}
        for role, level in (slot["spec"].get("density") or {}).items():
            if role == "npc_anchor":
                out[role] = "meta role — spawn hints land in pass H (W4-A)"
                continue
            if arch_roles and role not in arch_roles:
                # The archetype decides what belongs in it, not the spec: a
                # canopy in an interior_fill slot is pass F's job, not E's.
                out[role] = f"not a {slot['archetype']} role"
                continue
            res = scatter(ctx, "E", name, role, level, exclude=reserved)
            out[role] = res
            placed += res["placed"]
        by_slot[name] = out
    return {"placed": placed, "slots": len(ctx.slots), "by_slot": by_slot}


def pass_f_canopy(ctx: Ctx) -> dict:
    """F — Canopy. Overhead cover (palms, parasols, awnings, tents) last among
    the solids: it overhangs what pass E placed, so it must see the ground props
    to avoid burying an interactable or blocking a sightline. The rules give
    canopy `layer: overhead` with a y-sort depth bias, and its tile stays
    walkable — so it claims CLEAR, not SOLID.
    """
    only = ctx.pass_cfg("F_canopy").get("candidates") or None
    if only is None and not ctx.pool.ready:
        return {"placed": 0, "skipped": f"{ENRICHED_PATH.name} missing (W1-A)"}
    stats = scatter_slots(ctx, "F", "canopy", only=only, flag=CLEAR, solid=False)
    stats["candidates"] = "spec" if only else "enriched pool"
    return stats


def pass_g_detail(ctx: Ctx) -> dict:
    """G — Detail. High-count, zero-collision dressing (shells, starfish, sand
    holes, litter, decals) into cells that are still empty. Claims DECOR only
    and never sets `solid`, so it cannot create an OVERLAP defect.
    """
    only = ctx.pass_cfg("G_detail").get("candidates") or None
    if only is None and not ctx.pool.ready:
        return {"placed": 0, "skipped": f"{ENRICHED_PATH.name} missing (W1-A)"}
    placed = 0
    by_slot: dict[str, dict] = {}
    for name, slot in ctx.slots.items():
        for role in ("decor_small", "water_prop"):
            level = (slot["spec"].get("density") or {}).get(role)
            if not level:
                continue
            # Pass E already spent this slot's headroom at the declared level;
            # G is the sweep-up, so it never asks for more than `medium`.
            level = min(level, "medium", key=lambda l: DENSITY_LEVELS.index(l)
                        if l in DENSITY_LEVELS else 0)
            res = scatter(ctx, "G", name, role, level, only=only,
                          flag=DECOR, solid=False)
            by_slot[f"{name}:{role}"] = res
            placed += res["placed"]
    return {"placed": placed, "by_slot": by_slot,
            "candidates": "spec" if only else "enriched pool"}


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

    return {"labels": len(ctx.frag["labels"]), "anims": len(ctx.frag["anims"]),
            "animBands": len(ctx.frag["animBands"]),
            "interactions": wire_interactions(ctx)}


def wire_interactions(ctx: Ctx) -> dict:
    """Attach `interactions{}` verbs to the stamps C-G actually chose.

    `"auto"` = every stamp the verb's rules entry admits (role + `tags_any`, or
    the asset's own enriched `interact`); a list = those ids exactly, by `me` or
    by the `grp` recipe that emitted the stamp. Runs last because interaction
    attaches to objects earlier passes selected, not the other way round.
    """
    verbs = ctx.rules.get("interact") or {}
    wired: dict[str, int] = {}
    for verb, targets in (ctx.spec.get("interactions") or {}).items():
        rule = verbs.get(verb) or {}
        roles = set(rule.get("roles") or ())
        tags_any = set(rule.get("tags_any") or ())
        count = 0
        for rec in ctx.placed:
            stamp = rec["stamp"]
            if stamp.get("interact"):
                # A verb pass C or D already attached still counts as wired.
                count += stamp["interact"] == verb
                continue
            if targets == "auto":
                by_rules = (rec["role"] in roles
                            and (not tags_any or set(rec["tags"]) & tags_any))
                if not (by_rules or rec["interact_default"] == verb):
                    continue
            elif not (rec["me"] in targets
                      or (rec["grp"] in targets and rec["primary"])):
                # A group gets ONE verb, on the piece a player walks up to —
                # not on all eight of its court-line tiles.
                continue
            stamp["interact"] = verb
            count += 1
        wired[verb] = count
    return wired


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


def coverage_stats(ctx: Ctx) -> dict:
    """How many distinct Singles this district spends — the metric mistake #2
    (the same six PNGs everywhere) is measured against."""
    target = ctx.constraint("coverage_target_singles")
    out = {
        "stamps": len(ctx.frag["stamps"]),
        "unique_me": len(ctx.used_me),
        "unique_singles": len(ctx.used_singles),
        "max_stamps": ctx.constraint("max_stamps"),
    }
    if isinstance(target, int):
        out["target_singles"] = target
        out["target_met"] = len(ctx.used_singles) >= target
    return out


def budget_breaches(ctx: Ctx, frag: dict) -> list[str]:
    """The `constraints{}` budgets, checked after the fact so a compile reports
    the breach instead of quietly exceeding it."""
    out = []
    cap = ctx.constraint("max_stamps")
    if isinstance(cap, int) and len(frag["stamps"]) > cap:
        out.append(f"max_stamps {len(frag['stamps'])} > {cap}")
    occ = ctx.occ.stats()
    floor = ctx.constraint("min_free_cell_ratio")
    if isinstance(floor, (int, float)) and occ["free_ratio"] < floor:
        out.append(f"min_free_cell_ratio {occ['free_ratio']} < {floor}")
    solid_cap = ctx.constraint("max_solid_cell_ratio")
    if isinstance(solid_cap, (int, float)) and occ["cells"]:
        ratio = round(sum(1 for f in ctx.occ.flags if f & SOLID) / occ["cells"], 3)
        if ratio > solid_cap:
            out.append(f"max_solid_cell_ratio {ratio} > {solid_cap}")
    target = ctx.constraint("coverage_target_singles")
    if isinstance(target, int) and len(ctx.used_singles) < target:
        out.append(f"coverage_target_singles {len(ctx.used_singles)} < {target}")
    return out


def qa_plan(frag: dict, catalog: Catalog) -> tuple[dict, list[str]]:
    """A copy of the fragment with `me`/`exs` resolved to `img`.

    check-city-plan.py measures PNG rects, and compiled stamps deliberately
    carry ids only — so --qa hands it the same resolution merge-city-plan.py
    would do, rather than the compiler learning to emit paths.
    """
    plan = json.loads(json.dumps(frag))
    plan["worldSize"] = dict(WORLD)
    unresolved = []
    for stamp in plan.get("stamps") or []:
        img = catalog.img(me=stamp.get("me"), exs=stamp.get("exs"),
                          prefer=stamp.get("prefer"))
        if img:
            stamp["img"] = img
        else:
            unresolved.append(stamp.get("me") or stamp.get("exs") or "?")
    return plan, unresolved


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
            "coverage": coverage_stats(ctx),
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
    cov = frag["_compiled"]["coverage"]
    print(f"coverage: {cov['unique_singles']} unique Singles from "
          f"{cov['stamps']} stamps ({cov['unique_me']} me.* ids)"
          + (f", target {cov['target_singles']}"
             f" {'MET' if cov['target_met'] else 'MISSED'}"
             if "target_singles" in cov else ""))
    todo = [k for k, v in ctx.stats.items() if v.get("todo")]
    if todo:
        print(f"stub passes (no fill logic yet): {', '.join(todo)}")
    for breach in budget_breaches(ctx, frag):
        print(f"warn: budget {breach}")
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
        plan, unresolved = qa_plan(frag, catalog)
        if unresolved:
            print(f"error: {len(unresolved)} stamp id(s) do not resolve to a PNG: "
                  f"{sorted(set(unresolved))[:5]}", file=sys.stderr)
            return 1
        qa_path = out.with_suffix(".qa.json")
        qa_path.write_text(json.dumps(plan, indent=1) + "\n", encoding="utf-8")
        try:
            qa = subprocess.run(
                [sys.executable, str(DEN / "scripts" / "check-city-plan.py"), str(qa_path)],
                capture_output=True, text=True)
            print(qa.stdout.strip() or qa.stderr.strip())
            return qa.returncode
        finally:
            qa_path.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
