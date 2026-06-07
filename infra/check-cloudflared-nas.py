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
    f"{DOCKER} inspect cloudflare-cloudflared --format '{{{{json .Config.Cmd}}}}'",
    f"{DOCKER} inspect cloudflare-cloudflared --format '{{{{json .Mounts}}}}'",
    "ls -la /volume1/docker/cloudflared 2>/dev/null | head -20",
    "cat /volume1/docker/cloudflared/config.yml 2>/dev/null || cat /volume1/docker/compose.yaml 2>/dev/null | head -40",
]
for cmd in cmds:
    print("===", cmd[:80])
    _, o, e = c.exec_command(cmd)
    print((o.read() + e.read()).decode()[:3000])
c.close()
