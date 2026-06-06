'use strict';

/**
 * Visitor intelligence scheduler — morning briefings, commitment nudges, recurring tasks, triggers.
 */

const { runIntelligenceTick } = require('./denizen-visitor-intelligence.js');

const TICK_MS = Number(process.env.VISITOR_INTELLIGENCE_TICK_MS) || 15 * 60 * 1000;

function startVisitorIntelligenceLoop(deps = {}, opts = {}) {
  const intervalMs = Number(opts.intervalMs) || TICK_MS;
  const immediate = opts.immediate !== false;

  const runTick = async () => {
    try {
      const result = await runIntelligenceTick(deps);
      if (typeof deps.onTick === 'function') deps.onTick(result);
    } catch (err) {
      if (typeof deps.onError === 'function') {
        deps.onError(err);
      } else {
        console.warn('[VisitorIntelligence] tick failed:', err?.message || err);
      }
    }
  };

  if (immediate) runTick().catch(() => {});
  const timer = setInterval(() => { runTick().catch(() => {}); }, intervalMs);
  timer.unref?.();

  return {
    timer,
    intervalMs,
    stop() { clearInterval(timer); },
    runNow: runTick,
  };
}

module.exports = { startVisitorIntelligenceLoop, TICK_MS };
