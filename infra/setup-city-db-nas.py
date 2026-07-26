#!/usr/bin/env python3
"""Set up the LimeZu city build-memory tables in the NAS supabase Postgres,
so any session pulls asset facts + city build state from the data server
instead of re-deriving (user request).

Tables (schema `city`):
  city.limezu_assets(path PK, kind, theme, w, h)   — full sprite catalog
  city.build_state(key PK, value jsonb, updated_at) — decisions / status

Loads the local catalog denizen/assets/limezu/_asset-catalog.json via COPY.
Reuses the docker-exec-psql pattern from create-demo-org-nas.py.
"""

from __future__ import annotations
import json
import os
import sys

import load_infra_env  # noqa: F401
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PW = os.environ.get("SYNO_SSH_PASSWORD", "")
DB_CONTAINER = "supabase-db"
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
CATALOG = os.path.join(os.path.dirname(__file__), "..", "denizen",
                       "assets", "limezu", "_asset-catalog.json")


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


def main():
    if not PW:
        print("ERROR: SYNO_SSH_PASSWORD required")
        return 1
    rows = json.load(open(CATALOG, encoding="utf-8"))
    print(f"catalog: {len(rows)} sprites")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PW,
                   look_for_keys=False, allow_agent=False)

    code, out = run(client, "grep '^POSTGRES_PASSWORD=' "
                    "/volume1/docker/supabase-project/.env | head -1")
    if "POSTGRES_PASSWORD=" not in out:
        print("could not read POSTGRES_PASSWORD:", out)
        return 1
    pw = out.strip().split("=", 1)[1].strip().strip('"')

    ddl = """
CREATE SCHEMA IF NOT EXISTS city;
CREATE TABLE IF NOT EXISTS city.limezu_assets (
  path text PRIMARY KEY, kind text, theme text, w int, h int
);
CREATE INDEX IF NOT EXISTS limezu_assets_theme ON city.limezu_assets(theme);
CREATE TABLE IF NOT EXISTS city.build_state (
  key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now()
);
TRUNCATE city.limezu_assets;
"""
    code, out = psql(client, pw, ddl)
    if code != 0:
        print("DDL failed:", out)
        return 1
    print("schema + tables ready")

    # Bulk load via COPY FROM STDIN (tab-separated).
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

    # Seed build state.
    state = {
        "restructure_status": "in_progress: colliders relocated, core paved; "
        "south transition + denser infill still TODO",
        "world_size": {"w": 6656, "h": 6400},
        "tools": ["scripts/render-city-preview.py --plan",
                  "scripts/check-city-plan.py", "scripts/relocate-district.py",
                  "scripts/compile-city-structure.py",
                  "scripts/merge-city-plan.py"],
        "known_issues": ["~29 overlaps remain (mostly forest canopies)",
                         "subway/interiors bands share surface coords with "
                         "beach/graveyard (teleport-only, visual only)",
                         "large grass gap in lower-center transition zone"],
    }
    seed = ("INSERT INTO city.build_state(key,value) VALUES "
            f"('city_restructure', '{json.dumps(state)}'::jsonb) "
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
