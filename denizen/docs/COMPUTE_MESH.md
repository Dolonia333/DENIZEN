# Denizen Compute Mesh

Distributed compute network for Denizen: machines report live hardware metrics, register as worker nodes, claim jobs from a shared queue, execute work (including LM Studio inference on GPU hosts), and award contribution credits.

**Status (Dolonia home lab):** three-node mesh operational — dolonia (host + GPU), Synology NAS, Kali laptop (`hp81081d`).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Denizen server (dolonia :8081)                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Job queue   │  │ Fleet registry│  │ Mesh job producer │ │
│  │ (Supabase)  │  │ (in-memory)   │  │ (auto-enqueue)    │ │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘ │
│         │ claim/complete │ metrics report    │ enqueue   │
└─────────┼────────────────┼───────────────────┼───────────┘
          │                │                   │
    ┌─────┴─────┐    ┌─────┴─────┐       ┌─────┴─────┐
    │ Desktop   │    │ NAS agent │       │ Kali agent│
    │ Electron  │    │ headless  │       │ headless  │
    └───────────┘    └───────────┘       └───────────┘
          │                │                   │
          └────────────────┴───────────────────┘
                    Tailscale / LAN
```

### Job lifecycle

1. **Enqueue** — `POST /api/compute/jobs/enqueue` (internal token or fleet identity)
2. **Claim** — worker polls `POST /api/compute/node/claim` with node token
3. **Execute** — `denizen-mesh-job-runner.js` runs job locally (`npc_think_batch`, `sim_tick`, …)
4. **Complete** — `POST /api/compute/node/complete` → credits ledger updated
5. **Observe** — mesh jobs UI + `/api/compute/node/status` + `/api/health` fleet block

### Job types

| Type | Description | GPU |
|------|-------------|-----|
| `npc_think_batch` | Batch NPC think prompts via LM Studio when reachable; mock fallback otherwise | Host preferred |
| `sim_tick` | Lightweight simulation tick (smoke / test jobs) | Any |

Auto-producer (`denizen-compute-producer.js`) enqueues `npc_think_batch` every 5 minutes when `DENIZEN_FLEET_IDENTITY_ID` or fleet tokens are set.

## WSL Kali vs physical Kali laptop

Denizen uses **two different Kali contexts**. Do not conflate them when debugging agents, SSH, or security scans.

| | **WSL `kali-linux` (on dolonia)** | **Physical Kali laptop `hp81081d`** |
|---|-----------------------------------|-------------------------------------|
| **Purpose** | Bouncer NPC security investigations | Compute mesh headless worker |
| **How it runs** | `wsl -d kali-linux -- bash -c "…"` from `server.js` / `linux-agent.js` | Native Linux on dedicated hardware |
| **Triggered by** | Player asks Bouncer to run nmap, wireshark/tcpdump, etc.; visible terminal via `_openBouncerTerminal()` | `nas-compute-agent.js` polling `POST /api/compute/node/claim` |
| **Network** | Loopback / Windows host networking through WSL | Tailscale IP `100.71.54.109:8081` → dolonia |
| **Machine id** | N/A (ephemeral WSL instance) | `DENIZEN_MACHINE_ID=hp81081d` |
| **Install path** | Commands only — no persistent agent | `~/denizen-agent/` via `infra/pull-install-kali-agent.sh` |
| **Docs** | [SECURITY.md](SECURITY.md) — threat visualization, Bouncer escalation | This doc — fleet nodes, mesh smokes |

**Rule of thumb:** if Bouncer is "running nmap in Kali", that is **WSL on the Windows host**. If a fleet node named `hp81081d` is claiming mesh jobs, that is the **physical laptop** running `nas-compute-agent.js` (same script as the Synology NAS agent, different `DENIZEN_URL` and machine id).

## Fleet nodes

| Node | Role | Agent | Typical URL |
|------|------|-------|-------------|
| **dolonia** | Host — LM Studio, primary inference | Denizen server + optional Desktop | `http://127.0.0.1:8081` |
| **NAS** | Headless worker + Supabase host | `nas-compute-agent.js` | `http://192.168.1.232:8081` (LAN) |
| **Kali** (`hp81081d`) | Headless worker | `nas-compute-agent.js` | `http://100.71.54.109:8081` (Tailscale) |
| **Desktop** | Contributor Electron app | `compute-worker.js` | Wizard-configured |

