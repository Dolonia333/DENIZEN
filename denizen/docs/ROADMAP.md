# Denizen — Capability Roadmap

Everything the NPCs can do, everything they will be able to do, in order of what to build next.

---

## Current State (Done)

- ✅ 16 autonomous AI NPCs with real language model inference
- ✅ Physical movement in pixel office: walk, sit, stand, join meetings, patrol
- ✅ Persistent memory per NPC (MEMORY.md, survives restarts)
- ✅ Soul files (SOUL.md) — personality, role, provider, backstory
- ✅ Company context injected into every think prompt (company-brief.json)
- ✅ Real code awareness — each NPC reads relevant source file snippets
- ✅ Real artifact output — NPCs write markdown reports to `reports/` on disk
- ✅ Live system data for DevOps/IT/Security (server health, disk, processes)
- ✅ Bouncer's Kali Linux investigations (nmap, ss, netstat, journalctl, whois, tcpdump)
- ✅ Bouncer's Windows Terminal window showing live commands
- ✅ Task cascade system — Abby's decision ripples down to direct reports
- ✅ OpenClaw skills context injected into Lucy, Bouncer, Abby, Dan, Oscar think prompts
- ✅ LM Studio parallel inference (LM_STUDIO_PARALLEL env var)
- ✅ windowsHide on all WSL exec() calls
- ✅ gateway-bridge reconnect cap (stops spamming after 5 failed attempts)
- ✅ NpcTools: Level 1 (code read), Level 2 (artifact write), Level 3 (safe commands)
- ✅ Desktop agent abort flag + /api/desktop-abort endpoint

---

## Phase 1 — Close the Gaps (Do First)

These are either missing infrastructure or one-step wiring jobs. High payoff, low risk.

---

### 1.1 — Create Marcus and Sarah SOUL.md files

**Status:** 🔴 Missing entirely  
**Files:** `npcs/marcus/SOUL.md`, `npcs/sarah/SOUL.md`  
**Why:** Marcus and Sarah exist in the hierarchy, the company brief, and the org chart — but have no personality. They currently run as empty shells. Every think cycle for them fails to load a soul.

**Marcus (Project Manager):**
- Personality: organized, calm, direct. Sprint health is his job. Doesn't build — he unblocks.
- Provider: Claude Haiku
- Manages: nobody. Coordinates everyone.
- Backstory: former startup founder who realized he was better at keeping others on track than building himself. Runs standups in eight minutes. Has strong opinions about how estimates should be given.

**Sarah (Product Manager):**
- Personality: user-obsessed, decisive, commercially aware. Defines what gets built. Alex decides how.
- Provider: Claude Haiku
- Manages: nobody. Informs everyone.
- Backstory: came from a growth/product role at a SaaS company. Sees everything through the lens of "does this solve a real problem." Pushes back on features that look cool but have no clear user.

---

### 1.2 — NPC → OpenClaw Skill Bridge

**Status:** 🔴 Not wired  
**Files:** `server.js`, `src/npc-brains.js`, `src/agent-office-manager.js`  
**Why:** NPCs know about OpenClaw skills but cannot execute them. When Lucy says "I'll use job-applier," nothing happens. This is the single highest-leverage missing piece.

**How it works:**
1. Add new action to NPC JSON vocabulary: `"action": "run_skill"`
2. NPC outputs: `{"action":"run_skill","skill":"job-scraper","params":{"query":"senior AI engineer"},"message":"Searching LinkedIn for AI roles..."}`
3. `server.js` handles `run_skill` in the `npc_think` path — calls OpenClaw gateway's `skill.run` method
4. OpenClaw executes the skill (e.g., job-scraper searches LinkedIn)
5. Result comes back — server injects it as a `skill_result` into the NPC's next think cycle context
6. NPC reports findings, writes artifact

**Who uses it:**
- Lucy → `job-scraper`, `job-applier`, `resume-generator`, `pdf-generator`
- Bouncer → `browserclaw` (investigate suspicious URLs)
- Alex/Jenny → `github` (PR review, CI check)
- Bob → `browserclaw` (research papers), `visionclaw`
- Dan → `lm-studio` (manage models)
- Oscar → `github` (CI status), `supabase-bridge` (metrics)
- Pier → `supabase-bridge` (pipeline queries)

