'use strict';

module.exports = {
  meta: {
    name: 'trade-suggest',
    description: 'Record a trade suggestion (never executes)',
    mode: 'background',
  },
  async run({ npcName, params, broadcast, deps }) {
    if (params?.execute === true || params?.placeOrder === true) {
      const msg = 'BLOCKED: Denizen does not execute trades automatically. This is a safety constraint.';
      deps.log?.warn?.('Market', msg);
      return { ok: false, output: msg, skill: 'trade-suggest' };
    }

    let buyingPower = params?.buyingPower ?? params?.buying_power ?? null;
    if (buyingPower == null && deps.robinhoodMcp?.isAuthenticated?.()) {
      try {
        const pf = await deps.robinhoodMcp.getPortfolio();
        buyingPower = pf?.data?.buying_power?.buying_power ?? null;
      } catch (_) { /* non-fatal */ }
    }

    const suggestion = deps.robinhoodMcp.createSuggestion({
      npc: npcName,
      symbol: params?.symbol,
      action: params?.tradeAction || params?.action || 'watch',
      quantity: params?.quantity || null,
      rationale: params?.rationale || '',
      currentPrice: params?.currentPrice || null,
      targetPrice: params?.targetPrice || null,
      buyingPower,
    });
    const output = `Trade suggestion recorded: ${suggestion.action?.toUpperCase()} ${suggestion.symbol} — ${suggestion.rationale.slice(0, 80)}`;
    broadcast({ type: 'trade_suggestion', suggestion, ts: Date.now() });
    deps.log?.info?.('Market', `${npcName} trade suggestion: ${output}`);
    return { ok: true, output, skill: 'trade-suggest', suggestion };
  },
};
