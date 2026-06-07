#!/usr/bin/env python3
import os, paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.1.237", username="admin", password=os.environ["SYNO_SSH_PASSWORD"], look_for_keys=False, allow_agent=False)
cmds = [
    "/usr/local/bin/docker exec supabase-db psql -U postgres -d postgres -t -A -c \"SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'denizen%' ORDER BY 1;\"",
    "/usr/local/bin/docker exec supabase-db psql -U postgres -d postgres -t -A -c \"SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('is_admin','update_updated_at_column','denizen_user_can_access_org');\"",
]
for cmd in cmds:
    print("===", cmd[:90])
    _, o, e = c.exec_command(cmd)
    print((o.read() + e.read()).decode())
c.close()
