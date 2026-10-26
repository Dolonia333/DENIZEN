#!/usr/bin/env python3
"""Mirror Denizen Desktop installers from GitHub Releases onto the NAS for /desktop/releases/."""
from __future__ import annotations

from hostcfg import get_host
import os
import sys
import urllib.request
from pathlib import Path

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent
sys.path.insert(0, str(INFRA))
import load_infra_env  # noqa: F401

import paramiko

HOST = get_host("SYNO_HOST")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
RELEASE_BASE = os.environ.get(
    "DENIZEN_DESKTOP_RELEASE_BASE",
    "https://github.com/Dolonia333/DENIZEN/releases/download/v0.1.4",
).rstrip("/")
FILES = [
    "Denizen-Setup.exe",
    "Denizen.dmg",
    "Denizen.AppImage",
]
REMOTE_RELEASES = "/volume1/docker/denizen-server/releases"
CONTAINER_RELEASES = "/app/desktop/releases"


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    print("$", cmd[:160])
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out


def main() -> int:
    if not PWD:
        print("SYNO_SSH_PASSWORD required", file=sys.stderr)
        return 1

    local_dir = ROOT / "denizen" / "desktop" / "releases"
    local_dir.mkdir(parents=True, exist_ok=True)

    for name in FILES:
        url = f"{RELEASE_BASE}/{name}"
        dest = local_dir / name
        print(f"Downloading {name}...")
        try:
            with urllib.request.urlopen(url, timeout=600) as resp:
                dest.write_bytes(resp.read())
            print(f"  saved {dest} ({dest.stat().st_size} bytes)")
        except Exception as err:
            print(f"  skip {name}: {err}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)

    run(client, f"mkdir -p '{REMOTE_RELEASES}' /volume1/docker/denizen-server/desktop/releases")
    # Also place on host bind-mount path used by docker-compose.production.yml
    download_src = ROOT / "denizen" / "desktop" / "download.html"
    if download_src.is_file():
        stdin, stdout, _ = client.exec_command(
            f"cat > '/volume1/docker/denizen-server/desktop/download.html'", timeout=60
        )
        stdin.write(download_src.read_bytes())
        stdin.flush()
        stdin.channel.shutdown_write()
        stdout.channel.recv_exit_status()

    for name in FILES:
        local = local_dir / name
        if not local.is_file():
            continue
        data = local.read_bytes()
        for dest_dir in (REMOTE_RELEASES, "/volume1/docker/denizen-server/desktop/releases"):
            print(f"Uploading {name} -> {dest_dir}...")
            stdin, stdout, _ = client.exec_command(f"cat > '{dest_dir}/{name}'", timeout=900)
            stdin.write(data)
            stdin.flush()
            stdin.channel.shutdown_write()
            stdout.channel.recv_exit_status()

    run(client, f"ls -lh '{REMOTE_RELEASES}' /volume1/docker/denizen-server/desktop/releases 2>/dev/null || true")

    env_patch = """
import pathlib,re
p=pathlib.Path('/volume1/docker/denizen-server/.env')
text=p.read_text(encoding='utf-8') if p.exists() else ''
vals={{
  'DENIZEN_PUBLIC_URL': 'https://denizen.dolonia.cloud',
  'DENIZEN_DESKTOP_MIRROR_BASE': 'https://denizen.dolonia.cloud/desktop/releases',
  'DENIZEN_WINDOWS_DESKTOP_URL': 'https://denizen.dolonia.cloud/desktop/releases/Denizen-Setup.exe',
  'DENIZEN_MACOS_DESKTOP_URL': 'https://denizen.dolonia.cloud/desktop/releases/Denizen.dmg',
  'DENIZEN_LINUX_DESKTOP_URL': 'https://denizen.dolonia.cloud/desktop/releases/Denizen.AppImage',
}}
for key,val in vals.items():
    if re.search(r'^'+key+r'=', text, re.M):
        text=re.sub(r'^'+key+r'=.*$', key+'='+val, text, flags=re.M)
    else:
        text=(text.rstrip()+'\\n'+key+'='+val+'\\n') if text else (key+'='+val+'\\n')
p.write_text(text, encoding='utf-8')
print('patched', p)
"""
    stdin, stdout, _ = client.exec_command("python3 -", timeout=60)
    stdin.write(env_patch.encode())
    stdin.flush()
    stdin.channel.shutdown_write()
    print(stdout.read().decode())

    client.close()
    print("\n==> Desktop installers mirrored to denizen.dolonia.cloud/desktop/releases/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
