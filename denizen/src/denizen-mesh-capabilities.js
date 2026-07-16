'use strict';

/**
 * Capability-aware mesh job routing (P3 / A-grade mesh).
 *
 * Maps job types → hardware floors (score + VRAM) so weak or offline nodes
 * cannot claim heavy GPU work. Pure helpers — no I/O, safe for unit tests.
 *
 * Consumers:
 *   - denizen-compute-queue.js (claim path via nodeCanRunJob)
 *   - fleet / ranking UIs that pick best nodes for a job type
 *
 * Override per-job via payload.required_hardware_score / required_vram_mb.
 */

const DEFAULT_REQUIREMENTS = Object.freeze({
  minHardwareScore: 0,
  minVramMb: 0,
  prefersGpu: false,
});

/**
 * Requirements table. Scores align with denizen-node-profiler.scoreHardware
 * and historical JOB_MIN_HARDWARE_SCORE gates in the compute queue.
 *
 * coding-agent-ish: light CPU work (repo edits / worktrees) — no GPU floor.
 */
const JOB_REQUIREMENTS = Object.freeze({
  inference_rpc: Object.freeze({
    minHardwareScore: 12,
    minVramMb: 4096,
    prefersGpu: true,
  }),
  npc_think_batch: Object.freeze({
    minHardwareScore: 16,
    minVramMb: 2048,
    prefersGpu: true,
  }),
  embedding_index: Object.freeze({
    minHardwareScore: 24,
    minVramMb: 6144,
    prefersGpu: true,
  }),
  web_search: Object.freeze({
    minHardwareScore: 0,
    minVramMb: 0,
    prefersGpu: false,
  }),
  /** Named alias used by docs / advisors */
  'coding-agent-ish': Object.freeze({
    minHardwareScore: 8,
    minVramMb: 0,
    prefersGpu: false,
  }),
  'coding-agent': Object.freeze({
    minHardwareScore: 8,
    minVramMb: 0,
    prefersGpu: false,
  }),
  coding_agent: Object.freeze({
    minHardwareScore: 8,
    minVramMb: 0,
    prefersGpu: false,
  }),
  coding_agent_task: Object.freeze({
    minHardwareScore: 8,
    minVramMb: 0,
    prefersGpu: false,
  }),
  sim_tick: Object.freeze({
    minHardwareScore: 8,
    minVramMb: 0,
    prefersGpu: false,
  }),
  grok_cli_chat: Object.freeze({
    minHardwareScore: 0,
    minVramMb: 0,
    prefersGpu: false,
  }),
  claude_cli_chat: Object.freeze({
    minHardwareScore: 0,
    minVramMb: 0,
    prefersGpu: false,
  }),
  grok_telemetry_check: Object.freeze({
    minHardwareScore: 0,
    minVramMb: 0,
    prefersGpu: false,
  }),
  bouncer_patrol: Object.freeze({
    minHardwareScore: 0,
    minVramMb: 0,
    prefersGpu: false,
  }),
  default: DEFAULT_REQUIREMENTS,
});

/** Backward-compat map: jobType → min hardware score only. */
const JOB_MIN_HARDWARE_SCORE = Object.freeze(
  Object.fromEntries(
    Object.entries(JOB_REQUIREMENTS)
      .filter(([k]) => k !== 'default')
      .map(([k, v]) => [k, v.minHardwareScore]),
  ),
);

function normalizeJobType(jobType) {
  return String(jobType || '').trim();
}

/**
 * @param {string} jobType
 * @returns {{ minHardwareScore: number, minVramMb: number, prefersGpu: boolean }}
 */
function jobRequirements(jobType) {
  const type = normalizeJobType(jobType);
  if (!type) return { ...DEFAULT_REQUIREMENTS };
  const hit = JOB_REQUIREMENTS[type] || JOB_REQUIREMENTS.default;
  return {
    minHardwareScore: Number(hit.minHardwareScore) || 0,
    minVramMb: Number(hit.minVramMb) || 0,
    prefersGpu: hit.prefersGpu === true,
  };
}

function toNonNegInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

/**
 * Resolve reported VRAM from common profile / live shapes.
 * Returns null when unknown (score gate alone applies).
 */
function nodeVramMb(nodeProfile) {
  if (!nodeProfile || typeof nodeProfile !== 'object') return null;
  const candidates = [
    nodeProfile.vram_mb,
    nodeProfile.vramMb,
    nodeProfile.gpu?.vram_total_mb,
    nodeProfile.gpu?.vram_mb,
    nodeProfile.live?.gpu?.vram_total_mb,
  ];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  return null;
}

