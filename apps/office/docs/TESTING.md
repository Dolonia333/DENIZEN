# Denizen Testing Guide

Denizen uses a layered test pyramid: focused unit/integration tests, targeted smoke tests, then optional live-system checks.

For deployment steps, pair this with [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md).

## Test pyramid

1. **Unit/integration suites** (`node --test`, fast, deterministic)
2. **Service/API smokes** (`scripts/smoke-*.js`, medium, environment-dependent)
3. **Live external checks** (`robinhood-live-smoke.js`, highest variance, credentials required)

## Core regression command

Primary pre-deploy command:

```powershell
npm run test:visitor
```

Current baseline:

- 12 suite files
- 19 suites
- 80 tests
- 80 pass / 0 fail

## `test:visitor` suite file list

`npm run test:visitor` executes these files:

- `tests/denizen-visitor.test.js`
- `tests/visitor-chat.test.js`
- `tests/visitor-flow.integration.test.js`
- `tests/handoff-notify.test.js`
- `tests/prediction-loop.test.js`
- `tests/mirofish-prediction.test.js`
- `tests/visitor-intelligence.test.js`
- `tests/visitor-access.test.js`
- `tests/denizen-org-policy.test.js`
- `tests/platform-identity-bridge.test.js`
- `tests/roki-trading-spine.test.js`
- `tests/visitor-complete.test.js`

Run visitor + e2e:

```powershell
npm run test:visitor:all
```

## Targeted domain suites

Use these when touching related code:

- **Platform identity bridge**
  - `node --test .\tests\platform-identity-bridge.test.js`
- **Federal pipeline**
  - `node --test .\tests\federal-pipeline.test.js`
- **MiroFish prediction**
  - `node --test .\tests\mirofish-prediction.test.js`
- **Roki trading spine**
  - `node --test .\tests\roki-trading-spine.test.js`

## Smoke scripts

Run smokes against a running Denizen server. Set `DENIZEN_URL` to match your server's `PORT` env (code default `8080`; Dolonia lab uses `8081`):

```powershell
# Default if PORT unset in .env
$env:DENIZEN_URL = "http://127.0.0.1:8080"
node .\scripts\smoke-onboarding.js
node .\scripts\smoke-spine-e2e.js
```

Dolonia lab example (`PORT=8081` in `.env`):

```powershell
$env:DENIZEN_URL = "http://127.0.0.1:8081"
node .\scripts\smoke-onboarding.js
node .\scripts\smoke-spine-e2e.js
```

What they cover:

- `smoke-onboarding.js`: visitor code verification, session creation, anti-spoof checks, claim/handoff restrictions
- `smoke-spine-e2e.js`: health fallback, Job CRM maintenance JSON, prediction summary endpoint

### Compute mesh smokes

Run against a live Denizen server (default `http://127.0.0.1:8081` in the Dolonia lab):

```powershell
$env:DENIZEN_URL = "http://127.0.0.1:8081"
node .\scripts\smoke-mesh-complete.js
node .\scripts\smoke-mesh-jobs-flow.js
node .\scripts\smoke-nas-fleet.js
node .\test-compute-integration.js
```

| Script | Checks |
|--------|--------|
| `smoke-mesh-complete.js` | 13 — session, node register/claim/complete, contribution |
| `smoke-mesh-jobs-flow.js` | 5 — enqueue → queue progress |
| `smoke-nas-fleet.js` | 4 — fleet report token, NAS metrics in health |
| `test-compute-integration.js` | 33 — queue transitions, HTTP routes, mocked DB |

Full mesh deploy + smokes in one command (from repo root):

```powershell
py infra/finish-all-mesh.py
```

See [COMPUTE_MESH.md](COMPUTE_MESH.md) and [../../infra/README.md](../../infra/README.md).

## Robinhood live smoke

Use only when Robinhood auth/token is expected:

```powershell
# Match your server PORT (8080 default, 8081 in Dolonia lab)
$env:DENIZEN_URL = "http://127.0.0.1:8081"
node .\scripts\robinhood-live-smoke.js
```

Behavior:

- If not authenticated, script returns OAuth connect instructions and exits success.
- If authenticated, it validates watchlist and trade-suggestion DB flow and fails on broken live integration.

## Recommended pre-deploy run order

1. `npm run test:visitor`
2. `node .\scripts\verify-production-schema.js`
3. `node .\scripts\smoke-onboarding.js`
4. `node .\scripts\smoke-spine-e2e.js`
5. `node .\scripts\smoke-mesh-complete.js` (when compute mesh is enabled)
6. `node .\scripts\smoke-mesh-jobs-flow.js`
7. `node .\scripts\robinhood-live-smoke.js` (only if Robinhood features are in scope)
8. Run full deploy flow from [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md)
9. Home lab mesh: `py infra/finish-all-mesh.py` from repo root

## Quick pass/fail cues

- **`npm run test:visitor`**: ends with `# pass 80` and `# fail 0`
- **`smoke-onboarding.js`**: final `All <n> smoke checks passed.`
- **`smoke-spine-e2e.js`**: final `Smoke spine summary: pass=<n> fail=0`
- **`robinhood-live-smoke.js`**: JSON `"ok": true` (or OAuth instruction mode when not authenticated)
