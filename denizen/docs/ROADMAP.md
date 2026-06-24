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

**Status:** 🟡 Scaffolded (`?mode=demo`, 4-NPC roster, read-only chat gate)  
**Files:** `src/demo-roster.js`, `src/public-demo-mode.js`, `server.js`, `office-scene.js`

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

## Phase 5 — Continuous Improvement Loop

NPCs stop being a static cast and start being a team that measurably grows. Abby observes team capability, identifies gaps, and generates novel work to close them. Outcomes feed back into the system as skill points and mood — successes reinforce, failures get diagnosed. The office gets better at its job week over week without operator intervention.

This is the loop that turns Denizen from "AI agents doing tasks" into "AI team learning to do tasks better."

```
NPCs do work → outcome scored → score propagates to NPC (skill +N, mood +N)
                                       ↓
                               team competency map updates
                                       ↓
                  Abby's reflection: where are the gaps?
                                       ↓
                  Abby generates training tasks + proposes new capabilities
                                       ↓
                  NPCs get directives targeted at weak areas
                                       ↓
                  cycle repeats — team grows measurably
```

---

### 5.1 — Outcome Scoring + Team Competency Map

**Status:** 🔴 Not built  
**Files:** `src/outcome-scorer.js` (new), `src/competency-map.js` (new), `src/npc-brains.js`, `server.js`  
**Depends on:** Directive inbox ✅, Task chains ✅, Code proposals ✅

Today every artifact is marked `taskPhase: finished` but nothing distinguishes "done well" from "done badly." Without scoring, NPCs can't actually learn. This sub-phase builds the scoring layer plus the team-wide view of who's strong at what.

**What it builds:**

1. **`src/outcome-scorer.js`** — module that scores every completed unit of work on a 0–5 scale:
   - `5` — chain step completed AND artifact was actually used by next step / code proposal approved / bug confirmed real
   - `4` — completed cleanly, no rework
   - `3` — completed but required clarification / partial result
   - `2` — abandoned (NPC marked `outcome: blocked` or `stuck`)
   - `1` — conflict triggered (another NPC produced contradictory artifact)
   - `0` — failed entirely (skill exec errored, code proposal rejected, exception thrown)

   Score is computed from existing signals: `decision.outcome`, code proposal status, chain advancement, conflict detector hits.

2. **`src/competency-map.js`** — aggregates per-NPC skill scores into a normalized profile:
   ```js
   {
     "Edward": {
       skills: { backend: 8.4, websocket: 5.1, database: 7.2, testing: 2.3 },
       avgOutcome: 4.1,
       artifactCount: 23,
       recentTrend: '+0.4'   // 7-day moving avg delta
     },
     ...
   }
   ```
   Skills come from existing `[SKILL:name:+N]` tags in MEMORY.md, but now they're scaled by outcome scores (a `+1` skill tag on a 5-outcome task = +1.0; on a 2-outcome task = +0.4).

3. **`src/npc-brains.js`** — after `taskPhase: finished`, call `outcomeScorer.score(decision)` → apply mood adjustment (satisfaction +N on high scores, stress +N on low) → update competency map.

4. **`server.js`** endpoints:
   ```
   GET /api/competency-map           — full team profile
   GET /api/competency-map/:npc      — single NPC's profile
   GET /api/competency-map/gaps      — sorted list of team-wide weak areas
   ```

**Why it matters:** Once this lands, you can immediately see "Edward is strongest at backend (8.4), weakest at testing (2.3). Team has no one above 5.0 in design." That visibility is the precondition for everything in 5.2 and 5.3.

**Effort:** ~2 days

---

### 5.2 — Abby Gap-Aware + Training Task Generator

**Status:** 🔴 Not built  
**Files:** `src/cofounder-agent.js`, `src/training-task-generator.js` (new), `src/npc-brains.js`  
**Depends on:** 5.1 (competency map)

Abby today acts on current office state — who's idle, what just happened. She doesn't see capability gaps. This sub-phase makes her gap-aware and gives her the ability to craft novel training tasks targeted at specific NPCs.

**What it builds:**

1. **Inject competency context into Abby's think prompt:**
   ```
   ## Team Competency Snapshot (7-day window)
   - Edward: strong backend (8.4), weak testing (2.3) — trending +0.4
   - Josh: strong frontend (7.1), weak accessibility (1.5)
   - Team-wide gaps: design (top score 4.2 = Rob; no one else above 2.5)
   - Recent low-score artifacts: 3 by Roki this week (avg 2.3)
   
   Consider whether anyone needs a development push.
   ```

2. **`src/training-task-generator.js`** — pure module that, given a target NPC + weak skill area, generates a concrete training directive:
   ```js
   generateTrainingTask({ npc: 'Edward', weakSkill: 'testing' })
   // → {
   //     task: "Read tests/world-state.test.js and write a one-page summary 
   //            of how the suite is structured. File to reports/learning/.",
   //     artifactCategory: 'learning',
   //     successCriteria: 'summary references at least 3 test patterns from the file'
   //   }
   ```
   The generator uses templates per skill area + the NPC's specific role context, so a "testing" training task for Edward (backend dev) differs from one for Josh (frontend).

3. **Abby's `CofounderAgent` gains a new action:** `trainNpc` — assigns a training directive to a target NPC. Logged as a non-urgent directive but tagged `kind: training` so the work feed shows it differently.

