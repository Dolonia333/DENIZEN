'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useDirectSupabase } = require('../jelly/lib/bridge-client');

describe('bridge-client direct mode', () => {
  it('useDirectSupabase when service role key is set', () => {
    const prevUrl = process.env.SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevOnly = process.env.DENIZEN_SUPABASE_BRIDGE_ONLY;
    try {
      process.env.SUPABASE_URL = 'http://example.test';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
      delete process.env.DENIZEN_SUPABASE_BRIDGE_ONLY;
      assert.equal(useDirectSupabase(), true);
      process.env.DENIZEN_SUPABASE_BRIDGE_ONLY = '1';
      assert.equal(useDirectSupabase(), false);
    } finally {
      if (prevUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
      if (prevOnly === undefined) delete process.env.DENIZEN_SUPABASE_BRIDGE_ONLY;
      else process.env.DENIZEN_SUPABASE_BRIDGE_ONLY = prevOnly;
    }
  });
});

// buildFilterParams is not exported - test via re-require internals or skip
// Export buildFilterParams for test? Keep minimal - only useDirectSupabase test
