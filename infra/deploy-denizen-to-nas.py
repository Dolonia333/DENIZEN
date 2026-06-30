#!/usr/bin/env python3

"""Build Denizen production image and deploy to Synology NAS.



Local build (Docker Desktop):

  py infra/deploy-denizen-to-nas.py



Remote build on NAS (no local Docker):

  py infra/deploy-denizen-to-nas.py --remote-build

"""



from __future__ import annotations



import load_infra_env  # noqa: F401



import argparse
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path



import paramiko



HOST = os.environ.get("SYNO_HOST", "192.168.1.237")

USER = os.environ.get("SYNO_USER", "admin")

PASSWORD = os.environ.get("SYNO_SSH_PASSWORD", "")

REMOTE_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server").replace("\\", "/")

DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

IMAGE = os.environ.get("DENIZEN_DOCKER_IMAGE", "denizen-server:latest")

SKIP_BUILD = os.environ.get("SKIP_DOCKER_BUILD", "").strip() in ("1", "true", "yes")

REMOTE_BUILD_ENV = os.environ.get("SYNO_REMOTE_BUILD", "").strip() in ("1", "true", "yes")



ROOT = Path(__file__).resolve().parent.parent

DENIZEN_DIR = ROOT / "denizen"

BUNDLE_ENV = ROOT / "infra" / "nas-server-bundle" / ".env"

COMPOSE_FILE = DENIZEN_DIR / "docker-compose.production.yml"

CHUNK = 1024 * 512

SOURCE_SKIP_DIRS = {
    "node_modules",
    ".git",
    "reports",
    "__pycache__",
    ".cursor",
    "desktop",
    ".npc-worktrees",
    "mcp-ui-inspect",
    "out",
}





def log(msg: str) -> None:

    print(msg, flush=True)





def run_local(cmd: list[str], *, cwd: Path | None = None) -> None:

    log(f"$ {' '.join(cmd)}")

    proc = subprocess.run(cmd, cwd=str(cwd or ROOT), env=os.environ.copy())

    if proc.returncode != 0:

        raise SystemExit(proc.returncode)





def run_ssh(client: paramiko.SSHClient, cmd: str, timeout: int = 3600) -> tuple[int, str]:

    log(f"$ {cmd}")

    _stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)

    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace")

    code = stdout.channel.recv_exit_status()

    if out.strip():

        try:

            print(out.rstrip())

        except UnicodeEncodeError:

            print(out.rstrip().encode("ascii", errors="replace").decode("ascii"))

    return code, out





def stream_to_remote(client: paramiko.SSHClient, local_path: Path, remote_path: str, *, timeout: int = 7200) -> int:

    """Pipe a local file over SSH stdin — works when Synology SFTP is restricted."""

    parent = remote_path.rsplit("/", 1)[0]

    run_ssh(client, f"mkdir -p '{parent}'")

    cmd = f"cat > '{remote_path}'"

    log(f"Streaming {local_path.name} ({local_path.stat().st_size // (1024 * 1024)} MB) -> {remote_path}")

    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)

    with open(local_path, "rb") as fh:

        while True:

            chunk = fh.read(CHUNK)

            if not chunk:

                break

            stdin.write(chunk)

    stdin.flush()

    stdin.channel.shutdown_write()

    err = stderr.read().decode("utf-8", errors="replace")

    code = stdout.channel.recv_exit_status()

    if err.strip():

        print(err.rstrip(), file=sys.stderr)

    return code





def docker_daemon_available() -> bool:

    if not shutil.which("docker"):

        return False

    proc = subprocess.run(

        ["docker", "info"],

        capture_output=True,

        text=True,

    )

    return proc.returncode == 0





def build_image_local() -> None:

    if not shutil.which("docker"):

        log("ERROR: docker not found — use --remote-build or install Docker Desktop")

        raise SystemExit(1)

    run_local(

        ["docker", "build", "-f", "Dockerfile.production", "-t", IMAGE, "."],

        cwd=DENIZEN_DIR,

    )





def save_image(tmp_dir: Path) -> Path:

    tar_path = tmp_dir / "denizen-server-image.tar"

    run_local(["docker", "save", "-o", str(tar_path), IMAGE])

    return tar_path





def image_exists_locally() -> bool:

    if not shutil.which("docker"):

        return False

    proc = subprocess.run(

        ["docker", "image", "inspect", IMAGE],

        capture_output=True,

        text=True,

    )

    return proc.returncode == 0





def _tar_filter(tarinfo: tarfile.TarInfo) -> tarfile.TarInfo | None:

    parts = Path(tarinfo.name).parts

    if any(part in SOURCE_SKIP_DIRS - {"reports"} for part in parts):
        return None

    if "reports" in parts:
        try:
            idx = parts.index("reports")
            if idx + 1 < len(parts) and parts[idx + 1] == "dossiers":
                return tarinfo
        except ValueError:
            pass
        return None

    return tarinfo





def pack_denizen_source(tmp_dir: Path) -> Path:

    tar_path = tmp_dir / "denizen-src.tar.gz"

    log(f"==> Packing Denizen source ({DENIZEN_DIR})")

    dossiers_dir = DENIZEN_DIR / "reports" / "dossiers"

    with tarfile.open(tar_path, "w:gz") as tar:

        tar.add(DENIZEN_DIR, arcname="denizen", filter=_tar_filter)

        if dossiers_dir.is_dir():
            n = sum(1 for _ in dossiers_dir.rglob("*") if _.is_file())
            log(f"    Including {n} dossier artifact file(s) from reports/dossiers")
            tar.add(dossiers_dir, arcname="denizen/reports/dossiers")

    log(f"    Source tarball: {tar_path.stat().st_size // (1024 * 1024)} MB")

    return tar_path





