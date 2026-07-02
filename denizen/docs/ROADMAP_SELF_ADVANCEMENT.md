[Previous content...]

## NAS Host Environment Friction Injection (Synology background tasks visibility)

Wired NAS background tasks (infra/grok-mesh-telemetry-job.py, denizen-fleet-ops.py) to record friction so agents see the actual host they run on.

### How
- Python scripts call record_nas_friction(domain, severity, note) on errors/failures (e.g. analyzer fail, no telemetry, MCP inject fail, no baselines).
- Writes to data/nas-friction.jsonl
- In JS: loadNasFriction() merges into getFrictionScore as 'nas_*' domains (with decay).
- In think telemetryContext: adds ## Host Environment (NAS/Synology friction...) block for NPC awareness.

### Why
Gives NPCs (esp. system/fleet ones) visibility into real infra (latency jobs, MCP, audits) so they can autonomously build fixes for host issues (e.g. telemetry scripts, fleet ops).

Domains like nas_telemetry, nas_mcp, nas_audit now feed backlog/self-build.

See:
- record_nas_friction in the two main infra py files
- loadNasFriction + merge in npc-local-metrics.js
- telemetryContext enhancement in npc-brains.js

This was the chosen next step after pre-flight to give host visibility.

---

