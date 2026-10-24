from hostcfg import get_host
import json, os, sys
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
cmds = [
    f"{DOCKER} exec denizen-server node -p \"Object.keys(new (require('/app/src/npc-brains.js'))().brains).sort().join(',')\"",
    f"{DOCKER} exec denizen-server printenv DENIZEN_PUBLIC_DEMO_TRIM_BRAINS",
    f"{DOCKER} exec denizen-server grep -c ceoDirectOrder /app/server.js",
]
for cmd in cmds:
    _, o, e = c.exec_command(cmd, timeout=30)
    print(">", cmd[:80])
    print((o.read() + e.read()).decode().strip())
    print()
c.close()
