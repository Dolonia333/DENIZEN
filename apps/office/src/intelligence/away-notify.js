'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const jobCrmDefault = require('../pipelines/job-crm');
const gmailClientDefault = require('../pipelines/gmail-client');

let researchQueueDefault = null;
try {
  // Requested path: ../src/research-queue (resolves to this same src/ folder).
  researchQueueDefault = require('./research-queue');
} catch (_) {
  try { researchQueueDefault = require('./research-queue'); } catch (_) {}
}

const ROOT = path.resolve(__dirname, '..');
const REPORTS_RESEARCH_DIR = path.join(ROOT, 'reports', 'research');
const RESEARCH_QUEUE_FILE = path.join(ROOT, 'data', 'research-queue.json');

function _postJson(webhookUrl, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!webhookUrl) {
      resolve({ ok: false, skipped: true, reason: 'webhook url not configured' });
      return;
    }

    let parsed;
    try {
      parsed = new URL(webhookUrl);
    } catch (err) {
      reject(new Error(`invalid webhook url: ${err.message}`));
      return;
    }

    const body = JSON.stringify(payload || {});
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search || ''}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8');
          const status = Number(res.statusCode || 0);
          resolve({
            ok: status >= 200 && status < 300,
            status,
            responseText: responseText.slice(0, 2000),
          });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendDiscordWebhook(text, opts = {}) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || '';
  const payload = {
    content: String(text || ''),
    ...opts,
  };
  return _postJson(webhookUrl, payload, Number(opts.timeoutMs) || 10000);
}

async function sendSlackWebhook(text, opts = {}) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL || '';
  const payload = {
    text: String(text || ''),
    ...opts,
  };
  return _postJson(webhookUrl, payload, Number(opts.timeoutMs) || 10000);
}

function _composeNotifyText({ text, title, source }) {
  const lines = [];
  if (title) lines.push(String(title));
  if (source) lines.push(`source: ${String(source)}`);
  if (text) lines.push(String(text));
  return lines.join('\n');
}

async function notifyCeo({ text, title, source, channels } = {}) {
  const selected = Array.isArray(channels) && channels.length ? channels : ['discord', 'slack'];
  const body = _composeNotifyText({ text, title, source });
  const out = { ok: true, discord: null, slack: null };

  if (selected.includes('discord')) {
    try { out.discord = await sendDiscordWebhook(body); }
    catch (err) { out.ok = false; out.discord = { ok: false, error: err.message }; }
  }

  if (selected.includes('slack')) {
    try { out.slack = await sendSlackWebhook(body); }
    catch (err) { out.ok = false; out.slack = { ok: false, error: err.message }; }
  }

  return out;
}

function _readResearchQueueFromDisk() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RESEARCH_QUEUE_FILE, 'utf8'));
    if (Array.isArray(parsed)) return { items: parsed };
    if (Array.isArray(parsed.items)) return { items: parsed.items };
    return { items: [] };
  } catch (_) {
    return { items: [] };
  }
}

function _writeResearchQueueToDisk(items) {
  try {
    fs.mkdirSync(path.dirname(RESEARCH_QUEUE_FILE), { recursive: true });
    fs.writeFileSync(RESEARCH_QUEUE_FILE, JSON.stringify({ items }, null, 2), 'utf8');
  } catch (_) {}
}

function _listPendingQueueItems(researchQueue, researchSessions) {
  if (researchQueue && typeof researchQueue.listTopics === 'function') {
    try { return researchQueue.listTopics({ status: 'pending', limit: 50 }) || []; } catch (_) {}
  }
  if (researchQueue && typeof researchQueue.listPending === 'function') {
    try { return researchQueue.listPending({ limit: 50 }) || []; } catch (_) {}
  }
  if (researchQueue && typeof researchQueue.list === 'function') {
    try {
      const all = researchQueue.list({ limit: 200 }) || [];
      return all.filter((item) => (item.status || 'pending') === 'pending');
    } catch (_) {}
  }
  if (researchQueue && typeof researchQueue.loadQueue === 'function') {
    try {
      const loaded = researchQueue.loadQueue() || {};
      const arr = Array.isArray(loaded.topics) ? loaded.topics : (Array.isArray(loaded.items) ? loaded.items : []);
      return arr.filter((item) => (item.status || 'pending') === 'pending');
    } catch (_) {}
  }
  if (Array.isArray(researchSessions)) {
    return researchSessions.filter((item) => (item.status || 'pending') === 'pending');
  }
  return _readResearchQueueFromDisk().items.filter((item) => (item.status || 'pending') === 'pending');
}

