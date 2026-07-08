'use strict';

const { bridgeHealth, useDirectSupabase } = require('../../lib/bridge-client');
const { resolveAction, runAction, ACTIONS } = require('../../lib/denizen-data-actions');

const ALIASES = [...ACTIONS].filter((a) => a !== 'help');

module.exports = {
  meta: {
    name: 'denizen-data',
    description: 'Query and act on Supabase business + intelligence data (intake, RFP, outcomes, predictions)',
    mode: 'background',
    aliases: [
      'supabase-data',
      ...ALIASES,
    ],
  },

  async run({ npcName, params, skill, deps, config }) {
    const pcActivity = deps.pcActivity;
    const action = resolveAction(skill, params);
    const tag = action === 'denizen-data' ? (params.action || 'help') : action;
    const start = Date.now();

    const activity = pcActivity.record({
      npc: npcName,
      kind: 'denizen-data',
      task: tag,
      mode: 'background',
      status: 'started',
    });

    try {
      await bridgeHealth(config);
      const result = await runAction(action, { npcName, params: params || {}, config });
      const output = result.summary || JSON.stringify(result).slice(0, 800);

      pcActivity.record({
        id: activity.id,
        npc: npcName,
        kind: 'denizen-data',
        task: tag,
        mode: 'background',
        status: 'done',
        durationMs: Date.now() - start,
        detail: output.slice(0, 240),
      });

      return { ok: true, output, skill: tag, data: result };
    } catch (err) {
      const output = `Denizen data skill failed (${tag}): ${err.message}. ${
        useDirectSupabase()
          ? 'Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on this host.'
          : 'Start bridge: python apps/office/jelly/services/supabase-bridge/secure-bridge.py'
      }`;
      pcActivity.record({
        id: activity.id,
        npc: npcName,
        kind: 'denizen-data',
        task: tag,
        mode: 'background',
        status: 'failed',
        durationMs: Date.now() - start,
        detail: output.slice(0, 240),
      });
      return { ok: false, output, skill: tag };
    }
  },
};
