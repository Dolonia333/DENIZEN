#!/usr/bin/env python3
"""Hotfix: Discord pixel map + phone app + presence proxy onto NAS."""
from __future__ import annotations

import os
import sys
import tarfile
import tempfile
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401
import paramiko

ROOT = INFRA.parent
DENIZEN = ROOT / "denizen"
DISCORD_MAP = DENIZEN / "discord-map"
DISCORD_BOT = DENIZEN / "discord-bot"
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
CACHE = "discordMap1"

FILE_PATHS = [
    "server.js",
    "src/denizen-phone-ui.js",
]


def run(client, cmd, timeout=300):
    print("$", cmd[:180], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        try:
            print(out.rstrip()[:1500])
        except UnicodeEncodeError:
            print(out.rstrip()[:1500].encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status()


def add_tree(tar: tarfile.TarFile, base: Path, arc_prefix: str) -> int:
    n = 0
    if not base.is_dir():
        return n
    for p in sorted(base.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(base).as_posix()
        tar.add(p, arcname=f"{arc_prefix}/{rel}")
        n += 1
    return n


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required in infra/.env", file=sys.stderr)
        return 1

    for rel in FILE_PATHS:
        if not (DENIZEN / rel).is_file():
            print(f"missing {DENIZEN / rel}", file=sys.stderr)
            return 1
    if not DISCORD_MAP.is_dir():
        print(f"missing {DISCORD_MAP}", file=sys.stderr)
        return 1
    if not (DISCORD_MAP / "game.js").is_file():
        print("missing discord-map/game.js — copy from discord pixel game first", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "discord-map.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in FILE_PATHS:
                tar.add(DENIZEN / rel, arcname=rel)
            n_map = add_tree(tar, DISCORD_MAP, "discord-map")
            n_bot = add_tree(tar, DISCORD_BOT, "discord-bot")
        print(f"==> tarball {tar_path.stat().st_size // 1024} KB · map={n_map} bot={n_bot} files")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

        rt = f"{REMOTE}/discord-map-hotfix.tar.gz"
        ed = f"{REMOTE}/discord-map-hotfix"
        stdin, stdout, _ = client.exec_command(f"cat > '{rt}'", timeout=7200)
        with open(tar_path, "rb") as fh:
            while True:
                chunk = fh.read(1024 * 512)
                if not chunk:
                    break
                stdin.write(chunk)
        stdin.flush()
        stdin.channel.shutdown_write()
        if stdout.channel.recv_exit_status() != 0:
            print("upload failed", file=sys.stderr)
            return 1

        run(client, f"rm -rf '{ed}' && mkdir -p '{ed}' && tar -xzf '{rt}' -C '{ed}'")

        run(client, f"{DOCKER} exec denizen-server mkdir -p /app/src /app/discord-map /app/discord-bot")
        for rel in FILE_PATHS:
            run(client, f"{DOCKER} cp '{ed}/{rel}' denizen-server:/app/{rel}")

        run(
            client,
            f"{DOCKER} exec denizen-server sh -c \"rm -rf /app/discord-map && mkdir -p /app/discord-map\"",
        )
        run(client, f"{DOCKER} cp '{ed}/discord-map/.' denizen-server:/app/discord-map/")

        run(
            client,
            f"{DOCKER} exec denizen-server sh -c \"rm -rf /app/discord-bot && mkdir -p /app/discord-bot\"",
        )
        run(client, f"{DOCKER} cp '{ed}/discord-bot/.' denizen-server:/app/discord-bot/")

        run(
            client,
            f"{DOCKER} exec denizen-server sh -c \"cd /app/discord-bot && npm ci --omit=dev 2>&1 | tail -5\"",
            timeout=600,
        )

        run(client, f"{DOCKER} restart denizen-server", timeout=180)
        run(client, f"sleep 12 && curl -fsS -m 20 http://127.0.0.1:{PORT}/api/health | head -c 400")

        run(
            client,
            f"{DOCKER} exec denizen-server sh -c \"pkill -f '/app/discord-bot/index.js' 2>/dev/null || true\"",
        )
        run(
            client,
            f"{DOCKER} exec -d denizen-server sh -c "
            f"\"cd /app/discord-bot && node index.js >> /app/data/discord-bot.log 2>&1\"",
        )
        run(client, "sleep 6")
        run(
            client,
            f"curl -fsS -m 15 http://127.0.0.1:{PORT}/api/discord/map/presence | head -c 500",
        )
        run(
            client,
            f"curl -fsS -m 15 -I http://127.0.0.1:{PORT}/discord-map/play.html | head -8",
        )
        run(
            client,
            f"curl -fsS -m 15 http://127.0.0.1:{PORT}/discord-map/game.js | grep -o 'map/presence' | head -1",
        )
        run(
            client,
            f"{DOCKER} exec denizen-server sh -c \"grep -c discordmap /app/src/denizen-phone-ui.js\"",
        )
        client.close()

    print(f"==> Discord map live on NAS ({CACHE}) · https://denizen.dolonia.cloud/discord-map/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
