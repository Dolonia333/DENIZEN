'use strict';

const { ensureBrowserclawRunning } = require('../../services/browserclaw/ensure.cjs');

const DEFAULT_FEEDS = [
  'https://news.ycombinator.com/rss',
  'https://www.reddit.com/r/technology/.rss',
];

async function scrapeViaBrowserclaw(task, url) {
  await ensureBrowserclawRunning();
  const base = (process.env.BROWSERCLAW_URL || 'http://127.0.0.1:18792').replace(/\/$/, '');
  const res = await fetch(`${base}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, url: url || undefined }),
    signal: AbortSignal.timeout(90000),
  });
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return (data.result || data.error || text).slice(0, 4000);
  } catch (_) {
    return text.slice(0, 4000);
  }
}

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'DenizenTrendScraper/1.0' },
    });
    const text = await res.text();
    return { ok: res.ok, text, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

function parseRssItems(xml, limit = 8) {
  const items = [];
  const re = /<item[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?(?:<link>([\s\S]*?)<\/link>)?/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const title = String(m[1] || '').replace(/<[^>]+>/g, '').trim();
    const link = String(m[2] || '').replace(/<[^>]+>/g, '').trim();
    if (title) items.push({ title, link });
  }
  return items;
}

function parseRedditJson(json, limit = 8) {
  try {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const children = data?.data?.children || [];
    return children.slice(0, limit).map((c) => ({
      title: c?.data?.title || '',
      link: c?.data?.url ? `https://reddit.com${c.data.permalink || ''}` : '',
      score: c?.data?.score,
    })).filter((x) => x.title);
  } catch (_) {
    return [];
  }
}

module.exports = {
  meta: {
    name: 'trend-scraper',
    description: 'Fetch trending headlines from RSS and Reddit JSON feeds',
    mode: 'background',
    aliases: ['trends', 'rss-scraper'],
  },
  async run({ params }) {
    const sources = Array.isArray(params?.sources)
      ? params.sources
      : String(params?.sources || params?.feeds || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const list = sources.length ? sources : DEFAULT_FEEDS;
    const lines = ['# Trend scrape', ''];
    let total = 0;

    for (const url of list.slice(0, 6)) {
      lines.push(`## ${url}`);
      const isTwitter = /twitter\.com|x\.com/i.test(url);

      if (isTwitter) {
        const bcOut = await scrapeViaBrowserclaw(
          'Extract the top trending topics or timeline headlines with links. Return a bullet list.',
          url,
        );
        lines.push(bcOut || '- (browserclaw returned empty)');
        total += (bcOut.match(/^- /gm) || []).length || (bcOut ? 1 : 0);
        lines.push('');
        continue;
      }

      const { ok, text } = await fetchText(url);
      if (!ok) {
        const bcOut = await scrapeViaBrowserclaw(`Open ${url} and extract headline list as bullets`, url);
        if (bcOut) {
          lines.push(bcOut);
          total += (bcOut.match(/^- /gm) || []).length || 1;
        } else {
          lines.push('- (fetch failed)');
        }
        lines.push('');
        continue;
      }
      let items = [];
      if (url.includes('reddit.com') && url.endsWith('.json')) {
        items = parseRedditJson(text, 6);
      } else if (url.includes('reddit.com')) {
        const jsonUrl = url.replace(/\/?$/, '/.json');
        const j = await fetchText(jsonUrl);
        items = j.ok ? parseRedditJson(j.text, 6) : parseRssItems(text, 6);
      } else {
        items = parseRssItems(text, 6);
      }
      for (const item of items) {
        total += 1;
        lines.push(`- **${item.title}**${item.link ? ` — ${item.link}` : ''}${item.score != null ? ` (score ${item.score})` : ''}`);
      }
      lines.push('');
    }

    lines.push(`_Total headlines: ${total}_`);
    return {
      ok: total > 0,
      output: lines.join('\n'),
      skill: 'trend-scraper',
      inject: true,
    };
  },
};
