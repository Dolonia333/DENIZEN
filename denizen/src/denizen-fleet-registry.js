'use strict';

const os = require('node:os');

/** identityId -> Map(machineId -> machine record) */
const fleetByIdentity = new Map();
/** Global host snapshot from server sampler */
let globalHostSnapshot = null;
/** Auxiliary probes (NAS, etc.) */
const auxiliaryMachines = new Map();

const STALE_MS = 3 * 60 * 1000;

function isSmokeMachine(machine) {
  if (!machine || typeof machine !== 'object') return false;
  if (machine.smoke === true) return true;
  const id = String(machine.machine_id || '');
  if (id.startsWith('nas-smoke-')) return true;
  return String(machine.label || '').trim() === 'NAS Smoke';
}

function pruneSmokeMachines() {
  for (const [id, machine] of auxiliaryMachines) {
    if (isSmokeMachine(machine)) auxiliaryMachines.delete(id);
  }
  for (const map of fleetByIdentity.values()) {
    for (const [id, machine] of map) {
      if (isSmokeMachine(machine)) map.delete(id);
    }
  }
}

function machineMap(identityId) {
  const id = String(identityId || '').trim();
  if (!id) return null;
  if (!fleetByIdentity.has(id)) fleetByIdentity.set(id, new Map());
  return fleetByIdentity.get(id);
}

function normalizeMachineId(raw, fallbackRole = 'node') {
  const value = String(raw || '').trim();
  if (value) return value;
  return `${fallbackRole}-${os.hostname()}-${Date.now()}`;
}

function upsertMachine(identityId, machineId, payload = {}) {
  const map = machineMap(identityId);
  if (!map) return null;
  const id = normalizeMachineId(machineId, payload.role || 'node');
  const prev = map.get(id) || {};
  const next = {
    ...prev,
    ...payload,
    machine_id: id,
    identity_id: String(identityId),
    updated_at: new Date().toISOString(),
  };
  map.set(id, next);
  return next;
}

function setGlobalHostSnapshot(snapshot) {
  globalHostSnapshot = snapshot && typeof snapshot === 'object'
    ? { ...snapshot, role: snapshot.role || 'host', updated_at: new Date().toISOString() }
    : null;
  return globalHostSnapshot;
}

function getGlobalHostSnapshot() {
  if (!globalHostSnapshot) return null;
  const age = Date.now() - new Date(globalHostSnapshot.sampled_at || globalHostSnapshot.updated_at || 0).getTime();
  if (age > STALE_MS) return { ...globalHostSnapshot, stale: true, age_ms: age };
  return { ...globalHostSnapshot, stale: false, age_ms: age };
}

function upsertAuxiliary(machineId, payload = {}) {
  const id = normalizeMachineId(machineId, payload.role || 'aux');
  const prev = auxiliaryMachines.get(id) || {};
  const hasLiveMetrics = payload.cpu_percent != null
    || payload.ram?.total_mb > 0
    || payload.gpu?.utilization_percent != null
    || payload.reporting === true;
  const next = {
    ...prev,
    ...payload,
    machine_id: id,
    updated_at: new Date().toISOString(),
  };
  if (!hasLiveMetrics && prev.cpu_percent != null) {
    next.cpu_percent = prev.cpu_percent;
    next.ram = prev.ram || next.ram;
    next.gpu = prev.gpu || next.gpu;
    next.cpu_cores = prev.cpu_cores ?? next.cpu_cores;
    next.reporting = prev.reporting ?? next.reporting;
  }
  auxiliaryMachines.set(id, next);
  return next;
}

function listAuxiliary() {
  pruneSmokeMachines();
  return [...auxiliaryMachines.values()]
    .filter((m) => !isSmokeMachine(m))
    .map((m) => ({ ...m }));
}

function listForIdentity(identityId, { includeHost = true, includeAuxiliary = true } = {}) {
  const map = machineMap(identityId);
  const out = map ? [...map.values()].map((m) => ({ ...m })) : [];

  if (includeHost) {
    const host = getGlobalHostSnapshot();
    if (host) {
      const hostId = host.machine_id || `host-${host.hostname || os.hostname()}`;
      if (!out.some((m) => m.machine_id === hostId)) {
        out.unshift({ ...host, machine_id: hostId, role: 'host', label: host.label || host.hostname || 'Denizen host' });
      }
    }
  }

  if (includeAuxiliary) {
    for (const aux of listAuxiliary()) {
      if (!out.some((m) => m.machine_id === aux.machine_id)) out.push(aux);
    }
  }

  const fleet = out.filter((m) => !isSmokeMachine(m));
  return fleet.sort((a, b) => {
    const roleOrder = { host: 0, desktop: 1, node: 2, nas: 3, aux: 4 };
    const ra = roleOrder[a.role] ?? 5;
    const rb = roleOrder[b.role] ?? 5;
    if (ra !== rb) return ra - rb;
    return String(a.label || a.machine_id).localeCompare(String(b.label || b.machine_id));
  });
}

