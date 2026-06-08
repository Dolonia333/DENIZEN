# Denizen Infrastructure

Operations tooling for the Dolonia home lab: Synology NAS (Supabase + fleet agent), Kali compute node, Tailscale mesh, and database migrations.

## Prerequisites

- Python 3.10+ with `paramiko` (`pip install paramiko`)
- Node.js 22+ (for Denizen server and smoke tests)
- Tailscale on all mesh nodes
- `infra/.env` (copy from `.env.example` — **gitignored**)

```powershell
copy infra\.env.example infra\.env
# Edit: SYNO_SSH_PASSWORD, optional KALI_SSH_PASSWORD
```

## Network layout (Dolonia lab)

| Machine | Tailscale IP | LAN IP | Role |
|---------|--------------|--------|------|
| dolonia | `100.71.54.109` | `192.168.1.232` | Denizen host, LM Studio GPU |
| hp81081d (Kali) | `100.110.205.49` | `192.168.1.240` | Headless compute worker |
| NAS (Synology) | — | `192.168.1.237` | Self-hosted Supabase + NAS agent |

**Rule:** remote agents use **Tailscale IP** (`100.71.54.109:8081`) or **public URL** (`https://denizen.dolonia.cloud`), not dolonia's LAN IP.

## Quick start — full mesh

From repo root:

```powershell
py infra/finish-all-mesh.py
```

This runs in order:

1. `provision-nas-agent.py` — fleet tokens → `infra/nas-agent-bundle/.env`
2. `provision-kali-agent.py` — sync JS + `infra/kali-agent-bundle/.env`
3. `apply-migrations-nas.py` — Denizen SQL migrations on NAS Postgres
4. `deploy-nas-agent.py` — SSH tarball to `/volume1/docker/denizen-agent`
5. `deploy-kali-agent.py` — SSH to Kali (skipped if no `KALI_SSH_PASSWORD`)
6. `probe-nas-agent.py` — verify NAS metrics in fleet
7. Mesh smoke tests (`smoke-mesh-complete.js`, `smoke-mesh-jobs-flow.js`, `smoke-nas-fleet.js`, `test-compute-integration.js`)
8. Prints `/api/health` fleet summary

## NAS (Synology)

### SSH access

| Variable | Default |
|----------|---------|
| `SYNO_HOST` | `192.168.1.237` |
| `SYNO_USER` | `admin` |
| `SYNO_SSH_PASSWORD` | *(required in infra/.env)* |
| `SYNO_AGENT_DIR` | `/volume1/docker/denizen-agent` |

### Deploy NAS compute agent

```powershell
py infra/provision-nas-agent.py
py infra/deploy-nas-agent.py
py infra/probe-nas-agent.py
```

Remote install path: `/volume1/docker/denizen-agent/`  
Logs: `agent.log` on NAS via SSH `tail`.

### Supabase on NAS

Full runbook: **[supabase-project/SYNOLOGY.md](supabase-project/SYNOLOGY.md)** — hardware requirements, File Station upload, compose bring-up, Cloudflare tunnel URLs, and post-install verification.

| Path on NAS | Purpose |
|-------------|---------|
| `/volume1/docker/supabase-project/` | Docker Compose stack (`.env` with secrets — not in git) |
| `/volume1/docker/denizen-migrations/` | Staged SQL migrations |

**Initial setup (on dolonia):**

```powershell
infra\setup-supabase-nas.ps1               # clone upstream compose → infra/supabase-project
py infra/deploy-supabase-to-nas.py           # SFTP stack to NAS
py infra/finish-supabase-nas.py            # pooler port fix + restart + verify
```

**Ongoing Denizen DB work:**

```powershell
py infra/apply-migrations-nas.py
py infra/fetch-nas-supabase-keys.py          # masked key output
py infra/apply-service-role-to-denizen.py    # writes SUPABASE_SERVICE_ROLE_KEY → denizen/.env
```

`ONLY_MIGRATIONS=20260608000003 py infra/apply-migrations-nas.py` — apply a single migration.

Migrate data from Docker Desktop Supabase: `py infra/migrate-desktop-to-nas.py`, then `py infra/verify-migration.py`.

## Kali (hp81081d)

SSH user is **`dolo`** (not `kali`).

