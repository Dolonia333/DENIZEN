#!/usr/bin/env python3
"""Apply dolonia_conversation_data migration on NAS Supabase + hot-deploy dual-write code."""
from __future__ import annotations

from hostcfg import get_host
import base64
import os
import sys
import tarfile
import tempfile
import time
from pathlib import Path

INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401
import paramiko

ROOT = INFRA.parent
DENIZEN = ROOT / "denizen"
SQL = DENIZEN / "supabase" / "migrations" / "20260716000001_dolonia_conversation_data.sql"

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
USER = os.environ.get("SYNO_USER", "admin")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
REMOTE = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")

CODE_FILES = [
    ("src/dolonia-conversation-data.js", "/app/src/dolonia-conversation-data.js"),
    ("src/denizen-conversation-sense.js", "/app/src/denizen-conversation-sense.js"),
    ("src/denizen-discord-farm.js", "/app/src/denizen-discord-farm.js"),
    ("src/denizen-learning-metrics.js", "/app/src/denizen-learning-metrics.js"),
    ("server.js", "/app/server.js"),
    ("discord-bot/src/modules/data-farm/index.js", "/app/discord-bot/src/modules/data-farm/index.js"),
    ("discord-bot/src/chat.js", "/app/discord-bot/src/chat.js"),
    ("discord-bot/src/modules/load-modules.js", "/app/discord-bot/src/modules/load-modules.js"),
    ("discord-bot/src/core/config-store.js", "/app/discord-bot/src/core/config-store.js"),
    ("docs/DOLONIA_CONVERSATION_DATA.md", "/app/docs/DOLONIA_CONVERSATION_DATA.md"),
]


def run(client, cmd, timeout=300):
    print("$", cmd[:180], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip()[:2000].encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status(), out


def find_db_container(client) -> str | None:
    code, out = run(
        client,
        f'{DOCKER} ps --format "{{{{.Names}}}}" | tr "\\n" " "',
        timeout=60,
    )
    names = out.split()
    for cand in (
        "supabase-db",
        "supabase_db",
        "db",
        "postgres",
        "supabase-postgres",
    ):
        for n in names:
            if cand in n.lower() or n.lower() == cand:
                return n
    # fuzzy
    for n in names:
        if "supabase" in n.lower() and "db" in n.lower():
            return n
    return None


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    if not SQL.is_file():
        print(f"missing {SQL}", file=sys.stderr)
        return 1
    for rel, _ in CODE_FILES:
        if not (DENIZEN / rel).is_file():
            print(f"missing {DENIZEN / rel}", file=sys.stderr)
            return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PWD, look_for_keys=False, allow_agent=False)

    # Upload SQL
    remote_sql = f"{REMOTE}/dolonia_conv_data.sql"
    sql_bytes = SQL.read_bytes()
    stdin, stdout, _ = client.exec_command(f"cat > '{remote_sql}'", timeout=120)
    stdin.write(sql_bytes)
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()
    print(f"uploaded sql ({len(sql_bytes)} bytes)", flush=True)

    db = find_db_container(client)
    if not db:
        print("WARN: no supabase db container found — listing containers", flush=True)
        run(client, f"{DOCKER} ps --format 'table {{{{.Names}}}}\\t{{{{.Status}}}}'")
    else:
        print(f"db container: {db}", flush=True)
        # Prefer postgres superuser; try service roles
        applied = False
        for user in ("postgres", "supabase_admin"):
            code, out = run(
                client,
                f"{DOCKER} exec -i {db} psql -U {user} -d postgres -v ON_ERROR_STOP=1 < '{remote_sql}'",
                timeout=180,
            )
            if code == 0 and "ERROR" not in out:
                print(f"migration applied as {user}", flush=True)
                applied = True
                break
            # docker exec -i with shell redirect may not work; use cat pipe
            code2, out2 = run(
                client,
                f"cat '{remote_sql}' | {DOCKER} exec -i {db} psql -U {user} -d postgres -v ON_ERROR_STOP=1",
                timeout=180,
            )
            if code2 == 0:
                print(f"migration applied as {user} (pipe)", flush=True)
                applied = True
                break
            print(f"try {user} failed code={code}/{code2}", flush=True)
        if not applied:
            print("WARN: migration may have failed — check output above", flush=True)

    # Deploy code tarball into denizen-server
    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "dolonia.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for rel, _ in CODE_FILES:
                tar.add(DENIZEN / rel, arcname=rel)
        rt = f"{REMOTE}/dolonia-conv.tar.gz"
        ed = f"{REMOTE}/dolonia-conv"
        stdin, stdout, _ = client.exec_command(f"cat > '{rt}'", timeout=120)
        stdin.write(tar_path.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()
        run(client, f"rm -rf '{ed}' && mkdir -p '{ed}' && tar -xzf '{rt}' -C '{ed}'")
        run(
            client,
            f"{DOCKER} exec denizen-server mkdir -p /app/src /app/docs "
            f"/app/discord-bot/src/modules/data-farm /app/discord-bot/src/core",
        )
        for rel, dst in CODE_FILES:
            run(client, f"{DOCKER} cp '{ed}/{rel}' denizen-server:{dst}")

    run(client, f"{DOCKER} exec denizen-server sh -c \"pkill -f '/app/discord-bot/index.js' 2>/dev/null || true\"")
    run(client, f"{DOCKER} restart denizen-server", timeout=180)
    time.sleep(22)

    # Verify tables + dual-write smoke
    if db:
        run(
            client,
            f"cat '{remote_sql}' >/dev/null; "
            f"{DOCKER} exec {db} psql -U postgres -d postgres -c "
            "\"select product_key, display_name from dolonia_products;\"",
        )
        run(
            client,
            f"{DOCKER} exec {db} psql -U postgres -d postgres -c "
            "\"select count(*) as events from dolonia_conv_events;\"",
        )

    run(
        client,
        f"{DOCKER} exec denizen-server node -e "
        "\"const d=require('./src/dolonia-conversation-data');"
        "const f=require('./src/denizen-discord-farm');"
        "const r=f.ingestChatEvent({source:'warehouse-smoke',guildId:'g-dolonia',"
        "channelId:'c1',userId:'u-dolonia-1',"
        "content:'Why is the deploy pipeline broken again? need help with oauth api error',"
        "messageId:'m-smoke'});"
        "console.log(JSON.stringify({ingest:r.ok,sense:r.sense&&r.sense.primary,"
        "warehouse:r.warehouse,enabled:d.dataEnabled(),product:d.productKey()}));\"",
    )
    time.sleep(3)
    run(
        client,
        f"curl -fsS -m 15 http://127.0.0.1:{PORT}/api/dolonia/conversation-quality | head -c 900",
    )
    if db:
        run(
            client,
            f"{DOCKER} exec {db} psql -U postgres -d postgres -c "
            "\"select count(*) events, count(*) filter (where is_quality) quality "
            "from dolonia_conv_events; select product_key, count(*) people "
            "from dolonia_conv_person_styles group by 1;\"",
        )

    client.close()
    print("==> Dolonia conversation data live", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
