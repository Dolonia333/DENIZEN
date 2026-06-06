# Denizen Production Deploy v1.2

This runbook covers the production Supabase deploy flow for Denizen v1.2, including migration rollout, schema verification, and optional post-deploy API smoke checks.

## 1) Production environment configuration

Create `.env.production` from `.env.production.template` and populate real secrets in your deploy environment.

Required for production DB deploy:

- `SUPABASE_DB_URL`

Used by verification scripts:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY`

Used by optional post-deploy app smoke checks:

- `DENIZEN_URL` (for production, this is typically `https://denizen.dolonia.cloud`)
- `MIROFISH_ENABLED` (`true` or `false`, default false)
- `MIROFISH_BASE_URL` (default `http://localhost:5001`)

## 2) One-command production deploy

From the `denizen` directory:

```powershell
.\scripts\deploy-production.ps1
```

What `deploy-production.ps1` does:

1. Loads `.env.production` values into process env only when not already set.
2. Requires `SUPABASE_DB_URL` and exits with a clear error if missing.
3. Runs `.\scripts\apply-all-migrations.ps1 -DbUrl $SUPABASE_DB_URL`.
4. Runs SQL verification checks for:
   - migration versions `20260606000012`, `20260606000013`, `20260606000014`
   - function `public.denizen_user_can_access_org`
   - tables `public.denizen_watchlist_symbols` and `public.denizen_trade_suggestions`
5. Runs `scripts/verify-production-schema.js` REST checks when Supabase REST env vars are available.
6. Runs post-deploy Denizen API smoke checks when `DENIZEN_URL` is set.
7. Emits a JSON report and exits non-zero on any failure.

To skip REST verification explicitly:

```powershell
.\scripts\deploy-production.ps1 -SkipHttpVerification
```

## 3) Standalone schema verification

Run REST-first verification independently:

```powershell
node .\scripts\verify-production-schema.js
```

This script performs HEAD checks against Supabase REST tables:

- `denizen_schema_migrations`
- `denizen_job_applications`
- `denizen_watchlist_symbols`
- `denizen_trade_suggestions`

If `SUPABASE_DB_URL` is also present, it additionally validates:

- `public.denizen_user_can_access_org` exists
- trading tables exist in `public`

## 4) Post deploy smoke checks (Denizen app)

When `DENIZEN_URL` is configured, `deploy-production.ps1` checks:

- `GET /api/health`
- `GET /api/intelligence/prediction-summary`
- `GET /api/trade-suggestions`

Recommended production value:

- `DENIZEN_URL=https://denizen.dolonia.cloud`

## 5) Rollback and release tags

Current production tag target: `v1.2-intelligence-complete`

Rollback example:

```powershell
git fetch --tags
git checkout v1.2-intelligence-complete
```

If rollback requires redeploying schema/application state, redeploy the app from this tag and rerun smoke checks before restoring traffic.

## 6) MiroFish integration notes

When enabled, Denizen calls MiroFish as an external forecast layer and stores predictions with `model_key=mirofish_v1`. When MiroFish is down or disabled, sync gracefully falls back to local heuristic scoring (`heuristic_v0`).

Operational routes:

- `GET /api/intelligence/mirofish-status` for enabled/base URL/health state.
- `POST /api/intelligence/mirofish-sync` for on-demand intake/lead/rfp sync.

Health checks run `GET /api/health` first and then `GET /health`.
