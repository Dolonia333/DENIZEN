'use strict';

/**
 * Cited research — structured web research with numbered sources for visitor assistants.
 */

const webResearch = require('./web-research');

const RESEARCH_INTENT_RE = /\b(research|look\s*up|find\s+out|what\s+is|who\s+is|compare|sources?|cite|investigate)\b/i;

function looksLikeResearchQuery(text) {
  return RESEARCH_INTENT_RE.test(String(text || ''));
}

function extractResearchQuery(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const stripped = raw
    .replace(/^(please\s+)?(research|look\s*up|find\s+out|investigate)\s+/i, '')
    .replace(/\b(with\s+sources?|and\s+cite)\b.*$/i, '')
    .trim();
  return (stripped || raw).slice(0, 400);
}

/**
 * Run web research and return structured citations.
 * @returns {Promise<{query, citations, summary, error?}>}
 */
async function runCitedResearch(query, opts = {}) {
  const q = String(query || '').trim().slice(0, 400);
  if (!q) return { query: q, citations: [], summary: '', error: 'empty query' };

  const result = await webResearch.research(q, {
    count: opts.count || 5,
    read: opts.read != null ? opts.read : 1,
  });

  const citations = (result.results || []).map((r, i) => ({
    index: i + 1,
    title: r.title || 'Untitled',
    url: r.url || '',
    snippet: r.snippet || '',
  }));

  const pageNotes = (result.pages || [])
    .filter((p) => p.text)
    .map((p) => `[${p.url}] ${p.text.slice(0, 600)}`)
    .join('\n');

  const lines = [`Research: "${result.query}"`];
  citations.forEach((c) => {
    lines.push(`[${c.index}] ${c.title} — ${c.url}`);
    if (c.snippet) lines.push(`    ${c.snippet}`);
  });
  if (pageNotes) lines.push('', 'Key excerpts:', pageNotes);

  return {
    query: result.query,
    citations,
    summary: lines.join('\n').slice(0, 4500),
    error: result.error || null,
    at: result.at || new Date().toISOString(),
  };
}

/** Format citations block for NPC prompt injection. */
function formatForPrompt(cited) {
  if (!cited || cited.error) {
    return cited?.error ? `Research failed: ${cited.error}` : '';
  }
  const citeLines = (cited.citations || []).map(
    (c) => `[${c.index}] ${c.title} (${c.url})`,
  );
  return [
    '## Cited Research (cite these sources in your reply as [1], [2], etc.)',
    ...citeLines,
    '',
    cited.summary || '',
  ].join('\n').slice(0, 4000);
}

/** Format citations for chat UI / Slack. */
function formatForDisplay(cited) {
  if (!cited?.citations?.length) return cited?.summary || '';
  const body = String(cited.summary || '').split('\n').slice(0, 8).join('\n');
  const sources = cited.citations
    .map((c) => `[${c.index}] ${c.title} — ${c.url}`)
    .join('\n');
  return `${body}\n\nSources:\n${sources}`;
}

module.exports = {
  looksLikeResearchQuery,
  extractResearchQuery,
  runCitedResearch,
  formatForPrompt,
  formatForDisplay,
};
