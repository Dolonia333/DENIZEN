#!/usr/bin/env python3
"""Wire Dolonia Web Analyzer → Denizen lead intake webhook."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
N8N_API_URL = os.environ.get("N8N_API_URL", "http://127.0.0.1:5679/api/v1").rstrip("/")
API_KEY = os.environ.get("N8N_API_KEY", "")
WORKFLOW_ID = os.environ.get("WEB_ANALYZER_WORKFLOW_ID", "1B9yO3KPBgdlqNWV")
LEAD_WEBHOOK = os.environ.get(
    "DENIZEN_LEAD_WEBHOOK",
    "http://127.0.0.1:5679/webhook/denizen-lead-intake",
)
ORG_SLUG = os.environ.get("DENIZEN_CRM_ORG_SLUG", "zion")
LM_STUDIO_URL = os.environ.get(
    "DOLONIA_LM_STUDIO_URL",
    os.environ.get("LM_STUDIO_URL", "http://192.168.1.232:1234/v1/chat/completions"),
)

PREPARE_CODE = r"""// Map Web Analyzer scrape + LM output → Denizen lead intake payload.
const trigger = $('Webhook Trigger').first()?.json || {};
const body = trigger.body && typeof trigger.body === 'object' ? trigger.body : trigger;
const page = $('Download Page Data').first()?.json || {};
const lm = $input.item.json || {};

let summary = '';
if (lm.choices?.[0]?.message?.content) summary = String(lm.choices[0].message.content);
else if (typeof lm.content === 'string') summary = lm.content;
else if (typeof lm.summary === 'string') summary = lm.summary;
else summary = JSON.stringify(lm).slice(0, 4000);

const url = String(body.url || trigger.url || page.url || page.pageUrl || page.finalUrl || '').trim();
const company = String(body.company || trigger.company || page.title || page.company || page.siteName || '').trim();
const email = String(body.email || body.contact_email || page.email || page.contactEmail || '').trim();
const name = String(body.name || body.contact_name || page.contact || page.contactName || '').trim();
const jobId = page.jobId || $('Start Puppeteer Job').first()?.json?.jobId || null;