| Variable | Default |
|----------|---------|
| `KALI_HOST` | `100.110.205.49` |
| `KALI_USER` | `dolo` |
| `KALI_SSH_PASSWORD` | optional — enables `deploy-kali-agent.py` |
| `KALI_DENIZEN_URL` | `http://100.71.54.109:8081` |
| `DENIZEN_TAILSCALE_URL` | same — used in agent bundles |

### Pull install (recommended)

Run **on Kali**:

```bash
export DENIZEN_FLEET_AGENT_TOKEN='<from denizen/.env on dolonia>'
export DENIZEN_PULL_URL='http://100.71.54.109:8081'
curl -fsSL https://raw.githubusercontent.com/Dolonia333/DENIZEN/main/infra/pull-install-kali-agent.sh | bash
```

Or from a local multbot checkout:

```bash
bash infra/pull-install-kali-agent.sh
```

Install directory: `~/denizen-agent/`  
Success log lines:

```
server http://100.71.54.109:8081 identity ...
reported hp81081d -> hp81081d
registered compute node <uuid>
worker loop started
```

### SSH deploy (when credentials available)

```powershell
py infra/provision-kali-agent.py
py infra/deploy-kali-agent.py
```

Falls back to `SYNO_SSH_PASSWORD` if `KALI_SSH_PASSWORD` unset (usually fails — use pull install).

### Kali autostart after reboot

No systemd unit shipped yet. Add to crontab:

```bash
@reboot sleep 30 && cd $HOME/denizen-agent && nohup node nas-compute-agent.js >> agent.log 2>&1
```

### Kali troubleshooting

| Symptom | Fix |
|---------|-----|
| `MODULE_NOT_FOUND` | `export DENIZEN_AGENT_ROOT=$HOME/denizen-agent` |
| `fetch failed` / `127.0.0.1:8081` | Fix `.env` URLs to Tailscale IP |
| Agent exits immediately | `tail -20 ~/denizen-agent/agent.log` |

See [denizen/docs/COMPUTE_MESH.md](../denizen/docs/COMPUTE_MESH.md) for full troubleshooting.

## Tailscale

```powershell
infra\repair-tailscale.cmd
infra\repair-tailscale.ps1
```

Verify:

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" status
& "C:\Program Files\Tailscale\tailscale.exe" ping 100.110.205.49
```

On Kali after install: `sudo tailscale up`

## Agent bundle contents

`GET /api/compute/fleet/agent-bundle.tar.gz` (auth: `X-Fleet-Agent-Token`) returns:

```
denizen-agent/
  nas-compute-agent.js
  nas-metrics-agent.js
  src/denizen-hardware-monitor.js
  src/denizen-node-client.js
  src/denizen-mesh-job-runner.js
  .env
  start.sh
