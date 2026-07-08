'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mutations = require('../src/crm/denizen-crm-mutations');

describe('denizen-crm-mutations', () => {
  it('addContact requires name or email', async () => {
    await assert.rejects(
      () => mutations.addContact('org-id', {}),
      /name or email required/i,
    );
  });

  it('updateDeal requires deal id or title', async () => {
    await assert.rejects(
      () => mutations.updateDeal('org-id', {}),
      /not found/i,
    );
  });
});
