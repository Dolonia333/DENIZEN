#!/usr/bin/env python3
from hostcfg import get_host
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env  # noqa: F401
import paramiko

HOST = get_host("SYNO_HOST")
PW = os.environ.get("SYNO_SSH_PASSWORD", "")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username="admin", password=PW, look_for_keys=False, allow_agent=False)
for url in (
    "http://" + get_host("DENIZEN_HOME_HOST") + ":1234/v1/models",
    "http://" + get_host("LM_STUDIO_HOST") + ":1234/v1/models",
    "http://" + get_host("LM_STUDIO_HOST") + ":8081/api/health",
):
    cmd = f"curl -fsS --max-time 8 '{url}' 2>&1 | cut -c1-250"
    _, out, err = client.exec_command(cmd)
    print("---", url, "---")
    print((out.read() + err.read()).decode())
client.close()
