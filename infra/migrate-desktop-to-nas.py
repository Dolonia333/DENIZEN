#!/usr/bin/env python3
"""Migrate public schema data from Docker Desktop Supabase to NAS Supabase."""

from __future__ import annotations

from hostcfg import get_host
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import paramiko

DESKTOP_DB = "supabase_db_Desktop"
NAS_HOST = get_host("SYNO_HOST")
NAS_USER = os.environ.get("SYNO_USER", "admin")
NAS_PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
NAS_DOCKER = "/usr/local/bin/docker"
NAS_DB = "supabase-db"
NAS_ENV = "/volume1/docker/supabase-project/.env"


def run_local(cmd: list[str], timeout: int = 3600) -> tuple[int, str]:
    print("$", " ".join(cmd), flush=True)
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    out = (proc.stdout or "") + (proc.stderr or "")
    if out.strip():
        print(out.rstrip())
    return proc.returncode, out


def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 3600) -> tuple[int, str]:
    print("$", cmd, flush=True)
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    return code, out


def desktop_tables() -> list[str]:
    only = os.environ.get("ONLY_TABLES", "").strip()
    if only:
        return [t.strip() for t in only.split(",") if t.strip()]
    code, out = run_local(
        [
            "docker",
            "exec",
            DESKTOP_DB,
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-t",
            "-A",
            "-c",
            "SELECT tablename FROM pg_tables WHERE schemaname='public' "
            "AND (tablename LIKE 'denizen%' OR tablename IN ('intake_forms')) "
            "ORDER BY tablename;",
        ]
    )
    if code != 0:
        raise RuntimeError("failed to list Desktop tables")
    return [line.strip() for line in out.splitlines() if line.strip()]


def nas_tables(client: paramiko.SSHClient) -> set[str]:
    only = os.environ.get("ONLY_TABLES", "").strip()
    if only:
        wanted = {t.strip() for t in only.split(",") if t.strip()}
        code, out = run_ssh(
            client,
            f"{NAS_DOCKER} exec {NAS_DB} psql -U postgres -d postgres -t -A -c "
            "\"SELECT tablename FROM pg_tables WHERE schemaname='public' "
            "ORDER BY tablename;\"",
        )
        if code != 0:
            raise RuntimeError("failed to list NAS tables")
        return {line.strip() for line in out.splitlines() if line.strip() in wanted}
    code, out = run_ssh(
        client,
        f"{NAS_DOCKER} exec {NAS_DB} psql -U postgres -d postgres -t -A -c "
        "\"SELECT tablename FROM pg_tables WHERE schemaname='public' "
        "AND (tablename LIKE 'denizen%' OR tablename IN ('intake_forms')) "
        "ORDER BY tablename;\"",
    )
    if code != 0:
        raise RuntimeError("failed to list NAS tables")
    return {line.strip() for line in out.splitlines() if line.strip()}


def desktop_count(table: str) -> int:
    _, out = run_local(
        [
            "docker",
            "exec",
            DESKTOP_DB,
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-t",
            "-A",
            "-c",
            f"SELECT count(*) FROM public.{table};",
        ]
    )
    return int(out.strip() or "0")


def desktop_columns(table: str) -> list[str]:
    _, out = run_local(
        [
            "docker",
            "exec",
            DESKTOP_DB,
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-t",
            "-A",
            "-c",
            "SELECT column_name FROM information_schema.columns "
            f"WHERE table_schema='public' AND table_name='{table}' "
            "ORDER BY ordinal_position;",
        ]
    )
    return [line.strip() for line in out.splitlines() if line.strip()]


def nas_columns(client: paramiko.SSHClient, table: str) -> list[str]:
    _, out = run_ssh(
        client,
        f"{NAS_DOCKER} exec {NAS_DB} psql -U postgres -d postgres -t -A -c "
        "\"SELECT column_name FROM information_schema.columns "
        f"WHERE table_schema='public' AND table_name='{table}' "
        "ORDER BY ordinal_position;\"",
    )
    return [line.strip() for line in out.splitlines() if line.strip()]


