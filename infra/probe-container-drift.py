#!/usr/bin/env python3
"""Read-only probe: is the LIVE denizen-server container drifted from the
local repo working tree?

Compares md5 of every .js under server.js + src/ + discord-bot/src/ + jelly/
inside the container's /app against the local denizen/ tree. This answers the
question that MUST be answered before enabling auto-deploy: are there
docker-cp hotfixes in the running container that never made it into git?
(A rebuild from git would silently revert them.)

Usage: py -3.12 infra/probe-container-drift.py
Exit 0 = no drift. Exit 2 = drift found (listed). Read-only either way.
"""

from __future__ import annotations
import hashlib
import os
from pathlib import Path

import load_infra_env  # noqa: F401
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PW = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
LOCAL = Path(__file__).resolve().parent.parent / "denizen"

SCOPES = ["server.js", "src", "discord-bot/src", "jelly"]


def container_hashes(client) -> dict[str, str]:
    find_targets = " ".join(SCOPES)
    cmd = (f"{DOCKER} exec denizen-server sh -c "
           f"\"cd /app && find {find_targets} -name '*.js' -type f 2>/dev/null "
           f"| sort | xargs md5sum\"")
    _, o, e = client.exec_command(cmd, timeout=300)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    if o.channel.recv_exit_status() != 0 and not out:
        raise SystemExit(f"container hash failed: {err[:300]}")
    hashes = {}
    for line in out.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2:
            hashes[parts[1].strip()] = parts[0].strip()
    return hashes


def local_hashes() -> dict[str, str]:
    hashes = {}
    for scope in SCOPES:
        p = LOCAL / scope
        if p.is_file():
            hashes[scope] = hashlib.md5(p.read_bytes()).hexdigest()
            continue
        for f in sorted(p.rglob("*.js")):
            if "node_modules" in f.parts:
                continue
            rel = f.relative_to(LOCAL).as_posix()
            hashes[rel] = hashlib.md5(f.read_bytes()).hexdigest()
    return hashes


def main() -> int:
    if not PW:
        print("ERROR: SYNO_SSH_PASSWORD required")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PW,
                   look_for_keys=False, allow_agent=False)
    remote = container_hashes(client)
    client.close()
    local = local_hashes()

    differ = sorted(k for k in remote.keys() & local.keys()
                    if remote[k] != local[k])
    only_container = sorted(remote.keys() - local.keys())
    only_local = sorted(local.keys() - remote.keys())

    print(f"container files: {len(remote)}  local files: {len(local)}")
    print(f"identical: {len(remote.keys() & local.keys()) - len(differ)}")

    if differ:
        print(f"\nDIFFER ({len(differ)}) — container content != local repo:")
        for k in differ:
            print(f"  ~ {k}")
    if only_container:
        print(f"\nONLY IN CONTAINER ({len(only_container)}) — hotfixes never "
              f"committed? A rebuild DELETES these:")
        for k in only_container[:40]:
            print(f"  - {k}")
    if only_local:
        print(f"\nONLY IN LOCAL ({len(only_local)}) — new files not yet "
              f"deployed (expected if repo is ahead):")
        for k in only_local[:40]:
            print(f"  + {k}")

    if differ or only_container:
        print("\nVERDICT: DRIFT — reconcile before enabling auto-deploy "
              "(commit the container-side changes or accept the revert).")
        return 2
    print("\nVERDICT: no container-side drift — safe to enable auto-deploy. "
          "(only-local files simply mean the repo is ahead, which auto-deploy fixes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
