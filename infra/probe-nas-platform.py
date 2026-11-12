#!/usr/bin/env python3
from hostcfg import get_host
import os, paramiko
HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"
DB = "supabase-db"
queries = [
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('projects','invoices','subscriptions','clients','leads') ORDER BY 1",
    "SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND typtype='e' ORDER BY 1",
    "SELECT count(*) AS intake_forms FROM intake_forms",
    "SELECT viewname FROM pg_views WHERE viewname IN ('denizen_intake_funnel','denizen_rfp_velocity')",
]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
for q in queries:
    _, o, e = c.exec_command(f'{DOCKER} exec {DB} psql -U postgres -d postgres -t -A -c "{q};"')
    print(q, "=>", (o.read() + e.read()).decode().strip())
c.close()
