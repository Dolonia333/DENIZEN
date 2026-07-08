#!/usr/bin/env python3
import paramiko, json, sys
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("100.110.205.49", username="dolo", password="333", timeout=25)
cmd = sys.stdin.read()
_, o, e = ssh.exec_command(cmd, timeout=120)
out = o.read().decode('utf-8', 'replace')
err = e.read().decode('utf-8', 'replace')
code = o.channel.recv_exit_status()
print(out, end='')
if err.strip():
    print(err, file=sys.stderr, end='')
ssh.close()
sys.exit(code)