function _recentResearchBriefs() {
  try {
    const now = Date.now();
    const cutoff = now - (24 * 60 * 60 * 1000);
    if (!fs.existsSync(REPORTS_RESEARCH_DIR)) return [];

    const files = fs.readdirSync(REPORTS_RESEARCH_DIR)
      .map((name) => path.join(REPORTS_RESEARCH_DIR, name))
      .filter((fullPath) => {
        try { return fs.statSync(fullPath).isFile(); } catch (_) { return false; }
      });

    return files
      .map((filePath) => {
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .filter((entry) => entry.mtimeMs >= cutoff)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 8)
      .map((entry) => {
        let summary = '';
        try {
          const raw = fs.readFileSync(entry.filePath, 'utf8');
          const line = raw
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l && !l.startsWith('#'));
          summary = line ? line.slice(0, 180) : '';
        } catch (_) {}
        return {
          name: path.basename(entry.filePath),
          at: new Date(entry.mtimeMs).toISOString(),
          summary,
        };
      });
  } catch (_) {
    return [];
  }
}

function buildDailyDigest({ jobCrm = jobCrmDefault, researchQueue = researchQueueDefault, researchSessions } = {}) {
  const lines = [];
  lines.push(`Daily digest — ${new Date().toLocaleString()}`);
  lines.push('');

  let standup = 'Job standup unavailable.';
  try {
    if (jobCrm && typeof jobCrm.buildWeeklyStandup === 'function') {
      standup = jobCrm.buildWeeklyStandup() || standup;
    }
  } catch (_) {}
  lines.push('== Job CRM standup ==');
  lines.push(standup);
  lines.push('');

  const pending = _listPendingQueueItems(researchQueue, researchSessions);
  lines.push(`== Pending research queue (${pending.length}) ==`);
  if (!pending.length) {
    lines.push('- none');
  } else {
    pending.slice(0, 10).forEach((item, idx) => {
      const title = item.title || item.topic || item.task || item.id || 'untitled';
      const owner = item.assignedTo || item.assignee || item.owner || 'unassigned';
      lines.push(`${idx + 1}. ${title} [owner: ${owner}]`);
    });
  }
  lines.push('');

  const briefs = _recentResearchBriefs();
  lines.push(`== Recent research briefs (last 24h: ${briefs.length}) ==`);
  if (!briefs.length) {
    lines.push('- none');
  } else {
    briefs.forEach((brief) => {
      const bits = [brief.name, `@ ${brief.at}`];
      if (brief.summary) bits.push(`— ${brief.summary}`);
      lines.push(`- ${bits.join(' ')}`);
    });
  }

  return lines.join('\n');
}

function _isGmailConfigured(gmailClient) {
  if (String(process.env.GMAIL_ENABLED || '').toLowerCase() === 'true') return true;
  const oauthFile = process.env.GMAIL_OAUTH_FILE || path.join(ROOT, 'data', 'gmail-oauth.json');
  if (fs.existsSync(oauthFile)) return true;
  try {
    if (gmailClient && typeof gmailClient.mode === 'function') return gmailClient.mode() === 'real';
  } catch (_) {}
  return false;
}

