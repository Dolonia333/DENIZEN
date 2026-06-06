'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

describe('roki trading spine — denizen-db methods', () => {
  let calls;
  let denizenDb;

  beforeEach(() => {
    calls = [];
    delete require.cache[require.resolve('../src/denizen-db.js')];
    denizenDb = require('../src/denizen-db.js');
    denizenDb.enabled = true;
    denizenDb.orgId = 'be6080e8-638a-495a-b05d-2d90cd1b838f';
    denizenDb.url = 'http://127.0.0.1:54321';
    denizenDb.key = 'test-key';

    global.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, method, body });
      if (url.includes('denizen_watchlist_symbols') && method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{ symbol: 'NVDA' }, { symbol: 'AAPL' }],
        };
      }
      if (url.includes('denizen_trade_suggestions') && method === 'GET') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => [{ symbol: 'TSLA', status: 'pending' }],
        };
      }
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => [],
      };
    };
  });

  afterEach(() => {
    delete global.fetch;
  });

  async function flushDbQueue() {
    for (let i = 0; i < 30; i++) {
      await denizenDb._drain();
      if (!denizenDb._queue.length && !denizenDb._draining) break;
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  it('syncWatchlistSymbol upserts symbol and removes when requested', async () => {
    denizenDb.syncWatchlistSymbol('nvda', { npcKey: 'roki' });
    denizenDb.syncWatchlistSymbol('nvda', { npcKey: 'roki', remove: true });
    await flushDbQueue();

    const post = calls.find(
      (c) => c.method === 'POST' && c.url.includes('denizen_watchlist_symbols?on_conflict=org_id,symbol'),
    );
    assert.ok(post, 'watchlist upsert uses on_conflict');
    assert.equal(post.body.org_id, denizenDb.orgId);
    assert.equal(post.body.npc_key, 'roki');
    assert.equal(post.body.symbol, 'NVDA');

    const del = calls.find((c) => c.method === 'DELETE' && c.url.includes('denizen_watchlist_symbols?'));
    assert.ok(del, 'watchlist delete executed');
  });

  it('upsertTradeSuggestion stores pending status and roki npc key', async () => {
    denizenDb.upsertTradeSuggestion({
      symbol: 'tsla',
      action: 'buy',
      rationale: 'momentum continuation',
      status: 'suggested',
      at: '2026-06-06T12:00:00.000Z',
    });
    await flushDbQueue();

    const post = calls.find((c) => c.method === 'POST' && c.url.includes('denizen_trade_suggestions'));
    assert.ok(post, 'trade suggestion inserted');
    assert.equal(post.body.org_id, denizenDb.orgId);
    assert.equal(post.body.npc_key, 'roki');
    assert.equal(post.body.symbol, 'TSLA');
    assert.equal(post.body.status, 'pending');
  });

  it('listTradeSuggestions and getWatchlist return scoped rows', async () => {
    const suggestions = await denizenDb.listTradeSuggestions({ status: 'suggested', limit: 10 });
    const watchlist = await denizenDb.getWatchlist({ limit: 10 });

    assert.equal(Array.isArray(suggestions), true);
    assert.equal(suggestions[0].symbol, 'TSLA');
    assert.equal(watchlist.join(','), 'NVDA,AAPL');

    const listCall = calls.find(
      (c) => c.method === 'GET' && c.url.includes('denizen_trade_suggestions?select='),
    );
    assert.ok(listCall.url.includes('status=eq.pending'), 'status mapped to pending for API filter');
  });
});

