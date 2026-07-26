# Code Organization Plan

**Created 2026-07-25, against `master` post-v1.7.0-dossier.** Companion to
[TECHNICAL_DOSSIER.md](TECHNICAL_DOSSIER.md) Appendix G — this is the "how we
dig out" document. Phases are ordered by risk: each is independently
shippable, verified by the test suite, and none breaks a `require()` path
without a shim.

## Ground rules

1. **`master` is the single source of truth.** The NAS auto-deploys from it
   (`infra/setup-nas-auto-deploy.py`). Hotfix-by-`docker cp` is dead — if it
   isn't committed, it doesn't exist. `infra/hotfix-*.py` scripts remain only
   for emergencies, and anything hotfixed MUST be committed the same day or
   the next auto-deploy reverts it.
2. **No big-bang moves.** A prior attempt exists on
   `origin/feature/office-hq-tabler-icons` (commit `4e368d6d`, 2026-07-07,
   "move denizen app into apps/office") and was abandoned; 100+ commits have
   diverged since. Do not resurrect it. Moves happen in small, codemod-driven
   batches with the suite green before and after.
3. **Every phase ends with `npm test` at or below the CI baseline**
   (`.github/known-test-failures.txt`) and a deploy that health-checks green.

## Phase 0 — done (2026-07-25)

- Gitignore hygiene: live-data repair reports, probe dumps, runtime approval
  queue, rendered dossier artifacts.
- `server-ci.yml`: regression-gate CI on every push/PR touching `denizen/`.
- Auto-deploy pipeline: `denizen-deployer` container on the NAS polls
  `origin/master`, rebuilds `Dockerfile.production`, `compose up -d`,
  health-checks, rolls back to `:prev` on failure.
- Desktop packaging root cause fixed (`copy-denizen-src.js` whitelist).
- Bouncer auth fail-closed; deploy script no longer writes an env file
  nothing loads.

## Phase 1 — label the world (zero code movement)

**Problem:** `denizen/src/` mixes ~150 browser modules with ~180 server
modules in one flat directory; 18 of the 30 largest files are browser code.
Nobody can tell what runs where without reading the file.

- Generate `src/MODULES.md`: one line per module — `server | browser |
  shared`, one-sentence purpose, who requires it. Derivable mechanically:
  anything reached from `server.js`'s require graph = server; anything
  referenced by `index.html`/`office-scene.js` script tags or dynamic imports
  = browser; both = shared.
- Add the same tag as a first-line comment convention for new files.
- **Acceptance:** every `src/*.js` appears in the manifest; CI check greps
  for unlisted files.

## Phase 2 — archive the one-offs (file moves, no code paths)

- `infra/` has 392 entries; **85 are `_`-prefixed one-off diagnostics** and
  31 are `.log`/`.txt` deploy transcripts. `git mv` them to `infra/archive/`
  (nothing imports them; verify with a grep pass first).
- Delete dead code already verified unreferenced by the dossier surveys:
  `desktop/compute-job-runner.js`, `ecosystem.config.js` (broken PM2 file),
  `src/route-registry.js` + `src/routes/intelligence-routes.js` (imported,
  never called — fold their intent into inline routes or delete).
- **Acceptance:** suite green; `infra/README.md` lists only live scripts.

## Phase 3 — split `src/` into `src/server/`, `src/client/`, `src/shared/`

Using the Phase-1 manifest, move in batches of ~20 with a codemod that
rewrites `require('./x')` → `require('../server/x')` etc., plus a temporary
re-export shim at the old path (`module.exports = require('./server/x')`)
so unknown callers keep working. Batches ordered: leaf modules first,
`npc-brains.js`-adjacent last. Shims deleted one batch behind the moves.

- **Acceptance per batch:** suite green, `node --check` on all moved files,
  auto-deploy health green.

## Phase 4 — decompose `server.js` (13,537 lines)

The pattern already exists and works: `src/denizen-crm-routes.js` and
`src/denizen-compute-routes.js` are prefix-mounted route modules dispatched
early in the request path. Extract the remaining inline groups the same way,
one PR each, in this order (smallest coupling first):

1. Market/trading routes (17 routes — and add auth while extracting)
2. Telemetry/admin routes (14)
3. Bouncer/security routes (already partially helper-gated)
4. Soul-proposal + directive routes (add auth — these are the two most
   autonomy-relevant open writes)
5. Office/world/quest routes
6. Discord presence + billing routes

Each extraction carries its route tests along. Target: `server.js` under
4,000 lines (bootstrap, upgrade routing, prefix mounts, static serving).

## Phase 5 — test hermeticity (`DENIZEN_DATA_DIR`)

The suite currently **mutates live office runtime state**: a 2026-07-25 run
enqueued a pending Bob consult into `data/grok-consult-queue.jsonl`, which
then deterministically fails `npc-local-metrics.test.js` on every later run
(pending entries hard-block re-asks). Fix the class, not the instance:

- Introduce `DENIZEN_DATA_DIR` (default `./data`) resolved in ONE module
  (`src/runtime-paths.js`); every `path.join(__dirname, '..', 'data', ...)`
  goes through it (~40 call sites, mechanical).
- `scripts/run-tests.mjs` sets `DENIZEN_DATA_DIR` to a per-run temp dir.
- **Acceptance:** two consecutive full-suite runs produce identical results
  and `git status` + `data/` mtimes are untouched by tests. Lower the CI
  baseline as the state-dependent failures disappear.

## Phase 6 — repo-level moves (only after 1–5)

Candidates, in this order and only with the pipeline proving each step:
`discord pixel game/` → `assets-packs/` (1,607 files, nothing imports it);
`VisionClaw/` → its own repo (it is not a Denizen client); `denizen/mcps/`
vendored servers → `vendor/`. The `apps/office` monorepo shape from the
abandoned branch is a **maybe-later** — revisit only when Phase 4 has made
`server.js` small enough that the move is mostly renames, not surgery.

## What stays put on purpose

- `npcs/` soul directories (runtime contract: folder name = NPC key).
- `supabase/migrations/` (append-only by policy).
- `jelly/` (self-contained runtime with its own vendor tree).
- `data/` canon files (the 59 runtime-mutated files become relocatable via
  Phase 5 instead of being moved).
