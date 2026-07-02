import load_infra_env  # noqa: F401
import os
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ["SYNO_SSH_PASSWORD"]
DOCKER = "/usr/local/bin/docker"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)
print("SSH connected")

def sh(cmd, label=""):
    if label: print("\n=== " + label + " ===")
    print("$ " + cmd)
    _, o, e = c.exec_command(cmd, timeout=30)
    out = (o.read() + e.read()).decode("utf-8", errors="replace").strip()
    print(out[:1800])
    print("---")
    return out

# Test the MCP endpoint locally (will 401 without token, but proves route/handler is alive)
sh("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8888/mcp/npc/abby -H 'Content-Type: application/json' --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\"}}' || echo 'curl failed'", "MCP /npc/abby initialize status code (expect 401)")

sh("curl -s http://127.0.0.1:8888/mcp/npc/abby -H 'Authorization: Bearer test123' -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"probe\",\"version\":\"1\"}}}' | head -c 500 || echo failed", "MCP initialize attempt")

# List containers with full docker
sh(f"{DOCKER} ps --format 'table {{.Names}} {{.Status}}' | grep -E 'denizen|cloud|supa' | cat", "Containers")

c.close()
print("done")