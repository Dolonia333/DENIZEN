'use strict';

const mcpCursor = require('../../../src/mcp/denizen-mcp-cursor-tools');

module.exports = {
  meta: {
    name: 'cursor-bridge',
    description: 'Queue coding/fix tasks for Cursor IDE (Denizen self-improvement bridge)',
    mode: 'background',
    aliases: ['cursor', 'cursor-work'],
  },
  async run({ npcName, params, deps, skill }) {
    const scope = {
      org_id: params.org_id || deps.orgId || null,
      org_slug: params.org_slug || deps.orgSlug || 'default',
      npc_key: String(npcName || 'abby').toLowerCase().replace(/\s+/g, ''),
      session_id: params.session_id || null,
    };

    mcpCursor.configure({
      broadcast: deps.broadcast,
      denizenDb: deps.denizenDb,
    });

    const action = String(params.action || 'enqueue').toLowerCase();
    let result;
    if (action === 'list') {
      result = await mcpCursor.callTool(scope, 'list_cursor_work', params);
    } else if (action === 'claim') {
      result = await mcpCursor.callTool(scope, 'claim_cursor_work', params);
    } else if (action === 'complete') {
      result = await mcpCursor.callTool(scope, 'complete_cursor_work', params);
    } else {
      result = await mcpCursor.callTool(scope, 'enqueue_cursor_work', {
        title: params.title || params.task,
        description: params.description || params.context,
        files: params.files,
        priority: params.priority || 'normal',
        kind: params.kind || 'bugfix',
      });
    }

    const output = JSON.stringify(result, null, 2).slice(0, 3000);
    return { ok: result?.ok !== false, output, skill, result };
  },
};
