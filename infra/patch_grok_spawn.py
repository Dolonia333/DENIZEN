from hostcfg import get_host
import load_infra_env  # noqa: F401
import os
import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ["SYNO_SSH_PASSWORD"]
DOCKER = "/usr/local/bin/docker"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
print("connected")

# Use node to patch safely
node_patch = r'''
const fs = require("fs");
let code = fs.readFileSync("/app/office-scene.js", "utf8");
if (!code.includes("xp_grok")) {
  code = code.replace(/'xp_roki'/, "'xp_roki',\n      'xp_grok'");
  fs.writeFileSync("/app/office-scene.js", code);
  console.log("added xp_grok");
} else {
  console.log("already present");
}
'''
cmd = f'{DOCKER} exec denizen-server node -e "{node_patch}"'
_, o, e = c.exec_command(cmd, timeout=25)
print((o.read() + e.read()).decode(errors="replace"))

# Verify
ver = f'{DOCKER} exec denizen-server grep -A6 "const npcKeys" /app/office-scene.js | head -20'
_, o, e = c.exec_command(ver, timeout=15)
print("Current npcKeys snippet:")
print((o.read() + e.read()).decode(errors="replace"))

c.close()
print("patch script finished")