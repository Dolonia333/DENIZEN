#!/usr/bin/env python3
"""Apply Denizen SQL migrations on NAS Supabase via docker exec."""

from __future__ import annotations

import os
import re
import tarfile
import tempfile
from pathlib import Path

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"
DB_CONTAINER = "supabase-db"
REMOTE_DIR = "/volume1/docker/denizen-migrations"
LOCAL_DIR = Path(__file__).resolve().parents[1] / "denizen" / "supabase" / "migrations"
# Platform-bridge migrations need Dolonia website tables (intake_forms, etc.)
SKIP_VERSIONS = {
    20260606000005,
    20260606000006,
    20260606000012,
    20260606000013,
}
ONLY_VERSIONS = os.environ.get("ONLY_MIGRATIONS", "").strip()
ONLY_SET = {int(x) for x in ONLY_VERSIONS.split(",") if x.strip().isdigit()} if ONLY_VERSIONS else None


def migration_version(name: str) -> int | None:
    m = re.match(r"^(\d{14})_", name)
    return int(m.group(1)) if m else None


def migration_role(version: int, path: Path) -> str:
    if version == 20260606000012:
        return "postgres"
    if version == 20260606000013:
        return "supabase_admin"
    name = path.name.lower()
    if "admin" in name:
        return "supabase_admin"
    header = path.read_text(encoding="utf-8", errors="replace")[:4000]
    if re.search(r"apply as\s+supabase_admin", header, re.I) or re.search(
        r"owned by supabase_admin", header, re.I
    ):
        return "supabase_admin"
    return "postgres"


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    print("$", cmd, flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    return code, out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    files = sorted(
        [p for p in LOCAL_DIR.glob("*.sql") if migration_version(p.name) is not None],
        key=lambda p: migration_version(p.name) or 0,
    )
    print(f"Found {len(files)} migrations")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

    run(client, f"mkdir -p {REMOTE_DIR}")
    tmp = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    try:
        with tarfile.open(tmp_path, "w:gz") as tar:
            for p in files:
                tar.add(p, arcname=p.name)
        print(f"Streaming migrations to {REMOTE_DIR}")
        stdin, stdout, stderr = client.exec_command(
            f"mkdir -p {REMOTE_DIR} && cd {REMOTE_DIR} && tar xzf -",
            timeout=300,
        )
        with open(tmp_path, "rb") as fh:
            while chunk := fh.read(1024 * 256):
                stdin.write(chunk)
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.read()
        err = stderr.read().decode()
        if err.strip():
            print(err)
    finally:
        tmp_path.unlink(missing_ok=True)

    _, out = run(client, "grep '^POSTGRES_PASSWORD=' /volume1/docker/supabase-project/.env | head -1")
    pg_pass = out.strip().split("=", 1)[-1]

    for path in files:
        ver = migration_version(path.name) or 0
        if ONLY_SET is not None and ver not in ONLY_SET:
            continue
        if ver in SKIP_VERSIONS:
            print(f"\n==> SKIP {path.name} (platform tables not on fresh Supabase)")
            continue
        role = migration_role(ver, path)
        remote = f"{REMOTE_DIR}/{path.name}"
        cmd = (
            f"cat '{remote}' | {DOCKER} exec -i -e PGPASSWORD='{pg_pass}' {DB_CONTAINER} "
            f"psql -v ON_ERROR_STOP=1 -U {role} -d postgres"
        )
        print(f"\n==> {path.name} as {role}")
        code, _ = run(client, cmd, timeout=300)
        if code != 0:
            print(f"FAILED: {path.name}")
            client.close()
            return code

    run(
        client,
        (
            f"echo \"select count(*) from public.denizen_schema_migrations;\" | "
            f"{DOCKER} exec -i -e PGPASSWORD='{pg_pass}' {DB_CONTAINER} "
            f"psql -U postgres -d postgres -t -A"
        ),
    )
    client.close()
    print("Migrations complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
