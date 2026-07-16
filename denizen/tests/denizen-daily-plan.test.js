'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const dailyPlan = require('../src/denizen-daily-plan');
const evidence = require('../src/denizen-evidence');

describe('denizen-daily-plan (P2.2)', () => {
  let tmpDir;
  let planPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-daily-plan-'));
    planPath = path.join(tmpDir, 'daily-plan.json');
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  });

  it('buildDailyPlan returns date, exactly 5 priorities, source, at', () => {
    const plan = dailyPlan.buildDailyPlan({});
    assert.equal(typeof plan.date, 'string');
    assert.match(plan.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(plan.priorities));
    assert.equal(plan.priorities.length, 5);
    for (const p of plan.priorities) {
      assert.equal(typeof p, 'string');
      assert.ok(p.length > 3);
    }
    assert.equal(typeof plan.source, 'string');
    assert.ok(plan.source.length > 0);
    assert.equal(typeof plan.at, 'string');
    assert.ok(Date.parse(plan.at));
  });

  it('incorporates CRM brief and office stuck agents into priorities', () => {
    const plan = dailyPlan.buildDailyPlan({
      crmBrief: {
        overdueTaskCount: 3,
        openDealCount: 2,
        pendingTaskCount: 5,
        summary: 'Nexus at risk; OMES hygiene lagging',
      },
      officeSnapshot: {
        npcs: {
          Alex: { state: 'stuck', currentTask: 'path_stuck' },
          Josh: { state: 'working', currentTask: 'PR review' },
          Edward: { state: 'idle' },
          Jenny: { state: 'idle' },
          Molly: { state: 'idle' },
          Oscar: { state: 'idle' },
        },
      },
    });
    const blob = plan.priorities.join(' | ').toLowerCase();
    assert.ok(
      /crm|overdue|pipeline|nexus|omes|stuck|alex|idle|unblock/i.test(blob),
      `expected CRM/office signal in priorities, got: ${plan.priorities.join('; ')}`,
    );
    assert.match(plan.source, /crm|office/);
  });

  it('saveDailyPlan / loadDailyPlan round-trip', () => {
    const built = dailyPlan.buildDailyPlan({ date: '2099-01-02' });
    const saved = dailyPlan.saveDailyPlan(built, planPath);
    assert.equal(saved.date, '2099-01-02');
    assert.equal(saved.priorities.length, 5);
    assert.ok(fs.existsSync(planPath));

    const loaded = dailyPlan.loadDailyPlan(planPath);
    assert.ok(loaded);
    assert.equal(loaded.date, '2099-01-02');
    assert.deepEqual(loaded.priorities, saved.priorities);
    assert.equal(loaded.source, saved.source);
  });

  it('getTodayPlan reuses same-day file and rebuilds on force', () => {
    const day = dailyPlan.todayDate();
    const first = dailyPlan.getTodayPlan({ filePath: planPath, date: day });
    assert.equal(first.date, day);
    assert.equal(first.priorities.length, 5);

    const again = dailyPlan.getTodayPlan({ filePath: planPath, date: day });
    assert.deepEqual(again.priorities, first.priorities);
    assert.equal(again.at, first.at);

    const forced = dailyPlan.getTodayPlan({
      filePath: planPath,
      date: day,
      force: true,
      crmBrief: 'force-refresh CRM signal',
    });
    assert.equal(forced.date, day);
    assert.equal(forced.priorities.length, 5);
    // regenerated → new timestamp
    assert.ok(forced.at);
  });

  it('formatAbbyThinkBlock lists numbered priorities for CTO inject', () => {
    const plan = {
      date: '2099-01-01',
      priorities: ['A', 'B', 'C', 'D', 'E'],
      source: 'test',
      at: new Date().toISOString(),
    };
    const block = dailyPlan.formatAbbyThinkBlock(plan);
    assert.match(block, /Company daily plan/i);
    assert.match(block, /1\. A/);
    assert.match(block, /5\. E/);
    assert.equal(dailyPlan.formatAbbyThinkBlock(null), '');
  });
});

describe('denizen-evidence (P2.3)', () => {
  it('hasRecentEvidence reads brains._evidenceLog within window', () => {
    const brains = {
      _evidenceLog: new Map([
        ['Alex', { skillAt: Date.now() - 1000, researchAt: 0 }],
      ]),
    };
    assert.equal(evidence.hasRecentEvidence('Alex', { withinMs: 5000 }, brains), true);
    assert.equal(evidence.hasRecentEvidence('Alex', { withinMs: 10 }, brains), false);
    assert.equal(
      evidence.hasRecentEvidence('Alex', { withinMs: 5000, kinds: ['artifact'] }, brains),
      false,
    );
    assert.equal(evidence.hasRecentEvidence('Nobody', {}, brains), false);
  });

  it('claimsShipOrFix detects ship/deploy/fix language', () => {
    assert.equal(evidence.claimsShipOrFix('I shipped the auth fix to prod'), true);
    assert.equal(evidence.claimsShipOrFix('We deployed the mesh worker'), true);
    assert.equal(evidence.claimsShipOrFix('I fixed the race in pathfinding'), true);
    assert.equal(evidence.claimsShipOrFix('Looking into the race condition'), false);
  });

  it('softThoughtDisclaimer only when claim + no evidence; never implies speech rewrite', () => {
    const claim = 'I shipped the CRM bridge and it is live.';
    const note = evidence.softThoughtDisclaimer(claim, false);
    assert.match(note, /Soft grounding/i);
    assert.match(note, /thought only/i);

    assert.equal(evidence.softThoughtDisclaimer(claim, true), '');
    assert.equal(evidence.softThoughtDisclaimer('Working on the CRM bridge', false), '');
  });

  it('maybeQueueThoughtDisclaimer queues next-think note without changing speech', () => {
    const brains = {
      _evidenceLog: new Map(),
      _pendingGrounding: new Map(),
    };
    const speech = 'I deployed the hot fix — all good.';
    const note = evidence.maybeQueueThoughtDisclaimer(brains, 'Josh', speech);
    assert.match(note, /Soft grounding/i);
    assert.match(brains._pendingGrounding.get('Josh') || '', /Soft grounding/i);

    // With fresh skill evidence — no note
    brains._evidenceLog.set('Josh', { skillAt: Date.now() });
    brains._pendingGrounding.clear();
    const none = evidence.maybeQueueThoughtDisclaimer(brains, 'Josh', speech);
    assert.equal(none, '');
    assert.equal(brains._pendingGrounding.has('Josh'), false);
  });

  it('evidenceBagFromEntry mirrors grounding flags', () => {
    const now = Date.now();
    const bag = evidence.evidenceBagFromEntry(
      { skillAt: now - 1000, researchAt: now - 1000, artifactAt: 0 },
      now,
      60_000,
    );
    assert.equal(bag.hasSkillResult, true);
    assert.equal(bag.hasResearch, true);
    assert.equal(bag.hasArtifact, false);
  });
});
