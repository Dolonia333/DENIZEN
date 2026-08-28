#!/usr/bin/env python3
"""Gate check for the exterior placement brain's semantics layer.

Three passes over data/limezu-visual-catalog/placement-rules.json:

  SCHEMA   validate against placement-rules.schema.json (skipped with a
           warning if the `jsonschema` package isn't installed)
  REFS     every role / surface / mount / biome / palette / slot / interact /
           density / theme id referenced anywhere must exist, every registry
           sheet must be mapped to a biome, every registry `category` must be
           reachable from some role or rule, and every registry `surface`
           string must fold onto a canonical surface or mount
  DRYRUN   replay the match->set rules over registry.jsonl and report the role
           distribution + how many me.* end up with no role (G1 wants >=90%)

Usage:
  py scripts/validate-placement-rules.py
  py scripts/validate-placement-rules.py --quiet     # counts only
Exit code 1 on any schema or reference error, or if role coverage < 90%.
"""

import argparse
import collections
import json
import os
import sys

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(DEN, "data", "limezu-visual-catalog")
RULES = os.path.join(CAT, "placement-rules.json")
SCHEMA = os.path.join(CAT, "placement-rules.schema.json")
REGISTRY = os.path.join(CAT, "registry.jsonl")

MIN_ROLE_COVERAGE = 0.90


def keys(obj):
    return {k for k in obj if k != "_doc"}


