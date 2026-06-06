# Denizen Production Deploy v1.2

Production runbook for Denizen v1.2 on self-hosted Supabase (`supabase.dolonia.cloud`) and app ingress via Cloudflare (`denizen.dolonia.cloud` -> tunnel -> `:8080`).

## Production topology notes

- **Supabase**: self-hosted at `https://supabase.dolonia.cloud`.
- **App URL**: `https://denizen.dolonia.cloud`.
- **Tunnel**: Cloudflare tunnel forwards public traffic to the Denizen process on port `8080`.
- **DB migrations**: applied with PowerShell scripts in `scripts/`.
- **Schema verification**: DB + REST checks via `scripts/verify-production-schema.js`.

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

## 8) Related docs

- [SETUP.md](SETUP.md) - local setup and env bootstrapping
- [SCRIPTS.md](SCRIPTS.md) - script reference including operations scripts
- [TESTING.md](TESTING.md) - pre-deploy and post-deploy test pyramid
