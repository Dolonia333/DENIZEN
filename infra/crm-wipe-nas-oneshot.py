#!/usr/bin/env python3
"""Upload CRM wipe + oneshot auto-deploy-loop, restart denizen-deployer via DSM HTTPS."""
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
ROOT = Path(__file__).resolve().parent.parent
WIPE = ROOT / "denizen/scripts/crm-pipeline-wipe.js"
DUMP = ROOT / "denizen/scripts/crm-board-dump.js"

ONESHOT = r'''#!/bin/sh
# Temporary oneshot: run CRM pipeline wipe (kill phase), then restore real loop.
set -eu
DOCKER=/usr/local/bin/docker
HOST_DIR=/volume1/docker/denizen-server
LOG=$HOST_DIR/crm-wipe-oneshot.log
{
  echo "[oneshot] start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  $DOCKER cp "$HOST_DIR/crm-pipeline-wipe.js" denizen-server:/tmp/crm-pipeline-wipe.js
  $DOCKER cp "$HOST_DIR/crm-board-dump.js" denizen-server:/tmp/crm-board-dump.js 2>/dev/null || true
  $DOCKER exec denizen-server node /tmp/crm-pipeline-wipe.js --apply --phase=kill
  $DOCKER exec denizen-server node /tmp/crm-board-dump.js || true
  echo "[oneshot] wipe done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >>"$LOG" 2>&1 || {
  echo "[oneshot] FAILED $?" >>"$LOG"
}
# restore real loop
if [ -f "$HOST_DIR/auto-deploy-loop.sh.bak" ]; then
  cp "$HOST_DIR/auto-deploy-loop.sh.bak" "$HOST_DIR/auto-deploy-loop.sh"
fi
exec /bin/sh "$HOST_DIR/auto-deploy-loop.sh"
'''

BOARD_DUMP = r''''use strict';
const fs = require('fs');
const path = require('path');
const ORG = 'be6080e8-638a-495a-b05d-2d90cd1b838f';
const OUT = '/app/data/crm-hygiene';
(async () => {
  const store = require('/app/src/denizen-crm-store.js');
  const row = await store.getWorkspace(ORG);
  const s = row.state || {};
  const deals = s.deals || [];
  const contacts = s.contacts || [];
  const tasks = (s.tasks || []).filter(t => !t.done && !['done','closed','completed'].includes(String(t.status||'').toLowerCase()));
  const companies = s.companies || [];
  const quotes = s.quotes || [];
  const openish = deals.filter(d => {
    const st = String(d.status||'').toLowerCase();
    return !['lost','disqualified','won','closed'].includes(st);
  });
  const pipeline = openish.filter(d => {
    const st = String(d.status||'').toLowerCase();
    const stage = String(d.stage||'').toLowerCase();
    if (st === 'watchlist' || st === 'expired') return false;
    if (stage.includes('watch') || stage.includes('expired') || stage.includes('lost')) return false;
    if ((d.tags||[]).includes('watchlist') || (d.tags||[]).includes('not-pipeline')) return false;
    return true;
  });
  const board = {
    updated_at: row.updated_at,
    counts: {
      contacts: contacts.length,
      deals_total: deals.length,
      open_pipeline: pipeline.length,
      open_pipeline_value: pipeline.reduce((a,d)=>a+Number(d.value||0),0),
      watchlist_or_openish: openish.length,
      open_tasks: tasks.length,
      companies: companies.length,
      quotes: quotes.length,
    },
    contacts: contacts.map(c => ({id:c.id,name:c.name,email:c.email,company:c.company,status:c.status,tags:c.tags})),
    open_pipeline: pipeline.map(d => ({id:d.id,title:d.title,stage:d.stage,status:d.status,value:d.value,contact:d.contact,company:d.company})),
    leftover_nonclosed: openish.map(d => ({id:d.id,title:d.title,stage:d.stage,status:d.status,value:d.value,contact:d.contact,company:d.company,tags:d.tags})),
    open_tasks: tasks.map(t => ({id:t.id,title:t.title,due:t.due,contact:t.contact,dealId:t.dealId})),
    companies: companies.map(c => ({id:c.id,name:c.name,status:c.status,tags:c.tags})),
    quotes: quotes.map(q => ({id:q.id,company:q.company,status:q.status,total:q.total})),
  };
  fs.mkdirSync(OUT, {recursive:true});
  fs.writeFileSync(path.join(OUT, 'BOARD_AFTER_KILL.json'), JSON.stringify(board, null, 2));
  fs.writeFileSync(path.join(OUT, 'BOARD_DONE.txt'), 'ok\n');
  console.log(JSON.stringify(board.counts, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
'''


UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


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

    def upload(self, local: Path, dest_path: str):
        # dest_path like /docker/denizen-server/file.js
        boundary = "----CursorBoundary7f3a9c"
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
        raw = local.read_bytes() if local.is_file() else local  # Path or bytes via wrapper
        if isinstance(local, Path):
            content = local.read_bytes()
        else:
            content = local
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
        print(f"uploaded {dest_path}", flush=True)

    def upload_bytes(self, content: bytes, dest_path: str):
        boundary = "----CursorBoundary7f3a9c"
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
        # Synology Docker: method=stop then start, or restart if available
        for method in ("restart", "stop"):
            resp = self.entry({
                "api": "SYNO.Docker.Container",
                "version": "1",
                "method": method,
                "name": json.dumps(name) if False else name,
            }, timeout=120)
            # Some DSM builds want name as JSON string array
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
        print("ERROR: set SYNO_SSH_PASSWORD or DSM_PASSWORD", file=sys.stderr)
        return 1
    if not WIPE.is_file():
        print("missing wipe script", file=sys.stderr)
        return 1
    dsm = Dsm()
    dsm.login()

    # Ensure bak exists (download current loop; if no bak, upload as bak)
    try:
        bak = dsm.download(f"{REMOTE_DIR}/auto-deploy-loop.sh.bak")
        print(f"bak present {len(bak)} bytes", flush=True)
    except Exception as e:
        print(f"no bak yet ({e}); downloading live loop as bak", flush=True)
        live = dsm.download(f"{REMOTE_DIR}/auto-deploy-loop.sh")
        dsm.upload_bytes(live, f"{REMOTE_DIR}/auto-deploy-loop.sh.bak")

    dsm.upload(WIPE, f"{REMOTE_DIR}/crm-pipeline-wipe.js")
    dump_path = ROOT / "denizen/scripts/crm-board-dump.js"
    if dump_path.is_file():
        dsm.upload(dump_path, f"{REMOTE_DIR}/crm-board-dump.js")
    else:
        dsm.upload_bytes(BOARD_DUMP.encode(), f"{REMOTE_DIR}/crm-board-dump.js")
    dsm.upload_bytes(ONESHOT.encode(), f"{REMOTE_DIR}/auto-deploy-loop.sh")

    dsm.restart_container("denizen-deployer")

    # Poll for WIPE_DONE / BOARD_DONE under data/crm-hygiene (bind-mounted)
    done_path = f"{REMOTE_DIR}/data/crm-hygiene/WIPE_DONE.txt"
    board_path = f"{REMOTE_DIR}/data/crm-hygiene/BOARD_AFTER_KILL.json"
    report_path = f"{REMOTE_DIR}/data/crm-hygiene/WIPE_LATEST.json"
    out_dir = Path("/tmp/crm-wipe-out")
    out_dir.mkdir(exist_ok=True)

    for i in range(40):
        time.sleep(3)
        try:
            done = dsm.download(done_path)
            print(f"WIPE_DONE: {done.decode(errors='replace').strip()}", flush=True)
            break
        except Exception as e:
            print(f"wait wipe [{i}] {e}", flush=True)
    else:
        # try log
        try:
            log = dsm.download(f"{REMOTE_DIR}/crm-wipe-oneshot.log")
            (out_dir / "oneshot.log").write_bytes(log)
            print(log.decode(errors="replace")[-2000:], flush=True)
        except Exception as e:
            print("no log", e, flush=True)
        return 2

    for p, name in [
        (report_path, "WIPE_LATEST.json"),
        (board_path, "BOARD_AFTER_KILL.json"),
        (f"{REMOTE_DIR}/crm-wipe-oneshot.log", "oneshot.log"),
    ]:
        try:
            data = dsm.download(p)
            (out_dir / name).write_bytes(data)
            print(f"saved {name} ({len(data)} bytes)", flush=True)
        except Exception as e:
            print(f"missing {name}: {e}", flush=True)

    # Confirm loop restored
    try:
        live = dsm.download(f"{REMOTE_DIR}/auto-deploy-loop.sh")
        if b"oneshot" in live and b"crm-pipeline-wipe" in live:
            print("WARNING: oneshot still in place — restoring bak", flush=True)
            bak = dsm.download(f"{REMOTE_DIR}/auto-deploy-loop.sh.bak")
            dsm.upload_bytes(bak, f"{REMOTE_DIR}/auto-deploy-loop.sh")
            dsm.restart_container("denizen-deployer")
        else:
            print("auto-deploy-loop restored", flush=True)
    except Exception as e:
        print("loop check failed", e, flush=True)

    print("OUT", out_dir, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
