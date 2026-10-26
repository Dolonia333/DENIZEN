#!/usr/bin/env python3
"""Provision Denizen Kali fleet agent credentials and sync agent bundle."""

from __future__ import annotations

import json
import os
import secrets
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DENIZEN_DIR = ROOT / "denizen"
ENV_PATH = DENIZEN_DIR / ".env"
BUNDLE_DIR = ROOT / "infra" / "kali-agent-bundle"
MACHINE_ID = "hp81081d"
MACHINE_LABEL = "Kali · hp81081d"
AGENT_ROOT = "~/denizen-agent"

SYNC_FILES = [
    (DENIZEN_DIR / "scripts" / "nas-compute-agent.js", BUNDLE_DIR / "nas-compute-agent.js"),
    (DENIZEN_DIR / "scripts" / "nas-metrics-agent.js", BUNDLE_DIR / "nas-metrics-agent.js"),
    (DENIZEN_DIR / "src" / "denizen-hardware-monitor.js", BUNDLE_DIR / "src" / "denizen-hardware-monitor.js"),
    (DENIZEN_DIR / "src" / "denizen-node-client.js", BUNDLE_DIR / "src" / "denizen-node-client.js"),
    (DENIZEN_DIR / "src" / "denizen-mesh-job-runner.js", BUNDLE_DIR / "src" / "denizen-mesh-job-runner.js"),
    (DENIZEN_DIR / "src" / "lm-studio-probe.js", BUNDLE_DIR / "src" / "lm-studio-probe.js"),
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


def http_json(method: str, url: str, body: dict | None = None, headers: dict | None = None) -> dict:
    data = None
    hdrs = {"Content-Type": "application/json", **(headers or {})}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        payload = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {err.code} {url}: {payload[:300]}") from err


def resolve_identity_id(base_url: str, env: dict[str, str]) -> tuple[str, str | None, str | None]:
    preset = env.get("DENIZEN_FLEET_IDENTITY_ID", "").strip()
    preset_session = env.get("DENIZEN_FLEET_SESSION_ID", "").strip()
    preset_token = env.get("DENIZEN_FLEET_SESSION_TOKEN", "").strip()
    if preset and preset_session and preset_token:
        log(f"Using DENIZEN_FLEET_IDENTITY_ID={preset}")
        return preset, preset_session, preset_token

    ceo_code = env.get("DENIZEN_CEO_ACCESS_CODE", "Dolonia").strip()
    log(f"Resolving CEO identity via access verify ({ceo_code})")
    verify = http_json(
        "POST",
        f"{base_url}/api/visitor/access/verify",
        {"kind": "ceo", "code": ceo_code},
        {"X-Ceo-Principal": "1"},
    )
    access_grant = verify.get("access_grant")
    if not access_grant:
        raise RuntimeError("CEO verify did not return access_grant")

    org_slug = verify.get("org_slug") or env.get("DENIZEN_TEAM_ORG_SLUG", "zion")
    sess = http_json(
        "POST",
        f"{base_url}/api/visitor/session",
        {
            "display_name": "Dolonia",
            "org_slug": org_slug,
            "access_grant": access_grant,
            "metadata": {
                "is_ceo_principal": True,
                "access_method": "ceo",
                "tier": "ceo",
            },
        },
        {"X-Ceo-Principal": "1", "X-Denizen-Local-Client": "1"},
    )
    session = sess.get("session") or {}
    identity = sess.get("identity") or {}
    identity_id = identity.get("id") or session.get("identity_id")
    if not identity_id and session.get("id"):
        identity_id = f"session:{session['id']}"
    if not identity_id:
        raise RuntimeError("CEO session did not return identity_id")
    session_id = session.get("id")
    session_token = sess.get("session_token")
    log(f"Resolved identity_id={identity_id}")
    return str(identity_id), session_id, session_token


def sync_bundle_js() -> None:
    BUNDLE_DIR.mkdir(parents=True, exist_ok=True)
    (BUNDLE_DIR / "src").mkdir(parents=True, exist_ok=True)
    for src, dest in SYNC_FILES:
        if not src.is_file():
            raise FileNotFoundError(src)
        shutil.copy2(src, dest)
        log(f"Synced {src.name} -> {dest.relative_to(ROOT)}")


def main() -> int:
    env = read_env(ENV_PATH)
    port = env.get("PORT", "8081")
    base_url = os.environ.get("DENIZEN_URL", f"http://127.0.0.1:{port}").rstrip("/")

    fleet_token = env.get("DENIZEN_FLEET_AGENT_TOKEN", "").strip()
    if not fleet_token:
        fleet_token = secrets.token_urlsafe(32)
        write_env_key(ENV_PATH, "DENIZEN_FLEET_AGENT_TOKEN", fleet_token)
        log("Generated DENIZEN_FLEET_AGENT_TOKEN in denizen/.env")

    identity_id, session_id, session_token = resolve_identity_id(base_url, env)
    if not env.get("DENIZEN_FLEET_IDENTITY_ID", "").strip():
        write_env_key(ENV_PATH, "DENIZEN_FLEET_IDENTITY_ID", identity_id)
    if session_id and not env.get("DENIZEN_FLEET_SESSION_ID", "").strip():
        write_env_key(ENV_PATH, "DENIZEN_FLEET_SESSION_ID", session_id)
    if session_token and not env.get("DENIZEN_FLEET_SESSION_TOKEN", "").strip():
        write_env_key(ENV_PATH, "DENIZEN_FLEET_SESSION_TOKEN", session_token)

    sync_bundle_js()

    BUNDLE_DIR.mkdir(parents=True, exist_ok=True)
    kali_env = BUNDLE_DIR / ".env"
    public_url = env.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")
    kali_url = (
        os.environ.get("KALI_DENIZEN_URL", "").strip()
        or os.environ.get("DENIZEN_TAILSCALE_URL", "").strip()
        or f"http://{get_host('DENIZEN_HOME_HOST')}:{port}"
    ).rstrip("/")
    lines = [
        f"DENIZEN_URL={kali_url}",
        f"DENIZEN_PUBLIC_URL={public_url}",
        f"DENIZEN_LAN_URL={kali_url}",
        f"DENIZEN_IDENTITY_ID={identity_id}",
        f"DENIZEN_FLEET_SESSION_ID={session_id or ''}",
        f"DENIZEN_FLEET_SESSION_TOKEN={session_token or ''}",
        f"DENIZEN_FLEET_AGENT_TOKEN={fleet_token}",
        f"DENIZEN_MACHINE_ID={MACHINE_ID}",
        f"DENIZEN_MACHINE_LABEL={MACHINE_LABEL}",
        "DENIZEN_REPORT_INTERVAL_MS=30000",
        f"DENIZEN_AGENT_ROOT={AGENT_ROOT}",
    ]
    kali_env.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"Wrote Kali agent env -> {kali_env}")
    log("Next: set KALI_SSH_PASSWORD (or KALI_SSH_KEY) and run infra/deploy-kali-agent.py")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"ERROR: {exc}")
        raise SystemExit(1) from exc
