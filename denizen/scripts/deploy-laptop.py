#!/usr/bin/env python3
"""Deploy Denizen 0.1.5 to HP laptop: clean old installs, build, install, launch."""
import os
import sys
import tarfile
import tempfile
import time
import paramiko
from _laptop_env import connect_kwargs

LOCAL_DENIZEN = r'c:\Users\zionv\OneDrive\Desktop\multbot\denizen'
REMOTE_ROOT = '/home/dolo/denizen-deploy'
REMOTE_DESKTOP = f'{REMOTE_ROOT}/desktop'
APP_IMAGE = f'{REMOTE_DESKTOP}/dist-build/Denizen.AppImage'
INSTALL_PATH = '/home/dolo/Applications/Denizen.AppImage'

SKIP_DIRS = {
    'node_modules', 'dist-build', 'dist-build-v012', 'dist-old', 'dist-review',
    'updates', '.git', 'crm/vendor/node_modules', 'crm/dist', 'reports',
}
SKIP_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}


def should_skip(rel: str) -> bool:
    parts = rel.replace('\\', '/').split('/')
    for p in parts:
        if p in SKIP_DIRS:
            return True
    if parts[-1].endswith(tuple(SKIP_EXTS)) and '/reports/' in rel.replace('\\', '/'):
        return True
    return False


def make_tarball(src_root: str) -> str:
    fd, path = tempfile.mkstemp(suffix='.tar.gz')
    os.close(fd)
    print(f'Packing {src_root} -> {path}')
    with tarfile.open(path, 'w:gz') as tar:
        for dirpath, dirnames, filenames in os.walk(src_root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, src_root)
                if should_skip(rel):
                    continue
                tar.add(full, arcname=rel)
    size_mb = os.path.getsize(path) / (1024 * 1024)
    print(f'Tarball size: {size_mb:.1f} MB')
    return path


def run(ssh, cmd, timeout=600):
    print(f'\n$ {cmd[:200]}')
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print('stderr:', err.rstrip())
    print(f'exit {code}')
    return code, out, err


def main():
    tar_path = make_tarball(LOCAL_DENIZEN)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kw = connect_kwargs()
    print(f"Connecting to {kw['hostname']}...")
    ssh.connect(**kw)

    # --- Clean old installs ---
    cleanup = '''
set -e
echo "=== Stopping Denizen ==="
pkill -f "Denizen.AppImage" 2>/dev/null || true
pkill -f "denizen-desktop" 2>/dev/null || true
sleep 2
pkill -9 -f "Denizen.AppImage" 2>/dev/null || true
pkill -9 -f "denizen-desktop" 2>/dev/null || true

echo "=== Removing old AppImages ==="
rm -f ~/Downloads/Denizen*.AppImage ~/Downloads/Denizen*.exe 2>/dev/null || true
rm -f ~/Applications/Denizen*.AppImage 2>/dev/null || true
rm -rf /tmp/.mount_Denizen* 2>/dev/null || true

echo "=== Clearing incomplete desktop config (fresh pairing) ==="
rm -rf ~/.config/Denizen 2>/dev/null || true

echo "=== Removing old deploy tree ==="
rm -rf ~/denizen-deploy 2>/dev/null || true
mkdir -p ~/denizen-deploy

echo "=== Cleanup done ==="
'''
    code, _, _ = run(ssh, cleanup, timeout=60)
    if code != 0:
        print('Cleanup had issues, continuing...')

    # --- Upload tarball ---
    remote_tar = f'{REMOTE_ROOT}/denizen-src.tar.gz'
    run(ssh, f'mkdir -p {REMOTE_ROOT}', timeout=30)
    print('Uploading source tarball...')
    sftp = ssh.open_sftp()
    sftp.put(tar_path, remote_tar)
    sftp.close()
    os.remove(tar_path)

    # --- Extract and build ---
    build = f'''
set -e
cd {REMOTE_ROOT}
tar xzf denizen-src.tar.gz
rm -f denizen-src.tar.gz
cd desktop
export PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm missing — installing nodejs via apt if available"
  sudo -n apt-get update -qq && sudo -n apt-get install -y nodejs npm 2>/dev/null || true
fi
node -v
npm -v
npm install
npm run build:linux
ls -lh dist-build/Denizen.AppImage
chmod +x dist-build/Denizen.AppImage
mkdir -p ~/Applications
cp -f dist-build/Denizen.AppImage {INSTALL_PATH}
chmod +x {INSTALL_PATH}
echo "Installed to {INSTALL_PATH}"
'''
    code, out, err = run(ssh, build, timeout=900)
    if code != 0:
        print('BUILD FAILED')
        ssh.close()
        sys.exit(1)

    # --- Desktop launcher ---
    launcher = f'''[Desktop Entry]
Name=Denizen
Comment=Denizen Desktop
Exec={INSTALL_PATH} --ozone-platform=wayland --no-sandbox %U
Icon=utilities-terminal
Terminal=false
Type=Application
Categories=Utility;
MimeType=x-scheme-handler/denizen;
StartupWMClass=Denizen
'''
    run(ssh, f"mkdir -p ~/.local/share/applications && cat > ~/.local/share/applications/denizen.desktop << 'EOF'\n{launcher}EOF", timeout=30)
    run(ssh, 'chmod +x ~/.local/share/applications/denizen.desktop', timeout=30)

    # --- Launch ---
    launch = '''
export WAYLAND_DISPLAY=wayland-0
export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
export DISPLAY=:0
AUTH=$(ls /run/user/1000/.mutter-Xwaylandauth.* 2>/dev/null | head -1)
if [ -n "$AUTH" ]; then export XAUTHORITY="$AUTH"; fi
nohup ~/Applications/Denizen.AppImage --ozone-platform=wayland --no-sandbox >/tmp/denizen-launch.log 2>&1 &
sleep 4
pgrep -a -f Denizen.AppImage || echo "launch failed"
curl -sS -m 3 http://127.0.0.1:8081/api/health 2>&1 | head -c 300 || echo "server not up yet"
'''
    run(ssh, launch, timeout=60)

    ssh.close()
    print('\nDone — Denizen 0.1.5 deployed to laptop.')


if __name__ == '__main__':
    main()
