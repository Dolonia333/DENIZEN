#!/usr/bin/env python3
"""Re-point mesh agents and infra env to the NAS-hosted Denizen server."""

from __future__ import annotations

from hostcfg import get_host
import load_infra_env  # noqa: F401

import os
import subprocess
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent

SYNO_HOST = get_host("SYNO_HOST")
NAS_PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
PUBLIC_URL = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")
NAS_LAN = os.environ.get("DENIZEN_NAS_URL", f"http://{SYNO_HOST}:{NAS_PORT}").rstrip("/")


def log(msg: str) -> None:
    print(msg, flush=True)


def run(script: str) -> None:
    proc = subprocess.run([sys.executable, str(INFRA / script)], cwd=str(ROOT), env=os.environ.copy())
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def patch_bundle(path: Path, *, denizen_url: str) -> None:
    if not path.is_file():
        return
    lines: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("DENIZEN_URL="):
            lines.append(f"DENIZEN_URL={denizen_url}")
        elif line.startswith("DENIZEN_LAN_URL="):
            lines.append(f"DENIZEN_LAN_URL={denizen_url}")
        else:
            lines.append(line)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"Patched {path} -> DENIZEN_URL={denizen_url}")


def main() -> int:
    log("==> Re-pointing mesh to NAS-hosted Denizen")
    log(f"    NAS agent (local): {NAS_LAN}")
    log(f"    Remote agents:     {PUBLIC_URL}")

    # NAS compute agent on same box talks to loopback via host network.
    patch_bundle(INFRA / "nas-agent-bundle" / ".env", denizen_url=NAS_LAN)

    # Kali / laptop agents use public URL (works over Tailscale or internet).
    patch_bundle(INFRA / "kali-agent-bundle" / ".env", denizen_url=PUBLIC_URL)

    run("deploy-nas-agent.py")

    if os.environ.get("KALI_SSH_PASSWORD", "").strip():
        run("deploy-kali-agent.py")
    else:
        log("SKIP Kali deploy (no KALI_SSH_PASSWORD) — re-run pull-install on Kali with:")
        log(f"  export DENIZEN_PULL_URL='{PUBLIC_URL}'")

    log("==> Mesh re-point complete")
    log(f"Update Cloudflare tunnel if not done: denizen.dolonia.cloud -> NAS :{NAS_PORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
