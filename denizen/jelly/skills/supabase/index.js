'use strict';

module.exports = {
  meta: {
    name: 'supabase',
    description: 'Query local Supabase via secure bridge',
    mode: 'background',
    aliases: ['supabase-bridge'],
  },
  async run({ npcName, params, deps, config }) {
    const pcActivity = deps.pcActivity;
    const bridgeUrl = (config?.supabase?.bridgeUrl || process.env.SUPABASE_BRIDGE_URL || 'http://127.0.0.1:18790').replace(/\/$/, '');
    const token = config?.supabase?.agentToken || process.env.AGENT_TOKEN || '';
    const action = params?.action || 'health';
    const sbStart = Date.now();
    const activity = pcActivity.record({
      npc: npcName, kind: 'supabase-bridge',
      task: `${action}${params?.table ? ` ${params.table}` : ''}`,
      mode: 'background', status: 'started',
    });

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    let path = '/health';
    let method = 'GET';
    let body = null;
    if (action === 'tables') path = '/tables';
    else if (action === 'query') {
      path = '/query';
      method = 'POST';
      body = {
        table: params.table,
        select: params.select,
        filters: params.filters,
        order: params.order,
        limit: Number(params.limit) || 10,
      };
    } else if (action === 'insert') {
      path = '/insert';
      method = 'POST';
      const rows = params.rows || (params.data ? [params.data] : []);
      body = { table: params.table, rows: Array.isArray(rows) ? rows : [rows] };
    } else if (action === 'update') {
      path = '/update';
      method = 'POST';
      body = { table: params.table, filters: params.filters, data: params.data };
    } else if (action === 'delete') {
      path = '/delete';
      method = 'POST';
      body = { table: params.table, filters: params.filters };
    }

    try {
      const res = await fetch(`${bridgeUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      const output = JSON.stringify(data).slice(0, 800);
      const ok = res.ok;
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'supabase-bridge', task: activity.task,
        mode: 'background', status: ok ? 'done' : 'failed',
        durationMs: Date.now() - sbStart, detail: output.slice(0, 240),
      });
      return { ok, output, skill: 'supabase-bridge' };
    } catch (err) {
      const output = `Supabase bridge unavailable (${bridgeUrl}): ${err.message}. Start: python denizen/jelly/services/supabase-bridge/secure-bridge.py`;
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'supabase-bridge', task: activity.task,
        mode: 'background', status: 'failed',
        durationMs: Date.now() - sbStart, detail: output.slice(0, 240),
      });
      return { ok: false, output, skill: 'supabase-bridge' };
    }
  },
};
