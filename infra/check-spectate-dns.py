#!/usr/bin/env python3
"""Verify spectate.dolonia.cloud DNS record exists in Cloudflare."""

from __future__ import annotations

import json
import re
import base64
import os
import urllib.request
from pathlib import Path

import load_infra_env  # noqa: F401

ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "24c1db9d1ff0e052a75317b72ed3d336")
HOSTNAME = os.environ.get("DENIZEN_SPECTATE_HOST", "spectate.dolonia.cloud")
CERT = Path.home() / ".cloudflared" / "cert.pem"


def api_token() -> str:
    text = CERT.read_text(encoding="utf-8")
    match = re.search(
        r"-----BEGIN ARGO TUNNEL TOKEN-----\n(.+)\n-----END ARGO TUNNEL TOKEN-----",
        text,
        re.S,
    )
    payload = json.loads(base64.b64decode(match.group(1)))
    return str(payload["apiToken"])


def main() -> int:
    url = f"https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records?name={HOSTNAME}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {api_token()}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        data = json.loads(res.read().decode())
    records = data.get("result") or []
    if not records:
        print(f"NO DNS record for {HOSTNAME}")
        return 1
    for rec in records:
        print(f"OK {rec.get('type')} {rec.get('name')} -> {rec.get('content')} proxied={rec.get('proxied')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
