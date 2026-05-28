# Denizen — Capability Roadmap

Everything the NPCs can do, everything they will be able to do, in order of what to build next.

---

## Done ✅

### Foundation

- ✅ 16 autonomous AI NPCs with real language model inference
- ✅ Physical movement in pixel office: walk, sit, stand, join meetings, patrol
- ✅ Persistent memory per NPC (MEMORY.md, survives restarts)
- ✅ Soul files (SOUL.md) — personality, role, provider, backstory, sprint context
- ✅ Company context injected into every think prompt (company-brief.json)
- ✅ Real code awareness — each NPC reads relevant source file snippets
- ✅ Real artifact output — NPCs write markdown reports to `reports/` on disk
- ✅ Live system data for DevOps/IT/Security (server health, disk, processes)
- ✅ Task cascade system — Abby's decision ripples down to direct reports
- ✅ LM Studio parallel inference (LM_STUDIO_PARALLEL env var)
- ✅ windowsHide on all WSL exec() calls
- ✅ gateway-bridge reconnect cap (stops spamming after 5 failed attempts)
- ✅ NpcTools: Level 1 (code read), Level 2 (artifact write), Level 3 (safe commands)
- ✅ Desktop agent abort flag + `/api/desktop-abort` endpoint

### Phase 1 — Closed the Gaps (`bf926af`, `211e258`, `71c1b6e`)

- ✅ **Marcus SOUL.md** — full personality, sprint tasks, filler phrase (*"Where does that stand."*)
- ✅ **Sarah SOUL.md** — full personality, sprint tasks, filler phrase (*"What problem does that solve."*)
- ✅ **NPC → OpenClaw Skill Bridge** — `run_skill` action added to NPC decision JSON; `runNpcSkill()` in server.js routes to OpenClaw CLI scripts; results injected into next think cycle via `injectSkillResult()`
- ✅ **Mood system** — `_npcMoods` map, stress/satisfaction/focus axes, `_updateMood()` post-decision, mood block injected into every think prompt
- ✅ **Directive inbox** — `assignDirective()`, `DIRECT ORDER` block in system prompt, auto-report on finish; `npc_assign_directive` WS + `POST /api/assign-directive` REST endpoint
- ✅ **GitHub for Alex + Jenny** — SOUL.md context + runtime injection of github skill; `run_skill`/github examples baked in

### Phase 2 — Real Task Execution (`fab2bb0`, `808c88a`, `8ec4c3c`, `71c1b6e`)

- ✅ **Lucy email auto-send** — `shouldEscalate()` with 9 escalation keywords; `EMAIL_AUTOSEND` gate; auto-send vs. draft-only logic; `addToEmailQueue()` / `processEmailQueue()` exports
- ✅ **Lucy job pipeline** — 7-step scrape→filter→resume→cover→apply→log chain in `runJobPipeline()`; `POST /api/lucy-job-pipeline`; Lucy's `run_skill` short-circuits to pipeline
- ✅ **Browserclaw for Bob** — browserclaw skill injected into think prompt at runtime; SOUL.md context with research targets (LangSmith, Phoenix, Langfuse, Arize)
- ✅ **Browserclaw + tools for Dan** — browserclaw, lm-studio, supabase-bridge all injected; SOUL.md documents Bouncer escalation flow (Dan is the decision-maker for network-level responses)
- ✅ **Pier Supabase pipeline** — supabase-bridge skill injected; SOUL.md sprint tasks: design `npc_work_output` + `npc_artifacts` tables, wire WS event → insert
- ✅ **Bouncer investigation upgrade** — `buildReport()` structured markdown reports with verdicts (THREAT CONFIRMED / LIKELY FALSE POSITIVE / INCONCLUSIVE); `perimeterPatrol()` baseline diff (`data/bouncer-baseline.json`); tshark integration for packet anomalies; `investigationIsSerious()` → Dan directive escalation
- ✅ **Work output feed UI** — `src/work-feed.js` (`WorkFeedPanel`); Tab key toggle; per-NPC color coding; 100-entry history; slide-in animation; wired to `npc_work_output` WS event in `agent-office-manager.js`

### Phase 3 — Deep Integration (`66bc3a2`, `b569fad`, `04e747a`)

- ✅ **NPCs run Claude Code on real files** — `src/coding-task-runner.js`: isolated git worktree per NPC per task, `npx @anthropic-ai/claude-code --print` execution, diff capture, proposal written to `reports/code-reviews/`; forbidden files guard (soul/memory/settings); `GET/POST /api/code-proposals` with approve/reject
- ✅ **Cross-NPC task chains** — `src/task-chain.js` (`TaskChainRunner` singleton): multi-step directive sequences, each step gets previous artifacts as context, auto-advances on `taskPhase: finished`; `POST /api/task-chains`, `GET /api/task-chains/:id`; broadcasts `npc_chain_started` / `npc_chain_step_done` / `npc_chain_complete`
- ✅ **NPC disagreement + Abby arbitration** — `src/conflict-detector.js` (`ConflictDetector` singleton): rolling 50-entry artifact log, similarity heuristic (3+ overlapping words), outcome diff check, both positions injected into Abby's next think prompt for arbitration

