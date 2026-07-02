#!/usr/bin/env python3
"""Install Alpine packages so Playwright Chromium can launch in denizen-server."""
import load_infra_env  # noqa: F401
import os
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PWD = os.environ.get("SYNO_SSH_PASSWORD", "")
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")

PKGS = (
    "gcompat glib pango nss harfbuzz freetype ttf-freefont "
    "libx11 libxcomposite libxdamage libxext libxfixes libxrandr "
    "mesa mesa-gbm alsa-lib libxshmfence cups-libs libdrm eudev-libs"
)


def run(c, cmd, timeout=300):
    print("$", cmd[:140])
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    print(out.rstrip()[:4000].encode("ascii", errors="replace").decode())
    return o.channel.recv_exit_status()


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="admin", password=PWD, look_for_keys=False, allow_agent=False)
    run(c, f"{DOCKER} exec denizen-server sh -c 'apk add --no-cache {PKGS} 2>&1'")
    run(
        c,
        f"{DOCKER} exec denizen-server sh -c "
        "'node jelly/vendor/skills/web-search/web-search.mjs --query alpine-probe --headless true 2>&1'",
        120,
    )
    c.close()


if __name__ == "__main__":
    main()
