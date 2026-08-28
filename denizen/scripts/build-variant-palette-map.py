#!/usr/bin/env python3
"""W1-B: build variant-palette-map.json for the exterior placement brain.

Reads (read-only):
  data/limezu-visual-catalog/placement-rules.json    (palettes, color_tokens)
  data/limezu-visual-catalog/registry.jsonl          (me.* ids + tags)
  data/limezu-visual-catalog/ext-singles-pixelperfect.jsonl  (exs.* ids/basenames,
                                                               optional bonus scan)

Writes:
  data/limezu-visual-catalog/variant-palette-map.json

Logic (see EXTERIOR-PLACEMENT-BRAIN-PLAN.md W1-B):
  1. Copy placement-rules.json palette token_weights/avoid as the base (read-only,
     never mutates placement-rules.json itself).
  2. Scan every me.* id + tags and every exs.* id/basename for occurrences of the
     22 color_tokens to find which tokens are actually attested in the catalog.
  3. Build a token_to_palettes reverse index: for each color token, every palette
     that scores it, sorted by weight desc (ties broken alphabetically by palette
     id for determinism).
  4. Detect variant families: me.* ids that share a prefix once a trailing
     direction word (north/south/east/west/...) and a trailing color word
     (optionally a `<modifier>_<token>` compound like `dark_green`) are peeled
     off, e.g. `me.vehicles.compact_blue_east` -> base `me.vehicles.compact`,
     color `blue`.
  5. For the top 30 variant families (ranked by axis size then sibling count),
     emit color_axis + a palette_by_color suggestion: the palette(s) that hit the
     *maximum* weight this palette family assigns to that token (ties kept,
     sorted alphabetically).

Usage:
  python3 scripts/build-variant-palette-map.py
"""

import collections
import json
import os
import re

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(DEN, "data", "limezu-visual-catalog")
RULES_PATH = os.path.join(CAT, "placement-rules.json")
REGISTRY_PATH = os.path.join(CAT, "registry.jsonl")
PIXELPERFECT_PATH = os.path.join(CAT, "ext-singles-pixelperfect.jsonl")
OUT_PATH = os.path.join(CAT, "variant-palette-map.json")

TOP_N_FAMILIES = 30

DIRECTION_WORDS = {
    "north", "south", "east", "west",
    "northeast", "northwest", "southeast", "southwest",
    "up", "down", "left", "right", "front", "back",
}

# Modifiers that combine with a base color_token to form a compound axis value
# actually seen in registry.jsonl tags (e.g. "dark_green", "light_grey",
# "teal_blue", "tan_brown") — kept broad so unseen-but-plausible LimeZu
# variants (navy, olive, etc.) still parse correctly.
MODIFIER_WORDS = {
    "dark", "light", "bright", "pale", "deep", "navy", "sky", "tan", "teal",
    "lime", "olive", "beige", "maroon", "turquoise", "mint", "coral",
    "charcoal", "ivory", "khaki", "burgundy",
}


def _words_of(text):
    """Split a dotted/underscored id or tag into lowercase word tokens."""
    out = []
    for seg in text.split("."):
        out.extend(seg.split("_"))
    return [w for w in out if w]


def _tokens_present(words, color_token_set):
    return {w for w in words if w in color_token_set}


def parse_variant(full_id, color_token_set):
    """Peel a trailing direction word then a trailing color word off full_id's
    last dotted segment. Returns {base, color, direction} or None."""
    parts = full_id.split(".")
    if len(parts) < 3:
        return None
    prefix = ".".join(parts[:-1])
    words = parts[-1].split("_")
    if not words:
        return None

    direction = None
    if words[-1] in DIRECTION_WORDS:
        direction = words.pop()

    color = None
    if len(words) >= 2 and words[-1] in color_token_set and words[-2] in MODIFIER_WORDS:
        color = f"{words[-2]}_{words[-1]}"
        words = words[:-2]
    elif words and words[-1] in color_token_set:
        color = words[-1]
        words = words[:-1]

    if color is None or not words:
        return None

    base = prefix + "." + "_".join(words)
    return {"base": base, "color": color, "direction": direction}


def base_token_for(color_word, color_token_set):
    """Map a (possibly compound) axis color value back to a canonical
    placement-rules color_token for palette lookup."""
    if color_word in color_token_set:
        return color_word
    if "_" in color_word:
        _, _, rest = color_word.rpartition("_")
        if rest in color_token_set:
            return rest
    return None


def build_token_to_palettes(color_tokens, palettes):
    token_to_palettes = {}
    for tok in color_tokens:
        entries = []
        for pid, p in palettes.items():
            weight = p["tokens"].get(tok)
            if weight is not None:
                entries.append({"palette": pid, "weight": weight})
        entries.sort(key=lambda e: (-e["weight"], e["palette"]))
        token_to_palettes[tok] = entries
    return token_to_palettes