---

## Phase 4 — Production and Demo

---

### 4.1 — Public Demo Mode

**Status:** 🔴 Not built  
**Files:** `server.js`, `office-scene.js`, new `src/demo-roster.js`

**What it is:**
- Simplified 4-NPC roster: Abby, Alex, Lucy, Bouncer (or configurable via `?demo_npcs=abby,alex,lucy,bouncer`)
- All NPCs run Claude Haiku — no LM Studio dependency
- No OpenClaw required
- Read-only — visitor can watch but not interact (no player chat)
- Designed to run on a hosted server at a public URL

**URL:** `http://localhost:8080/?mode=demo`

**Effort:** ~1 day

---

### 4.2 — Performance Optimization

**Status:** 🟡 Ongoing  

- Profile 16-NPC think loop under sustained load — measure queue depth over time
- Reduce prompt token count for LM Studio NPCs (they're most latency-sensitive)
- Memory compression — `MEMORY.md` files that exceed ~2KB need automatic summarization (keep last 5 key points + summary of older entries)
- Request queue priority: player-chat requests jump the LM Studio queue

**Effort:** Ongoing

---

### 4.3 — Docker Production Deploy

**Status:** 🟡 Scaffolded (Dockerfile + docker-compose.yml exist)  

- Wire `LM_STUDIO_PARALLEL` into Docker env passthrough
- Health check endpoint wired to Docker `HEALTHCHECK`
- PM2 config updated with current env vars (`EMAIL_AUTOSEND`, `WSL_DISTRO`, etc.)
- Deploy checklist in `docs/DEPLOYMENT.md`

**Effort:** ~4 hours

---

## Capability Matrix

| Capability | Status |
|-----------|--------|
| Walk/sit/talk in office | ✅ Done |
| Real AI conversations | ✅ Done |
| Persistent memory (MEMORY.md) | ✅ Done |
| Soul files (SOUL.md) | ✅ Done — all 16 NPCs |
| Company context in every prompt | ✅ Done |
| Read real code files | ✅ Done |
| Write markdown artifacts | ✅ Done |
| Bouncer Kali investigation | ✅ Done |
| Bouncer structured reports + Dan escalation | ✅ Done |
| Bouncer baseline patrol (port diff) | ✅ Done |
| Live system data (DevOps/IT/Security) | ✅ Done |
| OpenClaw skill execution (`run_skill`) | ✅ Done — Phase 1 |
| Mood system (stress/satisfaction/focus) | ✅ Done — Phase 1 |
| Mandatory task directives (directive inbox) | ✅ Done — Phase 1 |
| Marcus + Sarah soul files | ✅ Done — Phase 1 |
| GitHub skill for Alex + Jenny | ✅ Done — Phase 1 |
| Email auto-send (Lucy) | ✅ Done — Phase 2 |
| Full job pipeline (Lucy) | ✅ Done — Phase 2 |
| Browserclaw research (Bob) | ✅ Done — Phase 2 |
| Browserclaw + tools (Dan) | ✅ Done — Phase 2 |
| Supabase pipeline design (Pier) | ✅ Done — Phase 2 |
| Work output feed UI panel (Tab key) | ✅ Done — Phase 2 |
| NPCs run Claude Code on real files | ✅ Done — Phase 3 |
| Full task chain (spec→code→QA) | ✅ Done — Phase 3 |
| NPC disagreement/escalation | ✅ Done — Phase 3 |
| Public demo mode (4-NPC, Claude-only) | 🔴 Phase 4.1 |
| Performance optimization | 🟡 Phase 4.2 — ongoing |
| Docker production deploy | 🟡 Phase 4.3 — scaffolded |

---

## What's Next (Phase 4)

```
4.1  Public demo mode                (~1 day)
       → Simplified 4-NPC roster (Abby, Alex, Lucy, Bouncer)
       → Claude Haiku only — no LM Studio required
       → Read-only — no player chat
       → ?mode=demo URL param

4.2  Performance optimization        (ongoing)
       → Profile 16-NPC think loop under load
       → MEMORY.md auto-summarization (>2KB)
       → Player-chat requests jump the LM Studio queue

4.3  Docker production deploy        (~4 hours)
       → Wire env vars (EMAIL_AUTOSEND, WSL_DISTRO, LM_STUDIO_PARALLEL)
       → Docker HEALTHCHECK endpoint
       → Deploy checklist in docs/DEPLOYMENT.md
```

Total to Phase 4 complete: **~2 days**
