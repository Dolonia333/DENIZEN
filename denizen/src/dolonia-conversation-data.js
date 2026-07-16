'use strict';

/**
 * Dolonia conversation data plane — dual-write quality conversation intelligence
 * into Supabase/Postgres. Denizen is product_key = "denizen" (first product).
 *
 * Works in denizen-server AND discord-bot sidecar (lazy PostgREST, no org required).
 * File lake (conversation-sense + discord-farm) remains the hot cache; this is the
 * durable data-company warehouse.
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (preferred) | SUPABASE_ANON_KEY
 *   DOLONIA_DATA=1|0          master switch (default on when URL set)
 *   DOLONIA_PRODUCT_KEY       default denizen
 *   DOLONIA_CONV_KEEP_DAYS    retention default 90
 */

const PRODUCT_DEFAULT = 'denizen';
const QUALITY_THRESHOLD = 0.45;

function productKey() {
  return String(process.env.DOLONIA_PRODUCT_KEY || PRODUCT_DEFAULT).trim() || PRODUCT_DEFAULT;
}

function dataEnabled() {
  const v = String(process.env.DOLONIA_DATA ?? '1').trim().toLowerCase();
  if (/^(0|false|no|off)$/.test(v)) return false;
  const url = String(process.env.SUPABASE_URL || '').trim();
  return !!url;
}

function restUrl() {
  return String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
}

function restKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || ''
  );
}

