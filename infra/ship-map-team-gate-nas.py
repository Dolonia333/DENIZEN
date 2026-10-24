#!/usr/bin/env python3
"""Ship Discord map team-code gate to NAS (hot-copy + pet/guild-org migration).

Requires infra/.env with SYNO_SSH_PASSWORD.

  py infra/_ship-map-team-gate-nas.py
"""
from __future__ import annotations

from hostcfg import get_host
import os
import sys
import tarfile
import tempfile
import time
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401
import paramiko

DENIZEN = INFRA.parent / "denizen"
HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

FILES = [
    "server.js",
    "src/denizen-guild-org.js",
    "src/denizen-map-access.js",
    "src/visitor-session-auth.js",
    "discord-map/index.html",
    "discord-map/game.js",
    "discord-bot/src/modules/denizen/index.js",
    "discord-bot/src/help-copy.js",
    "discord-bot/src/modules/hangout/index.js",
    "discord-bot/src/presence-server.js",
    "docs/DISCORD_BOT_AND_SPACES.md",
]

MIGRATION = DENIZEN / "supabase/migrations/20260719000001_discord_guild_orgs.sql"


def run(c, cmd, timeout=180):
    shown = cmd
    if "PGPASSWORD=" in shown:
        shown = "psql … (password redacted)"
    print("$", shown[:160], flush=True)
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    safe = out.encode("ascii", errors="replace").decode("ascii")
    if safe.strip() and "PASSWORD" not in safe.upper():
        print(safe.rstrip()[-2500:], flush=True)
    return out, o.channel.recv_exit_status()


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD missing — copy infra/.env.example → infra/.env")
        return 1
    if not MIGRATION.is_file():
        print("missing migration", MIGRATION)
        return 1

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=os.environ.get("SYNO_USER", "admin"),
              password=PWD, look_for_keys=False, allow_agent=False)

    # --- migration ---
    _, o, e = c.exec_command(
        "grep '^POSTGRES_PASSWORD=' /volume1/docker/supabase-project/.env | head -1",
        timeout=30,
    )
    env_out = (o.read() + e.read()).decode("utf-8", errors="replace")
    o.channel.recv_exit_status()
    pg_pass = env_out.strip().split("=", 1)[-1].strip() if "=" in env_out else ""
    if not pg_pass:
        print("POSTGRES_PASSWORD not found on NAS")
        c.close()
        return 1
    print("POSTGRES_PASSWORD: set", flush=True)

    remote_sql = f"{REMOTE}/migrations/{MIGRATION.name}"
    run(c, f"mkdir -p '{REMOTE}/migrations'")
    stdin, stdout, _ = c.exec_command(f"cat > '{remote_sql}'", timeout=60)
    stdin.write(MIGRATION.read_bytes())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()

    out, _ = run(
        c,
        f"echo \"select version from public.denizen_schema_migrations "
        f"where version='20260719000001';\" | "
        f"{DOCKER} exec -i -e PGPASSWORD='{pg_pass}' supabase-db "
        f"psql -U postgres -d postgres -t -A",
    )
    if "20260719000001" in out:
        print("migration already applied")
    else:
        # Avoid echoing SQL + password via noisy run(); capture only status
        print("applying migration 20260719000001…", flush=True)
        cmd = (
            f"cat '{remote_sql}' | {DOCKER} exec -i -e PGPASSWORD='{pg_pass}' supabase-db "
            f"psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q"
        )
        _, o2, e2 = c.exec_command(cmd, timeout=120)
        mig_out = (o2.read() + e2.read()).decode("utf-8", errors="replace")
        code = o2.channel.recv_exit_status()
        if code != 0:
            print("migration FAILED:", mig_out[-800:].encode("ascii", errors="replace").decode("ascii"))
            c.close()
            return code
        print("migration applied")

    # --- hot-copy runtime files ---
    with tempfile.TemporaryDirectory() as td:
        tar_path = Path(td) / "gate.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in FILES:
                p = DENIZEN / rel
                if p.is_file():
                    tar.add(p, arcname=rel)
        remote_tar = f"{REMOTE}/map-gate.tar.gz"
        extract = f"{REMOTE}/map-gate"
        stdin, stdout, _ = c.exec_command(f"cat > '{remote_tar}'", timeout=300)
        stdin.write(tar_path.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()
        run(c, f"rm -rf '{extract}' && mkdir -p '{extract}' && tar -xzf '{remote_tar}' -C '{extract}'")
        dirs = sorted({str(Path(r).parent).replace("\\", "/") for r in FILES if Path(r).parent != Path(".")})
        for d in dirs:
            run(c, f"{DOCKER} exec denizen-server mkdir -p /app/{d}")
        for rel in FILES:
            if (DENIZEN / rel).is_file():
                run(c, f"{DOCKER} cp '{extract}/{rel}' denizen-server:/app/{rel}")

    run(c, f"{DOCKER} restart denizen-server", timeout=120)
    run(
        c,
        "for i in $(seq 1 25); do "
        f"curl -fsS -m 3 http://127.0.0.1:{PORT}/api/health >/dev/null 2>&1 && echo ready && break; sleep 2; done",
        timeout=90,
    )
    run(
        c,
        f"curl -fsS -m 10 'http://127.0.0.1:{PORT}/api/discord/map/access?guildId=1' | head -c 400",
    )
    c.close()
    print("==> map team-code gate live")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
