#!/usr/bin/env python3
"""Diagnose digest/pgcrypto issue for denizen_resolve_mcp_token on NAS."""
from hostcfg import get_host
import load_infra_env  # noqa: F401
import os
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"

TESTS = [
    "select n.nspname, pg_get_function_arguments(p.oid) from pg_proc p "
    "join pg_namespace n on n.oid=p.pronamespace where p.proname='digest';",
    "select encode(digest('test', 'sha256'), 'hex');",
    "select encode(extensions.digest('test', 'sha256'), 'hex');",
    "select proconfig from pg_proc where proname='denizen_resolve_mcp_token';",
]


def psql(client, pg_pass, sql):
    cmd = (
        f"{DOCKER} exec -i -e PGPASSWORD='{pg_pass}' supabase-db "
        f"psql -U postgres -d postgres -c \"{sql}\""
    )
    _, o, e = client.exec_command(cmd)
    return (o.read() + e.read()).decode()


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    _, o, _ = client.exec_command("grep '^POSTGRES_PASSWORD=' /volume1/docker/supabase-project/.env | head -1")
    pg_pass = o.read().decode().strip().split("=", 1)[-1]
    for sql in TESTS:
        print(f"--- {sql[:72]} ---")
        print(psql(client, pg_pass, sql))
    client.close()


if __name__ == "__main__":
    main()