Remote agents must **not** use `127.0.0.1` or LAN-only URLs unless they are on the same network segment.

## Key source files

| File | Purpose |
|------|---------|
| `src/denizen-compute-queue.js` | Supabase-backed job queue |
| `src/denizen-compute-routes.js` | REST API — register, claim, complete, fleet report, bundle download |
| `src/denizen-compute-producer.js` | Auto mesh job producer |
| `src/denizen-mesh-job-runner.js` | Shared job execution (LM Studio + mock) |
| `src/denizen-fleet-registry.js` | In-memory fleet metrics aggregation |
| `src/denizen-fleet-agent-bundle.js` | Agent tarball builder (delegates to Python tarfile) |
| `src/mesh-jobs-panel.js` | Browser UI panel |
| `scripts/nas-compute-agent.js` | Headless NAS/Kali agent (metrics + worker) |
| `scripts/build-fleet-agent-bundle.py` | Builds `agent-bundle.tar.gz` for pull installs |
| `desktop/compute-worker.js` | Desktop compute loop |
| `desktop/compute-job-runner.js` | Desktop-local job runner (no DB dep) |

## Credits & contribution

Contribution credits reward mesh participants for completed jobs, uptime windows, host stipends (LM Studio / GPU host), and multi-machine fleet bonuses. Credits accrue through a formula layer, are capped per day, settled on a timer, and persisted via the Supabase ledger.

### Module responsibilities

| Module | Responsibility |
|--------|----------------|
| `src/denizen-compute-credits.js` | Pure credit formulas — job payout, uptime, host stipend, fleet bonus; daily caps; spend catalog (`priority_boost`, `queue_skip`); hardware/effort/GPU multipliers |
| `src/denizen-credits.js` | Supabase ledger API — `awardCredits`, `spendCredits`, optimistic balance updates on `denizen_user_identities`, append-only `denizen_credits_ledger` rows |
| `src/denizen-compute-settlement.js` | Periodic settlement loop (default 15 min) — converts contribution windows into uptime/host-stipend grants; awards fleet bonus when multiple machines contribute |
| `src/denizen-contribution-tracker.js` | In-memory sampling — tracks active jobs, hardware windows per machine, daily cap state; `grantWithCap()` before any award lands in the ledger |
| `src/denizen-compute-platform.js` | Visitor/Desktop contribution UI backend — upserts `denizen_node_profiles`, scores hardware, resolves opt-in/contribution level, builds contribution summary for `/api/compute/*` |
| `src/denizen-host-compute.js` | Host-operator detection — loopback/CEO principal flags, LM Studio liveness probe, resolves effective contribution state for the primary GPU host |
| `src/denizen-node-worker.js` | Node registry — register/issue endpoint tokens, heartbeat, list nodes; memory fallback when compute tables are not migrated |
| `src/denizen-node-client.js` | Headless worker HTTP client — claim/complete poll loop used by NAS/Kali agents and bundled into fleet agent tarballs |
| `src/denizen-local-agent.js` | Loopback desktop agent — permission gate (`data/local-agent-permissions.json`), background run approvals for trusted local callers |

### Credit flow

```
fleet report / job complete
        │
        ▼
denizen-contribution-tracker  (samples + daily caps)
        │
        ▼
denizen-compute-credits       (formula: job / uptime / stipend / bonus)
        │
        ▼
denizen-compute-settlement    (15-min timer)
        │
        ▼
denizen-credits               (ledger + balance on identity)
```

Job completion credits are awarded inline in `denizen-compute-routes.js` on `POST /api/compute/node/complete`. Uptime and host stipends settle via `denizen-compute-settlement.js` when contribution windows close.

Probe live credit economy (no secrets printed):

```powershell
py infra/probe-live-unison.py
```

## REST API (compute)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/compute/node/status` | session or public | Queue + fleet summary |
| `POST` | `/api/compute/node/register` | identity | Register compute node, get token |
| `POST` | `/api/compute/node/claim` | node token | Claim next job |
| `POST` | `/api/compute/node/complete` | node token | Mark job done, award credits |
| `POST` | `/api/compute/fleet/report` | `X-Fleet-Agent-Token` | Push live CPU/RAM/GPU metrics |
| `GET` | `/api/compute/fleet/agent-bundle.tar.gz` | `X-Fleet-Agent-Token` | Download headless agent bundle |
| `POST` | `/api/compute/jobs/enqueue` | internal / fleet | Enqueue a job |
| `GET` | `/api/compute/hardware/live` | session | Per-identity fleet hardware view |

