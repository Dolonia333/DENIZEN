#!/usr/bin/env python3
from hostcfg import get_host
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import load_infra_env  # noqa
import paramiko
HOST = get_host("SYNO_HOST")
PWD = os.environ["SYNO_SSH_PASSWORD"]
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
for cmd in ["which python3", "which python", "test -S /var/run/docker.sock && echo docker-sock-yes || echo docker-sock-no"]:
    _, o, e = c.exec_command(f'{DOCKER} exec denizen-server sh -c "{cmd}"')
    print(cmd, "->", (o.read() + e.read()).decode().strip())
c.close()
