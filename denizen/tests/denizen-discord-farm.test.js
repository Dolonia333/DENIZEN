'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

describe('denizen-discord-farm', () => {
  let farm;
  let tmp;
  let origRoot;

  before(() => {
    // Point farm at temp by stubbing paths via env-less re-require after monkeypatch
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-farm-'));
    // Load module and override FARM_DIR by writing through public API only —
    // use real module but inject via process cwd data under tmp by copying approach:
    farm = require('../src/denizen-discord-farm');
  });

  after(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  });

  it('redacts secrets', () => {
    const out = farm.redact('token sk-abc123456789 and webhook https://discord.com/api/webhooks/123/abcXYZ');
    assert.match(out, /REDACTED/);
    assert.doesNotMatch(out, /sk-abc/);
  });

  it('extracts topics', () => {
    const t = farm.extractTopics('The deploy pipeline is broken again on staging');
    assert.ok(t.includes('deploy') || t.includes('pipeline') || t.includes('staging') || t.includes('broken'));
  });

  it('ingests and scores', () => {
    const r = farm.ingestChatEvent({
      source: 'test',
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      displayName: 'Tester',
      content: 'Why is the deploy broken? help please',
      messageId: 'm1',
    });
    assert.equal(r.ok, true);
    assert.ok(r.signals.includes('question') || r.signals.includes('friction'));
    const sc = farm.buildDiscordFarmScorecard();
    assert.equal(sc.ok, true);
    assert.ok(sc.messages24h >= 1);
  });
});
