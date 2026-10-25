'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const intake = require('../src/denizen-crm-intake-public');

describe('denizen-crm-intake-public', () => {
  it('sanitizeIntakeQuestions falls back to defaults', () => {
    const defaults = intake.sanitizeIntakeQuestions(null);
    assert.ok(defaults.length >= 5);
    assert.equal(defaults[0].label.includes('team'), true);
  });

  it('sanitizeIntakeQuestions keeps custom fields and clamps types', () => {
    const rows = intake.sanitizeIntakeQuestions([
      { id: 3, label: 'Budget band', type: 'select', required: true, options: ['Low', 'High'], icon: '$' },
      { id: 4, label: 'Phone', type: 'phone', required: false, placeholder: '555-0100' },
      { id: 5, label: '', type: 'text' },
      { id: 6, label: 'Freeform', type: 'mystery' },
    ]);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].type, 'select');
    assert.deepEqual(rows[0].options, ['Low', 'High']);
    assert.equal(rows[1].type, 'phone');
    assert.equal(rows[1].placeholder, '555-0100');
    assert.equal(rows[2].type, 'text');
  });

  it('getPublicIntakeForm requires org slug', async () => {
    const missing = await intake.getPublicIntakeForm('');
    assert.equal(missing.ok, false);
    assert.match(missing.error, /org_slug/i);
  });
});
