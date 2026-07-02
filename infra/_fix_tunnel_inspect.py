import load_infra_env  # noqa: F401
import os
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ["SYNO_SSH_PASSWORD"]
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)
print("SSH connected to", HOST)

def sh(cmd, label=""):
    if label:
        print("\n=== " + label + " ===")
    print("$ " + cmd)
    _, stdout, stderr = c.exec_command(cmd, timeout=30)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace").strip()
    print(out[:2000] if len(out) > 2000 else out)
    return out

sh("docker ps --format '{{.Names}} {{.Status}}' | grep -E 'cloud|denizen' | cat", "Relevant containers")

sh("find /volume1 -name 'config.yml' -path '*cloud*' 2>/dev/null | head -3 | xargs -I {} sh -c 'echo \"=== {} ===\"; cat {}' 2>/dev/null || echo 'no configs'", "Cloudflared configs")

sh("ls -la /volume1/docker/dolonia.cloud/ 2>/dev/null || echo 'no dolonia.cloud'", "dolonia.cloud dir")

sh("cat /volume1/docker/cloudflared/config.yml 2>/dev/null || echo 'missing'", "Current standard config")

sh("docker inspect cloudflared --format '{{json .Mounts}}' 2>/dev/null | cat || echo no", "cloudflared mounts")

c.close()
print("\nSSH closed")