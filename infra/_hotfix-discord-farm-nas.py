#!/usr/bin/env python3
"""Hotfix Discord/office data farm → NAS denizen-server container."""
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
USER = os.environ.get("SYNO_USER", "admin")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

FILES = [
    ("src/denizen-discord-farm.js", "/app/src/denizen-discord-farm.js"),
    ("src/denizen-conversation-sense.js", "/app/src/denizen-conversation-sense.js"),
    ("src/denizen-learning-metrics.js", "/app/src/denizen-learning-metrics.js"),
    ("server.js", "/app/server.js"),
    ("discord-bot/index.js", "/app/discord-bot/index.js"),
    ("discord-bot/src/chat.js", "/app/discord-bot/src/chat.js"),
    ("discord-bot/src/help-copy.js", "/app/discord-bot/src/help-copy.js"),
    ("discord-bot/src/modules/data-farm/index.js", "/app/discord-bot/src/modules/data-farm/index.js"),
    ("discord-bot/src/modules/load-modules.js", "/app/discord-bot/src/modules/load-modules.js"),
    ("discord-bot/src/core/config-store.js", "/app/discord-bot/src/core/config-store.js"),
]


def run(client, cmd, timeout=180):
    print("$", cmd[:160], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip()[:1500].encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status()


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    for rel, _ in FILES:
        p = DENIZEN / rel
        if not p.is_file():
            print(f"missing {p}", file=sys.stderr)
            return 1

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "farm.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel, _ in FILES:
                tar.add(DENIZEN / rel, arcname=rel)

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USER, password=PWD, look_for_keys=False, allow_agent=False)

        rt = f"{REMOTE}/discord-farm.tar.gz"
        ed = f"{REMOTE}/discord-farm"
        stdin, stdout, _ = client.exec_command(f"cat > '{rt}'", timeout=120)
        stdin.write(tar_path.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()

        run(client, f"rm -rf '{ed}' && mkdir -p '{ed}' && tar -xzf '{rt}' -C '{ed}'")
        run(
            client,
            f"{DOCKER} exec denizen-server mkdir -p "
            f"/app/src /app/discord-bot/src/modules/data-farm /app/discord-bot/src/core /app/data/discord-farm",
        )
        for rel, dst in FILES:
            run(client, f"{DOCKER} cp '{ed}/{rel}' denizen-server:{dst}")

        # Restart bot sidecar + server so farm module loads
        run(client, f"{DOCKER} exec denizen-server sh -c \"pkill -f '/app/discord-bot/index.js' 2>/dev/null || true\"")
        run(client, f"{DOCKER} restart denizen-server", timeout=180)
        time.sleep(20)

        run(
            client,
            f"{DOCKER} exec denizen-server node -e "
            "\"const f=require('./src/denizen-discord-farm');"
            "const r=f.ingestChatEvent({source:'deploy-smoke',guildId:'g',channelId:'c',"
            "userId:'u',content:'Why is the deploy broken? help',messageId:'m1'});"
            "const sc=f.buildDiscordFarmScorecard();"
            "console.log(JSON.stringify({ok:r.ok,signals:r.signals,msgs:sc.messages24h,enabled:sc.enabled}));\"",
        )
        run(
            client,
            f"{DOCKER} exec denizen-server node -e "
            "\"const m=require('./discord-bot/src/modules/data-farm');"
            "console.log('farm_module', typeof m.createDataFarm);\"",
        )
        run(client, f"{DOCKER} logs --tail 25 denizen-server 2>&1 | grep -iE 'discord-bot|farm|logged in|error' || true")
        run(client, f"curl -fsS -m 12 http://127.0.0.1:{PORT}/api/health | head -c 400")
        client.close()

    print("==> Discord data farm live on NAS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
