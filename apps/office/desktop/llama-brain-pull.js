'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');

function userModelsDir() {
  try {
    const { app } = require('electron');
    if (app?.getPath) {
      return path.join(app.getPath('userData'), 'llama-models');
    }
  } catch (_) {}
  return path.join(__dirname, 'resources', 'llama', 'models');
}

function resolveCatalogEntry(catalog, modelId) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  return models.find((m) => m.id === modelId) || null;
}

function downloadUrlToFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = proto.get(url, { headers: { 'User-Agent': 'DenizenDesktop/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlink(dest, () => {});
        return resolve(downloadUrlToFile(res.headers.location, dest, onProgress));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length']) || 0;
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0 && onProgress) {
          onProgress({ received, total, percent: Math.min(99, Math.round((received / total) * 100)) });
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    });
    req.on('error', reject);
  });
}

async function pullGgufModel(opts = {}) {
  const modelId = String(opts.model || '').trim();
  const catalog = opts.catalog || { models: [] };
  const entry = resolveCatalogEntry(catalog, modelId);
  if (!entry?.gguf_url || !entry?.filename) {
    return { ok: false, error: 'catalog entry missing gguf_url/filename' };
  }

  const dir = userModelsDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, entry.filename);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024 * 1024) {
    return { ok: true, model: modelId, path: dest, cached: true };
  }

  const partial = `${dest}.part`;
  try {
    await downloadUrlToFile(entry.gguf_url, partial, opts.onProgress);
    fs.renameSync(partial, dest);
    return { ok: true, model: modelId, path: dest, filename: entry.filename };
  } catch (err) {
    try { fs.unlinkSync(partial); } catch (_) {}
    return { ok: false, error: err?.message || String(err), model: modelId };
  }
}

module.exports = {
  userModelsDir,
  resolveCatalogEntry,
  pullGgufModel,
};
