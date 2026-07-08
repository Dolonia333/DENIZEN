#!/usr/bin/env python3
"""
PC mesh worker — claims grok_cli_chat jobs from production and runs grok -p locally.

Requires a registered compute node on denizen.dolonia.cloud and:

  DENIZEN_PUBLIC_URL=https://denizen.dolonia.cloud
  GROK_CLI_MESH_IDENTITY_ID=...
  GROK_CLI_MESH_NODE_TOKEN=...

Set on NAS:

  GROK_CLI_MESH_NODE=<your machine_id from City Power / fleet registry>
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
DENIZEN = REPO / "denizen"

sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

BASE = os.environ.get("DENIZEN_PUBLIC_URL", "https://denizen.dolonia.cloud").rstrip("/")
IDENTITY = os.environ.get("GROK_CLI_MESH_IDENTITY_ID", "").strip()
TOKEN = os.environ.get("GROK_CLI_MESH_NODE_TOKEN", "").strip()
POLL_MS = int(os.environ.get("GROK_CLI_MESH_POLL_MS", "4000"))


def main() -> int:
    if not IDENTITY or not TOKEN:
        print("Set GROK_CLI_MESH_IDENTITY_ID and GROK_CLI_MESH_NODE_TOKEN")
        print("Pair via City Power in the office, then copy node credentials.")
        return 1
    script = """
const client = require('./src/denizen-node-client');
const orig = client.processJobLocally;
client.setProcessJobLocally(async (job) => {
  const t = String(job?.job_type || '');
  if (t !== 'grok_cli_chat') return orig(job);
  const grokCli = require('./src/grok-cli-chat');
  const payload = job.payload || {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const text = await grokCli.completePlayerChat({
    systemPrompt: payload.system_prompt || '',
    messages,
    prefer: 'local',
    timeoutMs: payload.timeout_ms || 180000,
  });
  return { ok: true, jobType: 'grok_cli_chat', text, completed_at: new Date().toISOString() };
});
const types = ['grok_cli_chat'];
const loop = async () => {
  const fetch = global.fetch;
  while (true) {
    try {
      const res = await fetch(`${process.env.DENIZEN_BASE}/api/compute/node/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityId: process.env.IDENTITY, nodeToken: process.env.TOKEN, jobTypes: types }),
      });
      if (res.status === 204) { await new Promise(r => setTimeout(r, Number(process.env.POLL_MS))); continue; }
      const data = await res.json().catch(() => ({}));
      const job = data.job || data;
      if (!job?.id) { await new Promise(r => setTimeout(r, Number(process.env.POLL_MS))); continue; }
      const result = await client.processJobLocally(job);
      await fetch(`${process.env.DENIZEN_BASE}/api/compute/node/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityId: process.env.IDENTITY, nodeToken: process.env.TOKEN, jobId: job.id, ok: true, result }),
      });
    } catch (e) {
      console.warn('[grok-cli-mesh-worker]', e?.message || e);
      await new Promise(r => setTimeout(r, Number(process.env.POLL_MS)));
    }
  }
};
loop();
"""
    env = {
        **os.environ,
        "DENIZEN_BASE": BASE,
        "IDENTITY": IDENTITY,
        "TOKEN": TOKEN,
        "POLL_MS": str(POLL_MS),
    }
    print(f"==> Grok CLI mesh worker → {BASE}")
    return subprocess.call(["node", "-e", script], cwd=str(DENIZEN), env=env)


if __name__ == "__main__":
    raise SystemExit(main())
