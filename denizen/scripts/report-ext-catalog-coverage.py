#!/usr/bin/env python3
"""Report Modern Exteriors catalog coverage vs the live city plan.

Cross-references the visual catalog (`me.*` vision objects + `exs.*` pixel-perfect
Singles) against `data/city-plan.json` to answer: how much of the 6224-Single /
2749-object catalog is actually placed in the city today, broken down by theme
sheet and by the Tier A-E targets in
`data/city-specs/EXTERIOR-PLACEMENT-BRAIN-PLAN.md`.

Reads:
  - data/limezu-visual-catalog/registry.jsonl              (me.* vision objects)
  - data/limezu-visual-catalog/ext-singles-pixelperfect.jsonl (exs.* Singles)
  - data/limezu-visual-catalog/me-to-singles.json           (me.* -> [exs.*] index)
  - data/city-plan.json                                     (live merged city plan)

Writes:
  - data/limezu-visual-catalog/coverage-report.json

Usage:
  python3 scripts/report-ext-catalog-coverage.py
  python3 scripts/report-ext-catalog-coverage.py --top-orphans 100
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

DEN = Path(__file__).resolve().parents[1]
CAT = DEN / "data" / "limezu-visual-catalog"
REGISTRY_PATH = CAT / "registry.jsonl"
SINGLES_PATH = CAT / "ext-singles-pixelperfect.jsonl"
ME_TO_SINGLES_PATH = CAT / "me-to-singles.json"
CITY_PLAN_PATH = DEN / "data" / "city-plan.json"
OUT_PATH = CAT / "coverage-report.json"

# Tier B "props/trees/vehicles" = role-tagged placeables per the brain plan.
TIER_B_CATEGORIES = {"prop", "nature", "vehicle"}

COLOR_WORDS = {
    "red", "blue", "green", "yellow", "orange", "purple", "pink", "white",
    "black", "gray", "grey", "brown", "beige", "tan", "silver", "gold",
    "teal", "cyan", "navy", "maroon", "olive", "lime", "violet", "magenta",
    "turquoise", "copper", "bronze", "indigo",
}
FACING_WORDS = {
    "north", "south", "east", "west", "ne", "nw", "se", "sw",
    "n", "s", "e", "w", "front", "back", "side", "left", "right",
}

# Best-effort keyword map: theme sheet -> substrings expected in the basename
# of an `ext/animated/*.png` sheet that "belongs" to that theme (Tier E).
# This is a heuristic (no explicit theme tag exists on animated sheets yet);
# refine once W1 enrichment lands theme/biome metadata on animated assets.
THEME_ANIM_KEYWORDS: dict[str, list[str]] = {
    "1_Terrains_and_Fences": ["waterfall", "water_tileset", "_water_fill", "water_fill"],
    "2_City_Terrains": [],
    "3_City_Props": [
        "street_lamp", "stoplight", "fire_hydrant", "spotlight", "billboard",
        "drinking_fountain", "automatic_barrier",
    ],
    "4_Generic_Buildings": [],
    "5_Floor_Modular_Buildings": [],
    "6_Garage_Sales": [],
    "7_Villas": [],
    "8_Worksite": ["worksite"],
    "9_Shopping_Center_and_Markets": ["shopping_center", "market_door"],
    "10_Vehicles": ["fishing_boat"],
    "11_Camping": ["camping", "campfire"],
    "12_Hotel_and_Hospital": ["hospital"],
    "13_School": ["school"],
    "14_Swimming_Pool": ["trampoline", "bubbles"],
    "15_Police_Station": ["police_station"],
    "16_Office": [],
    "17_Garden": ["garden_fountain", "park_swing", "spring_swing"],
    "18_Fire_Station": [],
    "19_Graveyard": ["graveyard"],
    "20_Subway_and_Train_Station": ["subway", "train"],
    "21_Beach": ["beach"],
    "22_Post_Office": ["post_office"],
    "23_MIlitary_Base": ["military_bunker", "barbed_wire"],
    "24_Additional_Houses": [],
}


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def path_to_img(path: str) -> str:
    """assets/limezu/ext/singles/... -> ext/singles/... (same convention as
    resolve_limezu_me_stamps.py so `img` fields in city-plan.json line up)."""
    p = path.replace("\\", "/")
    prefix = "assets/limezu/"
    if p.startswith(prefix):
        return p[len(prefix):]
    return p


def variant_family_key(obj: dict) -> tuple[str, str, str]:
    """Group me.* ids that are color/facing/index siblings of the same base
    prop (e.g. compact_blue_east / compact_red_east) for Tier C reporting."""
    slug = obj["id"].split(".", 2)[-1]
    tokens = slug.split("_")
    filtered = [
        t for t in tokens
        if t.lower() not in COLOR_WORDS and t.lower() not in FACING_WORDS and not t.isdigit()
    ]
    base = "_".join(filtered) if filtered else slug
    return (obj.get("sheet", ""), obj.get("category", ""), base)


def pct(num: int, den: int) -> float:
    return round(100.0 * num / den, 2) if den else 0.0


def build_report(top_orphans: int) -> dict:
    registry = load_jsonl(REGISTRY_PATH)
    singles = load_jsonl(SINGLES_PATH)
    me_to_singles = load_json(ME_TO_SINGLES_PATH)
    city_plan = load_json(CITY_PLAN_PATH)

    registry_by_id = {r["id"]: r for r in registry}
    singles_by_id = {s["id"]: s for s in singles}
    singles_path_index: dict[str, str] = {}
    for s in singles:
        singles_path_index[path_to_img(s["path"])] = s["id"]

    links = me_to_singles.get("links", {})

    stamps = city_plan.get("stamps", [])
    anims = city_plan.get("anims", [])
    anim_bands = city_plan.get("animBands", [])

    used_exs_ids: set[str] = set()
    used_me_ids_direct: set[str] = set()
    non_catalog_used_images: set[str] = set()
    unresolved_used_images: set[str] = set()

    for stamp in stamps:
        if stamp.get("me"):
            used_me_ids_direct.add(stamp["me"])
        exs_id = stamp.get("exs")
        if exs_id:
            used_exs_ids.add(exs_id)
            continue
        img = stamp.get("img")
        if not img:
            continue
        resolved = singles_path_index.get(img)
        if resolved:
            used_exs_ids.add(resolved)
        elif img.startswith("ext/singles/"):
            unresolved_used_images.add(img)
        else:
            # Interior / farm / other packs outside this catalog's scope.
            non_catalog_used_images.add(img)

    # me.* usage flows through the Singles that vision-linked them, since the
    # overwhelming majority of live stamps are legacy raw `img` paths with no
    # `me` tag at all (923 / 1215 in the current plan).
    used_me_ids: set[str] = set(used_me_ids_direct)
    for exs_id in used_exs_ids:
        row = singles_by_id.get(exs_id)
        if row:
            vl = row.get("vision_link") or {}
            me_id = vl.get("me_id")
            if me_id:
                used_me_ids.add(me_id)

    all_me_ids = set(registry_by_id.keys())
    unused_me_ids = all_me_ids - used_me_ids
    all_exs_ids = set(singles_by_id.keys())
    unused_exs_ids = all_exs_ids - used_exs_ids

    # ---- by category (me.*) --------------------------------------------
    by_category: dict[str, dict] = {}
    cat_totals: Counter = Counter()
    cat_used: Counter = Counter()
    for r in registry:
        cat_totals[r["category"]] += 1
        if r["id"] in used_me_ids:
            cat_used[r["category"]] += 1
    for cat, total in sorted(cat_totals.items()):
        used = cat_used.get(cat, 0)
        by_category[cat] = {
            "me_total": total,
            "me_used": used,
            "me_unused": total - used,
            "pct_used": pct(used, total),
        }

    # ---- by theme (me.* + exs.*) ----------------------------------------
    by_theme: dict[str, dict] = {}
    theme_me_total: Counter = Counter()
    theme_me_used: Counter = Counter()
    for r in registry:
        theme_me_total[r["sheet"]] += 1
        if r["id"] in used_me_ids:
            theme_me_used[r["sheet"]] += 1

    theme_exs_total: Counter = Counter()
    theme_exs_used: Counter = Counter()
    for s in singles:
        theme_exs_total[s["sheet"]] += 1
        if s["id"] in used_exs_ids:
            theme_exs_used[s["sheet"]] += 1

    all_themes = sorted(set(theme_me_total) | set(theme_exs_total))
    for theme in all_themes:
        me_total = theme_me_total.get(theme, 0)
        me_used = theme_me_used.get(theme, 0)
        exs_total = theme_exs_total.get(theme, 0)
        exs_used = theme_exs_used.get(theme, 0)
        by_theme[theme] = {
            "me_total": me_total,
            "me_used": me_used,
            "me_unused": me_total - me_used,
            "me_pct_used": pct(me_used, me_total),
            "exs_total": exs_total,
            "exs_used": exs_used,
            "exs_unused": exs_total - exs_used,
            "exs_pct_used": pct(exs_used, exs_total),
        }

    # ---- Tier A: buildings / landmarks -----------------------------------
    building_ids = [r["id"] for r in registry if r["category"] == "building"]
    building_used = [i for i in building_ids if i in used_me_ids]
    tier_a = {
        "label": "Buildings / landmarks",
        "target": "100% me.* building category placed somewhere",
        "me_total": len(building_ids),
        "me_used": len(building_used),
        "me_unused": len(building_ids) - len(building_used),
        "pct_used": pct(len(building_used), len(building_ids)),
        "target_met": len(building_used) == len(building_ids) and len(building_ids) > 0,
    }

    # ---- Tier B: props / trees / vehicles ---------------------------------
    tier_b_ids = [r["id"] for r in registry if r["category"] in TIER_B_CATEGORIES]
    tier_b_used = [i for i in tier_b_ids if i in used_me_ids]
    tier_b = {
        "label": "Props / trees / vehicles (role-tagged placeables)",
        "categories": sorted(TIER_B_CATEGORIES),
        "target": ">=90% role-tagged placeables used",
        "me_total": len(tier_b_ids),
        "me_used": len(tier_b_used),
        "me_unused": len(tier_b_ids) - len(tier_b_used),
        "pct_used": pct(len(tier_b_used), len(tier_b_ids)),
        "target_met": pct(len(tier_b_used), len(tier_b_ids)) >= 90.0,
    }

    # ---- Tier C: color variant families -----------------------------------
    families: dict[tuple, list[str]] = defaultdict(list)
    for r in registry:
        families[variant_family_key(r)].append(r["id"])
    variant_families = {k: v for k, v in families.items() if len(v) > 1}
    families_with_use = 0
    families_without_use = 0
    zero_use_examples = []
    for key, members in variant_families.items():
        if any(m in used_me_ids for m in members):
            families_with_use += 1
        else:
            families_without_use += 1
            if len(zero_use_examples) < 20:
                zero_use_examples.append({"family": "_".join(key[2:]) or key[2], "sheet": key[0], "category": key[1], "members": members})
    tier_c = {
        "label": "Color variant families",
        "target": ">=1 use per variant family across biomes",
        "method": "heuristic: me.* ids grouped by (sheet, category, id-with-color/facing/index tokens stripped); families = groups with >1 member",
        "variant_families_total": len(variant_families),
        "variant_families_with_use": families_with_use,
        "variant_families_without_use": families_without_use,
        "pct_families_with_use": pct(families_with_use, len(variant_families)),
        "target_met": families_without_use == 0,
        "zero_use_family_examples": zero_use_examples,
    }

    # ---- Tier D: fragments (group-only components) -------------------------
    fragments = [s for s in singles if s.get("likely_fragment")]
    fragment_ids = {s["id"] for s in fragments}
    used_fragments = fragment_ids & used_exs_ids
    tier_d = {
        "label": "Fragments (group-only components)",
        "target": "fragments are never placed as a solo stamp (group-recipe usage only)",
        "exs_fragments_total": len(fragment_ids),
        "exs_fragments_used": len(used_fragments),
        "exs_fragments_unused": len(fragment_ids) - len(used_fragments),
        "pct_used": pct(len(used_fragments), len(fragment_ids)),
        "note": (
            "Group recipes (grp.*, Wave 1/2) do not exist yet, so every currently-used "
            "fragment is by definition a solo stamp today -- this is a baseline inventory, "
            "not yet a pass/fail QA gate. Re-check once W2 compiler ships grp.* usage."
        ),
    }

    # ---- Tier E: animated coverage per theme --------------------------------
    anim_rows = anims + anim_bands
    anim_sheet_basenames = sorted({row["sheet"].rsplit("/", 1)[-1] for row in anim_rows if row.get("sheet")})
    anim_sheets_lower = [b.lower() for b in anim_sheet_basenames]

    theme_anim_hits: dict[str, list[str]] = {}
    themes_with_anim = 0
    for theme, keywords in THEME_ANIM_KEYWORDS.items():
        hits = []
        if keywords:
            for basename, lower in zip(anim_sheet_basenames, anim_sheets_lower):
                if any(kw in lower for kw in keywords):
                    hits.append(basename)
        theme_anim_hits[theme] = hits
        if hits:
            themes_with_anim += 1

    matched_basenames = {b for hits in theme_anim_hits.values() for b in hits}
    uncategorized_anim_assets = sorted(set(anim_sheet_basenames) - matched_basenames)

    tier_e = {
        "label": "Animated coverage per theme sheet",
        "target": ">=1 anim per theme sheet in matching biome",
        "method": "heuristic keyword match: ext/animated/*.png basenames vs per-theme keyword list (THEME_ANIM_KEYWORDS); refine once animated assets carry theme/biome tags",
        "themes_total": len(THEME_ANIM_KEYWORDS),
        "themes_with_matched_anim": themes_with_anim,
        "themes_without_matched_anim": len(THEME_ANIM_KEYWORDS) - themes_with_anim,
        "pct_themes_covered": pct(themes_with_anim, len(THEME_ANIM_KEYWORDS)),
        "target_met": themes_with_anim == len(THEME_ANIM_KEYWORDS),
        "distinct_animated_sheets_in_city_plan": len(anim_sheet_basenames),
        "anim_rows_in_city_plan": len(anim_rows),
        "themes_missing_anim": sorted(t for t, hits in theme_anim_hits.items() if not hits),
        "uncategorized_animated_assets": uncategorized_anim_assets,
    }

    # ---- Orphans: top unused buildings --------------------------------------
    orphan_buildings = []
    for r in registry:
        if r["category"] != "building" or r["id"] not in unused_me_ids:
            continue
        available = links.get(r["id"], [])
        orphan_buildings.append({
            "id": r["id"],
            "name": r.get("name"),
            "sheet": r.get("sheet"),
            "tags": r.get("tags", []),
            "multi_tile": r.get("multi_tile", False),
            "available_singles": len(available),
        })
    # Ready-to-place orphans (have a linked Single already) surface first --
    # those are pure "cataloged but never stamped" gaps, most actionable.
    orphan_buildings.sort(key=lambda o: (-1 if o["available_singles"] > 0 else 0, -o["available_singles"], o["sheet"], o["id"]))
    top_orphan_buildings = orphan_buildings[:top_orphans]

    orphan_theme_counts = Counter(o["sheet"] for o in orphan_buildings)
    top_orphan_themes = [
        {"sheet": sheet, "unused_building_count": count, "building_total": theme_me_total.get(sheet, 0) and sum(1 for r in registry if r["sheet"] == sheet and r["category"] == "building")}
        for sheet, count in orphan_theme_counts.most_common(5)
    ]

    generated_at = datetime.now(timezone.utc).isoformat()

    report = {
        "generated_at": generated_at,
        "sources": {
            "registry": {"path": str(REGISTRY_PATH.relative_to(DEN)), "count": len(registry)},
            "ext_singles_pixelperfect": {"path": str(SINGLES_PATH.relative_to(DEN)), "count": len(singles)},
            "me_to_singles": {"path": str(ME_TO_SINGLES_PATH.relative_to(DEN)), "me_count": me_to_singles.get("me_count"), "linked_singles": me_to_singles.get("linked_singles")},
            "city_plan": {"path": str(CITY_PLAN_PATH.relative_to(DEN)), "stamps": len(stamps), "anims": len(anims), "anim_bands": len(anim_bands)},
        },
        "totals": {
            "me_total": len(all_me_ids),
            "me_linked_to_any_single": len(links),
            "me_used": len(used_me_ids),
            "me_unused": len(unused_me_ids),
            "me_pct_used": pct(len(used_me_ids), len(all_me_ids)),
            "exs_total": len(all_exs_ids),
            "exs_used": len(used_exs_ids),
            "exs_unused": len(unused_exs_ids),
            "exs_pct_used": pct(len(used_exs_ids), len(all_exs_ids)),
            "city_plan_stamps_total": len(stamps),
            "city_plan_unique_images": len({s.get("img") for s in stamps if s.get("img")}),
            "city_plan_images_outside_ext_catalog_scope": len(non_catalog_used_images),
            "city_plan_unresolved_ext_singles_images": len(unresolved_used_images),
        },
        "usage_resolution": {
            "method": (
                "A Single is 'used' if referenced directly by stamp.exs, or if stamp.img "
                "(legacy raw path, no me/exs tag) matches a catalog Single's path. A me.* is "
                "'used' if referenced directly by stamp.me, or if any Single vision-linked to "
                "it is used."
            ),
            "images_outside_ext_catalog_scope_sample": sorted(non_catalog_used_images)[:20],
            "unresolved_ext_singles_images_sample": sorted(unresolved_used_images)[:20],
        },
        "by_category": by_category,
        "by_theme": by_theme,
        "tiers": {
            "A_buildings": tier_a,
            "B_props_trees_vehicles": tier_b,
            "C_color_variants": tier_c,
            "D_fragments": tier_d,
            "E_animated": tier_e,
        },
        "orphans": {
            "unused_buildings_total": len(orphan_buildings),
            f"top_{top_orphans}_unused_buildings": top_orphan_buildings,
            "top_5_orphan_themes_by_unused_building_count": top_orphan_themes,
        },
    }
    return report


def print_summary(report: dict) -> None:
    t = report["totals"]
    print("=" * 72)
    print("EXT CATALOG COVERAGE REPORT")
    print("=" * 72)
    print(f"generated_at: {report['generated_at']}")
    print()
    print(f"me.*  total={t['me_total']:>5}  used={t['me_used']:>5}  unused={t['me_unused']:>5}  ({t['me_pct_used']}% used)")
    print(f"exs.* total={t['exs_total']:>5}  used={t['exs_used']:>5}  unused={t['exs_unused']:>5}  ({t['exs_pct_used']}% used)")
    print(f"city-plan stamps: {t['city_plan_stamps_total']} ({t['city_plan_unique_images']} unique images; "
          f"{t['city_plan_images_outside_ext_catalog_scope']} outside ext catalog scope)")
    print()
    print("-" * 72)
    print("TIER SUMMARY (A-E, per EXTERIOR-PLACEMENT-BRAIN-PLAN.md)")
    print("-" * 72)
    tiers = report["tiers"]

    a = tiers["A_buildings"]
    print(f"[A] Buildings/landmarks   {a['me_used']:>4}/{a['me_total']:<4} used ({a['pct_used']}%)  "
          f"target: {a['target']}  -> {'MET' if a['target_met'] else 'NOT MET'}")

    b = tiers["B_props_trees_vehicles"]
    print(f"[B] Props/trees/vehicles  {b['me_used']:>4}/{b['me_total']:<4} used ({b['pct_used']}%)  "
          f"target: {b['target']}  -> {'MET' if b['target_met'] else 'NOT MET'}")

    c = tiers["C_color_variants"]
    print(f"[C] Color variant fams    {c['variant_families_with_use']:>4}/{c['variant_families_total']:<4} "
          f"have >=1 use ({c['pct_families_with_use']}%)  target: {c['target']}  -> "
          f"{'MET' if c['target_met'] else 'NOT MET'}")

    d = tiers["D_fragments"]
    print(f"[D] Fragments (group-only) {d['exs_fragments_used']:>4}/{d['exs_fragments_total']:<4} "
          f"used ({d['pct_used']}%)  target: {d['target']}  -> baseline inventory only (no grp.* yet)")

    e = tiers["E_animated"]
    print(f"[E] Animated per theme    {e['themes_with_matched_anim']:>4}/{e['themes_total']:<4} "
          f"themes covered ({e['pct_themes_covered']}%)  target: {e['target']}  -> "
          f"{'MET' if e['target_met'] else 'NOT MET'} (heuristic)")

    print()
    print("-" * 72)
    print(f"ORPHANS: top unused buildings (of {report['orphans']['unused_buildings_total']} total)")
    print("-" * 72)
    key = [k for k in report["orphans"] if k.startswith("top_") and k.endswith("_unused_buildings")][0]
    for o in report["orphans"][key][:15]:
        avail = f"{o['available_singles']} singles avail" if o["available_singles"] else "no singles matched"
        print(f"  {o['id']:<55} [{o['sheet']}] ({avail})")
    if len(report["orphans"][key]) > 15:
        print(f"  ... and {len(report['orphans'][key]) - 15} more in coverage-report.json")

    print()
    print("Top 5 orphan themes (by unused building count):")
    for row in report["orphans"]["top_5_orphan_themes_by_unused_building_count"]:
        print(f"  {row['sheet']:<30} {row['unused_building_count']:>3} unused / {row['building_total']} total buildings")
    print("=" * 72)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--top-orphans", type=int, default=50, help="how many unused buildings to list (default: 50)")
    args = ap.parse_args()

    report = build_report(top_orphans=args.top_orphans)
    OUT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print_summary(report)
    print(f"\nWrote {OUT_PATH.relative_to(DEN)}")


if __name__ == "__main__":
    main()