def nas_count(client: paramiko.SSHClient, table: str) -> int:
    _, out = run_ssh(
        client,
        f"{NAS_DOCKER} exec {NAS_DB} psql -U postgres -d postgres -t -A -c "
        f"\"SELECT count(*) FROM public.{table};\"",
    )
    return int(out.strip() or "0")


def dump_table_csv(table: str, columns: list[str], dest: Path) -> None:
    col_list = ", ".join(f'"{c}"' for c in columns)
    proc = subprocess.run(
        [
            "docker",
            "exec",
            DESKTOP_DB,
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-c",
            f"COPY (SELECT {col_list} FROM public.{table}) TO STDOUT WITH (FORMAT csv, HEADER true)",
        ],
        capture_output=True,
        timeout=600,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"csv dump failed for {table}: {(proc.stderr or b'').decode()}"
        )
    dest.write_bytes(proc.stdout)


def dump_table(table: str, dest: Path) -> None:
    proc = subprocess.run(
        [
            "docker",
            "exec",
            DESKTOP_DB,
            "pg_dump",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "--data-only",
            "--no-owner",
            "--no-privileges",
            "--column-inserts",
            "--rows-per-insert",
            "200",
            "--table",
            f"public.{table}",
        ],
        capture_output=True,
        timeout=600,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"pg_dump failed for {table}: {(proc.stderr or b'').decode()}"
        )
    lines = []
    for line in proc.stdout.decode("utf-8", errors="replace").splitlines():
        if line.startswith("\\restrict") or line.startswith("\\unrestrict"):
            continue
        if "transaction_timeout" in line:
            continue
        lines.append(line)
    sql = "\n".join(lines).strip()
    if sql:
        sql += "\n"
    dest.write_text(sql, encoding="utf-8")


def upload_bytes(client: paramiko.SSHClient, remote_path: str, data: bytes) -> None:
    stdin, stdout, stderr = client.exec_command(f"cat > {remote_path}", timeout=600)
    stdin.write(data)
    stdin.flush()
    stdin.channel.shutdown_write()
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(f"upload failed for {remote_path}: {err}")


def restore_table_sql(client: paramiko.SSHClient, dump_path: Path) -> tuple[int, str]:
    body = dump_path.read_text(encoding="utf-8").strip()
    if not body:
        return 0, ""
    sql = (
        "SET session_replication_role = replica;\n"
        f"{body}\n"
        "SET session_replication_role = DEFAULT;\n"
    ).encode("utf-8")
    stdin, stdout, stderr = client.exec_command(
        f"{NAS_DOCKER} exec -i {NAS_DB} psql -v ON_ERROR_STOP=1 -U postgres -d postgres",
        timeout=600,
    )
    stdin.write(sql)
    stdin.flush()
    stdin.channel.shutdown_write()
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out


def restore_table_csv(
    client: paramiko.SSHClient, table: str, columns: list[str], dump_path: Path
) -> tuple[int, str]:
    data = dump_path.read_bytes().rstrip(b"\r\n")
    if not data:
        return 0, ""
    col_list = ", ".join(f'"{c}"' for c in columns)
    header = (
        "SET session_replication_role = replica;\n"
        f"COPY public.{table} ({col_list}) FROM STDIN WITH (FORMAT csv, HEADER true);\n"
    ).encode("utf-8")
    footer = b"\n\\.\nSET session_replication_role = DEFAULT;\n"
    stdin, stdout, stderr = client.exec_command(
        f"{NAS_DOCKER} exec -i {NAS_DB} psql -v ON_ERROR_STOP=1 -U postgres -d postgres",
        timeout=600,
    )
    stdin.write(header + data + footer)
    stdin.flush()
    stdin.channel.shutdown_write()
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out


