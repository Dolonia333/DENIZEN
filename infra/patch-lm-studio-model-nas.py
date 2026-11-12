#!/usr/bin/env python3
"""Patch the NAS LM Studio MAIN-slot model pin.

Why: the production .env had LM_STUDIO_MODEL pinned to the 27B (same as HEAVY),
which made the 27B the default slot for every ambient think. Measured from
denizen/data/llm-telemetry.jsonl: 84.3% timeout rate and 2.3 tok/s on that pin
vs 0.3% and 9.8 tok/s on the 14B. HEAVY stays on the 27B (JIT-loaded, TTL
unload) so Abby/Grok/Claude/synthesis keep the big model.

Usage:
  py -3.12 infra/patch-lm-studio-model-nas.py            # show current, then patch + restart
  py -3.12 infra/patch-lm-studio-model-nas.py --dry-run  # show current only, change nothing
"""
from __future__ import annotations

from hostcfg import get_host
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_infra_env  # noqa: F401
import paramiko

HOST = get_host("SYNO_HOST")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
ENV_PATH = "/volume1/docker/denizen-server/.env"
CONTAINER = os.environ.get("DENIZEN_CONTAINER", "denizen-server")

# Only this key is touched. HEAVY/FAST are deliberately left alone.
KEY = "LM_STUDIO_MODEL"
NEW_VALUE = os.environ.get("LM_STUDIO_MODEL_NEW", "mistralai/ministral-3-14b-reasoning")

DRY = "--dry-run" in sys.argv


def run(client, cmd, timeout=180):
    print("$", cmd[:140], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.encode("ascii", "replace").decode().rstrip(), flush=True)
    return o.channel.recv_exit_status(), out


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD not set (expected via infra/.env) — aborting.")
        return 2

    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    try:
        sftp = cli.open_sftp()
        with sftp.open(ENV_PATH, "r") as fh:
            text = fh.read().decode("utf-8", errors="replace")

        print("\n--- current LM Studio pins on the NAS ---")
        for line in text.splitlines():
            if line.startswith("LM_STUDIO_"):
                print("   ", line)

        cur = None
        for line in text.splitlines():
            m = re.match(rf"^{KEY}=(.*)$", line)
            if m:
                cur = m.group(1).strip()
        print(f"\n{KEY} is currently: {cur!r}")
        if cur == NEW_VALUE:
            print("Already correct — nothing to do.")
            return 0
        if DRY:
            print(f"[dry-run] would set {KEY}={NEW_VALUE} and restart {CONTAINER}")
            return 0

        # Replace in place if present, else append.
        if re.search(rf"^{KEY}=", text, flags=re.M):
            new_text = re.sub(rf"^{KEY}=.*$", f"{KEY}={NEW_VALUE}", text, flags=re.M)
        else:
            new_text = text.rstrip("\n") + f"\n{KEY}={NEW_VALUE}\n"

        # Back up, then write.
        with sftp.open(ENV_PATH + ".bak-lmmodel", "w") as fh:
            fh.write(text)
        with sftp.open(ENV_PATH, "w") as fh:
            fh.write(new_text)
        sftp.close()
        print(f"\nSet {KEY}={NEW_VALUE}  (backup: {ENV_PATH}.bak-lmmodel)")

        run(cli, f"{DOCKER} restart {CONTAINER}")
        run(cli, "sleep 10; curl -fsS -m 15 http://127.0.0.1:8888/api/health | head -c 300 || echo HEALTH_FAIL")
        return 0
    finally:
        cli.close()


if __name__ == "__main__":
    raise SystemExit(main())
