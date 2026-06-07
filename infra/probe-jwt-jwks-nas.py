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
DOCKER = "/usr/local/bin/docker"
cmds = [
    "grep '^JWT_JWKS=' /volume1/docker/supabase-project/.env",
    f"{DOCKER} inspect supabase-storage --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' | grep JWT",
    f"{DOCKER} inspect realtime-dev.supabase-realtime --format '{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}' | grep JWT",
    f"{DOCKER} logs --tail 8 supabase-storage 2>&1",
    f"{DOCKER} compose -f /volume1/docker/supabase-project/docker-compose.yml ps -a storage realtime",
]
for cmd in cmds:
    print("===", cmd[:100])
    _, o, e = c.exec_command(cmd)
    print((o.read() + e.read()).decode())
c.close()
