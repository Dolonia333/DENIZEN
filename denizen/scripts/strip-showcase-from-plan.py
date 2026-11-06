#!/usr/bin/env python3
"""Drop the D99 catalog-showcase exhibits out of the played city plan.

`scripts/compile-coverage-showcase.py` builds D99 to lift asset-catalog
coverage: it parks every orphan `me.*` (cataloged, linked to a Single, never
stamped) in empty world space. That is a *metrics* device, not city design —
and it merged into `data/city-plan.json`, so players walk past 13 zones of
sprite racks: buildings lined up on blank concrete, giant ice-cream cones,
floating doors, and 23 labels literally reading "CATALOG SHOWCASE — <BIOME>".

Every element D99 contributes carries `showcase: true`, so the subtraction is
exact rather than heuristic — no geometry guessing, and nothing else in the
plan is tagged. The fragment stays on disk and
`data/city-specs/generated/manifest.json` governs whether a future merge pulls
it back in, so this is reversible.

Usage:
  py scripts/strip-showcase-from-plan.py --dry-run   # report, write nothing
  py scripts/strip-showcase-from-plan.py             # rewrite the plan
"""

import json
import os
import sys

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(DEN, "data", "city-plan.json")

TAGS = ("showcase", "group_only_exhibit")


def is_exhibit(el):
    return isinstance(el, dict) and any(el.get(t) for t in TAGS)


def main():
    dry = "--dry-run" in sys.argv
    src = PLAN
    for a in sys.argv[1:]:
        if not a.startswith("--"):
            src = a

    raw = open(src, encoding="utf-8").read()
    plan = json.loads(raw)

    removed = {}
    for key, val in plan.items():
        if not isinstance(val, list):
            continue
        keep = [el for el in val if not is_exhibit(el)]
        if len(keep) != len(val):
            removed[key] = len(val) - len(keep)
            plan[key] = keep

    total = sum(removed.values())
    print(f"{src}")
    if not total:
        print("  no showcase-tagged elements — nothing to strip")
        return 0
    for key, n in sorted(removed.items()):
        print(f"  {key:10s} -{n}")
    print(f"  total removed: {total}")

    if dry:
        print("  --dry-run: not written")
        return 0

    # indent=1 + ensure_ascii=True + no trailing newline reproduces the
    # merge script's own formatting, so the diff shows only the removal.
    # LF endings match origin/master (this checkout may hold CRLF copies).
    out = json.dumps(plan, indent=1, ensure_ascii=True)
    with open(src, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out)
    print(f"  written ({len(out)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
