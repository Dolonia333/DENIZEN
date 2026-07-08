'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildWeeklyDigest } = require('../src/crm/denizen-crm-digest');

describe('denizen-crm-digest', () => {
  it('buildWeeklyDigest summarizes workspace', () => {
    const text = buildWeeklyDigest({
      deals: [
        { title: 'A', stage: 'Proposal', value: 10000 },
        { title: 'B', stage: 'Closed Won', value: 5000 },
        { title: 'C', stage: 'Closed Lost', value: 1000 },
      ],
      contacts: [{ id: 1 }, { id: 2 }],
      tasks: [{ done: false, due: '2020-01-01' }],
    });
    assert.match(text, /Pipeline/);
    assert.match(text, /Contacts: 2/);
    assert.match(text, /Overdue tasks: 1/);
  });
});
