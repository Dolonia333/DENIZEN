'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const worldState = require('../src/world-state');
const npcStats = require('../src/office-hq/denizen-npc-stats');
const officeProgress = require('../src/office-hq/denizen-office-progress');
const { createOfficeProgressRouteHandler } = require('../src/office-progress-routes');

function mockReq(method, path) {
  return { method, url: path };
}

function mockRes() {
  const res = {
    status: null,
    body: null,
    writableEnded: false,
    writeHead(status) { this.status = status; },
    end(payload) {
      this.body = payload;
      this.writableEnded = true;
    },
  };
  return res;
}

describe('office HQ route', () => {
  beforeEach(() => {
    worldState.npcStats = new Map();
    worldState.officeProgress = {
      totalXp: 0,
      level: 1,
      eventsThisWeek: [],
      counts: { task_shipped: 0, deal_won: 0, ticket_closed: 0 },
    };
    worldState.quests = { periodKeys: {}, progress: {} };
    worldState.officeAchievements = new Map();
  });

  it('GET /api/office/hq bundles progress, heatmap, quests, away', async () => {
    npcStats.recordOutcome('Alex', { outcome: 'success', taskPhase: 'finished' });
    officeProgress.awardXp('task_shipped', 1, { npc: 'Alex' });

    const handler = createOfficeProgressRouteHandler();
    const res = mockRes();
    await handler(mockReq('GET', '/api/office/hq?since=0'), res);

    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.ok, true);
    assert.equal(data.progress.level, 1);
    assert.equal(data.today.shipped, 1);
    assert.ok(Array.isArray(data.heatmap.cells));
    assert.equal(data.heatmap.cells.length, 35);
    assert.ok(data.away.lines.some((l) => l.includes('Alex')));
    assert.ok(Array.isArray(data.quests));
    assert.ok(data.achievements.locked);
  });
});

describe('denizen-npc-stats heatmap', () => {
  beforeEach(() => {
    worldState.npcStats = new Map();
  });

  it('getOfficeHeatmap sums shipped across NPCs per day', () => {
    npcStats.recordOutcome('Alex', { outcome: 'success', taskPhase: 'finished' });
    npcStats.recordOutcome('Lucy', { outcome: 'success', taskPhase: 'finished' });
    const hm = npcStats.getOfficeHeatmap({ days: 7 });
    const today = npcStats._dateKey();
    const cell = hm.cells.find((c) => c.date === today);
    assert.equal(cell.shipped, 2);
    assert.equal(hm.max, 2);
  });

  it('getTodayOfficeTotals counts only today', () => {
    npcStats.recordOutcome('Bob', { outcome: 'success', taskPhase: 'finished' });
    assert.equal(npcStats.getTodayOfficeTotals().shipped, 1);
  });
});

describe('buildAwaySummary', () => {
  beforeEach(() => {
    worldState.officeProgress = {
      totalXp: 0,
      level: 1,
      eventsThisWeek: [],
      counts: { task_shipped: 0, deal_won: 0, ticket_closed: 0 },
    };
  });

  it('filters events since timestamp into lines', () => {
    const now = Date.now();
    worldState.pushProgressEvent({ type: 'deal_won', weight: 10, meta: { npc: 'Lucy' } });
    worldState.officeProgress.eventsThisWeek[0].at = now;
    const away = officeProgress.buildAwaySummary(now - 1000);
    assert.equal(away.quiet, false);
    assert.ok(away.lines.some((l) => l.includes('Lucy')));
  });
});
