'use strict';
/**
 * Unit tests for the email-handler pure-logic + the inbound pipeline
 * end-to-end with a stubbed npcBrains + a temp gmail-client.
 *
 * No real Gmail OAuth touched. The local-drafts fallback writes to a
 * temp file we override via the gmail-client's _DRAFT_FILE export.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const handler = require('../src/pipelines/email-handler');

const LUCY_SOUL = `# Lucy — Product Manager

## Email Duties
You also handle CEO email triage as a secondary role.

### email_style
- tone: warm-professional, brief; never robotic
- always_disclose: yes
- max_paragraphs: 3
- signature: |
    Lucy — Secretary NPC
    Drafted on behalf of CEO Zion Van Zandt | Dolonia Data Tech Solutions
    via Denizen, the real-time AI agent environment
- escalate_keywords: [contract, nda, payment]
- never_send: true

## Role
Product Manager
`;

const PLAIN_SOUL = `# Edward — Backend Developer
## Personality
He just writes code.
## Role
Backend Developer
`;

describe('parseEmailStyle', () => {
  it('returns null when no email_style block is present', () => {
    assert.equal(handler.parseEmailStyle(PLAIN_SOUL), null);
  });

  it('parses legacy ## Email Style header (Lucy SOUL on disk)', () => {
    const legacy = `## Email Style
- tone: warm-professional
- email_canAutoSend: true
`;
    const style = handler.parseEmailStyle(legacy);
    assert.ok(style);
    assert.match(style.tone, /warm-professional/);
    assert.equal(style.email_canAutoSend, true);
  });

  it('parses tone, max_paragraphs, never_send, escalate_keywords, signature', () => {
    const style = handler.parseEmailStyle(LUCY_SOUL);
    assert.ok(style);
    assert.match(style.tone, /warm-professional/);
    assert.equal(style.max_paragraphs, 3);
    assert.equal(style.never_send, true);
    assert.deepEqual(style.escalate_keywords, ['contract', 'nda', 'payment']);
    assert.match(style.signature, /Lucy — Secretary NPC/);
    assert.match(style.signature, /CEO Zion/);
    assert.match(style.signature, /via Denizen/);
  });
});

describe('routeEmailToNpc', () => {
  it('picks the first NPC whose SOUL has an email_style', () => {
    const npcBrains = {
      brains: {
        Edward: { personality: PLAIN_SOUL },
        Lucy:  { personality: LUCY_SOUL },
      },
    };
    const routed = handler.routeEmailToNpc(npcBrains, { from: 'x', subject: 'y' });
    assert.equal(routed.name, 'Lucy');
    assert.ok(routed.style);
  });

  it('honors a preferredName when both NPCs have email_style', () => {
    const npcBrains = {
      brains: {
        Alice: { personality: LUCY_SOUL.replace(/Lucy/g, 'Alice') },
        Lucy: { personality: LUCY_SOUL },
      },
    };
    const routed = handler.routeEmailToNpc(npcBrains, { from: 'x', subject: 'y' }, { preferredName: 'Lucy' });
    assert.equal(routed.name, 'Lucy');
  });

  it('returns null when no NPC has email_style', () => {
    const npcBrains = { brains: { Edward: { personality: PLAIN_SOUL } } };
    assert.equal(handler.routeEmailToNpc(npcBrains, { from: 'x', subject: 'y' }), null);
  });
});

describe('shouldEscalate', () => {
  const style = handler.parseEmailStyle(LUCY_SOUL);

  it('returns true when a keyword appears in the subject', () => {
    assert.equal(handler.shouldEscalate({ subject: 'NDA review needed', body: '' }, style), true);
  });

  it('returns true when a keyword appears in the body', () => {
    assert.equal(handler.shouldEscalate({ subject: 'Hi', body: 'Can you send the payment info?' }, style), true);
  });

  it('returns false for unrelated emails', () => {
    assert.equal(handler.shouldEscalate({ subject: 'Lunch?', body: 'Want to grab tacos?' }, style), false);
  });

  it('respects word boundaries (no false positive on substring)', () => {
    // 'paymentless' should NOT match 'payment'
    assert.equal(handler.shouldEscalate({ subject: 'paymentless solution', body: '' }, style), false);
  });
});

describe('assembleFinalBody', () => {
  it('appends the signature on a newline', () => {
    const style = handler.parseEmailStyle(LUCY_SOUL);
    const final = handler.assembleFinalBody('Got it, will follow up.', style);
    assert.match(final, /Got it, will follow up\./);
    assert.match(final, /Lucy — Secretary NPC/);
  });

  it('trims trailing whitespace from the LLM reply before signing', () => {
    const style = handler.parseEmailStyle(LUCY_SOUL);
    const final = handler.assembleFinalBody('Hi there.\n\n\n  ', style);
    assert.match(final, /Hi there\./);
    // Exactly two newlines between body and signature.
    assert.match(final, /Hi there\.\n\nLucy/);
  });

  it('strips LLM-emitted signature (full or partial) and appends the canonical one', () => {
    const style = handler.parseEmailStyle(LUCY_SOUL);

    // Case 1: LLM emits the FULL signature plus "Warm regards,"
    const fullSig = [
      'Hi Garnett,',
      '',
      'Zion will be there at 3.',
      '',
      'Warm regards,',
      'Lucy — Secretary NPC',
      'Drafted on behalf of CEO Zion Van Zandt | Dolonia Data Tech Solutions',
      'via Denizen, the real-time AI agent environment',
    ].join('\n');
    const finalFull = handler.assembleFinalBody(fullSig, style);
    assert.equal((finalFull.match(/Lucy — Secretary NPC/g) || []).length, 1);
    assert.match(finalFull, /Drafted on behalf of CEO/);
    assert.match(finalFull, /via Denizen/);
    assert.doesNotMatch(finalFull, /Warm regards,/);

    // Case 2: LLM emits only the first line of the signature
    const partial = [
      'Sure, see you at 3pm!',
      '',
      'Best,',
      'Lucy — Secretary NPC',
    ].join('\n');
    const finalPartial = handler.assembleFinalBody(partial, style);
    assert.equal((finalPartial.match(/Lucy — Secretary NPC/g) || []).length, 1);
    // Full 3-line signature should be appended.
    assert.match(finalPartial, /Drafted on behalf of CEO/);
    assert.match(finalPartial, /via Denizen/);
    assert.doesNotMatch(finalPartial, /Best,/);

    // Case 3: LLM emits no signature at all
    const noSig = 'Just a one-liner, no signoff.';
    const finalNoSig = handler.assembleFinalBody(noSig, style);
    assert.equal((finalNoSig.match(/Lucy — Secretary NPC/g) || []).length, 1);
    assert.match(finalNoSig, /Just a one-liner/);
  });
});

describe('processInboundEmail — end-to-end with stubbed brain', () => {
  let tmpDraftFile;
  let tmpLogFile;
  const realLogFile = handler._LOG_FILE;

  beforeEach(() => {
    // Redirect the audit log + drafts file to tempdir so dev state stays clean.
    tmpDraftFile = path.join(os.tmpdir(), `denizen-drafts-${Date.now()}.json`);
    tmpLogFile = path.join(os.tmpdir(), `denizen-emails-${Date.now()}.json`);
    process.env._DENIZEN_EMAIL_LOG_OVERRIDE = tmpLogFile;
    // Re-require gmail-client fresh so its _DRAFT_FILE constant is rebound
    // — we monkey-patch the module exports below.
    delete require.cache[require.resolve('../src/pipelines/gmail-client.js')];
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpDraftFile); } catch (_) {}
    try { fs.unlinkSync(tmpLogFile); } catch (_) {}
    delete process.env._DENIZEN_EMAIL_LOG_OVERRIDE;
  });

  function makeStubBrain() {
    return {
      brains: { Lucy: { personality: LUCY_SOUL } },
      async getResponse(npcName, fromName, prompt, ctx) {
        return 'Hi Garnett,\n\nGot it — Zion is aware and will join at the scheduled time. Email me back when ready.\n\nThanks.';
      },
    };
  }

  function makeStubGmail() {
    const drafts = [];
    return {
      async createDraft({ to, subject, body, threadId, by }) {
        const id = `draft_test_${drafts.length}`;
        drafts.push({ id, to, subject, body, threadId, by, sent: false });
        return { id, status: 'drafted', mode: 'stub' };
      },
      async sendDraft({ id }) {
        const d = drafts.find(x => x.id === id);
        if (!d) return { id, status: 'refused', reason: 'not found' };
        d.sent = true;
        return { id, status: 'sent', mode: 'stub' };
      },
      listDrafts: () => drafts.slice(),
      mode: () => 'stub',
      _drafts: drafts,
    };
  }

  it('happy path: routes to Lucy, drafts via gmail, signs, audits', async () => {
    const npcBrains = makeStubBrain();
    const gmailClient = makeStubGmail();
    const res = await handler.processInboundEmail(
      { npcBrains, gmailClient },
      { from: 'garnett@example.com', subject: 'Development Meeting', body: 'Hi Zion, see you at 3?' },
    );
    assert.equal(res.ok, true);
    assert.equal(res.escalated, undefined);
    assert.equal(res.route.name, 'Lucy');
    assert.equal(gmailClient._drafts.length, 1);
    const d = gmailClient._drafts[0];
    assert.equal(d.to, 'garnett@example.com');
    assert.match(d.subject, /^Re:/);
    assert.match(d.body, /Lucy — Secretary NPC/);
  });

  it('does not prepend Re: when subject already starts with Re:', async () => {
    const gmailClient = makeStubGmail();
    await handler.processInboundEmail(
      { npcBrains: makeStubBrain(), gmailClient },
      { from: 'x@example.com', subject: 'Re: ping', body: 'hi' },
    );
    assert.equal(gmailClient._drafts[0].subject, 'Re: ping');
  });

  it('escalates on keyword match — no draft created', async () => {
    const gmailClient = makeStubGmail();
    const res = await handler.processInboundEmail(
      { npcBrains: makeStubBrain(), gmailClient },
      { from: 'lawyer@example.com', subject: 'NDA execution', body: 'Please sign attached.' },
    );
    assert.equal(res.ok, true);
    assert.equal(res.escalated, true);
    assert.equal(gmailClient._drafts.length, 0, 'should not draft an escalated email');
  });

  it('returns an error when no NPC has email_style', async () => {
    const npcBrains = { brains: { Edward: { personality: PLAIN_SOUL } }, getResponse: async () => '' };
    const res = await handler.processInboundEmail(
      { npcBrains, gmailClient: makeStubGmail() },
      { from: 'x@example.com', subject: 'hi', body: 'hi' },
    );
    assert.equal(res.ok, false);
    assert.match(res.error, /no NPC has email_style/);
  });

  it('returns an error when required fields are missing', async () => {
    const res = await handler.processInboundEmail(
      { npcBrains: makeStubBrain(), gmailClient: makeStubGmail() },
      { from: '', subject: '' },
    );
    assert.equal(res.ok, false);
    assert.match(res.error, /required/);
  });
});
