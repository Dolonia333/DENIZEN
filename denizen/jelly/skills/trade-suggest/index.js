'use strict';

module.exports = {
  meta: {
    name: 'trade-suggest',
    description:
      'Record a trade idea; paper-fill on Roki\'s ledger by default. '
      + 'Live Robinhood only when ROBINHOOD_LIVE_TRADING=1 and execute/liveTrade is set.',
    mode: 'background',
  },
  async run({ npcName, params, broadcast, deps }) {
    const wantLive = params?.execute === true
      || params?.placeOrder === true
      || params?.liveTrade === true
      || params?.live_trade === true;

    if (wantLive && !deps.robinhoodMcp?.isLiveTradingEnabled?.()) {
      const msg = 'BLOCKED: Live Robinhood orders require ROBINHOOD_LIVE_TRADING=1 on the Denizen host. '
        + 'Use paper fills, or enable live trading and call MCP place_equity_order with confirm=true.';
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
      npc_key: String(npcName || 'roki').toLowerCase(),
      symbol: params?.symbol,
      action,
      quantity: params?.quantity || null,
      rationale: params?.rationale || '',
      currentPrice: params?.currentPrice || null,
      targetPrice: params?.targetPrice || null,
      buyingPower,
    });

    let live = null;
    if (wantLive && (action === 'buy' || action === 'sell') && deps.robinhoodMcp?.placeEquityOrder) {
      try {
        live = await deps.robinhoodMcp.placeEquityOrder({
          symbol: suggestion.symbol || params?.symbol,
          side: action,
          quantity: params?.quantity ?? suggestion.quantity,
          amount: params?.amount ?? params?.notional ?? params?.notional_usd,
          order_type: params?.order_type || params?.orderType || 'market',
          limit_price: params?.limit_price ?? params?.limitPrice ?? params?.targetPrice,
          time_in_force: params?.time_in_force || params?.timeInForce,
        });
        broadcast({ type: 'live_trade', order: live, suggestion, npc: npcName, ts: Date.now() });
      } catch (err) {
        live = { ok: false, error: err?.message || String(err) };
        deps.log?.warn?.('Market', `Live order failed: ${live.error}`);
        return {
          ok: false,
          output: `Live order failed: ${live.error}`,
          skill: 'trade-suggest',
          suggestion,
          live,
        };
      }
    }

    let paper = null;
    const wantPaper = !wantLive
      && params?.paper !== false
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
    if (live && !live.error) {
      output += ' | LIVE ORDER submitted via Robinhood MCP';
    } else if (paper?.ok) {
      output += ` | PAPER FILL ${paper.trade.side.toUpperCase()} ${paper.trade.qty} @ $${paper.trade.price}`;
    } else if (paper?.error) {
      output += ` | paper fill skipped (${paper.error})`;
    }

    broadcast({ type: 'trade_suggestion', suggestion, paper, live, ts: Date.now() });
    deps.log?.info?.('Market', `${npcName} trade suggestion: ${output}`);
    return { ok: true, output, skill: 'trade-suggest', suggestion, paper, live };
  },
};
