# Bouncer — end-to-end security system

**Canonical reference** for threat visualization, multi-node relay, Kali investigations, mesh patrol, visitor gating, and production operations.

> Quick demo script: [BOUNCER_DEMO.md](BOUNCER_DEMO.md)  
> Threat catalog + robber behaviors: [SECURITY.md](SECURITY.md)  
> NPC character role: [NPCS.md](NPCS.md)  
> Spectate world-state scaling: [PHASE5_SCALE_BRIDGE.md](PHASE5_SCALE_BRIDGE.md)  
> Deploy runbook: [../../infra/README.md](../../infra/README.md) § Bouncer / Security deploy

---

## One-sentence summary

Denizen turns real security events into pixel-office robber animations, runs optional Kali-backed investigations through Bouncer, fans threats across NAS followers via Redis, and records every run in Postgres — so operators *see* incidents without reading logs.

---

## Why this exists

| Problem | Solution |
|---------|----------|
| Logs are opaque to non-operators | `SecurityMonitor` + `RobberController` visualize threats as NPCs |
| Docker on NAS cannot run WSL/Kali | Remote **investigation agent** on dolonia (`:8890`) |
| Public spectate (`spectate.dolonia.cloud`) is a read replica | **Redis pubsub** relays `threat` frames from primary → followers |
| NAS cannot TCP-probe every mesh host | **`bouncer_patrol`** compute jobs run on enrolled fleet nodes |
| Demo visitors should not get operator security tools | **Tier gating** in `visitor-access.js` + `visitor-capabilities.js` |
| Investigations need audit trail | **`denizen_bouncer_runs`** table + `reports/security/` artifacts |

---

## Architecture (production topology)

```mermaid
flowchart TB
  subgraph sources [Threat sources]
    SM[SecurityMonitorServer]
    HTTP[HTTP abuse patterns]
    BRAND[Content pipeline brand block]
    TEST[/security-test]
  end

  subgraph primary [NAS primary :8888]
    SM --> BROADCAST[securityMonitor broadcast]
    BROADCAST --> SECWS[/security-ws]
    BROADCAST --> RELAY[denizen-security-relay]
    RELAY --> REDIS[(Redis pubsub)]
    BINV[bouncer-investigation.js]
    PATROL[linux-agent perimeterPatrol]
  end

  subgraph dolonia [dolonia Windows .232]
    AGENT[bouncer-investigation-agent :8890]
    WSL[WSL kali-linux]
    AGENT --> WSL
  end

  subgraph followers [NAS followers :8889 / :8890]
    SUB[world-pubsub subscribe]
    REDIS --> SUB
    SUB --> FSEC[/security-ws local]
    SUB --> AOWS[/agent-ws world_state_batch]
  end

  subgraph mesh [Compute mesh]
    PROD[denizen-compute-producer]
    PROD -->|bouncer_patrol job| NODE[Fleet node]
    NODE --> AGG[denizen-bouncer-patrol-aggregate]
    AGG --> WS[bouncer_patrol_result on agent-ws]
  end

  subgraph browser [Browser client]
    INIT[bouncer-client-init.js]
    INIT --> MON[SecurityMonitor client]
    INIT --> ROBB[RobberController]
    SECWS --> MON
    AOWS --> MON
  end

  BINV -->|BOUNCER_INVESTIGATION_URL| AGENT
  PATROL -->|container mode| BINV
```

---

## How a threat becomes a robber

