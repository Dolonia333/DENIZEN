'use strict';

/**
 * Buzz context-drop — screenshot / voice / note → orchestrator directive.
 * Attachments reuse chat-attachments (persist + vision). Directives reuse
 * npcBrains.assignDirective. Broadcasts npc_work_output so the floor trail
 * shows the drop immediately.
 */

const fs = require('node:fs');
const path = require('node:path');
const npcRoster = require('./npc-roster');

const MAX_NOTE_CHARS = 4000;
const MAX_TRANSCRIPT_CHARS = 12000;
const MAX_RECENT = 40;
const DEFAULT_TARGET = 'Abby';

const _recent = [];

function recentDrops() {
  return _recent.slice();
}

function rememberDrop(entry) {
  _recent.unshift(entry);
  if (_recent.length > MAX_RECENT) _recent.length = MAX_RECENT;
  return entry;
}

function resolveNpcName(raw, roster = npcRoster) {
  const s = String(raw || '').trim();
  if (!s) return DEFAULT_TARGET;
  const names = roster?.displayNames || [];
  const byDisplay = names.find((n) => String(n).toLowerCase() === s.toLowerCase());
  if (byDisplay) return byDisplay;
  const entry = (roster?.entries || []).find((e) => (
    String(e.folder || '').toLowerCase() === s.toLowerCase()
    || String(e.display || '').toLowerCase() === s.toLowerCase()
  ));
  return entry?.display || DEFAULT_TARGET;
}

function clip(value, max) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
}

function isAllowedBuzzCapturePath(localPath) {
  const resolved = path.resolve(String(localPath || ''));
  const norm = resolved.replace(/\\/g, '/').toLowerCase();
  if (norm.includes('\0') || /(^|\/)\.\.(\/|$)/.test(norm)) return false;
  if (!/(^|\/)buzz-captures(\/|$)/.test(norm)) return false;
  const ext = path.extname(resolved).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
}

function readLocalCapture(localPath) {
  if (!localPath) return { ok: true, missing: true };
  if (!isAllowedBuzzCapturePath(localPath)) {
    return { ok: false, error: 'local_path_not_allowed' };
  }
  const resolved = path.resolve(String(localPath));
  if (!fs.existsSync(resolved)) {
    return { ok: true, missing: true, path: resolved };
  }
  const buf = fs.readFileSync(resolved);
  if (buf.length > 6 * 1024 * 1024) return { ok: false, error: 'capture_too_large' };
  const ext = path.extname(resolved).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return {
    ok: true,
    path: resolved,
    attachment: {
      name: path.basename(resolved),
      mime,
      data: buf.toString('base64'),
    },
  };
}

function buildDirectiveTask({
  note,
  transcript,
  contextBlock,
  kind,
  fromLabel,
} = {}) {
  const lines = [
    `[Buzz drop${kind ? `: ${kind}` : ''}] from ${fromLabel || 'Visitor'}.`,
    'Handle this like a CEO walk-up: do the work or delegate, then report back.',
  ];
  const instruction = clip(note, MAX_NOTE_CHARS);
  if (instruction) {
    lines.push('', '## Instruction', instruction);
  }
  const spoken = clip(transcript, MAX_TRANSCRIPT_CHARS);
  if (spoken && spoken !== instruction) {
    lines.push('', '## Transcript', spoken);
  }
  if (contextBlock) {
    lines.push(String(contextBlock).replace('## Files just shared with you in chat', '## Files attached to this Buzz drop'));
  }
  if (!instruction && !spoken && !contextBlock) {
    lines.push('', '(Empty drop — ask the sender what they meant.)');
  }
  return lines.join('\n');
}

/**
 * Process a Buzz / overlay drop.
 * deps: { processAttachments, assignDirective, broadcast, roster? }
 */
