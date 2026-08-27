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

  const fleet = Number(mesh.fleet_nodes);
  const lmUp = !!lm.reachable;
  if (lmUp && Number.isFinite(fleet) && fleet > 0) {
    lines.push(
      '- Mesh/.232: LIVE — tell users they are already connected; do not invent Desktop pairing steps.',
    );
  } else if (!lmUp || fleet === 0) {
    lines.push(
      '- Mesh/.232 down or 0 fleet nodes: On the GPU box run Denizen Desktop → pair → phone Compute/City Power: level + "Power the city". See COMPUTE_MESH.md. Then re-run health-check.',
    );
  }

  lines.push(
    '- Do NOT invent canvas-render prototype errors or past skill failures unless the CEO pasted a stack trace or a skill result says so.',
    '- Skill `(error)` in the work feed means read that output — do not guess the cause from old chat.',
    '- On Docker/NAS without .git, coding-agent writes direct-edit proposals under reports/code-reviews/ (approve copies files in).',
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