Fleet agent token header: `X-Fleet-Agent-Token: <DENIZEN_FLEET_AGENT_TOKEN>`.

Bundle download query params: `machine_id`, `label`, `denizen_url` (critical for remote nodes — embeds reachable server URL in `.env`).

## Environment variables (server)

| Variable | Purpose |
|----------|---------|
| `DENIZEN_FLEET_AGENT_TOKEN` | Shared secret for NAS/Kali metrics + bundle download |
| `DENIZEN_FLEET_IDENTITY_ID` | Identity attached to fleet jobs and agent reports |
| `DENIZEN_FLEET_SESSION_ID` / `DENIZEN_FLEET_SESSION_TOKEN` | Optional session bootstrap |
| `DENIZEN_MESH_JOBS` | `true` to force mesh producer on (auto-on when fleet identity set) |
| `DENIZEN_MESH_JOBS_INTERVAL_MS` | Producer interval (default 300000) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Production** — server DB access bypassing RLS |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | DB connection (NAS self-hosted or cloud) |
| `DENIZEN_INTERNAL_API_TOKEN` | Protects job enqueue in production |
| `PORT` | Server port (8081 in Dolonia lab; desktop discovers dynamically) |

See `.env.production.template` for the full production list.

## Environment variables (headless agent)

Written to `~/denizen-agent/.env` (Kali) or `/volume1/docker/denizen-agent/.env` (NAS):

| Variable | Purpose |
|----------|---------|
| `DENIZEN_URL` | **Must be reachable from the agent machine** (Tailscale IP for Kali) |
| `DENIZEN_IDENTITY_ID` | Fleet identity |
| `DENIZEN_FLEET_AGENT_TOKEN` | Metrics authentication |
| `DENIZEN_MACHINE_ID` | Stable machine id (`hp81081d`, `nas-192.168.1.237`, …) |
| `DENIZEN_AGENT_ROOT` | Install directory (use `$HOME/denizen-agent`, not `~/…` in shell exports) |
| `DENIZEN_NODE_ID` / `DENIZEN_NODE_TOKEN` | Optional; auto-registered and persisted in `.node-credentials.json` |

## Mesh jobs UI

Open from the bottom dock **⬡ mesh** chip, append `?mesh=1` to the URL, or run `DenizenMeshJobs.show()` in the browser console.

Shows pending/running jobs, recent completions, and fleet CPU/RAM.

## Deploying agents

Full infrastructure runbook: **[infra/README.md](../../infra/README.md)**.

### One-command mesh deploy (from dolonia)

```powershell
py infra/finish-all-mesh.py
```

Provisions NAS + Kali bundles, applies migrations, deploys NAS agent, runs smoke tests.

### NAS (Synology)

```powershell
# infra/.env: SYNO_SSH_PASSWORD, SYNO_HOST=192.168.1.237
py infra/provision-nas-agent.py
py infra/deploy-nas-agent.py
py infra/probe-nas-agent.py
```

### Kali (pull install — recommended)

On the Kali machine (`dolo@hp81081d`):

```bash
export DENIZEN_FLEET_AGENT_TOKEN='<from denizen/.env>'
export DENIZEN_PULL_URL='http://100.71.54.109:8081'   # dolonia Tailscale IP
bash infra/pull-install-kali-agent.sh
```

Or manual steps — see [infra/README.md](../../infra/README.md) § Kali.

### Denizen Desktop

1. Build installer: `cd denizen/desktop && npm run build:win`
2. Install `dist-build/Denizen-Setup.exe`
3. Complete setup wizard → compute opt-in
4. Worker uses `compute-worker.js` + bundled `denizen-src` modules

See [desktop/README.md](../desktop/README.md).

### Tailscale

All remote nodes need Tailscale for stable reachability:

```powershell
infra/repair-tailscale.cmd
```

## LM Studio inference pool

When multiple machines run LM Studio, Denizen can **route NPC brains** to the least-loaded GPU instead of always hitting `localhost:1234`.

### How nodes join the pool

