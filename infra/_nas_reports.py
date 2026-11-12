from hostcfg import get_host
import os, sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import load_infra_env
import paramiko
HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
_, o, _ = c.exec_command(
    f"{DOCKER} exec denizen-server find /app/reports -type f -mmin -60 2>/dev/null",
    timeout=30,
)
print("reports files (60m):")
print(o.read().decode().strip() or "(none)")
_, o, _ = c.exec_command(
    f"{DOCKER} exec denizen-server ls -laR /app/reports/research 2>/dev/null | tail -20",
    timeout=30,
)
print("\nreports/research:")
print(o.read().decode().strip() or "(empty)")
c.close()
