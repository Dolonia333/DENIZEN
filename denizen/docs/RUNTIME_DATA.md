# Runtime Data Map

This document tracks runtime-mutated files under `data/` and `reports/`, with ownership and safety rules for commits.

## Runtime File Matrix

| File pattern | Writer module(s) | Reader module(s) | Mutation frequency | Contains PII? | Commit policy |
|---|---|---|---|---|---|
| `reports/**/*.md` | `src/npc-tools.js`, `src/research-brief.js`, `src/meeting-runner.js`, `src/job-crm.js` (interview prep), `src/coding-task-runner.js`, `server.js` (Bouncer security report via `linux-agent.buildReport`) | `src/work-feed.js`, `src/away-notify.js`, `src/npc-brains.js` (security excerpts), operator/UI report views | Very high; every completed NPC artifact and many scheduled/security flows | Yes (often names, email content, business context) | Never commit generated artifacts |
| `data/job-crm.json` | `src/job-crm.js`, `src/job-application.js` (via `jobCrm.saveCrm`) | `src/job-crm.js`, `server.js` (`/api/job-crm`) | Frequent during job pipeline, inbound mail processing, maintenance | Yes | Never commit |
| `data/job-outcomes.json` | `src/job-crm.js` (`recordOutcome`) | `src/job-crm.js`, `server.js` CRM endpoints | Frequent when applications/replies/interviews/offers are logged | Yes | Never commit |
| `data/job-application-log.json` | `src/job-application.js` | `src/job-application.js`, `server.js` job endpoints | Frequent while running Lucy job apply pipeline | Yes | Never commit |
| `data/user-profile.json` | Manual operator edits (no normal runtime writer) | `src/job-application.js`, `src/job-crm.js`, `server.js` profile usage | Low/manual | Yes (direct personal profile data) | Never commit in this repo |
| `data/voice-map.json` | Manual edits; optional tooling `scripts/sync-voice-map.js --write` | `server.js`, `src/voice-resolve.js`, `scripts/tts-smoke.js` | Low/manual | No direct PII, but can include account-linked voice IDs | Never commit local overrides/secrets |
| `data/permissions.json` | `src/permission-registry.js` | `src/permission-registry.js`, `server.js` permission paths | Medium; whenever grants/revokes happen | Possible (path scopes can expose local folders) | Never commit |
| `data/research-queue.json` (matches `data/research-*.json`) | `src/research-queue.js`, `src/away-notify.js` fallback writer | `src/research-queue.js`, `src/away-notify.js`, `server.js` (`/api/research-queue`) | Medium; queue add/claim/complete and scheduler transitions | Possible | Never commit |
| `data/research-sessions.json` (matches `data/research-*.json`) | `src/research-sessions.js` | `src/research-sessions.js`, `server.js` research endpoints | Medium during research work | Possible | Never commit |
| `data/research-scheduler-state.json` (matches `data/research-*.json`) | `src/research-scheduler.js` | `src/research-scheduler.js` | Periodic (digest/scheduler ticks) | Low | Never commit |
| `data/bouncer-baseline.json` | `src/linux-agent.js` (`perimeterPatrol` -> `saveBaseline`) | `src/linux-agent.js` (`loadBaseline`), Bouncer patrol/report logic | Periodic security patrol updates | Low | Never commit (machine-specific baseline) |
| `data/mcp-servers.json` | Manual operator edits | `src/denizen-mcp-connector.js`, `server.js` MCP routes | Low/manual | Possible (internal endpoints/tokens depending on content) | Never commit local environment config |
| `data/robinhood-oauth.json` | `src/robinhood-mcp.js` (OAuth registration/exchange/refresh) | `src/robinhood-mcp.js` | Low to medium (auth setup and refresh) | Yes/secret-adjacent (tokens) | Never commit |
| `data/trade-suggestions.json` | `src/robinhood-mcp.js` (`createSuggestion`, `dismissSuggestion`) | `src/robinhood-mcp.js`, `server.js` trade suggestion endpoints | Medium when Roki proposes/dismisses ideas | Low | Never commit |
| `data/roki-watchlist.json` | `src/robinhood-mcp.js` (`saveWatchlist`) | `src/robinhood-mcp.js` | Low to medium, user/NPC initiated | Low | Never commit |
| `data/assistant-profile.json` | `src/npc-brains.js` (`updateAssistantProfile`, recent decision persistence) | `src/npc-brains.js`, `server.js` (`/api/assistant-profile`) | Medium; whenever assistant profile is edited or decision history updates | Possible (user prefs and decisions) | Never commit |
| `data/llm-telemetry.jsonl` | `src/llm-telemetry.js` (append per recorded LLM/OpenClaw event) | `src/llm-telemetry.js`, `src/telemetry-insights.js`, diagnostics/UI routes | Very high; near every LLM call | Possible (prompt/response previews) | Never commit |
| `data/email-log.json` | `src/email-handler.js` | `src/email-handler.js`, docs/ops review | Medium to high when email queue/inbound runs | Yes | Never commit |
| `data/email-drafts.json` | `src/gmail-client.js` | `src/gmail-client.js`, `server.js` (`/api/email-drafts`) | Medium when drafting/sending in local mode | Yes | Never commit |
| `data/skill-proposals.json` | `src/skill-builder.js` | `src/skill-builder.js`, skill proposal APIs | Low to medium when NPC skill proposals are created/reviewed | Low | Commit only if intentionally preserving proposal history; otherwise ignore |

