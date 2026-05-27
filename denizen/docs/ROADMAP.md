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

---

## Phase 3 — Deep Integration

NPCs do complex multi-step real work. The office stops being a simulation and starts being a real dev team.

---

### 3.1 — NPCs Run Claude Code on Real Files

**Status:** 🔴 Needs architecture  
**Files:** `server.js`, `src/npc-brains.js`, new `src/coding-task-runner.js`  
**Depends on:** Skill bridge ✅ (done)

**How it works:**
1. Alex or Edward outputs `{"action":"run_skill","skill":"coding-agent","skillParams":{"task":"fix the WebSocket deduplication in server.js","file":"denizen/server.js"}}`
2. Server creates an isolated git worktree for the NPC (`git worktree add`)
3. `coding-agent` skill runs Claude Code on that worktree with the task description
4. Diff + test output come back as skill result → injected into NPC's next think cycle
5. NPC reviews it, files a code review artifact, proposes merge
6. Proposed changes sit in `reports/code-reviews/<npc>_<task>_<date>.md` for Zion to approve

**Guardrails:**
- NPCs never push to main directly — all changes go through a review artifact
- Worktrees are isolated per NPC per task, auto-deleted after review
- No NPC can modify its own soul file or memory file via coding-agent
- Code changes require human approval before merge

**Effort:** ~1 day

---

### 3.2 — Cross-NPC Real Task Chains

**Status:** 🔴 Needs architecture  
**Depends on:** Directive inbox ✅ (done), 3.1 (coding agent)

**Full chain example (speech bubble overflow fix):**

```
Abby decides: "Fix the speech bubble overflow on long lines"
  → directive → Sarah: "Spec this — what's overflow, what's acceptable?"
  → Sarah writes spec → reports/product/sarah_bubble_overflow_spec_<date>.md
  → directive → Rob: "Design the fix — mockup correct behavior"
  → Rob writes mockup → reports/design/rob_bubble_overflow_<date>.md
  → directive → Josh: "Implement per Rob's spec"
  → Josh runs coding-agent → diff produced
  → directive → Jenny: "Review Josh's PR"
  → Jenny reviews → approves or requests changes → reports/code-reviews/jenny_<pr>_<date>.md
  → directive → Molly: "Test the fix"
  → Molly runs regression → reports/bugs/molly_<test>_<date>.md or sign-off
  → Abby receives final report
```

This is an entire sprint task flowing through real NPCs with real artifacts at every stage. The directive inbox (done) handles the handoff chain; 3.1 (coding agent) handles the actual code change.

**Effort:** ~2 days

---

### 3.3 — NPC Disagreement and Escalation

**Status:** 🔴 Speculative  
**Depends on:** 3.2

**How it works:**
- When two NPCs have conflicting positions (e.g., Edward wants to refactor before the release; Jenny says "too risky, scope it for next sprint"), they both flag their position in their artifact
- The conflict is detected server-side and injected into Abby's next think context: both positions summarized
- Abby makes a call; her decision is logged and broadcast to both NPCs as directives
- Both NPCs acknowledge and follow the decision
- Makes the office feel like a real team with opinions, not just a set of yes-NPCs

**Effort:** ~1 day

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
| NPCs run Claude Code on real files | 🔴 Phase 3.1 |
| Full task chain (spec→code→QA) | 🔴 Phase 3.2 |
| NPC disagreement/escalation | 🔴 Phase 3.3 |
| Public demo mode (4-NPC, Claude-only) | 🔴 Phase 4.1 |
| Performance optimization | 🟡 Phase 4.2 — ongoing |
| Docker production deploy | 🟡 Phase 4.3 — scaffolded |

---

## What's Next (Phase 3 Build Order)

```
3.1  NPCs run Claude Code on real files     (~1 day)
       → server.js: worktree creation + coding-agent routing
       → src/coding-task-runner.js: new module
       → Guardrails: no self-modification, human-approval gate

3.2  Cross-NPC real task chains             (~2 days)
       → Depends on: directive inbox ✅, 3.1
       → Full spec→code→QA pipeline through real NPCs
       → Each handoff produces a real artifact

3.3  NPC disagreement and escalation        (~1 day)
       → Depends on: 3.2
       → Conflict detection + Abby arbitration
```

Total to Phase 3 complete: **~4 days**  
Total to Phase 4 (demo-ready): **~5-6 days**