1. **Detection** — `security-monitor-server.js` polls system/network/file sources (and optional `tshark` on Linux). HTTP middleware and content-pipeline hooks can also call `securityMonitor._emitThreat()`.
2. **Server broadcast** — threat JSON `{ type: 'threat', category, severity, source, detail, threatId }` goes to all `/security-ws` clients and triggers Bouncer server-side logic.
3. **Client init** — `initBouncerSecurity(scene)` in `bouncer-client-init.js` (loaded via `denizen-lazy-scripts.js`) creates one `SecurityMonitor` + `RobberController` per office scene.
4. **Visualization** — `RobberController` maps `category` → archetype (searching, hacking, sneaking, breaking, fleeing). See [SECURITY.md](SECURITY.md) for the full catalog.
5. **Bouncer NPC** — `agent-office-manager.js` confronts robbers, may run Kali investigation, reports to player, escalates to Dan when serious.
6. **Auto-clear** — threats resolve after ~30s; robber walks off-screen; `threat-resolved` event sent.

### Alternate client ingress paths

| Path | When used | Module |
|------|-----------|--------|
| `/security-ws` | Direct connection to server hosting monitor | `security-monitor.js` |
| `agent-ws` message `threat` | Relay / injected frames | `agent-office-manager.js` |
| `agent-ws` `world_state` / `world_state_batch` key `threat` | Spectate follower relay | `agent-office-manager.js` |
| Gateway tool events | OpenClaw/bash/exec tools | `bouncer-client-init.js` `injectGatewayThreats` |

**Production spectate note:** `agent-ws` is the **canonical** relay path on public followers. `/security-ws` through Cloudflare can be flaky; smokes skip it on `spectate.*` hosts unless `SMOKE_STRICT_SECURITY_WS=1`.

---

## Multi-node threat relay

### Why

Followers run with `DENIZEN_SERVER_ROLE=follower` (`IS_RELAY_ONLY`). They do **not** start `SecurityMonitor` locally — but spectators on `spectate.dolonia.cloud` must still see robbers when the primary detects a threat.

### How

| Step | Primary | Follower |
|------|---------|----------|
| 1 | `SecurityMonitor` fires `setOnBroadcast` hook | — |
| 2 | `denizen-security-relay.js` publishes `threat`, `threat-resolved`, `heartbeat` to Redis | — |
| 3 | — | `world-pubsub` subscriber receives frame |
| 4 | — | `relayToSecurityClients(securityWss, frame)` |
| 5 | — | `agent-ws-relay` also embeds threats in `world_state_batch` for office clients |

### Why it works

