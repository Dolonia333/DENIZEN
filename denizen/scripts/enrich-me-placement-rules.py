#!/usr/bin/env python3
"""W1-A: enrich every me.* in the visual catalog with placement semantics.

Reads registry.jsonl (2749 Modern Exteriors vision labels), replays the
placement-rules.json match->set rules over it exactly the way
validate-placement-rules.py's dry run does, and folds in the theme->biome
map, the surface/mount aliases, the palette colour tokens and the interact
contract to produce one enriched row per me.*:

  biome_primary   theme_biomes[sheet].primary
  biomes_allowed  primary + theme_biomes[sheet].also
  role            highest-priority matching rule, else a tag-aware
                  category->role map from roles.*.categories
  surface         registry.surface folded onto a canonical paintable
                  surface; wall/roof/air/ui mounts fall through to the
                  role's (then the biome's) first surface
  palette_affinity  biome palettes, minus palettes that `avoid` this
                  object's colours, plus palettes its colours score into
  color_tokens    colour words in the me id / tags and in the linked exs.*
                  Singles ids from me-to-singles.json
  interact        rule `set.interact`, else roles.*.interact_default, else
                  an interact contract whose roles + tags_any both match
  group_only      rule `set.group_only` or roles.*.group_only
  confidence      1.0 explicit rule match / 0.8 category map / 0.5 fallback

Usage:
  python3 scripts/enrich-me-placement-rules.py            # write the jsonl
  python3 scripts/enrich-me-placement-rules.py --stats    # coverage only
  python3 scripts/enrich-me-placement-rules.py --validate # exit 1 if <90%
Gate G1 wants >=90% of me.* to carry both a role and a biome_primary.
"""

import argparse
import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "data/limezu-visual-catalog"
REGISTRY = CATALOG / "registry.jsonl"
RULES = CATALOG / "placement-rules.json"
LINKS = CATALOG / "me-to-singles.json"
OUT = CATALOG / "me-placement-enriched.jsonl"

MIN_COVERAGE = 0.90
MAX_COLOR_TOKENS = 6
MAX_PALETTES = 4

# LimeZu vision labels use a couple of screen-space facings; the placement
# brain only speaks compass.
FACING_ALIASES = {"left": "west", "right": "east", "up": "north", "down": "south"}

WORD = re.compile(r"[^a-z0-9]+")


def keys(obj):
    return {k for k in obj if k != "_doc"}


