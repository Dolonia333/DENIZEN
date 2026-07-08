'use strict';

const {
  bridgeHealth,
  bridgeQuery,
  bridgeInsert,
  bridgeUpdate,
  bridgeRequest,
  useDirectSupabase,
} = require('../../lib/bridge-client');

module.exports = {
  meta: {
    name: 'supabase',
    description: 'Query local Supabase via secure bridge',
    mode: 'background',
    aliases: ['supabase-bridge'],
  },
  async run({ npcName, params, deps, config }) {
    const pcActivity = deps.pcActivity;
    const action = params?.action || 'health';
    const sbStart = Date.now();
    const activity = pcActivity.record({
      npc: npcName, kind: 'supabase-bridge',
      task: `${action}${params?.table ? ` ${params.table}` : ''}`,
      mode: 'background', status: 'started',
    });

    try {
      let data;
      let ok = true;
      if (action === 'health') {
        data = await bridgeHealth(config);
      } else if (action === 'tables') {
        data = useDirectSupabase()
          ? { ok: true, mode: 'direct', note: 'Use query action with a table name on NAS direct PostgREST.' }
          : await bridgeRequest(config, '/tables');
      } else if (action === 'query') {
        const rows = await bridgeQuery(config, {
          table: params.table,
          select: params.select,
          filters: params.filters,
          order: params.order,
          limit: Number(params.limit) || 10,
        });
        data = { rows, count: rows.length };
        ok = true;
      } else if (action === 'insert') {
        const rows = params.rows || (params.data ? [params.data] : []);
        data = await bridgeInsert(config, {
          table: params.table,
          rows: Array.isArray(rows) ? rows : [rows],
        });
      } else if (action === 'update') {
        data = await bridgeUpdate(config, {
          table: params.table,
          filters: params.filters,
          data: params.data,
        });
      } else if (action === 'delete') {
        if (useDirectSupabase()) {
          throw new Error('DELETE not exposed in direct PostgREST mode — use denizen-data skills');
        }
        data = await bridgeRequest(config, '/delete', {
          method: 'POST',
          body: { table: params.table, filters: params.filters },
        });
      } else {
        throw new Error(`Unknown supabase action: ${action}`);
      }

      const output = JSON.stringify(data).slice(0, 800);
      ok = ok && data?.ok !== false;
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'supabase-bridge', task: activity.task,
        mode: 'background', status: ok ? 'done' : 'failed',
        durationMs: Date.now() - sbStart, detail: output.slice(0, 240),
      });
      return { ok, output, skill: 'supabase-bridge' };
    } catch (err) {
      const hint = useDirectSupabase()
        ? 'Direct PostgREST mode is active — check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        : 'Start bridge: python denizen/jelly/services/supabase-bridge/secure-bridge.py';
      const output = `Supabase bridge unavailable: ${err.message}. ${hint}`;
      pcActivity.record({
        id: activity.id, npc: npcName, kind: 'supabase-bridge', task: activity.task,
        mode: 'background', status: 'failed',
        durationMs: Date.now() - sbStart, detail: output.slice(0, 240),
      });
      return { ok: false, output, skill: 'supabase-bridge' };
    }
  },
};
