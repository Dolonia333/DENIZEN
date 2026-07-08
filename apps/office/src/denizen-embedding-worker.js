'use strict';

const inferenceRuntime = require('./denizen-inference-runtime');

async function embedTexts(texts = [], opts = {}) {
  const items = (Array.isArray(texts) ? texts : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  if (!items.length) return { vectors: [], model: null };

  const runtime = await inferenceRuntime.probeInferenceRuntime({ timeoutMs: 4000 });
  if (!runtime?.reachable || !runtime.url) {
    throw new Error('No inference runtime for embeddings');
  }

  const base = String(runtime.url || inferenceRuntime.defaultOllamaUrl()).replace(/\/+$/, '');
  const model = opts.model
    || process.env.OLLAMA_EMBED_MODEL
    || process.env.OLLAMA_MODEL
    || runtime.main_model
    || 'nomic-embed-text';

  const vectors = [];
  for (const prompt of items.slice(0, 32)) {
    const res = await fetch(`${base}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Embedding failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
    }
    const data = await res.json();
    const embedding = Array.isArray(data?.embedding) ? data.embedding : [];
    vectors.push({ text: prompt.slice(0, 500), dims: embedding.length, sample: embedding.slice(0, 4) });
  }

  return { vectors, model, backend: runtime.backend || 'ollama' };
}

async function runEmbeddingIndex(payload = {}) {
  const docs = Array.isArray(payload.documents) ? payload.documents : [];
  const texts = docs.map((d) => (typeof d === 'string' ? d : d?.text || d?.content || ''));
  const result = await embedTexts(texts, { model: payload.model });
  return {
    ok: true,
    jobType: 'embedding_index',
    indexed_documents: result.vectors.length,
    model: result.model,
    backend: result.backend,
    vectors: result.vectors,
    completed_at: new Date().toISOString(),
  };
}

module.exports = {
  embedTexts,
  runEmbeddingIndex,
};
