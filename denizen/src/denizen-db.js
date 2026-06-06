'use strict';
/**
 * DenizenDb — server-side Supabase instrumentation.
 *
 * Dual-writes runtime events to Postgres so facts accumulate for analytics
 * and future prediction. Fire-and-forget async queue; never blocks NPC loops.
 *
 * Env:
 *   SUPABASE_URL              PostgREST base (default http://127.0.0.1:54321)
 *   SUPABASE_ANON_KEY         Local anon key (falls back to Supabase demo key)
 *   DENIZEN_DB_ENABLED        true|false (default true when URL set)
 *   DENIZEN_ORG_SLUG          org slug (default zion)
 */

const os = require('node:os');
const npcRoster = require('./npc-roster');

const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const DISPLAY_TO_NPC_KEY = Object.fromEntries(
  (npcRoster.entries || []).map((e) => [e.display.toLowerCase(), e.folder]),
);

const WORLD_STATE_FACT_KINDS = new Set(['task', 'threat', 'threat-cleared', 'event']);

class DenizenDb {
  constructor(opts = {}) {
    this.env = opts.env || process.env;
    this.url = String(this.env.SUPABASE_URL || '').replace(/\/$/, '');
    this.key =
      this.env.SUPABASE_ANON_KEY ||
      this.env.SUPABASE_SERVICE_ROLE_KEY ||
      LOCAL_ANON_KEY;
    const enabledEnv = this.env.DENIZEN_DB_ENABLED;
    this.enabled =
      this.url.length > 0 &&
      (enabledEnv == null || !/^(0|false|no|off)$/i.test(String(enabledEnv)));
    this.orgSlug = this.env.DENIZEN_ORG_SLUG || 'zion';
    this.orgId = null;
    this.officeSessionId = null;
    this._queue = [];
    this._draining = false;
    this._bound = null;
    this._lastWarnAt = 0;
    this._ready = false;
  }

  npcKey(displayName) {
    if (!displayName) return null;
    return DISPLAY_TO_NPC_KEY[String(displayName).toLowerCase()] || String(displayName).toLowerCase();
  }

  async init() {
    if (!this.enabled) {
      console.log('[DenizenDb] disabled (no SUPABASE_URL or DENIZEN_DB_ENABLED=false)');
      return { ok: false, reason: 'disabled' };
    }
    try {
      const orgs = await this._get(
        `denizen_organizations?select=id&slug=eq.${encodeURIComponent(this.orgSlug)}`,
      );
      this.orgId = orgs?.[0]?.id || null;
      if (!this.orgId) {
        this._warnOnce(`org "${this.orgSlug}" not found — apply migrations first`);
        return { ok: false, reason: 'no_org' };
      }

      const sessionRows = await this._post(
        'denizen_office_sessions',
        {
          org_id: this.orgId,
          hostname: os.hostname(),
          denizen_version: this.env.DENIZEN_VERSION || 'dev',
          metadata: { pid: process.pid, node: process.version },
        },
        { prefer: 'return=representation' },
      );
      this.officeSessionId = sessionRows?.[0]?.id || null;
      this._ready = true;

      await this.recordFact({
        factType: 'office.started',
        actorType: 'system',
        actorId: 'denizen-server',
        payload: {
          office_session_id: this.officeSessionId,
          hostname: os.hostname(),
          port: Number(this.env.PORT) || 3000,
        },
        tags: ['office', 'boot'],
      });

      console.log(
        `[DenizenDb] connected org=${this.orgSlug} session=${this.officeSessionId?.slice(0, 8) || '?'}…`,
      );
      return { ok: true, orgId: this.orgId, officeSessionId: this.officeSessionId };
    } catch (err) {
      this._warnOnce(`init failed: ${err?.message || err}`);
      return { ok: false, reason: err?.message || String(err) };
    }
  }

  attachWorldState(worldState) {
    if (!worldState || this._bound || !this.enabled) return;
    this._bound = ({ kind, payload }) => {
      if (!WORLD_STATE_FACT_KINDS.has(kind)) return;
      this.enqueue(() => this._recordWorldStateChange(kind, payload));
    };
    worldState.on('change', this._bound);
  }

  detachWorldState(worldState) {
    if (this._bound && worldState) {
      worldState.off('change', this._bound);
      this._bound = null;
    }
  }

