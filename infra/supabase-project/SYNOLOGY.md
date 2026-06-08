# Supabase on Synology NAS (Dolonia)

Official stack from [Supabase self-hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker).

## What this folder is

`infra/supabase-project` is a ready-to-run Supabase compose project:

- All official `supabase/*` images (postgres, kong, auth, rest, studio, …)
- `.env` with generated secrets (not in git)
- URLs preset for `https://supabase.dolonia.cloud`

## Before you start (Synology)

| Requirement | Minimum |
|-------------|---------|
| RAM | 4 GB free for Supabase |
| Disk | 40 GB+ on a volume |
| App | **Container Manager** (Docker) enabled |

## Step 1 — Copy this folder to the NAS

On your PC, after running `infra/setup-supabase-nas.ps1`:

1. Open **Synology File Station**
2. Create folder: `/docker/supabase-project`
3. Upload **the entire** `infra/supabase-project` folder contents:
   - `docker-compose.yml`
   - `.env` (important — has your secrets)
   - `volumes/` (empty dirs are fine)
   - `utils/`, `run.sh`, etc.

Or SSH into the NAS and `git clone` your repo, then use `infra/supabase-project`.

## Step 2 — Start in Container Manager

### Option A — Container Manager UI

1. **Container Manager** → **Project** → **Create**
2. Project name: `supabase`
3. Path: `/docker/supabase-project`
4. It should detect `docker-compose.yml`
5. **Build** is not required (pre-built images)
6. Click **Done** / **Start**

### Option B — SSH (if you have it enabled)

```sh
cd /volume1/docker/supabase-project
docker compose pull
docker compose up -d --wait
docker compose ps
```

All services should show `healthy` within ~2 minutes.

## Step 3 — Open Studio locally

On your LAN:

```
http://<NAS-IP>:8000
```

Login with credentials from `DOLONIA_CREDENTIALS.txt` (generated on your PC).

## Step 4 — Cloudflare tunnel (public URL)

Point `supabase.dolonia.cloud` → `http://<NAS-IP>:8000`

In Cloudflare Zero Trust → Tunnels → your tunnel → Public Hostname:

| Field | Value |
|-------|-------|
| Subdomain | `supabase` |
| Domain | `dolonia.cloud` |
| Service | `http://<NAS-IP>:8000` |

Then `https://supabase.dolonia.cloud` should load Studio (with basic auth).

## Step 5 — Apply Denizen migrations (from your PC)

Edit `denizen/.env.production` using values from `DOLONIA_CREDENTIALS.txt`.
Replace `<NAS-IP>` with your NAS LAN IP.

```powershell
cd C:\Users\zionv\OneDrive\Desktop\Denizen\denizen
.\scripts\deploy-production.ps1
```

## Step 6 — Point Denizen at NAS Supabase

In `denizen/.env` on your PC:

```env
SUPABASE_URL=https://supabase.dolonia.cloud
SUPABASE_ANON_KEY=<from DOLONIA_CREDENTIALS.txt>
DENIZEN_DB_ENABLED=true
```

Restart Denizen (or let `watchdog.ps1` restart it).

## Verify

```powershell
# Supabase REST (via Kong)
Invoke-WebRequest "https://supabase.dolonia.cloud/rest/v1/" -UseBasicParsing

# Denizen health
Invoke-WebRequest "https://denizen.dolonia.cloud/api/health" -UseBasicParsing

# Team onboarding smoke
cd denizen
node scripts/smoke-onboarding.js
```

## Ports used on NAS

| Port | Service |
|------|---------|
| 8000 | Kong API + Studio (main URL) |
| 5432 | Postgres (Supavisor session mode) |
| 6543 | Postgres (transaction pool mode) |

Ensure these are allowed on your NAS firewall for LAN access. Public access should go through Cloudflare only.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Containers not healthy | Container Manager → Logs for `db` or `kong` |
| Studio won't load | Check port 8000 mapping; wait 2 min after first start |
| Denizen can't reach DB | `SUPABASE_URL` must be `https://supabase.dolonia.cloud`, not `:5432` |
| Migrations fail | Use `postgres://postgres.dolonia:PASSWORD@NAS-IP:5432/postgres` |

## Updating Supabase

On PC:

```powershell
.\infra\setup-supabase-nas.ps1
```

Re-upload changed compose files to NAS (keep your `.env`), then:

```sh
docker compose pull
docker compose up -d --wait
```
