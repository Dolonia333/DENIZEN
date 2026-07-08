'use strict';

const DEFAULT_BASE_URL = process.env.DENIZEN_LOCALHOST_URL
  || `http://127.0.0.1:${process.env.PORT || 8081}`;
const DEFAULT_POLL_MS = 5000;

let _worker = null;
let _processJobLocalImpl = null;

function _defaultProcessJobLocally() {
  if (_processJobLocalImpl) return _processJobLocalImpl;
  try {
    const { processMeshJob } = require('./denizen-mesh-job-runner');
    _processJobLocalImpl = async (job, ctx = {}) => {
      const jobType = String(job?.job_type || job?.jobType || '').trim();
      const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
      const onProgress = typeof ctx.onProgress === 'function' ? ctx.onProgress : null;
      return processMeshJob(jobType, payload, {
        onProgress: onProgress
          ? (ev) => onProgress({ jobId: job?.id, ...(ev || {}) })
          : null,
      });
    };
  } catch (_) {
    _processJobLocalImpl = async (job) => ({
      ok: false,
      error: 'processJobLocally not implemented',
      jobId: job?.id || null,
    });
  }
  return _processJobLocalImpl;
}

function _sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, Math.max(0, Number(ms) || 0));
    if (!signal) return;
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

async function processJobLocally(job, ctx = {}) {
  const impl = _processJobLocalImpl || _defaultProcessJobLocally();
  return impl(job, ctx);
}

function setProcessJobLocally(fn) {
  if (typeof fn !== 'function') {
    throw new Error('setProcessJobLocally requires a function');
  }
  _processJobLocalImpl = fn;
}

async function _postComplete(baseUrl, payload, signal) {
  const res = await fetch(`${baseUrl}/api/compute/node/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`complete failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function _claimJob(baseUrl, identityId, nodeToken, signal) {
  const res = await fetch(`${baseUrl}/api/compute/node/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityId, nodeToken }),
    signal,
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`claim failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const payload = await res.json().catch(() => ({}));
  if (!payload) return null;
  return payload.job || payload;
}

async function _postProgress(baseUrl, payload, signal) {
  const res = await fetch(`${baseUrl}/api/compute/node/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`progress failed (${res.status}): ${text.slice(0, 120)}`);
  }
}

async function _runWorkerLoop(state) {
  const { identityId, nodeToken, pollIntervalMs, baseUrl, signal } = state;
  while (!signal.aborted) {
    let job = null;
    try {
      job = await _claimJob(baseUrl, identityId, nodeToken, signal);
    } catch (err) {
      state.lastError = err?.message || String(err);
      await _sleep(pollIntervalMs, signal);
      continue;
    }

    if (!job || !job.id) {
      await _sleep(pollIntervalMs, signal);
      continue;
    }

    try {
      const result = await processJobLocally(job, {
        identityId,
        nodeToken,
        signal,
        baseUrl,
        onProgress: (ev) => {
          const delta = ev?.delta || '';
          const text = ev?.partial && delta ? null : (ev?.text || null);
          return _postProgress(baseUrl, {
            identityId,
            nodeToken,
            jobId: job.id,
            delta,
            text,
          }, signal).catch(() => null);
        },
      });
      await _postComplete(baseUrl, {
        identityId,
        nodeToken,
        jobId: job.id,
        ok: true,
        result,
      }, signal);
      state.lastCompletedJobId = job.id;
      state.lastCompletedAt = Date.now();
    } catch (err) {
      const errMsg = err?.message || String(err);
      state.lastError = errMsg;
      try {
        await _postComplete(baseUrl, {
          identityId,
          nodeToken,
          jobId: job.id,
          ok: false,
          error: errMsg,
        }, signal);
      } catch (completeErr) {
        state.lastError = completeErr?.message || String(completeErr);
      }
    }

    await _sleep(0, signal);
  }
}

function startWorkerLoop(opts = {}) {
  if (_worker && _worker.running) {
    return {
      ok: true,
      alreadyRunning: true,
      startedAt: _worker.startedAt,
      baseUrl: _worker.baseUrl,
      pollIntervalMs: _worker.pollIntervalMs,
    };
  }

  const identityId = String(opts.identityId || '').trim();
  const nodeToken = String(opts.nodeToken || '').trim();
  if (!identityId) throw new Error('startWorkerLoop requires identityId');
  if (!nodeToken) throw new Error('startWorkerLoop requires nodeToken');
  if (typeof opts.processJobLocally === 'function') setProcessJobLocally(opts.processJobLocally);

  const pollIntervalMs = Math.max(500, Number(opts.pollIntervalMs) || DEFAULT_POLL_MS);
  const baseUrl = String(opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const controller = new AbortController();

  _worker = {
    running: true,
    identityId,
    nodeToken,
    pollIntervalMs,
    baseUrl,
    startedAt: Date.now(),
    signal: controller.signal,
    stop() {
      if (!this.running) return;
      this.running = false;
      controller.abort();
    },
  };

  _runWorkerLoop(_worker)
    .catch((err) => {
      if (_worker) _worker.lastError = err?.message || String(err);
    })
    .finally(() => {
      if (_worker) _worker.running = false;
    });

  return {
    ok: true,
    running: true,
    startedAt: _worker.startedAt,
    baseUrl,
    pollIntervalMs,
  };
}

function stopWorkerLoop() {
  if (!_worker) return { ok: true, running: false };
  _worker.stop();
  return { ok: true, running: false, stoppedAt: Date.now() };
}

function getWorkerStatus() {
  if (!_worker) return { running: false };
  return {
    running: !!_worker.running,
    startedAt: _worker.startedAt || null,
    baseUrl: _worker.baseUrl,
    pollIntervalMs: _worker.pollIntervalMs,
    lastCompletedJobId: _worker.lastCompletedJobId || null,
    lastCompletedAt: _worker.lastCompletedAt || null,
    lastError: _worker.lastError || null,
  };
}

module.exports = {
  startWorkerLoop,
  stopWorkerLoop,
  getWorkerStatus,
  processJobLocally,
  setProcessJobLocally,
  _DEFAULT_BASE_URL: DEFAULT_BASE_URL,
};
