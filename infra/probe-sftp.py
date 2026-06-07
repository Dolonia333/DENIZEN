import os
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "192.168.1.237",
    username="admin",
    password=os.environ["SYNO_SSH_PASSWORD"],
    look_for_keys=False,
    allow_agent=False,
)
_, o, _ = c.exec_command("echo HOME=$HOME; pwd; ls -la ~ | head -10")
print("SSH:", o.read().decode())
sftp = c.open_sftp()
print("SFTP cwd:", sftp.getcwd())
for p in [".", "docker", "/volume1/docker", "supabase-project.tar.gz"]:
    try:
        sftp.stat(p)
        print("stat ok:", p)
    except Exception as e:
        print("stat fail:", p, e)
try:
    with sftp.file("test-upload.txt", "w") as f:
        f.write("ok")
    print("write ok: test-upload.txt in SFTP home")
    sftp.remove("test-upload.txt")
except Exception as e:
    print("write fail:", e)
sftp.close()
c.close()
