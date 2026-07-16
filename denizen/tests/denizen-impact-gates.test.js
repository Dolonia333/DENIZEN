'use strict';

/**
 * A+ P2.2 — high-impact action gates (trust).
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const gates = require('../src/denizen-impact-gates');

describe('denizen-impact-gates classifyImpact', () => {
  it('marks research / github as low (never blocked)', () => {
    assert.equal(gates.classifyImpact('research', { query: 'x' }).level, 'low');
    assert.equal(gates.classifyImpact('github', { action: 'pr-list' }).level, 'low');
    assert.equal(gates.classifyImpact('health-check', {}).level, 'low');
    // even with apply:true on a safe skill — still low (do not block reads)
    assert.equal(gates.classifyImpact('research', { apply: true }).level, 'low');
  });

  it('trade-suggest is high only with execute flag', () => {
    assert.equal(gates.classifyImpact('trade-suggest', { symbol: 'AAPL' }).level, 'low');
    assert.equal(gates.classifyImpact('trade-suggest', { action: 'buy', symbol: 'AAPL' }).level, 'medium');
    const hi = gates.classifyImpact('trade-suggest', { execute: true, symbol: 'AAPL' });
    assert.equal(hi.level, 'high');
    assert.match(hi.reason, /param:execute|trade_execute/);
  });

  it('coding-agent is high when apply:true', () => {
    assert.equal(gates.classifyImpact('coding-agent', { task: 'fix typo' }).level, 'medium');
    const hi = gates.classifyImpact('coding-agent', { task: 'ship', apply: true });
    assert.equal(hi.level, 'high');
    assert.match(hi.reason, /apply|coding_agent/);
  });

  it('flags high params execute/send/apply/deploy/push', () => {
    for (const key of ['execute', 'send', 'apply', 'deploy', 'push']) {
      const r = gates.classifyImpact('custom-skill', { [key]: true });
      assert.equal(r.level, 'high', `expected high for ${key}`);
      assert.equal(r.reason, `param:${key}=true`);
    }
  });

  it('email send flags are high', () => {
    assert.equal(gates.classifyImpact('crm-draft-email', { to: 'a@b.c' }).level, 'medium');
    assert.equal(gates.classifyImpact('crm-draft-email', { send: true }).level, 'high');
    assert.equal(gates.classifyImpact('send-email', { to: 'a@b.c' }).level, 'high');
    assert.equal(gates.classifyImpact('email-handler', { autoSend: true }).level, 'high');
  });

  it('deploy-like skill names are high', () => {
    assert.equal(gates.classifyImpact('cms-publish', {}).level, 'high');
    assert.equal(gates.classifyImpact('platform-publish', {}).level, 'high');
    assert.equal(gates.classifyImpact('deploy', {}).level, 'high');
  });
});

describe('denizen-impact-gates requiresApproval', () => {
  it('requires approval for high impact by default', () => {
    assert.equal(gates.requiresApproval('coding-agent', { apply: true }), true);
    assert.equal(gates.requiresApproval('trade-suggest', { execute: true }), true);
    assert.equal(gates.requiresApproval('research', { query: 'x' }), false);
    assert.equal(gates.requiresApproval('coding-agent', { task: 'only plan' }), false);
  });

  it('policy can opt out of high-impact approval', () => {
    assert.equal(
      gates.requiresApproval('coding-agent', { apply: true }, { require_high_impact_approval: false }),
      false,
    );
    assert.equal(
      gates.requiresApproval('coding-agent', { apply: true }, { allow_silent_high_impact: true }),
      false,
    );
  });

  it('never requires approval for safe skills', () => {
    assert.equal(gates.requiresApproval('github', { push: true }), false);
    assert.equal(gates.requiresApproval('research', { deploy: true }), false);
  });
});

describe('denizen-impact-gates pending store', () => {
  let tmpDir;
  let storePath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-impact-gates-'));
    storePath = path.join(tmpDir, 'impact-approvals.json');
    gates.setApprovalsPath(storePath);
  });

  after(() => {
    gates.setApprovalsPath(null);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  });

  beforeEach(() => {
    gates.setApprovalsPath(storePath);
    try { fs.writeFileSync(storePath, '[]\n', 'utf8'); } catch (_) { /* ignore */ }
  });

  it('createPendingApproval writes row and listPending finds it', () => {
    const row = gates.createPendingApproval({
      npc: 'Roki',
      skill: 'trade-suggest',
      params: { execute: true, symbol: 'TSLA', token: 'secret-token' },
      reason: 'trade_execute',
    });
    assert.ok(row.id);
    assert.equal(row.status, 'pending');
    assert.equal(row.npc, 'Roki');
    assert.equal(row.skill, 'trade-suggest');
    assert.equal(row.params.token, '[redacted]');
    assert.ok(fs.existsSync(storePath));

    const pending = gates.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, row.id);
  });

  it('resolveApproval approves and rejects', () => {
    const a = gates.createPendingApproval({ npc: 'Josh', skill: 'coding-agent', params: { apply: true } });
    const b = gates.createPendingApproval({ npc: 'Lucy', skill: 'send-email', params: { send: true } });

    const ok = gates.resolveApproval(a.id, { approved: true, resolvedBy: 'ceo' });
    assert.equal(ok.ok, true);
    assert.equal(ok.row.status, 'approved');
    assert.equal(ok.row.approved, true);
    assert.equal(ok.row.resolvedBy, 'ceo');

    const no = gates.resolveApproval(b.id, { approved: false, note: 'hold' });
    assert.equal(no.ok, true);
    assert.equal(no.row.status, 'rejected');
    assert.equal(no.row.approved, false);
    assert.equal(no.row.note, 'hold');

    assert.equal(gates.listPending().length, 0);
    assert.equal(gates.listPending({ status: 'all' }).length, 2);
  });

  it('resolveApproval not_found / id_required', () => {
    assert.equal(gates.resolveApproval('', { approved: true }).error, 'id_required');
    assert.equal(gates.resolveApproval('missing', { approved: true }).error, 'not_found');
  });

  it('caps store at MAX_ROWS (100)', () => {
    for (let i = 0; i < 105; i++) {
      gates.createPendingApproval({
        npc: 'Bot',
        skill: 'deploy',
        params: { i },
      });
    }
    const all = gates.listPending({ status: 'all' });
    assert.ok(all.length <= gates.MAX_ROWS);
    assert.equal(all.length, 100);
  });
});

