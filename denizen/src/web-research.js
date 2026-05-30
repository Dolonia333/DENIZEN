'use strict';
/**
 * web-research.js — real web research for NPCs.
 *
 * Lets an NPC actually look things up instead of guessing: a Brave web search
 * (key read server-side from openclaw.json) plus an optional fetch-and-clean of
 * the top result so the NPC gets real page text, not just snippets. The result
 * is injected back into the NPC's next think cycle (via injectSkillResult), so
 * they REASON over what they found — the whole point of "look it up and use it".
 *
 * Used for: solving real problems, "figure out how to do X", and comparing
 * broken work against how a working reference does it.
 *
 * Safety: only http/https; blocks localhost/private-IP hosts (SSRF guard);
 * timeouts + size caps; HTML stripped to plain text. Read-only — never posts.
 */

const fs    = require('node:fs');
const path  = require('node:path');
const https = require('node:https');
const http  = require('node:http');

const TIMEOUT_MS = 10000;
const MAX_PAGE_BYTES = 600 * 1024;   // don't slurp huge pages
const MAX_TEXT_CHARS = 4000;          // readable text returned per page

let _braveKey = null;
function braveKey() {
  if (_braveKey !== null) return _braveKey;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || process.env.HOME || '', '.openclaw', 'openclaw.json'), 'utf-8'));
    _braveKey = cfg?.tools?.web?.search?.apiKey || '';
  } catch (_) { _braveKey = ''; }
  return _braveKey;
}

// ── SSRF guard: refuse internal/loopback hosts ───────────────────────────────
function isBlockedHost(hostname) {
  const h = (hostname || '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv4 private / link-local / loopback ranges
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '0.0.0.0') return true;
  return false;
}

// ── Brave web search ─────────────────────────────────────────────────────────

/**
 * @returns {Promise<{query, results:[{title,url,snippet}], error?}>}
 */
function search(query, count = 5) {
  const key = braveKey();
  const q = String(query || '').slice(0, 400).trim();
  if (!q) return Promise.resolve({ query: q, results: [], error: 'empty query' });
  if (!key) return Promise.resolve({ query: q, results: [], error: 'no Brave search key in openclaw.json (tools.web.search.apiKey)' });

  return new Promise((resolve) => {
    const reqPath = `/res/v1/web/search?q=${encodeURIComponent(q)}&count=${Math.max(1, Math.min(10, count))}`;
    const req = https.request({
      hostname: 'api.search.brave.com', port: 443, path: reqPath, method: 'GET',
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': key },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const items = (j.web && j.web.results) || [];
          resolve({
            query: q,
            results: items.slice(0, count).map(r => ({
              title: r.title || '',
              url: r.url || '',
              snippet: (r.description || '').replace(/<[^>]+>/g, '').slice(0, 300),
            })),
          });
        } catch (e) {
          resolve({ query: q, results: [], error: `parse error (HTTP ${res.statusCode})` });
        }
      });
    });
    req.on('error', (e) => resolve({ query: q, results: [], error: e.message }));
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('search timeout')));
    req.end();
  });
}

// ── Fetch + clean a page ──────────────────────────────────────────────────────

function fetchPage(url) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (_) { return resolve({ url, text: '', error: 'bad url' }); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return resolve({ url, text: '', error: 'non-http url' });
    if (isBlockedHost(u.hostname)) return resolve({ url, text: '', error: 'blocked host (internal/loopback)' });

    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Denizen research)', 'Accept': 'text/html,*/*' },
    }, (res) => {
      // Follow one redirect to a safe host.
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        try {
          const next = new URL(res.headers.location, u);
          if (!isBlockedHost(next.hostname)) return fetchPage(next.toString()).then(resolve);
        } catch (_) {}
        return resolve({ url, text: '', error: 'redirect blocked' });
      }
      let data = '', bytes = 0, aborted = false;
      res.on('data', c => {
        bytes += c.length;
        if (bytes > MAX_PAGE_BYTES) { aborted = true; req.destroy(); return; }
        data += c;
      });
      res.on('end', () => resolve({ url, text: htmlToText(data), truncated: aborted }));
    });
    req.on('error', (e) => resolve({ url, text: '', error: e.message }));
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('fetch timeout')));
    req.end();
  });
}

/** Crude but effective HTML → readable text. */
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

// ── High-level research ───────────────────────────────────────────────────────

/**
 * Search, and optionally read the top result(s) for real content.
 * @param {string} query
 * @param {object} opts { count, read } — read = how many top results to fetch (0-2)
 * @returns {Promise<object>} { query, results, pages, at, error? }
 */
async function research(query, opts = {}) {
  const count = Math.max(1, Math.min(8, opts.count || 5));
  const read  = Math.max(0, Math.min(2, opts.read != null ? opts.read : 1));
  const s = await search(query, count);
  const pages = [];
  if (read > 0 && s.results.length) {
    const top = s.results.slice(0, read);
    for (const r of top) {
      const p = await fetchPage(r.url);
      pages.push({ title: r.title, url: r.url, text: p.text || '', error: p.error || null });
    }
  }
  return { query: s.query, results: s.results, pages, at: new Date().toISOString(), error: s.error || null };
}

/**
 * Format a research result as compact text to inject into an NPC's think
 * prompt — sources + snippets + (if read) the top page's key text.
 */
function formatForNpc(r) {
  if (r.error && !r.results.length) return `Research for "${r.query}" failed: ${r.error}`;
  const lines = [`Research results for "${r.query}":`];
  r.results.forEach((x, i) => lines.push(`${i + 1}. ${x.title} — ${x.url}\n   ${x.snippet}`));
  if (r.pages && r.pages.length) {
    for (const p of r.pages) {
      if (p.text) lines.push(`\nFrom ${p.url}:\n${p.text.slice(0, 1500)}`);
    }
  }
  return lines.join('\n').slice(0, 4000);
}

module.exports = { search, fetchPage, research, formatForNpc, htmlToText, isBlockedHost };
