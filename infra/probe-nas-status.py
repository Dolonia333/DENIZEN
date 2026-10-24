from hostcfg import get_host
import os
import paramiko

DOCKER = "/usr/local/bin/docker"
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    get_host("SYNO_HOST"),
    username="admin",
    password=os.environ["SYNO_SSH_PASSWORD"],
    look_for_keys=False,
    allow_agent=False,
)
cmds = [
    "ls -la /volume1/docker/supabase-project 2>&1 | head -15",
    "test -f /volume1/docker/supabase-project/docker-compose.yml && echo COMPOSE_OK || echo COMPOSE_MISSING",
    "test -f /volume1/docker/supabase-project/.env && echo ENV_OK || echo ENV_MISSING",
    f"{DOCKER} ps -a --filter name=supabase --format 'table {{{{.Names}}}}\t{{{{.Status}}}}\t{{{{.Ports}}}}' 2>&1",
    f"{DOCKER} compose -f /volume1/docker/supabase-project/docker-compose.yml ps 2>&1",
    "curl -s -o /dev/null -w 'port8000:%{http_code}' http://127.0.0.1:8000/ 2>&1; echo",
    "du -sh /volume1/docker/supabase-project 2>&1",
]
for cmd in cmds:
    print("===", cmd)
    _, o, e = c.exec_command(cmd)
    print((o.read() + e.read()).decode())
c.close()
