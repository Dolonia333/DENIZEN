#!/usr/bin/env python3
"""Deploy Dolonia platform tables + migrations 000005-000013 on NAS."""

from __future__ import annotations

from hostcfg import get_host
import os
import re
import subprocess
import sys
from pathlib import Path

import paramiko

DESKTOP_DB = "supabase_db_Desktop"
HOST = get_host("SYNO_HOST")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = "/usr/local/bin/docker"
NAS_DB = "supabase-db"
MIGRATIONS = Path(__file__).resolve().parents[1] / "denizen" / "supabase" / "migrations"
PLATFORM_MIGRATIONS = [
    "20260606000005_platform_org_bridge.sql",
    "20260606000006_outcome_triggers.sql",
    "20260606000012_platform_identity_bridge.sql",
    "20260606000013_platform_tables_admin.sql",
]
EXTRA_FUNCS = [
    "is_admin",
    "is_admin(uuid)",
    "update_updated_at_column",
]


def run_local(cmd: list[str], timeout: int = 600) -> tuple[int, str]:
    print("$", " ".join(cmd[:6]), "...", flush=True)
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    out = (proc.stdout or b"").decode("utf-8", errors="replace") + (
        proc.stderr or b""
    ).decode("utf-8", errors="replace")
    if out.strip():
        print(out.rstrip()[-3000:])
    return proc.returncode, out


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    print("$", cmd[:120], flush=True)
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip()[-3000:])
    return code, out


def psql_local(sql: str) -> str:
    proc = subprocess.run(
        ["docker", "exec", DESKTOP_DB, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql],
        capture_output=True,
        text=True,
        timeout=120,
    )
    return proc.stdout.strip()


def sanitize_sql(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if line.startswith("\\restrict") or line.startswith("\\unrestrict"):
            continue
        if "transaction_timeout" in line:
            continue
        lines.append(line)
    return "\n".join(lines).strip() + "\n"


def platform_tables() -> list[str]:
    raw = psql_local(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' "
        "AND tablename NOT LIKE 'denizen%' ORDER BY tablename;"
    )
    return [x.strip() for x in raw.splitlines() if x.strip()]


def dump_platform_enums() -> str:
    proc = subprocess.run(
        [
            "docker", "exec", DESKTOP_DB, "psql", "-U", "postgres", "-d", "postgres",
            "-t", "-A", "-c",
            "SELECT format('CREATE TYPE public.%I AS ENUM (%s);', t.typname, "
            "string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)) "
            "FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid "
            "JOIN pg_namespace n ON n.oid = t.typnamespace "
            "WHERE n.nspname = 'public' AND t.typtype = 'e' "
            "GROUP BY t.typname ORDER BY t.typname;",
        ],
        capture_output=True,
        timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or b"").decode())
    lines = [ln.strip() for ln in proc.stdout.decode().splitlines() if ln.strip()]
    ddl = "\n".join(f"DO $$ BEGIN {ln} EXCEPTION WHEN duplicate_object THEN NULL; END $$;" for ln in lines)
    return sanitize_sql(ddl + "\n") if ddl else ""


def dump_platform_functions() -> str:
    names = ", ".join(f"'{n.split('(')[0]}'" for n in EXTRA_FUNCS)
    proc = subprocess.run(
        [
            "docker", "exec", DESKTOP_DB, "psql", "-U", "postgres", "-d", "postgres",
            "-t", "-A", "-c",
            "SELECT pg_get_functiondef(oid) || ';' FROM pg_proc "
            f"WHERE pronamespace = 'public'::regnamespace AND proname IN ({names}) "
            "ORDER BY proname, oid;",
        ],
        capture_output=True,
        timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or b"").decode())
    return sanitize_sql(proc.stdout.decode("utf-8", errors="replace"))


def dump_platform_schema(tables: list[str]) -> str:
    args = [
        "docker", "exec", DESKTOP_DB, "pg_dump", "-U", "postgres", "-d", "postgres",
        "--schema-only", "--no-owner", "--no-privileges",
    ]
    for t in tables:
        args.extend(["-t", f"public.{t}"])
    proc = subprocess.run(args, capture_output=True, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or b"").decode())
    schema = sanitize_sql(proc.stdout.decode("utf-8", errors="replace"))
    enums = dump_platform_enums()
    funcs = dump_platform_functions()
    prefix = "CREATE EXTENSION IF NOT EXISTS pg_trgm;\n"
    parts = [p for p in (prefix, enums, funcs, schema) if p.strip()]
    return "\n".join(parts)