1. **Host** — probed every 5s via hardware sampler (`lm_studio` block in live metrics).
2. **Fleet agents** — NAS / Kali / Desktop heartbeats include the same `lm_studio` probe (local `LM_STUDIO_URL` on that machine).
3. **Static remotes** — `LM_STUDIO_REMOTE_URLS=http://pc2:1234,http://pc3:1234` in `denizen/.env`.

### Routing behavior

- `npc-brains.js` calls `lm-studio-router` before each LM Studio request.
- Picks by: reachability, inflight count, GPU util, VRAM (main tier), queue depth (offloads to remotes when host queue ≥ `LM_STUDIO_SATURATED_QUEUE`).
- Player chat (`priority: high`) still prefers the **host** for latency unless the host is saturated.
- Failed remote calls trigger **automatic failover** to the next node.

### APIs / UI

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/compute/inference/nodes` | Router status + scored node list |
| `GET` | `/api/compute/node/status` | Includes `inference` block |
| Mesh panel **⬡** | LM Studio pool section | Live node list |

### Second PC checklist

1. Install LM Studio; load the same model family as the host.
2. LM Studio → Server → listen on **0.0.0.0** (not only localhost) so dolonia can reach it over LAN/Tailscale.
3. Run fleet agent on PC #2 (`nas-compute-agent.js` or Desktop opt-in) **or** add its URL to `LM_STUDIO_REMOTE_URLS`.
4. Set on PC #2 agent: `LM_STUDIO_URL=http://127.0.0.1:1234` (worker uses local GPU for mesh jobs).

Mesh `npc_think_batch` jobs still execute on whichever node **claims** the job (local LM Studio on that worker). The router handles **interactive** NPC inference (chat, think, skills).

## Smoke tests

From `denizen/` with server running on `DENIZEN_URL` (default `http://127.0.0.1:8081`):

```powershell
node scripts/smoke-mesh-complete.js      # 13 checks — register, claim, complete
node scripts/smoke-mesh-jobs-flow.js     # end-to-end enqueue → progress
node scripts/smoke-nas-fleet.js          # fleet report + health
node test-compute-integration.js         # 33 unit + HTTP integration checks
```

## Troubleshooting

### Agent exits: `MODULE_NOT_FOUND` for `denizen-hardware-monitor`

The agent script lives **in** `~/denizen-agent/`, not `denizen/scripts/`. Ensure:

```bash
ls ~/denizen-agent/src/denizen-hardware-monitor.js
export DENIZEN_AGENT_ROOT=$HOME/denizen-agent
```

Pull the latest bundle or use a build with `detectAgentRoot()` (June 2026+).

### Agent exits: `fetch failed` / server shows `127.0.0.1:8081`

`.env` has a loopback URL. Fix:

```bash
sed -i 's|^DENIZEN_URL=.*|DENIZEN_URL=http://100.71.54.109:8081|' ~/denizen-agent/.env
sed -i 's|^DENIZEN_LAN_URL=.*|DENIZEN_LAN_URL=http://100.71.54.109:8081|' ~/denizen-agent/.env
```

Verify reachability: `curl -fsS http://100.71.54.109:8081/api/health | head -c 60`

### Kali agent dies after reboot

No systemd unit yet — restart manually:

```bash
cd ~/denizen-agent && nohup node nas-compute-agent.js >> agent.log 2>&1 &
```

### Jobs stuck in `assigned`

Stale claims from restarted workers. Check `/api/compute/node/status`; restart workers or fail jobs via DB if needed.

### Desktop crash: `Cannot find module '../src/denizen-hardware-monitor'`

Reinstall from latest `Denizen-Setup.exe` (prebuild copies `denizen-src` into the asar).

## Database

Compute tables (migrations `20260606000017`–`20260606000019`, mesh RLS `20260608000001`–`20260608000003`):

- `denizen_compute_jobs` — queue
- `denizen_compute_nodes` — registered workers
- `denizen_credits_ledger` — contribution credits
- `denizen_contribution_daily_totals` — daily rollup

**Production:** set `SUPABASE_SERVICE_ROLE_KEY` on the server; dev NAS may use permissive anon RLS policies — tighten before public launch.

Apply migrations to NAS:

```powershell
py infra/apply-migrations-nas.py
```

## Related docs

- [infra/README.md](../../infra/README.md) — NAS SSH, Kali pull install, Tailscale, orchestrator
- [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md) — cloud deploy + service role
- [TESTING.md](TESTING.md) — smoke script index
- [desktop/README.md](../desktop/README.md) — Electron contributor node
