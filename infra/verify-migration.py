#!/usr/bin/env python3
import os, subprocess, paramiko

tables = [
    "denizen_visitor_sessions", "denizen_org_members", "denizen_facts",
    "denizen_npc_memories", "denizen_work_output", "denizen_llm_events",
    "denizen_schema_migrations",
]

def dcount(t):
    out = subprocess.check_output([
        "docker", "exec", "supabase_db_Desktop", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
        f"SELECT count(*) FROM public.{t};",
    ], text=True)
    return int(out.strip())

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.1.237", username="admin", password=os.environ["SYNO_SSH_PASSWORD"], look_for_keys=False, allow_agent=False)

print(f"{'table':<30} {'desktop':>8} {'nas':>8}")
ok = True
for t in tables:
    d = dcount(t)
    _, o, _ = c.exec_command(
        f"/usr/local/bin/docker exec supabase-db psql -U postgres -d postgres -t -A -c "
        f"\"SELECT count(*) FROM public.{t};\""
    )
    n = int(o.read().decode().strip() or "0")
    mark = "OK" if d == n else "MISMATCH"
    if d != n:
        ok = False
    print(f"{t:<30} {d:>8} {n:>8}  {mark}")

_, o, _ = c.exec_command(
    "/usr/local/bin/docker exec supabase-db psql -U postgres -d postgres -t -A -c "
    "\"SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='intake_forms';\""
)
print(f"\nintake_forms on NAS: {o.read().decode().strip()} (Desktop has this table; not migrated)")
c.close()
print("ALL MATCH" if ok else "SOME MISMATCHES")
