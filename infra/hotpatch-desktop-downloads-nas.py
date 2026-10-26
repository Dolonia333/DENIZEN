#!/usr/bin/env python3
"""Hot-patch desktop download fixes into running denizen-server on NAS."""
from __future__ import annotations

from hostcfg import get_host
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

FILES = [
    (ROOT / "denizen" / "src" / "denizen-desktop-downloads.js", "/app/src/denizen-desktop-downloads.js"),
    (ROOT / "denizen" / "src" / "visitor-client-platform.js", "/app/src/visitor-client-platform.js"),
    (ROOT / "denizen" / "src" / "visitor-node-ui.js", "/app/src/visitor-node-ui.js"),
    (ROOT / "denizen" / "src" / "visitor-desktop-pairing.js", "/app/src/visitor-desktop-pairing.js"),
    (ROOT / "denizen" / "src" / "visitor-dashboard-gate.js", "/app/src/visitor-dashboard-gate.js"),
    (ROOT / "denizen" / "src" / "denizen-compute-routes.js", "/app/src/denizen-compute-routes.js"),
    (ROOT / "denizen" / "desktop" / "download.html", "/app/desktop/download.html"),
    (ROOT / "denizen" / "src" / "visitor-phone-station-connect.js", "/app/src/visitor-phone-station-connect.js"),
    (ROOT / "denizen" / "src" / "denizen-station-tokens.js", "/app/src/denizen-station-tokens.js"),
    (ROOT / "denizen" / "src" / "denizen-phone-ui.js", "/app/src/denizen-phone-ui.js"),
    (ROOT / "denizen" / "index.html", "/app/index.html"),
]


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    for local, container_path in FILES:
        remote = f"/tmp/{Path(local).name}"
        stdin, stdout, _ = client.exec_command(f"cat > '{remote}'", timeout=180)
        stdin.write(local.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()
        _, o, e = client.exec_command(
            f"{DOCKER} cp '{remote}' denizen-server:'{container_path}'",
            timeout=120,
        )
        out = (o.read() + e.read()).decode("ascii", "replace")
        print(container_path, out.strip() or "ok")

    patch_remote = "/tmp/_patch_server_desktop_downloads.js"
    stdin, stdout, _ = client.exec_command(f"cat > '{patch_remote}'", timeout=60)
    stdin.write((INFRA / "_patch_server_desktop_downloads.js").read_bytes())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()
    _, o, e = client.exec_command(
        f"{DOCKER} cp '{patch_remote}' denizen-server:/tmp/_patch_server_desktop_downloads.js && "
        f"{DOCKER} exec denizen-server node /tmp/_patch_server_desktop_downloads.js",
        timeout=120,
    )
    print((o.read() + e.read()).decode("ascii", "replace")[:300])

    _, o, e = client.exec_command(f"{DOCKER} restart denizen-server", timeout=120)
    print((o.read() + e.read()).decode("ascii", "replace")[:200])
    _, o, e = client.exec_command(
        "sleep 16 && curl -fsS -m 20 http://127.0.0.1:8888/api/visitor/desktop-downloads | head -c 400",
        timeout=60,
    )
    print((o.read() + e.read()).decode("ascii", "replace"))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