const OPERATOR_ONLY_ROLES = new Set(['host', 'nas', 'aux']);

function isOperatorOnlyMachine(machine) {
  const role = String(machine?.role || '').toLowerCase();
  if (OPERATOR_ONLY_ROLES.has(role)) return true;
  const label = String(machine?.label || machine?.machine_id || '');
  return /supabase|nat\b|tailscale|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\./i.test(label);
}

function sanitizeMachineForViewer(machine) {
  if (!machine || typeof machine !== 'object') return machine;
  const next = { ...machine };
  delete next.url;
  if (isOperatorOnlyMachine(next)) {
    return null;
  }
  return next;
}

function buildFleetSummary(identityId, liveUsage = null, options = {}) {
  const isOperator = options.isOperator === true;
  const fleet = listForIdentity(identityId, {
    includeHost: isOperator,
    includeAuxiliary: isOperator,
  })
    .map((m) => (isOperator ? m : sanitizeMachineForViewer(m)))
    .filter(Boolean);

  let primary = null;
  if (isOperator) {
    primary = liveUsage || fleet.find((m) => m.role === 'host') || fleet[0] || null;
  } else {
    primary = fleet.find((m) => m.role === 'desktop' || m.role === 'node') || fleet[0] || null;
    if (liveUsage && !isOperatorOnlyMachine(liveUsage) && liveUsage.identity_id === identityId) {
      primary = liveUsage;
    }
  }

  const totals = {
    machines: fleet.length,
    contributing_machines: fleet.filter((m) => m.contributing || (m.cpu_percent > 5) || (m.gpu?.utilization_percent > 5)).length,
    total_jobs_completed: fleet.reduce((sum, m) => sum + (Number(m.jobs_completed) || 0), 0),
  };
  return {
    fleet,
    live_usage: primary,
    totals,
    sampled_at: primary?.sampled_at || new Date().toISOString(),
  };
}

function parseSupabaseHost() {
  const raw = String(
    process.env.SUPABASE_URL
    || process.env.DENIZEN_SUPABASE_URL
    || '',
  ).trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.hostname || null;
  } catch (_) {
    return null;
  }
}

function parseFleetProbeUrls() {
  const raw = String(process.env.DENIZEN_FLEET_PROBE_URLS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function probeUrl(baseUrl, label, role = 'aux') {
  const started = Date.now();
  const machineId = `${role}-${new URL(baseUrl).hostname}`;
  try {
    const res = await fetch(baseUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return upsertAuxiliary(machineId, {
      role,
      label,
      url: baseUrl,
      reachable: res.ok || res.status === 401 || res.status === 403,
      http_status: res.status,
      latency_ms: Date.now() - started,
      platform: 'remote',
      sampled_at: new Date().toISOString(),
    });
  } catch (err) {
    return upsertAuxiliary(machineId, {
      role,
      label,
      url: baseUrl,
      reachable: false,
      error: err?.message || String(err),
      latency_ms: Date.now() - started,
      platform: 'remote',
      sampled_at: new Date().toISOString(),
    });
  }
}

function parseNasAgentHealthUrl() {
  const raw = String(process.env.DENIZEN_NAS_AGENT_HEALTH_URL || '').trim();
  return raw || null;
}

async function refreshAuxiliaryProbes() {
  const probes = [];
  const nasHealth = parseNasAgentHealthUrl();
  if (nasHealth) {
    probes.push(probeUrl(nasHealth, `NAS · agent (${new URL(nasHealth).hostname})`, 'nas'));
  }
  const supaHost = parseSupabaseHost();
  if (supaHost && /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(supaHost)) {
    const nasMachineId = `nas-${supaHost}`;
    const existing = auxiliaryMachines.get(nasMachineId);
    const hasAgentMetrics = existing?.reporting || existing?.cpu_percent != null;
    if (!hasAgentMetrics) {
      probes.push(probeUrl(`http://${supaHost}:8000/rest/v1/`, `NAS · Supabase (${supaHost})`, 'nas'));
    }
  }
  for (const url of parseFleetProbeUrls()) {
    probes.push(probeUrl(url, `Fleet · ${url}`, 'aux'));
  }
  return Promise.all(probes);
}

let auxProbeTimer = null;

function startAuxiliaryProbeLoop(intervalMs = 60000) {
  if (auxProbeTimer) return { ok: true, alreadyRunning: true };
  const tick = () => {
    refreshAuxiliaryProbes().catch(() => null);
  };
  tick();
  auxProbeTimer = setInterval(tick, Math.max(15000, intervalMs));
  return { ok: true, running: true };
}

module.exports = {
  upsertMachine,
  setGlobalHostSnapshot,
  getGlobalHostSnapshot,
  upsertAuxiliary,
  listAuxiliary,
  listForIdentity,
  buildFleetSummary,
  sanitizeMachineForViewer,
  isOperatorOnlyMachine,
  refreshAuxiliaryProbes,
  startAuxiliaryProbeLoop,
  isSmokeMachine,
  pruneSmokeMachines,
};
