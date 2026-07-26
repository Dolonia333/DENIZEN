#!/usr/bin/env python3
"""Install the nightly NAS backup loop (Postgres pg_dump + runtime-data tar).

Starts a `denizen-db-backup` container (docker:27-cli, restart
unless-stopped) that dumps supabase-db daily to
/volume1/docker/backups/denizen/pg-<stamp>.sql.gz and tars the deploy dir's
data/ + layouts/ binds. Keeps KEEP_DAYS (default 14) days.

Run: py -3.12 infra/setup-nas-db-backup.py
"""

from __future__ import annotations
import os
import time

import load_infra_env  # noqa: F401
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PW = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
DEPLOY_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
BACKUP_DIR = os.environ.get("SYNO_BACKUP_DIR", "/volume1/docker/backups/denizen")
SUPA_ENV = "/volume1/docker/supabase-project/.env"
IMAGE = os.environ.get("DENIZEN_DEPLOYER_IMAGE", "docker:27-cli")
LOOP_SRC = os.path.join(os.path.dirname(__file__), "nas-db-backup-loop.sh")


def run(client, cmd, timeout=300):
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out


def main() -> int:
    if not PW:
        print("ERROR: SYNO_SSH_PASSWORD required")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PW,
                   look_for_keys=False, allow_agent=False)

    run(client, f"mkdir -p {BACKUP_DIR}")

    # stream the loop script (Synology SFTP is restricted)
    with open(LOOP_SRC, "rb") as fh:
        payload = fh.read().replace(b"\r\n", b"\n")
    stdin, stdout, stderr = client.exec_command(
        f"cat > {DEPLOY_DIR}/db-backup-loop.sh", timeout=120)
    stdin.write(payload)
    stdin.flush()
    stdin.channel.shutdown_write()
    if stdout.channel.recv_exit_status() != 0:
        print("upload failed:", stderr.read().decode()[:200])
        return 1
    run(client, f"chmod +x {DEPLOY_DIR}/db-backup-loop.sh")

    run(client, f"{DOCKER} rm -f denizen-db-backup 2>/dev/null")
    cmd = (
        f"{DOCKER} run -d --name denizen-db-backup --restart unless-stopped "
        f"-v /var/run/docker.sock:/var/run/docker.sock "
        f"-v {BACKUP_DIR}:/backups "
        f"-v {DEPLOY_DIR}:{DEPLOY_DIR}:ro "
        f"-v {SUPA_ENV}:{SUPA_ENV}:ro "
        f"-e DEPLOY_DIR='{DEPLOY_DIR}' -e SUPA_ENV='{SUPA_ENV}' "
        f"-e KEEP_DAYS='14' -e INTERVAL_SECONDS='86400' "
        f"--entrypoint /bin/sh {IMAGE} {DEPLOY_DIR}/db-backup-loop.sh"
    )
    code, out = run(client, cmd, timeout=600)
    if code != 0:
        print("backup container start failed:", out)
        return 1
    print("denizen-db-backup started:", out.strip()[:20])

    time.sleep(6)
    _, logs = run(client, f"{DOCKER} logs --tail 6 denizen-db-backup 2>&1")
    print("--- backup log ---")
    print(logs)
    client.close()
    print(f"Backups land in {BACKUP_DIR}. First dump runs immediately; "
          f"then every 24h. Add this folder to Hyper Backup / off-NAS sync.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
