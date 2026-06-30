'use strict';
/**
 * Bouncer investigation bridge — local WSL/Kali, remote dolonia agent, or container patrol.
 */

const http = require('node:http');
const https = require('node:https');
const linuxAgent = require('./linux-agent');
const securityIp = require('./security-ip');

const COOLDOWN_MS = parseInt(process.env.BOUNCER_INVESTIGATION_COOLDOWN_MS, 10) || 900000;
const _cooldown = new Map();

function investigationKey(threat = {}) {
  return `${threat.category || 'unknown'}:${threat.source || 'unknown'}`;
}

function remoteInvestigationUrl() {
  return String(process.env.BOUNCER_INVESTIGATION_URL || '').trim().replace(/\/$/, '');
}

function remoteInvestigationToken() {
  return String(process.env.BOUNCER_INVESTIGATION_TOKEN || '').trim();
}

function canRunLocalWsl() {
  return process.platform === 'win32';
}

function takeInvestigationSlot(threat = {}, opts = {}) {
  const force = !!(opts.force || threat.force);
  if (!force && securityIp.isInternalThreatSource(threat.source, opts)) {
    return { allowed: false, key: 'internal', remainingSec: 0, loopback: true };
  }
  if (force) {
    return { allowed: true, key: investigationKey(threat), forced: true };
  }
  const key = investigationKey(threat);
  const last = _cooldown.get(key) || 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return {
      allowed: false,
      key,
      remainingSec: Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000),
    };
  }
  _cooldown.set(key, Date.now());
  return { allowed: true, key };
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
      timeout: 120000,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw || '{}') });
        } catch (_) {
          resolve({ status: res.statusCode, data: { ok: false, error: raw.slice(0, 400) } });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('investigation proxy timeout')); });
    req.write(data);
    req.end();
  });
}

async function remoteInvestigate(threat) {
  const base = remoteInvestigationUrl();
  if (!base) {
    return { ok: false, error: 'BOUNCER_INVESTIGATION_URL not set', category: threat.category };
  }
  const token = remoteInvestigationToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const { status, data } = await postJson(`${base}/api/bouncer-investigate`, { threat }, headers);
  if (status === 401 || status === 403) {
    return { ok: false, error: 'investigation proxy auth failed', category: threat.category };
  }
  if (!data?.ok && !data?.result) {
    return { ok: false, error: data?.error || `proxy HTTP ${status}`, category: threat.category };
  }
  const result = data.result || data;
  if (data.reportMd && !result.reportMd) result.reportMd = data.reportMd;
  return result;
}

async function investigate(threat, opts = {}) {
  if (canRunLocalWsl()) {
    return linuxAgent.investigate(threat);
  }
  const remote = remoteInvestigationUrl();
  if (remote) {
    return remoteInvestigate(threat);
  }
  return {
    ok: false,
    error: 'No WSL on this host and BOUNCER_INVESTIGATION_URL is unset',
    category: threat.category || 'unknown',
  };
}

async function perimeterPatrol() {
  if (canRunLocalWsl()) {
    return linuxAgent.perimeterPatrol();
  }
  const remote = remoteInvestigationUrl();
  if (remote) {
    const token = remoteInvestigationToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const { status, data } = await postJson(`${remote}/api/bouncer-patrol`, {}, headers);
    if (data?.patrol) return data.patrol;
    if (status >= 400) {
      return { ok: false, summary: data?.error || `patrol proxy HTTP ${status}`, elapsed: 0, openPorts: [] };
    }
  }
  if (linuxAgent.perimeterPatrolContainer) {
    return linuxAgent.perimeterPatrolContainer();
  }
  return { ok: false, summary: 'Patrol unavailable (no WSL, proxy, or container mode)', elapsed: 0, openPorts: [] };
}

function writeReport(threat, result, npcTools) {
  if (!result?.ok || typeof npcTools?.writeArtifact !== 'function') return null;
  try {
    const reportMd = result.reportMd || linuxAgent.buildReport(threat, result, null);
    const slug = (threat.category || 'investigation')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return npcTools.writeArtifact(
      'Bouncer', 'security',
      `bouncer_${slug}_${dateStr}_${Date.now()}`,
      reportMd,
    );
  } catch (err) {
    console.warn('[BouncerInvestigation] Report write failed:', err?.message || err);
    return null;
  }
}

