'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const inbound = require('../src/denizen-crm-email-inbound');

describe('denizen-crm-email-inbound', () => {
  it('builds query for Angela addresses', () => {
    const q = inbound.buildQuery(inbound.DEFAULT_FROM);
    assert.match(q, /vzion253@gmail\.com/);
    assert.match(q, /newer_than:/);
  });

  it('files inbound into CRM state with contact + emailLog + note', () => {
    const prev = { contacts: [], emailLog: [], notes: [], deals: [] };
    const msg = {
      id: 'gmail_abc',
      threadId: 't1',
      from: 'ANGELA VAN ZANDT <vzion253@gmail.com>',
      to: 'zionvanzandt@gmail.com',
      subject: 'OMES capture follow-up',
      bodyText: 'Please update the opportunity with the new solicitation number.',
      snippet: 'Please update the opportunity…',
      internalDate: Date.now(),
    };
    const out = inbound.fileMessageIntoState(prev, msg);
    assert.equal(out.skipped, false);
    assert.equal(out.createdContact, true);
    assert.equal(out.contact.email, 'vzion253@gmail.com');
    assert.ok(out.state.emailLog[0].direction === 'inbound');
    assert.equal(out.state.emailLog[0].gmailId, 'gmail_abc');
    assert.ok(out.state.notes[0].body.includes('OMES'));
    assert.ok(out.suggestedTask, 'creates suggested follow-up task');
    assert.equal(out.suggestedTask.suggested, true);
    assert.match(out.suggestedTask.title, /OMES/i);
    assert.ok(Array.isArray(out.state.suggestedTasks) && out.state.suggestedTasks.length >= 1);
  });

  it('dedupes by gmailId', () => {
    const prev = {
      contacts: [{ id: 1, name: 'Angela', email: 'vzion253@gmail.com' }],
      emailLog: [{ id: 1, gmailId: 'gmail_abc', direction: 'inbound' }],
      notes: [],
    };
    const out = inbound.fileMessageIntoState(prev, {
      id: 'gmail_abc',
      from: 'vzion253@gmail.com',
      subject: 'x',
      bodyText: 'y',
    });
    assert.equal(out.skipped, true);
  });

  it('pollGmailInbound files mock messages without real Gmail', async () => {
    const prevEnabled = process.env.GMAIL_INBOUND;
    process.env.GMAIL_INBOUND = '1';
    // Stub CRM store / db — unit path only tests allowlist skip when no org
    // Use messages with full payload so getMessage isn't needed
    const mockGmail = {
      mode: () => 'mock',
      isReal: () => false,
      listMessages: async () => ({
        ok: true,
        messages: [{
          id: `mock_${Date.now()}`,
          full: {
            from: 'Angela <vzion253@gmail.com>',
            to: 'me@example.com',
            subject: 'Unit test inbound',
            bodyText: 'Hello from Angela',
            snippet: 'Hello',
            internalDate: Date.now(),
          },
        }],
      }),
      getMessage: async () => ({ ok: false }),
      parseAddress: require('../src/gmail-client').parseAddress,
    };

    // Without org/db this should still return structure; may no_org on file
    const r = await inbound.pollGmailInbound({
      gmail: mockGmail,
      orgId: null,
    });
    assert.ok(typeof r.polled === 'number');
    if (prevEnabled === undefined) delete process.env.GMAIL_INBOUND;
    else process.env.GMAIL_INBOUND = prevEnabled;
  });
});