async function runDailyDigest(deps = {}) {
  const jobCrm = deps.jobCrm || jobCrmDefault;
  const researchQueue = deps.researchQueue || researchQueueDefault;
  const gmailClient = deps.gmailClient || gmailClientDefault;

  const text = buildDailyDigest({
    jobCrm,
    researchQueue,
    researchSessions: deps.researchSessions,
  });

  if (_isGmailConfigured(gmailClient) && gmailClient && typeof gmailClient.createDraft === 'function') {
    try {
      const to = process.env.DIGEST_EMAIL_TO || process.env.GMAIL_DIGEST_TO || process.env.GMAIL_TO || '';
      if (to) {
        const draft = await gmailClient.createDraft({
          to,
          subject: `Denizen Daily Digest — ${new Date().toLocaleDateString()}`,
          body: text,
          by: 'Lucy',
        });
        if (String(process.env.EMAIL_AUTOSEND || '').toLowerCase() === 'true'
          && gmailClient.sendDraft && draft && draft.id) {
          await gmailClient.sendDraft({ id: draft.id, autoSendAllowed: true });
        }
      }
    } catch (_) {
      // Intentionally swallow — daily digest should never crash the scheduler.
    }
  }

  try {
    await notifyCeo({
      title: 'Denizen Daily Digest',
      source: 'away-mode',
      text,
      channels: deps.channels || ['discord', 'slack'],
    });
  } catch (_) {
    // notifyCeo itself is safe, but keep this wrapper fire-and-forget.
  }

  return text;
}

function _nextPendingResearch(researchQueue, researchSessions) {
  if (researchQueue && typeof researchQueue.getNextPending === 'function') {
    try { return researchQueue.getNextPending(); } catch (_) {}
  }
  if (researchQueue && typeof researchQueue.nextPending === 'function') {
    try { return researchQueue.nextPending(); } catch (_) {}
  }

  const pending = _listPendingQueueItems(researchQueue, researchSessions);
  return pending[0] || null;
}

function _markResearchInProgress(item, researchQueue) {
  if (!item) return item;
  const id = item.id;

  if (researchQueue && typeof researchQueue.markInProgress === 'function') {
    try { return researchQueue.markInProgress(id, { startedAt: new Date().toISOString() }); } catch (_) {}
  }
  if (researchQueue && typeof researchQueue.update === 'function') {
    try { return researchQueue.update(id, { status: 'in_progress', startedAt: new Date().toISOString() }); } catch (_) {}
  }
  if (researchQueue && typeof researchQueue.updateItem === 'function') {
    try { return researchQueue.updateItem(id, { status: 'in_progress', startedAt: new Date().toISOString() }); } catch (_) {}
  }

  const store = _readResearchQueueFromDisk();
  const idx = store.items.findIndex((row) => row && row.id === id);
  if (idx >= 0) {
    store.items[idx] = {
      ...store.items[idx],
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    };
    _writeResearchQueueToDisk(store.items);
    return store.items[idx];
  }
  return {
    ...item,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
  };
}

async function runScheduledResearch(deps = {}) {
  const researchQueue = deps.researchQueue || researchQueueDefault;
  const assignDirectiveFn = deps.assignDirectiveFn;
  const from = deps.from || 'Lucy';

  const next = _nextPendingResearch(researchQueue, deps.researchSessions);
  if (!next) {
    return { ok: true, started: false, reason: 'no pending research' };
  }

  const to = next.assignedTo || next.assignee || next.owner || 'Bob';
  const task = next.directive
    || next.task
    || `Research "${next.topic || next.title || next.id || 'queued item'}" — read sources, write a markdown brief to reports/research/, and report key findings to the CEO.`;

  if (typeof assignDirectiveFn === 'function') {
    try { assignDirectiveFn(to, from, task, false); } catch (_) {}
  }

  const updated = _markResearchInProgress(next, researchQueue);
  return {
    ok: true,
    started: true,
    assignedTo: to,
    item: updated || next,
  };
}

module.exports = {
  sendDiscordWebhook,
  sendSlackWebhook,
  notifyCeo,
  buildDailyDigest,
  runDailyDigest,
  runScheduledResearch,
};
