#!/usr/bin/env python3
"""Create the 'acme' demo sandbox org on the NAS Supabase Postgres, exactly as
migrations 20260606000008 + 20260606000010 define it. Idempotent (ON CONFLICT
DO NOTHING / settings merge). This org is where Discord/demo logins create their
sessions; without it, session creation 404s and Discord users get no session.
"""
from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401

import os
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"
DB_CONTAINER = "supabase-db"

SQL = """
insert into public.denizen_organizations (slug, display_name, plan, settings)
values ('acme', 'Acme Corp (Demo)', 'trial', '{"demo": true}'::jsonb)
on conflict (slug) do nothing;

update public.denizen_organizations
set settings = settings || '{"tier":"demo","allow_business_data":false,"allow_real_work":false,"allow_ceo_handoff":false}'::jsonb
where slug = 'acme';

select slug, display_name, plan, settings from public.denizen_organizations where slug = 'acme';
"""


def run(client, cmd, timeout=120):
    print("$", cmd[:120], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status(), out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    _, out = run(client, "grep '^POSTGRES_PASSWORD=' /volume1/docker/supabase-project/.env | head -1")
    pg_pass = out.strip().split("=", 1)[-1]
    if not pg_pass:
        print("could not read POSTGRES_PASSWORD")
        client.close()
        return 1

    # Feed SQL via stdin to psql inside the db container.
    heredoc = SQL.replace("'", "'\\''")
    cmd = (
        f"printf '%s' '{heredoc}' | {DOCKER} exec -i -e PGPASSWORD='{pg_pass}' "
        f"{DB_CONTAINER} psql -v ON_ERROR_STOP=1 -U postgres -d postgres"
    )
    code, _ = run(client, cmd, timeout=120)
    client.close()
    print("\n==> exit", code)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