describe('denizen-impact-gates gateSkillRun', () => {
  let tmpDir;
  let storePath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-impact-gate-run-'));
    storePath = path.join(tmpDir, 'impact-approvals.json');
    gates.setApprovalsPath(storePath);
  });

  after(() => {
    gates.setApprovalsPath(null);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  });

  beforeEach(() => {
    gates.setApprovalsPath(storePath);
    try { fs.writeFileSync(storePath, '[]\n', 'utf8'); } catch (_) { /* ignore */ }
  });

  it('returns approval_required and creates pending for high impact', () => {
    const r = gates.gateSkillRun('Josh', 'coding-agent', { task: 'ship', apply: true });
    assert.ok(r);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'approval_required');
    assert.ok(r.approvalId);
    assert.equal(gates.listPending().length, 1);
  });

  it('allows when params.approved or _approvedByHuman', () => {
    assert.equal(
      gates.gateSkillRun('Josh', 'coding-agent', { apply: true, approved: true }),
      null,
    );
    assert.equal(
      gates.gateSkillRun('Josh', 'coding-agent', { apply: true, _approvedByHuman: true }),
      null,
    );
  });

  it('does not gate research / github', () => {
    assert.equal(gates.gateSkillRun('Abby', 'research', { query: 'mesh' }), null);
    assert.equal(gates.gateSkillRun('Abby', 'github', { action: 'pr-list' }), null);
  });
});

describe('SkillExecutor impact gate integration', () => {
  it('blocks high-impact skill without approval and does not run handler', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-impact-ex-'));
    const storePath = path.join(tmp, 'impact-approvals.json');
    gates.setApprovalsPath(storePath);
    fs.writeFileSync(storePath, '[]\n', 'utf8');

    let ran = false;
    const { SkillRegistry } = require('../jelly/skill-registry');
    const { SkillExecutor } = require('../jelly/skill-executor');
    const registry = new SkillRegistry();
    registry.register({
      meta: { name: 'coding-agent', description: 'test' },
      run: async () => {
        ran = true;
        return { ok: true, output: 'should-not-run' };
      },
    });
    // Avoid contract validation requiring task etc. — use a custom high skill
    registry.register({
      meta: { name: 'deploy-prod', description: 'test deploy' },
      run: async () => {
        ran = true;
        return { ok: true, output: 'should-not-run' };
      },
    });

    const ex = new SkillExecutor(registry, {
      log: { info: () => {}, warn: () => {} },
      npcBrains: { injectSkillResult: () => {} },
    });
    const broadcasts = [];
    const r = await ex.run(
      'Edward',
      'deploy-prod',
      {},
      { broadcast: (m) => broadcasts.push(m) },
    );

    assert.equal(ran, false);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'approval_required');
    assert.ok(r.approvalId);

    // With human approval flag, skill runs
    ran = false;
    const r2 = await ex.run(
      'Edward',
      'deploy-prod',
      { approved: true },
      { broadcast: () => {} },
    );
    assert.equal(ran, true);
    assert.equal(r2.ok, true);

    // research is not blocked
    registry.register({
      meta: { name: 'research', description: 'test' },
      run: async () => ({ ok: true, output: 'ok-research' }),
    });
    // research has a contract requiring query — use github-like custom safe skill via name research after contract
    // Use health-check if contract allows empty, or pass valid research args
    const { SkillRegistry: SR2 } = require('../jelly/skill-registry');
    const reg2 = new SR2();
    reg2.register({
      meta: { name: 'github', description: 'read' },
      run: async () => ({ ok: true, output: 'prs' }),
    });
    const ex2 = new SkillExecutor(reg2, {
      log: { info: () => {}, warn: () => {} },
      npcBrains: { injectSkillResult: () => {} },
    });
    const r3 = await ex2.run('Abby', 'github', { action: 'pr-list' }, { broadcast: () => {} });
    assert.equal(r3.ok, true);
    assert.equal(r3.output, 'prs');

    gates.setApprovalsPath(null);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });
});
