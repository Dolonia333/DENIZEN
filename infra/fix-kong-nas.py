from hostcfg import get_host
import os
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

def run(cmd, timeout=600):
    print("$", cmd, flush=True)
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode()
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    return code

run(f"chmod +x {DIR}/volumes/api/kong-entrypoint.sh")
run(f"ls -la {DIR}/volumes/api/")
run(f"cd {DIR} && {DOCKER} compose up -d --wait", timeout=1800)
run(f"{DOCKER} compose -f {DIR}/docker-compose.yml ps")
run("curl -s -o /dev/null -w 'port8000:%{http_code}' http://127.0.0.1:8000/; echo")
c.close()
