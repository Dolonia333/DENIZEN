# Job CRM Integration (v1.2)

Denizen's Job CRM tracks applications, inbox signals, follow-ups, and outcomes across JSON storage plus Supabase sync for analytics and cross-NPC visibility.

## Storage and Dual-Write Pattern

Primary runtime store:

- `data/job-crm.json`
  - `applications[]`, `referrals[]`, `lastStandupAt`

Dual-write behavior:

- `src/pipelines/job-crm.js`
  - `upsertApplication()` writes local JSON and calls `denizenDb.syncJobApplication(app)`
  - `syncAllApplicationsToDb()` batch-pushes all local apps via `syncAllJobApplications()`
- `src/intelligence/denizen-db.js`
  - `syncJobApplication()` upserts `denizen_job_applications`
  - `syncAllJobApplications()` iterates and queues writes

This pattern keeps local-first resilience while preserving centralized SQL telemetry.

## `denizen_job_applications` Mapping

Application rows are written with:

- `org_id` scope
- `npc_key = "roki"` by default
- optional `session_id`
- status/score/site metadata

Default Roki attribution comes from:

- `syncJobApplication(... npc_key || "roki")` in `src/intelligence/denizen-db.js`

## Fact and Outcome Triggers

Migration `supabase/migrations/20260606000012_platform_identity_bridge.sql` attaches trigger `denizen_job_applications_outcomes`:

- On `INSERT`:
  - emits fact `job_application.created`
  - actor defaults to NPC `roki`
- On status `UPDATE`:
  - emits fact `job_application.status_changed`
  - writes job outcomes for positive/rejected state transitions

This turns CRM updates into durable event/fact history for prediction and reporting layers.

## Maintenance API

`POST /api/job-crm/maintenance`

- Registered in `src/route-registry.js`
- Calls `jobCrm.runMaintenance(...)`
- Includes stale follow-up drafting, optional weekly standup emission, and sync batch behavior
- Returns `503` if job-crm module is unavailable

## Lucy and Roki Pipeline Connection

The integration deliberately links both roles:

- **Lucy** (execution agent):
  - Runs job pipeline tasks (scraping/apply/replies/maintenance orchestration).
  - Handles recruiter and interview workflow generation.
- **Roki** (market + jobs attribution spine):
  - Owns default `npc_key` attribution for persistent `denizen_job_applications` rows.
  - Keeps job lifecycle signals in the same denizen fact/outcome backbone used by other business pipelines.

In short: Lucy drives operations; Roki is the canonical entity attribution key for stored job application records.

## Related Integration Docs

- [MiroFish Prediction](MIROFISH_PREDICTION.md)
- [Federal Pipeline](FEDERAL_PIPELINE.md)
- [Robinhood Live](ROBINHOOD_LIVE.md)
- [Jelly Integration](JELLY_INTEGRATION.md)
- [Architecture](ARCHITECTURE.md)
- [Session Log 2026-06-05](SESSION_2026-06-05.md)
