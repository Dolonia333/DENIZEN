'use strict';

/**
 * Denizen Harness unit tests — pure logic, no GPU required.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveTierModel, tierForKind, tierForNpc, modelSizeB, largestModel } = require('../src/denizen-harness/tiers');
const { createDenizenHarness, loadHarnessConfig } = require('../src/denizen-harness');
const { createLearningFacade } = require('../src/denizen-harness/learning');
const { createToolsFacade } = require('../src/denizen-harness/tools');

describe('tiers.resolveTierModel', () => {
  const models = [
    'google/gemma-4-e2b',
    'qwen/qwen3.6-27b',
    'mistralai/ministral-3-14b-reasoning',
  ];

  it('prefers env FAST pin for fast tier', () => {
    const m = resolveTierModel({
      tier: 'fast',
      runtime: { models, fast_model: 'google/gemma-4-e2b', main_model: 'qwen/qwen3.6-27b' },
      env: {
        LM_STUDIO_FAST_MODEL: 'google/gemma-4-e2b',
        LM_STUDIO_MODEL: 'qwen/qwen3.6-27b',
        LM_STUDIO_HEAVY_MODEL: 'qwen/qwen3.6-27b',
      },
    });
    assert.match(m, /gemma/i);
  });

  it('prefers heavy pin for heavy tier', () => {
    const m = resolveTierModel({
      tier: 'heavy',
      runtime: { models, heavy_model: 'qwen/qwen3.6-27b', main_model: 'qwen/qwen3.6-27b' },
      env: {
        LM_STUDIO_HEAVY_MODEL: 'qwen/qwen3.6-27b',
        LM_STUDIO_MODEL: 'qwen/qwen3.6-27b',
      },
    });
    assert.match(m, /qwen3\.6-27b/i);
  });

  it('promotes main away from tiny model when larger catalog exists', () => {
    const m = resolveTierModel({
      tier: 'main',
      runtime: {
        models,
        // Misconfigured probe: main_model wrongly points at 2B
        main_model: 'google/gemma-4-e2b',
        heavy_model: 'qwen/qwen3.6-27b',
      },
      env: {},
    });
    assert.ok(modelSizeB(m) >= 14, `expected >=14B, got ${m}`);
  });

  it('pinned model always wins', () => {
    const m = resolveTierModel({
      tier: 'main',
      pinned: 'meta-llama-3.1-8b-instruct',
      runtime: { models },
      env: { LM_STUDIO_MODEL: 'qwen/qwen3.6-27b' },
    });
    assert.equal(m, 'meta-llama-3.1-8b-instruct');
  });
});

describe('tiers.tierForKind', () => {
  it('maps presence to fast and code to heavy', () => {
    assert.equal(tierForKind('presence'), 'fast');
    assert.equal(tierForKind('code'), 'heavy');
    assert.equal(tierForKind('chat'), 'main');
  });

  it('respects loop config override', () => {
    assert.equal(tierForKind('chat', { chat: { tier: 'heavy' } }), 'heavy');
  });
});

describe('tiers.largestModel', () => {
  it('picks highest parameter count', () => {
    assert.equal(
      largestModel(['a-3b', 'b-27b', 'c-8b']),
      'b-27b',
    );
  });
});

describe('createDenizenHarness', () => {
  it('loads config and exposes API surface', () => {
    const h = createDenizenHarness({
      denizenRoot: path.join(__dirname, '..'),
      jelly: {
        listSkills: () => [{ id: 'research' }, { id: 'github' }],
        runSkill: async () => ({ ok: true, output: 'done' }),
      },
      npcBrains: {
        brains: { Abby: { provider: 'lmstudio', role: 'CEO' }, Bob: {} },
        injectSkillResult: () => {},
      },
    });
    assert.ok(h.version);
    assert.equal(typeof h.complete, 'function');
    assert.equal(typeof h.think, 'function');
    assert.equal(typeof h.chat, 'function');
    assert.equal(typeof h.runSkill, 'function');
    assert.equal(typeof h.injectLearning, 'function');
    assert.equal(typeof h.status, 'function');
    assert.equal(h.listSkills().length, 2);
    assert.deepEqual(h.listNpcs().sort(), ['Abby', 'Bob']);
  });

  it('bind() updates deps', () => {
    const h = createDenizenHarness({ denizenRoot: path.join(__dirname, '..') });
    assert.equal(h.listSkills().length, 0);
    h.bind({
      jelly: { listSkills: () => [{ id: 'a' }] },
    });
    assert.equal(h.listSkills().length, 1);
  });

  it('runSkill routes through bound jelly and injects', async () => {
    const calls = [];
    const h = createDenizenHarness({
      denizenRoot: path.join(__dirname, '..'),
      jelly: {
        listSkills: () => [{ id: 'research' }],
        runSkill: async (npc, skill, params) => {
          calls.push({ npc, skill, params });
          return { ok: true, output: 'ok' };
        },
      },
      npcBrains: {
        brains: {},
        injectSkillResult: (npc, skill, result) => {
          calls.push({ inject: true, npc, skill, result });
        },
      },
    });
    const r = await h.runSkill('Abby', 'research', { topic: 'x' });
    assert.equal(r.ok, true);
    assert.equal(calls[0].skill, 'research');
    assert.equal(calls[1].inject, true);
  });

  it('runSkill prefers server runNpcSkill without double-inject', async () => {
    const injects = [];
    const h = createDenizenHarness({
      denizenRoot: path.join(__dirname, '..'),
      runNpcSkill: async () => ({ ok: true, output: 'via-server' }),
      jelly: {
        listSkills: () => [],
        runSkill: async () => ({ ok: true, output: 'via-jelly' }),
      },
      npcBrains: {
        brains: {},
        injectSkillResult: () => injects.push(1),
      },
    });
    const r = await h.runSkill('Abby', 'research', {});
    assert.equal(r.output, 'via-server');
    assert.equal(injects.length, 0);
  });
});

describe('learning facade', () => {
  it('injectSkillResult requires brains', () => {
    const L = createLearningFacade({ denizenRoot: path.join(__dirname, '..') });
    const r = L.injectSkillResult('Abby', 'research', 'hello');
    assert.equal(r.ok, false);
  });

  it('injectSkillResult calls brains', () => {
    const seen = [];
    const L = createLearningFacade({
      denizenRoot: path.join(__dirname, '..'),
      npcBrains: {
        injectSkillResult: (n, s, r) => seen.push({ n, s, r }),
      },
    });
    const out = L.injectSkillResult('Abby', 'research', 'found stuff');
    assert.equal(out.ok, true);
    assert.equal(seen[0].s, 'research');
  });
});

describe('tools facade', () => {
  it('prefers runNpcSkill over jelly', async () => {
    const T = createToolsFacade({
      runNpcSkill: async (npc, skill) => ({ ok: true, via: 'server', skill }),
      jelly: {
        runSkill: async () => ({ ok: true, via: 'jelly' }),
      },
      learning: { injectSkillResult: () => {} },
      config: { learning: { inject_skill_results: true } },
    });
    const r = await T.runSkill('Bob', 'github', {});
    assert.equal(r.via, 'server');
  });
});

describe('loadHarnessConfig', () => {
  it('loads repo config', () => {
    const cfg = loadHarnessConfig(path.join(__dirname, '..'));
    assert.equal(cfg.meta?.name, 'Denizen Harness');
    assert.ok(cfg.loops);
  });

  it('repo config ships the per-NPC tier map (A+ P0.2)', () => {
    const cfg = loadHarnessConfig(path.join(__dirname, '..'));
    assert.ok(cfg.npc_tiers?.map, 'npc_tiers.map missing');
    assert.equal(cfg.npc_tiers.map.abby?.min_tier, 'main');
    assert.equal(cfg.npc_tiers.map.bouncer?.max_tier, 'fast');
  });
});

describe('tiers.tierForNpc (per-NPC policy)', () => {
  const npcTiers = {
    map: {
      abby: { min_tier: 'main', kinds: { think: 'heavy' } },
      bouncer: { max_tier: 'fast' },
      roki: { max_tier: 'fast', kinds: { chat: 'main', presence: 'fast' } },
    },
  };

  it('kind pin wins for mapped kinds', () => {
    assert.equal(tierForNpc('main', 'Abby', 'think', npcTiers), 'heavy');
  });

  it('min_tier raises — hard NPC never answered by fast', () => {
    assert.equal(tierForNpc('fast', 'abby', 'chat', npcTiers), 'main');
  });

  it('max_tier lowers — ambient NPC never burns the big model', () => {
    assert.equal(tierForNpc('heavy', 'bouncer', 'think', npcTiers), 'fast');
  });

  it('kind pin overrides max_tier (roki chat can be main)', () => {
    assert.equal(tierForNpc('fast', 'roki', 'chat', npcTiers), 'main');
    assert.equal(tierForNpc('main', 'roki', 'presence', npcTiers), 'fast');
  });

  it('unmapped NPC keeps the base tier', () => {
    assert.equal(tierForNpc('main', 'josh', 'think', npcTiers), 'main');
    assert.equal(tierForNpc('fast', null, 'presence', npcTiers), 'fast');
  });
});
