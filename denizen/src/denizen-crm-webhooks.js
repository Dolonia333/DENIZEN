'use strict';

/**
 * Outbound CRM webhooks (n8n Webhook trigger, or any HTTPS endpoint).
 * Configure workspace.integrations.outboundWebhooks = { deal_won: url, contact_added: url }
 */

async function postWebhook(url, payload) {
  const u = String(url || '').trim();
  if (!u.startsWith('http')) return { ok: false, skipped: true };
  try {
    const res = await fetch(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Denizen-CRM/1.0' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function webhookUrls(state) {
  const integrations = state?.integrations && typeof state.integrations === 'object'
    ? state.integrations
    : {};
  const hooks = integrations.outboundWebhooks && typeof integrations.outboundWebhooks === 'object'
    ? integrations.outboundWebhooks
    : {};
  return hooks;
}

async function emitCrmWebhooks(prevState, nextState, orgId) {
  const hooks = webhookUrls(nextState);
  if (!Object.keys(hooks).length) return;

  const prevContacts = Array.isArray(prevState?.contacts) ? prevState.contacts : [];
  const nextContacts = Array.isArray(nextState?.contacts) ? nextState.contacts : [];
  const prevDeals = Array.isArray(prevState?.deals) ? prevState.deals : [];
  const nextDeals = Array.isArray(nextState?.deals) ? nextState.deals : [];

  const tasks = [];

  for (const c of nextContacts) {
    if (!prevContacts.find((p) => String(p?.id) === String(c?.id))) {
      if (hooks.contact_added) {
        tasks.push(postWebhook(hooks.contact_added, {
          event: 'contact_added',
          org_id: orgId,
          at: new Date().toISOString(),
          contact: c,
        }));
      }
    }
  }

  for (const d of nextDeals) {
    const prev = prevDeals.find((p) => String(p?.id) === String(d?.id));
    const wasWon = /closed won/i.test(String(prev?.stage || ''));
    const isWon = /closed won/i.test(String(d?.stage || ''));
    if (isWon && !wasWon && hooks.deal_won) {
      tasks.push(postWebhook(hooks.deal_won, {
        event: 'deal_won',
        org_id: orgId,
        at: new Date().toISOString(),
        deal: d,
      }));
    }
  }

  if (tasks.length) await Promise.allSettled(tasks);
}

module.exports = { emitCrmWebhooks, postWebhook };