function recordWorkOutput(threat, result, reportPath, denizenDb) {
  if (!denizenDb?.recordWorkOutput) return;
  try {
    denizenDb.recordWorkOutput({
      npcName: 'Bouncer',
      phase: 'security',
      action: 'investigation',
      note: `${threat.category || 'threat'}${threat.source ? ` from ${threat.source}` : ''}: ${String(result.summary || result.error || '').slice(0, 400)}`,
      artifactPath: reportPath || null,
      role: 'security-guard',
    });
  } catch (_) { /* non-fatal */ }
}

function escalateIfSerious(threat, result, reportPath, ctx = {}) {
  if (!result?.ok || typeof ctx.investigationIsSerious !== 'function') return;
  if (!ctx.investigationIsSerious(result)) return;
  const ref = reportPath ? ` Report: ${reportPath}.` : '';
  const task = `Security escalation: ${threat.category || 'unknown'} threat.${ref} Review and harden network config.`;
  if (ctx.npcBrains?.assignDirective) {
    ctx.npcBrains.assignDirective('Dan', 'Bouncer (investigation)', task, true);
    ctx.npcBrains.assignDirective('Abby', 'Bouncer (investigation)', `Security brief needed: ${threat.category || 'threat'}.${ref}`, false);
  }
  const msg = {
    type: 'npc_assign_directive',
    from: 'Bouncer',
    to: 'Dan',
    task,
    urgent: true,
  };
  if (typeof ctx.broadcast === 'function') ctx.broadcast(msg);
}

async function announceCeoReport(threat, result, reportPath, ctx = {}) {
  if (!result?.ok || !result.summary || !ctx.npcBrains?.getResponse) return;
  const fileRef = reportPath ? ` Full report filed at ${reportPath}.` : '';
  const reportPrompt = [
    `You just ran security commands to investigate a ${threat.category || 'unknown'} threat.`,
    `Here is what you found:\n${result.summary.slice(0, 800)}`,
    `Report the key findings to the CEO in one tight paragraph: what was found, how serious, what you did.${fileRef} No alarm, no dramatization. State facts and actions.`,
  ].join(' ');
  try {
    const text = await ctx.npcBrains.getResponse('Bouncer', 'CEO', reportPrompt, {
      kind: 'linux-investigation-report',
      description: 'Report security investigation findings to CEO.',
    });
    if (typeof ctx.broadcast === 'function') {
      ctx.broadcast({
        type: 'player_chat_response',
        npcName: 'Bouncer',
        text: typeof text === 'string' ? text : String(text || ''),
        delegation: null,
        actions: [],
      });
    }
  } catch (_) { /* non-fatal */ }
}

/**
 * Full post-investigation pipeline: report file, Supabase, WS, escalation, CEO line.
 */
async function completeInvestigation(threat, result, ctx = {}) {
  const reportPath = writeReport(threat, result, ctx.npcTools);
  recordWorkOutput(threat, result, reportPath, ctx.denizenDb);
  escalateIfSerious(threat, result, reportPath, ctx);
  await announceCeoReport(threat, result, reportPath, ctx);
  return { reportPath };
}

function createLinuxAgentBridge() {
  return {
    ...linuxAgent,
    investigate: (threat) => investigate(threat),
    perimeterPatrol: () => perimeterPatrol(),
  };
}

function validateInvestigationAuth(req) {
  const expected = remoteInvestigationToken();
  if (!expected) return true;
  const auth = String(req.headers.authorization || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const header = String(req.headers['x-bouncer-token'] || '').trim();
  return bearer === expected || header === expected;
}

module.exports = {
  investigate,
  perimeterPatrol,
  takeInvestigationSlot,
  investigationKey,
  canRunLocalWsl,
  remoteInvestigationUrl,
  completeInvestigation,
  writeReport,
  createLinuxAgentBridge,
  validateInvestigationAuth,
  COOLDOWN_MS,
};