4. **Training reports** land in `reports/learning/<npc>_<topic>_<date>.md` — separate from regular work so you can see the team's growth trajectory.

**Why it matters:** Abby goes from a dispatcher of existing work to a manager actively pushing team growth. Within a week of running with 5.2 enabled, you should see measurable competency map shifts for any NPC that had clear weak areas.

**Effort:** ~1.5 days

---

### 5.3 — Autonomous Capability Proposals + Trial-Mode SOUL Edits

**Status:** 🔴 Not built  
**Files:** `src/cofounder-agent.js`, `src/npc-brains.js`, `src/soul-reflection.js`, `server.js`  
**Depends on:** 5.1 (competency map), existing proposal queues ✅

The system already has proposal queues for SOUL edits, capabilities, and animations — but they require explicit operator approval for every change, and only the NPC themselves can propose. This sub-phase lets Abby propose capabilities the team is missing, and lets trustworthy NPCs auto-apply small SOUL edits.

**What it builds:**

1. **Abby auto-proposes capabilities** based on competency map gaps:
   - If `gaps.includes({ skill: 'docVisualization', members: 0 })` (no one strong)
   - AND no existing capability proposal addresses it
   - → Abby posts `POST /api/request-capability { by: 'Abby', verbName: 'whiteboardDraw', description: '...' }`
   - Same budget cap as NPCs (1/day) — Abby isn't exempt; this prevents runaway proposal spam

2. **Trial-mode auto-apply for SOUL edits:**
   - New field on each NPC: `_soulTrustScore` (starts at 0)
   - Every `applied` SOUL edit that doesn't get reverted within 7 days adds +1
   - Every `rejected` SOUL edit subtracts 1
   - When `_soulTrustScore >= 5`:
     - Future SOUL edits from that NPC enter `auto-apply trial mode`
     - The edit applies immediately but is tagged `auto-applied`
     - Operator can revert any auto-applied edit within 24h (decrements trust by 2)
     - After 24h with no revert, the edit is permanent
   - This is opt-in per NPC via a `.env` flag `SOUL_AUTO_APPLY=true` — off by default

3. **Diff-bounded** — auto-apply only triggers for edits that:
   - Add or drop ≤ 2 lines
   - Don't touch `## Provider`, `## Role`, `## Core Identity`
   - Don't reduce the soul file by >10%

4. **REST endpoints:**
   ```
   GET /api/competency-map/proposals      — Abby's auto-generated capability proposals
   GET /api/soul-auto-apply-log           — every auto-applied edit + revert window status
   POST /api/soul-auto-apply/:id/revert   — operator panic button
   ```

**Why it matters:** This is what makes the team measurably evolve without you in the loop daily. Abby identifies missing skills and asks for them. NPCs whose growth proposals have proven good get to evolve faster. The system has memory of trust earned.

**The approval gate stays — but it gets smarter.** Big SOUL changes still require manual approve+apply. Small, frequent, proven-trustworthy edits flow through automatically.

**Effort:** ~2 days

---

### Phase 5 Build Order

```
5.1  Outcome scoring + competency map   (~2 days)
       → src/outcome-scorer.js (new)
       → src/competency-map.js (new)
       → npc-brains.js: score on finish, update map
       → 3 new REST endpoints
       → BLOCKS 5.2 + 5.3

5.2  Abby gap-aware + training tasks    (~1.5 days)
       → cofounder-agent.js: inject competency snapshot
       → src/training-task-generator.js (new)
       → New action: trainNpc
       → reports/learning/ category
       → DEPENDS ON 5.1

5.3  Autonomous capability + trial SOUL  (~2 days)
       → cofounder-agent.js: Abby auto-proposes
       → soul-reflection.js: trust score + auto-apply
       → SOUL_AUTO_APPLY env gate (off by default)
       → DEPENDS ON 5.1
```

**Total to Phase 5 complete: ~5-6 days of focused work.**

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
| Outcome scoring (per-artifact 0–5) | 🔴 Phase 5.1 |
| Team competency map | 🔴 Phase 5.1 |
| Abby gap-aware reflection | 🔴 Phase 5.2 |
| Training task generator (Abby pushes growth) | 🔴 Phase 5.2 |
| Autonomous capability proposals from Abby | 🔴 Phase 5.3 |
| Trial-mode auto-apply for trusted SOUL edits | 🔴 Phase 5.3 |

---

## What's Next

**Two parallel tracks** are open. Phase 4 is operational (demo + production); Phase 5 is the autonomous improvement loop (Abby teaching the team).

### Phase 4 — Production and Demo

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

### Phase 5 — Continuous Improvement Loop

```
5.1  Outcome scoring + competency map   (~2 days) — BLOCKS 5.2 + 5.3
       → src/outcome-scorer.js, src/competency-map.js (new)
       → GET /api/competency-map[/:npc|/gaps]

5.2  Abby gap-aware + training tasks    (~1.5 days)
       → Competency snapshot in Abby's think prompt
       → src/training-task-generator.js (new)
       → New action: trainNpc → reports/learning/

5.3  Autonomous capability + trial SOUL  (~2 days)
       → Abby auto-proposes missing capabilities (1/day budget)
       → SOUL trust score + auto-apply for ≤2-line edits (opt-in via env)
       → Operator revert window (24h) preserves the approval gate
```

Total to Phase 5 complete: **~5–6 days**

**Recommended order:** Phase 5 first (the loop closes the value story), then Phase 4 (productionizes what's already a great demo).
