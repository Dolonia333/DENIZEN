#!/usr/bin/env python3
"""Quick redeploy: desktop folder only, rebuild AppImage on laptop."""
import os, tarfile, tempfile, paramiko

HOST, USER, PASS = '100.110.205.49', 'dolo', '333'
LOCAL_DESKTOP = r'c:\Users\zionv\OneDrive\Desktop\multbot\denizen\desktop'
REMOTE = '/home/dolo/denizen-deploy/desktop'
INSTALL = '/home/dolo/Applications/Denizen.AppImage'
SKIP = {'node_modules', 'dist-build', 'dist-build-v012'}

def pack():
    fd, path = tempfile.mkstemp(suffix='.tar.gz'); os.close(fd)
    with tarfile.open(path, 'w:gz') as tar:
        for dp, dns, fns in os.walk(LOCAL_DESKTOP):
            dns[:] = [d for d in dns if d not in SKIP]
            for fn in fns:
                full = os.path.join(dp, fn)
                tar.add(full, arcname=os.path.relpath(full, LOCAL_DESKTOP))
    return path

ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd, t=900):
    print('$', cmd[:120])
    _, o, e = ssh.exec_command(cmd, timeout=t)
    out, err = o.read().decode(), e.read().decode()
    code = o.channel.recv_exit_status()
    if out.strip(): print(out.rstrip())
    if err.strip(): print('stderr:', err.rstrip()[:500])
    print('exit', code); return code

run('pkill -f Denizen.AppImage 2>/dev/null || true; sleep 2')
tar = pack()
run(f'mkdir -p {REMOTE}')
sftp = ssh.open_sftp(); sftp.put(tar, f'{REMOTE}/desktop-src.tar.gz'); sftp.close(); os.remove(tar)
code = run(f'''
set -e
cd {REMOTE}
find . -mindepth 1 -maxdepth 1 ! -name desktop-src.tar.gz -exec rm -rf {{}} +
tar xzf desktop-src.tar.gz && rm desktop-src.tar.gz
npm install
npm run build:linux
cp -f dist-build/Denizen.AppImage {INSTALL}
chmod +x {INSTALL}
ls -lh {INSTALL}
''')
if code != 0:
    ssh.close(); raise SystemExit(1)

run(f'''export WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus DISPLAY=:0
AUTH=$(ls /run/user/1000/.mutter-Xwaylandauth.* 2>/dev/null | head -1); [ -n "$AUTH" ] && export XAUTHORITY="$AUTH"
rm -f /tmp/denizen-launch.log
nohup {INSTALL} --ozone-platform=wayland --no-sandbox >/tmp/denizen-launch.log 2>&1 &
sleep 5
pgrep -a -f Denizen.AppImage | grep -v zsh || true
tail -15 /tmp/denizen-launch.log
''', t=60)
run('rm -rf /home/dolo/denizen-deploy')
ssh.close()
print('Redeploy complete.')
