#!/usr/bin/env python3
"""Fetch Supabase ANON_KEY and SERVICE_ROLE_KEY from NAS via SSH."""

from __future__ import annotations

from hostcfg import get_host
import argparse
import os
import sys

import load_infra_env  # noqa: F401 — loads infra/.env

import paramiko

SUPABASE_ENV_PATH = "/volume1/docker/supabase-project/.env"
KEYS = ("ANON_KEY", "SERVICE_ROLE_KEY")


def mask_key(value: str) -> str:
    if len(value) <= 8:
        return "*" * len(value)
    return "*" * (len(value) - 8) + value[-8:]


def parse_env_content(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        out[key.strip()] = val.strip().strip('"').strip("'")
    return out


def ssh_fetch_supabase_keys() -> dict[str, str]:
    host = get_host("SYNO_HOST")
    user = os.environ.get("SYNO_USER", "admin")
    password = os.environ.get("SYNO_SSH_PASSWORD", "")
    if not password:
        raise RuntimeError("SYNO_SSH_PASSWORD not set (configure infra/.env)")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        host,
        username=user,
        password=password,
        timeout=20,
        look_for_keys=False,
        allow_agent=False,
    )
    try:
        _, stdout, stderr = client.exec_command(f"cat {SUPABASE_ENV_PATH}", timeout=30)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        if code != 0:
            raise RuntimeError(f"Failed to read {SUPABASE_ENV_PATH}: {err or out}")

        env = parse_env_content(out)
        result: dict[str, str] = {}
        for key in KEYS:
            val = env.get(key, "").strip()
            if not val:
                raise RuntimeError(f"{key} not found in {SUPABASE_ENV_PATH}")
            result[key] = val
        return result
    finally:
        client.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read Supabase keys from NAS supabase-project/.env via SSH."
    )
    parser.add_argument(
        "--export",
        action="store_true",
        help="Print shell export lines with full key values (stdout only).",
    )
    args = parser.parse_args()

    try:
        keys = ssh_fetch_supabase_keys()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if args.export:
        for key in KEYS:
            print(f"export {key}={keys[key]}")
    else:
        for key in KEYS:
            print(f"{key}={mask_key(keys[key])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