  recordWorkOutput({ npcName, phase, action, note, artifactPath, role }) {
    if (!this.enabled) return;
    const npc_key = this.npcKey(npcName);
    this.enqueue(async () => {
      const row = {
        org_id: this.orgId,
        office_session_id: this.officeSessionId,
        npc_key,
        role: role || null,
        phase: phase || null,
        action: action || 'work',
        note: String(note || '').slice(0, 500),
        artifact_path: artifactPath || null,
        metadata: { display_name: npcName },
      };
      const inserted = await this._post('denizen_work_output', row, {
        prefer: 'return=representation',
      });
      const workId = inserted?.[0]?.id || null;

      await this.recordFact({
        factType: `npc.work.${phase || 'update'}`,
        actorType: 'npc',
        actorId: npc_key,
        payload: {
          title: `${npcName}: ${String(note || '').slice(0, 80)}`,
          phase,
          action,
          artifact_path: artifactPath,
          work_output_id: workId,
        },
        sourceTable: 'denizen_work_output',
        sourceId: workId,
        tags: ['npc', 'work', phase].filter(Boolean),
      });

      if (artifactPath) {
        try {
          await this._post('denizen_artifacts', {
            path: artifactPath,
            author_npc: npc_key,
            work_output_id: workId,
            category: 'report',
            metadata: { note: String(note || '').slice(0, 200) },
          });
        } catch (_) {
          /* duplicate path is fine */
        }
      }
    });
  }

  recordLlmEvent(rec) {
    if (!this.enabled || !rec) return;
    this.enqueue(async () => {
      const npc_key = rec.npc ? this.npcKey(rec.npc) : null;
      const row = {
        org_id: rec.orgId || this.orgId,
        at: rec.at || new Date().toISOString(),
        npc_key,
        kind: rec.kind || 'other',
        provider: rec.provider || null,
        model: rec.model || null,
        latency_ms: rec.latencyMs ?? null,
        tokens_in: rec.tokensIn ?? null,
        tokens_out: rec.tokensOut ?? null,
        error: rec.error?.message || null,
        prompt_preview: rec.promptPreview || null,
        response_preview: rec.responsePreview || null,
        correlation_id: rec.correlationId || rec.id || null,
        metadata: {
          telemetry_id: rec.id,
          error_category: rec.error?.category || null,
          conversation_msgs: rec.conversationMsgs ?? null,
          visitor_session_id: rec.visitorSessionId || null,
          visitor_tier: rec.visitorTier || null,
        },
      };
      const inserted = await this._post('denizen_llm_events', row, {
        prefer: 'return=representation',
      });
      const llmId = inserted?.[0]?.id || null;

      await this.recordFact({
        factType: rec.error ? 'llm.failed' : 'llm.completed',
        actorType: rec.npc ? 'npc' : 'system',
        actorId: npc_key || rec.npc || 'system',
        payload: {
          kind: rec.kind,
          provider: rec.provider,
          model: rec.model,
          latency_ms: rec.latencyMs,
          tokens_in: rec.tokensIn,
          tokens_out: rec.tokensOut,
          llm_event_id: llmId,
        },
        sourceTable: 'denizen_llm_events',
        sourceId: llmId,
        tags: ['llm', rec.kind, rec.provider].filter(Boolean),
      });
    });
  }

  async recordFact({
    factType,
    actorType,
    actorId,
    entityType,
    entityId,
    payload,
    tags,
    sourceTable,
    sourceId,
    correlationId,
    causationId,
  }) {
    if (!this.enabled || !this.orgId) return null;
    return this._rpc('denizen_record_fact', {
      p_org_id: this.orgId,
      p_fact_type: factType,
      p_actor_type: actorType,
      p_actor_id: actorId || null,
      p_entity_type: entityType || null,
      p_entity_id: entityId || null,
      p_payload: payload || {},
      p_correlation_id: correlationId || null,
      p_causation_id: causationId || null,
      p_source_table: sourceTable || null,
      p_source_id: sourceId || null,
      p_tags: tags || [],
    });
  }

  /**
   * Record a labeled outcome and auto-validate matching predictions.
   */
  recordOutcome({
    outcomeType,
    entityType,
    entityId = null,
    entityKey = null,
    valueJson = {},
    horizon = null,
    valueNumeric = null,
    valueText = null,
  }) {
    if (!this.enabled || !this.orgId) return;
    this.enqueue(async () => {
      await this._rpc('denizen_record_outcome', {
        p_org_id: this.orgId,
        p_outcome_type: outcomeType,
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_entity_key: entityKey,
        p_value_json: valueJson,
        p_horizon: horizon,
        p_value_numeric: valueNumeric,
        p_value_text: valueText,
      });
    });
  }

  /** Upsert a job application row for Roki / intelligence spine. */
  syncJobApplication(app, opts = {}) {
    if (!this.enabled || !this.orgId || !app?.id) return;
    const row = {
      id: String(app.id),
      company: app.company || null,
      role: app.role || app.title || null,
      status: app.status || 'new',
      score: app.score ?? null,
      url: app.url || null,
      site: app.site || null,
      prep_path: app.prepPath || app.prep_path || null,
      last_email_at: app.lastEmailAt || app.last_email_at || null,
      org_id: opts.orgId || this.orgId,
      npc_key: opts.npcKey || app.npcKey || app.npc_key || 'roki',
      session_id: opts.sessionId || app.sessionId || app.session_id || null,
      metadata: {
        scoreReasons: app.scoreReasons || app.score_reasons || null,
        recommendation: app.recommendation || null,
        appliedAt: app.appliedAt || app.applied_at || null,
        updatedAt: app.updatedAt || app.updated_at || null,
      },
      updated_at: new Date().toISOString(),
    };
    this.enqueue(async () => {
      const existing = await this._get(
        `denizen_job_applications?select=id&limit=1&id=eq.${encodeURIComponent(row.id)}`,
      ).catch(() => []);
      if (existing?.length) {
        await this._patch(
          `denizen_job_applications?id=eq.${encodeURIComponent(row.id)}`,
          row,
          { prefer: 'return=minimal' },
        );
      } else {
        row.created_at = app.createdAt || app.created_at || row.updated_at;
        await this._post('denizen_job_applications', row, { prefer: 'return=minimal' });
      }
    });
  }