def deploy_compose(client: paramiko.SSHClient) -> int:

    run_ssh(client, f"{DOCKER} rm -f denizen-server 2>/dev/null || true")

    code, _ = run_ssh(

        client,

        f"cd '{REMOTE_DIR}' && {DOCKER} compose -f docker-compose.yml up -d",

        timeout=300,

    )

    if code != 0:

        return code



    port = os.environ.get("SYNO_DENIZEN_PORT", "8888")

    run_ssh(

        client,

        f"sleep 8 && curl -fsS -m 15 http://127.0.0.1:{port}/api/health | head -c 500 || echo HEALTH_FAIL",

    )

    run_ssh(

        client,

        f"{DOCKER} ps --filter name=denizen-server --format '{{{{.Names}}}}\t{{{{.Status}}}}'",

    )

    run_ssh(client, f"{DOCKER} logs --tail 20 denizen-server 2>&1")

    return 0





def deploy_remote_build(client: paramiko.SSHClient, src_tar: Path) -> int:
    build_dir = f"{REMOTE_DIR}/build-{int(time.time())}"
    if stream_to_remote(client, src_tar, f"{REMOTE_DIR}/denizen-src.tar.gz") != 0:
        log("ERROR: source upload failed")
        return 1
    if stream_to_remote(client, BUNDLE_ENV, f"{REMOTE_DIR}/.env", timeout=120) != 0:
        log("ERROR: .env upload failed")
        return 1
    if stream_to_remote(client, COMPOSE_FILE, f"{REMOTE_DIR}/docker-compose.yml", timeout=120) != 0:
        log("ERROR: compose upload failed")
        return 1

    code, _ = run_ssh(
        client,
        f"mkdir -p '{build_dir}' "
        f"&& tar xzf '{REMOTE_DIR}/denizen-src.tar.gz' -C '{build_dir}'",
        timeout=600,
    )
    if code != 0:
        return code

    log("==> Building image on NAS (CRM + app — may take several minutes)")

    code, _ = run_ssh(

        client,

        f"cd '{build_dir}/denizen' && {DOCKER} build -f Dockerfile.production -t {IMAGE} .",

        timeout=7200,

    )

    if code != 0:

        return code

    return deploy_compose(client)





def deploy_local_image(client: paramiko.SSHClient, image_tar: Path) -> int:

    if stream_to_remote(client, image_tar, f"{REMOTE_DIR}/denizen-server-image.tar") != 0:

        log("ERROR: image upload failed")

        return 1

    if stream_to_remote(client, BUNDLE_ENV, f"{REMOTE_DIR}/.env", timeout=120) != 0:

        log("ERROR: .env upload failed")

        return 1

    if stream_to_remote(client, COMPOSE_FILE, f"{REMOTE_DIR}/docker-compose.yml", timeout=120) != 0:

        log("ERROR: compose upload failed")

        return 1



    code, _ = run_ssh(

        client,

        f"cd '{REMOTE_DIR}' && {DOCKER} load -i denizen-server-image.tar",

        timeout=3600,

    )

    if code != 0:

        return code

    return deploy_compose(client)





def parse_args() -> argparse.Namespace:

    parser = argparse.ArgumentParser(description="Deploy Denizen to Synology NAS")

    parser.add_argument(

        "--remote-build",

        action="store_true",

        help="Build Docker image on NAS (no local Docker Desktop required)",

    )

    return parser.parse_args()





def main() -> int:

    args = parse_args()

    remote_build = args.remote_build or REMOTE_BUILD_ENV



    if not PASSWORD:

        log("ERROR: set SYNO_SSH_PASSWORD in infra/.env")

        return 1

    if not BUNDLE_ENV.is_file():

        log("ERROR: run py infra/provision-nas-server.py first")

        return 1

    if not COMPOSE_FILE.is_file():

        log(f"ERROR: missing {COMPOSE_FILE}")

        return 1



    use_remote = remote_build

    if not use_remote and not SKIP_BUILD:

        if not docker_daemon_available():

            log("==> Local Docker daemon unavailable — falling back to remote NAS build")

            use_remote = True



    with tempfile.TemporaryDirectory() as tmp:

        tmp_dir = Path(tmp)



        client = paramiko.SSHClient()

        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        log(f"==> Connecting to {USER}@{HOST}")

        client.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)

        run_ssh(client, f"mkdir -p '{REMOTE_DIR}'")



        if use_remote:

            if SKIP_BUILD:

                log("WARN: SKIP_DOCKER_BUILD ignored for remote build")

            src_tar = pack_denizen_source(tmp_dir)

            code = deploy_remote_build(client, src_tar)

        else:

            if SKIP_BUILD and image_exists_locally():

                log("==> SKIP_DOCKER_BUILD set — using existing local image")

            else:

                log("==> Building Denizen production Docker image locally (includes CRM build)")

                build_image_local()

            image_tar = save_image(tmp_dir)

            code = deploy_local_image(client, image_tar)



        client.close()

        if code != 0:

            return code



    log("==> Denizen server deploy complete")

    log(f"    LAN:  http://{HOST}:{os.environ.get('SYNO_DENIZEN_PORT', '8888')}/api/health")

    log("    Image is baked in — compose recreate no longer needs hotfix.")

    log("    Then: py infra/repoint-mesh-to-nas.py && py infra/probe-denizen-nas.py")

    return 0





if __name__ == "__main__":

    raise SystemExit(main())

