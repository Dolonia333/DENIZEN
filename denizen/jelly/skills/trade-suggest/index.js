'use strict';

module.exports = {
  meta: {
    name: 'trade-suggest',
    description: 'Record a trade idea and optionally fill it on Roki\'s paper ledger (never live)',
    mode: 'background',
  },
  async run({ npcName, params, broadcast, deps }) {
    if (params?.execute === true || params?.placeOrder === true) {
      const msg = 'BLOCKED: Denizen does not place live Robinhood orders. Use paper fills or trade manually.';
      deps.log?.warn?.('Market', msg);
      return { ok: false, output: msg, skill: 'trade-suggest' };
    }

    let buyingPower = params?.buyingPower ?? params?.buying_power ?? null;
    if (buyingPower == null && deps.rokiPaper?.getSnapshot) {
      try {
        const snap = await deps.rokiPaper.getSnapshot(deps.robinhoodMcp);
        buyingPower = snap?.buyingPower ?? null;
      } catch (_) { /* non-fatal */ }
    }
    if (buyingPower == null && deps.robinhoodMcp?.isAuthenticated?.()) {
      try {
        const pf = await deps.robinhoodMcp.getPortfolio();
        buyingPower = pf?.data?.buying_power?.buying_power ?? null;
      } catch (_) { /* non-fatal */ }
    }

    const action = String(params?.tradeAction || params?.action || 'watch').toLowerCase();
    const suggestion = deps.robinhoodMcp.createSuggestion({
      npc: npcName,
      symbol: params?.symbol,
      action,
      quantity: params?.quantity || null,
      rationale: params?.rationale || '',
      currentPrice: params?.currentPrice || null,
      targetPrice: params?.targetPrice || null,
      buyingPower,
    });

    let paper = null;
    const wantPaper = params?.paper !== false
      && (action === 'buy' || action === 'sell')
      && deps.rokiPaper?.placeFromSuggestion;
    if (wantPaper) {
      try {
        paper = await deps.rokiPaper.placeFromSuggestion(suggestion, deps.robinhoodMcp);
        if (paper?.ok) {
          broadcast({ type: 'paper_trade', trade: paper.trade, account: paper.account, ts: Date.now() });
        }
      } catch (err) {
        paper = { ok: false, error: err?.message || String(err) };
        deps.log?.warn?.('Market', `Paper fill failed: ${paper.error}`);
      }
    }

    let output = `Trade suggestion recorded: ${suggestion.action?.toUpperCase()} ${suggestion.symbol} — ${suggestion.rationale.slice(0, 80)}`;
    if (paper?.ok) {
      output += ` | PAPER FILL ${paper.trade.side.toUpperCase()} ${paper.trade.qty} @ $${paper.trade.price}`;
    } else if (paper?.error) {
      output += ` | paper fill skipped (${paper.error})`;
    }

    broadcast({ type: 'trade_suggestion', suggestion, paper, ts: Date.now() });
    deps.log?.info?.('Market', `${npcName} trade suggestion: ${output}`);
    return { ok: true, output, skill: 'trade-suggest', suggestion, paper };
  },
};
