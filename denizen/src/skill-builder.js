'use strict';
/**
 * skill-builder.js — NPCs author their own tools (Stage 4, step 4 of the
 * Self-Advancement Roadmap: the "LLM-assisted code-generation" path that
 * capability-proposal.js explicitly deferred as future work).
 *
 * THE NON-NEGOTIABLE GATE (same as capability-proposal / coding-task-runner):
 * an NPC can REQUEST and DRAFT a new skill, but the generated code lands
 * QUARANTINED in skills-pending/ and NEVER runs until the CEO reviews the
 * actual code and approves it. NPCs cannot self-grant executable tools.
 *
 * Flow:
 *   1. requestSkill() — generate a single-file Node skill from a spec,
 *      static-scan it for dangerous patterns, write it to
 *      skills-pending/<slug>/, and record a proposal (status: pending or
 *      needs_review if the scan flagged something).
 *   2. The CEO reviews the code via /api/skill-proposals + the panel.
 *   3. approveSkill() — moves skills-pending/<slug> → skills/<slug> and
 *      registers it so runNpcSkill can invoke it. Only now is it runnable.
 *   4. rejectSkill() — deletes the quarantined draft.
 *
 * Generated skills follow the existing SKILL_SCRIPTS convention: a single
 * .mjs that reads `--key value` args from argv, does its job with Node
 * builtins (+ fetch), and prints a result to stdout.
 */

const fs   = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT          = path.resolve(__dirname, '..');
const PENDING_DIR   = path.join(ROOT, 'skills-pending');
const APPROVED_DIR  = path.join(ROOT, 'skills');
const PROPOSALS_FILE = path.join(ROOT, 'data', 'skill-proposals.json');