def check_schema(rules, errors):
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        print("SCHEMA  skipped (pip install jsonschema)")
        return
    schema = json.load(open(SCHEMA, encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    v = Draft202012Validator(schema)
    found = sorted(v.iter_errors(rules), key=lambda e: list(e.path))
    for e in found:
        errors.append(f"SCHEMA {'/'.join(str(p) for p in e.path)}: {e.message[:200]}")

    # The example district spec is validated against its own $def.
    ds = dict(schema["$defs"]["districtSpec"])
    ds["$defs"] = schema["$defs"]
    for e in sorted(Draft202012Validator(ds).iter_errors(rules.get("example_district_spec", {})),
                    key=lambda e: list(e.path)):
        errors.append(f"SCHEMA example_district_spec/{'/'.join(str(p) for p in e.path)}: {e.message[:200]}")
    print(f"SCHEMA  {len(found)} error(s)")


def check_refs(rules, errors):
    role_ids = keys(rules["roles"])
    surf_ids = keys(rules["surfaces"])
    mount_ids = keys(rules["mounts"])
    biome_ids = keys(rules["biomes"])
    pal_ids = keys(rules["palettes"])
    slot_ids = keys(rules["slots"])
    int_ids = keys(rules["interact"])
    dens_ids = keys(rules["density"])
    theme_ids = keys(rules["theme_biomes"])
    tokens = set(rules["color_tokens"])

    def need(value, pool, where):
        if value not in pool:
            errors.append(f"REF {where}: unknown '{value}'")

    for rid, r in rules["roles"].items():
        if rid == "_doc":
            continue
        for s in r.get("surfaces", []):
            need(s, surf_ids, f"roles.{rid}.surfaces")
        for m in r.get("mounts", []):
            need(m, mount_ids, f"roles.{rid}.mounts")
        if r.get("interact_default"):
            need(r["interact_default"], int_ids, f"roles.{rid}.interact_default")
        req = r.get("requires", {})
        for k in ("over_role", "abuts_role"):
            if k in req:
                need(req[k], role_ids, f"roles.{rid}.requires.{k}")
        for s in req.get("near_slot", []):
            need(s, slot_ids, f"roles.{rid}.requires.near_slot")
        for s in req.get("on_surface", []) + req.get("reachable_from_surface", []):
            need(s, surf_ids, f"roles.{rid}.requires")

    for sid, s in rules["surfaces"].items():
        if sid == "_doc":
            continue
        for r in s.get("roles_allowed", []):
            need(r, role_ids, f"surfaces.{sid}.roles_allowed")

    for mid, m in rules["mounts"].items():
        if mid == "_doc":
            continue
        for r in m.get("roles", []) + m.get("attach_to_role", []):
            need(r, role_ids, f"mounts.{mid}")

    for bid, b in rules["biomes"].items():
        if bid == "_doc":
            continue
        for t in b["themes"]:
            need(t, theme_ids, f"biomes.{bid}.themes")
        for s in b["surfaces"]:
            need(s, surf_ids, f"biomes.{bid}.surfaces")
        for p in b["palettes"]:
            need(p, pal_ids, f"biomes.{bid}.palettes")
        for r, d in b.get("density", {}).items():
            need(r, role_ids, f"biomes.{bid}.density key")
            need(d, dens_ids, f"biomes.{bid}.density value")
        for r in b.get("require_roles", []):
            need(r, role_ids, f"biomes.{bid}.require_roles")

    for t, tb in rules["theme_biomes"].items():
        if t == "_doc":
            continue
        need(tb["primary"], biome_ids, f"theme_biomes.{t}.primary")
        for b in tb.get("also", []):
            need(b, biome_ids, f"theme_biomes.{t}.also")

    for pid, p in rules["palettes"].items():
        if pid == "_doc":
            continue
        for tok in list(p["tokens"]) + p.get("avoid", []):
            need(tok, tokens, f"palettes.{pid} token")

    for iid, i in rules["interact"].items():
        if iid == "_doc":
            continue
        for r in i["roles"]:
            need(r, role_ids, f"interact.{iid}.roles")

    for sid, s in rules["slots"].items():
        if sid == "_doc":
            continue
        for r in s["roles"]:
            need(r, role_ids, f"slots.{sid}.roles")
        for b in s.get("between", []):
            need(b, surf_ids, f"slots.{sid}.between")

    seen = set()
    for r in rules["rules"]:
        if r["id"] in seen:
            errors.append(f"REF rules: duplicate id {r['id']}")
        seen.add(r["id"])
        st = r["set"]
        if "role" in st:
            need(st["role"], role_ids, f"{r['id']}.set.role")
        if "mount" in st:
            need(st["mount"], mount_ids, f"{r['id']}.set.mount")
        if st.get("interact"):
            need(st["interact"], int_ids, f"{r['id']}.set.interact")
        for s in st.get("slots", []):
            need(s, slot_ids, f"{r['id']}.set.slots")
        for s in st.get("surfaces", []):
            need(s, surf_ids, f"{r['id']}.set.surfaces")

    for aid, a in rules.get("example_rules", {}).items():
        if aid == "_doc":
            continue
        need(a["role"], role_ids, f"example_rules.{aid}.role")
        for s in a.get("surfaces", []) + a.get("forbid_surfaces", []):
            need(s, surf_ids, f"example_rules.{aid} surfaces")
        for p in a.get("palettes", {}):
            need(p, pal_ids, f"example_rules.{aid}.palettes")
        for s in a.get("slots", []) + list(a.get("density_by_slot", {})):
            need(s, slot_ids, f"example_rules.{aid} slots")
        for dr in a.get("derived_from", []):
            if dr.startswith("rule."):
                need(dr, seen, f"example_rules.{aid}.derived_from")

    ds = rules.get("example_district_spec", {})
    if ds:
        need(ds["biome"], biome_ids, "example_district_spec.biome")
        for p in (ds.get("palette"), ds.get("palette_secondary")):
            if p:
                need(p, pal_ids, "example_district_spec.palette")
        for s in ds.get("slots", []):
            need(s["slot"], slot_ids, "example_district_spec.slots")
            for r, d in s.get("density", {}).items():
                need(r, role_ids, "example_district_spec slot density key")
                need(d, dens_ids, "example_district_spec slot density value")

    # Registry cross-checks
    rows = [json.loads(line) for line in open(REGISTRY, encoding="utf-8")]
    for sheet in sorted({r["sheet"] for r in rows}):
        need(sheet, theme_ids, "registry sheet -> theme_biomes")

    covered = set()
    for rid, r in rules["roles"].items():
        if rid != "_doc":
            covered |= set(r.get("categories", []))
    for r in rules["rules"]:
        covered |= set(r["match"].get("categories", []))
    orphan_cats = {r["category"] for r in rows} - covered
    if orphan_cats:
        errors.append(f"REF registry categories with no role/rule: {sorted(orphan_cats)}")

    aliased = set()
    for sid, s in rules["surfaces"].items():
        if sid != "_doc":
            aliased |= set(s["registry_aliases"])
    for mid, m in rules["mounts"].items():
        if mid != "_doc":
            aliased |= set(m["registry_aliases"])
    orphan_surf = {r["surface"] for r in rows} - aliased
    if orphan_surf:
        errors.append(f"REF registry surfaces with no canonical home: {sorted(orphan_surf)}")

    print(f"REFS    {len(errors)} error(s) cumulative; "
          f"roles={len(role_ids)} biomes={len(biome_ids)} themes={len(theme_ids)} "
          f"palettes={len(pal_ids)} surfaces={len(surf_ids)} mounts={len(mount_ids)} "
          f"interact={len(int_ids)} density={len(dens_ids)} slots={len(slot_ids)} "
          f"rules={len(rules['rules'])}")
    return rows


def matches(m, row):
    tags = set(row["tags"])
    if "categories" in m and row["category"] not in m["categories"]:
        return False
    if "sheets" in m and row["sheet"] not in m["sheets"]:
        return False
    if "roles" in m:
        return False  # role-based matching only applies to a second enrichment pass
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


def dry_run(rules, rows, quiet):
    ordered = sorted(rules["rules"], key=lambda r: r["priority"])
    roles = collections.Counter()
    interacts = collections.Counter()
    group_only = 0
    unrolled = []
    for row in rows:
        resolved = {}
        for r in ordered:
            if matches(r["match"], row):
                resolved.update(r["set"])
        role = resolved.get("role")
        if not role:
            unrolled.append(row["id"])
        roles[role or "<none>"] += 1
        if resolved.get("group_only"):
            group_only += 1
        default = rules["roles"].get(role, {}).get("interact_default")
        interacts[resolved.get("interact") or default or "-"] += 1

    total = len(rows)
    coverage = 1 - len(unrolled) / total if total else 0
    if not quiet:
        for role, n in roles.most_common():
            print(f"          {role:16s} {n:5d}")
    print(f"DRYRUN  {total} me.* -> role coverage {coverage:.1%} "
          f"({len(unrolled)} unresolved), group_only {group_only}")
    print(f"        interact: {dict(interacts.most_common())}")
    for uid in unrolled[:15]:
        print(f"        no role: {uid}")
    return coverage


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet", action="store_true", help="counts only, no role histogram")
    args = ap.parse_args()

    rules = json.load(open(RULES, encoding="utf-8"))
    errors = []
    check_schema(rules, errors)
    rows = check_refs(rules, errors)
    coverage = dry_run(rules, rows, args.quiet)

    for e in errors:
        print(f"  {e}")
    if coverage < MIN_ROLE_COVERAGE:
        print(f"FAIL role coverage {coverage:.1%} < {MIN_ROLE_COVERAGE:.0%}")
    ok = not errors and coverage >= MIN_ROLE_COVERAGE
    print("OK" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
