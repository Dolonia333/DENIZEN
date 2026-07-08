'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  isAvailable,
  runEntityForecast,
} = require('../src/intelligence/mirofish-prediction.js');

describe('mirofish-prediction', () => {
  afterEach(() => {
    delete global.fetch;
  });

  it('uses MiroFish forecast when service is healthy', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null });

      if (url === 'http://localhost:5001/api/health') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (url === 'http://localhost:5001/api/predictions/forecast') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            confidence: 0.86,
            model_version: '1.2.3',
            verdict: {
              will_convert: true,
              close_probability: 0.86,
            },
            report: 'Strong fit for conversion',
          }),
        };
      }
      return { ok: false, status: 404, text: async () => 'not found' };
    };

    const forecast = await runEntityForecast({
      entityType: 'lead',
      entityId: 'lead-123',
      context: { signals: { status: 'qualified' } },
      env: {
        MIROFISH_ENABLED: 'true',
        MIROFISH_BASE_URL: 'http://localhost:5001',
      },
    });

    assert.equal(forecast.modelKey, 'mirofish_v1');
    assert.equal(forecast.modelVersion, '1.2.3');
    assert.equal(forecast.entityType, 'lead');
    assert.equal(forecast.predictionType, 'lead.close_probability');
    assert.equal(forecast.confidence, 0.86);
    assert.equal(forecast.prediction.will_convert, true);
    assert.equal(forecast.prediction.close_probability, 0.86);
    assert.ok(calls.some((c) => c.url.endsWith('/api/health')));
    assert.ok(calls.some((c) => c.url.endsWith('/api/predictions/forecast')));
  });

  it('falls back to heuristic when MiroFish is unavailable', async () => {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      calls.push({ url, method });

      if (url === 'http://localhost:5001/api/health') {
        throw new Error('connect ECONNREFUSED');
      }
      if (url === 'http://localhost:5001/health') {
        return { ok: false, status: 503, text: async () => 'down' };
      }
      return { ok: false, status: 404, text: async () => 'not found' };
    };

    const available = await isAvailable({
      env: {
        MIROFISH_ENABLED: 'true',
        MIROFISH_BASE_URL: 'http://localhost:5001',
      },
    });
    assert.equal(available, false);

    const forecast = await runEntityForecast({
      entityType: 'rfp',
      entityId: 'rfp-abc',
      context: {
        signals: {
          estimated_value_max: 650000,
          requirement_count: 24,
          set_aside_type: 'small_business',
        },
      },
      env: {
        MIROFISH_ENABLED: 'true',
        MIROFISH_BASE_URL: 'http://localhost:5001',
      },
    });

    assert.equal(forecast.modelKey, 'heuristic_v0');
    assert.equal(forecast.predictionType, 'rfp.bid_probability');
    assert.equal(forecast.entityType, 'rfp');
    assert.equal(forecast.prediction.will_bid, true);
    assert.ok(Number(forecast.prediction.bid_probability) >= 0.5);
    assert.ok(calls.some((c) => c.url.endsWith('/api/health')));
    assert.ok(calls.some((c) => c.url.endsWith('/health')));
  });
});
