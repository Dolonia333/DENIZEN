from hostcfg import get_host
import load_infra_env  # noqa: F401
import os
import paramiko

HOST = get_host("SYNO_HOST")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ["SYNO_SSH_PASSWORD"]
DOCKER = "/usr/local/bin/docker"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)
print("SSH connected to NAS")

def run(cmd, label=""):
    if label:
        print(f"\n=== {label} ===")
    print(f"$ {cmd}")
    _, stdout, stderr = c.exec_command(cmd, timeout=30)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace").strip()
    print(out[:3000] if len(out) > 3000 else out)
    return out

# 1. Containers
run(f"{DOCKER} ps -a --filter name=cloud --format \"table {{.Names}}\\t{{.Status}}\\t{{.Ports}}\"", "Cloudflared containers")

# 2. Directories
run("find /volume1 -type d -name '*cloudflared*' 2>/dev/null | head -10", "Cloudflared directories")

# 3. Config files
run("find /volume1 -name 'config.yml' -path '*cloud*' 2>/dev/null | head -5 | xargs -I {} sh -c 'echo \"=== {} ===\"; cat {}' 2>/dev/null || echo 'no configs found'", "Config files")

# 4. Container inspect (cmd, image, mounts)
run(f"{DOCKER} ps -q --filter name=cloud | head -1 | xargs -r {DOCKER} inspect --format 'CMD: {{.Config.Cmd}} Image: {{.Config.Image}} Mounts: {{json .Mounts}}' 2>/dev/null || echo 'no running cloud container'", "Running container details")

# 5. Logs
run(f"{DOCKER} logs --tail 30 $({DOCKER} ps -q --filter name=cloud | head -1) 2>&1 | cat || echo 'no logs'", "Recent logs")

# 6. Look for real tunnel ID or token
run("grep -r -i 'tunnel\\|cloudflared' /volume1 --include='*.json' --include='*.yml' --include='*.env' 2>/dev/null | grep -v example | head -20 || echo 'no real tunnel data found'", "Search for real tunnel credentials")

# 7. How the container is managed (docker-compose or Container Manager)
run("ls /volume1/docker/cloudflared/ 2>/dev/null; ls /volume1/@appdata/ContainerManager/all_shares/docker/cloudflared/ 2>/dev/null || echo 'no special dirs'", "Management locations")

c.close()
print("\nSSH closed")