async function handleContextDrop(payload, deps = {}) {
  const note = clip(payload?.note, MAX_NOTE_CHARS);
  const transcript = clip(payload?.transcript, MAX_TRANSCRIPT_CHARS);
  const kind = String(payload?.kind || 'note').slice(0, 32);
  const fromLabel = String(payload?.from || payload?.from_label || 'Visitor').slice(0, 80);
  const to = resolveNpcName(payload?.to, deps.roster || npcRoster);

  const localCapture = readLocalCapture(payload?.localPath || payload?.local_path);
  if (localCapture.ok === false) {
    return { ok: false, error: localCapture.error || 'local_path_not_allowed' };
  }

  const rawAttachments = Array.isArray(payload?.attachments) ? payload.attachments.slice() : [];
  if (localCapture.attachment && !rawAttachments.length) {
    rawAttachments.push(localCapture.attachment);
  }
  if (localCapture.path) {
    const pathLine = localCapture.missing
      ? `Screenshot remains on the sender's disk: ${localCapture.path}`
      : `Screenshot on disk: ${localCapture.path}`;
    // path is appended via note below when no extra instruction was given
    if (!payload._pathNoted) {
      payload = { ...payload, note: [note, pathLine].filter(Boolean).join('\n') };
    }
  }
  const noteWithPath = clip(payload?.note, MAX_NOTE_CHARS);

  let contextBlock = '';
  let saved = [];
  if (rawAttachments.length && typeof deps.processAttachments === 'function') {
    const processed = await deps.processAttachments(rawAttachments);
    if (processed && processed.ok === false) {
      return { ok: false, error: processed.error || 'attachment_failed' };
    }
    contextBlock = processed?.contextBlock || '';
    saved = processed?.saved || [];
  } else if (rawAttachments.length) {
    return { ok: false, error: 'attachments_unsupported' };
  }

  const task = buildDirectiveTask({
    note: noteWithPath || note, transcript, contextBlock, kind, fromLabel,
  });

  let directive = null;
  if (typeof deps.assignDirective === 'function') {
    directive = deps.assignDirective(to, `Buzz (${fromLabel})`, task, true);
  }

  const drop = rememberDrop({
    id: directive?.id || `buzz_${Date.now().toString(36)}`,
    to,
    from: fromLabel,
    kind,
    note: (noteWithPath || note).slice(0, 240),
    localPath: localCapture.path || null,
    hasTranscript: !!transcript,
    attachments: (saved || []).map((s) => ({ name: s.name, url: s.url, kind: s.kind })),
    ts: Date.now(),
  });

  if (typeof deps.broadcast === 'function') {
    deps.broadcast({
      type: 'npc_work_output',
      npcName: to,
      phase: 'starting',
      phaseEmoji: '☎',
      note: note ? `Buzz: ${note.slice(0, 100)}` : `Buzz ${kind} drop`,
      action: 'buzz_drop',
      artifactPath: saved[0]?.url || null,
      ts: drop.ts,
    });
  }

  return {
    ok: true,
    to,
    from: fromLabel,
    kind,
    directiveId: directive?.id || null,
    saved,
    drop,
  };
}

function workbenchSnapshot(deps = {}) {
  const list = typeof deps.listDirectives === 'function' ? deps.listDirectives() : [];
  const directives = (Array.isArray(list) ? list : []).slice(0, 24).map((d) => ({
    npc: d.npc,
    from: d.from,
    task: String(d.task || '').slice(0, 280),
    status: d.status || 'queued',
    urgent: !!d.urgent,
    ts: d.ts || null,
    active: d.active !== false,
  }));
  return {
    ok: true,
    orchestrator: DEFAULT_TARGET,
    escalate: 'Spend, destructive ops, and scope changes wait for you.',
    directives,
    drops: recentDrops().slice(0, 16),
    crew: Array.isArray(deps.crew) ? deps.crew : [],
    handoffs: Array.isArray(deps.handoffs) ? deps.handoffs : [],
    approvals: Array.isArray(deps.approvals) ? deps.approvals : [],
    memory: Array.isArray(deps.memory) ? deps.memory : [],
    leash: deps.leash || null,
    providers: Array.isArray(deps.providers) ? deps.providers : [],
  };
}

module.exports = {
  MAX_NOTE_CHARS,
  DEFAULT_TARGET,
  resolveNpcName,
  buildDirectiveTask,
  handleContextDrop,
  workbenchSnapshot,
  recentDrops,
  rememberDrop,
  isAllowedBuzzCapturePath,
  readLocalCapture,
};