return [{
  json: {
    company,
    url,
    contact_email: email,
    contact_name: name,
    summary,
    source: 'dolonia_web_analyzer',
    org_slug: '__ORG_SLUG__',
    signals: {
      analyzer: 'Dolonia Web Analyzer',
      jobId,
      scrapedAt: new Date().toISOString(),
    },
  },
}];
""".replace("__ORG_SLUG__", ORG_SLUG)

FORMAT_CODE = r"""const leadPayload = $('Prepare Denizen lead').first()?.json || {};
const denizen = $('POST → Denizen lead intake').first()?.json || {};
const lm = $('Send to LM Studio').first()?.json || {};
return [{
  json: {
    ok: true,
    analyzer: 'Dolonia Web Analyzer',
    denizen,
    lead: leadPayload,
    lmStudio: lm,
  },
}];
"""


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 90) -> tuple[int, str]:
    print("$", cmd[:160])
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out


def patch_workflow(wf: dict) -> dict:
    nodes = list(wf.get("nodes", []))
    if any(n.get("name") == "Prepare Denizen lead" for n in nodes):
        print("Already wired — refreshing LM Studio URL only")
        for n in nodes:
            if n.get("name") == "Send to LM Studio":
                n.setdefault("parameters", {})["url"] = LM_STUDIO_URL
        return {
            "name": wf.get("name", "Dolonia Web Analyzer"),
            "nodes": nodes,
            "connections": wf.get("connections") or {},
            "settings": wf.get("settings") or {"executionOrder": "v1"},
        }

    nodes = wf.get("nodes", [])
    by_name = {n.get("name"): n for n in nodes}

    # Fix LM Studio URL to current dolonia GPU if still on legacy IP.
    lm = by_name.get("Send to LM Studio")
    if lm:
        lm.setdefault("parameters", {})["url"] = LM_STUDIO_URL

    # Remove broken second webhook responder — we use lastNode on trigger.
    nodes = [n for n in nodes if n.get("name") != "Webhook Response"]

    prep_id = "f1a2b3c4-d001-4000-8000-analyzer0001"
    post_id = "f1a2b3c4-d001-4000-8000-analyzer0002"
    fmt_id = "f1a2b3c4-d001-4000-8000-analyzer0003"

    nodes.append({
        "parameters": {"jsCode": PREPARE_CODE},
        "id": prep_id,
        "name": "Prepare Denizen lead",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [1760, 0],
    })
    nodes.append({
        "parameters": {
            "method": "POST",
            "url": LEAD_WEBHOOK,
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [{"name": "Content-Type", "value": "application/json"}],
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": "={{ JSON.stringify($json) }}",
            "options": {"timeout": 45000},
        },
        "id": post_id,
        "name": "POST → Denizen lead intake",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [1980, 0],
    })
    nodes.append({
        "parameters": {"jsCode": FORMAT_CODE},
        "id": fmt_id,
        "name": "Format analyzer response",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [2200, 0],
    })

    connections = dict(wf.get("connections") or {})
    connections["Send to LM Studio"] = {
        "main": [[{"node": "Prepare Denizen lead", "type": "main", "index": 0}]],
    }
    connections["Prepare Denizen lead"] = {
        "main": [[{"node": "POST → Denizen lead intake", "type": "main", "index": 0}]],
    }
    connections["POST → Denizen lead intake"] = {
        "main": [[{"node": "Format analyzer response", "type": "main", "index": 0}]],
    }
    connections.pop("Webhook Response", None)

    trigger = by_name.get("Webhook Trigger")
    if trigger:
        trigger.setdefault("parameters", {})["responseMode"] = "lastNode"

    return {
        "name": wf.get("name", "Dolonia Web Analyzer"),
        "nodes": nodes,
        "connections": connections,
        "settings": wf.get("settings") or {"executionOrder": "v1"},
    }


def main() -> int:
    if not API_KEY or not PWD:
        print("N8N_API_KEY and SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    code, raw = run(client, f"curl -fsS -m 30 -H 'X-N8N-API-KEY: {API_KEY}' '{N8N_API_URL}/workflows/{WORKFLOW_ID}'")
    if code != 0:
        print(raw, file=sys.stderr)
        client.close()
        return 1

    wf = json.loads(raw)
    patched = patch_workflow(wf)

    unarchive_cmd = (
        f"curl -sS -m 30 -X POST -H 'X-N8N-API-KEY: {API_KEY}' "
        f"'{N8N_API_URL}/workflows/{WORKFLOW_ID}/unarchive' -w '\\nHTTP_%{{http_code}}' || true"
    )
    run(client, unarchive_cmd)

    stdin, stdout, _ = client.exec_command("cat > /tmp/web-analyzer-patched.json", timeout=60)
    stdin.write(json.dumps(patched).encode("utf-8"))
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()

    put_cmd = (
        f"curl -sS -m 60 -X PUT -H 'Content-Type: application/json' "
        f"-H 'X-N8N-API-KEY: {API_KEY}' "
        f"-d @/tmp/web-analyzer-patched.json '{N8N_API_URL}/workflows/{WORKFLOW_ID}' "
        f"-w '\\nHTTP_%{{http_code}}'"
    )
    _, out = run(client, put_cmd)
    if out:
        sys.stdout.buffer.write(out[-1200].encode("utf-8", errors="replace"))
        sys.stdout.buffer.write(b"\n")
    if out and "HTTP_200" not in out and "HTTP_201" not in out:
        print("PUT failed", file=sys.stderr)
        client.close()
        return 1

    run(client, f"curl -fsS -m 30 -X POST -H 'X-N8N-API-KEY: {API_KEY}' '{N8N_API_URL}/workflows/{WORKFLOW_ID}/activate'")

    client.close()
    print("\n==> Dolonia Web Analyzer wired to Denizen lead intake")
    print(f"  Workflow ID:     {WORKFLOW_ID}")
    print(f"  Scrape webhook:  https://n8n.dolonia.cloud/webhook/scrape")
    print(f"  Lead intake hop: {LEAD_WEBHOOK}")
    print(f"  LM Studio URL:   {LM_STUDIO_URL}")
    print(f"  CRM org_slug:    {ORG_SLUG}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
