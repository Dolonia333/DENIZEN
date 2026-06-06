'use strict';

const fs = require('node:fs');
const path = require('node:path');
const webResearch = require('./web-research');

const ROOT = path.resolve(__dirname, '..');
const REPORTS_DIR = process.env.RESEARCH_REPORTS_DIR
  ? path.resolve(process.env.RESEARCH_REPORTS_DIR)
  : path.join(ROOT, 'reports', 'research');

function _slug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'topic';
}

function _todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function _buildSummaryPrompt(topic, results, pages) {
  const sourceList = (results || [])
    .slice(0, 5)
    .map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n${r.snippet}`)
    .join('\n\n');

  const pageContext = (pages || [])
    .slice(0, 2)
    .map((p, i) => `Page ${i + 1}: ${p.url}\n${String(p.text || '').slice(0, 1400)}`)
    .join('\n\n');

  return [
    `Create a concise CEO research brief for this topic: ${topic}`,
    'Output markdown-ready text with these sections:',
    '- Executive summary (3 bullets)',
    '- Key facts (5 bullets)',
    '- Risks / unknowns (3 bullets)',
    '- Recommended next actions (3 bullets)',
    '',
    `Sources:\n${sourceList || 'No search snippets available.'}`,
    '',
    `Read page excerpts:\n${pageContext || 'No page excerpts available.'}`,
    '',
    'Keep factual and avoid speculation.',
  ].join('\n');
}

function formatBriefMarkdown({ topic, results, pages, summary }) {
  const generatedAt = new Date().toISOString();
  const safeTopic = String(topic || '').trim() || 'Untitled Topic';
  const items = Array.isArray(results) ? results : [];
  const readPages = Array.isArray(pages) ? pages : [];

  const lines = [
    `# Research Brief: ${safeTopic}`,
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Executive Summary',
    summary ? String(summary).trim() : 'No LLM summary provided.',
    '',
    '## Search Results',
  ];

  if (!items.length) {
    lines.push('- No search results found.');
  } else {
    items.forEach((r, i) => {
      lines.push(`${i + 1}. **${r.title || 'Untitled'}**`);
      lines.push(`   - URL: ${r.url || ''}`);
      lines.push(`   - Snippet: ${(r.snippet || '').trim() || 'n/a'}`);
    });
  }

  lines.push('');
  lines.push('## Read Pages');
  if (!readPages.length) {
    lines.push('- No pages were read.');
  } else {
    readPages.forEach((p, i) => {
      lines.push(`### Page ${i + 1}: ${p.title || p.url || 'Untitled page'}`);
      lines.push(`- URL: ${p.url || ''}`);
      if (p.error) lines.push(`- Error: ${p.error}`);
      const text = String(p.text || '').trim();
      lines.push('');
      lines.push('```text');
      lines.push(text ? text.slice(0, 2000) : '[No extracted text]');
      lines.push('```');
      lines.push('');
    });
  }

  return lines.join('\n');
}

async function writeBrief({ topic, searchResults, pages, npcBrains } = {}) {
  const safeTopic = String(topic || '').trim();
  if (!safeTopic) throw new Error('topic is required');

  let summary = '';
  if (npcBrains?.getResponse) {
    const prompt = _buildSummaryPrompt(safeTopic, searchResults, pages);
    try {
      summary = await npcBrains.getResponse('Lucy', 'CEO', prompt, { kind: 'research-brief' });
    } catch (_) {
      summary = '';
    }
  }

  const markdown = formatBriefMarkdown({
    topic: safeTopic,
    results: searchResults || [],
    pages: pages || [],
    summary: String(summary || '').trim(),
  });

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const filename = `lucy_${_slug(safeTopic)}_${_todayDate()}.md`;
  const filePath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filePath, markdown, 'utf8');

  return {
    topic: safeTopic,
    filePath,
    summary: String(summary || '').trim(),
    results: searchResults || [],
    pages: pages || [],
  };
}

async function runFullResearch(topic, { count = 5, read = 2, npcBrains } = {}) {
  const safeTopic = String(topic || '').trim();
  if (!safeTopic) throw new Error('topic is required');

  const safeCount = Math.max(1, Math.min(10, Number(count) || 5));
  const safeRead = Math.max(0, Math.min(3, Number(read) || 0));

  const search = await webResearch.search(safeTopic, safeCount);
  const results = Array.isArray(search.results) ? search.results : [];

  const pages = [];
  for (const item of results.slice(0, safeRead)) {
    const page = await webResearch.fetchPage(item.url);
    pages.push({
      title: item.title || '',
      url: item.url || '',
      text: page.text || '',
      error: page.error || null,
    });
  }

  const brief = await writeBrief({
    topic: safeTopic,
    searchResults: results,
    pages,
    npcBrains,
  });

  return {
    topic: safeTopic,
    results,
    pages,
    summary: brief.summary,
    filePath: brief.filePath,
    error: search.error || null,
  };
}

module.exports = {
  REPORTS_DIR,
  formatBriefMarkdown,
  writeBrief,
  runFullResearch,
};
