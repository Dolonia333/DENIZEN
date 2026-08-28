#!/usr/bin/env python3
"""Gate check for W1-B's data/limezu-visual-catalog/variant-palette-map.json.

Cross-checks the generated variant/palette scoring table against the
read-only source of truth, placement-rules.json:

  TOKENS    every color_token in the map exists in placement-rules
            color_tokens, and vice versa (no drift)
  PALETTES  every palette id referenced anywhere in the map (palettes,
            token_to_palettes, variant_families.palette_by_color) exists in
            placement-rules.json's palettes
  COVERAGE  token_to_palettes has a (non-empty) entry for all 22 color_tokens
  WEIGHTS   each palette's token_weights/avoid entries are a lossless copy of
            placement-rules.json (W1-B must never mutate the source palettes)
  FAMILIES  every variant_families entry's base/color_axis/palette_by_color
            is internally consistent (base+"_*" key, axis colors covered by
            palette_by_color subset, referenced palettes valid)

Usage:
  python3 scripts/validate-variant-palette-map.py
Exit code 1 on any error.
"""

import json
import os
import sys

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(DEN, "data", "limezu-visual-catalog")
RULES_PATH = os.path.join(CAT, "placement-rules.json")
MAP_PATH = os.path.join(CAT, "variant-palette-map.json")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check_tokens(rules, vmap, errors):
    rules_tokens = set(rules["color_tokens"])
    map_tokens = set(vmap.get("color_tokens", []))
    missing = rules_tokens - map_tokens
    extra = map_tokens - rules_tokens
    if missing:
        errors.append(f"TOKENS map is missing color_tokens present in placement-rules: {sorted(missing)}")
    if extra:
        errors.append(f"TOKENS map has color_tokens not in placement-rules: {sorted(extra)}")
    print(f"TOKENS  {len(map_tokens)} token(s) in map, {len(rules_tokens)} in placement-rules, "
          f"{len(missing)} missing / {len(extra)} extra")
    return rules_tokens


def check_palette_ids(rules, vmap, errors):
    rules_palette_ids = {pid for pid in rules["palettes"] if pid != "_doc"}
    map_palette_ids = {pid for pid in vmap.get("palettes", {})}

    missing = rules_palette_ids - map_palette_ids
    extra = map_palette_ids - rules_palette_ids
    if missing:
        errors.append(f"PALETTES map is missing palette ids present in placement-rules: {sorted(missing)}")
    if extra:
        errors.append(f"PALETTES map has palette ids not in placement-rules (never modify placement-rules.json): {sorted(extra)}")

    referenced = set()
    for tok, entries in vmap.get("token_to_palettes", {}).items():
        for e in entries:
            referenced.add(e.get("palette"))
    for fam_key, fam in vmap.get("variant_families", {}).items():
        for _color, pals in fam.get("palette_by_color", {}).items():
            referenced.update(pals)

    unknown_refs = referenced - rules_palette_ids
    if unknown_refs:
        errors.append(f"PALETTES token_to_palettes/palette_by_color reference unknown palette ids: {sorted(unknown_refs)}")

    print(f"PALETTES {len(map_palette_ids)} palette(s) in map, {len(rules_palette_ids)} in placement-rules, "
          f"{len(missing)} missing / {len(extra)} extra / {len(unknown_refs)} unknown refs")
    return rules_palette_ids


def check_coverage(rules_tokens, vmap, errors):
    ttp = vmap.get("token_to_palettes", {})
    missing = [t for t in sorted(rules_tokens) if t not in ttp]
    empty = [t for t in sorted(rules_tokens) if t in ttp and not ttp[t]]
    if missing:
        errors.append(f"COVERAGE token_to_palettes missing key(s) for color_token(s): {missing}")
    if empty:
        errors.append(f"COVERAGE token_to_palettes has empty entry for color_token(s): {empty}")
    print(f"COVERAGE token_to_palettes covers {len(ttp) - len(empty)}/{len(rules_tokens)} color_tokens "
          f"({len(missing)} missing key, {len(empty)} empty)")


def check_weights_unmodified(rules, vmap, errors):
    rules_palettes = {pid: p for pid, p in rules["palettes"].items() if pid != "_doc"}
    map_palettes = vmap.get("palettes", {})
    mismatches = 0
    for pid, rp in rules_palettes.items():
        mp = map_palettes.get(pid)
        if mp is None:
            continue  # already reported by check_palette_ids
        if mp.get("token_weights") != rp["tokens"]:
            errors.append(f"WEIGHTS palettes.{pid}.token_weights diverges from placement-rules.palettes.{pid}.tokens")
            mismatches += 1
        if sorted(mp.get("avoid", [])) != sorted(rp.get("avoid", [])):
            errors.append(f"WEIGHTS palettes.{pid}.avoid diverges from placement-rules.palettes.{pid}.avoid")
            mismatches += 1
    print(f"WEIGHTS {mismatches} mismatch(es) against placement-rules.json (should be a read-only copy)")


def check_families(rules_tokens, rules_palette_ids, vmap, errors):
    families = vmap.get("variant_families", {})
    bad_key = 0
    bad_axis_token = 0
    bad_palette_ref = 0
    for fam_key, fam in families.items():
        base = fam.get("base", "")
        if fam_key != f"{base}_*":
            errors.append(f"FAMILIES key '{fam_key}' does not match base '{base}' + '_*'")
            bad_key += 1
        axis = fam.get("color_axis", [])
        if len(set(axis)) < 2:
            errors.append(f"FAMILIES {fam_key} has < 2 distinct color_axis values: {axis}")
        pbc = fam.get("palette_by_color", {})
        for color in pbc:
            if color not in axis:
                errors.append(f"FAMILIES {fam_key} palette_by_color key '{color}' not in its own color_axis")
        for color, pals in pbc.items():
            for p in pals:
                if p not in rules_palette_ids:
                    bad_palette_ref += 1
                    errors.append(f"FAMILIES {fam_key}.palette_by_color.{color} references unknown palette '{p}'")
    print(f"FAMILIES {len(families)} variant famil(y/ies): {bad_key} bad key(s), {bad_palette_ref} bad palette ref(s)")


def main():
    if not os.path.exists(MAP_PATH):
        print(f"FAIL variant-palette-map.json not found at {MAP_PATH}")
        sys.exit(1)

    rules = load(RULES_PATH)
    vmap = load(MAP_PATH)
    errors = []

    rules_tokens = check_tokens(rules, vmap, errors)
    rules_palette_ids = check_palette_ids(rules, vmap, errors)
    check_coverage(rules_tokens, vmap, errors)
    check_weights_unmodified(rules, vmap, errors)
    check_families(rules_tokens, rules_palette_ids, vmap, errors)

    for e in errors:
        print(f"  {e}")
    ok = not errors
    print("OK" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