def main() -> int:
    if not NAS_PASSWORD:
        print("Set SYNO_SSH_PASSWORD", file=sys.stderr)
        return 1

    desktop = desktop_tables()
    print(f"Desktop tables: {len(desktop)}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        NAS_HOST,
        username=NAS_USER,
        password=NAS_PASSWORD,
        look_for_keys=False,
        allow_agent=False,
    )

    nas = nas_tables(client)
    shared = [t for t in desktop if t in nas]
    priority = [
        "denizen_organizations",
        "denizen_schema_migrations",
        "denizen_npcs",
        "denizen_office_sessions",
        "denizen_visitor_sessions",
        "denizen_org_members",
        "denizen_entity_registry",
        "denizen_user_assistants",
    ]
    shared.sort(key=lambda t: (priority.index(t) if t in priority else 999, t))
    skipped = [t for t in desktop if t not in nas]
    print(f"NAS tables: {len(nas)}")
    print(f"Shared tables to migrate: {len(shared)}")
    if skipped:
        print("Skipping tables missing on NAS:", ", ".join(skipped))

    if not shared:
        print("Nothing to migrate", file=sys.stderr)
        client.close()
        return 1

    skip_truncate = os.environ.get("SKIP_TRUNCATE", "").strip().lower() in ("1", "true", "yes")

    if not skip_truncate:
        print("\n=== Before counts (top tables) ===")
    for table in shared:
        d = desktop_count(table)
        n = nas_count(client, table)
        if d or n:
            print(f"  {table}: desktop={d} nas={n}")

    if not skip_truncate:
        truncate_sql = (
            "SET session_replication_role = replica;\n"
            + "\n".join(f"TRUNCATE TABLE public.{t} CASCADE;" for t in shared)
            + "\nSET session_replication_role = DEFAULT;\n"
        )
        print("\n=== Truncate NAS target tables ===")
        stdin, stdout, stderr = client.exec_command(
            f"{NAS_DOCKER} exec -i {NAS_DB} psql -v ON_ERROR_STOP=1 -U postgres -d postgres",
            timeout=300,
        )
        stdin.write(truncate_sql.encode("utf-8"))
        stdin.flush()
        stdin.channel.shutdown_write()
        out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip())
        if code != 0:
            client.close()
            return code

    tmpdir = Path(tempfile.mkdtemp(prefix="denizen-migrate-"))
    print(f"\n=== Dump + restore {len(shared)} tables ===")
    try:
        for i, table in enumerate(shared, 1):
            print(f"\n[{i}/{len(shared)}] {table}")
            dcols = desktop_columns(table)
            ncols = nas_columns(client, table)
            common = [c for c in dcols if c in ncols]
            use_csv = dcols != ncols
            if use_csv:
                print(f"  schema diff — csv copy with {len(common)} shared columns")

            if use_csv:
                dump_path = tmpdir / f"{table}.csv"
                dump_table_csv(table, common, dump_path)
                if not dump_path.read_bytes().strip():
                    print("  (empty dump, skip)")
                    continue
                code, out = restore_table_csv(client, table, common, dump_path)
            else:
                dump_path = tmpdir / f"{table}.sql"
                dump_table(table, dump_path)
                if not dump_path.read_text(encoding="utf-8").strip():
                    print("  (empty dump, skip)")
                    continue
                code, out = restore_table_sql(client, dump_path)
            if out.strip():
                print(out.rstrip()[-1500:])
            if code != 0 and "warning: errors ignored on restore" not in out.lower():
                print(f"FAILED restoring {table}", file=sys.stderr)
                client.close()
                return code

            d = desktop_count(table)
            n = nas_count(client, table)
            print(f"  restored: desktop={d} nas={n}")
            if d != n:
                print(f"  WARNING row count mismatch on {table}", file=sys.stderr)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print("\n=== After migration summary ===")
    mismatches = 0
    total_rows = 0
    for table in shared:
        d = desktop_count(table)
        n = nas_count(client, table)
        total_rows += n
        if d != n:
            mismatches += 1
            print(f"  MISMATCH {table}: desktop={d} nas={n}")
    print(f"Migrated rows across shared tables: {total_rows}")
    print(f"Mismatches: {mismatches}")
    if skipped:
        print("Not migrated (missing on NAS):", ", ".join(skipped))

    client.close()
    return 0 if mismatches == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