## `MEMORY.md` Tick Loop

Even though `npcs/*/MEMORY.md` is outside `data/` and `reports/`, it is core runtime state:

- On startup, `src/npc-brains.js` loads each NPC's `SOUL.md` and `MEMORY.md` in `_initBrains()`.
- During each autonomous `think()` cycle, if a decision includes `save`, `think()` calls `saveMemory()`.
- `saveMemory()` appends a timestamped memory line, optionally appends `[TOPIC:*]` and `[SKILL:*:+1]` derived tags, and enforces a rolling cap (trim to ~150 + new lines when file reaches ~200 lines).
- The in-memory `brain.longTermMemory` cache is reloaded from disk after each write so the next cycle sees fresh memory.
- Mood state also advances each think via `_tickMoodCycle()`, but mood is in-memory; `MEMORY.md` is the durable per-NPC narrative log.

## Safe Reset / Cleanup Procedure

Use this when you want a clean runtime slate without touching source code, docs, or static asset catalogs.

1. Stop Denizen processes first (server, workers, schedulers).
2. Optional safety backup:
   - Copy `data/user-profile.json`, `data/voice-map.json`, and `data/mcp-servers.json` if you want to preserve local personalization.
3. Remove runtime artifacts only:
   - Delete `reports/**/*.md`.
   - Delete runtime JSON/JSONL listed above (especially CRM, research, telemetry, auth, suggestions, drafts/logs, baseline).
4. Keep static inputs intact:
   - Do not delete catalog/reference files such as `data/*catalog*.json`, `data/*manifest*.json`, map/tiles definitions, or `company-brief.json`.
5. Restart server; runtime files are recreated lazily by their owning modules.

PowerShell example from `denizen/`:

```powershell
Remove-Item -Recurse -Force reports\* -Include *.md
Remove-Item -Force data\job-crm.json,data\job-outcomes.json,data\job-application-log.json,data\permissions.json,data\research-queue.json,data\research-sessions.json,data\research-scheduler-state.json,data\bouncer-baseline.json,data\mcp-servers.json,data\robinhood-oauth.json,data\trade-suggestions.json,data\roki-watchlist.json,data\assistant-profile.json,data\llm-telemetry.jsonl,data\email-log.json,data\email-drafts.json,data\skill-proposals.json -ErrorAction SilentlyContinue
```

