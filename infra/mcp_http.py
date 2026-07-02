"""Shared MCP JSON-RPC HTTP client — Cloudflare-safe User-Agent."""

from __future__ import annotations

import json
import os
import uuid
import urllib.error
import urllib.request
from typing import Any

DEFAULT_UA = os.environ.get(
    "DENIZEN_MCP_USER_AGENT",
    "Denizen-MCP-Client/1.0 (compatible; ClaudeDesktop/1.0; +https://denizen.dolonia.cloud)",
)


def mcp_rpc(
    url: str,
    token: str,
    method: str,
    params: dict | None = None,
    *,
    timeout: int = 45,
    user_agent: str | None = None,
) -> dict[str, Any]:
    body = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": method,
        "params": params or {},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": user_agent or DEFAULT_UA,
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")[:800]
        return {
            "error": {
                "http_status": e.code,
                "body": body_text,
                "hint": "Cloudflare may block Python-urllib UA — use mcp_http.DEFAULT_UA",
            }
        }


def tool_call(endpoint: str, token: str, tool: str, arguments: dict | None = None, **kw) -> dict[str, Any]:
    raw = mcp_rpc(endpoint, token, "tools/call", {"name": tool, "arguments": arguments or {}}, **kw)
    result = raw.get("result") or raw
    text = None
    if isinstance(result, dict):
        content = result.get("content") or []
        if content and isinstance(content[0], dict):
            text = content[0].get("text")
    if text:
        try:
            return {"ok": True, "parsed": json.loads(text), "raw": result}
        except json.JSONDecodeError:
            return {"ok": True, "text": text, "raw": result}
    if raw.get("error"):
        return {"ok": False, **raw}
    return {"ok": False, "raw": result}
