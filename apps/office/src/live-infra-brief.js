'use strict';

/**
 * Authoritative live infra snapshot for player chat / Grok grounding.
 * Prevents NPCs from narrating stale LM/CRM/mesh failures from memory.
 */

async function fetchSnapshot(deps = {}) {
  const healthRunbook = require('./health-runbook');
  let directSupabase = false;
  try {
    const bridge = require('../jelly/lib/bridge-client');
    directSupabase = bridge.useDirectSupabase?.() || false;
  } catch (_) {}

  const report = await healthRunbook.check({ scope: 'full', deps });
  return { report, directSupabase };
}

function formatSnapshot({ report, directSupabase }) {
  const lm = report?.sections?.lm_studio || {};
  const mesh = report?.sections?.mesh || {};
  const lines = [
    '## Live infrastructure (authoritative — do NOT contradict without a fresh tool run)',
    `- LM Studio: ${lm.reachable ? `reachable (${lm.url})` : `UNREACHABLE (${lm.url || 'unknown'})`}`,
    `- CRM/data bridge: ${directSupabase ? 'direct Supabase PostgREST (production NAS)' : 'local bridge (127.0.0.1:18790) expected'}`,
    `- Mesh: ${mesh.fleet_nodes ?? '?'} fleet node(s), ${mesh.queue_pending ?? '?'} pending job(s)`,
  ];

  if (report?.issues?.length) {
    lines.push(`- Open issues: ${report.issues.join(', ')}`);
  } else if (report?.ok) {
    lines.push('- Health check: no open issues at snapshot time');
  }

  lines.push(
    '- Do NOT invent canvas-render prototype errors or past skill failures unless the CEO pasted a stack trace or a skill result says so.',
    '- Skill `(error)` in the work feed means read that output — do not guess the cause from old chat.',
    '- On Docker/NAS without .git, coding-agent writes direct-edit proposals under reports/code-reviews/ (approve copies files in).',
    '- Mesh 0 nodes (jobs pending): On .232: run Denizen Desktop -> pair -> phone Compute/City Power: level + "Power the city" opt-in. See updated COMPUTE_MESH.md. Then research claims visibly. Monitor via health-check mesh scope.',
  );

  return lines.join('\n');
}

async function buildPromptBlock(deps = {}) {
  const snap = await fetchSnapshot(deps);
  return `\n${formatSnapshot(snap)}\n`;
}

module.exports = {
  fetchSnapshot,
  formatSnapshot,
  buildPromptBlock,
};
