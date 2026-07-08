'use strict';

/**
 * coding-task-runner.js — Phase 3.1
 *
 * Manages NPC-initiated code proposals end-to-end:
 *   1. Guard checks (forbidden files, limits)
 *   2. Isolated git worktree per proposal
 *   3. Claude Code execution (non-interactive, --print flag)
 *   4. Diff capture + report written to reports/code-reviews/
 *   5. Human approval gate before merge to master
 */

const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Project root is the denizen/ directory (parent of src/)
const projectRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS = [
  'npcs/',
  '.claude/',
  'data/user-profile.json',
  'data/company-brief.json',
];

const MAX_FILES_PER_TASK     = 5;
const CODE_REVIEWS_DIR       = path.join(projectRoot, 'reports', 'code-reviews');
const NPC_WORKTREES_DIR      = path.join(projectRoot, '.npc-worktrees');

// ---------------------------------------------------------------------------
// In-memory proposal store  (id → proposal object)
// ---------------------------------------------------------------------------

const _proposals = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lowercase, spaces→dashes, strip non-alphanumeric except dashes, max 40 chars */
function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40);
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReportFile(reportPath, content) {
  ensureDir(path.dirname(reportPath));
  fs.writeFileSync(reportPath, content, 'utf8');
}

/** Claude Code CLI auth — fail loud before spending worktree/git setup. */
function resolveCodingBackend() {
  if (process.env.ANTHROPIC_API_KEY) return 'claude-code';
  if (process.env.DENIZEN_CODING_LM_FALLBACK === 'false') return null;
  return 'lmstudio';
}

function codingBackendError() {
  const backend = resolveCodingBackend();
  if (backend) return null;
  return (
    'No coding backend: set ANTHROPIC_API_KEY or enable LM Studio fallback ' +
    '(DENIZEN_CODING_LM_FALLBACK is on by default when no Anthropic key).'
  );
}

