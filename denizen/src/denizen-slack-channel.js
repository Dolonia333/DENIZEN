'use strict';

/**
 * Per-visitor Slack channel — outgoing webhooks + inbound relay to assistant chat.
 */

const https = require('node:https');
const http = require('node:http');
const visitorIntel = require('./denizen-visitor-intelligence.js');

function _postJson(webhookUrl, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!webhookUrl) {
      resolve({ ok: false, skipped: true, reason: 'no webhook' });
      return;
    }
    let parsed;
    try {
      parsed = new URL(webhookUrl);
    } catch (err) {
      reject(new Error(`invalid webhook url: ${err.message}`));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload || {});
    const req = lib.request(
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
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function resolveWebhookUrl(sessionId) {
  const profile = await visitorIntel.getProfile(sessionId).catch(() => ({}));
  return profile.slack_webhook_url || process.env.SLACK_WEBHOOK_URL || '';
}

async function sendToSlack(sessionId, text, opts = {}) {
  const webhook = await resolveWebhookUrl(sessionId);
  const payload = {
    text: String(text || '').slice(0, 3500),
    username: opts.username || 'Denizen Assistant',
    icon_emoji: opts.iconEmoji || ':robot_face:',
  };
  return _postJson(webhook, payload, opts.timeoutMs);
}

async function linkSlackSession(sessionId, { webhookUrl, slackUserId } = {}) {
  return visitorIntel.upsertProfile(sessionId, {
    slack_webhook_url: webhookUrl || null,
    slack_user_id: slackUserId || null,
  });
}

/**
 * Handle Slack Events API challenge or inbound message stub.
 * Full OAuth app is out of scope — this supports webhook relay + challenge.
 */
function handleSlackChallenge(body) {
  if (body?.type === 'url_verification' && body.challenge) {
    return { challenge: body.challenge };
  }
  return null;
}

async function relaySlackInbound(body, deps = {}) {
  const challenge = handleSlackChallenge(body);
  if (challenge) return { ok: true, challenge: challenge.challenge };

  const event = body?.event;
  if (!event || event.type !== 'message' || event.subtype) {
    return { ok: true, skipped: true };
  }

  const slackUserId = event.user;
  const text = String(event.text || '').trim();
  if (!text) return { ok: true, skipped: true };

  if (typeof deps.resolveSessionBySlackUser === 'function') {
    const sessionId = await deps.resolveSessionBySlackUser(slackUserId);
    if (sessionId && typeof deps.onInboundMessage === 'function') {
      await deps.onInboundMessage({ sessionId, text, slackUserId });
      return { ok: true, relayed: true, sessionId };
    }
  }

  return { ok: true, skipped: true, reason: 'no session mapping' };
}

module.exports = {
  sendToSlack,
  linkSlackSession,
  handleSlackChallenge,
  relaySlackInbound,
  resolveWebhookUrl,
};
