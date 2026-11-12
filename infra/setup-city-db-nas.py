#!/usr/bin/env python3
"""Set up the LimeZu city build-memory tables in the NAS supabase Postgres,
so any session pulls asset facts + city build state from the data server
instead of re-deriving (user request).

Tables (schema `city`):
  city.limezu_assets(path PK, kind, theme, w, h [, tags, me, biome, role])
  city.build_state(key PK, value jsonb, updated_at) — decisions / status

Loads either:
  denizen/assets/limezu/_asset-catalog.json           (default, 5 columns)
  denizen/assets/limezu/_asset-catalog-enriched.tsv   (--enriched, 9 columns)

Reuses the docker-exec-psql pattern from create-demo-org-nas.py.
"""

from __future__ import annotations
from hostcfg import get_host
import argparse
import json
import os
import sys
from pathlib import Path

import load_infra_env  # noqa: F401
import paramiko

HOST = get_host("SYNO_HOST")
PW = os.environ.get("SYNO_SSH_PASSWORD", "")
DB_CONTAINER = "supabase-db"
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
INFRA = Path(__file__).resolve().parent
DEN = INFRA.parent / "denizen"
CATALOG_PLAIN = DEN / "assets" / "limezu" / "_asset-catalog.json"
CATALOG_ENRICHED_TSV = DEN / "assets" / "limezu" / "_asset-catalog-enriched.tsv"
PATROL_ROUTES = DEN / "data" / "city-specs" / "npc-patrol-routes.json"


def run(client, cmd, timeout=300):
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out


def psql(client, pw, sql, stdin_data=None):
    cmd = (f"PGPASSWORD='{pw}' {DOCKER} exec -i {DB_CONTAINER} "
           f"psql -v ON_ERROR_STOP=1 -U postgres -d postgres")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=600)
    stdin.write(sql)
    if stdin_data:
        stdin.write(stdin_data)
    stdin.flush()
    stdin.channel.shutdown_write()
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    return stdout.channel.recv_exit_status(), out


def load_plain_rows():
    rows = json.load(open(CATALOG_PLAIN, encoding="utf-8"))
    return rows, False


def load_enriched_tsv():
    if not CATALOG_ENRICHED_TSV.is_file():
        print(f"ERROR: missing {CATALOG_ENRICHED_TSV} — run:")
        print("  cd denizen && python3 scripts/export-limezu-assets-catalog.py --tsv")
        return None, True
    text = CATALOG_ENRICHED_TSV.read_text(encoding="utf-8")
    return text, True


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--enriched", action="store_true",
                    help="load _asset-catalog-enriched.tsv (tags, me, biome, role columns)")
    args = ap.parse_args()

    if not PW:
        print("ERROR: SYNO_SSH_PASSWORD required")
        return 1

    enriched = args.enriched
    if enriched:
        tsv_data, _ = load_enriched_tsv()
        if tsv_data is None:
            return 1
        row_count = sum(1 for line in tsv_data.splitlines() if line.strip())
        print(f"catalog: {row_count} enriched sprites (TSV)")
    else:
        rows, _ = load_plain_rows()
        print(f"catalog: {len(rows)} sprites")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username="admin", password=PW,
                       look_for_keys=False, allow_agent=False, timeout=15)
    except Exception as exc:
        print(f"ERROR: cannot SSH to {HOST}: {exc}")
        print("Run this from a machine on your LAN (NAS is not reachable from cloud agents).")
        return 1

    code, out = run(client, "grep '^POSTGRES_PASSWORD=' "
                    "/volume1/docker/supabase-project/.env | head -1")
    if "POSTGRES_PASSWORD=" not in out:
        print("could not read POSTGRES_PASSWORD:", out)
        return 1
    pw = out.strip().split("=", 1)[1].strip().strip('"')

    ddl_base = """
CREATE SCHEMA IF NOT EXISTS city;
CREATE TABLE IF NOT EXISTS city.limezu_assets (
  path text PRIMARY KEY, kind text, theme text, w int, h int
);
CREATE INDEX IF NOT EXISTS limezu_assets_theme ON city.limezu_assets(theme);
"""
    ddl_enriched = """
ALTER TABLE city.limezu_assets
  ADD COLUMN IF NOT EXISTS tags text[],
  ADD COLUMN IF NOT EXISTS me text,
  ADD COLUMN IF NOT EXISTS biome text,
  ADD COLUMN IF NOT EXISTS role text;
CREATE INDEX IF NOT EXISTS limezu_assets_me ON city.limezu_assets(me);
CREATE INDEX IF NOT EXISTS limezu_assets_biome ON city.limezu_assets(biome);
"""
    ddl_state = """
CREATE TABLE IF NOT EXISTS city.build_state (
  key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now()
);
TRUNCATE city.limezu_assets;
"""
    code, out = psql(client, pw, ddl_base + (ddl_enriched if enriched else "") + ddl_state)
    if code != 0:
        print("DDL failed:", out)
        return 1
    print("schema + tables ready")

    if enriched:
        copy_sql = ("COPY city.limezu_assets(path,kind,theme,w,h,tags,me,biome,role) "
                    "FROM STDIN WITH (FORMAT text, NULL '\\N');\n")
        code, out = psql(client, pw, copy_sql, stdin_data=tsv_data + "\\.\n")
    else:
        def esc(s):
            return str(s).replace("\\", "\\\\").replace("\t", " ").replace("\n", " ")
        tsv = "".join(
            f"{esc(p)}\t{esc(k)}\t{esc(t)}\t{w}\t{h}\n" for p, k, t, w, h in rows)
        copy_sql = ("COPY city.limezu_assets(path,kind,theme,w,h) "
                    "FROM STDIN WITH (FORMAT text);\n")
        code, out = psql(client, pw, copy_sql, stdin_data=tsv + "\\.\n")
    if code != 0:
        print("COPY failed:", out[:500])
        return 1

    patrol_routes = None
    if PATROL_ROUTES.is_file():
        patrol_routes = json.load(open(PATROL_ROUTES, encoding="utf-8")).get("routes", [])

    state = {
        "exterior_placement_brain": "G7 complete — 15/15 compiler districts, 6118 stamps, 0 QA hard defects",
        "world_size": {"w": 6656, "h": 6400},
        "day_night_swaps": 338,
        "interactables": 1858,
        "tools": [
            "bash scripts/promote-city-plan.sh",
            "python3 scripts/check-city-plan.py",
            "python3 scripts/montage-qa-compiled-districts.py",
            "node scripts/dispatch-wave5.mjs",
        ],
        "npc_patrol_routes": len(patrol_routes or []),
        "catalog_enriched": enriched,
    }
    seed = ("INSERT INTO city.build_state(key,value) VALUES "
            f"('exterior_placement_brain', '{json.dumps(state)}'::jsonb) "
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, "
            "updated_at=now();")
    psql(client, pw, seed)

    code, out = psql(client, pw,
                     "SELECT count(*) AS assets, count(distinct theme) AS themes "
                     "FROM city.limezu_assets;")
    print("verify:", out.strip().splitlines()[-3:])
    client.close()
    print("done — city build memory is in the NAS database (schema city)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
