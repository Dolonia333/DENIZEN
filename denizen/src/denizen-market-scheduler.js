'use strict';

/**
 * Background market observation during US regular hours.
 * Broadcasts quotes to office WS; nudges Roki on large movers.
 */

const TICK_MS = Number(process.env.DENIZEN_MARKET_TICK_MS || 15 * 60 * 1000);
const MOVER_ALERT_PCT = Number(process.env.DENIZEN_MARKET_MOVER_PCT || 3);

function isUsMarketHours(date = new Date()) {
  const et = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function startMarketScheduler(deps = {}) {
  const {
    robinhoodMcp,
    broadcast,
    npcBrains,
    log,
  } = deps;

  if (!robinhoodMcp || typeof broadcast !== 'function') {
    return { ok: false, reason: 'missing_deps' };
  }

  let timer = null;
  let running = false;

  async function tick() {
    if (running) return;
    if (!isUsMarketHours()) return;
    if (!robinhoodMcp.isAuthenticated?.()) return;

    running = true;
    try {
      const obs = await robinhoodMcp.runMarketObservation();
      broadcast({
        type: 'market_data_update',
        npcName: 'Roki',
        data: obs,
        ts: Date.now(),
      });

      const mover = obs?.movers?.[0];
      if (
        mover?.symbol
        && mover.changePercent != null
        && Math.abs(mover.changePercent) >= MOVER_ALERT_PCT
        && typeof npcBrains?.assignDirective === 'function'
      ) {
        const dir = `${mover.symbol} ${mover.changePercent > 0 ? '+' : ''}${mover.changePercent}% — brief market observation for the office`;
        npcBrains.assignDirective('Roki', 'Market', dir, false);
      }
      log?.info?.('Market', `tick ok source=${obs?.quoteSource || 'none'} movers=${obs?.movers?.length || 0}`);
    } catch (err) {
      log?.warn?.('Market', `tick failed: ${err?.message || err}`);
    } finally {
      running = false;
    }
  }

  timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  timer.unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 12000);

  return {
    ok: true,
    tickMs: TICK_MS,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = {
  isUsMarketHours,
  startMarketScheduler,
};
