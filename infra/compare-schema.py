#!/usr/bin/env python3
from hostcfg import get_host
import os, subprocess, paramiko

def desktop_cols(table):
    out = subprocess.check_output([
        "docker", "exec", "supabase_db_Desktop", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
        f"SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='{table}' ORDER BY ordinal_position;"
    ], text=True)
    return [x.strip() for x in out.splitlines() if x.strip()]

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(get_host("SYNO_HOST"), username="admin", password=os.environ["SYNO_SSH_PASSWORD"], look_for_keys=False, allow_agent=False)
_, o, _ = c.exec_command(
    "/usr/local/bin/docker exec supabase-db psql -U postgres -d postgres -t -A -c "
    "\"SELECT table_name || '|' || column_name FROM information_schema.columns "
    "WHERE table_schema='public' AND table_name LIKE 'denizen%' ORDER BY table_name, ordinal_position;\""
)
nas = {}
for line in o.read().decode().splitlines():
    if '|' in line:
        t, col = line.split('|', 1)
        nas.setdefault(t, []).append(col)
c.close()

tables = sorted(set(nas) | set())
for table in sorted(nas):
    d = set(desktop_cols(table))
    n = set(nas[table])
    if d != n:
        print(table)
        print('  desktop only:', sorted(d - n))
        print('  nas only:', sorted(n - d))
