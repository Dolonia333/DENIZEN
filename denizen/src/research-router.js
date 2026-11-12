'use strict';

/**
 * Research routing — Brave API vs visible browser on a mesh/desktop station.
 *
 * DENIZEN_RESEARCH_BACKEND:
 *   auto     — Brave when BRAVE_SEARCH_API_KEY is set, else mesh/browser
 *   brave    — API only
 *   browser  — local/mesh visible browser (web-search skill)
 *   mesh     — enqueue web_search on City Power mesh (Denizen Desktop on GPU PC)
 */

const webResearch = require('./web-research');

function meshBrowserEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.DENIZEN_MESH_BROWSER || '1'));
}

function researchBackend() {
  const v = String(process.env.DENIZEN_RESEARCH_BACKEND || 'auto').toLowerCase();
  if (v === 'brave') return 'brave';
  if (v === 'browser' || v === 'web-search' || v === 'web_search') return 'browser';
  if (v === 'mesh') return 'mesh';
  try {
    const { getBraveKey } = require('../jelly/config-provider');
    if (getBraveKey?.()) return 'brave';
  } catch (_) {}
  if (meshBrowserEnabled()) return 'mesh';
  return 'browser';
}

function getMeshStatusHint() {
  // Called by health/briefs to surface actionable hint when 0 nodes
  return 'Mesh enabled but 0 fleet nodes. Activate by running Denizen Desktop on <PC_LAN_IP>, pairing it, then in Compute/City Power UI: set level + toggle "Power the city". See COMPUTE_MESH.md.';
}

function extractQuery(skillParams = {}) {
  return String(
    skillParams.query || skillParams.q || skillParams.topic || skillParams.task || '',
  ).trim();
}

function resolveResearchRoute({ skillParams = {} } = {}) {
  const query = extractQuery(skillParams);
  const backend = researchBackend();
  return { backend, query, meshEnabled: meshBrowserEnabled() };
}

async function runMeshWebSearch({ computeQueue, npcName, query, timeoutMs = 180_000 } = {}) {
  if (!computeQueue?.enqueueJob || !computeQueue?.waitForJob) {
    return { ok: false, error: 'compute queue unavailable', routed: false };
  }
  if (!query) return { ok: false, error: 'empty query', routed: false };

  const targetHost = String(process.env.DENIZEN_MESH_BROWSER_HOST || process.env.LM_STUDIO_REMOTE_URLS || '')
    .split(',')[0]
    .trim()
    .replace(/^https?:\/\//, '')
    .split(':')[0];

  const job = await computeQueue.enqueueJob({
    jobType: 'web_search',
    payload: {
      query,
      npc_name: npcName || 'Lucy',
      headless: false,
      target_host_hint: targetHost || null,
      source: 'research-router',
    },
    priority: 75,
  });
  if (!job?.id) {
    return { ok: false, error: 'failed to enqueue web_search job', routed: true };
  }

  const completed = await computeQueue.waitForJob(job.id, { timeoutMs });
  if (!completed) {
    return { ok: false, error: 'mesh web_search timed out', job_id: job.id, routed: true };
  }
  const result = completed.result && typeof completed.result === 'object'
    ? completed.result
    : {};
  const summary = result.summary || result.output || result.error || completed.error || 'Search finished.';
  return {
    ok: completed.status === 'done' && result.ok !== false,
    output: summary,
    summary,
    job_id: job.id,
    routed: true,
    mesh: true,
    result,
  };
}

module.exports = {
  meshBrowserEnabled,
  researchBackend,
  extractQuery,
  resolveResearchRoute,
  runMeshWebSearch,
};