**Result:** NPCs go from talking about work to doing real work through OpenClaw.

---

### 1.3 — Mood System

**Status:** 🔴 Not built  
**Files:** `src/npc-brains.js`, `src/agent-office-manager.js`  
**Why:** All NPCs are emotionally flat. Moods make behavior feel real.

**How it works:**
- Each NPC has a `mood` field: `neutral | focused | energized | frustrated | tired | excited`
- Mood shifts based on events:
  - Task finished → `energized` or `satisfied`
  - Blocked / stuck → `frustrated`
  - 3+ consecutive work cycles → `tired`
  - CEO talks to them → `energized`
  - Bug filed against their code → `frustrated`
  - Meeting called → varies by NPC personality
- Mood is injected into the think prompt: `"Your current mood: frustrated (you've been blocked on this for two cycles)"`
- Mood affects:
  - Speech style (Abby frustrated: clipped sentences; Josh excited: more exclamation points)
  - Action weights (tired NPCs favor `break` and `coffee` over `work`)
  - Status dot color variation (optional)

---

### 1.4 — Real Directive Inbox

**Status:** 🟡 Partial (cascade exists, but not mandatory)  
**Files:** `src/npc-brains.js`, `server.js`  
**Why:** When Abby assigns Alex a task, it's a cascade message — Alex might ignore it based on his think cycle. Real directives should be mandatory.

**How it works:**
- New field in NPC state: `_mandatoryDirective: { from, task, ts }`
- When Abby outputs `{"action":"delegate","target":"Alex","task":"fix the WebSocket deduplication bug"}`, server writes the directive to Alex's state
- Alex's next think prompt prepends: `## DIRECT ORDER FROM ABBY\nFix the WebSocket deduplication bug. This is your current task. Report back when finished.`
- After Alex finishes (`taskPhase: finished`), directive is cleared and he auto-reports back to Abby

---

### 1.5 — Email Auto-Send for Lucy

**Status:** 🟡 Draft-only (infrastructure exists)  
**Files:** `src/email-handler.js`, `npcs/lucy/SOUL.md`  
**Why:** Lucy's email handler creates Gmail drafts but never sends. Flip the flag and add proper escalation logic.

**How it works:**
- Set `EMAIL_AUTOSEND=true` in `.env` for low-stakes replies (confirmations, acknowledgements)
- Escalation keywords (contract, NDA, payment, legal) always stay as drafts for Zion review
- Lucy's think cycle checks for pending email tasks and processes them
- After sending, Lucy walks to her desk and notes it in her memory

---

### 1.6 — GitHub Actions for Alex and Jenny

**Status:** 🟡 Skill exists, not wired to NPCs  
**Files:** `src/npc-brains.js`, `src/npc-tools.js`  
**Why:** Alex and Jenny review code but can't touch the actual repo. With the skill bridge (1.2), they can.

**What they'd do:**
- Alex: `gh pr list`, comment on PRs, check CI runs
- Jenny: `gh pr review`, approve/request changes
- Both: `gh issue create` when they find something

---

## Phase 2 — Real Task Execution

NPCs cross the line from simulation into doing actual work.

---

### 2.1 — Lucy's Job Application Pipeline

**Status:** 🟡 Code exists, not end-to-end  
**Files:** `src/job-application.js`, `src/email-handler.js`, OpenClaw skills  
**Depends on:** 1.2 (skill bridge), 1.5 (email send)

**Full pipeline:**
1. Lucy scrapes job listings via `job-scraper` (LinkedIn/Indeed/Greenhouse)
2. Filters by role match against `data/user-profile.json`
3. Generates tailored resume via `resume-generator`
4. Generates cover letter (< 5 seconds target)
5. Applies via `job-applier`
6. Logs to `data/job-application-log.json` and `reports/admin/`
7. Updates Zion via the work output feed

**Trigger:** Lucy's think cycle, cron job, or CEO talking to Lucy ("find me some roles")

---

### 2.2 — Browserclaw for Bob and Dan

**Status:** 🔴 Not wired  
**Depends on:** 1.2 (skill bridge)

**Bob** uses browserclaw to:
- Research papers on AI agent patterns, LLM benchmarks
- Find GitHub repos related to NPC behavior
- Look up documentation
- Saves findings to `reports/research/`

