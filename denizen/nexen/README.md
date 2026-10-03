# NEXEN · DENIZEN phone app

Command Center app opened from the Buzz phone Apps grid (same pattern as CRM / Studio Board / Business Studio).

## Routes

| Path | Purpose |
|---|---|
| `/nexen/` | App shell (Command Center UI) |
| `/api/nexen/health` | Health + route list |
| `/api/nexen/hub` | Dashboard summary |
| `/api/nexen/workspace` | GET/PUT org workspace |
| `/api/nexen/request` | Save planned request |
| `/api/nexen/tasks` | Create / patch tasks |

## Persistence

Org-scoped JSON workspace in `denizen_nexen_workspaces` (via `denizen-db`), mirroring Studio Board / Business Studio.

Ensure that table exists in your Supabase/Postgres (or equivalent) with columns:

- `org_id` (text, PK / unique)
- `state` (jsonb)
- `schema_version` (int)
- `updated_by` (text, nullable)
- `updated_at` (timestamptz)

Without the DB, the app still loads in **local** mode; writes return clear errors or ephemeral responses.

## Phone

Registered in `src/denizen-phone-ui.js` as:

```js
{ id: 'nexen', type: 'navigate', url: '/nexen/', ... }
```

Session handoff uses `dz_sid` / `dz_stok` like CRM.
