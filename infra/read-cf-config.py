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
_, o, _ = c.exec_command("cat /volume1/docker/cloudflared/config.yml 2>/dev/null")
text = o.read().decode()
# Redact tokens if any appear
import re
text = re.sub(r"token:\s*\S+", "token: [REDACTED]", text)
print(text)
c.close()
