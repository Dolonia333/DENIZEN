# Denizen Local AI Harness — Upgrade Plan & Handoff

**Author:** Claude (Fable 5 session), 2026-07-14
**Purpose:** Make Denizen's local models behave less "generic," answer hard
questions, do real work, and get measurably better over time — by upgrading the
*harness*, not by pretending a 14B model equals a frontier model.
**Handoff:** This doc is written so Grok CLI (or a future Claude session) can
continue without re-deriving anything. See [§7 Handoff](#7-handoff-for-grok-cli).

---

## 0. The honest framing (read this first)

You asked to "make my local models run like Fable 5." The blunt truth, and the
useful version of it:

- You **cannot** make a local 8B–32B model as *intelligent* as a frontier model.
  Raw reasoning ceiling is set by the weights.
- You **can** close most of the gap that actually shows up as "generic responses"
  and "can't do real work." Industry research is blunt about this: *"A raw model
  may not look smart when chatting with it, but when put in a harness with
  guardrails, skills, and tools, it can do much more."*
  ([Ewerlöf, local LLMs for agentic coding](https://blog.alexewerlof.com/p/local-llms-for-agentic-coding))
- The failures you're seeing are **harness failures**, not weight failures:
  wrong model answering, no sampling control, no structured output on the paths
  that need it, no tool-loop discipline. Those are all fixable here.

**Two layers, don't confuse them:**
- **Jelly** (`denizen/jelly/`) = the *tool execution* layer (skills: research,
  coding-agent, crm, etc.). It dispatches a skill and injects the result. It is
  NOT where model quality lives.
- **The inference layer** (`src/npc-brains.js`, `desktop/src/denizen-inference-runtime.js`,
  `src/lm-studio-router.js`) = where model *quality* lives: prompt assembly,
  sampling, structured output, model routing. **Most of this plan targets the
  inference layer.**

---

## 1. Current state (verified in code, with file:line)

| Area | Current state | Evidence |
|------|---------------|----------|
| **Model routing** | Only two tiers: `fast` / `main`. Both currently resolve to **`gemma-4-e2b`** (a ~2B model) because that's what's loaded — while your 27B/32B models sit unloaded. Hard questions get answered by your *smallest* model. | `/api/health` showed `model: gemma-4-e2b`, `fastModel: gemma-4-e2b`; `resolveRuntimeModel` in [denizen-inference-runtime.js:162](../desktop/src/denizen-inference-runtime.js) |
| **Sampling** | **Only `temperature` (fixed 0.75)** is sent. No `min_p`, `top_p`, `repeat_penalty`, or DRY anywhere. | [denizen-inference-runtime.js:221-227](../desktop/src/denizen-inference-runtime.js); grep of all inference paths |
| **Structured output** | `response_format: json_schema` IS used — but only for the think-loop **decision JSON**. NOT for chat replies, NOT for skills. | [npc-brains.js:3927](../src/npc-brains.js) |
| **Reasoning models** | `enable_thinking: false` is forced **globally**, which neuters your DeepSeek-R1 / Ministral-reasoning models — their whole value is the thinking pass. | [denizen-inference-runtime.js:230](../desktop/src/denizen-inference-runtime.js), [npc-brains.js:3728](../src/npc-brains.js) |
| **Repetition control** | None. Directly causes the Bouncer "Friend. I require a specific…" loops. A post-hoc `_isNearRepeat` retry was added ([npc-brains.js](../src/npc-brains.js)) as a band-aid; the real fix is sampling params. | grep: no `repeat_penalty`/`min_p` |
| **Mentor loop (cloud→local)** | Exists (`consult-grok`, `consult-mentors`, mentor panel). But there is **no evidence it measurably improves local output** — no before/after metric is recorded that survives. `remediation_tracking` exists in the telemetry job but the audit rarely fires. | `grok-consult-queue.jsonl`, `grok-mesh-telemetry-job.py` |
| **Jelly skills** | Solid dispatch layer. Skills run as native JS or legacy subprocess. No per-skill model selection, no structured tool-call contract. | [skill-executor.js](../jelly/skill-executor.js) |

---

## 2. Your actual downloaded models (from LM Studio `/api/v0/models`)

Route by **task**, not one-model-fits-all. Recommended mapping:

| Model | Size | Best for | Notes |
|-------|------|----------|-------|
| `google/gemma-4-e2b` | ~2B | **fast** idle chatter, presence, vision | True VLM (vision works). Too small for hard Qs. |
| `mistralai/mistral-7b-instruct-v0.3` | 7B | fast chat fallback | |
| `meta-llama-3.1-8b-instruct` | 8B | fast chat, tool-calling | Good instruction following |
| `dolphin3.0-llama3.1-8b` | 8B | uncensored/roleplay chatter | Optional persona flavor |
| `qwen2.5-14b-instruct-1m` | 14B | **long-context** work (huge docs, dossiers) | 1M context window |
| `qwen/qwen3.6-27b` | 27B | **main** chat, hard questions, vision | Strongest general model you have; VLM |
| `qwen2.5-vl-32b-instruct` | 32B | (vision — BROKEN) | Vision projector missing in this build; re-download w/ mmproj or don't route vision here |
| `lmstudio-community/deepseek-r1-distill-qwen-32b` | 32B | **reasoning** — hard problems, planning, decisions | Turn thinking ON |
| `deepseek/deepseek-r1-0528-qwen3-8b` | 8B | fast reasoning | Cheaper reasoning tier |
| `text-embedding-nomic-embed-text-v1.5` | — | embeddings / retrieval | For memory search (see §4) |

**Single biggest win:** stop answering hard questions with a 2B model. Load
`qwen3.6-27b` as the `main` tier (or `deepseek-r1-distill-qwen-32b` for
reasoning-heavy NPCs) and keep `gemma-4-e2b` only for `fast` ambient chatter.

---

## 3. Research findings (the levers, cited)

1. **Structured output / constrained decoding** is the #1 reliability lever for
   local models. LM Studio + llama.cpp support `response_format: {type:
   json_schema}` and GBNF grammars; the grammar constrains sampling so output
   *must* fit the schema. Caveat: doesn't guarantee completion if it runs out of
   tokens, and conflicts with some models' control tokens (gpt-oss/Harmony).
   ([llama.cpp grammars](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md),
   [constrained decoding guide](https://www.aidancooper.co.uk/constrained-decoding/))

2. **Sampling parameters** — small models loop without them:
   - **General chat:** temp 0.7–1.0, `top_p` 0.95, `min_p` 0.05.
   - **Code / structured:** temp 0.1–0.4, penalties near 1.0 (repetition is
     legitimate in code).
   - **Repetition:** modern models loop rarely; turn on `repeat_penalty`
     (~1.1) or **DRY** *only where you observe loops* (chat/persona), not on
     code/lists. Different backends apply samplers in different orders — tune on
     the **exact backend** you deploy (LM Studio/llama.cpp).
   ([sampling params guide](https://smcleod.net/2025/04/llm-sampling-parameters-guide/),
   [Local AI Master](https://localaimaster.com/blog/llm-sampling-parameters-explained))

3. **Harness > model.** *"Token explosion, control-flow hallucination, and
   unreliable completion are architectural consequences of assigning deterministic
   work (looping, branching, sequencing) to a probabilistic system."* The program
   should own control flow; the LLM is a component inside it (LLM-as-Code). Denizen
   already does this well (the think loop is code-driven) — extend it to skills.
   ([LLM-as-Code](https://arxiv.org/html/2606.15874v1),
   [awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering))

4. **Speed: speculative decoding.** A small draft model proposes tokens a big
   model verifies in parallel — same output, faster. LM Studio supports draft
   models. Pair `qwen3.6-27b` (target) with a small Qwen draft. For agentic loops,
   *speculative tool calling* (fire cheap stateless tools early) saves more than
   token-level speculation.
   ([speculative tool calls](https://arxiv.org/pdf/2512.15834))

---

## 4. Prioritized roadmap (do in this order)

Each item: **what · why · where · effort · risk**. ✅ = done this session.

### P0 — Route hard questions to a real model (biggest quality win)
- **What:** Make `main` tier = `qwen3.6-27b` (or `deepseek-r1-distill-qwen-32b`);
  keep `gemma-4-e2b` for `fast` only. Set `LM_STUDIO_MODEL` / `LM_STUDIO_FAST_MODEL`
  on the NAS, and ensure the target model is *loaded* in LM Studio (JIT load or
  keep-loaded). Consider per-NPC tier: Bouncer/idle = fast; Abby/Bob/hard = main.
- **Why:** A 2B model answering strategy/GovCon questions = guaranteed generic.
- **Where:** env on NAS container; `resolveProviderConfig`/`pickModelForTier`
  in [lm-studio-router.js:309](../src/lm-studio-router.js); soul `## Provider` lines.
- **Effort:** low (mostly config + LM Studio load). **Risk:** low. Watch VRAM.

### P1 — Add per-task sampling params ✅ (wired; deploy to confirm live)
- **Done:** `src/inference-sampling.js` + `tests/inference-sampling.test.js` (7 tests).
- **Wired (2026-07-14):** all three body builders —
  - [npc-brains.js `_dispatchOneFromQueue` / `_callLocalStream`](../src/npc-brains.js)
  - [desktop/src/denizen-inference-runtime.js](../desktop/src/denizen-inference-runtime.js)
  - [src/denizen-inference-runtime.js](../src/denizen-inference-runtime.js) (mesh `inference_rpc` +
    [denizen-mesh-job-runner.js](../src/denizen-mesh-job-runner.js) + [denizen-inference-rpc.js](../src/denizen-inference-rpc.js))
- **Still TODO:** deploy to NAS and confirm Bouncer repetition loop is gone via live `player_chat`.
- **Why:** Fixes repetition loops at the source; improves coherence.
- **Effort:** low. **Risk:** low (additive fields; LM Studio ignores unknowns).
  NOTE: this changes live NPC behavior — confirm with Zion before deploying.

### P2 — Use reasoning models properly
- **What:** Stop forcing `enable_thinking: false` globally. For NPCs/tasks routed
  to DeepSeek-R1 / Ministral-reasoning, allow the thinking pass, then strip the
  `<think>…</think>` block before display (the `_stripReasoningLeak` helper
  already exists). Add a per-model capability flag `supportsThinking`.
- **Why:** You own 3 reasoning models and currently waste all of them.
- **Where:** [denizen-inference-runtime.js:230](../desktop/src/denizen-inference-runtime.js),
  [npc-brains.js:3728](../src/npc-brains.js), router model metadata.
- **Effort:** med. **Risk:** med (latency up on those models; gate to hard tasks).

### P3 — Structured output for chat + skills
- **What:** Extend `response_format: json_schema` beyond decisions. For skills that
  return structured data (crm, research briefs), define a schema and constrain the
  call. For chat, a light schema `{reply: string, action?: string}` reduces
  reasoning-leak and format drift.
- **Why:** #1 reliability lever per research; kills "code/JSON leaking into chat."
- **Where:** [skill-executor.js](../jelly/skill-executor.js) (pass schema through),
  [npc-brains.js:3927](../src/npc-brains.js) (already the pattern).
- **Effort:** med. **Risk:** med (schema too strict truncates; keep `strict:false`).

### P4 — Make the mentor loop measurably work 🟡 (drainer + awareness wired)
- **Done (2026-07-14):**
  - [src/grok-mentor-drainer.js](../src/grok-mentor-drainer.js) — reads
    `grok-consult-queue.jsonl`, asks Grok CLI, injects via `denizen_npc_memories`,
    logs `consult-improvement-log.jsonl`. Dry-run by default.
  - [scripts/run-grok-mentor-drainer.cjs](../scripts/run-grok-mentor-drainer.cjs) CLI;
    [infra/grok-cli-mentor-drainer.py](../../infra/grok-cli-mentor-drainer.py) for NAS SSH runs.
  - Server cron: `GROK_MENTOR_DRAINER` (default on), `GROK_MENTOR_DRAINER_MS` (default 10m).
  - [src/office-awareness.js](../src/office-awareness.js) — surfaces team snapshot +
    mentor lessons in think() via [npc-brains.js](../src/npc-brains.js).
  - Tests: [tests/local-harness-loop.test.js](../tests/local-harness-loop.test.js).
- **Still TODO:** run `audit-improvements` after a few cycles; confirm locals reference
  `[GROK MENTOR]` memories in think output.

### P5 — Speed: speculative decoding + keep-loaded
- **What:** In LM Studio, attach a small Qwen draft model to the 27B target.
  Keep hot models loaded (avoid JIT reload stalls — several telemetry errors were
  "Model unloaded"/"Failed to load").
- **Why:** Makes the bigger main-tier model usable without latency pain.
- **Where:** LM Studio model load config on `.232`; env `LM_STUDIO_DRAFT_MODEL`.
- **Effort:** low-med. **Risk:** low. Watch VRAM (draft + target co-resident).

### P6 — Retrieval memory (stop dumping full history)
- **What:** Use `nomic-embed` to embed NPC memories; retrieve top-k relevant
  instead of replaying last-N turns. Directly attacks the context_overflow errors.
- **Why:** Context bloat is the #2 friction domain (Bob) and cause of overflow.
- **Where:** memory assembly in `getResponse`/`getPlayerResponse`;
  `denizen-embedding-worker.js` already exists.
- **Effort:** high. **Risk:** med.

---

## 5. Recommended sampling profiles (LM Studio / llama.cpp)

Tune on LM Studio specifically — sampler order differs by backend.

```js
// Proposed: src/inference-sampling.js  (single source of truth)
const SAMPLING_PROFILES = {
  chat:      { temperature: 0.8,  top_p: 0.95, min_p: 0.05, repeat_penalty: 1.1 },
  presence:  { temperature: 0.9,  top_p: 0.95, min_p: 0.05, repeat_penalty: 1.15 }, // idle chatter, most loop-prone
  reasoning: { temperature: 0.6,  top_p: 0.95, min_p: 0.03, repeat_penalty: 1.05 },
  code:      { temperature: 0.2,  top_p: 0.9,  min_p: 0.02, repeat_penalty: 1.0  }, // repetition is legit in code
  decision:  { temperature: 0.4,  top_p: 0.9,  min_p: 0.05, repeat_penalty: 1.05 }, // + response_format json_schema
};
```
Select by the `kind`/`tier` already threaded through `_callProvider`. LM Studio
ignores params it doesn't support, so this is additive and safe.

---

## 6. What NOT to do
- Don't add GBNF grammars to models with special control tokens (gpt-oss/Harmony) —
  it garbles output. json_schema is safer than raw grammar for most cases.
- Don't crank `repeat_penalty` on code/list/data tasks — it breaks legitimate repetition.
- Don't tune sampling on one backend and ship on another.
- Don't expect any of this to make a 14B model *reason* like Fable 5 — it buys
  reliability and task-success, not raw IQ.

---

## 7. Handoff for Grok CLI

**Status at handoff:**
- ✅ Analysis complete (this doc).
- ✅ `src/inference-sampling.js` + tests — **wired into all three inference paths**
  (npc-brains, desktop runtime, server/mesh runtime). Deploy + live verify pending.
- ✅ `src/grok-mentor-drainer.js` + `src/office-awareness.js` + server cron + tests.
- ⏳ P0 (route `main` tier to `qwen3.6-27b`/DeepSeek-R1 instead of the 2B
  `gemma-4-e2b`) — **highest value, do first.** Mostly LM Studio config + env.
- ⏳ P2–P3, P5–P6 — see roadmap.
- ✅ Grok CLI is wired and ready (18 team-MCP tools, `grok -p` one-shot works) —
  see `docs/GROK_CLI_HANDOFF.md`.

**To continue as Grok CLI:**
1. Read this file end to end. The file:line refs are current as of 2026-07-14.
2. Grok CLI setup + exact handoff command: see `docs/GROK_CLI_HANDOFF.md`
   (written by the setup subagent this session).
3. Deploy pattern for the NAS (no full rebuild): copy changed files into the
   running container and restart. See existing `infra/hotfix-*-nas.py` scripts for
   the exact paramiko/docker-cp pattern. SSH creds load via `infra/load_infra_env`.
4. Always run `npm test` (in `denizen/`) before deploying. There are known
   pre-existing failures from concurrent WIP — diff against a clean baseline; don't
   attribute them to your change without checking.
5. Test model routing live via the NAS `/api/health` (`model`/`fastModel` fields)
   and the team MCP `get_inference_nodes` tool.

**Verification for each change:** send a genuinely hard question through the real
chat path (WebSocket `player_chat`) and confirm the answer is specific, not
templated. A generic answer means the wrong model is still serving it (check P0).