```

Query `denizen_url` embeds the reachable server URL in `.env` (required for Kali).

Built by `denizen/scripts/build-fleet-agent-bundle.py` (Python `tarfile`).

## Script reference

| Script | Purpose |
|--------|---------|
| `finish-all-mesh.py` | Full mesh provision + deploy + smokes |
| `provision-nas-agent.py` | NAS bundle `.env` + fleet tokens |
| `provision-kali-agent.py` | Kali bundle sync + `.env` |
| `deploy-nas-agent.py` | SSH deploy to Synology |
| `deploy-kali-agent.py` | SSH deploy to Kali |
| `pull-install-kali-agent.sh` | Pull install on Kali (no SSH from dolonia) |
| `install-denizen-agent-on-kali.sh` | Local bundle install on Kali |
| `apply-migrations-nas.py` | Apply `denizen/supabase/migrations/*.sql` |
| `apply-service-role-to-denizen.py` | Copy service role key from NAS → `denizen/.env` |
| `fetch-nas-supabase-keys.py` | Read masked Supabase keys from NAS |
| `probe-nas-agent.py` | Verify NAS agent + fleet metrics |
| `repair-tailscale.cmd` | Windows Tailscale repair |
| `load_infra_env.py` | Loads `infra/.env` into Python scripts |

## Troubleshooting scripts

One-off diagnostics and repairs not covered above. All SSH scripts require `SYNO_SSH_PASSWORD` in `infra/.env` unless noted.

### Probe / diagnose

| Script | Purpose |
|--------|---------|
| `probe-nas.py` | NAS Docker version, container list, legacy `/volume1/docker/supabase` path check |
| `probe-nas-status.py` | Supabase compose file presence, container health, Kong port 8000 HTTP code, disk usage |
| `probe-nas-platform.py` | Query platform tables (`projects`, `invoices`, `intake_forms`, funnel views) on NAS Postgres |
| `probe-platform-nas.py` | List non-`denizen%` public tables and team-auth helper functions |
| `probe-storage-nas.py` | Storage + realtime container logs, health, compose ps |
| `probe-jwt-jwks-nas.py` | Compare `JWT_JWKS` in `.env` vs storage/realtime container env |
| `probe-cloudflared.py` | Inspect `cloudflare-cloudflared` container cmd and nearby compose files |
| `probe-sftp.py` | SFTP connectivity test — cwd, stat paths, test upload/delete |
| `probe-live-unison.py` | Live Denizen `/api/health` fleet + credit economy summary (reads `denizen/.env`, no secrets printed) |
| `check-nas-ports.py` | Post-restart compose ps, Kong port 8000 probe, recent Kong logs |
| `check-cloudflared-nas.py` | Cloudflared container cmd, mounts, config paths |
| `check-nas-agent-ssh.py` | NAS agent dir listing, `.env`, `agent.log` tail, running `nas-metrics-agent` process |
| `compare-schema.py` | Diff `denizen%` table columns: Docker Desktop Supabase vs NAS |
| `verify-migration.py` | Row-count parity for core `denizen_*` tables after desktop→NAS migration |
| `read-cf-config.py` | Print NAS `cloudflared/config.yml` with tokens redacted |

### Fix / apply

| Script | Purpose |
|--------|---------|
| `fix-storage-realtime-nas.py` | Repair storage + realtime JWT/JWKS mismatch on NAS |
| `fix-kong-nas.py` | chmod Kong entrypoint, restart Kong gateway |
| `apply-compose-jwks-fix-nas.py` | Patch compose `JWT_JWKS` lines and restart storage + realtime |
| `apply-platform-nas.py` | Deploy Dolonia platform tables + migrations `000005`–`000013` on NAS |
| `apply-team-auth-functions.py` | Create/replace `denizen_auth_user_org_ids` and `denizen_user_can_access_org` on NAS |
| `apply-migrations-psycopg.py` | Apply Denizen migrations via direct Postgres (no `psql` in container) |
| `deploy-supabase-to-nas.py` | SFTP `infra/supabase-project` to Synology |
| `finish-all-nas.py` | Finish Supabase bring-up — pooler port, restart, verify |
| `finish-supabase-nas.py` | Same family as `finish-all-nas.py` — state dump, pooler fix, restart |
| `migrate-desktop-to-nas.py` | Copy public schema data from Docker Desktop Supabase to NAS |
| `start-nas-agent-ssh.py` | Fix NAS agent `DENIZEN_URL`, kill stale agent, nohup restart |
| `setup-supabase-nas.ps1` | Clone upstream Supabase docker config → `infra/supabase-project` |
| `run-nas-agent-setup.ps1` | PowerShell wrapper: `provision-nas-agent` → `deploy-nas-agent` → `probe-nas-agent` |

### Shell / Windows helpers

| Script | Purpose |
|--------|---------|
| `kali-install-agent.sh` | **⚠️ SECURITY WARNING:** legacy paste-on-Kali bootstrap with **hardcoded fleet tokens and identity IDs** in the generated `.env`. Do **not** commit or share output; prefer `pull-install-kali-agent.sh` instead. Rotate `DENIZEN_FLEET_AGENT_TOKEN` if this file was ever used in a shared channel. |
| `repair-tailscale.ps1` | PowerShell Tailscale repair (companion to `repair-tailscale.cmd`) |
| `reinstall-tailscale.cmd` | Nuclear option — uninstall Tailscale, prompt reboot, reinstall steps |

## Bundles (gitignored secrets)

| Directory | Purpose |
|-----------|---------|
| `infra/nas-agent-bundle/` | NAS `.env` + staging (generated) |
| `infra/kali-agent-bundle/` | Kali `.env` + synced JS (generated) |

Do not commit `.env` files from these directories.

## Related docs

- [denizen/docs/COMPUTE_MESH.md](../denizen/docs/COMPUTE_MESH.md) — architecture, APIs, UI, smokes
- [denizen/docs/PRODUCTION_DEPLOY.md](../denizen/docs/PRODUCTION_DEPLOY.md) — cloud production
- [infra/supabase-project/SYNOLOGY.md](supabase-project/SYNOLOGY.md) — Supabase on Synology
