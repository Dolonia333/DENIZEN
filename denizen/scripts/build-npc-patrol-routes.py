#!/usr/bin/env python3
"""W5-A (Wave 5 prep, offline) — NPC patrol routes per biome.

Denizen MCP is not connected in the cloud agent VM (see
`data/city-specs/EXTERIOR-PLACEMENT-BRAIN-PLAN.md` Wave 5), so `assign_task`
can't hand these to a live NPC yet. This script builds the routes anyway from
data that already exists on disk, so the hand-off is a single MCP call once
the bridge is up:

  1. `data/limezu-visual-catalog/placement-rules.json` `biomes.*.districts` for
     the hand-authored `data/city-specs/d*.json` bbox per biome.
  2. `data/city-specs/generated/d*.json` (compiler output, W2-A onward) for the
     compiled-pocket bbox per biome — each fragment already carries its own
     top-level `biome` field, so no guessing.

For each biome with at least one resolvable bbox, emits 1-2 patrol waypoints
(hand-authored district center, then compiled-pocket center — first two that
resolve), a placeholder `npc_role` archetype, a `dwell_ms` scaled off the
primary pocket's stamp density, and `interact_zones` pulled from every
`interact`-tagged stamp in the source fragment(s) (sit/enter/read/shop/play —
see placement-rules.json `interact`), so a future `assign_task` route already
knows what the patrolling NPC can do at each stop.

Usage:
  python3 scripts/build-npc-patrol-routes.py
  python3 scripts/build-npc-patrol-routes.py --stats   # print only, no write

Writes:
  data/city-specs/npc-patrol-routes.json
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

DEN = Path(__file__).resolve().parents[1]
SPECS_DIR = DEN / "data" / "city-specs"
GENERATED_DIR = SPECS_DIR / "generated"
RULES_PATH = DEN / "data" / "limezu-visual-catalog" / "placement-rules.json"
OUT_PATH = SPECS_DIR / "npc-patrol-routes.json"

# Generic patrol-role archetype per biome — a placeholder for Denizen's
# `assign_task` to bind to an actual in-world NPC persona once the MCP bridge
# is live (W5-A). Chosen for thematic fit with each biome's slots/interact mix
# in placement-rules.json, not tied to any specific named NPC.
NPC_ROLE_BY_BIOME: dict[str, str] = {
    "beach": "lifeguard",
    "wild": "trail_ranger",
    "urban_core": "beat_cop",
    "commercial": "market_vendor",
    "civic": "civic_clerk",
    "park": "groundskeeper",
    "residential": "mail_carrier",
    "industrial": "shift_foreman",
    "military": "sentry",
    "memorial": "caretaker",
    "transit": "station_attendant",
    "rural": "farmhand",
    "leisure": "activities_host",
    "universal": "roaming_vendor",
}

DWELL_MS_MIN = 3000
DWELL_MS_MAX = 9000
DWELL_MS_BASE = 2000
DWELL_MS_PER_STAMP = 40


def bbox_rect(bbox: dict) -> tuple[int, int, int, int]:
    """Normalize either bbox shape (`{x0,y0,x1,y1}` or `{x,y,w,h}`) used
    across data/city-specs/*.json into (x, y, w, h) — same normalization as
    check-city-plan.py's load_district_biomes()."""
    if "x0" in bbox:
        return (bbox["x0"], bbox["y0"], bbox["x1"] - bbox["x0"], bbox["y1"] - bbox["y0"])
    return (bbox["x"], bbox["y"], bbox["w"], bbox["h"])


def bbox_center(bbox: dict) -> dict:
    x, y, w, h = bbox_rect(bbox)
    return {"x": x + w // 2, "y": y + h // 2}


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def hand_authored_source(biome: str, district_ids: list[str]) -> tuple[str, dict] | None:
    """First `data/city-specs/<id>.json` in the biome's district list that
    exists on disk and carries a bbox. placement-rules.json district lists are
    known to drift stale (EXTERIOR-MISTAKES.md #4 — e.g. beach still lists
    `d18-beach-compiler-pilot`, which the compiler wrote out as
    `d18-beach-lounge`), so this skips anything missing rather than raising."""
    for district_id in district_ids:
        spec = load_json(SPECS_DIR / f"{district_id}.json")
        if spec and spec.get("bbox"):
            return (f"data/city-specs/{district_id}.json", spec)
    return None


def compiled_pockets(biome: str) -> list[tuple[str, dict]]:
    """Every data/city-specs/generated/d*.json fragment whose own `biome`
    field matches, sorted by filename (stable, matches Wave 3 rollout order)."""
    out = []
    if not GENERATED_DIR.is_dir():
        return out
    for fp in sorted(GENERATED_DIR.glob("d*.json")):
        frag = load_json(fp)
        if frag and frag.get("biome") == biome and frag.get("bbox"):
            out.append((f"data/city-specs/generated/{fp.name}", frag))
    return out


def interact_zones_from(frag: dict, seen: set[tuple[str, str]], cap: int) -> list[dict]:
    """`{me, verb}` for every interact-tagged stamp in a fragment, deduped
    against `seen` across all sources feeding one route. Falls back to the
    Single's basename when a stamp carries no `me` (legacy raw `img` stamps,
    still common in the hand-authored d*.json — see CATALOG_OVERVIEW.md)."""
    zones = []
    for s in frag.get("stamps", []):
        verb = s.get("interact")
        if not verb:
            continue
        ident = s.get("me") or s.get("exs")
        if not ident:
            img = s.get("img")
            ident = f"img:{img.rsplit('/', 1)[-1]}" if img else None
        if not ident:
            continue
        key = (ident, verb)
        if key in seen:
            continue
        seen.add(key)
        zones.append({"me": ident, "verb": verb})
        if len(zones) >= cap:
            break
    return zones


def build_routes(max_interact_per_route: int = 12) -> dict:
    rules = load_json(RULES_PATH) or {}
    biomes = {k: v for k, v in (rules.get("biomes") or {}).items() if k != "_doc"}

    routes = []
    skipped = []
    for biome in sorted(biomes):
        district_ids = biomes[biome].get("districts") or []
        hand = hand_authored_source(biome, district_ids)
        pockets = compiled_pockets(biome)

        waypoints: list[dict] = []
        sources: list[str] = []
        if hand:
            waypoints.append(bbox_center(hand[1]["bbox"]))
            sources.append(hand[0])
        for pocket_path, pocket in pockets:
            if len(waypoints) >= 2:
                break
            waypoints.append(bbox_center(pocket["bbox"]))
            sources.append(pocket_path)

        if not waypoints:
            skipped.append(biome)
            continue

        # Dwell scales with how much there is to do at the primary (first)
        # waypoint's source — a busier pocket earns a longer loiter.
        primary_frag = (hand[1] if hand else pockets[0][1]) if (hand or pockets) else {}
        stamp_count = len(primary_frag.get("stamps", []))
        dwell_ms = max(DWELL_MS_MIN, min(DWELL_MS_MAX, DWELL_MS_BASE + stamp_count * DWELL_MS_PER_STAMP))

        seen_zones: set[tuple[str, str]] = set()
        interact_zones: list[dict] = []
        zone_sources = ([hand[1]] if hand else []) + [p for _, p in pockets[:2]]
        for frag in zone_sources:
            interact_zones.extend(interact_zones_from(frag, seen_zones, max_interact_per_route))
            if len(interact_zones) >= max_interact_per_route:
                break
        interact_zones = interact_zones[:max_interact_per_route]

        routes.append({
            "biome": biome,
            "npc_role": NPC_ROLE_BY_BIOME.get(biome, "roaming_vendor"),
            "waypoints": waypoints,
            "dwell_ms": dwell_ms,
            "interact_zones": interact_zones,
            "sources": sources,
        })

    doc = {
        "_doc": (
            "GENERATED by scripts/build-npc-patrol-routes.py (W5-A, Wave 5 prep — "
            "offline, no Denizen MCP). One route per biome with a resolvable "
            "district/pocket bbox: 1-2 patrol waypoints (hand-authored district "
            "center, then compiled-pocket center), a placeholder npc_role, a "
            "density-scaled dwell_ms, and interact_zones pulled from real "
            "interact-tagged stamps. When Denizen MCP connects, feed each route "
            "to assign_task / delegate_task (see .cursor/rules/denizen-bridge.mdc) "
            "to wake a real NPC on it; do not hand-edit, re-run the generator."
        ),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "schema": {"biome": "str", "npc_role": "str", "waypoints": "[{x,y}]",
                   "dwell_ms": "int", "interact_zones": "[{me,verb}]",
                   "sources": "[str] (extra: hand-district / compiled-pocket file(s) this route was derived from)"},
        "biome_count": len(routes),
        "biomes_skipped_no_geometry": skipped,
        "routes": routes,
    }
    return doc


def print_stats(doc: dict) -> None:
    print(f"{doc['biome_count']} biome routes ({len(doc['biomes_skipped_no_geometry'])} skipped: "
          f"{doc['biomes_skipped_no_geometry']})")
    for r in doc["routes"]:
        print(f"  {r['biome']:<12} role={r['npc_role']:<16} "
              f"waypoints={len(r['waypoints'])} dwell_ms={r['dwell_ms']:<5} "
              f"interact_zones={len(r['interact_zones'])}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stats", action="store_true", help="print summary only, do not write the file")
    args = ap.parse_args()

    doc = build_routes()
    print_stats(doc)
    if args.stats:
        return 0

    OUT_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT_PATH.relative_to(DEN)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
