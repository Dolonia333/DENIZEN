'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const discovery = require('../src/skill-discovery');
const orchestrator = require('../src/skill-gap-orchestrator');

describe('skill-discovery', () => {
  it('scores local skill overlap', () => {
    const catalog = [
      { name: 'research', description: 'Brave web search' },
      { name: 'job-pipeline', description: 'LinkedIn job applications' },
    ];
    const match = discovery.findBestLocalMatch('run research on competitor pricing', catalog);
    assert.ok(match);
    assert.equal(match.name, 'research');
    assert.ok(match.score >= 0.35);
  });

  it('tokenize strips stopwords', () => {
    const tokens = discovery.tokenize('I need a skill for monitoring');
    assert.ok(tokens.includes('monitoring'));
    assert.ok(!tokens.includes('need'));
  });
});

describe('skill-gap-orchestrator', () => {
  it('extracts purpose from skill request', () => {
    const p = orchestrator.extractPurpose('I need a skill that monitors SAM.gov RFPs');
    assert.match(p, /SAM\.gov/i);
  });

  it('detects unknown skill results', () => {
    assert.equal(orchestrator.isUnknownSkillResult({ ok: false, output: 'Unknown skill: foo' }), true);
    assert.equal(orchestrator.isUnknownSkillResult({ ok: true, output: 'done' }), false);
  });

  it('should orchestrate for automation gap on claimed assistant', () => {
    assert.equal(orchestrator.shouldOrchestrate({
      message: 'automate daily scrape of competitor pricing',
      plan: null,
      isAssistant: true,
      canUseRealWork: true,
      registry: { resolve: () => null },
      approvedMap: {},
    }), true);
  });

  it('should not orchestrate for demo visitors', () => {
    assert.equal(orchestrator.shouldOrchestrate({
      message: 'build a skill for X',
      isAssistant: true,
      canUseRealWork: false,
    }), false);
  });

  it('runs pipeline and uses existing local skill when strong match', async () => {
    const broadcasted = [];
    const pipeline = await orchestrator.runGapPipeline({
      npcName: 'Alex',
      message: 'run research skill on kubernetes ingress',
      purpose: 'research kubernetes ingress',
      requestedBy: 'Pat',
      deps: {
        registry: {
          list: () => [{ name: 'research', description: 'Brave web search and page read', source: 'native' }],
        },
        approvedMap: {},
        broadcast: (m) => broadcasted.push(m.type),
        webResearch: null,
        runBuildSkill: async () => ({ ok: false, error: 'should not build' }),
      },
    });
    assert.equal(pipeline.phase, 'existing_skill');
    assert.equal(pipeline.skill, 'research');
    assert.ok(broadcasted.includes('skill_gap_progress'));
    assert.ok(broadcasted.includes('skill_gap_complete'));
  });
});
