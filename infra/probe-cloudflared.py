from hostcfg import get_host
import os
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    get_host("SYNO_HOST"),
    username="admin",
    password=os.environ["SYNO_SSH_PASSWORD"],
    look_for_keys=False,
    allow_agent=False,
)
D = "/usr/local/bin/docker"
cmds = [
    f"{D} inspect cloudflare-cloudflared --format '{{{{.Config.Cmd}}}}'",
    "ls -la /volume1/docker/",
    "find /volume1/docker -maxdepth 3 -name '*.yml' 2>/dev/null | head -25",
]
for cmd in cmds:
    print("===", cmd)
    _, o, e = c.exec_command(cmd)
    print((o.read() + e.read()).decode())
c.close()
