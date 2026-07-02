# Phase 5 Scale Bridge — Gap closure master plan

> Bridges every gap from the scale-hardening overview: spectator relay, follower hardening, client routing, ops, tests.

## Current position (~85% Tier B/C)

| Tier | Focus | Status |
|------|-------|--------|
| **B** | Usable spectator relay | **Done** (B1–B10) |
| **C** | Production 100 WS | **In progress** (C1–C5 shipped; soak on NAS) |
| **D** | Multi-region / multi-primary | Backlog |

---

## Sprint 1 — Full WS relay (Tier B core) ✅

| ID | Gap | Deliverable | Status |
|----|-----|-------------|--------|
| B1 | Only `world_state_batch` on Redis | Publish **all** `/agent-ws` frames from primary | ✅ |
| B2 | Follower runs full sim | `DENIZEN_SERVER_ROLE=follower` skips cofounder, patrol, think wake | ✅ |
| B3 | Late join empty office | WS connect + `/api/world-state` proxy to primary | ✅ |
| B4 | Client same-origin WS only | `DENIZEN_SPECTATE_WS_URL` + `/api/public/runtime-config` | ✅ |
| B5 | Mutations on follower | Reject mutating WS on follower | ✅ `spectate_readonly` |
| B6 | Tests | `denizen-agent-ws-relay.test.js` | ✅ |

---

## Sprint 2 — Public spectate path (Tier B finish) ✅

| ID | Gap | Deliverable | Status |
|----|-----|-------------|--------|
| B7 | No public tunnel to `:8889` | `infra/provision-spectate-tunnel.py` + probe | ✅ `spectate.dolonia.cloud` |
| B8 | No E2E proof | `scripts/smoke-spectate-relay.js` live Redis frame | ✅ |
| B9 | `enable-world-pubsub-nas.py` env | Spectate URLs survive redeploy | ✅ |
| B10 | WS full UX | `spectate-ui.js` banner, 1013, readonly toast | ✅ |

---

## Sprint 3 — Production scale (Tier C)

| ID | Gap | Deliverable | Status |
|----|-----|-------------|--------|
| C1 | Single follower | Multi-follower `8889` + `8890` in `enable-world-pubsub-nas.py` | ✅ |
| C2 | Sticky routing | Client random-pool + CF LB doc below | ✅ client pool |
| C3 | Redis SPOF | AOF in `provision-redis-nas.py` + persistence probe | ✅ |
| C4 | Load soak | `scripts/ws-load-soak.js` | ✅ |
| C5 | Monitoring | `/api/health` → `ws.utilization`, pubsub `metrics` | ✅ |
| C6 | Failover drill | `infra/health-failover-nas.py` + reconnect banner | ✅ |

---

## Sprint 4 — Inference & desktop (parallel / backlog)

| ID | Gap | Track |
|----|-----|-------|
| A4-full | llama.cpp installer | `fetch-llama-server.js`, `llama-brain-pull.js`, wizard GGUF | ✅ |
| Haiku demo | `DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY` on NAS | `patch-denizen-nas-env.py` |

---

## Cloudflare spectate pool (C2)

Two public hostnames → two follower ports:

| Hostname | Origin | WS |
|----------|--------|-----|
| `spectate.dolonia.cloud` | `http://NAS:8889` | `wss://spectate.dolonia.cloud/agent-ws` |
| `spectate2.dolonia.cloud` | `http://NAS:8890` | `wss://spectate2.dolonia.cloud/agent-ws` |

Clients read `spectateWsUrls` from runtime-config and pick one at connect (sticky per session). For true stickiness at the edge, add Cloudflare Load Balancing with **session affinity** on each spectate hostname.

```powershell
py infra/provision-spectate-tunnel.py   # both hostnames + DNS
py infra/enable-world-pubsub-nas.py     # primary + 2 followers
```

---

## Commands

```powershell
cd denizen
node --test tests/denizen-agent-ws-relay.test.js
node scripts/smoke-spectate-relay.js
node scripts/ws-load-soak.js
COUNT=30 node scripts/ws-load-soak.js

py infra/deploy-denizen-to-nas.py --remote-build
py infra/provision-redis-nas.py
py infra/provision-spectate-tunnel.py
py infra/enable-world-pubsub-nas.py
py infra/probe-spectate-nas.py
py infra/health-failover-nas.py
```

## Definition of done (Tier B) ✅

1. Remote user on spectate hostname sees live NPC movement
2. Follower does not run cofounder/NPC think loops
3. Automated smoke proves Redis relay frame
4. B1–B10 checked off

## Definition of done (Tier C)

1. Soak test: 50+50 WS across primary + follower, <5% disconnect — run on NAS
2. Two followers behind two hostnames — **shipped**
3. Failover runbook executed once with notes — use `health-failover-nas.py`
