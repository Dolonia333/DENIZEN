'use strict';

module.exports = {
  meta: {
    name: 'trade-live',
    description: 'Place a live equity order on the connected Robinhood AI trading account (Grok only)',
    mode: 'background',
  },
  async run({ npcName, params, broadcast, deps }) {
    const who = String(npcName || '').toLowerCase();
    if (who !== 'grok' && who !== 'xp_grok') {
      return {
        ok: false,
        output: 'Only Grok can place live Robinhood orders.',
        skill: 'trade-live',
      };
    }
    if (!deps.robinhoodMcp?.placeEquityOrder) {
      return { ok: false, output: 'Robinhood client is not wired.', skill: 'trade-live' };
    }
    if (deps.robinhoodMcp.isAuthenticated && !deps.robinhoodMcp.isAuthenticated()) {
      return {
        ok: false,
        output: 'Robinhood is not connected. Open /api/market/auth/connect and allow the AI trading account.',
        skill: 'trade-live',
      };
    }
    try {
      const placed = await deps.robinhoodMcp.placeEquityOrder({
        symbol: params?.symbol,
        side: params?.side || params?.action,
        quantity: params?.quantity,
        amount: params?.amount ?? params?.notional_usd,
        orderType: params?.orderType || params?.order_type,
        limitPrice: params?.limitPrice ?? params?.limit_price,
        timeInForce: params?.timeInForce || params?.time_in_force,
        accountNumber: params?.accountNumber || params?.account_number,
      });
      const output = `Live ${String(placed.side).toUpperCase()} ${placed.symbol} sent to the agentic Robinhood account (…${placed.accountLast4}) via ${placed.tool}.`;
      broadcast({ type: 'live_trade', trade: { symbol: placed.symbol, side: placed.side, accountLast4: placed.accountLast4 }, ts: Date.now() });
      deps.log?.info?.('Market', `${npcName} ${output}`);
      return { ok: true, output, skill: 'trade-live', order: placed.order, accountLast4: placed.accountLast4 };
    } catch (err) {
      const output = err?.message || String(err);
      deps.log?.warn?.('Market', `Live order failed: ${output}`);
      return { ok: false, output, skill: 'trade-live', code: err?.code || null };
    }
  },
};
