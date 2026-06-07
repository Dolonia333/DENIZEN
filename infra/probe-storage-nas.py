#!/usr/bin/env python3
import os
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "192.168.1.237",
    username="admin",
    password=os.environ["SYNO_SSH_PASSWORD"],
    look_for_keys=False,
    allow_agent=False,
)
D = "/usr/local/bin/docker"
cmds = [
    f"{D} logs supabase-storage 2>&1 | tail -80",
    f"{D} inspect supabase-storage --format 'Status={{{{.State.Status}}}} Exit={{{{.State.ExitCode}}}} Health={{{{.State.Health.Status}}}}'",
    f"{D} exec supabase-storage ps aux 2>&1",
    f"{D} compose -f /volume1/docker/supabase-project/docker-compose.yml ps storage realtime",
    f"{D} logs realtime-dev.supabase-realtime 2>&1 | tail -15",
]
for cmd in cmds:
    print("===", cmd[:110])
    _, o, e = c.exec_command(cmd, timeout=90)
    print((o.read() + e.read()).decode())
c.close()
