#!/usr/bin/env python3
"""Smoke-check MCP telemetry resources via local denizen-mcp-resources.js (no live server required)."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
JS = """
const m = require('./src/denizen-mcp-resources.js');
const uris = [
  'telemetry://fleet/latest',
  'telemetry://grok/latest/bouncer',
  'telemetry://grok/consultations/pending',
  'telemetry://fleet/autonomy/backlog',
  'mentor://dialogue/pending',
];
const out = {};
for (const u of uris) {
  try { out[u] = JSON.parse(m.readResource(u)); } catch (e) { out[u] = { error: String(e) }; }
}
console.log(JSON.stringify(out, null, 2));
"""

def main():
    res = subprocess.run(
        ["node", "-e", JS],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if res.returncode != 0:
        print(res.stderr or res.stdout)
        sys.exit(1)
    data = json.loads(res.stdout)
    for uri, payload in data.items():
        if isinstance(payload, dict) and payload.get("error"):
            print(f"FAIL {uri}: {payload['error']}")
            sys.exit(1)
        print(f"OK {uri}")
    print("All MCP resource loaders OK")

if __name__ == "__main__":
    main()