describe('roki trading spine — robinhood dual write', () => {
  const mcpPath = require.resolve('../src/robinhood-mcp.js');
  const dbPath = require.resolve('../src/denizen-db.js');

  let originalRead;
  let originalWrite;
  let originalMkdir;
  let memoryFiles;
  let mockDbCalls;

  beforeEach(() => {
    memoryFiles = {};
    mockDbCalls = [];

    originalRead = fs.readFileSync;
    originalWrite = fs.writeFileSync;
    originalMkdir = fs.mkdirSync;

    fs.readFileSync = (filePath, enc) => {
      const key = path.resolve(String(filePath));
      if (key in memoryFiles) return memoryFiles[key];
      if (key.endsWith(path.join('data', 'roki-watchlist.json')) || key.endsWith(path.join('data', 'trade-suggestions.json'))) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return originalRead(filePath, enc);
    };
    fs.writeFileSync = (filePath, data) => {
      memoryFiles[path.resolve(String(filePath))] = String(data);
    };
    fs.mkdirSync = () => {};

    delete require.cache[mcpPath];
    delete require.cache[dbPath];
    const db = require('../src/denizen-db.js');
    db.upsertTradeSuggestion = (payload) => mockDbCalls.push({ type: 'suggestion', payload });
    db.syncWatchlistSymbol = (symbol, opts) => mockDbCalls.push({ type: 'watchlist', symbol, opts });
  });

  afterEach(() => {
    fs.readFileSync = originalRead;
    fs.writeFileSync = originalWrite;
    fs.mkdirSync = originalMkdir;
    delete require.cache[mcpPath];
  });

  it('createSuggestion writes JSON and denizen-db suggestion row', () => {
    const robinhoodMcp = require('../src/robinhood-mcp.js');
    const suggestion = robinhoodMcp.createSuggestion({
      npc: 'Roki',
      symbol: 'msft',
      action: 'buy',
      rationale: 'breakout and earnings momentum',
    });

    assert.equal(suggestion.symbol, 'MSFT');
    const call = mockDbCalls.find((c) => c.type === 'suggestion');
    assert.ok(call, 'db suggestion write called');
    assert.equal(call.payload.npc_key, 'roki');
    assert.equal(call.payload.status, 'pending');

    const wroteJson = Object.keys(memoryFiles).some((p) => p.endsWith(path.join('data', 'trade-suggestions.json')));
    assert.equal(wroteJson, true);
  });

  it('add/remove watchlist syncs denizen-db while keeping JSON writes', () => {
    const robinhoodMcp = require('../src/robinhood-mcp.js');
    robinhoodMcp.addToWatchlist('shop');
    robinhoodMcp.removeFromWatchlist('shop');

    const watchCalls = mockDbCalls.filter((c) => c.type === 'watchlist');
    assert.equal(watchCalls.length, 2);
    assert.equal(watchCalls[0].symbol, 'SHOP');
    assert.equal(Boolean(watchCalls[1].opts?.remove), true);
  });

  it('exports auth connect URL helper and seeds default watchlist when DB is empty', async () => {
    const robinhoodMcp = require('../src/robinhood-mcp.js');
    const db = require('../src/denizen-db.js');

    const synced = [];
    db.enabled = true;
    db.orgId = 'org-test';
    db.getWatchlist = async () => [];
    db.syncWatchlistSymbol = (symbol, opts) => synced.push({ symbol, opts });
    db._drain = async () => {};

    const authUrl = robinhoodMcp.getAuthConnectUrl('http://127.0.0.1:8080/');
    assert.equal(authUrl, 'http://127.0.0.1:8080/api/market/auth/connect');

    const seeded = await robinhoodMcp.seedDefaultWatchlistInDbIfEmpty({ npcKey: 'roki' });
    assert.equal(seeded.ok, true);
    assert.equal(seeded.seeded, true);
    assert.deepEqual(
      synced.map((entry) => entry.symbol),
      robinhoodMcp.DEFAULT_WATCHLIST,
    );
  });

  it('does not seed default watchlist when DB already has symbols', async () => {
    const robinhoodMcp = require('../src/robinhood-mcp.js');
    const db = require('../src/denizen-db.js');

    let syncCalls = 0;
    db.enabled = true;
    db.orgId = 'org-test';
    db.getWatchlist = async () => ['AAPL'];
    db.syncWatchlistSymbol = () => { syncCalls += 1; };

    const seeded = await robinhoodMcp.seedDefaultWatchlistInDbIfEmpty({ npcKey: 'roki' });
    assert.equal(seeded.ok, true);
    assert.equal(seeded.seeded, false);
    assert.equal(syncCalls, 0);
  });
});

describe('roki trading spine — migration markers', () => {
  it('migration 000014 defines watchlist + suggestions + policies', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../supabase/migrations/20260606000014_roki_trading_spine.sql'),
      'utf8',
    );
    assert.match(sql, /create table if not exists public\.denizen_watchlist_symbols/);
    assert.match(sql, /unique \(org_id, symbol\)/);
    assert.match(sql, /create table if not exists public\.denizen_trade_suggestions/);
    assert.match(sql, /status in \('pending', 'dismissed', 'acted'\)/);
    assert.match(sql, /denizen_user_can_access_org\(org_id\)/);
    assert.match(sql, /denizen_trg_trade_suggestions/);
  });
});
