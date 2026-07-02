#!/usr/bin/env python3
"""Verify Phase 4 tables + recent migrations on production Supabase."""
from __future__ import annotations

import sys
from pathlib import Path

import load_infra_env  # noqa: F401

try:
    import psycopg2
except ImportError:
    import subprocess

    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
    import psycopg2

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / "denizen" / ".env.production"


def load_db_url() -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("SUPABASE_DB_URL="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("SUPABASE_DB_URL missing")


def main() -> int:
    conn = psycopg2.connect(load_db_url())
    cur = conn.cursor()
    cur.execute(
        "SELECT version, name FROM public.denizen_schema_migrations "
        "WHERE version::bigint >= 20260624000000 ORDER BY version"
    )
    recent = cur.fetchall()
    print("Phase 4+ migrations on prod:")
    for v, n in recent:
        print(f"  {v} {n}")
    if not recent:
        print("  (none — PENDING)")

    checks = [
        "public.agent_souls",
        "public.org_business_models",
        "public.denizen_contribution_daily_totals",
    ]
    print("\nTable registry:")
    for t in checks:
        cur.execute("SELECT to_regclass(%s)", (t,))
        print(f"  {t}: {'OK' if cur.fetchone()[0] else 'MISSING'}")

    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'denizen_resolve_mcp_token'
        )
        """
    )
    print(f"\ndenizen_resolve_mcp_token: {'OK' if cur.fetchone()[0] else 'MISSING'}")
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
