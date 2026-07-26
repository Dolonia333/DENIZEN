#!/usr/bin/env python3
"""Install the master->NAS auto-deploy loop (GitOps-lite, pull-based).

What it does on the NAS (192.168.1.237):
  1. Verifies /volume1/docker/denizen-server/.env.production and
     docker-compose.yml exist (aborts if not — never creates env).
  2. Creates /volume1/docker/denizen-repo for the git clone.
  3. Generates a read-only SSH deploy key at
     /volume1/docker/denizen-server/deploy-key (if missing) and PRINTS the
     public key — add it to GitHub: repo Settings -> Deploy keys (read-only),
     or `gh repo deploy-key add` from the dev PC.
  4. Uploads infra/nas-auto-deploy-loop.sh to the deploy dir.
  5. Starts the denizen-deployer container (docker:27-cli, --network host,
     docker.sock mounted, restart unless-stopped). It polls origin/master
     every POLL_SECONDS and rebuilds+recreates denizen-server on new commits.

Flags:
  --mark-current-deployed   seed .deployed-sha with origin/master's current
                            SHA so the FIRST tick does NOT redeploy (use when
                            live is already known to match master)
  --poll N                  poll seconds (default 300)

IMPORTANT: run `py -3.12 infra/probe-container-drift.py` FIRST. The first
auto-deploy rebuilds from git and will wipe any docker-cp hotfix that never
made it into a commit.
"""

from __future__ import annotations
import os
import sys
import time

import load_infra_env  # noqa: F401
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PW = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
DEPLOY_DIR = os.environ.get("SYNO_DENIZEN_DIR", "/volume1/docker/denizen-server")
REPO_DIR = os.environ.get("SYNO_DENIZEN_REPO_DIR", "/volume1/docker/denizen-repo")
REPO_URL = os.environ.get("DENIZEN_GIT_URL", "git@github.com:Dolonia333/DENIZEN.git")
BRANCH = os.environ.get("DENIZEN_GIT_BRANCH", "master")
PORT = os.environ.get("SYNO_DENIZEN_PORT", "8888")
DEPLOYER_IMAGE = os.environ.get("DENIZEN_DEPLOYER_IMAGE", "docker:27-cli")
LOOP_SRC = os.path.join(os.path.dirname(__file__), "nas-auto-deploy-loop.sh")


def run(client, cmd, timeout=300):
    _, o, e = client.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    return o.channel.recv_exit_status(), out


def main() -> int:
    if not PW:
        print("ERROR: SYNO_SSH_PASSWORD required (infra/.env or shell env)")
        return 1

    mark_current = "--mark-current-deployed" in sys.argv
    poll = "300"
    if "--poll" in sys.argv:
        poll = sys.argv[sys.argv.index("--poll") + 1]

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PW,
                   look_for_keys=False, allow_agent=False)

    # 1. sanity: live config must already exist
    code, _ = run(client, f"test -f {DEPLOY_DIR}/.env.production")
    if code != 0:
        print(f"ABORT: {DEPLOY_DIR}/.env.production missing on NAS")
        return 1
    code, _ = run(client, f"test -f {DEPLOY_DIR}/docker-compose.yml")
    if code != 0:
        print(f"ABORT: {DEPLOY_DIR}/docker-compose.yml missing on NAS "
              f"(run deploy-denizen-to-nas.py once first)")
        return 1

    # 2. repo dir
    run(client, f"mkdir -p {REPO_DIR}")

    # 3. deploy key (generate once, print pubkey)
    code, _ = run(client, f"test -f {DEPLOY_DIR}/deploy-key")
    if code != 0:
        print("generating deploy key on NAS ...")
        code, out = run(client,
                        f"ssh-keygen -t ed25519 -N '' -C denizen-nas-auto-deploy "
                        f"-f {DEPLOY_DIR}/deploy-key && chmod 600 {DEPLOY_DIR}/deploy-key")
        if code != 0:
            print("ssh-keygen failed:", out)
            return 1
    _, pub = run(client, f"cat {DEPLOY_DIR}/deploy-key.pub")
    print("\n=== DEPLOY PUBLIC KEY (add to GitHub as READ-ONLY deploy key) ===")
    print(pub.strip())
    print("=== e.g.: gh repo deploy-key add <file> --title denizen-nas-auto-deploy ===\n")

    # 4. upload loop script
    sftp = client.open_sftp()
    sftp.put(LOOP_SRC, f"{DEPLOY_DIR}/auto-deploy-loop.sh")
    sftp.close()
    run(client, f"chmod +x {DEPLOY_DIR}/auto-deploy-loop.sh "
                f"&& sed -i 's/\\r$//' {DEPLOY_DIR}/auto-deploy-loop.sh")

    # 5. optionally mark current master as already deployed
    if mark_current:
        code, out = run(client,
                        f"GIT_SSH_COMMAND=\"ssh -i {DEPLOY_DIR}/deploy-key "
                        f"-o StrictHostKeyChecking=accept-new\" "
                        f"git ls-remote {REPO_URL} refs/heads/{BRANCH} | cut -f1")
        sha = out.strip().splitlines()[-1].strip() if out.strip() else ""
        if code == 0 and len(sha) == 40:
            run(client, f"echo {sha} > {DEPLOY_DIR}/.deployed-sha")
            print(f"seeded .deployed-sha = {sha} (first tick will NOT redeploy)")
        else:
            print("WARN: could not resolve remote SHA (key not on GitHub yet?) "
                  "— first tick WILL deploy")

    # 6. (re)start the deployer container
    run(client, f"{DOCKER} rm -f denizen-deployer 2>/dev/null")
    cmd = (
        f"{DOCKER} run -d --name denizen-deployer --restart unless-stopped "
        f"--network host "
        f"-v /var/run/docker.sock:/var/run/docker.sock "
        f"-v {REPO_DIR}:/repo "
        f"-v {DEPLOY_DIR}:/deploy "
        f"-e REPO_URL='{REPO_URL}' -e BRANCH='{BRANCH}' "
        f"-e POLL_SECONDS='{poll}' -e HEALTH_PORT='{PORT}' "
        f"--entrypoint /bin/sh {DEPLOYER_IMAGE} /deploy/auto-deploy-loop.sh"
    )
    code, out = run(client, cmd, timeout=600)
    if code != 0:
        print("deployer start failed:", out)
        return 1
    print("denizen-deployer started:", out.strip()[:20])

    time.sleep(8)
    _, logs = run(client, f"{DOCKER} logs --tail 10 denizen-deployer 2>&1")
    print("--- deployer log ---")
    print(logs)
    client.close()
    print("Done. Watch: docker logs -f denizen-deployer  |  state: "
          f"{DEPLOY_DIR}/.deployed-sha, auto-deploy.log, last-build.log")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
