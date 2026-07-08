#!/usr/bin/env python3
import paramiko
HOST, USER, PASS = '100.110.205.49', 'dolo', '333'
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy()); ssh.connect(HOST,username=USER,password=PASS,timeout=20)
cmd = 'pkill -f Denizen.AppImage 2>/dev/null || true; sleep 2; rm -rf ~/.cache/denizen-desktop-updater ~/.config/Denizen; echo cleared'
_,o,_=ssh.exec_command(cmd,timeout=30); print(o.read().decode()); ssh.close()
