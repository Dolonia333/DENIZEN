# NAS platform bridge

Denizen can run on **NAS-only Supabase** (`<NAS_IP>:8000`) without the Dolonia **cloud** platform schema. Several migrations bridge Denizen tables to platform CRM tables that exist only on cloud Supabase.

## Skipped on NAS

Applied via `infra/apply-migrations-nas.py` with `SKIP_VERSIONS`:

| Migration | Needs |
|-----------|--------|
| `20260606000005` | `clients`, org bridge on website tables |
| `20260606000006` | Platform funnel views |
| `20260606000012` | `clients`, `profiles`, `is_admin()` |
| `20260606000013` | Platform admin helpers |
| `20260606000014` | CMS / blog bridge |

Denizen-local CRM (`job_applications`, intake, contacts) still works. Platform publish skills and identity sync do **not** until cloud tables exist.

## Runtime gate

`GET /api/platform-bridge/status` returns `platformBridgeStatus()` from `src/platform-bridge.js`.

- **NAS default:** `enabled: false`, `mode: nas`
- **Cloud:** set `DENIZEN_PLATFORM_BRIDGE=true` or `PLATFORM_CMS_TABLE` / `PLATFORM_CLIENTS_TABLE`

## Enabling on cloud Supabase

1. Apply migrations `000005`–`000014` on the cloud project (not NAS).
2. Set `DENIZEN_PLATFORM_BRIDGE=true` on the Denizen host that uses that Supabase URL.
3. Optional: `PLATFORM_CMS_TABLE=blog_posts`, `PLATFORM_CLIENTS_TABLE=clients`
