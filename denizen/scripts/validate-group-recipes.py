#!/usr/bin/env python3
"""Validate data/limezu-visual-catalog/groups/grp.*.json group recipe files.

Checks, for every grp.<biome>.<slug>.json file in the groups/ directory:
  - the file is valid JSON with the required top-level keys
  - `id` matches the filename (grp.<biome>.<slug>)
  - `biome` matches an id in placement-rules.json's `biomes` map (with a
    tolerant fallback: LimeZu theme-domain slugs like "camping"/"subway"/
    "worksite"/"graveyard" that the existing reference grp.* files and
    group-candidates.json already use, in addition to the strict L3 biome
    ids such as "wild"/"transit"/"industrial"/"memorial")
  - every `source_me_ids` entry and every `pieces[].me` exists in
    registry.jsonl
  - every `pieces[].exs` exists in placement-index.json or in
    ext-singles-pixelperfect.jsonl
  - every `pieces[].w` / `pieces[].h` matches the known size for that exs
    when the singles catalogs report one (dimension sanity check)
  - `pieces[].dx` / `pieces[].dy` are integers (tile offsets, not pixels)
  - `footprint_tiles.w` / `footprint_tiles.h` are positive

Exits non-zero if any file fails validation.
"""
import json
import os
import sys

CATALOG_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "limezu-visual-catalog")
GROUPS_DIR = os.path.join(CATALOG_DIR, "groups")

# LimeZu theme-domain slugs used by the existing grp.* files / group-candidates.json.
# These are a coarser vocabulary than the L3 "biomes" map in placement-rules.json
# (e.g. "camping" -> L3 "wild", "subway" -> L3 "transit", "worksite" -> L3
# "industrial", "graveyard" -> L3 "memorial"). Both are accepted so this
# validator doesn't flag the pre-existing reference files.
THEME_DOMAIN_BIOME_ALIASES = {
    "camping", "subway", "worksite", "graveyard", "beach",
}


def load_json(path):
    with open(path) as f:
        return json.load(f)


def load_jsonl(path):
    out = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def main():
    errors = []
    warnings = []

    registry = load_jsonl(os.path.join(CATALOG_DIR, "registry.jsonl"))
    me_ids = {r["id"] for r in registry}

    placement_index = load_json(os.path.join(CATALOG_DIR, "placement-index.json"))
    exs_from_placement_index = set()
    for me_id, info in placement_index.get("me", {}).items():
        exs = info.get("exs")
        if exs:
            exs_from_placement_index.add(exs)

    pixelperfect = load_jsonl(os.path.join(CATALOG_DIR, "ext-singles-pixelperfect.jsonl"))
    exs_sizes = {}
    known_exs_ids = set()
    for r in pixelperfect:
        known_exs_ids.add(r["id"])
        if r.get("w") is not None and r.get("h") is not None:
            exs_sizes[r["id"]] = (r["w"], r["h"])
    known_exs_ids |= exs_from_placement_index

    placement_rules = load_json(os.path.join(CATALOG_DIR, "placement-rules.json"))
    valid_biomes = set(placement_rules.get("biomes", {}).keys()) - {"_doc"}
    valid_biomes |= THEME_DOMAIN_BIOME_ALIASES

    group_files = sorted(
        f for f in os.listdir(GROUPS_DIR) if f.startswith("grp.") and f.endswith(".json")
    )
    if not group_files:
        print("No grp.*.json files found in", GROUPS_DIR)
        sys.exit(1)

    seen_ids = {}
    total_pieces = 0

    for fname in group_files:
        path = os.path.join(GROUPS_DIR, fname)
        prefix = f"[{fname}]"
        try:
            g = load_json(path)
        except Exception as e:
            errors.append(f"{prefix} invalid JSON: {e}")
            continue

        for key in ("id", "biome", "source_me_ids", "footprint_tiles", "pieces"):
            if key not in g:
                errors.append(f"{prefix} missing required key '{key}'")
        if "pieces" not in g:
            continue

        gid = g.get("id")
        expected_id = os.path.splitext(fname)[0]
        if gid != expected_id:
            errors.append(f"{prefix} id '{gid}' does not match filename '{expected_id}'")

        if gid:
            if gid in seen_ids:
                errors.append(f"{prefix} duplicate id '{gid}' also used by {seen_ids[gid]}")
            seen_ids[gid] = fname

        biome = g.get("biome")
        if biome not in valid_biomes:
            errors.append(
                f"{prefix} biome '{biome}' not in placement-rules.json biomes "
                f"and not a recognized theme-domain alias {sorted(THEME_DOMAIN_BIOME_ALIASES)}"
            )

        for me_id in g.get("source_me_ids", []):
            if me_id not in me_ids:
                errors.append(f"{prefix} source_me_ids references unknown me id '{me_id}'")

        ft = g.get("footprint_tiles", {})
        for dim in ("w", "h"):
            v = ft.get(dim)
            if not isinstance(v, (int, float)) or v <= 0:
                errors.append(f"{prefix} footprint_tiles.{dim} must be a positive number, got {v!r}")

        pieces = g.get("pieces", [])
        if not pieces:
            errors.append(f"{prefix} has no pieces")
        total_pieces += len(pieces)

        piece_me_ids = set()
        for i, p in enumerate(pieces):
            ploc = f"{prefix} pieces[{i}] (role={p.get('role')!r})"

            me_id = p.get("me")
            if me_id not in me_ids:
                errors.append(f"{ploc} me id '{me_id}' not found in registry.jsonl")
            else:
                piece_me_ids.add(me_id)

            exs_id = p.get("exs")
            if exs_id not in known_exs_ids:
                errors.append(
                    f"{ploc} exs id '{exs_id}' not found in placement-index.json or "
                    f"ext-singles-pixelperfect.jsonl"
                )
            else:
                known_size = exs_sizes.get(exs_id)
                if known_size and (p.get("w"), p.get("h")) != known_size:
                    warnings.append(
                        f"{ploc} w/h ({p.get('w')},{p.get('h')}) does not match "
                        f"ext-singles-pixelperfect size {known_size} for '{exs_id}'"
                    )

            for dim in ("dx", "dy"):
                v = p.get(dim)
                if not isinstance(v, int):
                    errors.append(f"{ploc} {dim} must be an integer tile offset, got {v!r}")

            basis = p.get("offset_basis")
            if basis not in ("sheet_relative", "authored"):
                errors.append(f"{ploc} offset_basis must be 'sheet_relative' or 'authored', got {basis!r}")

        missing_source = piece_me_ids - set(g.get("source_me_ids", []))
        if missing_source:
            warnings.append(
                f"{prefix} pieces reference me ids not listed in source_me_ids: {sorted(missing_source)}"
            )

    print(f"Checked {len(group_files)} group file(s), {total_pieces} total pieces.")

    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings:
            print("  WARN:", w)

    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print("  ERROR:", e)
        sys.exit(1)

    print("\nAll group recipes valid.")


if __name__ == "__main__":
    main()
