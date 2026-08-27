'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

describe('outcome ledger + directive lifecycle + hygiene', () => {
  let tmpDir;
  let ledgerPath;
  let origLedger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-outcome-'));
    ledgerPath = path.join(tmpDir, 'outcome-ledger.jsonl');
    // Patch ledger path via writing to module after require — use append with isolated file
    const ledger = require('../src/denizen-outcome-ledger');
    origLedger = ledger.ledgerPath;
    // Override by writing through appendOutcome into temp via env isn't supported —
    // test against real module path under data/ with unique prefix instead
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  it('appendOutcome + standup returns receipts', () => {
    const ledger = require('../src/denizen-outcome-ledger');
    const before = ledger.readRecent({ hours: 1, limit: 200 }).length;
    const entry = ledger.appendOutcome({
      actor: 'test',
      outcome_type: 'test.receipt',
      entity_type: 'test',
      entity_key: 't1',
      value_text: 'unit test receipt',
      source: 'test',
      pass: true,
    });
    assert.ok(entry.id);
    const stand = ledger.standup({ hours: 1, limit: 50 });
    assert.ok(stand.count >= before + 1);
    assert.ok(stand.breakdown['test.receipt'] >= 1);
  });

  it('assignDirective → running → complete writes ledger', () => {
    const NpcBrainManager = require('../src/npc-brains');
    const brains = Object.create(NpcBrainManager.prototype);
    brains._directives = new Map();
    brains._directivesPath = path.join(tmpDir, 'npc-directives.json');
    brains._officeRuntimes = null;
    brains._thinkWakeFn = null;
    brains.isPlayerChatBusy = () => false;

    const entry = brains.assignDirective('Molly', 'Jenny', 'Park scrape deals', true);
    assert.equal(entry.status, 'queued');
    assert.ok(entry.id);
    brains.markDirectiveRunning('Molly');
    assert.equal(brains.getDirective('Molly').status, 'running');
    const done = brains.completeDirective('Molly', {
      status: 'done',
      note: 'parked 3 deals',
      artifact: 'commit:abc',
    });
    assert.equal(done.ok, true);
    assert.equal(done.directive.status, 'done');
    assert.equal(brains.getDirective('Molly'), null);
    const listed = brains.listDirectives({ include_archived: true });
    assert.ok(listed.some((r) => r.status === 'done' && r.npc === 'Molly'));
  });

  it('hygiene parks scrape deals without human+next verb', async () => {
    const hygiene = require('../src/denizen-nightly-hygiene');
    const crmStore = require('../src/denizen-crm-store');
    const origGet = crmStore.getWorkspace;
    const origUpsert = crmStore.upsertWorkspace;
    let saved = null;
    crmStore.getWorkspace = async () => ({
      state: {
        deals: [
          {
            id: 1,
            title: 'SAM.gov Widget RFP',
            stage: 'RFP Review',
            value: 999999,
            samGovId: 'SAM-1',
            contact: 'Department of Widgets',
            tags: ['federal-rfp'],
          },
          {
            id: 2,
            title: 'Real Partner Deal',
            stage: 'Qualified',
            value: 5000,
            contact: 'Ada Lovelace',
          },
        ],
        contacts: [
          { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
        ],
        tasks: [
          { id: 1, title: 'Call Ada about Real Partner Deal', dealId: 2, done: false },
        ],
      },
    });
    crmStore.upsertWorkspace = async (_oid, state) => {
      saved = state;
      return { state };
    };

    try {
      const fakeBrains = {
        expireStaleDirectives: () => [],
      };
      const result = await hygiene.runNightlyHygiene({
        orgId: 'org-test',
        npcBrains: fakeBrains,
        log: { info() {}, log() {} },
      });
      assert.equal(result.ok, true);
      assert.equal(result.parked_count, 1);
      assert.equal(result.parked[0].id, 1);
      assert.ok(result.outcome?.id);
      assert.ok(saved);
      const parked = saved.deals.find((d) => d.id === 1);
      assert.equal(parked.status, 'watchlist');
      assert.equal(parked.value, 0);
      const kept = saved.deals.find((d) => d.id === 2);
      assert.notEqual(kept.status, 'watchlist');
    } finally {
      crmStore.getWorkspace = origGet;
      crmStore.upsertWorkspace = origUpsert;
    }
  });

  it('scheduled jobs list + run_now crm-hygiene', async () => {
    const jobs = require('../src/denizen-scheduled-jobs');
    const listed = jobs.listJobs();
    assert.ok(listed.some((j) => j.id === 'crm-hygiene'));

    const crmStore = require('../src/denizen-crm-store');
    const origGet = crmStore.getWorkspace;
    const origUpsert = crmStore.upsertWorkspace;
    crmStore.getWorkspace = async () => ({ state: { deals: [], contacts: [], tasks: [] } });
    crmStore.upsertWorkspace = async () => ({});
    try {
      const result = await jobs.runJob('crm-hygiene', {
        orgId: 'org-test',
        npcBrains: { expireStaleDirectives: () => [] },
        log: { info() {}, log() {} },
      });
      assert.equal(result.ok, true);
      assert.ok(jobs.getJob('crm-hygiene').last_run_at);
    } finally {
      crmStore.getWorkspace = origGet;
      crmStore.upsertWorkspace = origUpsert;
    }
  });
});
