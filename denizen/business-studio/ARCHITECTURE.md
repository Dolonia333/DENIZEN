# DENIZEN Business Studio — Architecture & Implementation Plan

## Product

**Business Studio** (aka Founder OS) is an AI business operating and advisory
system. It answers: what am I trying to accomplish, where is the business now,
am I on track, what evidence supports that, and what should I do next?

It connects: Goals → Strategy → Milestones → Projects → Tasks → People/Agents →
Execution → Evidence → Outcomes → Metrics → Strategy updates.

## Reuse (existing Denizen)

| Concern | Reuse |
|--------|--------|
| Phone entry | `denizen-phone-ui.js` navigate app (like CRM / Studio Board) |
| Static serve | `server.js` pattern for `/studio-board/` |
| Auth | Visitor session + `visitorAccess.resolveSessionAccess` |
| Org workspace | Mirror `denizen-studio-board-store` → Supabase JSON workspace |
| CRM | Deep-link `/crm/`; link contacts/deals via relation records |
| Studio Board | Deep-link `/studio-board/`; delivery tasks stay there |
| Outcomes | `denizen-outcome-ledger.appendOutcome` on meaningful mutations |
| MCP | `denizen-mcp-*-tools.js` + scopes + team/NPC gateways |
| Design | Credible founder dark theme; Denizen accent language |

## New components (Phase 1)

- `business-studio/index.html` — SPA shell, founder + mentor dashboards
- `src/denizen-business-studio-store.js` — org workspace persistence
- `src/denizen-business-studio-routes.js` — `/api/business-studio/*`
- `src/denizen-business-studio-e3-template.js` — i2E E3 / PAVE program template
- `src/denizen-business-studio-progress.js` — explainable health/progress
- `src/denizen-business-studio-evidence.js` — **SoT ledger**: `qualifyingEvidence()`, dedupe, revoke, assumption stance (never auto-validate)
- `src/denizen-business-studio-chain.js` — single writer + derived views + compact `workingSetBrief`
- `src/denizen-mcp-business-studio-tools.js` — MCP (`working_set` / `brief` / `chain_status` / `add_evidence` / `revoke_evidence`)
- Migration: `denizen_business_studio_workspaces`
- Tests: `tests/business-studio-e2e-chain.test.js` — information flow + negatives (dupes, revoke, wrong experiment, contradicting 11th interview)

### Invariant

**Task completed ≠ business progress. Qualifying evidence meeting a requirement = business progress.**

Program completion (e.g. 10/10 interviews) ≠ business validation (hypothesis proved).
Every downstream counter must ask `qualifyingEvidence()` — never trust independent caches.

## Data model (workspace JSON blob)

```
business, programs[], goals[], milestones[], projects[], tasks[],
strategyNodes[], strategyEdges[], assumptions[], experiments[],
evidence[], findings[], decisions[], metrics[], metricValues[],
advisors[], comments[], meetings[], recommendations[], relations[],
documents[], workbooks[] (Phase 2 stub), activity[]
```

Universal `relations[]`: `{ id, fromType, fromId, toType, toId, kind }`

## Permissions

| Role | Access |
|------|--------|
| owner / admin / team | Full workspace |
| mentor / advisor | Shared slices only (programs, roadmap, goals, experiments, evidence, metrics marked shared, PAVE, meetings, founder questions) |
| investor / viewer | Read-only shared slice |

Mentor task suggestions → founder accept/decline → task created.

## Routes

- UI: `/business-studio/`
- API: `GET|PUT /api/business-studio/workspace`
- API: `GET /api/business-studio/templates`
- API: `POST /api/business-studio/programs/apply-template`
- API: `GET /api/business-studio/progress`
- API: `GET /api/business-studio/explain`
- API: `POST /api/business-studio/advisors` (founder invite)
- API: `POST /api/business-studio/recommendations` (mentor suggest; no auto-task)
- API: `POST /api/business-studio/recommendations/respond` (founder accept/decline → task)
- API: `POST /api/business-studio/comments`
- Phone: app id `businessstudio`
- MCP: `business_studio_*` tools (team + Jenny/office NPCs)

## Phases

**Phase 1 (this PR):** Foundation — shell, dashboard, programs/E3, goals,
assumptions/experiments/evidence, roadmap, strategy map, mentor ACL,
comments/recommendations, metrics, CRM/Studio deep links, explainability,
**Funding Readiness** checklist, **Market Sizing** (nested TAM/SAM/SOM + Jenny
challenges), **Moat Builder** (claim→why→evidence→copy→defensibility),
**Discovery Lab**, **Capital Pathway**, **Data Room** + Investor View ACL,
Investor Stress-Test gap list.

**Phase 2 (scaffolded, not claimed complete):** Template gallery, workbook
engine, finance sheets, diagrams, report builder, document import,
full NPC-orchestrated investor simulator, Bridge2 program template.

**Phase 3–4:** Contextual Jenny, document→plan extraction, meeting prep,
scenario modeling, portfolio mentor view.

## Principles

Evidence > activity · Founder control · Explain everything · One business graph ·
Real data · Template-first · Preserve Denizen.
