#!/usr/bin/env python3
"""Audit compute mesh RLS policies on NAS Supabase."""
from hostcfg import get_host
import load_infra_env  # noqa: F401
import os
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"

SQL = """
select tablename, policyname, roles::text
from pg_policies
where schemaname = 'public'
  and tablename in (
    'denizen_compute_jobs', 'denizen_compute_nodes',
    'denizen_node_profiles', 'denizen_credits_ledger'
  )
order by tablename, policyname;
"""


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, _ = client.exec_command("grep '^POSTGRES_PASSWORD=' /volume1/docker/supabase-project/.env | head -1")
    pg = o.read().decode().strip().split("=", 1)[-1]
    cmd = (
        f"{DOCKER} exec -i -e PGPASSWORD='{pg}' supabase-db "
        f"psql -U postgres -d postgres -c \"{SQL}\""
    )
    _, o, e = client.exec_command(cmd)
    out = (o.read() + e.read()).decode()
    print(out)
    if "anon_allow_all" in out:
        print("\nWARN: permissive anon policies still present — apply 20260622000002")
        client.close()
        return 1
    print("\nOK: no anon_allow_all policies on compute tables")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