def load_registry():
    rows = []
    with open(REGISTRY, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_links():
    with open(LINKS, encoding="utf-8") as f:
        return json.load(f)["links"]


def matches(m, row):
    """Same predicate as validate-placement-rules.py's dry run."""
    tags = set(row["tags"])
    if "categories" in m and row["category"] not in m["categories"]:
        return False
    if "sheets" in m and row["sheet"] not in m["sheets"]:
        return False
    if "roles" in m:
        return False  # role-based matching is a later enrichment pass
    if "tags_any" in m and not tags & set(m["tags_any"]):
        return False
    if "tags_all" in m and not set(m["tags_all"]) <= tags:
        return False
    if "tags_none" in m and tags & set(m["tags_none"]):
        return False
    if "surface_any" in m and row["surface"] not in m["surface_any"]:
        return False
    if "not_surface_any" in m and row["surface"] in m["not_surface_any"]:
        return False
    if "multi_tile" in m and bool(row["multi_tile"]) != m["multi_tile"]:
        return False
    if "band" in m and row["band"] not in m["band"]:
        return False
    if "id_prefix" in m and not row["id"].startswith(m["id_prefix"]):
        return False
    return True


def resolve_rules(ordered, row):
    """Replay the ordered rules; return the merged `set` plus what fired."""
    resolved, fired = {}, []
    for rule in ordered:
        if matches(rule["match"], row):
            resolved.update(rule["set"])
            fired.append(rule)
    return resolved, fired


def role_from_rules(fired):
    """Id of the last (highest-priority) rule that actually set the role."""
    for rule in reversed(fired):
        if "role" in rule["set"]:
            return rule["id"]
    return None


def category_role(rules, row):
    """Tag-aware fallback: best role among those claiming this category."""
    tags = set(row["tags"])
    best, best_score = None, -1
    for rid, role in rules["roles"].items():
        if rid == "_doc" or row["category"] not in role.get("categories", []):
            continue
        narrow = role.get("tags_any")
        # A role that names no tags is the generic home for the category; a
        # role that does only wins when the object actually carries a tag.
        score = 1 if not narrow else len(tags & set(narrow)) * 2
        if score > best_score:
            best, best_score = rid, score
    return best if best_score > 0 else None


def surface_folder(rules):
    """registry `surface` string -> canonical surface, or None for mounts."""
    fold = {}
    for sid, surf in rules["surfaces"].items():
        if sid == "_doc":
            continue
        for alias in surf["registry_aliases"]:
            fold[alias] = sid
    return fold


def pick_surface(rules, row, resolved, role, biome, fold, source):
    canonical = fold.get(row.get("surface"))
    if canonical:
        source.append("registry.surface")
        return canonical

    # The registry surface was a mount (wall / roof / air / ui) or unknown, so
    # fall through to what the rules, then the role, then the biome allow --
    # always preferring a surface the biome actually paints.
    in_biome = rules["biomes"].get(biome, {}).get("surfaces", [])
    for where, pool in (("rules.set.surfaces", resolved.get("surfaces", [])),
                        ("role.surfaces", rules["roles"].get(role, {}).get("surfaces", []))):
        usable = [s for s in pool if s in fold.values()]
        if not usable:
            continue
        source.append(where)
        return next((s for s in usable if s in in_biome), usable[0])
    if in_biome:
        source.append("biome.surfaces")
        return in_biome[0]
    source.append("surface.default")
    return "sidewalk"


def text_tokens(*parts):
    out = set()
    for part in parts:
        for tok in WORD.split(str(part).lower()):
            if tok:
                out.add(tok)
    return out


def color_tokens(rules, row, links, source):
    """Colour words on the me itself, then on its linked exs.* Singles."""
    palette_tokens = rules["color_tokens"]
    own = text_tokens(row["id"], " ".join(row["tags"]))
    tokens = [t for t in palette_tokens if t in own]
    if tokens:
        source.append("id_tokens")

    counts = collections.Counter()
    for single in links.get(row["id"], []):
        words = text_tokens(single.get("id", ""), single.get("basename", ""))
        for tok in palette_tokens:
            if tok in words and tok not in tokens:
                counts[tok] += 1
    if counts:
        source.append("exs_tokens")
    for tok, _ in counts.most_common():
        tokens.append(tok)
    return tokens[:MAX_COLOR_TOKENS]


def palette_affinity(rules, biome, tokens, source):
    palettes = rules["palettes"]
    colors = set(tokens)
    affinity = []
    for pid in rules["biomes"].get(biome, {}).get("palettes", []):
        pal = palettes.get(pid, {})
        # A biome palette that explicitly avoids this object's only colours
        # would fight the variant picker in W1-B, so drop it.
        if colors and colors <= set(pal.get("avoid", [])):
            continue
        affinity.append(pid)
    if affinity:
        source.append("biome.palettes")

    scored = []
    for pid, pal in palettes.items():
        if pid == "_doc" or pid in affinity:
            continue
        score = sum(w for tok, w in pal["tokens"].items() if tok in colors)
        if score and not colors & set(pal.get("avoid", [])):
            scored.append((score, pid))
    if scored:
        source.append("palette_tokens")
    for _, pid in sorted(scored, key=lambda s: (-s[0], s[1])):
        affinity.append(pid)
    return affinity[:MAX_PALETTES]


def pick_interact(rules, row, resolved, role, source):
    if resolved.get("interact"):
        source.append("rule.interact")
        return resolved["interact"]
    default = rules["roles"].get(role, {}).get("interact_default")
    if default:
        source.append("role.interact_default")
        return default
    tags = set(row["tags"])
    for iid, contract in rules["interact"].items():
        if iid == "_doc" or role not in contract["roles"]:
            continue
        if tags & set(contract.get("tags_any", [])):
            source.append(f"interact.{iid}")
            return iid
    return None


def pick_facing(row, resolved):
    facing = row.get("facing")
    if facing in (None, "", "any") and resolved.get("facing"):
        return resolved["facing"]
    return FACING_ALIASES.get(facing, facing)


def enrich(rules, rows, links):
    ordered = sorted(rules["rules"], key=lambda r: r["priority"])
    fold = surface_folder(rules)
    themes = rules["theme_biomes"]
    out = []

    for row in rows:
        source = []
        theme = themes.get(row["sheet"])
        if theme:
            biome = theme["primary"]
            allowed = [biome] + [b for b in theme.get("also", []) if b != biome]
            source.append("theme_biomes")
        else:
            biome = rules["defaults"].get("biome_fallback")
            allowed = [biome] if biome else []
            source.append("biome.fallback")

        resolved, fired = resolve_rules(ordered, row)
        role = resolved.get("role")
        if role:
            confidence = 1.0
            source.append(f"role_rule:{role}")
            rule_id = role_from_rules(fired)
            if rule_id:
                source.append(f"rule:{rule_id}")
        else:
            role = category_role(rules, row)
            if role:
                confidence = 0.8
                source.append("category_map")
            else:
                confidence = 0.5
                source.append("role.unresolved")

        surface = pick_surface(rules, row, resolved, role, biome, fold, source)
        tokens = color_tokens(rules, row, links, source)
        group_only = bool(resolved.get("group_only"))
        if group_only:
            source.append("rule.group_only")
        elif rules["roles"].get(role, {}).get("group_only"):
            group_only = True
            source.append("role.group_only")

        out.append({
            "me": row["id"],
            "role": role,
            "biome_primary": biome,
            "biomes_allowed": allowed,
            "surface": surface,
            "palette_affinity": palette_affinity(rules, biome, tokens, source),
            "color_tokens": tokens,
            "interact": pick_interact(rules, row, resolved, role, source),
            "group_only": group_only,
            "facing": pick_facing(row, resolved),
            "multi_tile": bool(row.get("multi_tile")),
            "sheet": row["sheet"],
            "category": row["category"],
            "tags": row["tags"],
            "confidence": round(confidence, 2),
            "source": source,
        })
    return out


def stats(enriched):
    total = len(enriched)
    with_role = sum(1 for e in enriched if e["role"])
    with_biome = sum(1 for e in enriched if e["biome_primary"])
    with_both = sum(1 for e in enriched if e["role"] and e["biome_primary"])
    return {
        "total": total,
        "role": with_role,
        "biome": with_biome,
        "both": with_both,
        "role_pct": with_role / total if total else 0.0,
        "biome_pct": with_biome / total if total else 0.0,
        "both_pct": with_both / total if total else 0.0,
    }


def report(enriched, s):
    roles = collections.Counter(e["role"] or "<none>" for e in enriched)
    biomes = collections.Counter(e["biome_primary"] or "<none>" for e in enriched)
    surfaces = collections.Counter(e["surface"] for e in enriched)
    interacts = collections.Counter(e["interact"] or "-" for e in enriched)
    palettes = collections.Counter(p for e in enriched for p in e["palette_affinity"])

    print(f"ROLES     {len(roles)} distinct")
    for role, n in roles.most_common():
        print(f"          {role:16s} {n:5d}")
    print(f"BIOMES    {len(biomes)} distinct")
    for biome, n in biomes.most_common():
        print(f"          {biome:16s} {n:5d}")
    print(f"SURFACES  {dict(surfaces.most_common())}")
    print(f"INTERACT  {dict(interacts.most_common())}")
    print(f"PALETTES  {dict(palettes.most_common())}")
    print(f"COLORS    {sum(1 for e in enriched if e['color_tokens'])} me.* carry >=1 colour token")
    print(f"GROUPONLY {sum(1 for e in enriched if e['group_only'])} group_only")
    print(f"CONFIDENCE {dict(collections.Counter(e['confidence'] for e in enriched).most_common())}")
    print(f"COVERAGE  {s['total']} me.* -> role {s['role_pct']:.1%} "
          f"biome {s['biome_pct']:.1%} both {s['both_pct']:.1%}")
    missing = [e["me"] for e in enriched if not (e["role"] and e["biome_primary"])]
    for me in missing[:15]:
        print(f"          incomplete: {me}")
    if len(missing) > 15:
        print(f"          ... and {len(missing) - 15} more")
    return missing


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--stats", action="store_true", help="print coverage, do not write")
    ap.add_argument("--validate", action="store_true",
                    help=f"exit 1 if <{MIN_COVERAGE:.0%} have role + biome")
    ap.add_argument("--out", type=Path, default=OUT, help="output jsonl path")
    args = ap.parse_args()

    rules = json.loads(RULES.read_text(encoding="utf-8"))
    rows = load_registry()
    links = load_links()
    enriched = enrich(rules, rows, links)
    s = stats(enriched)

    if not args.stats and not args.validate:
        with open(args.out, "w", encoding="utf-8") as f:
            for rec in enriched:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"WROTE     {args.out.relative_to(ROOT)} ({s['total']} rows)")

    missing = report(enriched, s)
    if args.validate:
        ok = s["both_pct"] >= MIN_COVERAGE
        print("OK" if ok else
              f"FAIL role+biome coverage {s['both_pct']:.1%} < {MIN_COVERAGE:.0%} "
              f"({len(missing)} incomplete)")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
