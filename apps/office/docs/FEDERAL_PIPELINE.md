# Federal Pipeline Integration (v1.2)

Denizen's federal contracting surface tracks RFP lifecycle status, requirement readiness, and pipeline rollups for NPC data actions and API consumers.

## Core Tables

Primary tables used by this integration:

- `rfps`
  - Opportunity metadata (`title`, `agency`, `status`, `proposal_due_date`, `estimated_value_max`, etc.)
- `rfp_requirements`
  - Requirement-level execution detail (`requirement_type`, `priority`, `risk_level`, `status`, section refs)

Supporting enrichment:

- `denizen_predictions` (latest bid probability for `entity_type = rfp`)
- `denizen_rfp_velocity` (optional velocity snapshot used by status actions)

## Pipeline Summary Engine

`src/intelligence/federal-pipeline.js` exposes `getRfpPipelineSummary(db)`:

- Counts total RFPs
- Groups by status (`counts_by_status`)
- Sums `estimated_value_max` into `total_pipeline_value`
- Produces nearest due dates (`next_due_dates`, top 3)

For per-RFP deep detail, `getRfpDetail(db, rfpId)` adds:

- Requirement completion percent
- Grouping by requirement status
- Unmet mandatory requirements
- Latest bid probability (if predictions exist)
- Days to due date

## Jelly Data Actions

Jelly `denizen-data` actions in `jelly/lib/denizen-data-actions.js` expose federal workflow surfaces:

- `rfp-status`
  - RFP list/status query with optional detail enrichment
- `rfp-requirement-review`
  - Requirement audit for a specific RFP (`rfp_id` required)
- `rfp-pipeline-summary`
  - Org-level rollup from `getRfpPipelineSummary`
- `proposal-outline`
  - Reads/updates `proposal_outlines` sections for drafting workflow

## Demo Org Gating (Acme)

Business pipeline actions are org-policy gated.

- `src/auth/denizen-org-policy.js` marks `acme` as demo (business data disabled).
- `assertBusinessActionAllowed(orgSlug, action)` blocks business actions, including:
  - `rfp-status`
  - `rfp-requirement-review`
  - `rfp-pipeline-summary`
  - `proposal-outline`

This prevents demo orgs from querying/manipulating production-like business tables.

## HTTP API

`GET /api/federal/pipeline-summary`

- Registered via `src/route-registry.js`
- Uses `getRfpPipelineSummary` provider
- Returns pipeline summary payload or fallback note if provider unavailable

## Related Integration Docs

- [MiroFish Prediction](MIROFISH_PREDICTION.md)
- [Job CRM](JOB_CRM.md)
- [Robinhood Live](ROBINHOOD_LIVE.md)
- [Jelly Integration](JELLY_INTEGRATION.md)
- [Architecture](ARCHITECTURE.md)
- [Session Log 2026-06-05](SESSION_2026-06-05.md)