**Dan** uses browserclaw to:
- Look up fixes for LM Studio errors
- Check changelogs and release notes
- Pull documentation for Node.js or WSL issues
- Saves findings to `reports/it-reports/`

---

### 2.3 — Supabase Logging via Pier

**Status:** 🔴 Not wired  
**Depends on:** 1.2 (skill bridge)

**Pier** builds and maintains:
- NPC decision log table — every think cycle result persisted to Supabase
- LM Studio inference metrics — latency, token counts, model load
- Task completion log — when NPCs finish tasks, what they produced
- Queryable via `supabase-bridge` skill

**What this unlocks:**
- Analytics dashboard showing NPC activity over time
- Replay any NPC's decision history
- Spot which NPCs are most/least active
- LM Studio performance data over time

---

### 2.4 — Bouncer Enhanced Investigation

**Status:** 🟡 Kali tools work, result not used deeply  

**Enhancements:**
- Bouncer writes full investigation reports to `reports/security/` with structured findings
- After investigation, briefing message to CEO includes specific IPs, commands run, findings
- If threat is confirmed serious, Bouncer escalates to Dan (IT) via directive inbox
- `perimeterPatrol()` results compared against baseline — alert if new ports open
- Honeypot integration: Bouncer monitors a fake service and logs anything that touches it

---

### 2.5 — Work Output Feed Panel

**Status:** 🔴 Not built in UI  
**Files:** `office-scene.js`, `server.js` (npc_work_output event exists)

The `npc_work_output` WebSocket event already fires. What's missing is the UI panel.

**How it works:**
- Bottom-left HUD panel shows a live scrolling feed: `▶ Molly starting: regression test for proximity cooldown`
- Each entry shows NPC name, task phase emoji (▶ ⟳ ✓), and the note
- Clicking an entry jumps camera to that NPC
- Color-coded by NPC role (engineering = blue, QA = yellow, security = red, etc.)
- Design: subtle, dark, not a dashboard — feels like a terminal tail

---

## Phase 3 — Deep Integration

NPCs do complex multi-step real work.

---

### 3.1 — NPCs Run Claude Code on Real Files

**Status:** 🔴 Needs architecture  

**How it works:**
- Alex or Edward outputs `{"action":"run_skill","skill":"coding-agent","params":{"task":"fix the WebSocket deduplication in server.js","file":"denizen/server.js"}}`
- Server creates an isolated git worktree for the NPC
- `coding-agent` skill runs Claude Code on that worktree
- Result (diff, test output) comes back to the NPC's next think cycle
- NPC reviews it, either applies or rejects, files a code review artifact
- Proposed changes sit in `reports/code-reviews/` for Zion to approve

**Guardrails:**
- NPCs never push to main directly — all changes go through a review artifact
- Worktrees are isolated per NPC per task
- Code changes require human approval before merge

---

### 3.2 — Cross-NPC Real Task Chains

**Status:** 🔴 Needs architecture  
**Depends on:** 1.4 (directive inbox), 3.1 (coding agent)

**Full chain example:**
1. Abby decides: "Fix the speech bubble overflow on long lines"
2. Directive → Sarah: "Spec this fix — what exactly is overflow, what's acceptable?"
3. Sarah writes spec → artifact in `reports/pm-reports/`
4. Directive → Rob: "Design the fix — mockup the correct behavior"
5. Rob writes mockup → artifact in `reports/design/`
6. Directive → Josh: "Implement per Rob's mockup"
7. Josh runs coding-agent → diff produced
8. Directive → Jenny: "Review Josh's PR"
9. Jenny reviews → approves or requests changes
10. Directive → Molly: "Test the fix"
11. Molly runs regression test → bug report or sign-off
12. Chain complete → Abby gets final report

This is an entire sprint task flowing through real NPCs with real artifacts at each stage.

---

### 3.3 — NPC Disagreement and Escalation

**Status:** 🔴 Speculative  

**How it works:**
- When two NPCs have conflicting decisions (e.g., Edward wants to refactor, Jenny says "too risky pre-release"), they can escalate to Abby
- Abby's next think cycle includes both positions and makes a call
- The decision is logged and both NPCs follow it
- Makes the office feel like a real team with opinions, not just a set of yes-NPCs

---

## Phase 4 — Production and Demo

---

### 4.1 — Public Demo Mode

