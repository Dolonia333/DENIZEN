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

    // ------------------------------------------------------------------
    // 2. Create isolated worktree
    // ------------------------------------------------------------------

    const ts         = Date.now();
    const branchName = `npc-coding-${npc.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${ts}`;
    const worktreePath = path.join(NPC_WORKTREES_DIR, `${npc}-${ts}`);

    ensureDir(NPC_WORKTREES_DIR);

    await execAsync(
      `git worktree add "${worktreePath}" -b "${branchName}"`,
      { cwd: projectRoot, windowsHide: true, timeout: 30000 }
    );

    // ------------------------------------------------------------------
    // 3. Run Claude Code non-interactively
    // ------------------------------------------------------------------

    const claudePrompt = `${task}\n\nFiles to focus on: ${targetFiles.join(', ')}\n\nMake the minimal change needed. Do not add tests unless asked. Do not modify files outside the target list.`;
    const escapedPrompt = claudePrompt.replace(/"/g, '\\"');

    let claudeOutput = '';
    try {
      const { stdout } = await execAsync(
        `npx @anthropic-ai/claude-code --print "${escapedPrompt}"`,
        { cwd: worktreePath, windowsHide: true, timeout: 120000 }
      );
      claudeOutput = stdout || '';
    } catch (err) {
      // Claude Code may exit non-zero but still produce useful output
      claudeOutput = (err.stdout || '') + (err.stderr ? `\n[stderr]: ${err.stderr}` : '');
      if (!claudeOutput.trim()) {
        claudeOutput = `Claude Code exited with error: ${err.message}`;
      }
    }

    // ------------------------------------------------------------------
    // 4. Get the diff
    // ------------------------------------------------------------------

    let diff = '';
    let changedFiles = [];

    try {
      const { stdout: diffOut } = await execAsync(
        'git diff HEAD',
        { cwd: worktreePath, windowsHide: true, timeout: 15000 }
      );
      diff = diffOut || '';
    } catch (_) { /* no staged changes is fine */ }

    try {
      const { stdout: nameOut } = await execAsync(
        'git diff --name-only HEAD',
        { cwd: worktreePath, windowsHide: true, timeout: 15000 }
      );
      changedFiles = (nameOut || '').split('\n').map(s => s.trim()).filter(Boolean);
    } catch (_) {}

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
      `**Target files:** ${targetFiles.join(', ')}`,
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

async function approveProposal(id) {
  try {
    const proposal = _proposals.get(id);
    if (!proposal) {
      return { ok: false, error: `Proposal ${id} not found` };
    }
    if (proposal.status !== 'pending_review') {
      return { ok: false, error: `Proposal ${id} is not pending_review (status: ${proposal.status})` };
    }

    // Merge the branch into master from the main repo
    await execAsync(
      `git merge "${proposal.branchName}" --no-ff -m "Approve NPC coding proposal: ${proposal.task} (${id})"`,
      { cwd: projectRoot, windowsHide: true, timeout: 60000 }
    );

    // Update status
    proposal.status = 'approved';
    updateReportStatus(proposal.reportPath, 'pending_review', 'approved');

    // Clean up worktree and branch
    try {
      await execAsync(
        `git worktree remove "${proposal.worktreePath}" --force`,
        { cwd: projectRoot, windowsHide: true, timeout: 15000 }
      );
    } catch (_) {}

    try {
      await execAsync(
        `git branch -d "${proposal.branchName}"`,
        { cwd: projectRoot, windowsHide: true, timeout: 10000 }
      );
    } catch (_) {}

    return { ok: true };

  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// rejectProposal
// ---------------------------------------------------------------------------

async function rejectProposal(id) {
  try {
    const proposal = _proposals.get(id);
    if (!proposal) {
      return { ok: false, error: `Proposal ${id} not found` };
    }
    if (proposal.status !== 'pending_review') {
      return { ok: false, error: `Proposal ${id} is not pending_review (status: ${proposal.status})` };
    }

    // Update status
    proposal.status = 'rejected';
    updateReportStatus(proposal.reportPath, 'pending_review', 'rejected');

    // Clean up worktree and branch
    try {
      await execAsync(
        `git worktree remove "${proposal.worktreePath}" --force`,
        { cwd: projectRoot, windowsHide: true, timeout: 15000 }
      );
    } catch (_) {}

    try {
      await execAsync(
        `git branch -D "${proposal.branchName}"`,
        { cwd: projectRoot, windowsHide: true, timeout: 10000 }
      );
    } catch (_) {}

    return { ok: true };

  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { runCodingTask, getProposals, approveProposal, rejectProposal };
