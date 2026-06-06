'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { loadConfig, braveSearchKey } = require('../jelly/config-loader');
const {
  SkillRegistry,
  discoverNativeSkills,
} = require('../jelly/skill-registry');
const { createJelly, JELLY } = require('../jelly');

describe('Jelly meta', () => {
  it('has jellyfish branding', () => {
    assert.equal(JELLY.name, 'Jelly');
    assert.equal(JELLY.emoji, '🪼');
    assert.match(JELLY.logTag, /🪼/);
  });
});

describe('Jelly config-loader', () => {
  it('loads denizen/config/jelly.json when present', () => {
    const cfg = loadConfig(path.join(__dirname, '..'));
    assert.ok(cfg);
    assert.equal(cfg.supabase?.url, 'http://127.0.0.1:54321');
    assert.equal(cfg.meta?.emoji, '🪼');
  });

  it('env overrides brave search key', () => {
    const prev = process.env.BRAVE_SEARCH_API_KEY;
    process.env.BRAVE_SEARCH_API_KEY = 'test-key-123';
    try {
      const cfg = loadConfig(path.join(__dirname, '..'));
      assert.equal(braveSearchKey(cfg), 'test-key-123');
    } finally {
      if (prev === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
      else process.env.BRAVE_SEARCH_API_KEY = prev;
    }
  });
});

describe('Jelly vendor paths', () => {
  const jellyPaths = require('../jelly/paths');

  it('vendors skill scripts under jelly/vendor/skills', () => {
    assert.ok(jellyPaths.vendorScriptPath('web-search'));
    assert.ok(jellyPaths.vendorScriptPath('job-scraper'));
    assert.ok(fs.existsSync(jellyPaths.browserHelpersPath()));
  });

  it('uses ~/.denizen for browser state', () => {
    assert.match(jellyPaths.lucyCloseFlag(), /\.denizen[\\/]browser/);
  });
});

describe('Jelly skill-registry', () => {
  it('discovers native skills from jelly/skills', () => {
    const registry = discoverNativeSkills(path.join(__dirname, '..', 'jelly', 'skills'));
    const names = registry.list().map(s => s.name).sort();
    assert.ok(names.includes('research'));
    assert.ok(names.includes('supabase'));
    assert.ok(names.includes('github'));
    assert.ok(names.includes('job-pipeline'));
  });

  it('resolves aliases to canonical skill', () => {
    const registry = discoverNativeSkills(path.join(__dirname, '..', 'jelly', 'skills'));
    assert.ok(registry.has('supabase-bridge'));
    assert.ok(registry.has('get-quote'));
    assert.ok(registry.has('nmap'));
  });
});

describe('Jelly skill execution', () => {
  it('runs trade-suggest in-process without subprocess', async () => {
    const injected = [];
    const runtime = createJelly({
      denizenRoot: path.join(__dirname, '..'),
      openclawRoot: path.join(__dirname, '..', '..', 'openclaw'),
      deps: {
        npcBrains: { injectSkillResult: (n, s, t) => injected.push({ n, s, t }) },
        robinhoodMcp: {
          createSuggestion: () => ({
            action: 'watch', symbol: 'AAPL', rationale: 'test rationale here',
          }),
        },
        log: { info: () => {}, warn: () => {} },
      },
    });

    const broadcasts = [];
    const result = await runtime.runSkill('Roki', 'trade-suggest', {
      symbol: 'AAPL', rationale: 'test rationale here',
    }, { broadcast: (m) => broadcasts.push(m) });

    assert.equal(result.ok, true);
    assert.match(result.output, /AAPL/);
    assert.equal(injected.length, 1);
    assert.ok(broadcasts.some(b => b.type === 'trade_suggestion'));
  });

  it('blocks trade execution attempts', async () => {
    const runtime = createJelly({
      denizenRoot: path.join(__dirname, '..'),
      deps: {
        npcBrains: { injectSkillResult: () => {} },
        robinhoodMcp: { createSuggestion: () => { throw new Error('should not run'); } },
        log: { info: () => {}, warn: () => {} },
      },
    });
    const result = await runtime.runSkill('Roki', 'trade-suggest', { execute: true }, { broadcast: () => {} });
    assert.equal(result.ok, false);
    assert.match(result.output, /BLOCKED/);
  });
});