function headers(prefer) {
  const key = restKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

let _lastWarn = 0;
function warnOnce(msg) {
  const now = Date.now();
  if (now - _lastWarn < 60_000) return;
  _lastWarn = now;
  console.warn(`[dolonia-data] ${msg}`);
}

async function restGet(path) {
  const res = await fetch(`${restUrl()}/rest/v1/${path}`, {
    headers: headers(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GET ${path} → ${res.status} ${t.slice(0, 100)}`);
  }
  return res.json();
}

async function restPost(table, body, prefer = 'return=minimal') {
  const res = await fetch(`${restUrl()}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(prefer),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`POST ${table} → ${res.status} ${t.slice(0, 140)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return res.json();
  return null;
}

async function restRpc(fn, body) {
  const res = await fetch(`${restUrl()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`RPC ${fn} → ${res.status} ${t.slice(0, 140)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return res.json();
  return null;
}

/** Fire-and-forget queue so Discord path never blocks on Postgres. */
const _queue = [];
let _draining = false;

function enqueue(fn) {
  if (!dataEnabled() || !restKey()) return;
  _queue.push(fn);
  void drain();
}

async function drain() {
  if (_draining) return;
  _draining = true;
  while (_queue.length) {
    const fn = _queue.shift();
    try {
      await fn();
    } catch (err) {
      warnOnce(err?.message || String(err));
    }
  }
  _draining = false;
}

/**
 * Score an event for data quality (0–1). Higher = more useful for products/ML later.
 * @param {{
 *   len?: number,
 *   signals?: string[],
 *   topics?: string[],
 *   stylePrimary?: string|null,
 *   body?: string|null,
 *   content?: string,
 * }} e
 */
function scoreEventQuality(e = {}) {
  let s = 0.2;
  const len = Number(e.len ?? e.content?.length ?? 0) || 0;
  if (len >= 8 && len <= 600) s += 0.2;
  else if (len > 600 && len <= 2000) s += 0.12;
  else if (len < 4) s -= 0.1;

  const signals = Array.isArray(e.signals) ? e.signals : [];
  const topics = Array.isArray(e.topics) ? e.topics : [];
  if (topics.length) s += Math.min(0.18, 0.06 * topics.length);
  if (signals.includes('question')) s += 0.12;
  if (signals.includes('friction')) s += 0.1;
  if (signals.includes('praise')) s += 0.06;
  if (e.stylePrimary) s += 0.12;
  if (e.body || e.content) s += 0.08;

  const raw = String(e.content || e.body || '');
  if (/^[,/!]/.test(raw) && raw.length < 40) s -= 0.25; // pure command noise

  return Math.max(0, Math.min(1, Number(s.toFixed(4))));
}

function isQuality(score) {
  return Number(score) >= QUALITY_THRESHOLD;
}

/**
 * Dual-write one conversation event + related profile/theme updates.
 * Non-blocking.
 * @param {object} evt
 */
function recordConversationEvent(evt = {}) {
  if (!dataEnabled()) return { ok: false, reason: 'disabled' };

  const product = evt.productKey || productKey();
  const quality = scoreEventQuality(evt);
  const qualityFlag = isQuality(quality);
  const userHash = evt.userHash || null;
  if (!userHash) return { ok: false, reason: 'no_user_hash' };

  const row = {
    product_key: product,
    org_id: evt.orgId || null,
    source: evt.source || 'discord',
    guild_id: evt.guildId || null,
    channel_id: evt.channelId || null,
    user_hash: String(userHash),
    message_id: evt.messageId || null,
    event_ts: evt.ts ? new Date(evt.ts).toISOString() : new Date().toISOString(),
    msg_len: evt.len ?? (evt.content ? String(evt.content).length : null),
    signals: Array.isArray(evt.signals) ? evt.signals : [],
    topics: Array.isArray(evt.topics) ? evt.topics.slice(0, 12) : [],
    style_primary: evt.stylePrimary || null,
    style_types: Array.isArray(evt.styleTypes) ? evt.styleTypes : [],
    body_redacted: evt.body ? String(evt.body).slice(0, 2000) : null,
    quality_score: quality,
    is_quality: qualityFlag,
    metadata: {
      display_name: evt.displayName || null,
      guild_name: evt.guildName || null,
      channel_name: evt.channelName || null,
      ...(evt.metadata && typeof evt.metadata === 'object' ? evt.metadata : {}),
    },
  };

  enqueue(async () => {
    await restPost('dolonia_conv_events', row, 'return=minimal');

    // Theme bumps (RPC)
    const friction = row.signals.includes('friction') ? 1 : 0;
    const question = row.signals.includes('question') ? 1 : 0;
    for (const topic of row.topics.slice(0, 6)) {
      try {
        await restRpc('dolonia_conv_bump_theme', {
          p_product_key: product,
          p_topic: topic,
          p_friction: friction,
          p_question: question,
          p_at: row.event_ts,
        });
      } catch (_) { /* theme optional if migration lag */ }
    }
  });

  return { ok: true, quality, isQuality: qualityFlag, queued: true };
}

/**
 * Upsert person style profile into warehouse.
 */
function upsertPersonStyle(profile = {}) {
  if (!dataEnabled()) return { ok: false, reason: 'disabled' };
  const userHash = profile.userHash;
  if (!userHash) return { ok: false, reason: 'no_user_hash' };

  const product = profile.productKey || productKey();
  const sampleN = Number(profile.sampleN || profile.n || 0) || 0;
  // Profile quality: more samples + clear primary = higher
  let q = Math.min(1, 0.25 + Math.min(0.5, sampleN / 40));
  if (profile.primary) q += 0.15;
  q = Math.max(0, Math.min(1, Number(q.toFixed(4))));

  const row = {
    product_key: product,
    user_hash: String(userHash),
    sample_n: sampleN,
    primary_style: profile.primary || null,
    style_types: Array.isArray(profile.types) ? profile.types : [],
    stats: profile.stats && typeof profile.stats === 'object' ? profile.stats : {},
    quality_score: q,
    last_guild_id: profile.lastGuildId || null,
    last_source: profile.source || null,
    updated_at: new Date().toISOString(),
  };

  enqueue(async () => {
    await restPost(
      'dolonia_conv_person_styles?on_conflict=product_key,user_hash',
      row,
      'resolution=merge-duplicates,return=minimal',
    );
  });
  return { ok: true, quality: q, queued: true };
}

/**
 * Upsert community voice profile.
 */
function upsertCommunity(profile = {}) {
  if (!dataEnabled()) return { ok: false, reason: 'disabled' };
  const communityId = profile.communityId || profile.guildId;
  if (!communityId) return { ok: false, reason: 'no_community' };

  const product = profile.productKey || productKey();
  const sampleN = Number(profile.sampleN || profile.peopleSample || 0) || 0;
  let q = Math.min(1, 0.2 + Math.min(0.55, sampleN / 80));
  if (profile.primary) q += 0.15;
  q = Math.max(0, Math.min(1, Number(q.toFixed(4))));

  const row = {
    product_key: product,
    community_id: String(communityId),
    sample_n: sampleN,
    primary_style: profile.primary || null,
    style_types: Array.isArray(profile.types) ? profile.types : [],
    type_counts: profile.typeCounts && typeof profile.typeCounts === 'object' ? profile.typeCounts : {},
    stats: profile.stats && typeof profile.stats === 'object' ? profile.stats : {},
    quality_score: q,
    updated_at: new Date().toISOString(),
  };

  enqueue(async () => {
    await restPost(
      'dolonia_conv_communities?on_conflict=product_key,community_id',
      row,
      'resolution=merge-duplicates,return=minimal',
    );
  });
  return { ok: true, quality: q, queued: true };
}

/**
 * Warehouse quality scorecard for dashboards / API.
 */
async function buildWarehouseScorecard(opts = {}) {
  const product = opts.productKey || productKey();
  const out = {
    ok: true,
    productKey: product,
    enabled: dataEnabled(),
    at: new Date().toISOString(),
    source: 'supabase',
    people: 0,
    communities: 0,
    events24h: 0,
    qualityEvents24h: 0,
    avgQuality24h: null,
    styleMix: [],
    topThemes: [],
    daily: null,
    notes: [],
  };

  if (!dataEnabled() || !restKey()) {
    out.ok = false;
    out.notes.push('warehouse_disabled_or_no_key');
    return out;
  }

  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const people = await restGet(
      `dolonia_conv_person_styles?select=user_hash&product_key=eq.${encodeURIComponent(product)}&limit=1`,
    ).catch(() => null);
    // count via Prefer count — PostgREST: use head; fallback length of limited query
    const peopleRows = await restGet(
      `dolonia_conv_person_styles?select=primary_style,sample_n,quality_score&product_key=eq.${encodeURIComponent(product)}&order=sample_n.desc&limit=500`,
    );
    out.people = Array.isArray(peopleRows) ? peopleRows.length : 0;

    const styleCounts = {};
    for (const r of peopleRows || []) {
      const k = r.primary_style || 'unknown';
      styleCounts[k] = (styleCounts[k] || 0) + 1;
    }
    out.styleMix = Object.entries(styleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    const comm = await restGet(
      `dolonia_conv_communities?select=community_id&product_key=eq.${encodeURIComponent(product)}&limit=500`,
    );
    out.communities = Array.isArray(comm) ? comm.length : 0;

    const events = await restGet(
      `dolonia_conv_events?select=quality_score,is_quality&product_key=eq.${encodeURIComponent(product)}&event_ts=gte.${encodeURIComponent(since)}&limit=2000`,
    );
    out.events24h = Array.isArray(events) ? events.length : 0;
    const qEvents = (events || []).filter((e) => e.is_quality);
    out.qualityEvents24h = qEvents.length;
    if (events?.length) {
      const sum = events.reduce((a, e) => a + (Number(e.quality_score) || 0), 0);
      out.avgQuality24h = Number((sum / events.length).toFixed(4));
    }

    const themes = await restGet(
      `dolonia_conv_themes?select=topic,hit_count,friction_count,question_count&product_key=eq.${encodeURIComponent(product)}&order=hit_count.desc&limit=12`,
    );
    out.topThemes = (themes || []).map((t) => ({
      topic: t.topic,
      count: t.hit_count,
      friction: t.friction_count,
      questions: t.question_count,
    }));

    // best-effort daily rollup
    try {
      out.daily = await restRpc('dolonia_conv_rollup_daily', {
        p_product_key: product,
        p_day: new Date().toISOString().slice(0, 10),
      });
    } catch (_) {
      out.notes.push('daily_rollup_pending');
    }

    if (!people && out.people === 0) out.notes.push('no_people_yet');
    if (out.events24h === 0) out.notes.push('no_events_24h');
    else out.notes.push(`quality_ratio_${out.events24h ? (out.qualityEvents24h / out.events24h).toFixed(2) : 0}`);

    void people; // silence lint
  } catch (err) {
    out.ok = false;
    out.error = err?.message || String(err);
    out.notes.push('warehouse_query_failed');
    warnOnce(out.error);
  }

  return out;
}

/** Run retention purge (service). */
async function retain(opts = {}) {
  if (!dataEnabled()) return { ok: false, reason: 'disabled' };
  const days = Number(opts.keepDays || process.env.DOLONIA_CONV_KEEP_DAYS || 90);
  try {
    const deleted = await restRpc('dolonia_conv_retain', {
      p_product_key: opts.productKey || productKey(),
      p_keep_days: days,
    });
    return { ok: true, deleted, keepDays: days };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

module.exports = {
  productKey,
  dataEnabled,
  scoreEventQuality,
  isQuality,
  recordConversationEvent,
  upsertPersonStyle,
  upsertCommunity,
  buildWarehouseScorecard,
  retain,
  QUALITY_THRESHOLD,
  enqueue,
};
