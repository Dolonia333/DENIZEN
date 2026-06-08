#!/usr/bin/env python3
"""Apply Denizen migrations to NAS Supabase via direct Postgres (no psql required)."""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    import subprocess

    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
    import psycopg2

ROOT = Path(__file__).resolve().parents[1]
MIG_DIR = ROOT / "denizen" / "supabase" / "migrations"
ENV_FILE = ROOT / "denizen" / ".env.production"
PENDING_FROM = 20260606000016


def load_db_url() -> str:
    if not ENV_FILE.exists():
        raise SystemExit(f"Missing {ENV_FILE}")
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("SUPABASE_DB_URL="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("SUPABASE_DB_URL not found in .env.production")


def migration_version(name: str) -> int | None:
    m = re.match(r"^(\d{14})_", name)
    return int(m.group(1)) if m else None


def migration_role(path: Path) -> str:
    version = migration_version(path.name) or 0
    if version == 20260606000012:
        return "postgres"
    if version == 20260606000013:
        return "supabase_admin"
    if "admin" in path.name.lower():
        return "supabase_admin"
    header = path.read_text(encoding="utf-8", errors="replace")[:4000]
    if re.search(r"apply as\s+supabase_admin", header, re.I):
        return "supabase_admin"
    return "postgres"


def applied_versions(cur) -> set[int]:
    cur.execute("SELECT version FROM public.denizen_schema_migrations")
    return {int(row[0]) for row in cur.fetchall()}


def table_exists(cur, name: str) -> bool:
    cur.execute("SELECT to_regclass(%s)", (name,))
    return cur.fetchone()[0] is not None


def main() -> int:
    db_url = load_db_url()
    files = sorted(
        [p for p in MIG_DIR.glob("*.sql") if migration_version(p.name)],
        key=lambda p: migration_version(p.name) or 0,
    )

    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()

    done = applied_versions(cur)
    targets = [
        p for p in files
        if (migration_version(p.name) or 0) >= PENDING_FROM
        and (migration_version(p.name) or 0) not in done
    ]

    if not targets and table_exists(cur, "public.denizen_contribution_daily_totals"):
        print("MIGRATIONS_ALREADY_APPLIED")
        return 0

    if not targets:
        # 000019 has no schema_migrations insert — apply if table still missing.
        if not table_exists(cur, "public.denizen_contribution_daily_totals"):
            extra = [p for p in files if p.name.endswith("20260606000019_contribution_credits.sql")]
            targets = extra

    print(f"pending={len(targets)}")

    for path in targets:
        role = migration_role(path)
        sql = path.read_text(encoding="utf-8")
        print(f"APPLY {path.name} as {role}")
        cur.execute(f"set role {role}")
        cur.execute(sql)
        print(f"OK {path.name}")

    if not table_exists(cur, "public.denizen_contribution_daily_totals"):
        print("WARN daily_totals still missing")
        return 1

    print("daily_totals_exists=true")
    cur.close()
    conn.close()
    print("MIGRATION_DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
