#!/usr/bin/env python3
"""Fix Supabase storage + realtime on Synology NAS (JWT_JWKS)."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"
DIR = "/volume1/docker/supabase-project"
LOCAL_ENV = Path(__file__).resolve().parent / "supabase-project" / ".env"


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    print("$", cmd, flush=True)
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode()
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    return code, out


def read_env_value(path: Path, key: str) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
    if not match:
        raise KeyError(key)
    return match.group(1).strip()


def patch_remote_env(client: paramiko.SSHClient, updates: dict[str, str]) -> None:
    remote_path = f"{DIR}/.env"
    sftp = client.open_sftp()
    with sftp.file(remote_path, "r") as remote:
        lines = remote.read().decode("utf-8").splitlines()

    out: list[str] = []
    seen: set[str] = set()
    for line in lines:
        if "=" not in line or line.lstrip().startswith("#"):
            out.append(line)
            continue
        key, _ = line.split("=", 1)
        if key in updates:
            out.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            out.append(line)

    for key, value in updates.items():
        if key not in seen:
            out.append(f"{key}={value}")

    patched = "\n".join(out) + "\n"
    tmp_path = f"{remote_path}.jwt-fix"
    with sftp.file(tmp_path, "w") as remote:
        remote.write(patched.encode("utf-8"))
    sftp.close()
    run(client, f"mv {tmp_path} {remote_path}")


def main() -> int:
    if not PASSWORD:
        print("Set SYNO_SSH_PASSWORD", file=sys.stderr)
        return 1
    if not LOCAL_ENV.is_file():
        print(f"Missing local env: {LOCAL_ENV}", file=sys.stderr)
        return 1

    jwt_jwks = read_env_value(LOCAL_ENV, "JWT_JWKS")
    jwt_keys = read_env_value(LOCAL_ENV, "JWT_KEYS")
    if not jwt_jwks or jwt_jwks == "":
        print("Local JWT_JWKS is empty — run prepare-dolonia.ps1 first", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST,
        username=USER,
        password=PASSWORD,
        look_for_keys=False,
        allow_agent=False,
    )

    print("=== Before ===")
    run(client, f"{DOCKER} compose -f {DIR}/docker-compose.yml ps -a storage realtime")
    run(client, f"grep '^JWT_JWKS=' {DIR}/.env | cut -c1-40")

    print("\n=== Patch JWT_JWKS + JWT_KEYS on NAS ===")
    patch_remote_env(client, {"JWT_JWKS": jwt_jwks, "JWT_KEYS": jwt_keys})
    run(client, f"grep '^JWT_JWKS=' {DIR}/.env | cut -c1-60")

    print("\n=== Ensure storage volume ===")
    run(client, f"mkdir -p {DIR}/volumes/storage && chmod -R 777 {DIR}/volumes/storage")

    print("\n=== Recreate storage + realtime ===")
    run(
        client,
        f"cd {DIR} && {DOCKER} compose up -d storage realtime --force-recreate",
        timeout=1800,
    )
    run(client, f"cd {DIR} && {DOCKER} compose up -d --wait storage realtime", timeout=1800)

    print("\n=== After ===")
    run(client, f"{DOCKER} compose -f {DIR}/docker-compose.yml ps -a storage realtime")
    run(client, f"{DOCKER} logs --tail 15 supabase-storage")
    run(client, f"{DOCKER} logs --tail 15 realtime-dev.supabase-realtime")

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
