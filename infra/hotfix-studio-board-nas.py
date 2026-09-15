#!/usr/bin/env python3
"""Hotfix Studio Board (agency tracker) onto the live NAS Denizen phone.

Copies:
  - src/denizen-phone-ui.js  (Studio Board navigate app + layout v5)
  - index.html               (phone UI cache buster)
  - server.js                (/studio-board/ route)
  - studio-board/            (full-page agency tracker app)

Requires infra/.env with SYNO_SSH_PASSWORD (same as other NAS hotfixes).

  py -3 infra/hotfix-studio-board-nas.py
"""
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
HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
CACHE = "studioBoard1"

FILE_PATHS = [
    "server.js",
    "index.html",
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
        if "node_modules" in p.parts or ".git" in p.parts:
            continue
        rel = p.relative_to(base).as_posix()
        tar.add(p, arcname=f"{arc_prefix}/{rel}")
        n += 1
    return n


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required in infra/.env", file=sys.stderr)
        return 1

    board = DENIZEN / "studio-board"
    for rel in FILE_PATHS:
        if not (DENIZEN / rel).is_file():
            print(f"missing {DENIZEN / rel}", file=sys.stderr)
            return 1
    if not (board / "index.html").is_file():
        print(f"missing {board / 'index.html'}", file=sys.stderr)
        return 1

    phone = (DENIZEN / "src/denizen-phone-ui.js").read_text(encoding="utf-8")
    if "studioboard" not in phone or "/studio-board/" not in phone:
        print("denizen-phone-ui.js does not register Studio Board navigate app", file=sys.stderr)
        return 1
    server = (DENIZEN / "server.js").read_text(encoding="utf-8")
    if "/studio-board" not in server:
        print("server.js missing /studio-board/ route", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "studio-board.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel in FILE_PATHS:
                tar.add(DENIZEN / rel, arcname=rel)
            n_board = add_tree(tar, board, "studio-board")
        print(f"==> tarball {tar_path.stat().st_size // 1024} KB · studio-board={n_board} files")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USER, password=PWD, look_for_keys=False, allow_agent=False)

        rt = f"{REMOTE}/studio-board-hotfix.tar.gz"
        ed = f"{REMOTE}/studio-board-hotfix"
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
        run(client, f"{DOCKER} exec denizen-server mkdir -p /app/src /app/studio-board")
        for rel in FILE_PATHS:
            parent = "/".join(rel.split("/")[:-1])
            if parent:
                run(client, f"{DOCKER} exec denizen-server mkdir -p /app/{parent}")
            run(client, f"{DOCKER} cp '{ed}/{rel}' denizen-server:/app/{rel}")

        run(
            client,
            f"{DOCKER} exec denizen-server sh -c \"rm -rf /app/studio-board && mkdir -p /app/studio-board\"",
        )
        run(client, f"{DOCKER} cp '{ed}/studio-board/.' denizen-server:/app/studio-board/")

        run(client, f"{DOCKER} restart denizen-server", timeout=180)
        run(client, f"sleep 12 && curl -fsS -m 20 http://127.0.0.1:{PORT}/api/health | head -c 400")
        run(
            client,
            f"{DOCKER} exec denizen-server sh -c \"grep -c studioboard /app/src/denizen-phone-ui.js\"",
        )
        run(
            client,
            f"curl -fsS -m 15 -o /dev/null -w '%{{http_code}}\\n' http://127.0.0.1:{PORT}/studio-board/",
        )
        run(
            client,
            f"curl -fsS -m 15 http://127.0.0.1:{PORT}/studio-board/ | grep -o 'Studio Board' | head -1",
        )
        client.close()

    print(f"==> Studio Board live on NAS ({CACHE})")
    print("    Phone icon: Studio Board  →  https://denizen.dolonia.cloud/studio-board/")
    print("    Hard-refresh the phone (or Edit → Reset layout) if the icon is missing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
