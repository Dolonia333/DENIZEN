#!/usr/bin/env python3
"""Look up Chris (or partial match) in team + demo identity tables on NAS."""
from __future__ import annotations

from hostcfg import get_host
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
NEEDLE = (sys.argv[1] if len(sys.argv) > 1 else "chris").replace("'", "''")


def run_psql(client: paramiko.SSHClient, sql: str) -> str:
    cmd = (
        f'{DOCKER} exec supabase-db psql -U postgres -d postgres '
        f"-t -A -F'|' -c \"{sql}\""
    )
    _, o, e = client.exec_command(cmd, timeout=30)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD not set in infra/.env")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    team_sql = f"""
SELECT ta.username, ta.email, ta.role, o.slug, ta.created_at::text
FROM denizen_team_accounts ta
JOIN denizen_organizations o ON o.id = ta.org_id
WHERE ta.username ILIKE '%{NEEDLE}%'
   OR ta.email ILIKE '%{NEEDLE}%'
   OR ta.display_name ILIKE '%{NEEDLE}%'
ORDER BY ta.created_at DESC
LIMIT 10
""".strip().replace("\n", " ")

    demo_sql = f"""
SELECT username, COALESCE(email_normalized, email) AS email, tier, display_name, created_at::text
FROM denizen_user_identities
WHERE username ILIKE '%{NEEDLE}%'
   OR email ILIKE '%{NEEDLE}%'
   OR email_normalized ILIKE '%{NEEDLE}%'
   OR display_name ILIKE '%{NEEDLE}%'
ORDER BY created_at DESC
LIMIT 10
""".strip().replace("\n", " ")

    print(f"Search needle: {NEEDLE!r}\n")
    print("=== Team accounts (zion / other orgs) ===")
    print(run_psql(client, team_sql) or "(none)")
    print("\n=== Demo / identity rows ===")
    print(run_psql(client, demo_sql) or "(none)")

    org_sql = """
SELECT slug, display_name, settings::text
FROM denizen_organizations
WHERE slug IN ('zion', 'vibecore-vaww', 'acme')
ORDER BY slug
""".strip().replace("\n", " ")

    zion_sql = """
SELECT ta.username, ta.email, ta.role, ta.created_at::text
FROM denizen_team_accounts ta
JOIN denizen_organizations o ON o.id = ta.org_id
WHERE o.slug = 'zion'
ORDER BY ta.created_at DESC
LIMIT 20
""".strip().replace("\n", " ")

    print("\n=== Orgs (zion / vibecore / acme) ===")
    print(run_psql(client, org_sql) or "(none)")
    print("\n=== All zion team accounts ===")
    print(run_psql(client, zion_sql) or "(none)")

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
