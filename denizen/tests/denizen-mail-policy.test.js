'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

describe('denizen-mail-policy', () => {
  let tmpDir;
  let prevPolicy;
  let prevWho;
  let prevAllow;
  let prevConfirmPath;
  let mailPolicy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-policy-'));
    prevPolicy = process.env.DENIZEN_MAIL_POLICY;
    prevWho = process.env.DENIZEN_MAIL_WHO;
    prevAllow = process.env.DENIZEN_MAIL_ALLOWLIST;
    // Reload module against temp token store by patching CONFIRM via copy — use real module
    // and override data path by writing into denizen/data only when tests run; isolate via env TTL.
    delete require.cache[require.resolve('../src/denizen-mail-policy')];
    mailPolicy = require('../src/denizen-mail-policy');
  });

  afterEach(() => {
    if (prevPolicy === undefined) delete process.env.DENIZEN_MAIL_POLICY;
    else process.env.DENIZEN_MAIL_POLICY = prevPolicy;
    if (prevWho === undefined) delete process.env.DENIZEN_MAIL_WHO;
    else process.env.DENIZEN_MAIL_WHO = prevWho;
    if (prevAllow === undefined) delete process.env.DENIZEN_MAIL_ALLOWLIST;
    else process.env.DENIZEN_MAIL_ALLOWLIST = prevAllow;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    delete require.cache[require.resolve('../src/denizen-mail-policy')];
  });

  it('defaults to never and blocks send', () => {
    delete process.env.DENIZEN_MAIL_POLICY;
    delete require.cache[require.resolve('../src/denizen-mail-policy')];
    mailPolicy = require('../src/denizen-mail-policy');
    assert.equal(mailPolicy.policyMode(), 'never');
    const r = mailPolicy.assertSendAllowed({
      npcKey: 'lucy',
      to: 'a@b.com',
      subject: 'Hi',
      body: 'Hello',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /mail_policy_never/);
  });

  it('allowlist permits matching recipient', () => {
    process.env.DENIZEN_MAIL_POLICY = 'allowlist';
    process.env.DENIZEN_MAIL_WHO = 'lucy';
    process.env.DENIZEN_MAIL_ALLOWLIST = '@dolonia.cloud,ceo@x.com';
    delete require.cache[require.resolve('../src/denizen-mail-policy')];
    mailPolicy = require('../src/denizen-mail-policy');
    const deny = mailPolicy.assertSendAllowed({
      npcKey: 'lucy',
      to: 'stranger@evil.test',
      subject: 'x',
      body: 'y',
    });
    assert.equal(deny.ok, false);
    const ok = mailPolicy.assertSendAllowed({
      npcKey: 'lucy',
      to: 'ceo@x.com',
      subject: 'x',
      body: 'y',
    });
    assert.equal(ok.ok, true);
    const domain = mailPolicy.assertSendAllowed({
      npcKey: 'lucy',
      to: 'ops@dolonia.cloud',
      subject: 'x',
      body: 'y',
    });
    assert.equal(domain.ok, true);
  });

  it('confirm mode issues then consumes token', () => {
    process.env.DENIZEN_MAIL_POLICY = 'confirm';
    process.env.DENIZEN_MAIL_WHO = 'abby';
    delete require.cache[require.resolve('../src/denizen-mail-policy')];
    mailPolicy = require('../src/denizen-mail-policy');
    const challenge = mailPolicy.assertSendAllowed({
      npcKey: 'abby',
      to: 'a@b.com',
      subject: 'Sub',
      body: 'Body text',
    });
    assert.equal(challenge.ok, false);
    assert.equal(challenge.needs_confirm, true);
    assert.ok(challenge.confirm_token);

    const badNpc = mailPolicy.assertSendAllowed({
      npcKey: 'oscar',
      to: 'a@b.com',
      subject: 'Sub',
      body: 'Body text',
      confirmToken: challenge.confirm_token,
    });
    assert.equal(badNpc.ok, false);

    const sent = mailPolicy.assertSendAllowed({
      npcKey: 'abby',
      to: 'a@b.com',
      subject: 'Sub',
      body: 'Body text',
      confirmToken: challenge.confirm_token,
    });
    assert.equal(sent.ok, true);
    assert.equal(sent.confirmed, true);

    const reuse = mailPolicy.assertSendAllowed({
      npcKey: 'abby',
      to: 'a@b.com',
      subject: 'Sub',
      body: 'Body text',
      confirmToken: challenge.confirm_token,
    });
    assert.equal(reuse.ok, false);
  });
});
