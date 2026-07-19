'use strict';

/**
 * Parse giveaway duration tokens like 10m, 1h, 1d.
 * @returns {{ durationMs: number, rest: string[] }}
 */
function parseGiveawayArgs(args = []) {
  let winners = 1;
  let prizeParts = [...args];
  let durationMs = 60 * 60 * 1000;
  if (prizeParts[0] && /^\d+$/.test(prizeParts[0])) {
    winners = Math.min(10, Math.max(1, Number(prizeParts[0])));
    prizeParts = prizeParts.slice(1);
  }
  if (prizeParts[0] && /^\d+[smhd]$/i.test(prizeParts[0])) {
    const m = prizeParts[0].match(/^(\d+)([smhd])$/i);
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    durationMs = Math.min(7 * 86_400_000, Math.max(30_000, n * mult));
    prizeParts = prizeParts.slice(1);
  }
  return { winners, durationMs, prizeParts };
}

/**
 * Rank WhoKnows rows by playcount descending.
 */
function rankWhoKnows(rows = []) {
  return [...rows]
    .filter((r) => Number(r.plays) > 0)
    .sort((a, b) => Number(b.plays) - Number(a.plays));
}

module.exports = { parseGiveawayArgs, rankWhoKnows };
