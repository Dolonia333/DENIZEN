'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dbPath = path.resolve(__dirname, '../src/denizen-db.js');
const queuePath = path.resolve(__dirname, '../src/denizen-station-task-queue.js');

function loadQueueWithMockDb(mockDb) {
  delete require.cache[queuePath];
  delete require.cache[dbPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: mockDb,
  };
  return require(queuePath);
}

describe('denizen-station-task-queue (db)', () => {
  let originalDb;

  beforeEach(() => {
    originalDb = require.cache[dbPath];
    delete require.cache[queuePath];
  });

  afterEach(() => {
    delete require.cache[queuePath];
    delete require.cache[dbPath];
    if (originalDb) require.cache[dbPath] = originalDb;
  });

  it('enqueue→claim→complete via mocked Supabase', async () => {
    const rows = new Map();
    const mockDb = {
      enabled: true,
      _get: async (query) => {
        if (query.includes('status=eq.pending')) {
          const installMatch = query.match(/install_id=eq\.([^&]+)/);
          const installId = installMatch ? decodeURIComponent(installMatch[1]) : null;
          const pending = [...rows.values()].find(
            (row) => row.install_id === installId && row.status === 'pending',
          );
          return pending ? [pending] : [];
        }
        if (query.includes('id=eq.')) {
          const idMatch = query.match(/id=eq\.([^&]+)/);
          const id = idMatch ? decodeURIComponent(idMatch[1]) : null;
          const row = rows.get(id);
          return row ? [row] : [];
        }
        return [];
      },
      _post: async (_table, row) => {
        rows.set(row.id, { ...row });
      },
      _patch: async (query, patch) => {
        const idMatch = query.match(/id=eq\.([^&]+)/);
        const id = idMatch ? decodeURIComponent(idMatch[1]) : null;
        if (!id || !rows.has(id)) return [];
        const next = { ...rows.get(id), ...patch };
        rows.set(id, next);
        return [next];
      },
    };

    const queue = loadQueueWithMockDb(mockDb);
    const enqueued = await queue.enqueueTask({
      sessionId: 'sess-db-1',
      installId: 'install-db-1',
      kind: 'run_code',
      instruction: 'node -e "console.log(1)"',
    });
    assert.equal(enqueued.queued, true);

    const claimed = await queue.claimTask('install-db-1');
    assert.equal(claimed.status, 'claimed');

    const waitPromise = queue.waitForTask(enqueued.task.id, { timeoutMs: 3000 });
    await queue.completeTask(enqueued.task.id, { ok: true, summary: 'ran' });
    const done = await waitPromise;
    assert.equal(done.result.summary, 'ran');
  });
});
