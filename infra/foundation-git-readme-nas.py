#!/usr/bin/env python3
"""
Foundation: git in denizen-server container + seed /app/README.md.
Does NOT fix routing or Alex think-loop — re-run Phase 1 after this.
"""
from __future__ import annotations

from hostcfg import get_host
import hashlib
import os
import sys
from pathlib import Path

INFRA = Path(__file__).resolve().parent
REPO = INFRA.parent
README_LOCAL = REPO / "denizen" / "README.md"
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
README_CONTAINER = "/app/README.md"
REMOTE_TMP = "/tmp/denizen-foundation/README.seed.md"


def stream_file(client, local_path: Path, remote_path: str) -> None:
    parent = remote_path.rsplit("/", 1)[0]
    client.exec_command(f"mkdir -p '{parent}'")
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote_path}'")
    stdin.write(local_path.read_bytes())
    stdin.flush()
    stdin.channel.shutdown_write()
    stdout.channel.recv_exit_status()


def run(client, cmd, timeout=180):
    print("$", cmd[:110], flush=True)
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        try:
            print(out.rstrip())
        except UnicodeEncodeError:
            print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))
    return o.channel.recv_exit_status(), out


def sha16(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def main() -> int:
    if not PASSWORD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1
    if not README_LOCAL.is_file():
        print(f"Missing {README_LOCAL}", file=sys.stderr)
        return 1

    readme_bytes = README_LOCAL.read_bytes()
    if len(readme_bytes) < 100:
        print("Local README too small", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)

    print("==> Foundation: git + README in denizen-server\n")

    # 1. Install git in running container (persists until image rebuild/recreate without commit)
    install_cmd = (
        f"{DOCKER} exec denizen-server sh -c "
        "\"(command -v git >/dev/null 2>&1 || (apt-get update && "
        "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git)) "
        "&& git --version\""
    )
    code, out = run(client, install_cmd, timeout=300)
    if code != 0 or "git version" not in out.lower():
        print("FAIL: git install", file=sys.stderr)
        client.close()
        return 1

    # 2. Seed README (stream to NAS host, then docker cp into container)
    stream_file(client, README_LOCAL, REMOTE_TMP)
    code, _ = run(client, f"{DOCKER} cp {REMOTE_TMP} denizen-server:{README_CONTAINER}", timeout=60)
    run(client, f"rm -f {REMOTE_TMP}", timeout=15)
    if code != 0:
        print("FAIL: docker cp README", file=sys.stderr)
        client.close()
        return 1

    _, readme_out = run(
        client,
        f"{DOCKER} exec denizen-server sh -c 'wc -c {README_CONTAINER} && head -3 {README_CONTAINER}'",
        timeout=30,
    )
    first_line = readme_out.splitlines()[0] if readme_out.strip() else ""
    if not first_line or first_line.startswith("0 "):
        print("FAIL: README still empty", file=sys.stderr)
        client.close()
        return 1

    # 3. Minimal git repo so worktree add works (required for coding-agent worktree)
    init_cmd = (
        f"{DOCKER} exec denizen-server sh -c "
        "\"cd /app && "
        "git config user.email denizen@dolonia.local 2>/dev/null || git config --global user.email denizen@dolonia.local; "
        "git config user.name Denizen 2>/dev/null || git config --global user.name Denizen; "
        "if [ ! -d .git ]; then git init -b main && git add README.md && git commit -m 'NAS README baseline'; "
        "elif ! git rev-parse HEAD >/dev/null 2>&1; then git add README.md && git commit -m 'NAS README baseline'; "
        "else git add README.md && git diff --cached --quiet || git commit -m 'Seed README'; fi "
        "&& git rev-parse --is-inside-work-tree && git log -1 --oneline\""
    )
    code, git_out = run(client, init_cmd, timeout=120)
    if code != 0:
        print("FAIL: git init/commit", file=sys.stderr)
        client.close()
        return 1

    _, hash_out = run(
        client,
        f"{DOCKER} exec denizen-server sh -c 'sha256sum {README_CONTAINER} | cut -c1-16'",
        timeout=30,
    )
    container_hash = hash_out.strip().split()[0] if hash_out.strip() else ""
    empty_hash = sha16("")

    print("\n--- verify ---")
    print(f"git:    {out.strip().splitlines()[-1] if out.strip() else out}")
    print(f"README: {readme_out.splitlines()[0] if readme_out.strip() else '?'}")
    print(f"README hash (container): {container_hash} (empty={empty_hash})")
    print(f"git log:  {git_out.strip().splitlines()[-1] if git_out.strip() else git_out}")

    if container_hash == empty_hash:
        print("FAIL: README hash is empty-file hash", file=sys.stderr)
        client.close()
        return 1

    client.close()
    print("\nOK: foundation ready — re-run: py infra/verify-phase1-abby-alex.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
