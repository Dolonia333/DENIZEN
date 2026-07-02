import load_infra_env  # noqa: F401
import os
import paramiko

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
PASSWORD = os.environ["SYNO_SSH_PASSWORD"]
DOCKER = "/usr/local/bin/docker"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="admin", password=PASSWORD, look_for_keys=False, allow_agent=False)
print("SSH connected to NAS")

def sh(cmd, label=""):
    if label:
        print(f"\n=== {label} ===")
    print(f"$ {cmd}")
    _, o, e = c.exec_command(cmd, timeout=25)
    out = (o.read() + e.read()).decode("utf-8", errors="replace").strip()
    print(out[:2000] if len(out) > 2000 else out)
    return out

# 1. Sprite
sh(f"{DOCKER} exec denizen-server ls -l /app/assets/Grok.png 2>/dev/null || echo 'MISSING: Grok.png not in /app/assets'", "Grok sprite file")

# 2. Roster file
sh(f"{DOCKER} exec denizen-server grep -A2 -B2 \"grok\" /app/src/npc-roster.js 2>/dev/null || echo 'No grok mention in roster.js'", "grok in roster")

# 3. Scene spawn list
sh(f"{DOCKER} exec denizen-server grep -n \"xp_grok\\|grok\" /app/office-scene.js 2>/dev/null | head -5 || echo 'No xp_grok in office-scene.js'", "xp_grok in scene")

# 4. NPC folder
sh(f"{DOCKER} exec denizen-server ls -l /app/npcs/grok/ 2>/dev/null || echo 'MISSING: /app/npcs/grok directory'", "grok SOUL dir")

# 5. Simple health
sh(f"{DOCKER} exec denizen-server curl -s --max-time 5 http://127.0.0.1:8888/api/health 2>/dev/null | python3 -c "
   "\"import sys,json; d=json.load(sys.stdin); "
   "print('role:', d.get('server',{}).get('role')); "
   "npcs = d.get('npcs',[]); "
   "print('grok in npcs:', any('grok' in str(n).lower() for n in npcs)); "
   "print('sample npcs:', [n.get('name',n) for n in npcs[:5]])\" 2>/dev/null || echo 'health check failed'", "Denizen health endpoint")

c.close()
print("\nInspection complete.")