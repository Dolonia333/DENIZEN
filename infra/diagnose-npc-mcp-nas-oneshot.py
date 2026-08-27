#!/usr/bin/env python3
"""Diagnose NPC MCP + presence on NAS via DSM HTTPS (no LAN SSH)."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
import http.cookiejar
from pathlib import Path

NAS = os.environ.get("DSM_URL", "https://nas.dolonia.cloud:8443")
USER = os.environ.get("SYNO_USER", "admin")
PASS = os.environ.get("SYNO_SSH_PASSWORD") or os.environ.get("DSM_PASSWORD") or ""
REMOTE_DIR = "/docker/denizen-server"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

DIAG_JS = r'''
'use strict';
const fs = require('fs');
const OUT = '/app/data/mcp-diag';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const report = { at: new Date().toISOString(), steps: [] };
  const step = (name, data) => { report.steps.push({ name, ...(typeof data === 'object' ? data : { data }) }); };

  try {
    const db = require('/app/src/denizen-db');
    const npcGw = require('/app/src/denizen-npc-mcp-gateway');
    const teamGw = require('/app/src/denizen-mcp-team-gateway');
    const health = require('/app/src/denizen-mcp-health');
    const init = await db.init();
    step('db_init', { ok: !!init?.ok, orgId: db.orgId || null });

    // Presence helpers present?
    const teamTools = require('/app/src/denizen-mcp-team-tools');
    step('presence_exports', {
      touchMcpPresence: typeof teamTools.touchMcpPresence,
      collapseRosterByIdentity: typeof teamTools.collapseRosterByIdentity,
      enrichTeammatesWithMcpPresence: typeof teamTools.enrichTeammatesWithMcpPresence,
    });

    step('health', health.summarizeMcpSurface?.({ denizenRoot: '/app' }) || null);

    // Mint fresh tokens for grok + claude + team (diagnose label)
    const tokens = {};
    for (const npcKey of ['grok', 'claude']) {
      try {
        const r = await npcGw.createMcpToken({ orgId: db.orgId, npcKey, label: 'diagnose-cloud-agent' });
        tokens[npcKey] = { ok: true, token: r.token, token_id: r.token_id, mcp_url: r.mcp_url };
      } catch (e) {
        tokens[npcKey] = { ok: false, error: String(e?.message || e) };
      }
    }
    try {
      const r = await teamGw.createTeamMcpToken({ orgId: db.orgId, label: 'diagnose-cloud-agent' });
      tokens.team = { ok: true, token: r.token, token_id: r.token_id, mcp_url: r.mcp_url };
    } catch (e) {
      tokens.team = { ok: false, error: String(e?.message || e) };
    }
    step('mint', {
      grok: tokens.grok?.ok, claude: tokens.claude?.ok, team: tokens.team?.ok,
      errors: Object.fromEntries(Object.entries(tokens).filter(([,v]) => !v.ok).map(([k,v]) => [k, v.error])),
    });
    fs.writeFileSync(OUT + '/tokens.json', JSON.stringify(tokens, null, 2));

    // Simulate tools/list + announce via gateway callTool if available
    async function tryTool(npcKey, token, name, args) {
      try {
        // Prefer internal resolve+call if exported
        const scope = await npcGw.resolveToken?.(token) || await npcGw.resolveMcpToken?.(token);
        if (!scope) return { ok: false, error: 'resolve_failed' };
        const r = await npcGw.callTool(scope, name, args || {});
        return { ok: true, result: typeof r === 'string' ? r.slice(0, 500) : r };
      } catch (e) {
        return { ok: false, error: String(e?.message || e).slice(0, 400) };
      }
    }

    const toolChecks = {};
    if (tokens.grok?.ok) {
      toolChecks.grok_get_status = await tryTool('grok', tokens.grok.token, 'get_status', {});
      toolChecks.grok_announce = await tryTool('grok', tokens.grok.token, 'announce_in_office', {
        message: 'MCP diagnose: Grok cloud link is live.',
      });
      toolChecks.grok_list_team = await tryTool('grok', tokens.grok.token, 'list_team', {});
    }
    if (tokens.claude?.ok) {
      toolChecks.claude_get_status = await tryTool('claude', tokens.claude.token, 'get_status', {});
      toolChecks.claude_announce = await tryTool('claude', tokens.claude.token, 'announce_in_office', {
        message: 'MCP diagnose: Claude cloud link is live.',
      });
    }
    step('tools', toolChecks);

    // Token inventory (no secrets)
    try {
      const rows = await db.query?.(
        `select npc_key, count(*)::int as n, max(created_at) as last_created
         from denizen_mcp_tokens
         where org_id = $1 and revoked_at is null
         group by npc_key order by npc_key`,
        [db.orgId],
      );
      step('token_counts', { rows: rows?.rows || rows || 'no_query' });
    } catch (e) {
      // try alternate API shapes
      try {
        const list = await db.listMcpTokens?.({ orgId: db.orgId });
        const by = {};
        for (const t of list || []) {
          const k = t.npc_key || t.npcKey || '_';
          by[k] = (by[k] || 0) + 1;
        }
        step('token_counts', { by });
      } catch (e2) {
        step('token_counts', { error: String(e?.message || e), error2: String(e2?.message || e2) });
      }
    }

    // Inference / brains hint
    try {
      const nodes = require('/app/src/denizen-inference-nodes.js');
      const snap = await nodes.getInferenceNodes?.() || nodes.list?.() || null;
      step('inference', snap);
    } catch (e) {
      step('inference', { error: String(e?.message || e) });
    }

    // Recent server log snippet for mcp
    try {
      const { execSync } = require('child_process');
      // cannot docker logs from inside; skip
      step('note', { msg: 'tokens written; announce attempted' });
    } catch (_) {}

  } catch (e) {
    report.fatal = String(e?.stack || e);
  }

  fs.writeFileSync(OUT + '/REPORT.json', JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT + '/DONE.txt', 'ok\n');
  console.log(JSON.stringify({ ok: !report.fatal, steps: report.steps.map(s => s.name), fatal: report.fatal || null }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
'''

ONESHOT = r'''#!/bin/sh
set -eu
DOCKER=/usr/local/bin/docker
HOST_DIR=/volume1/docker/denizen-server
LOG=$HOST_DIR/mcp-diag-oneshot.log
{
  echo "[oneshot] start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  $DOCKER cp "$HOST_DIR/diagnose-npc-mcp.js" denizen-server:/tmp/diagnose-npc-mcp.js
  $DOCKER exec denizen-server node /tmp/diagnose-npc-mcp.js
  $DOCKER cp denizen-server:/app/data/mcp-diag/REPORT.json "$HOST_DIR/mcp-diag-REPORT.json" 2>/dev/null || true
  $DOCKER cp denizen-server:/app/data/mcp-diag/tokens.json "$HOST_DIR/mcp-diag-tokens.json" 2>/dev/null || true
  $DOCKER cp denizen-server:/app/data/mcp-diag/DONE.txt "$HOST_DIR/mcp-diag-DONE.txt" 2>/dev/null || true
  echo "[oneshot] done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >>"$LOG" 2>&1 || {
  echo "[oneshot] FAILED $?" >>"$LOG"
}
if [ -f "$HOST_DIR/auto-deploy-loop.sh.bak" ]; then
  cp "$HOST_DIR/auto-deploy-loop.sh.bak" "$HOST_DIR/auto-deploy-loop.sh"
fi
exec /bin/sh "$HOST_DIR/auto-deploy-loop.sh"
'''


class Dsm:
    def __init__(self):
        import ssl
        ctx = ssl._create_unverified_context()
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ctx),
            urllib.request.HTTPCookieProcessor(self.cj),
        )
        self.token = None

    def login(self):
        data = urllib.parse.urlencode({
            "api": "SYNO.API.Auth",
            "version": "6",
            "method": "login",
            "account": USER,
            "passwd": PASS,
            "session": "FileStation",
            "format": "cookie",
            "enable_syno_token": "yes",
        }).encode()
        req = urllib.request.Request(
            f"{NAS}/webapi/auth.cgi",
            data=data,
            headers={"User-Agent": UA},
        )
        with self.opener.open(req, timeout=30) as r:
            body = json.loads(r.read().decode())
        if not body.get("success"):
            raise RuntimeError(f"login failed: {body}")
        self.token = body["data"]["synotoken"]
        print("DSM login ok", flush=True)

    def entry(self, params: dict, timeout=60):
        params = dict(params)
        data = urllib.parse.urlencode(params).encode()
        req = urllib.request.Request(
            f"{NAS}/webapi/entry.cgi",
            data=data,
            headers={"X-SYNO-TOKEN": self.token, "User-Agent": UA},
        )
        with self.opener.open(req, timeout=timeout) as r:
            return json.loads(r.read().decode())

    def upload_bytes(self, content: bytes, dest_path: str):
        boundary = "----CursorBoundaryMcpDiag"
        filename = Path(dest_path).name
        parent = str(Path(dest_path).parent).replace("\\", "/")
        fields = {
            "api": "SYNO.FileStation.Upload",
            "version": "2",
            "method": "upload",
            "path": parent,
            "create_parents": "true",
            "overwrite": "true",
            "SynoToken": self.token,
        }
        body = b""
        for k, v in fields.items():
            body += f"--{boundary}\r\n".encode()
            body += f'Content-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode()
        body += b"Content-Type: application/octet-stream\r\n\r\n"
        body += content
        body += f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(
            f"{NAS}/webapi/entry.cgi",
            data=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "X-SYNO-TOKEN": self.token,
                "User-Agent": UA,
            },
            method="POST",
        )
        with self.opener.open(req, timeout=120) as r:
            resp = json.loads(r.read().decode())
        if not resp.get("success"):
            raise RuntimeError(f"upload {dest_path} failed: {resp}")
        print(f"uploaded {dest_path} ({len(content)} bytes)", flush=True)

    def download(self, path: str) -> bytes:
        q = urllib.parse.urlencode({
            "api": "SYNO.FileStation.Download",
            "version": "2",
            "method": "download",
            "path": path,
            "mode": "download",
            "_dc": str(int(time.time() * 1000)),
        })
        req = urllib.request.Request(
            f"{NAS}/webapi/entry.cgi?{q}",
            headers={"X-SYNO-TOKEN": self.token, "User-Agent": UA},
        )
        with self.opener.open(req, timeout=60) as r:
            return r.read()

    def restart_container(self, name: str):
        for method in ("restart", "stop"):
            resp = self.entry({
                "api": "SYNO.Docker.Container",
                "version": "1",
                "method": method,
                "name": name,
            }, timeout=120)
            if not resp.get("success"):
                resp = self.entry({
                    "api": "SYNO.Docker.Container",
                    "version": "1",
                    "method": method,
                    "name": json.dumps([name]),
                }, timeout=120)
            print(f"docker {method} {name}: {resp.get('success')} {resp.get('error')}", flush=True)
            if resp.get("success"):
                if method == "restart":
                    return
                if method == "stop":
                    time.sleep(2)
                    start = self.entry({
                        "api": "SYNO.Docker.Container",
                        "version": "1",
                        "method": "start",
                        "name": json.dumps([name]),
                    }, timeout=120)
                    if not start.get("success"):
                        start = self.entry({
                            "api": "SYNO.Docker.Container",
                            "version": "1",
                            "method": "start",
                            "name": name,
                        }, timeout=120)
                    print(f"docker start {name}: {start.get('success')} {start.get('error')}", flush=True)
                    return
        raise RuntimeError("could not restart container")


def main() -> int:
    if not PASS:
        print("ERROR: set SYNO_SSH_PASSWORD", file=sys.stderr)
        return 1
    dsm = Dsm()
    dsm.login()

    try:
        bak = dsm.download(f"{REMOTE_DIR}/auto-deploy-loop.sh.bak")
        print(f"bak present {len(bak)} bytes", flush=True)
    except Exception as e:
        print(f"no bak yet ({e}); backing up live loop", flush=True)
        live = dsm.download(f"{REMOTE_DIR}/auto-deploy-loop.sh")
        dsm.upload_bytes(live, f"{REMOTE_DIR}/auto-deploy-loop.sh.bak")

    dsm.upload_bytes(DIAG_JS.encode(), f"{REMOTE_DIR}/diagnose-npc-mcp.js")
    dsm.upload_bytes(ONESHOT.encode(), f"{REMOTE_DIR}/auto-deploy-loop.sh")
    dsm.restart_container("denizen-deployer")

    out = Path("/tmp/mcp-diag")
    out.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + 180
    while time.time() < deadline:
        time.sleep(5)
        try:
            done = dsm.download(f"{REMOTE_DIR}/mcp-diag-DONE.txt")
            if done.strip():
                print("DONE marker found", flush=True)
                break
        except Exception:
            print("waiting for diag…", flush=True)
    else:
        print("TIMEOUT waiting for diag", flush=True)

    for name in ("mcp-diag-REPORT.json", "mcp-diag-tokens.json", "mcp-diag-oneshot.log"):
        try:
            raw = dsm.download(f"{REMOTE_DIR}/{name}")
            (out / name).write_bytes(raw)
            print(f"downloaded {name} ({len(raw)} bytes)", flush=True)
        except Exception as e:
            print(f"missing {name}: {e}", flush=True)

    # restore loop if still oneshot
    try:
        live = dsm.download(f"{REMOTE_DIR}/auto-deploy-loop.sh")
        if b"diagnose-npc-mcp" in live:
            bak = dsm.download(f"{REMOTE_DIR}/auto-deploy-loop.sh.bak")
            dsm.upload_bytes(bak, f"{REMOTE_DIR}/auto-deploy-loop.sh")
            dsm.restart_container("denizen-deployer")
            print("auto-deploy-loop restored", flush=True)
    except Exception as e:
        print(f"restore warn: {e}", flush=True)

    report_path = out / "mcp-diag-REPORT.json"
    if report_path.is_file():
        print(report_path.read_text()[:8000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
