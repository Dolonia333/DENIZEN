#!/usr/bin/env python3
"""Test Robinhood MCP getQuote inside NAS container."""

from __future__ import annotations

import load_infra_env  # noqa: F401

import os
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

JS = r"""
const m = require('/app/src/robinhood-mcp.js');
(async () => {
  try {
    console.log('auth', m.isAuthenticated());
    const tools = await m.listTools();
    const names = (tools?.tools || tools || []).map(t => t.name || t);
    console.log('tools', JSON.stringify(names.slice(0, 20)));
    const q = await m.getQuote(['NVDA']);
    console.log('quote', JSON.stringify(q).slice(0, 800));
  } catch (e) {
    console.error('ERR', e.message);
    process.exit(1);
  }
})();
"""


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required")
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
    cmd = f"{DOCKER} exec denizen-server node -e {JS!r}"
    _, o, e = c.exec_command(cmd, timeout=90)
    print((o.read() + e.read()).decode("utf-8", errors="replace"))
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