  syncAllJobApplications(apps, opts = {}) {
    if (!Array.isArray(apps)) return;
    for (const app of apps) this.syncJobApplication(app, opts);
  }

  /** Job CRM outcomes (text app ids, not UUIDs). */
  recordJobOutcome(appId, outcome, meta = {}) {
    if (!this.enabled || !this.orgId || !appId) return;
    const outcomeType = `job.${outcome}`;
    this.enqueue(async () => {
      await this._rpc('denizen_record_outcome', {
        p_org_id: this.orgId,
        p_outcome_type: outcomeType,
        p_entity_type: 'job_application',
        p_entity_id: null,
        p_entity_key: String(appId),
        p_value_json: { appId, outcome, ...meta },
        p_horizon: null,
        p_value_numeric: meta.score ?? null,
        p_value_text: meta.site || null,
      });
      await this.recordFact({
        factType: outcomeType,
        actorType: 'system',
        actorId: 'job-crm',
        entityType: 'job_application',
        entityId: null,
        payload: { appId, outcome, ...meta, entity_key: String(appId) },
        tags: ['job', outcome],
      });
    });
  }

  enqueue(fn) {
    if (!this.enabled) return;
    this._queue.push(fn);
    this._drain();
  }

  async _drain() {
    if (this._draining) return;
    this._draining = true;
    while (this._queue.length > 0) {
      const fn = this._queue.shift();
      try {
        await fn();
      } catch (err) {
        this._warnOnce(`write failed: ${err?.message || err}`);
      }
    }
    this._draining = false;
  }

  async _recordWorldStateChange(kind, payload) {
    const factType = `office.${kind}`;
    let actorId = 'world-state';
    let text = '';

    if (kind === 'task' && payload?.task) {
      text = payload.task.title || payload.task.id || '';
      actorId = payload.task.assignee || actorId;
    } else if (kind === 'threat' && payload) {
      text = `${payload.category || 'threat'}: ${payload.detail || payload.source || ''}`.slice(0, 200);
    } else if (kind === 'threat-cleared' && payload) {
      text = `cleared ${payload.category || ''} ${payload.source || ''}`.slice(0, 200);
    } else if (kind === 'event' && payload) {
      text = payload.text || '';
    }

    await this.recordFact({
      factType,
      actorType: 'system',
      actorId,
      payload: { kind, ...(payload || {}), text },
      tags: ['office', kind],
    });

    if (kind === 'threat' && payload) {
      try {
        await this._post('denizen_security_threats', {
          org_id: this.orgId,
          category: payload.category || 'unknown',
          severity: payload.severity || null,
          source: payload.source || null,
          detail: String(payload.detail || '').slice(0, 500),
          metadata: payload,
        });
      } catch (_) {
        /* non-fatal */
      }
    }

    if (kind === 'event' && text) {
      try {
        await this._post('denizen_office_events', {
          org_id: this.orgId,
          kind: payload.kind || 'event',
          text: String(text).slice(0, 240),
          metadata: payload,
        });
      } catch (_) {
        /* non-fatal */
      }
    }
  }

  async _get(path) {
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      headers: this._headers(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return res.json();
  }

  async _post(table, body, { prefer } = {}) {
    const headers = this._headers({ prefer: prefer || 'return=minimal' });
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${table} → HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return res.json();
    return null;
  }

  async _patch(path, body, { prefer } = {}) {
    const headers = this._headers({ prefer: prefer || 'return=representation' });
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PATCH ${path} → HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return res.json();
    return null;
  }

  async _rpc(fn, body) {
    const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`RPC ${fn} → HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return res.json();
    return null;
  }

  _headers({ prefer } = {}) {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    };
  }

  _warnOnce(msg) {
    const now = Date.now();
    if (now - this._lastWarnAt < 60000) return;
    this._lastWarnAt = now;
    console.warn(`[DenizenDb] ${msg}`);
  }
}

const denizenDb = new DenizenDb();

module.exports = denizenDb;
module.exports.DenizenDb = DenizenDb;
module.exports.DISPLAY_TO_NPC_KEY = DISPLAY_TO_NPC_KEY;
