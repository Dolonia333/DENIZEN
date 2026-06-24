# Denizen Production Deploy v1.2

Production runbook for Denizen v1.2 on self-hosted Supabase (`supabase.dolonia.cloud`) and app ingress via Cloudflare (`denizen.dolonia.cloud` -> tunnel -> `:8080`).

## Production topology notes

- **Supabase**: self-hosted at `https://supabase.dolonia.cloud`.
- **App URL**: `https://denizen.dolonia.cloud`.
- **Tunnel**: Cloudflare tunnel forwards public traffic to the Denizen process on port `8080`.
- **DB migrations**: applied with PowerShell scripts in `scripts/`.
- **Schema verification**: DB + REST checks via `scripts/verify-production-schema.js`.

## Docker (optional)

Container build and compose files live in `denizen/`:

| File | Purpose |
|------|---------|
| `denizen/Dockerfile` | Node 20 Alpine image; `npm ci --production`, exposes `8080` |
| `denizen/docker-compose.yml` | Single `game` service with API key env passthrough |

From `denizen/`:

```powershell
# Build and run (maps host 8080 → container 8080)
docker compose up --build -d
```

Set `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, and `KIMI_API_KEY` in a `.env` file beside `docker-compose.yml` (or export them) before `docker compose up`. For production Supabase + mesh, prefer the PowerShell deploy flow below with a full `.env.production` — the stock compose file is a minimal game-server image, not the full Dolonia stack.

## 1) Prepare `.env.production` (no secrets in git)

Copy from template and fill values in your deploy machine / secret store:

```powershell
Copy-Item .env.production.template .env.production
```

Minimum required keys:

- `SUPABASE_DB_URL` (required for migration apply + SQL verification)
- `SUPABASE_URL` (required for REST schema checks)
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY` (required for REST schema checks)
- `DENIZEN_URL=https://denizen.dolonia.cloud` (enables app smoke checks in deploy script)

Also available:

- `MIROFISH_ENABLED` and `MIROFISH_BASE_URL` (optional forecast layer)
- `ROBINHOOD_API_TOKEN` (optional; if missing, OAuth flow can be completed later)

## 2) Run the production deploy script

From `denizen/`:

```powershell
.\scripts\deploy-production.ps1
```

`deploy-production.ps1` does all of the following:

1. Loads `.env.production` into process env (without overriding already-set values).
2. Validates `SUPABASE_DB_URL`.
3. Applies migrations through `.\scripts\apply-all-migrations.ps1 -DbUrl $SUPABASE_DB_URL`.
4. Verifies required migration versions (`20260606000012`, `20260606000013`, `20260606000014`) and key DB objects (`denizen_user_can_access_org`, trading tables).
5. Runs REST schema verification via `node .\scripts\verify-production-schema.js` when REST env vars are present.
6. Runs post-deploy API smoke checks when `DENIZEN_URL` is set.
7. Prints a JSON report and exits non-zero on any failure.

To skip HTTP schema checks:

```powershell
.\scripts\deploy-production.ps1 -SkipHttpVerification
```

## 3) Schema verification (standalone)

Run schema verification independently:

```powershell
node .\scripts\verify-production-schema.js
```

Expected checks:

- `rest_head_denizen_schema_migrations`
- `rest_head_denizen_job_applications`
- `rest_head_denizen_watchlist_symbols`
- `rest_head_denizen_trade_suggestions`
- `db_function_and_tables` (when `SUPABASE_DB_URL` is available)

Successful runs end with JSON where:

- `status` is `PASS`
- `summary.failed` is `0`

## 4) psql fallback when client tools are missing

If `psql` is not installed locally, migration/verification scripts support Docker fallback when using local Supabase DB URL:

- Use a local DB URL containing `127.0.0.1:54322` (or `localhost:54322`)
- Ensure the local Supabase Postgres container is running (default container name: `supabase_db_Desktop`)

Example local URL pattern:

```powershell
$env:SUPABASE_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

This fallback is intended for local recovery/testing, not remote production hosts.

## 5) Post-deploy smoke checklist

After deploy, verify these endpoints against `https://denizen.dolonia.cloud`:

