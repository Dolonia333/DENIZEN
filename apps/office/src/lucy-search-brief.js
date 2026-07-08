/**
 * Plain-English search briefs for Lucy (executive secretary voice).
 * Rule-based fallback + optional fast-model polish.
 * When readPages are present, Lucy summarizes what she actually read — not just SERP titles.
 */

const JUNK_QUERY = /^(?:search(?:\s+up)?|google|look\s*up|on\s+the\s+web|the\s+web|web|for|please)$/i;

function isJunkSearchQuery(query) {
  const q = String(query || '').trim();
  return !q || JUNK_QUERY.test(q) || /^(?:the\s+)?web$/i.test(q);
}

function topicHint(query, results) {
  const blob = `${query} ${(results[0]?.title || '')}`.toLowerCase();
  if (/dog|breed|puppy|goldendoodle|pet/i.test(blob)) {
    return 'Mostly breed guides, care tips, and where people find puppies.';
  }
  if (/taki|snack|chip|spicy/i.test(blob)) {
    return 'Mostly product pages, flavors, and where to buy them.';
  }
  if (/job|career|hiring|indeed|linkedin/i.test(blob)) {
    return 'Mostly job boards and role listings.';
  }
  return 'A mix of overview pages — good starting points if you want the basics.';
}

function shortenTitle(title, max = 72) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

function firstSentences(text, maxChars = 320) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const chunk = t.slice(0, maxChars);
  const end = Math.max(chunk.lastIndexOf('. '), chunk.lastIndexOf('! '), chunk.lastIndexOf('? '));
  return (end > 80 ? chunk.slice(0, end + 1) : chunk).trim();
}

function normalizeReadPages(opts = {}) {
  const raw = opts.readPages || opts.pages || [];
  return (Array.isArray(raw) ? raw : [])
    .map((p) => ({
      title: String(p?.title || '').trim(),
      url: String(p?.url || '').trim(),
      text: String(p?.text || '').trim(),
    }))
    .filter((p) => p.text.length > 40);
}

/** Secretary-style summary without an LLM. */
function buildRuleBasedBrief(query, results = [], opts = {}) {
  const q = String(query || '').trim();
  const stays = opts.staysOpenMsg || '';
  const pages = normalizeReadPages(opts);

  if (!results.length && !pages.length) {
    return `I looked for "${q}" but didn't get useful hits. Want me to try different words?${stays}`;
  }

  if (pages.length) {
    const page = pages[0];
    const host = hostOf(page.url);
    const excerpt = firstSentences(page.text, 400);
    const next = results[1] ? ` I also saw "${shortenTitle(results[1].title, 50)}" in the results if you want a second source.` : '';
    return [
      `I searched "${q}" and read ${host || 'the top page'}:`,
      '',
      excerpt || shortenTitle(page.title),
      '',
      `Want me to dig into a specific angle, or open the next result?${next}`,
    ].join('\n') + stays;
  }

  const lead = shortenTitle(results[0].title);
  const leadHost = hostOf(results[0].url);
  const second = results[1] ? shortenTitle(results[1].title, 56) : '';

  let body;
  if (results.length === 1) {
    body = `Best match: "${lead}"${leadHost ? ` on ${leadHost}` : ''}.`;
  } else {
    body = [
      `Headline: "${lead}"${leadHost ? ` (${leadHost})` : ''}.`,
      second ? `Also worth a look: "${second}".` : '',
      topicHint(q, results),
    ].filter(Boolean).join(' ');
  }

  return [
    `Quick brief on ${q}:`,
    '',
    body,
    '',
    'Say "tell me more" if you want me to read the page and dig deeper.',
  ].join('\n') + stays;
}

/**
 * Prefer a short LLM summary (Gemma fast); fall back to rule-based.
 * @param {import('./npc-brains')} npcBrains
 */
async function buildLucySearchBrief(npcBrains, query, results = [], opts = {}) {
  const rule = buildRuleBasedBrief(query, results, opts);
  const pages = normalizeReadPages(opts);
  const fast = npcBrains?.providers?.['lmstudio-fast'] || npcBrains?.providers?.lmstudio;
  if (!fast || (!results.length && !pages.length) || typeof npcBrains._callProvider !== 'function') {
    return rule;
  }

  const lines = results.slice(0, 5).map((r, i) => {
    const h = hostOf(r.url);
    const snip = r.snippet ? ` — ${String(r.snippet).slice(0, 120)}` : '';
    return `${i + 1}. ${shortenTitle(r.title, 90)}${h ? ` (${h})` : ''}${snip}`;
  }).join('\n');

  const pageBlock = pages.slice(0, 2).map((p, i) => {
    const h = hostOf(p.url);
    return `Page Lucy read (${i + 1}) — ${p.title || h || p.url}:\n${p.text.slice(0, 2800)}`;
  }).join('\n\n');

  const hasPageRead = pages.length > 0;
  const system = [
    'You are Lucy, Zion\'s executive secretary doing live web research.',
    hasPageRead
      ? 'You opened the top result in a real browser and READ the page. Summarize what you learned from the actual page text — not just search titles.'
      : 'Write a plain-English brief of web search results.',
    'Sound warm and human — not a robot, not a bullet dump of URLs.',
    'Lead with the most useful takeaway for the CEO.',
    hasPageRead
      ? 'End with 1–2 concrete next steps: what to search next, what to open, or what question still needs answering.'
      : 'End by offering to dig deeper.',
    'Do not list numbered URLs. No markdown headers. 4–6 sentences max.',
  ].join(' ');

  const userParts = [`The CEO asked about: "${query}"`];
  if (lines) userParts.push(`\nSearch hits:\n${lines}`);
  if (pageBlock) userParts.push(`\n${pageBlock}`);
  userParts.push(hasPageRead
    ? '\nSummarize what the page actually says and where to go next for more research.'
    : '\nSummarize in layman\'s terms.');

  try {
    const text = await npcBrains._callProvider(
      fast,
      system,
      [{ role: 'user', content: userParts.join('') }],
      {
        maxTokens: hasPageRead ? 380 : 200,
        sliceLen: hasPageRead ? 1200 : 700,
        temperature: 0.65,
        npc: 'Lucy',
        kind: 'search-brief',
      },
    );
    const polished = String(text || '').trim();
    if (polished.length > 50) {
      const tail = opts.staysOpenMsg || '';
      const offer = hasPageRead || /\b(more|deeper|next|follow|links)\b/i.test(polished)
        ? ''
        : '\n\nSay "tell me more" or "read the page" if you want me to dig deeper.';
      return `${polished}${offer}${tail}`;
    }
  } catch (_) {}

  return rule;
}

module.exports = {
  isJunkSearchQuery,
  buildRuleBasedBrief,
  buildLucySearchBrief,
  normalizeReadPages,
  firstSentences,
};
