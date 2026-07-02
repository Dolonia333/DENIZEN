[Previous content...]

## Host Infrastructure Telemetry (pollHostInfrastructure + Environmental Cooldown)

Implemented lightweight host metrics poller in npc-local-metrics.js bound to telemetry pulls.

- pollHostInfrastructure(): samples os.loadavg, totalmem/freemem, statfs for storage.
- If load>90% or mem>90% or disk>95%: captureSystemError('system', 'host_infrastructure', {code: 'RESOURCE_EXHAUSTION' or STORAGE}).
- Merged into friction scores as 'nas_*' / 'host_infrastructure' (decays).
- In _checkAutonomyBacklog: if host constrained, suppress [SELF_BUILDING], call _setEnvironmentalCooldown (5min).
- In allowAutonomousSkillRun: returns blocked with 'environmental_cooldown' reason.
- Added to think telemetryContext for NPC awareness.

This prevents agents from misattributing host load (CPU spike from model, disk I/O) to code bugs and spawning useless builds. Instead, they back off (throttle, postpone).

See pollHostInfrastructure, getFrictionScore merge, _setEnvironmentalCooldown, allow check.

This completes the host visibility layer.

---

