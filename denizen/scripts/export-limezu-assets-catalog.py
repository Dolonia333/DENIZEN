#!/usr/bin/env python3
"""W5-C (Wave 5 prep, offline) — enriched `city.limezu_assets` NAS export.

Denizen MCP is not connected in the cloud agent VM, so nothing here touches
the NAS Postgres directly (infra/setup-city-db-nas.py needs a live SSH/docker
session — see "NAS wiring" below). This builds the enriched catalog file that
script will load once the bridge is back, from data that already lives in
this repo:

  - data/limezu-visual-catalog/placement-index.json   exs.* -> img / w / h / me_id
  - data/limezu-visual-catalog/registry.jsonl          me.* -> sheet / tags / category
  - data/limezu-visual-catalog/me-placement-enriched.jsonl  me.* -> role / biome_primary (W1-A)

One row per `exs.*` Single (6224 — full Modern Exteriors Singles inventory,
same scope as CATALOG_OVERVIEW.md / data/limezu-visual-catalog/README.md),
shaped `{path, kind, theme, w, h, tags, me, biome, role}`:

  - path/kind/w/h  same meaning as the existing (untracked-schema-wise, but
    already-shipped) assets/limezu/_asset-catalog.json rows consumed by
    infra/setup-city-db-nas.py: `path` relative to assets/limezu/, `kind` the
    top-level folder (always "ext" here — Modern Exteriors only).
  - theme          the LimeZu theme sheet (registry.jsonl's `sheet`, e.g.
    "21_Beach") rather than that script's literal second path segment — more
    useful for city-generation queries; falls back to the path segment for
    any Single whose me.* somehow didn't resolve.
  - tags/me/biome/role   the enrichment columns city.limezu_assets doesn't
    have yet: `tags` from registry.jsonl, `me`/`biome`/`role` from W1-A's
    me-placement-enriched.jsonl (biome_primary / role). null when a Single's
    me.* link or its enrichment record is missing (should be ~0 today — see
    --stats).

Writes:
  assets/limezu/_asset-catalog-enriched.json
  assets/limezu/_asset-catalog-enriched.tsv   (only with --tsv)

Usage:
  python3 scripts/export-limezu-assets-catalog.py
  python3 scripts/export-limezu-assets-catalog.py --tsv     # also write the COPY-friendly TSV
  python3 scripts/export-limezu-assets-catalog.py --stats   # print coverage only, no write

## NAS wiring (when Denizen MCP connects — do this, don't touch it now)

infra/setup-city-db-nas.py currently loads the plain (path, kind, theme, w, h)
rows of assets/limezu/_asset-catalog.json into `city.limezu_assets` via a
docker-exec-psql `COPY ... FROM STDIN WITH (FORMAT text)` (see that script's
DDL + `psql()` helper — same SSH/docker-exec pattern as
infra/create-demo-org-nas.py). To switch it to this enriched catalog once a
live NAS session exists:

  1. Extend the DDL before the first COPY:
       ALTER TABLE city.limezu_assets
         ADD COLUMN IF NOT EXISTS tags text[],
         ADD COLUMN IF NOT EXISTS me text,
         ADD COLUMN IF NOT EXISTS biome text,
         ADD COLUMN IF NOT EXISTS role text;
       CREATE INDEX IF NOT EXISTS limezu_assets_me ON city.limezu_assets(me);
       CREATE INDEX IF NOT EXISTS limezu_assets_biome ON city.limezu_assets(biome);
  2. Point its `CATALOG` constant (or a new `--catalog` arg) at
     assets/limezu/_asset-catalog-enriched.json instead of
     assets/limezu/_asset-catalog.json — or COPY into a fresh
     `city.limezu_assets_enriched` table if existing consumers of the base
     5-column table shouldn't see the new ones yet.
  3. Regenerate this script's `--tsv` output and feed it through the same
     `COPY city.limezu_assets(path,kind,theme,w,h,tags,me,biome,role) FROM
     STDIN WITH (FORMAT text)` + stdin-write pattern setup-city-db-nas.py's
     `psql()` already uses. The TSV uses Postgres text-format COPY
     conventions: `\\N` for a NULL me/biome/role, comma-joined tags, tabs/
     newlines/backslashes escaped the same way that script's `esc()` does.
  4. Re-run this exporter after any enrich-me-placement-rules.py or
     catalog-limezu-ext-singles-pixelperfect.py re-run so the NAS table
     stays in sync with the tracked catalog (same "build it locally, bulk
     COPY" flow noted in TECHNICAL_DOSSIER.md).
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

DEN = Path(__file__).resolve().parents[1]
CAT = DEN / "data" / "limezu-visual-catalog"
PLACEMENT_INDEX_PATH = CAT / "placement-index.json"
REGISTRY_PATH = CAT / "registry.jsonl"
ENRICHED_PATH = CAT / "me-placement-enriched.jsonl"

OUT_JSON = DEN / "assets" / "limezu" / "_asset-catalog-enriched.json"
OUT_TSV = DEN / "assets" / "limezu" / "_asset-catalog-enriched.tsv"

COLUMNS = ["path", "kind", "theme", "w", "h", "tags", "me", "biome", "role"]


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def build_rows() -> list[dict]:
    index = json.loads(PLACEMENT_INDEX_PATH.read_text(encoding="utf-8")) if PLACEMENT_INDEX_PATH.exists() else {}
    exs = index.get("exs") or {}
    registry_by_id = {r["id"]: r for r in load_jsonl(REGISTRY_PATH)}
    enriched_by_me = {r["me"]: r for r in load_jsonl(ENRICHED_PATH) if r.get("me")}

    rows = []
    for exs_id in sorted(exs):
        entry = exs[exs_id]
        img = entry.get("img")
        if not img:
            continue
        me_id = entry.get("me_id")
        reg = registry_by_id.get(me_id) if me_id else None
        enr = enriched_by_me.get(me_id) if me_id else None

        parts = img.split("/")
        kind = parts[0] if parts else ""
        theme = (reg.get("sheet") if reg else None) or (parts[2] if len(parts) > 2 else "")

        rows.append({
            "path": img,
            "kind": kind,
            "theme": theme,
            "w": entry.get("w"),
            "h": entry.get("h"),
            "tags": list(reg.get("tags") or []) if reg else [],
            "me": me_id,
            "biome": enr.get("biome_primary") if enr else None,
            "role": enr.get("role") if enr else None,
        })
    return rows


def esc_tsv(value) -> str:
    if value is None:
        return "\\N"
    return str(value).replace("\\", "\\\\").replace("\t", " ").replace("\n", " ")


def write_tsv(rows: list[dict], out_path: Path) -> None:
    lines = []
    for r in rows:
        tags = ",".join(r["tags"]) if r["tags"] else ""
        fields = [r["path"], r["kind"], r["theme"], r["w"], r["h"], tags, r["me"], r["biome"], r["role"]]
        lines.append("\t".join(esc_tsv(f) for f in fields))
    out_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def coverage_stats(rows: list[dict]) -> dict:
    total = len(rows)
    with_me = sum(1 for r in rows if r["me"])
    with_biome = sum(1 for r in rows if r["biome"])
    with_role = sum(1 for r in rows if r["role"])
    with_tags = sum(1 for r in rows if r["tags"])
    by_theme = Counter(r["theme"] for r in rows)
    by_biome = Counter(r["biome"] for r in rows if r["biome"])
    by_role = Counter(r["role"] for r in rows if r["role"])
    return {
        "total": total,
        "with_me": with_me,
        "with_biome": with_biome,
        "with_role": with_role,
        "with_tags": with_tags,
        "distinct_themes": len(by_theme),
        "distinct_biomes": len(by_biome),
        "distinct_roles": len(by_role),
        "top_themes": by_theme.most_common(5),
        "top_biomes": by_biome.most_common(10),
        "top_roles": by_role.most_common(10),
    }


def print_stats(stats: dict) -> None:
    print(f"rows: {stats['total']}  with_me: {stats['with_me']}  with_biome: {stats['with_biome']}  "
          f"with_role: {stats['with_role']}  with_tags: {stats['with_tags']}")
    print(f"distinct themes: {stats['distinct_themes']}  biomes: {stats['distinct_biomes']}  "
          f"roles: {stats['distinct_roles']}")
    print("top biomes:", ", ".join(f"{b}={n}" for b, n in stats["top_biomes"]))
    print("top roles:", ", ".join(f"{r}={n}" for r, n in stats["top_roles"]))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tsv", action="store_true", help="also write the COPY-friendly TSV")
    ap.add_argument("--stats", action="store_true", help="print coverage stats only, write nothing")
    args = ap.parse_args()

    rows = build_rows()
    stats = coverage_stats(rows)
    print_stats(stats)
    if args.stats:
        return 0

    doc = {
        "_doc": (
            "GENERATED by scripts/export-limezu-assets-catalog.py (W5-C, Wave 5 "
            "prep — offline, no live NAS session). One row per exs.* Modern "
            "Exteriors Single, shaped for city.limezu_assets(path,kind,theme,w,h) "
            "in infra/setup-city-db-nas.py plus tags/me/biome/role enrichment "
            "columns that table doesn't have yet — see this script's docstring "
            "'NAS wiring' section for the DDL + COPY steps to run once Denizen "
            "MCP reconnects."
        ),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "sources": {
            "placement_index": str(PLACEMENT_INDEX_PATH.relative_to(DEN)),
            "registry": str(REGISTRY_PATH.relative_to(DEN)),
            "me_placement_enriched": str(ENRICHED_PATH.relative_to(DEN)),
        },
        "nas_table_compat": "city.limezu_assets(path,kind,theme,w,h) — infra/setup-city-db-nas.py; "
                             "tags/me/biome/role are new columns, ALTER TABLE before COPY (see docstring)",
        "columns": COLUMNS,
        "count": stats["total"],
        "coverage": stats,
        "assets": rows,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT_JSON.relative_to(DEN)} ({stats['total']} rows)")

    if args.tsv:
        write_tsv(rows, OUT_TSV)
        print(f"wrote {OUT_TSV.relative_to(DEN)} ({stats['total']} rows, COPY FROM STDIN WITH (FORMAT text))")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