function nodeHardwareScore(nodeProfile) {
  if (!nodeProfile || typeof nodeProfile !== 'object') return 0;
  return toNonNegInt(
    nodeProfile.hardware_score ?? nodeProfile.hardwareScore ?? nodeProfile.score,
    0,
  );
}

function isNodeOffline(nodeProfile) {
  if (!nodeProfile || typeof nodeProfile !== 'object') return false;
  if (nodeProfile.offline === true) return true;
  // Prefer explicit status; fall back to state / presence flags.
  const rawStatus = nodeProfile.status != null ? nodeProfile.status : nodeProfile.state;
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'offline' || status === 'disconnected' || status === 'down') return true;
  const level = String(nodeProfile.contribution_level || '').toLowerCase();
  if (level === 'off') return true;
  if (nodeProfile.online === false) return true;
  if (nodeProfile.reachable === false) return true;
  return false;
}

/**
 * Whether a node may claim a job with the given requirements.
 * @param {object|null} nodeProfile
 * @param {{ minHardwareScore?: number, minVramMb?: number, prefersGpu?: boolean }} requirements
 * @returns {{ ok: boolean, reason: string|null }}
 */
function nodeCanClaim(nodeProfile, requirements = {}) {
  if (!nodeProfile) {
    // Claim path treats missing profile as "no gate" (legacy); ranking still filters.
    return { ok: true, reason: null };
  }

  if (isNodeOffline(nodeProfile)) {
    return { ok: false, reason: 'node_offline' };
  }

  const req = {
    minHardwareScore: toNonNegInt(requirements.minHardwareScore, 0),
    minVramMb: toNonNegInt(requirements.minVramMb, 0),
    prefersGpu: requirements.prefersGpu === true,
  };

  const score = nodeHardwareScore(nodeProfile);
  if (score < req.minHardwareScore) {
    return {
      ok: false,
      reason: `hardware_score ${score} < min ${req.minHardwareScore}`,
    };
  }

  // Only enforce VRAM when the node reports it — unknown VRAM falls back to score.
  const vram = nodeVramMb(nodeProfile);
  if (req.minVramMb > 0 && vram != null && vram < req.minVramMb) {
    return {
      ok: false,
      reason: `vram_mb ${vram} < min ${req.minVramMb}`,
    };
  }

  return { ok: true, reason: null };
}

/**
 * Sort eligible nodes best-first for a job's requirements.
 * Ineligible (offline / below floor) nodes are excluded.
 *
 * Ranking: higher hardware_score first; when prefersGpu, higher VRAM breaks ties.
 *
 * @param {object[]} nodes
 * @param {{ minHardwareScore?: number, minVramMb?: number, prefersGpu?: boolean }} requirements
 * @returns {object[]}
 */
function rankNodes(nodes, requirements = {}) {
  const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  const eligible = [];
  for (const node of list) {
    const claim = nodeCanClaim(node, requirements);
    if (claim.ok) eligible.push(node);
  }

  const prefersGpu = requirements.prefersGpu === true;
  eligible.sort((a, b) => {
    const scoreA = nodeHardwareScore(a);
    const scoreB = nodeHardwareScore(b);
    if (scoreB !== scoreA) return scoreB - scoreA;
    if (prefersGpu) {
      const vramA = nodeVramMb(a) ?? 0;
      const vramB = nodeVramMb(b) ?? 0;
      if (vramB !== vramA) return vramB - vramA;
    }
    const idA = String(a.machine_id || a.node_id || a.id || '');
    const idB = String(b.machine_id || b.node_id || b.id || '');
    return idA.localeCompare(idB);
  });
  return eligible;
}

/**
 * Build requirements for a job row (type + optional payload overrides).
 */
function requirementsForJob(job) {
  const jobType = normalizeJobType(job?.job_type || job?.jobType || job?.type);
  const base = jobRequirements(jobType);
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  return {
    minHardwareScore: toNonNegInt(
      payload.required_hardware_score ?? payload.min_hardware_score ?? base.minHardwareScore,
      base.minHardwareScore,
    ),
    minVramMb: toNonNegInt(
      payload.required_vram_mb ?? payload.min_vram_mb ?? base.minVramMb,
      base.minVramMb,
    ),
    prefersGpu: base.prefersGpu,
  };
}

module.exports = {
  JOB_REQUIREMENTS,
  JOB_MIN_HARDWARE_SCORE,
  DEFAULT_REQUIREMENTS,
  jobRequirements,
  nodeCanClaim,
  rankNodes,
  requirementsForJob,
  nodeVramMb,
  nodeHardwareScore,
  isNodeOffline,
};
