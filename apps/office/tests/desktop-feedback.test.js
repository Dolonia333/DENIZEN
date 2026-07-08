'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  configureLogFile,
  resetCounter,
  submitFeedback,
  listRecentFeedback,
  parseJsonlLines,
} = require('../src/desktop/denizen-desktop-feedback');

function mkTmpLog() {
  return path.join(
    os.tmpdir(),
    `denizen-dfb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`,
  );
}

describe('denizen-desktop-feedback', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkTmpLog();
    configureLogFile(tmp);
    resetCounter(0);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmp); } catch (_) {}
    configureLogFile(null);
    resetCounter(0);
  });

  it('submitFeedback appends a normalized record to JSONL', () => {
    const rec = submitFeedback({
      sessionId: 'sess-1',
      installId: 'inst-abc',
      appVersion: '0.2.0',
      platform: 'win32',
      arch: 'x64',
      osVersion: '10.0.26200',
      channel: 'beta',
      event: 'crash',
      detail: 'window froze after pairing',
      logsTail: 'line1\nline2',
    });
    assert.match(rec.id, /^dfb_/);
    assert.match(rec.at, /^\d{4}-/);
    assert.equal(rec.sessionId, 'sess-1');
    assert.equal(rec.installId, 'inst-abc');
    assert.equal(rec.event, 'crash');
    assert.equal(rec.logsTail, 'line1\nline2');

    const raw = fs.readFileSync(tmp, 'utf8').trim();
    assert.equal(raw.split('\n').length, 1);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.id, rec.id);
  });

  it('accepts snake_case field aliases', () => {
    const rec = submitFeedback({
      session_id: 's2',
      install_id: 'i2',
      app_version: '0.1.0',
      os_version: '14.0',
      logs_tail: 'tail',
      event: 'note',
    });
    assert.equal(rec.sessionId, 's2');
    assert.equal(rec.installId, 'i2');
    assert.equal(rec.appVersion, '0.1.0');
    assert.equal(rec.osVersion, '14.0');
    assert.equal(rec.logsTail, 'tail');
  });

  it('listRecentFeedback returns newest first with limit', () => {
    for (let i = 0; i < 5; i += 1) {
      submitFeedback({ sessionId: 's', event: `e${i}` });
    }
    const all = listRecentFeedback({ limit: 50 });
    assert.equal(all.length, 5);
    assert.equal(all[0].event, 'e4');
    assert.equal(all[4].event, 'e0');

    const two = listRecentFeedback({ limit: 2 });
    assert.equal(two.length, 2);
    assert.equal(two[0].event, 'e4');
    assert.equal(two[1].event, 'e3');
  });

  it('parseJsonlLines skips blank and corrupt lines', () => {
    const text = '{"a":1}\n\n{bad\n{"c":3}\n';
    const rows = parseJsonlLines(text);
    assert.deepEqual(rows, [{ a: 1 }, { c: 3 }]);
  });

  it('listRecentFeedback returns empty array when log missing', () => {
    configureLogFile(path.join(os.tmpdir(), `denizen-dfb-missing-${Date.now()}.jsonl`));
    assert.deepEqual(listRecentFeedback(), []);
  });
});
