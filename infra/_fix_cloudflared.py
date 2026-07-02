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

configs = [
    "/volume1/docker/cloudflared/config.yml",
    "/volume1/@appdata/ContainerManager/all_shares/docker/cloudflared/config.yml"
]

new_config = """tunnel: example-tunnel-id
credentials-file: /etc/cloudflared/example-tunnel-id.json

ingress:
  - hostname: denizen.dolonia.cloud
    service: http://127.0.0.1:8888
  - service: http_status:404
"""

for cfg in configs:
    print("Updating", cfg)
    # Use cat <<EOF to avoid quote hell
    cmd = f'cat > {cfg} << "EOF"\n{new_config}EOF\ncat {cfg}'
    _, o, e = c.exec_command(cmd, timeout=20)
    print((o.read() + e.read()).decode(errors="replace").strip())
    print("---")

# Restart
print("Attempting restart of cloudflared container")
restart_cmd = f'{DOCKER} ps -q -f name=cloudflared | head -1 | xargs -r {DOCKER} restart || echo "restart attempted or no container matched"'
_, o, e = c.exec_command(restart_cmd, timeout=30)
print((o.read() + e.read()).decode(errors="replace").strip())

c.close()
print("Done. Now test public URL.")