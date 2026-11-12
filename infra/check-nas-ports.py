from hostcfg import get_host
import os
import time
import paramiko

DOCKER = "/usr/local/bin/docker"
DIR = "/volume1/docker/supabase-project"
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    get_host("SYNO_HOST"),
    username="admin",
    password=os.environ["SYNO_SSH_PASSWORD"],
    look_for_keys=False,
    allow_agent=False,
)

def run(cmd):
    print("$", cmd, flush=True)
    _, o, e = c.exec_command(cmd, timeout=120)
    print((o.read() + e.read()).decode().rstrip() or "(no output)")

time.sleep(15)
run(f"{DOCKER} compose -f {DIR}/docker-compose.yml ps")
run("curl -s -o /dev/null -w 'port8000:%{http_code}' http://127.0.0.1:8000/; echo")
run(f"{DOCKER} logs --tail 15 supabase-kong 2>&1")
run("netstat -tlnp 2>/dev/null | grep ':5432 ' || ss -tlnp | grep ':5432 '")
c.close()
