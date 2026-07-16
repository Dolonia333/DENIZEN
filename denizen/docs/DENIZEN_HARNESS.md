# Denizen Harness

**Status:** v1.1 live (2026-07-16)  
**Role:** One control plane for every brain call, skill, mentor inject, and mesh inference path.  
**Not:** a second OpenClaw. OpenClaw is legacy optional I/O only.

### v1.1 quality fixes
- Honest `harnessRate` (streams → `streamParity`, not complete count)
- Per-NPC kind pins override max_tier (Roki chat can use main)
- Daily dual-load pins: Gemma FAST + **Qwen 3.6 27B** MAIN=HEAVY
- Director auto-recovers from scripted demo loop when LM answers again
- `demo_mode` only when no LLM at all; local LM Studio = `localOnly` (not a failure)
- Banner delivery: delayed WS + HTTP `/api/health.director` + 20s poll

## Mental model

| Layer | Owns | Does not own |
|-------|------|----------------|
| **Harness** (`src/denizen-harness/`) | Façade, tiers, sampling gate, loop entry, learning inject, status | Phaser sprites, SOUL prose craft |
| **Jelly** (`jelly/`) | Skill registry + execution | Model selection |
| **npc-brains** | Deep prompt assembly, SOUL/MEMORY, think JSON | Raw multi-provider HTTP sprawl (migrate toward harness.complete) |
| **inference-runtime + router** | LM Studio / Ollama / mesh transport | Skill side effects |

```
Any entry (WS, MCP, Discord, Desktop, /api/harness)
    → loops/   think | chat | director
        → identity/ + context/
        → inference/   complete({ tier, kind, messages })
        → tools/       Jelly only
        → learning/    skill inject + mentor MEMORY
        → observability/
```

## Why this exists

Denizen needs more than a chat gateway:

1. Multi-NPC personas (SOUL / MEMORY / hierarchy)
2. Structured `think()` decisions
3. FAST / MAIN / HEAVY on a **16GB** GPU without wrong-model answers
4. Real work via Jelly skills
5. Mentor consults that land in MEMORY
6. Mesh / desktop / MCP entry points that share one gate
7. Telemetry that can close a learning loop

OpenClaw is a general assistant runtime (~100k+ LOC). Denizen is an **office OS**. The harness is Denizen-shaped.

## Config

`config/denizen-harness.json`

- **tiers** — env pins + fallback patterns  
- **loops** — default tier/kind per loop  
- **learning** — inject skill results / mentor lessons  
- **openclaw** — gateway off by default  

Env pins (also used by LM Studio probe):

```env
LM_STUDIO_FAST_MODEL=google/gemma-4-e2b
LM_STUDIO_MODEL=qwen/qwen3.6-27b
LM_STUDIO_HEAVY_MODEL=qwen/qwen3.6-27b
# optional:
# LM_STUDIO_REASONING_MODEL=...
```

## Public API

```js
const { createDenizenHarness } = require('./src/denizen-harness');

const harness = createDenizenHarness({
  denizenRoot,
  npcBrains,
  jelly,
  runNpcSkill,
  cofounderAgent,
  worldState,
  lmStudioRouter,
  log,
});

// Inference gate
await harness.complete({ tier: 'main', kind: 'chat', messages: [...] });

// Loops
await harness.think('Abby', officeContext);
await harness.chat('Bob', 'Hey', { kind: 'chat' });
await harness.director();

// Tools
await harness.runSkill('Lucy', 'research', { topic: '…' });
harness.listSkills();

// Learning
harness.injectSkillResult('Abby', 'github', summary);
harness.injectLesson('Abby', 'Always verify deploy status', { topic: 'ops' });
harness.injectLearning('Abby', { source: 'mentor', text: '…' });

// Status
await harness.status();
```

`bind({ jelly, runNpcSkill, … })` updates deps if constructed early.

## HTTP

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/harness` | Full status (tiers, pool, skills, intelligence loop) |
| GET | `/api/harness/status` | Alias |
| GET | `/api/harness/skills` | Skill list |
| POST | `/api/harness/complete` | Debug/operator completion (local) |
| GET | `/api/health` | Includes compact `harness` block |

## Module map

```
src/denizen-harness/
  index.js           createDenizenHarness, loadHarnessConfig
  tiers.js           resolveTierModel, tierForKind (anti-2B-main guard)
  inference.js       complete() + telemetry
  tools.js           Jelly / runNpcSkill façade
  learning.js        skill + mentor inject + harness-learning.jsonl
  identity.js        SOUL / MEMORY / roster
  context.js         world-state + business brief slices
  loops.js           think / chat / director adapters
  observability.js   status aggregation
```

## Hardware policy (4070 Ti SUPER 16GB)

Default dual-load:

| Tier | Model | Context |
|------|--------|---------|
| FAST | Gemma E2B | ~8–16k |
| MAIN = HEAVY | Qwen 3.6 27B Q4 | ~12–16k |

Do **not** keep Ministral + Qwen + Gemma all resident at high context. MAIN may equal HEAVY.

`resolveTierModel` promotes away from a tiny “main” if a ≥14B model is in the catalog.

## Migration path

| Phase | State |
|-------|--------|
| 0 Config + façade + status APIs | **Done** |
| 1 Inference gate + heavy tier + sampling/thinking flags | **Done** |
| 2 Wire server create + health | **Done** |
| 3 Route hot paths through `complete()` | **Done** — npc-brains queue, cofounder (heavy), coding-task-runner, mesh `runDirectInference` |
| 4 Thin npc-brains (move assembly to context/ without behavior change) | Later |
| 5 Closed-loop learning metrics UI | Later |
| 6 Optional LoRA on trajectories | Optional |

### Hot-path wiring (2026-07-16)

| Caller | Path |
|--------|------|
| `npc-brains` `_dispatchOneFromQueue` | harness.complete when `setDenizenHarness` bound |
| `cofounder-agent` director | brains queue + preferHeavy → harness; fallback harness/raw |
| `coding-task-runner` LM edits | `getActiveHarness().complete({ kind: 'code', tier: 'heavy' })` |
| `denizen-inference-rpc` direct | harness.complete when non-streaming |

`getActiveHarness()` returns the process-wide instance created at server boot.

## Related docs

- [JELLY_INTEGRATION.md](JELLY_INTEGRATION.md) — tools layer  
- [LOCAL_HARNESS_UPGRADE.md](LOCAL_HARNESS_UPGRADE.md) — quality levers  
- [HARNESS_EVALUATION.md](HARNESS_EVALUATION.md) — why not fork OpenClaw  
- [AI-SYSTEM.md](AI-SYSTEM.md) — think loop details  
- [INTELLIGENCE_SPINE.md](INTELLIGENCE_SPINE.md) — business facts/outcomes  
- [OPENCLAW_INTEGRATION.md](OPENCLAW_INTEGRATION.md) — legacy  

## Tests

```bash
node --test tests/denizen-harness.test.js
```