```powershell
Invoke-WebRequest "https://denizen.dolonia.cloud/api/health" -UseBasicParsing
Invoke-WebRequest "https://denizen.dolonia.cloud/api/intelligence/prediction-summary" -UseBasicParsing
Invoke-WebRequest "https://denizen.dolonia.cloud/api/federal/pipeline-summary" -UseBasicParsing
Invoke-WebRequest "https://denizen.dolonia.cloud/api/trade-suggestions" -UseBasicParsing
```

Expected result:

- HTTP `200` for each endpoint
- JSON body returned (not HTML error pages)

Optional deeper checks:

- `node .\scripts\smoke-spine-e2e.js`
- `node .\scripts\smoke-onboarding.js`
- `node .\scripts\robinhood-live-smoke.js`

## 6) Rollback tag (v1.2)

Rollback target tag: `v1.2-intelligence-complete`

```powershell
git fetch --tags
git checkout v1.2-intelligence-complete
```

If rollback is executed:

1. Redeploy app from rollback tag.
2. Re-run schema verification.
3. Re-run smoke checklist.
4. Shift traffic only after smoke passes.

## 7) Manual steps and operator-owned actions

The deployment scripts do **not** fully automate these:

- **Supabase DB password management** (`SUPABASE_DB_URL` credential rotation/update)
- **Robinhood OAuth approval** when token not already present
  - check auth: `GET /api/market/auth-status`
  - guided smoke: `node .\scripts\robinhood-live-smoke.js`
- **Cloudflare tunnel operations** (ensuring `denizen.dolonia.cloud` reaches the app on `:8080`)

## 8) Compute mesh (home fleet / optional production)

For distributed compute across dolonia + NAS + Kali + Desktop nodes:

| Key | Purpose |
|-----|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** for server-side queue (bypasses RLS) |
| `DENIZEN_FLEET_AGENT_TOKEN` | NAS/Kali metrics + agent bundle auth |
| `DENIZEN_FLEET_IDENTITY_ID` | Identity for fleet jobs and reports |
| `DENIZEN_INTERNAL_API_TOKEN` | Protects `POST /api/compute/jobs/enqueue` |

Home lab orchestrator (from repo root):

```powershell
py infra/finish-all-mesh.py
```

Mesh smokes (from `denizen/`):

```powershell
node scripts/smoke-mesh-complete.js
node scripts/smoke-mesh-jobs-flow.js
```

Full runbook: [COMPUTE_MESH.md](COMPUTE_MESH.md), [../../infra/README.md](../../infra/README.md).

**Production note:** dev NAS may use permissive anon RLS on compute tables (`20260608000001`–`000003`). Migration `20260622000002` drops anon policies — server must use `SUPABASE_SERVICE_ROLE_KEY`. Audit: `py infra/audit-compute-rls-nas.py`.

## 9) Production security checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` set on Denizen server (not anon-only)
- [ ] Migration `20260622000002` applied — compute anon RLS dropped
- [ ] Migration `20260622000001` applied — MCP RPC `search_path` includes `extensions`
- [ ] `DENIZEN_INTERNAL_API_TOKEN` on `POST /api/compute/jobs/enqueue`
- [ ] `npm run smoke:mcp` passes against production URL
- [ ] `DENIZEN_ECONOMY_MODE=false` + `DENIZEN_COFOUNDER_LLM=true` for live office

## 10) Failover and standby (Phase 2 — manual)

Denizen is **single-primary** today: WebSocket sessions and in-memory office state do not replicate.

| Step | Action |
|------|--------|
| 1 | Standby host runs same Docker image with `DENIZEN_SERVER_ROLE=standby` (no tunnel traffic) |
| 2 | Cloudflare tunnel health check → primary `GET /api/health` |
| 3 | On primary failure, repoint tunnel to standby `:8888` (manual or scripted) |
| 4 | Clients reconnect WebSocket — expect brief office reset |

See [MESH_SCALING.md](MESH_SCALING.md) Phase 2 for dolonia standby + NAS primary layout.

## 11) Related docs

- [SETUP.md](SETUP.md) - local setup and env bootstrapping
- [COMPUTE_MESH.md](COMPUTE_MESH.md) - distributed compute mesh
- [../../infra/README.md](../../infra/README.md) - NAS/Kali/Tailscale infrastructure
- [SCRIPTS.md](SCRIPTS.md) - script reference including operations scripts
- [TESTING.md](TESTING.md) - pre-deploy and post-deploy test pyramid
