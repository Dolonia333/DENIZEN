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
    f"{DOCKER} --version",
    f"{DOCKER} ps -a --format 'table {{{{.Names}}}}\t{{{{.Status}}}}\t{{{{.Ports}}}}' 2>&1 | head -40",
    "ls -la /volume1/docker/supabase 2>&1 | head -30",
    "test -f /volume1/docker/supabase/docker-compose.yml && echo HAS_COMPOSE || echo NO_COMPOSE",
]
for cmd in cmds:
    print("===", cmd)
    _, o, e = c.exec_command(cmd)
    print((o.read() + e.read()).decode())
c.close()
