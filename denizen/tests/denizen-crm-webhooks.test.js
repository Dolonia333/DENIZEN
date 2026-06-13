'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { emitCrmWebhooks, postWebhook } = require('../src/denizen-crm-webhooks');

describe('denizen-crm-webhooks', () => {
  it('postWebhook skips invalid URLs', async () => {
    const r = await postWebhook('', { event: 'test' });
    assert.equal(r.skipped, true);
    const r2 = await postWebhook('not-a-url', { event: 'test' });
    assert.equal(r2.skipped, true);
  });

  it('emitCrmWebhooks posts contact_added', async () => {
    const calls = [];
    const orig = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 200 };
    };
    try {
      await emitCrmWebhooks(
        { contacts: [], integrations: { outboundWebhooks: { contact_added: 'https://hooks.example.com/c' } } },
        {
          contacts: [{ id: 1, name: 'Ada' }],
          integrations: { outboundWebhooks: { contact_added: 'https://hooks.example.com/c' } },
        },
        'org-1',
      );
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.event, 'contact_added');
      assert.equal(calls[0].body.contact.name, 'Ada');
    } finally {
      global.fetch = orig;
    }
  });

  it('emitCrmWebhooks posts deal_won on stage change', async () => {
    const calls = [];
    const orig = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 200 };
    };
    try {
      await emitCrmWebhooks(
        {
          deals: [{ id: 2, title: 'Big', stage: 'Proposal' }],
          integrations: { outboundWebhooks: { deal_won: 'https://hooks.example.com/w' } },
        },
        {
          deals: [{ id: 2, title: 'Big', stage: 'Closed Won' }],
          integrations: { outboundWebhooks: { deal_won: 'https://hooks.example.com/w' } },
        },
        'org-1',
      );
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.event, 'deal_won');
    } finally {
      global.fetch = orig;
    }
  });
});
