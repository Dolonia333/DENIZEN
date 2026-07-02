'use strict';
/**
 * DenizenDb — server-side Supabase instrumentation.
 *
 * Dual-writes runtime events to Postgres so facts accumulate for analytics
 * and future prediction. Fire-and-forget async queue; never blocks NPC loops.
 *
 * Env:
 *   SUPABASE_URL              PostgREST base (default http://127.0.0.1:54321)
 *   SUPABASE_SERVICE_ROLE_KEY Server key (preferred; bypasses RLS in production)
 *   SUPABASE_ANON_KEY         Anon key fallback (local dev / fleet agents)
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
      this.env.SUPABASE_SERVICE_ROLE_KEY ||
      this.env.SUPABASE_ANON_KEY ||
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

  recordWorkOutput({ npcName, phase, action, note, artifactPath, role, orgId }) {
    if (!this.enabled) return;
    const npc_key = this.npcKey(npcName);
    const targetOrgId = orgId || this.orgId;
    this.enqueue(async () => {
      const row = {
        org_id: targetOrgId,
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

  async insertPrediction({
    predictionType,
    entityType,
    entityId = null,
    entityKey = null,
    prediction = {},
    confidence = null,
    horizon = null,
    modelKey = 'app_layer_v1',
    modelVersion = '1.0.0',
    inputFactIds = null,
    metadata = {},
  } = {}) {
    if (!this.enabled || !this.orgId) return null;
    if (!predictionType || !entityType || (!entityId && !entityKey)) return null;

    let normalizedConfidence = confidence;
    if (normalizedConfidence == null) {
      if (prediction?.close_probability != null) {
        normalizedConfidence = Number(prediction.close_probability);
      } else if (prediction?.bid_probability != null) {
        normalizedConfidence = Number(prediction.bid_probability);
      }
    }
    if (normalizedConfidence != null && Number.isFinite(Number(normalizedConfidence))) {
      normalizedConfidence = Math.max(0, Math.min(1, Number(normalizedConfidence)));
    } else {
      normalizedConfidence = null;
    }

    const rows = await this._post(
      'denizen_predictions',
      {
        org_id: this.orgId,
        model_key: modelKey,
        model_version: modelVersion,
        prediction_type: predictionType,
        entity_type: entityType,
        entity_id: entityId,
        entity_key: entityKey,
        prediction: prediction || {},
        confidence: normalizedConfidence,
        horizon: horizon || null,
        input_fact_ids: Array.isArray(inputFactIds) ? inputFactIds : null,
        metadata: metadata || {},
      },
      { prefer: 'return=representation' },
    );
    return rows?.[0] || null;
  }

  async listPredictionsForEntity({
    entityType,
    entityId = null,
    entityKey = null,
    includeValidated = true,
    limit = 10,
  } = {}) {
    if (!this.enabled || !this.orgId || !entityType || (!entityId && !entityKey)) return [];
    const orgFilter = `org_id=eq.${encodeURIComponent(this.orgId)}`;
    const entityTypeFilter = `entity_type=eq.${encodeURIComponent(entityType)}`;
    const idFilter = entityId
      ? `entity_id=eq.${encodeURIComponent(entityId)}`
      : `entity_key=eq.${encodeURIComponent(entityKey)}`;
    const validatedFilter = includeValidated ? '' : '&validated_at=is.null';
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10));
    return this._get(
      `denizen_predictions?select=id,prediction_type,entity_type,entity_id,entity_key,prediction,confidence,validated_at,accuracy_score,created_at&${orgFilter}&${entityTypeFilter}&${idFilter}${validatedFilter}&order=created_at.desc&limit=${safeLimit}`,
    );
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

  /** Sync one watchlist symbol for Roki (add/remove). */
  syncWatchlistSymbol(symbol, opts = {}) {
    if (!this.enabled || !this.orgId || !symbol) return;
    const normalized = String(symbol).toUpperCase().trim();
    if (!normalized) return;
    const orgId = opts.orgId || this.orgId;
    const npcKey = opts.npcKey || 'roki';

    this.enqueue(async () => {
      if (opts.remove) {
        await this._delete(
          `denizen_watchlist_symbols?org_id=eq.${encodeURIComponent(orgId)}&symbol=eq.${encodeURIComponent(normalized)}`,
        );
        return;
      }
      await this._post(
        'denizen_watchlist_symbols?on_conflict=org_id,symbol',
        {
          org_id: orgId,
          npc_key: npcKey,
          symbol: normalized,
          added_at: opts.addedAt || new Date().toISOString(),
        },
        { prefer: 'resolution=merge-duplicates,return=minimal' },
      );
    });
  }

  /** Insert or update an org-scoped trade suggestion row. */
  upsertTradeSuggestion(suggestion, opts = {}) {
    if (!this.enabled || !this.orgId || !suggestion) return;
    const symbol = String(suggestion.symbol || '').toUpperCase().trim();
    if (!symbol) return;
    const createdAt = suggestion.createdAt || suggestion.created_at || suggestion.at || new Date().toISOString();
    const orgId = opts.orgId || this.orgId;
    const npcKey = opts.npcKey || suggestion.npcKey || suggestion.npc_key || 'roki';
    const status = mapTradeSuggestionStatus(suggestion.status);
    const action = String(suggestion.action || 'watch').toLowerCase();
    const row = {
      org_id: orgId,
      npc_key: npcKey,
      symbol,
      action,
      rationale: String(suggestion.rationale || '').slice(0, 2000) || null,
      status,
      created_at: createdAt,
    };

    this.enqueue(async () => {
      // If a uuid id is provided, update that exact row.
      if (isUuid(suggestion.id)) {
        const existing = await this._get(
          `denizen_trade_suggestions?select=id&limit=1&id=eq.${encodeURIComponent(suggestion.id)}`,
        ).catch(() => []);
        if (existing?.length) {
          await this._patch(
            `denizen_trade_suggestions?id=eq.${encodeURIComponent(suggestion.id)}`,
            row,
            { prefer: 'return=minimal' },
          );
          return;
        }
        await this._post('denizen_trade_suggestions', { id: suggestion.id, ...row }, { prefer: 'return=minimal' });
        return;
      }

      // For status changes from JSON suggestions, match by natural key when possible.
      if (status !== 'pending' && createdAt) {
        const existing = await this._get(
          `denizen_trade_suggestions?select=id&limit=1&org_id=eq.${encodeURIComponent(orgId)}&npc_key=eq.${encodeURIComponent(npcKey)}&symbol=eq.${encodeURIComponent(symbol)}&action=eq.${encodeURIComponent(action)}&created_at=eq.${encodeURIComponent(createdAt)}`,
        ).catch(() => []);
        if (existing?.[0]?.id) {
          await this._patch(
            `denizen_trade_suggestions?id=eq.${encodeURIComponent(existing[0].id)}`,
            { status, rationale: row.rationale },
            { prefer: 'return=minimal' },
          );
          return;
        }
      }

      await this._post('denizen_trade_suggestions', row, { prefer: 'return=minimal' });
    });
  }

  /** List latest trade suggestions for an org/npc scope. */
  async listTradeSuggestions(opts = {}) {
    if (!this.enabled || !this.orgId) return [];
    const orgId = opts.orgId || this.orgId;
    const npcKey = opts.npcKey || 'roki';
    const status = opts.status ? mapTradeSuggestionStatus(opts.status) : null;
    const limit = Number(opts.limit || 50);
    const path = [
      'denizen_trade_suggestions?select=id,org_id,npc_key,symbol,action,rationale,status,created_at',
      `org_id=eq.${encodeURIComponent(orgId)}`,
      `npc_key=eq.${encodeURIComponent(npcKey)}`,
      status ? `status=eq.${encodeURIComponent(status)}` : null,
      'order=created_at.desc',
      `limit=${Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 50}`,
    ]
      .filter(Boolean)
      .join('&');
    return this._get(path);
  }

  /** Read watchlist symbols for an org/npc scope. */
  async getWatchlist(opts = {}) {
    if (!this.enabled || !this.orgId) return [];
    const orgId = opts.orgId || this.orgId;
    const npcKey = opts.npcKey || 'roki';
    const limit = Number(opts.limit || 200);
    const rows = await this._get(
      [
        'denizen_watchlist_symbols?select=symbol,added_at',
        `org_id=eq.${encodeURIComponent(orgId)}`,
        `npc_key=eq.${encodeURIComponent(npcKey)}`,
        'order=added_at.asc',
        `limit=${Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 200}`,
      ].join('&'),
    );
    return (rows || []).map((r) => String(r.symbol || '').toUpperCase().trim()).filter(Boolean);
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

  async insertNpcMemory({
    orgId,
    npcKey,
    body,
    topic = null,
    outcome = null,
    source = 'npc_brain',
    memberId = null,
    skillTag = null,
    taskPhase = null,
    metadata = {},
  }) {
    const targetOrgId = orgId || this.orgId;
    if (!this.enabled || !targetOrgId || !npcKey || !body) return null;
    const row = {
      org_id: targetOrgId,
      npc_key: npcKey,
      body: String(body).slice(0, 2000),
      topic: topic || null,
      outcome: outcome || null,
      source: source || 'npc_brain',
      member_id: memberId || null,
      skill_tag: skillTag || null,
      task_phase: taskPhase || null,
      metadata: metadata || {},
    };
    const inserted = await this._post('denizen_npc_memories', row, {
      prefer: 'return=representation',
    });
    return inserted?.[0] || null;
  }

  async listNpcMemories({ orgId, npcKey, limit = 20, source = null } = {}) {
    const targetOrgId = orgId || this.orgId;
    if (!this.enabled || !targetOrgId || !npcKey) return [];
    const parts = [
      'denizen_npc_memories?select=id,npc_key,recorded_at,body,topic,outcome,source,member_id',
      `org_id=eq.${encodeURIComponent(targetOrgId)}`,
      `npc_key=eq.${encodeURIComponent(npcKey)}`,
      'order=recorded_at.desc',
      `limit=${Math.max(1, Math.min(100, Number(limit) || 20))}`,
    ];
    if (source) parts.push(`source=eq.${encodeURIComponent(source)}`);
    return this._get(parts.join('&'));
  }

  async getAgentSoul(orgId, npcKey) {
    const targetOrgId = orgId || this.orgId;
    if (!this.enabled || !targetOrgId || !npcKey) return null;
    const rows = await this._getSoft(
      `agent_souls?select=npc_key,display_name,soul_content,memory_content,template_pack,updated_at`
      + `&org_id=eq.${encodeURIComponent(targetOrgId)}`
      + `&npc_key=eq.${encodeURIComponent(npcKey)}`
      + '&limit=1',
    );
    return rows?.[0] || null;
  }

  async listAgentSouls(orgId) {
    const targetOrgId = orgId || this.orgId;
    if (!this.enabled || !targetOrgId) return [];
    return this._getSoft(
      `agent_souls?select=npc_key,display_name,soul_content,memory_content,template_pack,updated_at`
      + `&org_id=eq.${encodeURIComponent(targetOrgId)}`
      + '&order=npc_key.asc',
    ) || [];
  }

  async upsertAgentSoul({
    orgId,
    npcKey,
    displayName,
    soulContent,
    memoryContent = '',
    templatePack = null,
  }) {
    const targetOrgId = orgId || this.orgId;
    if (!this.enabled || !targetOrgId || !npcKey) return null;
    const row = {
      org_id: targetOrgId,
      npc_key: npcKey,
      display_name: displayName || null,
      soul_content: String(soulContent || ''),
      memory_content: String(memoryContent || ''),
      template_pack: templatePack || null,
      updated_at: new Date().toISOString(),
    };
    const inserted = await this._postSoft(
      'agent_souls?on_conflict=org_id,npc_key',
      row,
      { prefer: 'resolution=merge-duplicates,return=representation' },
    );
    return inserted?.[0] || row;
  }

  async getOrgBusinessModel(orgId) {
    const targetOrgId = orgId || this.orgId;
    if (!this.enabled || !targetOrgId) return null;
    const rows = await this._getSoft(
      `org_business_models?select=org_id,template_pack,business_model,company_brief,updated_at`
      + `&org_id=eq.${encodeURIComponent(targetOrgId)}`
      + '&limit=1',
    );
    return rows?.[0] || null;
  }

  async upsertOrgBusinessModel({
    orgId,
    templatePack = null,
    businessModel = null,
    companyBrief = null,
  }) {
    const targetOrgId = orgId || this.orgId;
    if (!this.enabled || !targetOrgId) return null;
    const row = {
      org_id: targetOrgId,
      template_pack: templatePack || null,
      business_model: businessModel || {},
      company_brief: companyBrief || {},
      updated_at: new Date().toISOString(),
    };
    const inserted = await this._postSoft(
      'org_business_models?on_conflict=org_id',
      row,
      { prefer: 'resolution=merge-duplicates,return=representation' },
    );
    return inserted?.[0] || row;
  }

  async _getSoft(path, ms = 2500) {
    if (!this.enabled) return null;
    try {
      const res = await fetch(`${this.url}/rest/v1/${path}`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(ms),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  async _postSoft(table, body, { prefer, timeoutMs = 2500 } = {}) {
    if (!this.enabled) return null;
    try {
      const headers = this._headers({ prefer: prefer || 'return=representation' });
      const res = await fetch(`${this.url}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) return await res.json();
      return null;
    } catch (_) {
      return null;
    }
  }

  async _patchSoft(path, body, { prefer, timeoutMs = 2500 } = {}) {
    if (!this.enabled) return null;
    try {
      const headers = this._headers({ prefer: prefer || 'return=representation' });
      const res = await fetch(`${this.url}/rest/v1/${path}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) return await res.json();
      return null;
    } catch (_) {
      return null;
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

  async _delete(path) {
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      method: 'DELETE',
      headers: this._headers({ prefer: 'return=minimal' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DELETE ${path} → HTTP ${res.status} ${text.slice(0, 120)}`);
    }
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

function mapTradeSuggestionStatus(status) {
  const normalized = String(status || '').toLowerCase().trim();
  if (normalized === 'dismissed') return 'dismissed';
  if (normalized === 'acted') return 'acted';
  return 'pending';
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ''),
  );
}

module.exports = denizenDb;
module.exports.DenizenDb = DenizenDb;
module.exports.DISPLAY_TO_NPC_KEY = DISPLAY_TO_NPC_KEY;
