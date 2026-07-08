'use strict';

const { URL } = require('node:url');

const npcStats = require('../office-hq/denizen-npc-stats');
const officeProgress = require('../office-hq/denizen-office-progress');
const quests = require('../office-hq/denizen-quests');
const achievements = require('../office-hq/denizen-achievements');

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function createOfficeProgressRouteHandler(_deps = {}) {
  return async function handleOfficeProgressRoutes(req, res) {
    const reqUrl = req.url || '/';
    const url = new URL(reqUrl, 'http://localhost');
    const path = url.pathname;
    const method = req.method || 'GET';

    if (method === 'GET' && path === '/api/office/hq') {
      const sinceParam = url.searchParams.get('since');
      const sinceMs = sinceParam ? Number(sinceParam) : Date.now() - 24 * 60 * 60 * 1000;
      const progress = officeProgress.getProgress();
      const today = npcStats.getTodayOfficeTotals();
      const streaks = npcStats.getStreaks();
      const maxStreak = streaks.length ? streaks[0].streakDays : 0;
      const heatmapDays = Math.min(Math.max(Number(url.searchParams.get('heatmap_days')) || 35, 7), 35);
      sendJson(res, 200, {
        ok: true,
        progress,
        today,
        maxStreak,
        topStreakNpc: streaks[0]?.npcName || null,
        heatmap: npcStats.getOfficeHeatmap({ days: heatmapDays }),
        leaderboard: npcStats.getLeaderboard({ period: 'week' }),
        streaks,
        quests: quests.getActiveQuests(),
        achievements: achievements.getAchievements(),
        away: officeProgress.buildAwaySummary(sinceMs),
      });
      return true;
    }

    if (method === 'GET' && path === '/api/office/leaderboard') {
      const period = String(url.searchParams.get('period') || 'week');
      const safePeriod = ['today', 'week', 'all'].includes(period) ? period : 'week';
      const leaderboard = npcStats.getLeaderboard({ period: safePeriod });
      sendJson(res, 200, { ok: true, period: safePeriod, leaderboard });
      return true;
    }

    if (method === 'GET' && path === '/api/office/streaks') {
      sendJson(res, 200, { ok: true, streaks: npcStats.getStreaks() });
      return true;
    }

    if (method === 'GET' && path === '/api/office/progress') {
      sendJson(res, 200, { ok: true, progress: officeProgress.getProgress() });
      return true;
    }

    if (method === 'GET' && path === '/api/office/quests') {
      sendJson(res, 200, { ok: true, quests: quests.getActiveQuests() });
      return true;
    }

    if (method === 'POST' && path === '/api/office/quests/claim') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (_) {
        sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
        return true;
      }
      const questId = String(body?.id || '').trim();
      if (!questId) {
        sendJson(res, 400, { ok: false, error: 'id required' });
        return true;
      }
      const result = quests.claimQuest(questId);
      if (!result.ok) {
        sendJson(res, result.error === 'quest not found' ? 404 : 409, result);
        return true;
      }
      sendJson(res, 200, { ...result, progress: officeProgress.getProgress() });
      return true;
    }

    if (method === 'GET' && path === '/api/office/achievements') {
      sendJson(res, 200, { ok: true, ...achievements.getAchievements() });
      return true;
    }

    sendJson(res, 404, { ok: false, error: 'office-progress route not found' });
    return true;
  };
}

module.exports = {
  createOfficeProgressRouteHandler,
};
