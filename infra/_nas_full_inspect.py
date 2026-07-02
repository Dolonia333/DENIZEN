import load_infra_env  # noqa: F401
import os, paramiko, json, subprocess, sys

HOST = os.environ.get("SYNO_HOST", "192.168.1.237")
USER = os.environ.get("SYNO_USER", "admin")
PASSWORD = os.environ["SYNO_SSH_PASSWORD"]
DOCKER = os.environ.get("SYNO_DOCKER", "/usr/local/bin/docker")
DENIZEN_DIR = "/volume1/docker/denizen-server"
SUPABASE_DIR = "/volume1/docker/supabase-project"  # or similar

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, look_for_keys=False, allow_agent=False)
print("✅ SSH connected to NAS", HOST)

def sh(cmd, label=None, timeout=90):
    if label: print(f"\n=== {label} ===")
    print(f"$ {cmd[:120]}...")
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", errors="replace").rstrip()
    print(out[:4000] if len(out) > 4000 else out)
    return out

# 1. All containers
sh(f'{DOCKER} ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}" ', "ALL Docker containers on NAS")

# 2. Denizen details
sh(f'{DOCKER} inspect denizen-server --format "{{{{json .State}}}}" 2>/dev/null | head -c 2000', "denizen-server full state")
sh(f'{DOCKER} logs denizen-server --tail 50 2>&1 | tail -50', "Latest denizen-server logs")

# 3. Directories and key files
sh(f'ls -la {DENIZEN_DIR}/', "denizen-server dir contents")
sh(f'cat {DENIZEN_DIR}/docker-compose.yml', "denizen compose")
sh(f'head -30 {DENIZEN_DIR}/.env', "denizen .env (first lines)")

# 4. Supabase / Postgres discovery
sh(f'ls -1 /volume1/docker/ | grep -E "supa|postgres|kong|db" || ls /volume1/docker/', "Supabase related dirs")
sh(f'{DOCKER} ps -a --filter "name=supabase" --format "table {{.Names}}\\t{{.Status}}" || echo "no supabase filter"', "Supabase containers")
sh(f'{DOCKER} ps -a --filter "name=db" --format "table {{.Names}}\\t{{.Status}}" || true', "db containers")

# 5. Try to find postgres password and query denizen tables
# Look for .env in supabase dirs
sh(f'find /volume1/docker -name ".env" -path "*supa*" | head -3 | xargs -I{{}} sh -c "echo === {{}} ===; grep -E \"POSTGRES|DB|SUPABASE\" {{}} | head -5" 2>/dev/null || echo "no supa .env found easily"', "Find Supabase envs")

# Try common Supabase db container exec
DENIZEN_TABLES_SQL = "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'denizen_%' ORDER BY table_name LIMIT 20;"
for dbname in ["supabase-db", "db", "postgres", "supabase_postgres"]:
    sh(f'{DOCKER} exec {dbname} psql -U postgres -d postgres -c "{DENIZEN_TABLES_SQL}" 2>/dev/null || echo "no {dbname}"', f"Try query denizen tables via {dbname}")

# 6. denizen_npcs table if possible (use service key if available)
sh(f'cat {DENIZEN_DIR}/.env | grep -E "SUPABASE_SERVICE|POSTGRES" | head -3', "Service keys hint")

# 7. Cloudflared and networking
sh(f'{DOCKER} ps --filter name=cloud -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}" ', "Cloudflared / tunnel")
sh(f'cat /volume1/docker/cloudflared/config.yml 2>/dev/null || find /volume1 -name "config.yml" -path "*cloud*" 2>/dev/null | head -1 | xargs cat 2>/dev/null || echo "no cf config"', "Cloudflared config")

# 8. NAS agent
sh(f'ls -l /volume1/docker/denizen-agent/ && tail -5 /volume1/docker/denizen-agent/agent.log 2>/dev/null || true', "NAS agent status")

# 9. Disk / health basics
sh(f'df -h /volume1 | tail -1', "Disk usage")
sh(f'free -h 2>/dev/null || echo "no free"', "Memory")

c.close()
print("\n✅ SSH closed")
