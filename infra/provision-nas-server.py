#!/usr/bin/env python3
"""Build NAS Denizen server .env from denizen/.env.production (or .env)."""

from __future__ import annotations

import load_infra_env  # noqa: F401

import os
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DENIZEN_DIR = ROOT / "denizen"
BUNDLE_DIR = ROOT / "infra" / "nas-server-bundle"
BUNDLE_ENV = BUNDLE_DIR / ".env"
INFRA_ENV = ROOT / "infra" / ".env"

SYNO_HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
SYNO_PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
PUBLIC_URL = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")
LAN_URL = f"http://{SYNO_HOST}:{SYNO_PORT}"

# Keys copied from local production env into the NAS server bundle.
PASSTHROUGH_KEYS = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_DB_URL",
    "DENIZEN_URL",
    "DENIZEN_PUBLIC_URL",
    "DENIZEN_TEAM_OWNER_EMAIL",
    "DENIZEN_FLEET_AGENT_TOKEN",
    "DENIZEN_FLEET_IDENTITY_ID",
    "DENIZEN_FLEET_SESSION_ID",
    "DENIZEN_FLEET_SESSION_TOKEN",
    "DENIZEN_INTERNAL_API_TOKEN",
    "DENIZEN_MESH_JOBS",
    "DENIZEN_MESH_JOBS_INTERVAL_MS",
    "ANTHROPIC_API_KEY",
    "DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY",
    "DENIZEN_PUBLIC_DEMO",
    "DENIZEN_PUBLIC_DEMO_NPCS",
    "DENIZEN_PUBLIC_DEMO_MODEL",
    "DENIZEN_MAX_WS_CLIENTS",
    "DENIZEN_PLATFORM_BRIDGE",
    "GEMINI_API_KEY",
    "XAI_API_KEY",
    "KIMI_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "RESEND_API_KEY",
    "DENIZEN_EMAIL_FROM",
    "RESEND_WEBHOOK_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "GOOGLE_CALENDAR_CLIENT_ID",
    "GOOGLE_CALENDAR_CLIENT_SECRET",
    "MICROSOFT_CALENDAR_CLIENT_ID",
    "MICROSOFT_CALENDAR_CLIENT_SECRET",
    "LM_STUDIO_REMOTE_URLS",
    "LM_STUDIO_ROUTER",
    "LM_STUDIO_SATURATED_QUEUE",
    "DENIZEN_AUTO_HEAL",
    "DENIZEN_MESH_WATCHDOG_MS",
]


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


def write_env(path: Path, values: dict[str, str]) -> None:
    lines = [f"{k}={v}" for k, v in values.items()]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def upsert_infra_env(key: str, value: str) -> None:
    lines: list[str] = []
    found = False
    if INFRA_ENV.is_file():
        for line in INFRA_ENV.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith(f"{key}="):
                lines.append(f"{key}={value}")
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f"{key}={value}")
    INFRA_ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    src = DENIZEN_DIR / ".env.production"
    if not src.is_file():
        src = DENIZEN_DIR / ".env"
    if not src.is_file():
        log("ERROR: denizen/.env.production or denizen/.env required")
        return 1

    local = read_env(src)
    fallback = read_env(DENIZEN_DIR / ".env") if src.name == ".env.production" else {}
    for key, value in fallback.items():
        if key not in local and value:
            local[key] = value
    out: dict[str, str] = {
        "NODE_ENV": "production",
        "PORT": SYNO_PORT,
        "DENIZEN_URL": PUBLIC_URL,
        "DENIZEN_PUBLIC_URL": PUBLIC_URL,
        "DENIZEN_SERVER_ROLE": "primary",
        "DENIZEN_SERVER_ID": f"nas-{SYNO_HOST}",
        # In-container (host network): Kong + Postgres on the same NAS.
        "SUPABASE_URL": local.get("SUPABASE_URL", "http://127.0.0.1:8000"),
        "DENIZEN_MESH_JOBS": local.get("DENIZEN_MESH_JOBS", "true"),
        "LM_STUDIO_URL": "",
        "LM_STUDIO_ROUTER": local.get("LM_STUDIO_ROUTER", "true"),
        "LM_STUDIO_REMOTE_URLS": local.get(
            "LM_STUDIO_REMOTE_URLS",
            os.environ.get("DOLONIA_LM_STUDIO_URL", "http://192.168.1.232:1234"),
        ),
        "DENIZEN_ECONOMY_MODE": local.get("DENIZEN_ECONOMY_MODE", "false"),
        "DENIZEN_COFOUNDER_LLM": local.get("DENIZEN_COFOUNDER_LLM", "true"),
        "DENIZEN_REAL_WORK_MODE": local.get("DENIZEN_REAL_WORK_MODE", "true"),
        "DENIZEN_PUBLIC_DEMO": local.get("DENIZEN_PUBLIC_DEMO", "true"),
        "DENIZEN_PUBLIC_DEMO_NPCS": local.get("DENIZEN_PUBLIC_DEMO_NPCS", "abby,alex,lucy,bouncer"),
        "DENIZEN_PUBLIC_DEMO_MODEL": local.get("DENIZEN_PUBLIC_DEMO_MODEL", "claude-haiku-3-5-20241022"),
        "DENIZEN_MAX_WS_CLIENTS": local.get("DENIZEN_MAX_WS_CLIENTS", "30"),
        "DENIZEN_PLATFORM_BRIDGE": local.get("DENIZEN_PLATFORM_BRIDGE", "false"),
    }

    for key in PASSTHROUGH_KEYS:
        if local.get(key):
            out[key] = local[key]

    if not out.get("SUPABASE_SERVICE_ROLE_KEY"):
        log("WARN: SUPABASE_SERVICE_ROLE_KEY missing — run py infra/apply-service-role-to-denizen.py")

    if not out.get("DENIZEN_FLEET_AGENT_TOKEN"):
        out["DENIZEN_FLEET_AGENT_TOKEN"] = secrets.token_urlsafe(32)
        log("Generated DENIZEN_FLEET_AGENT_TOKEN for NAS bundle")

    # Rewrite DB URL to LAN Postgres on NAS when still pointing at cloud host.
    db_url = out.get("SUPABASE_DB_URL", "")
    if db_url and SYNO_HOST not in db_url and "127.0.0.1" not in db_url:
        log("NOTE: SUPABASE_DB_URL still points off-NAS; migrations use infra/apply-migrations-nas.py")

    write_env(BUNDLE_ENV, out)
    upsert_infra_env("DENIZEN_NAS_URL", LAN_URL)
    upsert_infra_env("DENIZEN_TAILSCALE_URL", PUBLIC_URL)
    upsert_infra_env("KALI_DENIZEN_URL", PUBLIC_URL)
    upsert_infra_env("DENIZEN_HOST_ON_NAS", "1")

    log(f"Wrote {BUNDLE_ENV}")
    log(f"  LAN health: {LAN_URL}/api/health")
    log(f"  Public URL: {PUBLIC_URL}")
    log("Next: py infra/deploy-denizen-to-nas.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
