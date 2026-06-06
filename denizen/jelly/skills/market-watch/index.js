'use strict';

module.exports = {
  meta: {
    name: 'market-watch',
    description: 'Robinhood market observation via MCP',
    mode: 'background',
    aliases: ['get-quote'],
  },
  async run({ npcName, params, broadcast, deps, skill }) {
    const marketStart = Date.now();
    const isQuote = skill === 'get-quote' || params?.action === 'get-quote';
    const activity = deps.pcActivity.record({
      npc: npcName, kind: 'market-watch',
      task: isQuote
        ? `quote: ${(params?.symbols || []).join(',') || 'watchlist'}`
        : 'market observation cycle',
      mode: 'background', status: 'started',
    });

    try {
      const result = isQuote
        ? await deps.robinhoodMcp.getQuote(params?.symbols || deps.robinhoodMcp.loadWatchlist())
        : await deps.robinhoodMcp.runMarketObservation();
      const output = JSON.stringify(result).slice(0, 1200);
      deps.pcActivity.record({
        id: activity.id, npc: npcName, kind: 'market-watch',
        task: activity.task, mode: 'background', status: 'done',
        durationMs: Date.now() - marketStart, detail: output.slice(0, 240),
      });
      broadcast({ type: 'market_data_update', npcName, data: result, ts: Date.now() });
      deps.log?.info?.('Market', `${npcName} ← ${skill}: ${output.slice(0, 80)}`);
      return { ok: true, output, skill: isQuote ? 'get-quote' : 'market-watch' };
    } catch (err) {
      const output = `Market data unavailable: ${err.message}`;
      deps.pcActivity.record({
        id: activity.id, npc: npcName, kind: 'market-watch',
        task: activity.task, mode: 'background', status: 'failed',
        durationMs: Date.now() - marketStart, detail: output,
      });
      return { ok: false, output, skill: isQuote ? 'get-quote' : 'market-watch' };
    }
  },
};
