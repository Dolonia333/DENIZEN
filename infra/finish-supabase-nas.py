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

def run(cmd, timeout=1800):
    print("$", cmd, flush=True)
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode()
    err = e.read().decode()
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip())
    return code

print("=== Current state ===")
run(f"{DOCKER} compose -f {DIR}/docker-compose.yml ps -a")
run(f"{DOCKER} logs --tail 30 supabase-db 2>&1")
run(f"{DOCKER} logs --tail 20 supabase-kong 2>&1")

print("\n=== Creating required volume directories ===")
run(f"mkdir -p {DIR}/volumes/db/data {DIR}/volumes/storage {DIR}/volumes/snippets")
run(f"ls -la {DIR}/volumes/db/")

print("\n=== Finishing docker compose up ===")
code = run(f"cd {DIR} && {DOCKER} compose up -d --wait", timeout=1800)
print("exit:", code)

print("\n=== Final state ===")
run(f"{DOCKER} compose -f {DIR}/docker-compose.yml ps")
run("curl -s -o /dev/null -w 'port8000:%{http_code}' http://127.0.0.1:8000/; echo")
c.close()
