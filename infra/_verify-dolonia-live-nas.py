#!/usr/bin/env python3
"""Quick live check: Dolonia conversation stack on NAS."""
from __future__ import annotations
from hostcfg import get_host
import os, sys, json
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401
import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
USER = os.environ.get("SYNO_USER", "admin")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

def run(c, cmd, timeout=60):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out

def main():
    if not PWD:
        print("NO_PASSWORD")
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PWD, look_for_keys=False, allow_agent=False)

    checks = {}

    # health
    code, out = run(c, f"curl -fsS -m 12 http://127.0.0.1:{PORT}/api/health")
    try:
        h = json.loads(out)
        checks["health"] = {
            "ok": h.get("ok"),
            "lm": h.get("lmStudio", {}).get("reachable"),
            "model": h.get("lmStudio", {}).get("model"),
        }
    except Exception:
        checks["health"] = {"ok": False, "raw": out[:200]}

    # quality API
    code, out = run(c, f"curl -fsS -m 15 http://127.0.0.1:{PORT}/api/dolonia/conversation-quality")
    try:
        q = json.loads(out)
        w = q.get("warehouse") or {}
        checks["quality_api"] = {
            "ok": q.get("ok"),
            "product": q.get("product"),
            "warehouse_ok": w.get("ok"),
            "people": w.get("people"),
            "communities": w.get("communities"),
            "events24h": w.get("events24h"),
            "qualityEvents24h": w.get("qualityEvents24h"),
            "avgQuality24h": w.get("avgQuality24h"),
            "themes": len(w.get("topThemes") or []),
        }
    except Exception:
        checks["quality_api"] = {"ok": False, "raw": out[:300]}

    # bot logs
    code, out = run(c, f"{DOCKER} logs --tail 40 denizen-server 2>&1")
    bot_ok = "logged in as Denizen" in out or "Denizen#" in out
    checks["discord_bot"] = {
        "logged_in": bot_ok,
        "snippet": [ln for ln in out.splitlines() if "discord-bot" in ln.lower()][-6:],
    }

    # modules present
    code, out = run(
        c,
        f"{DOCKER} exec denizen-server node -e "
        "\"const m=['./src/dolonia-conversation-data','./src/denizen-conversation-sense',"
        "'./src/denizen-discord-farm','./discord-bot/src/chat',"
        "'./discord-bot/src/modules/data-farm'];"
        "const r={}; for (const p of m){ try{ require(p); r[p]='ok'; } catch(e){ r[p]=e.message; } }"
        "const d=require('./src/dolonia-conversation-data');"
        "r.enabled=d.dataEnabled(); r.product=d.productKey();"
        "console.log(JSON.stringify(r));\"",
    )
    try:
        checks["modules"] = json.loads(out.strip().splitlines()[-1])
    except Exception:
        checks["modules"] = {"raw": out[:400]}

    # postgres counts
    code, out = run(
        c,
        f"{DOCKER} exec supabase-db psql -U postgres -d postgres -t -A -c "
        "\"select 'products='||(select count(*) from dolonia_products)||"
        "';events='||(select count(*) from dolonia_conv_events)||"
        "';quality='||(select count(*) from dolonia_conv_events where is_quality)||"
        "';people='||(select count(*) from dolonia_conv_person_styles)||"
        "';communities='||(select count(*) from dolonia_conv_communities)||"
        "';themes='||(select count(*) from dolonia_conv_themes);\"",
    )
    checks["postgres"] = out.strip()

    # local file cache
    code, out = run(
        c,
        f"{DOCKER} exec denizen-server node -e "
        "\"const fs=require('fs'); const p=['/app/data/conversation-sense','/app/data/discord-farm'];"
        "const o={}; for (const d of p){ o[d]=fs.existsSync(d)?fs.readdirSync(d):null; }"
        "console.log(JSON.stringify(o));\"",
    )
    try:
        checks["local_files"] = json.loads(out.strip().splitlines()[-1])
    except Exception:
        checks["local_files"] = out[:300]

    c.close()
    print(json.dumps(checks, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