- Relay frame filter: only `RELAY_TYPES = threat | threat-resolved | heartbeat`
- Primary skips relay hook when `isRelayOnly` (followers don't double-publish)
- Dedup on monitor (`category + source` within 5s) prevents Redis spam

### When it works

| Condition | Required |
|-----------|----------|
| Redis pubsub | `DENIZEN_WORLD_PUBSUB=redis` + `DENIZEN_REDIS_URL` (or `REDIS_URL`) |
| Follower role | `DENIZEN_SERVER_ROLE=follower` on `:8889` / `:8890` |
| Enable script | `py infra/enable-world-pubsub-nas.py` after deploy |
| Client connected | WS open **before** triggering test threat (smoke opens first) |

---

## Investigation paths

Bouncer investigations are **not** the compute mesh. Mesh nodes run `bouncer_patrol` TCP probes; investigations run nmap/ss/journalctl-style commands.

### Decision tree (`bouncer-investigation.js`)

```
investigate(threat)
├── process.platform === 'win32'  → linuxAgent.investigate() in local WSL
├── BOUNCER_INVESTIGATION_URL set → POST /api/bouncer-investigate on remote agent
└── else                          → error (no WSL, no proxy)

perimeterPatrol()
├── win32                           → linuxAgent.perimeterPatrol() (nmap baseline diff)
├── BOUNCER_INVESTIGATION_URL set   → POST /api/bouncer-patrol on remote agent
├── BOUNCER_PATROL=container        → perimeterPatrolContainer() (TCP probes only)
└── else                            → unavailable
```

### Remote investigation agent (dolonia)

| Item | Value |
|------|-------|
| Script | `denizen/scripts/bouncer-investigation-agent.js` |
| Default port | `8890` (`BOUNCER_INVESTIGATION_PORT`) |
| NAS env | `BOUNCER_INVESTIGATION_URL=http://<PC_LAN_IP>:8890` |
| Auth | Optional `BOUNCER_INVESTIGATION_TOKEN` → `Authorization: Bearer` |
| Health | `GET /api/health` → `{ ok, agent, wsl: true }` |
| Windows task | `infra/setup-bouncer-scheduled-task.ps1` |

### Container patrol (NAS Docker)

When the server runs in Linux Docker without WSL:

```env
BOUNCER_PATROL=container
```

`linux-agent.perimeterPatrolContainer()` TCP-probes configured hosts/ports (no nmap in container). Results land in `worldState.bouncerPatrol` and `/api/health` → `bouncer.lastPatrol`.

### Cooldown & dedup

- Default cooldown: `BOUNCER_INVESTIGATION_COOLDOWN_MS=900000` (15 min) per `category:source` key
- `force: true` on threat bypasses cooldown (investor demos, smokes)
- Internal/loopback sources skipped unless forced (`security-ip.js`)

### After investigation completes

`bouncer-investigation.completeInvestigation()`:

1. Writes markdown report → `reports/security/bouncer_*.md` via `npcTools.writeArtifact`
2. `denizenDb.recordBouncerRun()` → `denizen_bouncer_runs`
3. `denizenDb.recordWorkOutput()` → work feed
4. If `investigationIsSerious(result)` → urgent directive to **Dan** + brief to **Abby**
5. Optional CEO announcement via `npcBrains.getResponse`

**Serious verdict logic** (`server.js` `investigationIsSerious`):

- `verdict` containing `THREAT CONFIRMED` / `blocked` → serious
- `LIKELY FALSE POSITIVE` / `inconclusive` / `clear` → not serious
- Fallback: keyword heuristics on `summary` (brute force, many open ports, etc.)

---

## Mesh `bouncer_patrol` jobs

### Why

The NAS container cannot reach every fleet machine's LAN IP. Enrolled mesh nodes probe themselves or peers from inside the network.

### How

| Component | Role |
|-----------|------|
| `denizen-compute-producer.js` | When `BOUNCER_MESH_PATROL=1`, enqueues `bouncer_patrol` per LM Studio router node not already queued |
| `denizen-mesh-job-runner.js` | `case 'bouncer_patrol'` → `runNodePatrol(payload)` |
| `denizen-bouncer-mesh-patrol.js` | TCP probes ports 80/443/1234 (+ URL port); optional `/health` GET |
| `denizen-compute-routes.js` | On job complete → `onBouncerPatrolComplete` |
| `denizen-bouncer-patrol-aggregate.js` | Merges into `worldState.bouncerPatrol.nodes[nodeId]` |
| `server.js` | Broadcasts `bouncer_patrol_result` on `agent-ws` |

### When it works

| Condition | Required |
|-----------|----------|
| Producer enabled | `BOUNCER_MESH_PATROL=1` and mesh producer running |
| Fleet nodes | At least one node registered in LM Studio router / compute registry |
| Node claims job | `nas-compute-agent.js` or desktop agent polling `/api/compute/node/claim` |

---

## Visitor & tier gating

### Server-side (`visitor-access.js`)

Demo tier cannot use:

- `security_feed_read`
- `bouncer_chat_full`
- `restricted_room_pass`

Enforced via `assertTeamFeature(access, feature)` on API routes.

### Client-side (`visitor-capabilities.js`)

| Capability | Allowed when |
|------------|--------------|
| `canUseSecurityFeed()` | Team or CEO tier |
| `canAccessRestrictedRooms()` | CEO, or team **with Citizen badge** |

Citizen badge is set during onboarding (`visitor-onboarding.js` → `denizenBadgeIssued` / profile metadata).

### Bouncer loiter challenge (`agent-office-manager.js`)

If player stays in `manager_office` or `storage` >30s:

| Tier | Behavior |
|------|----------|
| CEO | No challenge |
| Team + Citizen badge | No challenge |
| Demo | One warning: "staff-only in preview mode" |
| Team without badge | Bouncer walks over and challenges (5 min cooldown) |

---

## Scheduled operations

| Job | Env | Schedule | Output |
|-----|-----|----------|--------|
| Perimeter patrol | `BOUNCER_PATROL=container\|wsl` | First after 60s, then every 5 min | `worldState.bouncerPatrol`, `bouncer_patrol_result` WS |
| Daily brief | `BOUNCER_DAILY_BRIEF_MS` (default 24h) | Primary only | `bouncer_daily_brief` WS + `worldState.bouncerDailyBrief` |
| Friday weekly file | `BOUNCER_FRIDAY_BRIEF=1` | Fridays with daily brief | `reports/security/weekly_YYYY-MM-DD.md` |
| Mesh patrol enqueue | `BOUNCER_MESH_PATROL=1` | With mesh producer interval | `bouncer_patrol` compute jobs |

**Skipped on followers:** `IS_RELAY_ONLY` disables local patrol timer and daily brief scheduler.

---

## HTTP API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/security-test` | See [§ Security test auth](#security-test-auth) | Inject synthetic threat |
| POST | `/api/bouncer-scan` | Investigation token or `DENIZEN_FLEET_AGENT_TOKEN` | Manual nmap/tcpdump |
| POST | `/api/bouncer-linux` | Same | Full investigation workflow |
| GET | `/api/health` | Public | `bouncer` block: patrol, relay, investigation URL |

Investigation agent (dolonia):

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/health` | None |
| POST | `/api/bouncer-investigate` | `BOUNCER_INVESTIGATION_TOKEN` if set |
| POST | `/api/bouncer-patrol` | Same |

### Security test auth

`/security-test` is guarded in production and public demo:

| Caller | Allowed |
|--------|---------|
| Loopback | Always |
| CEO session | Yes |
| `x-internal-token` matching `DENIZEN_INTERNAL_API_TOKEN` | Yes |
| `?force=1` with external `source` (not `test`) | Yes (ops smokes) |
| `DENIZEN_SECURITY_TEST_PUBLIC=1` | Anyone |
| Anonymous on public demo | **Blocked** |

Followers proxy `/security-test` to primary (forwards `x-internal-token` header).

---

## WebSocket events

### Server → client (security)

| Type | Meaning |
|------|---------|
| `threat` | New threat — spawn robber |
| `threat-resolved` | Clear threat / despawn |
| `bouncer_tool_status` | Manual scan progress |
| `bouncer_linux_status` | Investigation progress |
| `bouncer_linux_result` | Investigation complete |
| `bouncer_patrol_result` | Patrol or mesh patrol summary |
| `bouncer_daily_brief` | Scheduled daily summary |
| `bouncer_player_order` | Honeypot / confront player order |
| `bouncer_security` | Incident speech line |

### Client → server (Bouncer tools)

| Type | Purpose |
|------|---------|
| `bouncer_run_tool` | `{ tool, threat }` — nmap/wireshark |
| `bouncer_run_linux` | `{ threat, openTerminal? }` — full investigation |

---

## Database

Migration: `supabase/migrations/20260707000001_denizen_bouncer_runs.sql`

### `denizen_bouncer_runs`

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid | Primary key |
| `at` | timestamptz | Run timestamp |
| `threat_category` | text | e.g. `scan_probe`, `api_abuse` |
| `source` | text | IP or agent id |
| `ok` | boolean | Investigation succeeded |
| `report_path` | text | `reports/security/...` if written |
| `patrol_mode` | text | `wsl`, `container`, `mesh`, etc. |
| `node_id` | text | Mesh node id when applicable |
| `elapsed_ms` | integer | Duration |
| `verdict` | text | Structured verdict string |
| `metadata` | jsonb | severity, detail, summary, error |

Also fixes `denizen_security_threats.org_id` linkage for org-scoped queries.

Writer: `denizenDb.recordBouncerRun()` ← `bouncer-investigation.recordBouncerRun()`.

---

## Environment variables

| Variable | Default | Role |
|----------|---------|------|
| `BOUNCER_PATROL` | `wsl` on Windows, else `off` | `container` = NAS TCP patrol; `0`/`off` = disabled |
| `BOUNCER_INVESTIGATION_URL` | — | Remote agent base URL (NAS → dolonia) |
| `BOUNCER_INVESTIGATION_TOKEN` | — | Bearer token for agent + API auth |
| `BOUNCER_INVESTIGATION_COOLDOWN_MS` | `900000` | Per threat-key investigation cooldown |
| `BOUNCER_INVESTIGATION_PORT` | `8890` | Investigation agent listen port |
| `BOUNCER_DAILY_BRIEF_MS` | `86400000` | Daily brief interval |
| `BOUNCER_FRIDAY_BRIEF` | `0` | Write weekly markdown on Fridays |
| `BOUNCER_MESH_PATROL` | `0` | Enqueue mesh patrol jobs |
| `WSL_DISTRO` | `kali-linux` | WSL distro for `_openBouncerTerminal` |
| `DENIZEN_WORLD_PUBSUB` | `memory` | Set `redis` for follower relay |
| `DENIZEN_REDIS_URL` | — | Redis connection string |
| `DENIZEN_WORLD_PUBSUB_CHANNEL` | `denizen:world:broadcast` | Pubsub channel |
| `DENIZEN_SERVER_ROLE` | `primary` | `follower` = relay only |
| `DENIZEN_SECURITY_TEST_PUBLIC` | `0` | Allow anonymous `/security-test` on demo |
| `DENIZEN_INTERNAL_API_TOKEN` | — | `x-internal-token` for smokes |
| `DENIZEN_FLEET_AGENT_TOKEN` | — | Auth for `/api/bouncer-*` |
| `DENIZEN_PUBLIC_DEMO` | — | Enables public-demo security-test guard |
| `ENABLE_TSHARK` | `0` | Live packet monitor (Linux) |
| `ENABLE_SCAN_DETECT` | `1` on Linux | Firewall log scan detector |

---

## Deploy & verify (production)

From repo root — full runbook in [infra/README.md](../../infra/README.md):

```powershell
py infra/patch-denizen-nas-env.py
py infra/recover-denizen-nas-src.py    # or hotfix-sync for JS-only changes
py infra/enable-world-pubsub-nas.py
powershell -File infra/setup-bouncer-scheduled-task.ps1
```

### Smoke tests

```powershell
$env:DENIZEN_URL = 'https://denizen.dolonia.cloud'
$env:FOLLOWER_URL = 'https://spectate.dolonia.cloud'
$env:BOUNCER_INVESTIGATION_URL = 'http://<PC_LAN_IP>:8890'
node denizen/scripts/smoke-bouncer-e2e.js
```

| Script | Purpose |
|--------|---------|
| `smoke-bouncer-e2e.js` | Health, investigation agent, primary security-ws, spectate agent-ws relay |
| `smoke-security-relay-lan.js` | LAN primary threat → relay |
| `smoke-spectate-threat-relay.js` | Spectate-specific relay |

### Unit tests

```bash
cd denizen
node --test tests/denizen-security-relay.test.js \
  tests/bouncer-runs.test.js \
  tests/denizen-bouncer-mesh-patrol.test.js \
  tests/denizen-bouncer-patrol-aggregate.test.js
```

---

## Module reference

| File | Responsibility |
|------|----------------|
| `security-monitor-server.js` | Server-side threat detection + broadcast |
| `src/security-monitor.js` | Browser WS client |
| `src/robber-controller.js` | Threat → sprite animation |
| `src/bouncer-client-init.js` | `initBouncerSecurity(scene)` — single init path |
| `src/denizen-security-relay.js` | Redis threat fan-out |
| `src/denizen-world-pubsub.js` | Redis/memory pubsub driver |
| `src/denizen-agent-ws-relay.js` | Follower agent-ws relay + `IS_RELAY_ONLY` |
| `src/bouncer-investigation.js` | Investigate/patrol routing + DB + escalation |
| `src/linux-agent.js` | WSL/Kali commands, container patrol, reports |
| `scripts/bouncer-investigation-agent.js` | Standalone dolonia HTTP agent |
| `src/denizen-bouncer-mesh-patrol.js` | Per-node TCP/health probes |
| `src/denizen-bouncer-patrol-aggregate.js` | Mesh results → `worldState.bouncerPatrol` |
| `src/agent-office-manager.js` | Bouncer NPC behavior, WS threat inject, loiter |
| `src/denizen-db.js` | `recordBouncerRun()` |
| `server.js` | Routes, timers, auth, brand-block → threat |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No robbers on spectate | Redis off or follower not subscribed | `enable-world-pubsub-nas.py`; check `DENIZEN_WORLD_PUBSUB=redis` |
| `/security-test` 403 | Public demo guard | Use `force=1` + external source, CEO session, or `x-internal-token` |
| Investigation fails on NAS | No WSL in container | Set `BOUNCER_INVESTIGATION_URL`; verify agent `:8890` |
| `investigation agent` smoke fails | Agent not running on dolonia | `setup-bouncer-scheduled-task.ps1` or manual `node scripts/bouncer-investigation-agent.js` |
| Patrol always empty | `BOUNCER_PATROL=off` | Set `container` on NAS or `wsl` on Windows |
| Mesh patrol never runs | Producer off / no nodes | `BOUNCER_MESH_PATROL=1` + enrolled compute node |
| Duplicate investigations | Cooldown | Wait 15 min or use `force: true` |
| `denizen_bouncer_runs` empty | Migration not applied | `py infra/apply-migrations-nas.py` |
| security-ws timeout on spectate | CDN path flaky | Use agent-ws (canonical); see smoke skip logic |

---

## When it works — quick matrix

| Feature | Works when |
|---------|------------|
| Robber on primary | Client loaded; `/security-ws` or `agent-ws` connected |
| Robber on spectate | Redis relay + `agent-ws` open before threat |
| Kali investigation | Windows WSL **or** investigation agent reachable |
| Container patrol | `BOUNCER_PATROL=container` on Linux primary |
| Remote patrol proxy | `BOUNCER_INVESTIGATION_URL` + agent `/api/bouncer-patrol` |
| Dan escalation | Investigation ok + `investigationIsSerious` true |
| DB audit row | Supabase migration applied + `denizenDb` enabled |
| Mesh patrol aggregate | Job completed + `onBouncerPatrolComplete` wired |
| Demo security feed hidden | `canUseSecurityFeed()` false for demo tier |
| Loiter challenge | Non-CEO, no badge, >30s in restricted room |

---

## Related content pipeline hook

Brand violations in the content pipeline call `onBrandBlocked` → `server.js` `_onContentBrandBlocked()` → injects `api_abuse` or `data_breach` threat. This ties marketing compliance to the same visualization path as network threats.

---

## See also

- [SECURITY.md](SECURITY.md) — threat categories, tshark, tuning thresholds
- [BOUNCER_DEMO.md](BOUNCER_DEMO.md) — 60-second investor script
- [COMPUTE_MESH.md](COMPUTE_MESH.md) — WSL Kali vs physical laptop mesh node
- [PHASE5_SCALE_BRIDGE.md](PHASE5_SCALE_BRIDGE.md) — spectate followers + Redis
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) — `denizen_bouncer_runs` in schema map
- [SERVER.md](SERVER.md) — full route table
- [NPCS.md](NPCS.md) — Bouncer SOUL and escalation to Dan
