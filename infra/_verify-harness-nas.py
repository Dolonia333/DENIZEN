#!/usr/bin/env python3
import os
import paramiko
import load_infra_env  # noqa: F401

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    os.environ.get("SYNO_HOST", "192.168.1.237"),
    username="admin",
    password=os.environ["SYNO_SSH_PASSWORD"],
    look_for_keys=False,
    allow_agent=False,
)
docker = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
cmds = [
    f"{docker} exec denizen-server ls -la /app/src/inference-sampling.js /app/src/grok-mentor-drainer.js /app/src/office-awareness.js",
    f"{docker} logs denizen-server 2>&1 | grep -i 'Grok mentor' | tail -3",
    f"{docker} exec denizen-server node /app/scripts/run-grok-mentor-drainer.cjs",
]
for cmd in cmds:
    print("---", cmd[:80])
    _, o, _ = c.exec_command(cmd, timeout=60)
    print(o.read().decode("utf-8", "replace"))
c.close()
