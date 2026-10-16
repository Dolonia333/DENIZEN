#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const orgQuery = require('../src/denizen-org-query.js');

describe('denizen-org-query', () => {
  it('builds org filters', () => {
    assert.equal(orgQuery.orgFilter('abc-123'), 'org_id=eq.abc-123');
    assert.throws(() => orgQuery.orgFilter(''), /org_id required/);
  });

  it('exports org CRUD helpers', () => {
    assert.equal(typeof orgQuery.getOrganization, 'function');
    assert.equal(typeof orgQuery.getOrganizationBySlug, 'function');
    assert.equal(typeof orgQuery.listOrgRows, 'function');
    assert.equal(typeof orgQuery.insertOrgRow, 'function');
  });
});
