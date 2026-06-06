# Denizen Production Deploy

This runbook covers schema rollout and route-integration verification for production Supabase.

## 1) Required environment variables

Set these in your deploy environment (values are examples only):

- `SUPABASE_DB_URL` - PostgreSQL connection string for the production database.
- `DENIZEN_URL` - public/base URL for Denizen API checks.
- `NODE_ENV=production`

Optional for local-style smoke fallback:

- `SUPABASE_DB_CONTAINER` - Docker container name when running DB probes locally (default: `supabase_db_Desktop`).

## 2) Apply migrations on remote Supabase

From the `denizen` directory:

```powershell
$env:SUPABASE_DB_URL = "postgresql://postgres:<password>@<host>:5432/postgres?sslmode=require"
.\scripts\apply-all-migrations.ps1 -DbUrl $env:SUPABASE_DB_URL
```

What this applies:

- `20260606000012_*` as `postgres`
- `20260606000013_*` as `supabase_admin`
- any `20260606000014+` in version order, role inferred by filename/header (fallback `postgres`)

## 3) Service verification smoke checks

Run the spine smoke:

```powershell
node .\scripts\smoke-spine-e2e.js
```

Run onboarding smoke:

```powershell
node .\scripts\smoke-onboarding.js
```

Run visitor test suite:

```powershell
npm run test:visitor
```

## 4) Route integration note

The shared registry entrypoint is `src/route-registry.js` and exports:

- `registerDenizenRoutes(httpServer, deps)`
- `createDenizenRouteHandler(deps)`

`server.js` now includes the import and a wiring comment block so integration can be merged with minimal conflict against the existing large route diff.

## 5) Tag schema-complete release

After smoke/tests pass and merge is complete:

```powershell
git tag v1.1-schema-complete
git push origin v1.1-schema-complete
```

If the tag already exists, create a new patch tag (for example `v1.1.1-schema-hotfix`).
