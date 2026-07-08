'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crmMutations = require('../src/crm/denizen-crm-mutations');

describe('CRM ticket mutations', () => {
  it('addTicket requires subject', async () => {
    const store = {
      state: { contacts: [], supportTickets: [] },
      updated_at: null,
    };
    const origGet = require('../src/crm/denizen-crm-store').getWorkspace;
    const origUpsert = require('../src/crm/denizen-crm-store').upsertWorkspace;
    require('../src/crm/denizen-crm-store').getWorkspace = async () => store;
    require('../src/crm/denizen-crm-store').upsertWorkspace = async (_org, state) => {
      store.state = state;
      return { ok: true };
    };
    try {
      await assert.rejects(() => crmMutations.addTicket('org-1', {}), /subject required/);
      const result = await crmMutations.addTicket('org-1', { subject: 'Login issue', contact: 'Jane Doe' });
      assert.match(result.summary, /Login issue/);
      assert.equal(store.state.supportTickets.length, 1);
      assert.equal(store.state.supportTickets[0].status, 'open');
    } finally {
      require('../src/crm/denizen-crm-store').getWorkspace = origGet;
      require('../src/crm/denizen-crm-store').upsertWorkspace = origUpsert;
    }
  });

  it('listTickets reports open count', async () => {
    const origGet = require('../src/crm/denizen-crm-store').getWorkspace;
    require('../src/crm/denizen-crm-store').getWorkspace = async () => ({
      state: {
        supportTickets: [
          { id: 1, subject: 'A', status: 'open', slaDue: '2099-01-01' },
          { id: 2, subject: 'B', status: 'closed', slaDue: '2020-01-01' },
        ],
      },
    });
    try {
      const result = await crmMutations.listTickets('org-1', {});
      assert.equal(result.openCount, 1);
      assert.equal(result.tickets.length, 1);
    } finally {
      require('../src/crm/denizen-crm-store').getWorkspace = origGet;
    }
  });
});
