#!/usr/bin/env python3
"""Enable Redis world pub/sub on NAS Denizen primary + follower relay nodes."""

from __future__ import annotations

import load_infra_env  # noqa: F401

import base64
import os
import re
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
# NOTE: docker-compose.yml for denizen-server declares env_file: .env.production,
# so THAT is the file the container actually reads. Patching plain .env wrote to a
# file nothing loads — these patches silently had no effect (this is why the CLI
# bridge env never reached the server). Also: docker restart does NOT reload env;
# use .
ENV_PATH = "/volume1/docker/denizen-server/.env.production"
REDIS_PORT = os.environ.get("DENIZEN_REDIS_PORT", "6379")
PRIMARY_PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
IMAGE = os.environ.get("DENIZEN_DOCKER_IMAGE", "denizen-server:latest")
HOTFIX = "/volume1/docker/denizen-server/inference-hotfix-src/server.js"

# name, port — second follower optional via DENIZEN_FOLLOWER_PORTS=8889,8890
def follower_specs() -> list[tuple[str, str]]:
    raw = os.environ.get("DENIZEN_FOLLOWER_PORTS", "8889,8890")
    ports = [p.strip() for p in raw.split(",") if p.strip()]
    specs: list[tuple[str, str]] = []
    for i, port in enumerate(ports):
        name = "denizen-follower" if i == 0 else f"denizen-follower-{chr(ord('b') + i - 1)}"
        specs.append((name, port))
    return specs


def default_spectate_ws() -> str:
    return os.environ.get(
        "DENIZEN_SPECTATE_WS_URL",
        "wss://spectate.dolonia.cloud/agent-ws",
    )


PATCH = {
    "DENIZEN_WORLD_PUBSUB": "redis",
    "DENIZEN_REDIS_URL": f"redis://127.0.0.1:{REDIS_PORT}",
    "DENIZEN_WORLD_PUBSUB_CHANNEL": "denizen:world:broadcast",
    "DENIZEN_SERVER_ROLE": "primary",
    "DENIZEN_PRIMARY_URL": f"http://127.0.0.1:{PRIMARY_PORT}",
    "DENIZEN_PRIMARY_PORT": PRIMARY_PORT,
    "DENIZEN_SPECTATE_WS_URL": default_spectate_ws(),
    "DENIZEN_SPECTATE_WS_URLS": os.environ.get(
        "DENIZEN_SPECTATE_WS_URLS",
        "wss://spectate.dolonia.cloud/agent-ws,wss://spectate2.dolonia.cloud/agent-ws",
    ),
    "DENIZEN_MAX_WS_CLIENTS": "100",
}


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    print("$", cmd[:120], flush=True)
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    if out.strip():
        try:
            print(out.rstrip())
        except UnicodeEncodeError:
            print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
    return stdout.channel.recv_exit_status(), out


def patch_env(text: str, updates: dict[str, str]) -> str:
    lines = text.splitlines()
    keys = set(updates)
    out = []
    for line in lines:
        m = re.match(r"^([A-Z0-9_]+)=", line)
        if m and m.group(1) in keys:
            key = m.group(1)
            out.append(f"{key}={updates[key]}")
            keys.remove(key)
        else:
            out.append(line)
    for key in sorted(keys):
        out.append(f"{key}={updates[key]}")
    return "\n".join(out).rstrip() + "\n"


def write_env(client: paramiko.SSHClient, text: str) -> int:
    b64 = base64.b64encode(text.encode()).decode()
    return run(client, f"printf '%s' '{b64}' | base64 -d > {ENV_PATH}")[0]


def install_redis_client(client: paramiko.SSHClient) -> None:
    code, _ = run(
        client,
        f"{DOCKER} exec denizen-server test -d /app/node_modules/redis 2>/dev/null",
    )
    if code == 0:
        print("==> redis npm package already present")
        return
    run(
        client,
        f"{DOCKER} exec denizen-server npm install redis@^4.7.0 --omit=dev --no-audit --no-fund",
        timeout=300,
    )


def start_follower(client: paramiko.SSHClient, name: str, port: str) -> None:
    run(client, f"{DOCKER} rm -f {name} 2>/dev/null || true")
    code, _ = run(
        client,
        f"{DOCKER} run -d --name {name} --restart unless-stopped --network host "
        f"--env-file {ENV_PATH} "
        f"-e PORT={port} "
        f"-e DENIZEN_SERVER_ROLE=follower "
        f"-e DENIZEN_SERVER_ID=nas-follower-{port} "
        f"-e DENIZEN_MAX_WS_CLIENTS=100 "
        f"{IMAGE}",
    )
    if code != 0:
        print(f"WARN: follower {name}:{port} failed")
        return
    run(client, f"sleep 8 && curl -fsS -m 15 http://127.0.0.1:{port}/api/health | head -c 300")
    run(
        client,
        f"test -f {HOTFIX} && {DOCKER} cp {HOTFIX} {name}:/app/server.js "
        f"&& {DOCKER} restart {name} || echo 'skip follower hotfix'",
        timeout=120,
    )
    run(client, f"sleep 6 && curl -fsS -m 15 http://127.0.0.1:{port}/api/health | head -c 200")


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    _, o, _ = client.exec_command(f"cat {ENV_PATH} 2>/dev/null || echo ''")
    env_text = o.read().decode("utf-8", errors="replace")
    patch = dict(PATCH)
    patch["DENIZEN_SPECTATE_WS_URL"] = default_spectate_ws()
    if write_env(client, patch_env(env_text, patch)) != 0:
        client.close()
        return 1
    print(f"Patched {ENV_PATH} for Redis pub/sub")

    install_redis_client(client)

    run(client, f"cd /volume1/docker/denizen-server && {DOCKER} compose -f docker-compose.yml up -d --force-recreate")
    run(client, f"sleep 10 && curl -fsS -m 15 http://127.0.0.1:{PRIMARY_PORT}/api/health | head -c 600")

    for name, port in follower_specs():
        print(f"==> follower {name} :{port}")
        start_follower(client, name, port)

    run(
        client,
        f"{DOCKER} ps --filter name=denizen --format '{{{{.Names}}}}\t{{{{.Status}}}}'",
    )

    client.close()
    print("==> Redis pub/sub enabled on primary")
    print(f"    Primary:  http://{HOST}:{PRIMARY_PORT}/api/health")
    for name, port in follower_specs():
        print(f"    Follower: http://{HOST}:{port}/api/health ({name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