**Status:** 🔴 Not built  

**What it is:**
- Simplified 4-NPC roster: Abby, Alex, Lucy, Bouncer
- Runs without LM Studio — all NPCs use Claude Haiku (fast, cheap)
- No OpenClaw dependency
- Read-only — visitor can watch but not interact
- Hosted version at `demo.denizen.ai` or similar

**URL:** `http://localhost:8080/?mode=demo`

---

### 4.2 — Performance Optimization

**Status:** 🟡 Ongoing  

- Profile 16-NPC think loop under sustained load
- Reduce prompt token count for LM Studio NPCs (they're most latency-sensitive)
- Memory compression — MEMORY.md files that get too long need automatic summarization
- Request queue priority: player-chat requests jump the queue

---

### 4.3 — Docker Production Deploy

**Status:** 🟡 Scaffolded (Dockerfile + docker-compose.yml exist)  

- Wire LM_STUDIO_PARALLEL into Docker env
- Health check endpoint wired to Docker HEALTHCHECK
- PM2 config updated with current env vars
- Deploy checklist in docs/DEPLOYMENT.md

---

## Capability Matrix — Now vs. Roadmap

| Capability | Now | Phase 1 | Phase 2 | Phase 3 |
|-----------|-----|---------|---------|---------|
| Walk/sit/talk in office | ✅ | — | — | — |
| Real AI conversations | ✅ | — | — | — |
| Persistent memory | ✅ | — | — | — |
| Read real code | ✅ | — | — | — |
| Write markdown artifacts | ✅ | — | — | — |
| Bouncer Kali investigation | ✅ | — | — | — |
| Live system data (DevOps/IT) | ✅ | — | — | — |
| OpenClaw skill execution | — | ✅ 1.2 | — | — |
| Mood system | — | ✅ 1.3 | — | — |
| Mandatory task directives | — | ✅ 1.4 | — | — |
| Email auto-send (Lucy) | — | ✅ 1.5 | — | — |
| GitHub PR/issue actions | — | ✅ 1.6 | — | — |
| Marcus + Sarah soul files | — | ✅ 1.1 | — | — |
| Full job pipeline (Lucy) | — | — | ✅ 2.1 | — |
| Web research (Bob/Dan) | — | — | ✅ 2.2 | — |
| Supabase NPC logging (Pier) | — | — | ✅ 2.3 | — |
| Work output feed panel | — | — | ✅ 2.5 | — |
| NPCs run Claude Code | — | — | — | ✅ 3.1 |
| Full task chain (spec→code→QA) | — | — | — | ✅ 3.2 |
| NPC disagreement/escalation | — | — | — | ✅ 3.3 |
| Public demo mode | — | — | — | ✅ 4.1 |

---

## Order to Build

```
1.1  Marcus + Sarah SOUL.md          (30 min — just writing)
1.3  Mood system                     (2 hours — state + prompt injection + action weights)
1.4  Real directive inbox            (2 hours — state field + prompt injection + auto-report)
1.2  NPC → OpenClaw skill bridge     (4 hours — new action, WS handler, result injection)
1.5  Lucy email auto-send            (1 hour — flip flag + escalation logic)
1.6  GitHub for Alex/Jenny           (1 hour — depends on 1.2)
2.1  Lucy job pipeline               (3 hours — depends on 1.2 + 1.5)
2.2  Browserclaw for Bob/Dan         (1 hour — depends on 1.2)
2.3  Pier Supabase logging           (3 hours — schema + skill calls + dashboard query)
2.4  Bouncer investigation upgrade   (2 hours — structured reports + escalation)
2.5  Work output feed UI panel       (3 hours — Phaser HUD component)
3.1  NPCs run Claude Code            (1 day — worktree isolation + coding-agent integration)
3.2  Cross-NPC task chains           (2 days — depends on all Phase 1+2)
3.3  NPC disagreement/escalation     (1 day — depends on 3.2)
4.1  Public demo mode                (1 day — stripped roster + Claude-only + read-only UI)
4.2  Performance optimization        (ongoing)
4.3  Docker deploy                   (4 hours — env wiring + health check + checklist)
```

Total estimated time to Phase 2 complete: **~20 hours of focused work**  
Total to Phase 3: **~30 hours**  
Total to Phase 4 (demo-ready): **~35 hours**
