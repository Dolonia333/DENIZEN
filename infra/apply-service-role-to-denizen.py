#!/usr/bin/env python3
"""Set denizen/.env SUPABASE_SERVICE_ROLE_KEY from NAS if not already present."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import load_infra_env  # noqa: F401 — loads infra/.env

ROOT = Path(__file__).resolve().parent.parent
DENIZEN_ENV = ROOT / "denizen" / ".env"


def log(msg: str) -> None:
    print(msg, flush=True)


def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def write_env_key(path: Path, key: str, value: str) -> None:
    lines: list[str] = []
    found = False
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith(f"{key}="):
                lines.append(f"{key}={value}")
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def load_fetch_module():
    spec = importlib.util.spec_from_file_location(
        "fetch_nas_supabase_keys",
        Path(__file__).resolve().parent / "fetch-nas-supabase-keys.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load fetch-nas-supabase-keys.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    fetch = load_fetch_module()
    env = read_env(DENIZEN_ENV)
    existing = env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if existing:
        log(f"SUPABASE_SERVICE_ROLE_KEY already set in denizen/.env ({fetch.mask_key(existing)})")
        return 0

    try:
        keys = fetch.ssh_fetch_supabase_keys()
    except Exception as exc:
        log(f"ERROR: {exc}")
        return 1

    service_key = keys["SERVICE_ROLE_KEY"]
    write_env_key(DENIZEN_ENV, "SUPABASE_SERVICE_ROLE_KEY", service_key)
    log(f"Set SUPABASE_SERVICE_ROLE_KEY in denizen/.env ({fetch.mask_key(service_key)})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"ERROR: {exc}")
        raise SystemExit(1) from exc
