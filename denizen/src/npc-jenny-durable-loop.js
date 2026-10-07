'use strict';

/**
 * Durable Jenny runner — keeps Jenny MCP presence + directive/job pulse
 * without an open Grok/Claude chat tab.
 *
 * Env:
 *   DENIZEN_JENNY_DURABLE=1|0       enable (default on — holds presence when Grok closes)
 *   DENIZEN_JENNY_DURABLE_MS=120000 tick interval
 */

const outcomeLedger = require('./denizen-outcome-ledger');

const DEFAULT_MS = Math.max(30_000, Number(process.env.DENIZEN_JENNY_DURABLE_MS) || 120_000);

function enabled() {
  const v = String(process.env.DENIZEN_JENNY_DURABLE ?? '1').toLowerCase().trim();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

/**
 * @param {{
 *   npcBrains?: object,
 *   mcpTeamTools?: object,
 *   denizenDb?: object,
 *   log?: Console,
 *   intervalMs?: number,
 * }} deps
 */
function startJennyDurableLoop(deps = {}) {
  if (!enabled()) {
    deps.log?.info?.('JennyDurable', 'disabled (DENIZEN_JENNY_DURABLE=0)');
    return { stop() {}, enabled: false };
  }

  const log = deps.log || console;
  const intervalMs = deps.intervalMs || DEFAULT_MS;
  let stopped = false;
  let running = false;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const brains = deps.npcBrains;
      const teamTools = deps.mcpTeamTools;

      // Hold Jenny presence by npc_key (works without visitor session / Grok tab)
      try {
        teamTools?.touchMcpPresenceByNpc?.('jenny');
      } catch (_) {}

      let directives = [];
      try {
        directives = brains?.listDirectives?.({ include_archived: false }) || [];
      } catch (_) {}

      const jennyDirs = directives.filter((d) => {
        const npc = String(d.npc || '').toLowerCase();
        return npc === 'jenny' || npc === 'jenny (mcp)';
      });

      let completed = 0;
      let expired = 0;
      const now = Date.now();
      for (const d of jennyDirs) {
        const age = now - (Number(d.ts) || 0);
        const stale = age > 36 * 60 * 60 * 1000
          || (d.expires_at != null && now >= Number(d.expires_at));
        if (stale && brains?.completeDirective) {
          brains.completeDirective(d.npc, {
            status: 'expired',
            note: 'durable Jenny runner: expired stale directive while Grok chat closed',
          });
          expired += 1;
          completed += 1;
        }
      }

      // Expire any global stale directives while we're the unattended clock
      try {
        const more = brains?.expireStaleDirectives?.(36 * 60 * 60 * 1000) || [];
        expired += more.length;
      } catch (_) {}

      try {
        if (expired > 0) {
          outcomeLedger.appendOutcome({
            actor: 'jenny-durable',
            outcome_type: 'directive.expired',
            entity_type: 'npc_directive',
            entity_key: 'jenny',
            value_text: `Expired ${expired} stale directive(s) while Grok chat was closed.`,
            value_json: { expired, completed, jenny_directives: jennyDirs.length },
            source: 'npc-jenny-durable-loop',
            pass: true,
          });
        }
      } catch (_) {}

      log.info?.('JennyDurable', `tick jenny_dirs=${jennyDirs.length} expired=${expired}`);
    } catch (err) {
      log.warn?.('JennyDurable', err?.message || err);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
  setTimeout(() => { tick().catch(() => {}); }, 15_000);
  log.info?.('JennyDurable', `started interval=${intervalMs}ms`);

  return {
    enabled: true,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    tick,
  };
}

module.exports = {
  enabled,
  startJennyDurableLoop,
  DEFAULT_MS,
};
