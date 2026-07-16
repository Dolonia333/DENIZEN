'use strict';

/**
 * A+ P1.2 — Skill contracts unit tests.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  listContracts,
  getContract,
  validateSkillArgs,
  hasContract,
  recordSkillOutcome,
  getSkillMetrics,
  resetSkillMetrics,
  metricsSummary,
  setMetricsPath,
  setPersistEnabled,
  checkCooldown,
  markSkillStart,
} = require('../src/denizen-skill-contracts');

const TOP = [
  'research',
  'github',
  'coding-agent',
  'denizen-data',
  'consult-grok',
  'market-watch',
  'job-pipeline',
  'browserclaw',
  'health-check',
  'remediate',
];

describe('denizen-skill-contracts list', () => {
  it('lists at least 10 contracts', () => {
    const list = listContracts();
    assert.ok(list.length >= 10, `expected ≥10 contracts, got ${list.length}`);
  });

  it('covers the top A+ skills', () => {
    const ids = new Set(listContracts().map((c) => c.id));
    for (const id of TOP) {
      assert.ok(ids.has(id), `missing contract: ${id}`);
      assert.equal(hasContract(id), true);
    }
  });

  it('each contract has schema, timeout, cooldown, tier, output_shape, inject_template', () => {
    for (const c of listContracts()) {
      assert.ok(c.id, 'id');
      assert.ok(c.input_schema && typeof c.input_schema === 'object', `${c.id} input_schema`);
      assert.ok(Number(c.timeout_ms) > 0, `${c.id} timeout_ms`);
      assert.ok(Number(c.cooldown_ms) >= 0, `${c.id} cooldown_ms`);
      assert.ok(['fast', 'main', 'heavy'].includes(c.preferred_tier), `${c.id} preferred_tier`);
      assert.ok(c.output_shape && typeof c.output_shape === 'object', `${c.id} output_shape`);
      assert.equal(typeof c.inject_template, 'string', `${c.id} inject_template`);
    }
  });

  it('getContract returns null for unknown', () => {
    assert.equal(getContract('no-such-skill-xyz'), null);
  });
});

describe('validateSkillArgs — research', () => {
  it('accepts good query', () => {
    const r = validateSkillArgs('research', { query: 'local LLM routing' });
    assert.equal(r.ok, true, r.errors?.join('; '));
    assert.equal(r.normalized.query, 'local LLM routing');
  });

  it('normalizes topic → query', () => {
    const r = validateSkillArgs('research', { topic: 'mesh workers' });
    assert.equal(r.ok, true, r.errors?.join('; '));
    assert.equal(r.normalized.query, 'mesh workers');
  });

  it('rejects empty args', () => {
    const r = validateSkillArgs('research', {});
    assert.equal(r.ok, false);
    assert.ok(r.errors.length >= 1);
  });
});

describe('validateSkillArgs — consult-grok', () => {
  it('accepts question', () => {
    const r = validateSkillArgs('consult-grok', {
      question: 'How should Abby prioritize RFP work today?',
      topic: 'planning',
    });
    assert.equal(r.ok, true, r.errors?.join('; '));
  });

  it('rejects missing question', () => {
    const r = validateSkillArgs('consult-grok', { topic: 'only' });
    assert.equal(r.ok, false);
  });
});

describe('validateSkillArgs — browserclaw', () => {
  it('accepts task', () => {
    const r = validateSkillArgs('browserclaw', { task: 'Open https://example.com and summarize' });
    assert.equal(r.ok, true, r.errors?.join('; '));
  });

  it('accepts url only', () => {
    const r = validateSkillArgs('browserclaw', { url: 'https://example.com' });
    assert.equal(r.ok, true, r.errors?.join('; '));
    assert.ok(r.normalized.task);
  });

  it('rejects empty', () => {
    const r = validateSkillArgs('browserclaw', {});
    assert.equal(r.ok, false);
  });
});

describe('validateSkillArgs — coding-agent', () => {
  it('accepts task + targetFiles', () => {
    const r = validateSkillArgs('coding-agent', {
      task: 'Add unit tests for skill contracts',
      targetFiles: ['src/denizen-skill-contracts.js'],
    });
    assert.equal(r.ok, true, r.errors?.join('; '));
  });

  it('rejects missing task', () => {
    const r = validateSkillArgs('coding-agent', { targetFiles: ['a.js'] });
    assert.equal(r.ok, false);
  });
});

describe('validateSkillArgs — github / remediate', () => {
  it('github allows defaults', () => {
    const r = validateSkillArgs('github', {});
    assert.equal(r.ok, true, r.errors?.join('; '));
  });

  it('github rejects bad action enum', () => {
    const r = validateSkillArgs('github', { action: 'delete-everything' });
    assert.equal(r.ok, false);
  });

  it('remediate rejects unknown action', () => {
    const r = validateSkillArgs('remediate', { action: 'format-c' });
    assert.equal(r.ok, false);
  });

  it('unknown skill pass-through', () => {
    const r = validateSkillArgs('trade-suggest', { symbol: 'AAPL' });
    assert.equal(r.ok, true);
  });
});

describe('metrics + cooldown', () => {
  let tmp;
  before(() => {
    resetSkillMetrics();
    tmp = path.join(os.tmpdir(), `denizen-skill-metrics-${Date.now()}.jsonl`);
    setMetricsPath(tmp);
    setPersistEnabled(true);
  });
  after(() => {
    setPersistEnabled(false);
    setMetricsPath(null);
    try { fs.unlinkSync(tmp); } catch (_) {}
    resetSkillMetrics();
  });

  it('records success/fail/invalid counts', () => {
    recordSkillOutcome('research', 'success', { durationMs: 12, npc: 'Abby' });
    recordSkillOutcome('research', 'fail', { error: 'timeout' });
    recordSkillOutcome('research', 'invalid', { error: 'no query' });
    const m = getSkillMetrics('research');
    assert.equal(m.success, 1);
    assert.equal(m.fail, 1);
    assert.equal(m.invalid, 1);
    const summary = metricsSummary();
    assert.equal(summary.contracts, listContracts().length);
    assert.ok(summary.bySkill.research);
  });

  it('optionally appends jsonl', () => {
    assert.ok(fs.existsSync(tmp));
    const lines = fs.readFileSync(tmp, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 3);
    const row = JSON.parse(lines[0]);
    assert.equal(row.skill, 'research');
  });

  it('enforces cooldown after markSkillStart', () => {
    resetSkillMetrics();
    markSkillStart('health-check');
    const cd = checkCooldown('health-check');
    assert.equal(cd.ok, false);
    assert.ok(cd.waitMs > 0);
  });
});

describe('SkillExecutor contract gate', () => {
  it('rejects invalid args without throwing', async () => {
    const { SkillRegistry } = require('../jelly/skill-registry');
    const { SkillExecutor } = require('../jelly/skill-executor');
    const registry = new SkillRegistry();
    registry.register({
      meta: { name: 'research', description: 'test' },
      run: async () => ({ ok: true, output: 'should-not-run' }),
    });
    const broadcasts = [];
    const ex = new SkillExecutor(registry, {
      log: { info: () => {}, warn: () => {} },
      npcBrains: { injectSkillResult: () => {} },
    });
    const r = await ex.run('Abby', 'research', {}, { broadcast: (m) => broadcasts.push(m) });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid_skill_args');
    assert.match(String(r.output), /Invalid args/i);
  });
});

describe('harness status surfaces skill contracts', () => {
  it('status().skills includes contracts + metrics', async () => {
    const { createDenizenHarness } = require('../src/denizen-harness');
    const h = createDenizenHarness({
      denizenRoot: path.join(__dirname, '..'),
      jelly: { listSkills: () => [{ id: 'research' }, { id: 'github' }] },
      npcBrains: { brains: {} },
    });
    const st = await h.status();
    assert.ok(st.skills && typeof st.skills === 'object');
    assert.ok(st.skills.contracts >= 10, `contracts=${st.skills.contracts}`);
    assert.ok(st.skills.metrics && typeof st.skills.metrics === 'object');
    assert.ok(Array.isArray(st.skills.ids));
    assert.ok(st.skills.ids.includes('research'));
  });
});