// Static safety scan. If generated code matches any of these it does NOT
// auto-qualify as a clean proposal — it's flagged needs_review so the CEO
// sees exactly why before deciding. (It never runs regardless until approved.)
const DANGER_PATTERNS = [
  { re: /child_process|execSync|\bspawn\s*\(|\bexec\s*\(/i, why: 'spawns shell/subprocess' },
  { re: /\bfs\.(rm|rmdir|unlink|rmSync|unlinkSync|rmdirSync)\b/i, why: 'deletes files' },
  { re: /\brm\s+-rf\b/i, why: 'rm -rf' },
  { re: /\beval\s*\(|new\s+Function\s*\(/i, why: 'dynamic code execution (eval/Function)' },
  { re: /process\.exit/i, why: 'force-exits the process' },
  { re: /\.\.\/|\.\.\\/, why: 'path traversal (..)' },
  { re: /openclaw\.json|\.env\b|gmail-oauth|robinhood-oauth|AGENT_TOKEN|apiKey|api_key/i, why: 'reads secrets/credentials' },
  { re: /process\.env\.[A-Z_]*(KEY|TOKEN|SECRET|PASS)/i, why: 'reads secret env vars' },
  { re: /require\(\s*['"]os['"]\s*\)|require\(\s*['"]vm['"]\s*\)/i, why: 'low-level os/vm access' },
];

const NAME_RE = /^[a-z][a-z0-9-]{1,39}$/;

// ── store helpers ────────────────────────────────────────────────────────────

function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(PROPOSALS_FILE, 'utf8'));
    return Array.isArray(s.proposals) ? s : { proposals: [] };
  } catch (_) { return { proposals: [] }; }
}
function saveStore(store) {
  fs.mkdirSync(path.dirname(PROPOSALS_FILE), { recursive: true });
  fs.writeFileSync(PROPOSALS_FILE, JSON.stringify(store, null, 2), 'utf8');
}
function slugify(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);
}
function newId() { return crypto.randomBytes(6).toString('hex'); }

function scan(code) {
  const flags = [];
  for (const p of DANGER_PATTERNS) if (p.re.test(code)) flags.push(p.why);
  return flags;
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Request a new skill. `generateFn(spec) → Promise<string code>` is injected
 * by the server (it calls a capable model). If generation fails or is absent,
 * we fall back to a clearly-marked TODO template so the proposal still lands
 * for a human to complete — the request is never silently dropped.
 *
 * @returns {Promise<object>} the proposal record
 */
async function requestSkill({
  npc,
  name,
  purpose,
  params = [],
  generateFn,
  researchContext = '',
  githubContext = '',
  requestedBy = null,
  sourceMessage = '',
} = {}) {
  const slug = slugify(name || purpose || '');
  if (!NAME_RE.test(slug)) {
    return { ok: false, error: `Invalid skill name "${name}" (slug "${slug}")` };
  }
  // No dupes against approved skills, pending drafts, or open proposals.
  const store = loadStore();
  if (store.proposals.some(p => p.slug === slug && (p.status === 'pending' || p.status === 'needs_review' || p.status === 'approved'))) {
    return { ok: false, error: `A skill named "${slug}" is already proposed or approved.` };
  }
  if (fs.existsSync(path.join(APPROVED_DIR, slug))) {
    return { ok: false, error: `Skill "${slug}" already exists.` };
  }

  const spec = {
    slug,
    purpose: String(purpose || '').slice(0, 400),
    params: Array.isArray(params) ? params.slice(0, 8) : [],
    researchContext: String(researchContext || '').slice(0, 3500),
    githubContext: String(githubContext || '').slice(0, 3000),
    requestedBy: requestedBy || null,
    sourceMessage: String(sourceMessage || '').slice(0, 500),
  };

  // Generate the code (injected generator, with a safe fallback template).
  let code = null;
  try {
    if (typeof generateFn === 'function') code = await generateFn(spec);
  } catch (_) { /* fall back below */ }
  if (!code || typeof code !== 'string' || code.length < 40) {
    code = fallbackTemplate(spec);
  }
  code = stripFences(code);

  // Static safety scan — flags decide pending vs needs_review; never runs yet.
  const flags = scan(code);
  const status = flags.length ? 'needs_review' : 'pending';

  // Quarantine the draft.
  const dir = path.join(PENDING_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.mjs`), code, 'utf8');

  const proposal = {
    id: newId(),
    kind: 'skill',
    npc: npc || 'unknown',
    name: slug,
    slug,
    purpose: spec.purpose,
    params: spec.params,
    code,
    scanFlags: flags,
    status,
    pendingPath: path.join('skills-pending', slug, `${slug}.mjs`),
    requestedBy: spec.requestedBy,
    sourceMessage: spec.sourceMessage,
    hasResearchContext: !!spec.researchContext,
    hasGithubContext: !!spec.githubContext,
    at: new Date().toISOString(),
  };
  store.proposals.unshift(proposal);
  if (store.proposals.length > 100) store.proposals.length = 100;
  saveStore(store);
  return { ok: true, proposal };
}

function getSkillProposals({ status } = {}) {
  const store = loadStore();
  return status ? store.proposals.filter(p => p.status === status) : store.proposals;
}

/** Approve: move the quarantined draft into skills/ and make it runnable. */
function approveSkill(id) {
  const store = loadStore();
  const p = store.proposals.find(x => x.id === id);
  if (!p) return { ok: false, error: 'not found' };
  if (p.status === 'approved') return { ok: true, proposal: p, alreadyApproved: true };

  const src = path.join(PENDING_DIR, p.slug);
  const dst = path.join(APPROVED_DIR, p.slug);
  try {
    fs.mkdirSync(APPROVED_DIR, { recursive: true });
    // Move (copy + remove) so it works across drives.
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
    }
    fs.rmSync(src, { recursive: true, force: true });
  } catch (e) {
    return { ok: false, error: `Failed to install skill: ${e.message}` };
  }
  p.status = 'approved';
  p.approvedAt = new Date().toISOString();
  p.scriptPath = path.join(dst, `${p.slug}.mjs`);
  saveStore(store);
  return { ok: true, proposal: p };
}

function rejectSkill(id) {
  const store = loadStore();
  const p = store.proposals.find(x => x.id === id);
  if (!p) return { ok: false, error: 'not found' };
  try { fs.rmSync(path.join(PENDING_DIR, p.slug), { recursive: true, force: true }); } catch (_) {}
  p.status = 'rejected';
  p.rejectedAt = new Date().toISOString();
  saveStore(store);
  return { ok: true, proposal: p };
}

/** Map of approved skill slug → absolute script path, for runNpcSkill. */
function getApprovedSkillScripts() {
  const out = {};
  for (const p of loadStore().proposals) {
    if (p.status !== 'approved') continue;
    const scriptPath = path.join(APPROVED_DIR, p.slug, `${p.slug}.mjs`);
    if (fs.existsSync(scriptPath)) out[p.slug] = scriptPath;
  }
  return out;
}

// ── codegen helpers ────────────────────────────────────────────────────────────

function stripFences(code) {
  return String(code).replace(/^```(?:javascript|js|mjs|node)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

/** A safe, runnable stub used when no generator is available — does nothing
 *  dangerous, just echoes its inputs and a TODO so a human completes it. */
function fallbackTemplate(spec) {
  const argList = (spec.params || []).map(p => (typeof p === 'string' ? p : p.name)).filter(Boolean);
  return `#!/usr/bin/env node
// Skill: ${spec.slug}
// Purpose: ${spec.purpose}
// AUTO-DRAFTED STUB — a human should complete the TODO before relying on this.
// Convention: read --key value args, do the work with Node builtins (+ fetch),
// print the result to stdout.

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = String(process.argv[i] || '').replace(/^--/, '');
  if (k) args[k] = process.argv[i + 1];
}

async function main() {
  // Expected inputs: ${argList.join(', ') || '(none specified)'}
  // TODO: implement "${spec.purpose}".
  console.log(JSON.stringify({ skill: '${spec.slug}', status: 'stub', received: args }));
}
main().catch(e => { console.log(JSON.stringify({ error: String(e && e.message || e) })); });
`;
}

/** The prompt a server-side generator should use to author a skill. Exported
 *  so the server can feed it to whichever model it picks. */
function buildGenerationPrompt(spec) {
  const params = (spec.params || []).map(p => (typeof p === 'string' ? p : `${p.name}${p.desc ? ' — ' + p.desc : ''}`)).join(', ');
  const contextBlocks = [];
  if (spec.researchContext) {
    contextBlocks.push(`WEB RESEARCH (use for implementation details):\n${spec.researchContext}`);
  }
  if (spec.githubContext) {
    contextBlocks.push(`GITHUB / EXISTING SKILL HINTS (adapt patterns, do not copy secrets):\n${spec.githubContext}`);
  }
  if (spec.requestedBy) {
    contextBlocks.push(`Requested by teammate: ${spec.requestedBy}`);
  }
  const contextSection = contextBlocks.length
    ? `\n\nCONTEXT:\n${contextBlocks.join('\n\n')}\n`
    : '';

  return `Write a single self-contained Node.js ESM skill file named ${spec.slug}.mjs.

Purpose: ${spec.purpose}
Inputs (passed as --key value CLI args): ${params || '(decide sensible inputs)'}${contextSection}

STRICT RULES:
- Read args from process.argv as --key value pairs.
- Use ONLY Node builtins and global fetch. No npm installs. No external deps.
- Do the task and print ONE JSON object result to stdout (console.log).
- NO file deletion, NO child_process/exec/spawn, NO eval/Function, NO process.exit.
- NO reading of secrets, .env, credentials, or process.env secret keys.
- Keep it under ~80 lines. Handle errors by printing { error: "..." }.
Return ONLY the code, no markdown fences, no explanation.`;
}

module.exports = {
  requestSkill,
  getSkillProposals,
  approveSkill,
  rejectSkill,
  getApprovedSkillScripts,
  buildGenerationPrompt,
  // exposed for tests
  _scan: scan,
  _slugify: slugify,
};