function inferSkillFilesFromTask(task) {
  const t = String(task || '');
  const lower = t.toLowerCase();
  const files = [];
  const seen = new Set();

  const add = (rel) => {
    const norm = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!norm || seen.has(norm)) return;
    const abs = path.join(projectRoot, norm);
    if (fs.existsSync(abs)) {
      seen.add(norm);
      files.push(norm);
    }
  };

  // Explicit repo paths mentioned in the task (denizen/jelly/... or jelly/...)
  const pathRe = /(?:^|[\s'"`(,])((?:denizen\/)?(?:jelly|src)\/[\w./-]+\.(?:js|mjs|cjs|ts|tsx|json|md)|server\.js)/gi;
  let m;
  while ((m = pathRe.exec(t)) !== null) {
    add(m[1].replace(/^denizen\//, ''));
  }

  let vendorMap = {};
  try {
    vendorMap = require('../jelly/paths').VENDOR_SCRIPT_MAP || {};
  } catch (_) {}

  for (const [skill, relScript] of Object.entries(vendorMap)) {
    const spaced = skill.replace(/-/g, ' ');
    if (lower.includes(skill) || lower.includes(spaced)) {
      add(path.posix.join('jelly', 'vendor', 'skills', relScript));
      add(path.posix.join('jelly', 'vendor', 'skills', skill, 'SKILL.md'));
    }
  }

  const nativeSkillDirs = [
    'research', 'denizen-data', 'health-check', 'coding-agent', 'supabase',
    'remediate', 'github', 'browserclaw', 'platform-publish', 'pdf-dossier',
  ];
  for (const name of nativeSkillDirs) {
    const spaced = name.replace(/-/g, ' ');
    if (lower.includes(name) || lower.includes(spaced)) {
      add(path.posix.join('jelly', 'skills', name, 'index.js'));
    }
  }

  // Common server modules referenced in infra/debug tasks
  const moduleHints = [
    { re: /\bbridge-client\b|\bsupabase.?bridge\b|\bdenizen-data\b/i, file: 'jelly/lib/bridge-client.js' },
    { re: /\bresearch-router\b|\bmesh.?browser\b/i, file: 'src/research-router.js' },
    { re: /\bcofounder\b|\bcofounder-agent\b/i, file: 'src/cofounder-agent.js' },
    { re: /\bcoding-task-runner\b|\bcoding-agent\b/i, file: 'src/coding-task-runner.js' },
  ];
  for (const hint of moduleHints) {
    if (hint.re.test(t)) add(hint.file);
  }

  return files;
}

function inferTargetFilesFromTask(task, targetFiles) {
  if (Array.isArray(targetFiles) && targetFiles.length) {
    return targetFiles.slice(0, MAX_FILES_PER_TASK);
  }
  const t = String(task || '');
  const files = [];
  const seen = new Set();
  const push = (f) => {
    if (!f || seen.has(f)) return;
    seen.add(f);
    files.push(f);
  };

  if (/\breadme\b/i.test(t)) push('README.md');
  for (const f of inferSkillFilesFromTask(t)) push(f);

  return files.slice(0, MAX_FILES_PER_TASK);
}

function applyMinimalReadmeComment(task, content) {
  const t = String(task || '');
  if (!/\breadme\b/i.test(t) || !/\b(comment|one-line|note)\b/i.test(t)) return null;
  const marker = `<!-- coding-agent ${new Date().toISOString().slice(0, 10)} -->\n`;
  if (content.startsWith(marker)) return content;
  if (content.startsWith('<!--') && /\bcomment\b/i.test(t)) {
    return content.replace(/^<!--.*?-->\n?/, marker);
  }
  return marker + content;
}

async function runLmStudioFileEdit({ worktreePath, targetFiles, task }) {
  const inferenceRuntime = require('./denizen-inference-runtime');
  let lmStudioUrl = process.env.LM_STUDIO_URL || process.env.LM_STUDIO_BASE_URL;
  try {
    const lmStudioRouter = require('./lm-studio-router');
    lmStudioUrl = lmStudioRouter.activeInferenceUrl({ tier: 'fast' }) || lmStudioUrl;
  } catch (_) {}
  if (!lmStudioUrl && process.env.LM_STUDIO_REMOTE_URLS) {
    lmStudioUrl = String(process.env.LM_STUDIO_REMOTE_URLS).split(',')[0].trim();
  }

  const outputs = [];
  for (const rel of targetFiles) {
    const fp = path.join(worktreePath, rel);
    if (!fs.existsSync(fp)) {
      throw new Error(`Target file not found in worktree: ${rel}`);
    }
    const content = fs.readFileSync(fp, 'utf8');
    const minimal = rel.toLowerCase() === 'readme.md' ? applyMinimalReadmeComment(task, content) : null;
    if (minimal != null && minimal !== content) {
      fs.writeFileSync(fp, minimal, 'utf8');
      outputs.push(`Prepended comment to ${rel} (minimal fast-path)`);
      continue;
    }

    const result = await inferenceRuntime.chatCompletion({
      lmStudioUrl,
      systemPrompt:
        'You edit source files. Return ONLY the complete updated file content. ' +
        'No markdown fences, no explanation — raw file text only.',
      messages: [{
        role: 'user',
        content:
          `Task: ${task}\n\nFile: ${rel}\n\n` +
          `Apply the minimal change. Current file:\n${content.slice(0, 12000)}`,
      }],
      maxTokens: Math.min(8192, Math.max(512, Math.ceil(content.length / 2))),
      temperature: 0.15,
      tier: 'fast',
      timeoutMs: 120000,
    });
    const updated = String(result?.text || '').trim();
    if (!updated || updated.length < 4) {
      throw new Error(`LM Studio returned empty content for ${rel}`);
    }
    fs.writeFileSync(fp, updated, 'utf8');
    outputs.push(`Edited ${rel} via LM Studio (${result.model || 'fast'})`);
  }
  return outputs.join('\n');
}

function isClaudeLoginFailure(output) {
  const s = String(output || '');
  return /not logged in/i.test(s) || /please run \/login/i.test(s);
}

function updateReportStatus(reportPath, fromStatus, toStatus) {
  try {
    let content = fs.readFileSync(reportPath, 'utf8');
    content = content.replace(
      new RegExp('`' + fromStatus + '`', 'g'),
      '`' + toStatus + '`'
    );
    fs.writeFileSync(reportPath, content, 'utf8');
  } catch (_) { /* best-effort */ }
}

async function isGitRepository(root = projectRoot) {
  try {
    const { stdout } = await execAsync('git rev-parse --is-inside-work-tree', {
      cwd: root,
      windowsHide: true,
      timeout: 5000,
    });
    return stdout.trim() === 'true';
  } catch (_) {
    return false;
  }
}

function copyFileIntoWorktree(worktreePath, rel) {
  const src = path.join(projectRoot, rel);
  const dest = path.join(worktreePath, rel);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function setupDirectWorktree(worktreePath, files) {
  ensureDir(worktreePath);
  for (const rel of files) {
    copyFileIntoWorktree(worktreePath, rel);
  }
}

async function collectDirectDiff(worktreePath, files) {
  let diff = '';
  const changedFiles = [];

  for (const rel of files) {
    const orig = path.join(projectRoot, rel);
    const edited = path.join(worktreePath, rel);
    if (!fs.existsSync(edited)) continue;
    try {
      const { stdout } = await execAsync(
        `git diff --no-index "${orig}" "${edited}"`,
        { cwd: projectRoot, windowsHide: true, timeout: 15000 },
      );
      if (stdout.trim()) {
        changedFiles.push(rel);
        diff += `${stdout}\n`;
      }
    } catch (err) {
      const out = String(err.stdout || '').trim();
      if (out) {
        changedFiles.push(rel);
        diff += `${out}\n`;
      }
    }
  }

  return { diff, changedFiles };
}

function removeWorktreeDir(worktreePath) {
  try {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  } catch (_) { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// runCodingTask
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string}   opts.npc           - NPC display name
 * @param {string}   opts.task          - Natural-language task description
 * @param {string[]} opts.targetFiles   - Relative file paths to work on
 * @param {object}   [opts.skillParams] - Raw skill params (for context)
 * @param {function} opts.broadcast     - Function(msgObject) → sends WS message
 * @returns {Promise<{ok: boolean, proposalId?: string, diff?: string, changedFiles?: string[], reportPath?: string, error?: string}>}
 */
async function runCodingTask({ npc, task, targetFiles, skillParams, broadcast }) {
  try {
    targetFiles = inferTargetFilesFromTask(task, targetFiles);

    // ------------------------------------------------------------------
    // 1. Guard checks
    // ------------------------------------------------------------------

    for (const f of targetFiles) {
      const normalized = f.replace(/\\/g, '/');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (normalized.includes(pattern)) {
          return { ok: false, error: 'Forbidden: NPC cannot modify soul/memory files' };
        }
      }
    }

    if (targetFiles.length > MAX_FILES_PER_TASK) {
      return { ok: false, error: `Too many files: max ${MAX_FILES_PER_TASK} per task` };
    }

    // At most 1 pending proposal per NPC
    for (const p of _proposals.values()) {
      if (p.npc === npc && p.status === 'pending_review') {
        return { ok: false, error: `${npc} already has a pending proposal (id: ${p.id})` };
      }
    }

    const authErr = codingBackendError();
    if (authErr) {
      return { ok: false, error: authErr };
    }

    const files = targetFiles;
    if (!files.length) {
      return { ok: false, error: 'coding-agent requires targetFiles (e.g. README.md)' };
    }

    // ------------------------------------------------------------------
    // 2. Create isolated worktree (git) or direct copy (Docker/NAS without .git)
    // ------------------------------------------------------------------

    const ts = Date.now();
    const useGit = await isGitRepository();
    const branchName = useGit
      ? `npc-coding-${npc.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${ts}`
      : null;
    const worktreePath = path.join(NPC_WORKTREES_DIR, `${npc}-${ts}`);
    const gitMode = useGit ? 'worktree' : 'direct';

    ensureDir(NPC_WORKTREES_DIR);

    if (useGit) {
      await execAsync(
        `git worktree add "${worktreePath}" -b "${branchName}"`,
        { cwd: projectRoot, windowsHide: true, timeout: 30000 },
      );
    } else {
      setupDirectWorktree(worktreePath, files);
    }

    // ------------------------------------------------------------------
    // 3. Run Claude Code or LM Studio file edit
    // ------------------------------------------------------------------

    const backend = resolveCodingBackend();
    let claudeOutput = '';

    if (backend === 'claude-code') {
      const claudePrompt = `${task}\n\nFiles to focus on: ${files.join(', ')}\n\nMake the minimal change needed. Do not add tests unless asked. Do not modify files outside the target list.`;
      const escapedPrompt = claudePrompt.replace(/"/g, '\\"');
      try {
        const { stdout } = await execAsync(
          `npx --yes @anthropic-ai/claude-code --print "${escapedPrompt}"`,
          { cwd: worktreePath, windowsHide: true, timeout: 120000 }
        );
        claudeOutput = stdout || '';
      } catch (err) {
        claudeOutput = (err.stdout || '') + (err.stderr ? `\n[stderr]: ${err.stderr}` : '');
        if (!claudeOutput.trim()) {
          claudeOutput = `Claude Code exited with error: ${err.message}`;
        }
      }

      if (isClaudeLoginFailure(claudeOutput)) {
        return {
          ok: false,
          error: 'Claude Code not authenticated (Not logged in). Set ANTHROPIC_API_KEY in container env.',
          claudeOutput: claudeOutput.slice(0, 500),
        };
      }
    } else {
      try {
        claudeOutput = await runLmStudioFileEdit({ worktreePath, targetFiles: files, task });
      } catch (err) {
        return {
          ok: false,
          error: `LM Studio coding fallback failed: ${err.message}`,
        };
      }
    }

    // ------------------------------------------------------------------
    // 4. Get the diff
    // ------------------------------------------------------------------

    let diff = '';
    let changedFiles = [];

    if (useGit) {
      try {
        const { stdout: diffOut } = await execAsync(
          'git diff HEAD',
          { cwd: worktreePath, windowsHide: true, timeout: 15000 },
        );
        diff = diffOut || '';
      } catch (_) { /* no staged changes is fine */ }

      try {
        const { stdout: nameOut } = await execAsync(
          'git diff --name-only HEAD',
          { cwd: worktreePath, windowsHide: true, timeout: 15000 },
        );
        changedFiles = (nameOut || '').split('\n').map(s => s.trim()).filter(Boolean);
      } catch (_) {}
    } else {
      const directDiff = await collectDirectDiff(worktreePath, files);
      diff = directDiff.diff;
      changedFiles = directDiff.changedFiles;
    }

    if (!diff.trim() && !changedFiles.length) {
      return {
        ok: false,
        error: 'Claude Code produced no file changes (empty diff). Check auth, prompt, and target files.',
        claudeOutput: claudeOutput.slice(0, 500),
      };
    }

    // ------------------------------------------------------------------
    // 5. Write proposal report
    // ------------------------------------------------------------------

    const id        = newId();
    const dateStr   = isoDate();
    const slug      = slugify(task);
    const reportName = `${npc.toLowerCase()}_${slug}_${dateStr.replace(/-/g, '')}.md`;
    const reportPath = path.join(CODE_REVIEWS_DIR, reportName);

    const reportContent = [
      `# Code Proposal — ${npc} — ${task}`,
      '',
      `**Requested by:** ${npc}`,
      `**Date:** ${new Date().toISOString()}`,
      '**Status:** `pending_review`',
      `**Target files:** ${files.join(', ')}`,
      `**Edit mode:** \`${gitMode}\`${gitMode === 'direct' ? ' (no .git in container — proposal copies files on approve)' : ''}`,
      '',
      '## Task',
      task,
      '',
      '## Claude Code Output',
      claudeOutput,
      '',
      '## Diff',
      '```diff',
      diff,
      '```',
      '',
      '## Changed Files',
      changedFiles.length ? changedFiles.map(f => `- ${f}`).join('\n') : '_(none)_',
      '',
      '---',
      `*Approve via \`POST /api/code-proposals/${id}/approve\` or reject via \`POST /api/code-proposals/${id}/reject\`*`,
    ].join('\n');

    writeReportFile(reportPath, reportContent);

    // ------------------------------------------------------------------
    // 6. Store proposal
    // ------------------------------------------------------------------

    const proposal = {
      id,
      npc,
      task,
      targetFiles,
      worktreePath,
      branchName,
      gitMode,
      reportPath,
      diff,
      changedFiles,
      status: 'pending_review',
      ts,
    };
    _proposals.set(id, proposal);

    // ------------------------------------------------------------------
    // 7. Broadcast WS event
    // ------------------------------------------------------------------

    if (typeof broadcast === 'function') {
      broadcast({ type: 'npc_code_proposal', npc, task, proposalId: id, changedFiles, reportPath });
    }

    // ------------------------------------------------------------------
    // 8. Return
    // ------------------------------------------------------------------

    return { ok: true, proposalId: id, diff, changedFiles, reportPath };

  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// getProposals
// ---------------------------------------------------------------------------

function getProposals() {
  return Array.from(_proposals.values());
}

// ---------------------------------------------------------------------------
// approveProposal
// ---------------------------------------------------------------------------

async function approveProposal(id, opts = {}) {
  try {
    const proposal = _proposals.get(id);
    if (!proposal) {
      return { ok: false, error: `Proposal ${id} not found` };
    }
    if (proposal.status !== 'pending_review') {
      return { ok: false, error: `Proposal ${id} is not pending_review (status: ${proposal.status})` };
    }

    if (proposal.gitMode === 'direct') {
      const toApply = proposal.changedFiles?.length ? proposal.changedFiles : proposal.targetFiles;
      for (const rel of toApply || []) {
        const src = path.join(proposal.worktreePath, rel);
        const dest = path.join(projectRoot, rel);
        if (!fs.existsSync(src)) continue;
        ensureDir(path.dirname(dest));
        fs.copyFileSync(src, dest);
      }
    } else {
      await execAsync(
        `git merge "${proposal.branchName}" --no-ff -m "Approve NPC coding proposal: ${proposal.task} (${id})"`,
        { cwd: projectRoot, windowsHide: true, timeout: 60000 },
      );
    }

    proposal.status = 'approved';
    proposal.review = {
      decision: 'approved',
      note: opts.note ? String(opts.note).slice(0, 400) : null,
      reviewedAt: new Date().toISOString(),
    };
    updateReportStatus(proposal.reportPath, 'pending_review', 'approved');

    if (proposal.gitMode === 'direct') {
      removeWorktreeDir(proposal.worktreePath);
    } else {
      try {
        await execAsync(
          `git worktree remove "${proposal.worktreePath}" --force`,
          { cwd: projectRoot, windowsHide: true, timeout: 15000 },
        );
      } catch (_) {}

      try {
        await execAsync(
          `git branch -d "${proposal.branchName}"`,
          { cwd: projectRoot, windowsHide: true, timeout: 10000 },
        );
      } catch (_) {}
    }

    return { ok: true };

  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// rejectProposal
// ---------------------------------------------------------------------------

async function rejectProposal(id, opts = {}) {
  try {
    const proposal = _proposals.get(id);
    if (!proposal) {
      return { ok: false, error: `Proposal ${id} not found` };
    }
    if (proposal.status !== 'pending_review') {
      return { ok: false, error: `Proposal ${id} is not pending_review (status: ${proposal.status})` };
    }
    const note = opts.note ? String(opts.note).slice(0, 400) : null;
    if (!note) {
      return { ok: false, error: 'Rejection requires a note explaining why' };
    }

    // Update status
    proposal.status = 'rejected';
    proposal.review = {
      decision: 'rejected',
      note,
      reviewedAt: new Date().toISOString(),
    };
    updateReportStatus(proposal.reportPath, 'pending_review', 'rejected');

    if (proposal.gitMode === 'direct') {
      removeWorktreeDir(proposal.worktreePath);
    } else {
      try {
        await execAsync(
          `git worktree remove "${proposal.worktreePath}" --force`,
          { cwd: projectRoot, windowsHide: true, timeout: 15000 },
        );
      } catch (_) {}

      try {
        await execAsync(
          `git branch -D "${proposal.branchName}"`,
          { cwd: projectRoot, windowsHide: true, timeout: 10000 },
        );
      } catch (_) {}
    }

    return { ok: true };

  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  runCodingTask,
  getProposals,
  approveProposal,
  rejectProposal,
  inferTargetFilesFromTask,
  inferSkillFilesFromTask,
  isGitRepository,
  setupDirectWorktree,
  collectDirectDiff,
};