def apply_sql(client: paramiko.SSHClient, sql: str, user: str = "postgres") -> int:
    if not sql.strip():
        return 0
    _, out = run_ssh(client, f"grep '^POSTGRES_PASSWORD=' /volume1/docker/supabase-project/.env | head -1")
    pg_pass = out.strip().split("=", 1)[-1]
    stdin, stdout, stderr = client.exec_command(
        f"{DOCKER} exec -i -e PGPASSWORD='{pg_pass}' {NAS_DB} "
        f"psql -v ON_ERROR_STOP=0 -U {user} -d postgres",
        timeout=900,
    )
    stdin.write(sql.encode("utf-8"))
    stdin.flush()
    stdin.channel.shutdown_write()
    text = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if "ERROR" in text:
        print(text[-4000:])
    return code


def migrate_platform_data(tables: list[str]) -> None:
    script = Path(__file__).resolve().parent / "migrate-desktop-to-nas.py"
    env = os.environ.copy()
    env["ONLY_TABLES"] = ",".join(tables)
    env["SKIP_TRUNCATE"] = "1"
    proc = subprocess.run([sys.executable, str(script)], env=env, timeout=3600)
    if proc.returncode not in (0, 2):
        raise RuntimeError(f"platform data migrate exit {proc.returncode}")


def apply_migration(client: paramiko.SSHClient, path: Path, role: str) -> int:
    _, out = run_ssh(client, f"grep '^POSTGRES_PASSWORD=' /volume1/docker/supabase-project/.env | head -1")
    pg_pass = out.strip().split("=", 1)[-1]
    sql = path.read_text(encoding="utf-8")
    stdin, stdout, stderr = client.exec_command(
        f"cat | {DOCKER} exec -i -e PGPASSWORD='{pg_pass}' {NAS_DB} "
        f"psql -v ON_ERROR_STOP=1 -U {role} -d postgres",
        timeout=900,
    )
    stdin.write(sql.encode("utf-8"))
    stdin.flush()
    stdin.channel.shutdown_write()
    text = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if text.strip():
        print(text.rstrip()[-4000:])
    return code


def backfill_denizen_columns() -> None:
    """Re-sync denizen tables that gained columns from platform migrations."""
    script = Path(__file__).resolve().parent / "migrate-desktop-to-nas.py"
    env = os.environ.copy()
    env["ONLY_TABLES"] = "denizen_job_applications,denizen_outcomes,denizen_predictions"
    proc = subprocess.run([sys.executable, str(script)], env=env, timeout=600)
    if proc.returncode not in (0, 2):
        raise RuntimeError(f"denizen column backfill exit {proc.returncode}")


def main() -> int:
    if not PASSWORD:
        print("Set SYNO_SSH_PASSWORD", file=sys.stderr)
        return 1

    tables = platform_tables()
    print(f"Platform tables on Desktop: {len(tables)}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

    print("\n=== 1) Platform schema from Desktop ===")
    schema = dump_platform_schema(tables)
    code = apply_sql(client, schema, user="postgres")
    if code != 0:
        print("Schema apply had errors (may be partial idempotent re-run)", file=sys.stderr)

    print("\n=== 2) Platform data (intake_forms etc.) ===")
    data_tables = []
    for t in tables:
        d = int(psql_local(f"SELECT count(*) FROM public.{t};") or "0")
        if d <= 0:
            continue
        _, nas_out = run_ssh(
            client,
            f"{DOCKER} exec {NAS_DB} psql -U postgres -d postgres -t -A -c "
            f"\"SELECT count(*) FROM public.{t};\"",
        )
        n = int(nas_out.strip() or "0")
        if d != n:
            data_tables.append(t)
            print(f"  {t}: desktop={d} nas={n} (will migrate)")
        else:
            print(f"  {t}: {d} rows (already synced)")
    if data_tables:
        migrate_platform_data(data_tables)
    else:
        print("  All platform data already synced")

    print("\n=== 3) Platform migrations 000005-000013 ===")
    roles = {
        "20260606000005": "postgres",
        "20260606000006": "supabase_admin",
        "20260606000012": "postgres",
        "20260606000013": "supabase_admin",
    }
    for name in PLATFORM_MIGRATIONS:
        path = MIGRATIONS / name
        ver = name.split("_")[0]
        role = roles.get(ver, "postgres")
        print(f"\n==> {name} as {role}")
        code = apply_migration(client, path, role)
        if code != 0:
            print(f"FAILED {name}", file=sys.stderr)
            client.close()
            return code

    print("\n=== 4) Backfill denizen extra columns ===")
    backfill_denizen_columns()

    print("\n=== 5) Verify ===")
    for check in [
        "SELECT count(*) FROM public.intake_forms",
        "SELECT count(*) FROM pg_views WHERE viewname IN ('denizen_intake_funnel','denizen_rfp_velocity')",
        "SELECT column_name FROM information_schema.columns WHERE table_name='denizen_job_applications' AND column_name='org_id'",
    ]:
        run_ssh(
            client,
            f"{DOCKER} exec {NAS_DB} psql -U postgres -d postgres -t -A -c \"{check};\"",
        )

    client.close()
    print("\nPlatform deploy complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
