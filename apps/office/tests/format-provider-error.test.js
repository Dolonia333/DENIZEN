'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatProviderError } = require('../src/core/format-provider-error');

describe('formatProviderError', () => {
  it('unwraps AggregateError nested connection failures', () => {
    const err = new AggregateError([
      Object.assign(new Error('connect ECONNREFUSED ::1:1234'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1234'), { code: 'ECONNREFUSED' }),
    ]);
    const msg = formatProviderError(err);
    assert.match(msg, /ECONNREFUSED/);
    assert.match(msg, /Connection failed/i);
  });

  it('passes through plain errors', () => {
    const err = Object.assign(new Error('nope'), { code: 'ECONNREFUSED' });
    assert.match(formatProviderError(err), /ECONNREFUSED/);
  });
});