def max_weight_palettes(token, token_to_palettes):
    entries = token_to_palettes.get(token, [])
    if not entries:
        return []
    mx = max(e["weight"] for e in entries)
    return sorted(e["palette"] for e in entries if e["weight"] == mx)


def scan_me_rows(rows, color_token_set):
    me_with_token = 0
    tokens_found = set()
    for r in rows:
        words = _words_of(r["id"])
        for t in r.get("tags", []):
            words.extend(_words_of(t))
        found = _tokens_present(words, color_token_set)
        if found:
            me_with_token += 1
            tokens_found |= found
    return me_with_token, tokens_found


def scan_exs_singles(color_token_set):
    """Optional bonus scan: exs.* ids/basenames in ext-singles-pixelperfect.jsonl."""
    exs_total = 0
    exs_with_token = 0
    tokens_found = set()
    if not os.path.exists(PIXELPERFECT_PATH):
        return exs_total, exs_with_token, tokens_found

    with open(PIXELPERFECT_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            exs_total += 1
            words = _words_of(row.get("id", ""))
            basename = re.sub(r"\.png$", "", row.get("basename", ""), flags=re.IGNORECASE)
            words.extend(_words_of(basename.lower()))
            found = _tokens_present(words, color_token_set)
            if found:
                exs_with_token += 1
                tokens_found |= found
    return exs_total, exs_with_token, tokens_found


def detect_variant_families(rows, color_token_set):
    families = collections.defaultdict(lambda: {"colors": set(), "ids": []})
    for r in rows:
        parsed = parse_variant(r["id"], color_token_set)
        if not parsed:
            continue
        fam = families[parsed["base"]]
        fam["colors"].add(parsed["color"])
        fam["ids"].append(r["id"])
    # A genuine "variant family" needs >=2 distinct color siblings; a single
    # color word on an otherwise-unique id is not a color axis.
    return {b: v for b, v in families.items() if len(v["colors"]) >= 2}


def build():
    rules = json.load(open(RULES_PATH, encoding="utf-8"))
    color_tokens = list(rules["color_tokens"])
    color_token_set = set(color_tokens)
    palettes_in = {pid: p for pid, p in rules["palettes"].items() if pid != "_doc"}

    rows = [json.loads(line) for line in open(REGISTRY_PATH, encoding="utf-8") if line.strip()]

    token_to_palettes = build_token_to_palettes(color_tokens, palettes_in)

    me_with_token, me_tokens_found = scan_me_rows(rows, color_token_set)
    exs_total, exs_with_token, exs_tokens_found = scan_exs_singles(color_token_set)
    tokens_found_in_catalog = me_tokens_found | exs_tokens_found

    multi_families = detect_variant_families(rows, color_token_set)
    ranked = sorted(
        multi_families.items(),
        key=lambda kv: (-len(kv[1]["colors"]), -len(kv[1]["ids"]), kv[0]),
    )
    top_families = ranked[:TOP_N_FAMILIES]

    variant_families_out = {}
    for base, info in top_families:
        axis = sorted(info["colors"])
        palette_by_color = {}
        for c in axis:
            bt = base_token_for(c, color_token_set)
            pals = max_weight_palettes(bt, token_to_palettes) if bt else []
            if pals:
                palette_by_color[c] = pals
        variant_families_out[f"{base}_*"] = {
            "base": base,
            "color_axis": axis,
            "palette_by_color": palette_by_color,
        }

    out_palettes = {}
    for pid, p in palettes_in.items():
        entry = {
            "label": p.get("label", pid),
            "token_weights": dict(p["tokens"]),
            "avoid": list(p.get("avoid", [])),
        }
        if "notes" in p:
            entry["notes"] = p["notes"]
        out_palettes[pid] = entry

    return {
        "version": "0.1.0",
        "generated_by": "W1-B",
        "source": {
            "placement_rules": "data/limezu-visual-catalog/placement-rules.json",
            "registry": "data/limezu-visual-catalog/registry.jsonl",
            "ext_singles_pixelperfect": "data/limezu-visual-catalog/ext-singles-pixelperfect.jsonl",
        },
        "color_tokens": color_tokens,
        "palettes": out_palettes,
        "token_to_palettes": token_to_palettes,
        "variant_families": variant_families_out,
        "stats": {
            "tokens_found_in_catalog": len(tokens_found_in_catalog),
            "color_tokens_total": len(color_tokens),
            "me_total": len(rows),
            "me_with_color_token": me_with_token,
            "exs_total": exs_total,
            "exs_with_color_token": exs_with_token,
            "variant_families_detected": len(multi_families),
            "variant_families_emitted": len(variant_families_out),
        },
    }


def main():
    output = build()
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, sort_keys=False)
        f.write("\n")
    print(f"wrote {OUT_PATH}")
    print(json.dumps(output["stats"], indent=2))


if __name__ == "__main__":
    main()
