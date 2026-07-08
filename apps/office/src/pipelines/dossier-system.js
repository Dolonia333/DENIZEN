'use strict';

/**
 * Branded dossier pipeline — canon: docs/BRANDED_DOSSIER_SYSTEM.md
 * Assembles token-driven HTML, honesty pass, PDF render, approval-gated proposals.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);
const approvalsScope = require('../compute/denizen-approvals-scope');

const projectRoot = path.resolve(__dirname, '..');
const DOSSIER_DIR = path.join(projectRoot, 'reports', 'dossiers');
const SKINS_DIR = path.join(projectRoot, 'data', 'dossier-skins');
const CANON_DIR = path.join(projectRoot, 'data', 'canonical');
const SPEC_PATH = path.join(projectRoot, 'docs', 'BRANDED_DOSSIER_SYSTEM.md');
const PDF_SCRIPT = path.join(projectRoot, 'jelly', 'vendor', 'skills', 'pdf-generator', 'pdf-generator.mjs');

const DOCUMENT_TYPES = {
  'technical-dossier': {
    defaultReader: 'engineer',
    defaultSkin: 'denizen',
    defaultSubject: 'denizen',
    sections: ['cover', 'orientation', 'body', 'evidence', 'fit', 'ask', 'appendices', 'footer'],
  },
  'partnership-dossier': {
    defaultReader: 'partner',
    defaultSkin: '1921',
    defaultSubject: '1921',
    sections: ['cover', 'orientation', 'body', 'evidence', 'fit', 'ask', 'appendices', 'footer'],
  },
  'investor-deck': {
    defaultReader: 'investor',
    defaultSkin: 'denizen',
    defaultSubject: 'denizen',
    sections: ['cover', 'orientation', 'body', 'evidence', 'ask', 'footer'],
  },
  'client-capability': {
    defaultReader: 'client',
    defaultSkin: 'rsmg',
    defaultSubject: '1921',
    sections: ['cover', 'body', 'evidence', 'fit', 'ask', 'footer'],
  },
  'capability-statement': {
    defaultReader: 'gov buyer',
    defaultSkin: '1921',
    defaultSubject: '1921',
    sections: ['cover', 'body', 'evidence', 'appendices', 'footer'],
  },
};

const READER_CUTS = {
  investor: ['appendices'],
  engineer: ['fit'],
  partner: [],
  client: ['appendices'],
  'gov buyer': ['orientation', 'fit', 'ask'],
};

const PROPOSALS_FILE = path.join(projectRoot, 'data', 'dossier-proposals.json');

const _proposals = new Map();

function loadProposalStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(PROPOSALS_FILE, 'utf8'));
    let migrated = false;
    for (const p of raw.proposals || []) {
      if (!p?.id) continue;
      const m = migrateProposalPaths(p);
      if (m.outDirRel && !p.outDirRel) migrated = true;
      _proposals.set(p.id, m);
    }
    if (migrated) saveProposalStore();
  } catch (_) { /* first run */ }
}

function toRelPosix(absOrRel) {
  if (!absOrRel) return '';
  const norm = String(absOrRel).replace(/\\/g, '/');
  const root = projectRoot.replace(/\\/g, '/');
  if (norm.startsWith(root + '/')) {
    return norm.slice(root.length + 1);
  }
  const marker = 'reports/dossiers/';
  const idx = norm.indexOf(marker);
  if (idx >= 0) return norm.slice(idx);
  return norm.replace(/^\/+/, '');
}

function migrateProposalPaths(p) {
  if (!p || typeof p !== 'object') return p;
  const copy = { ...p };
  if (!copy.outDirRel) {
    const src = copy.htmlPath || copy.pdfPath || copy.htmlRel || copy.pdfRel || '';
    const relFile = toRelPosix(src);
    if (relFile.startsWith('reports/dossiers/')) {
      copy.outDirRel = relFile.replace(/\/draft\.(html|pdf)$/i, '');
      copy.htmlRel = `${copy.outDirRel}/draft.html`;
      copy.pdfRel = `${copy.outDirRel}/draft.pdf`;
    }
  }
  return copy;
}

function findProposalDirById(id) {
  if (!id || !fs.existsSync(DOSSIER_DIR)) return null;
  for (const name of fs.readdirSync(DOSSIER_DIR)) {
    const dir = path.join(DOSSIER_DIR, name);
    const metaPath = path.join(dir, 'proposal.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta?.id === id) return dir;
    } catch (_) { /* skip */ }
  }
  return null;
}

function resolveProposalArtifact(proposal, format = 'html') {
  if (!proposal) return null;
  const fileName = format === 'pdf' ? 'draft.pdf' : 'draft.html';
  const relKey = format === 'pdf' ? 'pdfRel' : 'htmlRel';
  const absKey = format === 'pdf' ? 'pdfPath' : 'htmlPath';
  const candidates = [];

  if (proposal[relKey]) {
    candidates.push(path.join(projectRoot, toRelPosix(proposal[relKey]).split('/').join(path.sep)));
  }
  if (proposal.outDirRel) {
    candidates.push(path.join(projectRoot, toRelPosix(proposal.outDirRel).split('/').join(path.sep), fileName));
  }
  if (proposal[absKey]) candidates.push(proposal[absKey]);

  for (const key of [absKey, relKey]) {
    const tail = toRelPosix(proposal[key]);
    if (tail.startsWith('reports/dossiers/')) {
      candidates.push(path.join(projectRoot, tail.split('/').join(path.sep)));
    }
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }

  const dir = findProposalDirById(proposal.id);
  if (dir) {
    const fallback = path.join(dir, fileName);
    if (fs.existsSync(fallback)) return fallback;
  }
  return null;
}

function saveProposalStore() {
  ensureDir(path.dirname(PROPOSALS_FILE));
  const proposals = Array.from(_proposals.values()).map((p) => migrateProposalPaths(p));
  fs.writeFileSync(
    PROPOSALS_FILE,
    JSON.stringify({ proposals }, null, 2),
    'utf8',
  );
}

loadProposalStore();

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadSkin(name) {
  const file = path.join(SKINS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown dossier skin: ${name}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function flattenFacts(obj, out = new Set(), prefix = '') {
  if (obj == null) return out;
  if (typeof obj === 'string' || typeof obj === 'number') {
    out.add(String(obj));
    if (typeof obj === 'number') out.add(String(obj));
    return out;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) flattenFacts(v, out, prefix);
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) flattenFacts(v, out, prefix ? `${prefix}.${k}` : k);
  }
  return out;
}

function loadFactsForSubject(subject) {
  const key = String(subject || '').toLowerCase();
  const factsPath = key === 'denizen'
    ? path.join(CANON_DIR, 'denizen-facts.json')
    : path.join(CANON_DIR, '1921-facts.json');
  if (!fs.existsSync(factsPath)) {
    throw new Error(`No canon facts for subject "${subject}"`);
  }
  const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
  const pastPerf = path.join(CANON_DIR, 'past-performance.md');
  if (fs.existsSync(pastPerf)) {
    facts.past_performance_md = fs.readFileSync(pastPerf, 'utf8');
  }
  facts._allowedValues = flattenFacts(facts);
  return facts;
}

function selectSections(type, reader, sectionsOverride) {
  const preset = DOCUMENT_TYPES[type];
  if (!preset) throw new Error(`Unknown dossier type: ${type}`);
  let sections = Array.isArray(sectionsOverride) && sectionsOverride.length
    ? sectionsOverride.slice()
    : preset.sections.slice();
  const cuts = READER_CUTS[String(reader || preset.defaultReader).toLowerCase()] || [];
  sections = sections.filter((s) => !cuts.includes(s));
  if (reader === 'partner' && !sections.includes('fit')) sections.push('fit');
  if (reader === 'engineer' && !sections.includes('appendices')) sections.push('appendices');
  return sections;
}

function renderFooter(skin, ctx) {
  let tpl = skin.footerTemplate || '{{label}}';
  tpl = tpl.replace(/\{\{version\}\}/g, ctx.version || '');
  tpl = tpl.replace(/\{\{part\}\}/g, ctx.part || '');
  tpl = tpl.replace(/\{\{title\}\}/g, ctx.title || '');
  tpl = tpl.replace(/\{\{#recipient\}\}([\s\S]*?)\{\{\/recipient\}\}/g, ctx.recipient ? '$1' : '');
  tpl = tpl.replace(/\{\{recipient\}\}/g, ctx.recipient || '');
  return tpl;
}

function buildCss(skin) {
  const c = skin.colors;
  const f = skin.fonts;
  return `
:root {
  --base: ${c.base};
  --surface: ${c.surface};
  --accent: ${c.accent};
  --accent-muted: ${c.accentMuted};
  --text: ${c.text};
  --muted: ${c.muted};
  --callout: ${c.callout};
  --border: ${c.border};
  --font-body: ${f.body};
  --font-mono: ${f.mono};
  --font-serif: ${f.serif};
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem;
  background: var(--base); color: var(--text);
  font-family: var(--font-body); line-height: 1.55; font-size: 11pt;
}
.cover { border-bottom: 1px solid var(--border); padding-bottom: 2rem; margin-bottom: 2rem; }
.cover h1 { font-size: 2rem; margin: 0 0 0.5rem; color: var(--accent); }
.cover .tagline { color: var(--muted); font-size: 1.1rem; }
.cover .meta { font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted); margin-top: 1rem; }
.section { margin-bottom: 2rem; page-break-inside: avoid; }
.section-label {
  font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--accent); margin-bottom: 0.5rem;
}
h2 { font-size: 1.25rem; margin: 0 0 1rem; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.95rem; }
th, td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
th { background: var(--surface); color: var(--accent-muted); font-family: var(--font-mono); font-size: 0.75rem; }
.callout {
  background: var(--callout); border-left: 3px solid var(--accent);
  padding: 1rem 1.25rem; margin: 1rem 0; font-size: 0.95rem;
}
.letter { font-family: var(--font-serif); font-style: italic; font-size: 1.05rem; }
.status-done { color: #86efac; }
.status-progress { color: #fde047; }
.status-planned { color: var(--muted); }
.footer-note { font-family: var(--font-mono); font-size: 0.65rem; color: var(--muted); margin-top: 3rem; border-top: 1px solid var(--border); padding-top: 1rem; }
.unsourced { background: #7f1d1d; color: #fecaca; padding: 0 0.25rem; }
@media print { body { padding: 0; } }
`;
}

function statusClass(status) {
  const s = String(status || '');
  if (s.includes('[DONE]')) return 'status-done';
  if (s.includes('[IN-PROGRESS]')) return 'status-progress';
  if (s.includes('[PLANNED]')) return 'status-planned';
  return '';
}

function buildDraftHtml({
  type,
  reader,
  recipient,
  subject,
  skin,
  facts,
  recipientResearch,
  sectionManifest,
  title,
}) {
  const parts = [];
  const docTitle = title || (type === 'technical-dossier' ? 'DENIZEN Technical Dossier' : 'Strategic Partnership Dossier');
  const version = facts.product?.version || facts.updated || '';

  if (sectionManifest.includes('cover')) {
    parts.push(`<header class="cover">
      <div class="section-label">Cover</div>
      <h1>${escapeHtml(docTitle)}</h1>
      <p class="tagline">${escapeHtml(facts.product?.tagline || facts.strategic_posture?.summary || skin.voice)}</p>
      <div class="meta">
        ${recipient ? `Prepared for ${escapeHtml(recipient)} · ` : ''}
        Subject ${escapeHtml(subject)} · Skin ${escapeHtml(skin.name)} · Reader ${escapeHtml(reader)}
        ${facts.entity?.uei ? `<br>UEI ${escapeHtml(facts.entity.uei)} · CAGE ${escapeHtml(facts.entity.cage_code || '')}` : ''}
        ${version ? `<br>Version ${escapeHtml(version)}` : ''}
      </div>
    </header>`);
  }

  if (sectionManifest.includes('orientation')) {
    if (type === 'partnership-dossier' && recipient) {
      parts.push(`<section class="section">
        <div class="section-label">Orientation</div>
        <h2>Personal note</h2>
        <p class="letter">This dossier frames ${escapeHtml(facts.entity?.legal_name || subject)} through what ${escapeHtml(recipient)} cares about — joint pursuits, not a generic company overview.</p>
        <div class="callout"><strong>If you read only five things:</strong> who we are, proof we ship, fit with ${escapeHtml(recipient)}, concrete joint pursuits, and the ask.</div>
      </section>`);
    } else {
      parts.push(`<section class="section">
        <div class="section-label">Orientation</div>
        <h2>How to read this</h2>
        <table><thead><tr><th>Reader</th><th>Start here</th></tr></thead><tbody>
          <tr><td>Engineer</td><td>Body → Evidence → Appendices</td></tr>
          <tr><td>Investor</td><td>Evidence → Ask → Fit positioning</td></tr>
          <tr><td>Partner</td><td>Fit → Evidence → Ask</td></tr>
        </tbody></table>
      </section>`);
    }
  }

  if (sectionManifest.includes('body')) {
    const caps = facts.capabilities || facts.joint_pursuit_areas || [];
    const rows = Array.isArray(caps)
      ? caps.map((c) => {
        if (typeof c === 'string') return `<tr><td>${escapeHtml(c)}</td><td class="status-progress">[IN-PROGRESS]</td></tr>`;
        return `<tr><td>${escapeHtml(c.name || c.id || '')}</td><td class="${statusClass(c.status)}">${escapeHtml(c.status || '')}</td></tr>`;
      }).join('')
      : '';
    parts.push(`<section class="section">
      <div class="section-label">Body</div>
      <h2>${reader === 'engineer' ? 'Platform overview' : 'Strategic overview'}</h2>
      <table><thead><tr><th>Item</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`);
  }

  if (sectionManifest.includes('evidence')) {
    const pin = facts.repo_pin
      ? `<p class="meta">Repo pin: commit <code>${escapeHtml(facts.repo_pin.short || facts.repo_pin.commit)}</code> · ${escapeHtml(String(facts.repo_pin.test_files))} test files in <code>tests/</code></p>`
      : '';
    parts.push(`<section class="section">
      <div class="section-label">Evidence</div>
      <h2>Proof (with provenance)</h2>
      <p class="meta">Source: ${escapeHtml(facts.evidence_provenance || facts.source || 'canon file')}</p>
      ${pin}
      <div class="callout">Past performance entries are operator-maintained in <code>data/canonical/past-performance.md</code>.</div>
    </section>`);
  }

  if (sectionManifest.includes('fit') && recipient) {
    const fitHtml = buildFitSectionHtml(recipient, recipientResearch, facts);
    parts.push(fitHtml);
  }

  if (sectionManifest.includes('ask')) {
    const ask = type === 'partnership-dossier'
      ? `Next step: align on joint pursuit scope and execute teaming paperwork before submission windows close.`
      : `Next step: operator review of this draft — no external send until approved.`;
    parts.push(`<section class="section">
      <div class="section-label">The Ask</div>
      <h2>Proposed next step</h2>
      <p class="letter">${escapeHtml(ask)}</p>
    </section>`);
  }

  const notClaiming = facts.not_claiming || [];
  if (notClaiming.length) {
    parts.push(`<section class="section">
      <div class="section-label">Restraint</div>
      <h2>What this document does not claim</h2>
      <ul>${notClaiming.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
    </section>`);
  }

  if (sectionManifest.includes('appendices')) {
    parts.push(`<section class="section">
      <div class="section-label">Appendices</div>
      <h2>Reference</h2>
      <p class="meta">Canon spec: docs/BRANDED_DOSSIER_SYSTEM.md · Facts: data/canonical/</p>
    </section>`);
  }

  const footer = renderFooter(skin, { version, part: 'DRAFT', recipient, title: docTitle });
  parts.push(`<div class="footer-note">${escapeHtml(footer)} · DRAFT — approval required before send</div>`);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title><style>${buildCss(skin)}</style></head><body>${parts.join('\n')}</body></html>`;
}

/** Parse Bob/cited-research into normalized citations (URL required). */
function normalizeRecipientResearch(raw = {}) {
  const query = raw.query || '';
  let citations = Array.isArray(raw.citations) ? raw.citations.slice() : [];

  if (!citations.length && raw.summary) {
    citations = parseCitationsFromSummary(raw.summary);
  }

  citations = citations
    .map((c, i) => ({
      index: Number(c.index || i + 1),
      title: String(c.title || '').trim(),
      url: String(c.url || '').trim(),
      snippet: String(c.snippet || '').trim(),
    }))
    .filter((c) => c.url && /^https?:\/\//i.test(c.url));

  const items = (Array.isArray(raw.citations) && raw.citations.length)
    ? citations.map((c) => ({
      claim: c.snippet || c.title,
      cite: c.index,
      url: c.url,
    })).filter((it) => it.claim && it.url)
    : (Array.isArray(raw.items) && raw.items.length
      ? raw.items
      : citations.map((c) => ({
        claim: c.snippet || c.title,
        cite: c.index,
        url: c.url,
      })).filter((it) => it.claim && it.url));

  return {
    query,
    summary: String(raw.summary || '').slice(0, 4500),
    citations,
    items,
    ok: citations.length > 0,
    at: raw.at || null,
  };
}

function filterRecipientCitations(citations, recipient) {
  const list = Array.isArray(citations) ? citations : [];
  const r = String(recipient || '').toLowerCase().trim();
  if (!r || list.length <= 1) return list;

  const tokenMatches = (token, blob) => {
    const t = String(token || '').toLowerCase();
    if (!t) return false;
    if (t.length <= 3) {
      const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return re.test(blob);
    }
    return blob.includes(t);
  };

  const tokens = r.split(/\s+/).filter((t) => t.length > 1);
  const matched = list.filter((c) => {
    const blob = `${c.title} ${c.url} ${c.snippet}`.toLowerCase();
    const compact = r.replace(/\s+/g, '');
    const dashed = r.replace(/\s+/g, '-');
    if (blob.includes(compact) || blob.includes(dashed)) return true;
    return tokens.length > 0 && tokens.every((t) => tokenMatches(t, blob));
  });
  return matched.length ? matched : [list[0]];
}

function parseCitationsFromSummary(summary) {
  const citations = [];
  const text = String(summary || '');
  const lineRe = /^\[(\d+)\]\s*(.+?)\s*[—–-]\s*(https?:\/\/\S+)/gm;
  let m;
  while ((m = lineRe.exec(text)) !== null) {
    citations.push({
      index: Number(m[1]),
      title: m[2].trim(),
      url: m[3].trim(),
      snippet: '',
    });
  }
  return citations;
}

function buildFitClaimsFromResearch(recipientResearch) {
  const norm = normalizeRecipientResearch(recipientResearch || {});
  return norm.items.map((it) => ({
    claim: it.claim,
    cite: it.cite,
    url: it.url,
  }));
}

function buildFitSectionHtml(recipient, recipientResearch, facts) {
  const claims = buildFitClaimsFromResearch(recipientResearch);
  const norm = normalizeRecipientResearch(recipientResearch || {});

  let body = '';
  if (!claims.length) {
    body = '<p><em>Recipient research must return cited sources (URL per item) before Fit claims render.</em></p>';
  } else {
    body = `<ul class="fit-claims">${claims.map((c) =>
      `<li data-cite="${c.cite}" data-source-url="${escapeHtml(c.url)}">`
      + `${escapeHtml(c.claim)} `
      + `<a href="${escapeHtml(c.url)}" class="cite-ref">[${c.cite}]</a></li>`,
    ).join('')}</ul>`;
    body += `<table><thead><tr><th>#</th><th>Source</th><th>URL</th></tr></thead><tbody>${
      norm.citations.map((c) =>
        `<tr><td>[${c.index}]</td><td>${escapeHtml(c.title)}</td><td>${escapeHtml(c.url)}</td></tr>`,
      ).join('')
    }</tbody></table>`;
  }

  const jointRows = Array.isArray(facts.joint_pursuit_areas)
    ? facts.joint_pursuit_areas.map((j) => `<tr><td>${escapeHtml(j)}</td><td class="status-progress">[IN-PROGRESS]</td></tr>`).join('')
    : '';

  return `<section class="section" data-block="fit">
      <div class="section-label">Fit / Tailoring</div>
      <h2>Strategic fit with ${escapeHtml(recipient)}</h2>
      <div class="callout fit-block">${body}</div>
      ${jointRows ? `<h3>1921 joint pursuit areas (canon — not recipient claims)</h3>
      <table><thead><tr><th>Area</th><th>Status</th></tr></thead><tbody>${jointRows}</tbody></table>` : ''}
    </section>`;
}

function extractFitBlock(html) {
  const m = String(html || '').match(/<section[^>]*data-block="fit"[\s\S]*?<\/section>/i);
  return m ? m[0] : '';
}

/**
 * §5 rule 5 with teeth: recipient Fit claims must cite Bob research index → real URL.
 * Blocks prose laundering (plausible summary with no URL-backed cites).
 */
function auditRecipientCitationTraceability(html, recipient, recipientResearch) {
  const flags = [];
  if (!recipient) return flags;

  const norm = normalizeRecipientResearch(recipientResearch || {});

  if (!norm.citations.length) {
    flags.push({
      rule: 'recipient_citations_required',
      message: 'Named recipient requires research citations with https URL per source — summary alone is insufficient',
      blocking: true,
    });
    return flags;
  }

  const validIndices = new Set(norm.citations.map((c) => c.index));
  const validUrls = new Set(norm.citations.map((c) => c.url));

  const fit = extractFitBlock(html);
  if (!fit) {
    flags.push({ rule: 'fit_block_missing', message: 'Fit block missing for named recipient', blocking: true });
    return flags;
  }

  const fitBodyMatch = fit.match(/<div class="callout fit-block">([\s\S]*?)<\/div>/i);
  const fitBody = fitBodyMatch ? fitBodyMatch[1] : fit;

  for (const url of fitBody.match(/https?:\/\/[^\s"<]+/g) || []) {
    const clean = url.replace(/&amp;/g, '&');
    if (!validUrls.has(clean)) {
      flags.push({
        rule: 'recipient_url_not_in_research',
        url: clean,
        message: 'Fit block URL not present in Bob research citations',
        blocking: true,
      });
    }
  }

  const listItems = fitBody.match(/<li[^>]*data-cite="(\d+)"[^>]*>([\s\S]*?)<\/li>/gi) || [];
  if (!listItems.length) {
    flags.push({
      rule: 'recipient_claim_uncited',
      message: 'Fit block has no citation-backed claim list — freeform recipient prose blocked',
      blocking: true,
    });
  }

  for (const li of listItems) {
    const idxM = li.match(/data-cite="(\d+)"/);
    const cite = idxM ? Number(idxM[1]) : NaN;
    if (!validIndices.has(cite)) {
      flags.push({
        rule: 'recipient_cite_index_invalid',
        index: cite,
        message: 'Fit claim cites research index not in Bob citation list',
        blocking: true,
      });
    }
    const urlM = li.match(/data-source-url="([^"]+)"/);
    if (urlM && !validUrls.has(urlM[1])) {
      flags.push({
        rule: 'recipient_claim_source_mismatch',
        url: urlM[1],
        message: 'Fit claim source URL does not match research package',
        blocking: true,
      });
    }
  }

  const prose = fitBody
    .replace(/<ul[\s\S]*?<\/ul>/gi, ' ')
    .replace(/<table[\s\S]*?<\/table>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const recipientRe = new RegExp(recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const proseSentences = prose.split(/(?<=[.!?])\s+/).filter((s) => s.length > 24);
  for (const s of proseSentences) {
    if (!recipientRe.test(s)) continue;
    if (!/\[\d+\]/.test(s)) {
      flags.push({
        rule: 'recipient_claim_uncited',
        sentence: s.slice(0, 160),
        message: 'Recipient-specific prose in Fit without [n] citation',
        blocking: true,
      });
    }
  }

  return flags;
}

async function bindTechnicalFactsToCommit(facts, params = {}) {
  const ref = params.facts_ref || params.commit || params.factsRef || 'HEAD';
  const refStr = String(ref).replace(/^git:\/\//, '').replace(/^commit:/, '') || 'HEAD';

  const { stdout: shaOut } = await execAsync(`git rev-parse ${refStr}`, {
    cwd: projectRoot,
    windowsHide: true,
    timeout: 10000,
  });
  const sha = shaOut.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error(`Invalid commit ref: ${refStr}`);
  }

  const { stdout: treeOut } = await execAsync(`git ls-tree -r --name-only ${sha} -- tests/`, {
    cwd: projectRoot,
    windowsHide: true,
    timeout: 15000,
  });
  const testFiles = treeOut.split('\n').map((s) => s.trim()).filter((f) => /\.test\.(js|mjs|cjs)$/i.test(f));

  facts.repo_pin = {
    commit: sha,
    short: sha.slice(0, 7),
    test_files: testFiles.length,
    ref: refStr,
  };
  facts.evidence_provenance = `read from commit ${sha.slice(0, 7)} · ${testFiles.length} test files in tests/`;
  facts._allowedValues = flattenFacts(facts);
  for (const v of [sha, sha.slice(0, 7), String(testFiles.length)]) {
    facts._allowedValues.add(v);
  }
  return facts;
}

async function isGitRepository(root = projectRoot) {
  try {
    const { stdout } = await execAsync('git rev-parse --is-inside-work-tree', {
      cwd: root,
      windowsHide: true,
      timeout: 5000,
    });
    return stdout.trim() === 'true';
  } catch (_) {
    return false;
  }
}

function runHonestyPass({ html, facts, recipient, recipientResearch }) {
  const flags = [];
  let out = html;
  const allowed = facts._allowedValues || flattenFacts(facts);

  // Strip CSS (hex colors look like unsourced numbers) before metric scan
  const htmlForNumbers = html.replace(/<style[\s\S]*?<\/style>/gi, ' ');

  // Currency or 5+ digit metrics only — not years or CSS fragments
  const numRe = /\$(\d[\d,]*\d(?:\.\d+)?)|\b(\d{5,})\b/g;
  let m;
  while ((m = numRe.exec(htmlForNumbers)) !== null) {
    const raw = m[1] != null ? `$${m[1]}` : m[2];
    const num = String(raw).replace(/[$,]/g, '');
    const variants = [raw, num, `$${num}`];
    if (!variants.some((v) => allowed.has(v))) {
      flags.push({ rule: 'no_unsourced_numbers', value: raw, blocking: true });
      out = out.replace(raw, `<span class="unsourced">[UNSOURCED:${escapeHtml(raw)}]</span>`);
    }
  }

  const testCountRe = /\b(\d+)\s+tests?\b/gi;
  while ((m = testCountRe.exec(htmlForNumbers)) !== null) {
    const n = m[1];
    if (!allowed.has(n)) {
      flags.push({ rule: 'no_unsourced_numbers', value: `${n} tests`, blocking: true });
    }
  }

  if (recipient && !recipientResearch?.summary && !(recipientResearch?.citations || []).length) {
    flags.push({ rule: 'recipient_research', message: 'Named recipient but no research package', blocking: true });
  }

  flags.push(...auditRecipientCitationTraceability(html, recipient, recipientResearch));

  if (!(facts.not_claiming || []).length) {
    flags.push({ rule: 'restraint_surface', message: 'Missing not_claiming restraint list in facts', blocking: false });
  }

  const hasStatusTag = /\[DONE\]|\[IN-PROGRESS\]|\[PLANNED\]/i.test(out);
  if (!hasStatusTag) {
    flags.push({ rule: 'status_tagging', message: 'No [DONE]/[IN-PROGRESS]/[PLANNED] tags found in body', blocking: false });
  }

  const blocking = flags.filter((f) => f.blocking === true || f.rule === 'no_unsourced_numbers');
  return {
    ok: blocking.length === 0,
    flags,
    html: out,
    blocking,
  };
}

async function renderHtmlToPdf(htmlPath, pdfPath) {
  if (!fs.existsSync(PDF_SCRIPT)) {
    throw new Error('pdf-generator.mjs not found');
  }
  const { stdout } = await execAsync(
    `node "${PDF_SCRIPT}" --file "${htmlPath}" --output "${pdfPath}" --format Letter --margin 0.75in --wait 500`,
    { cwd: projectRoot, windowsHide: true, timeout: 120000 },
  );
  const line = String(stdout || '').trim().split('\n').pop();
  return JSON.parse(line);
}

async function runDossierTask({ npc, params = {}, deps = {}, broadcast }) {
  try {
    const type = String(params.type || '').trim();
    if (!type || !DOCUMENT_TYPES[type]) {
      return { ok: false, error: 'pdf-dossier requires type (see docs/BRANDED_DOSSIER_SYSTEM.md §2)' };
    }

    for (const p of _proposals.values()) {
      if (p.npc === npc && p.status === 'pending_review') {
        return { ok: false, error: `${npc} already has a pending dossier proposal (${p.id})` };
      }
    }

    const preset = DOCUMENT_TYPES[type];
    const reader = String(params.reader || preset.defaultReader);
    const subject = String(params.subject || preset.defaultSubject);
    const ownerProfile = deps.ownerProfile || {};
    const ownerIdentityId = deps.ownerIdentityId || deps.identityId || null;
    const skinName = approvalsScope.resolveDossierSkinForOwner(ownerProfile, {
      requestedSkin: params.skin,
      defaultSkin: preset.defaultSkin,
    });
    const recipient = params.recipient ? String(params.recipient).trim() : '';
    const skin = loadSkin(skinName);
    let facts = loadFactsForSubject(subject);

    if (type === 'technical-dossier' || subject.toLowerCase() === 'denizen') {
      if (!(await isGitRepository())) {
        return {
          ok: false,
          error: 'technical-dossier requires a git repo to pin facts_ref/commit — cannot bind test provenance',
        };
      }
      try {
        facts = await bindTechnicalFactsToCommit(facts, params);
      } catch (err) {
        return { ok: false, error: `facts_ref commit pin failed: ${err.message}` };
      }
    }

    const sectionManifest = selectSections(type, reader, params.sections);

    let recipientResearch = null;
    if (recipient) {
      if (params.recipient_citations?.length || params.recipient_research) {
        recipientResearch = normalizeRecipientResearch({
          query: params.recipient_query || '',
          summary: params.recipient_research,
          citations: params.recipient_citations,
          items: params.recipient_items,
        });
      } else {
        recipientResearch = await fetchRecipientResearch(npc, recipient, deps, params);
        recipientResearch = normalizeRecipientResearch(recipientResearch || {});
      }
      const filtered = filterRecipientCitations(recipientResearch.citations, recipient);
      recipientResearch = normalizeRecipientResearch({
        query: recipientResearch.query,
        summary: recipientResearch.summary,
        at: recipientResearch.at,
        citations: filtered.map((c, i) => ({ ...c, index: i + 1 })),
      });
    } else if (params.recipient_research) {
      recipientResearch = normalizeRecipientResearch({
        summary: String(params.recipient_research),
        query: params.recipient_query || '',
        citations: params.recipient_citations,
        items: params.recipient_items,
      });
    }

    const html = buildDraftHtml({
      type,
      reader,
      recipient,
      subject,
      skin,
      facts,
      recipientResearch,
      sectionManifest,
      title: params.title,
    });

    const honesty = runHonestyPass({ html, facts, recipient, recipientResearch });
    if (!honesty.ok && params.force !== true) {
      return {
        ok: false,
        error: 'Honesty pass blocked render — fix flags or pass force:true after operator review',
        flags: honesty.flags,
        sectionManifest,
      };
    }

    const id = newId();
    const slug = `${npc.toLowerCase()}_${type}_${Date.now()}`;
    const outDir = path.join(DOSSIER_DIR, slug);
    ensureDir(outDir);

    const htmlPath = path.join(outDir, 'draft.html');
    const pdfPath = path.join(outDir, 'draft.pdf');
    fs.writeFileSync(htmlPath, honesty.html, 'utf8');

    let pdfResult;
    try {
      pdfResult = await renderHtmlToPdf(htmlPath, pdfPath);
    } catch (err) {
      return { ok: false, error: `PDF render failed: ${err.message}`, htmlPath, flags: honesty.flags };
    }

    const requiresAngelaReview = /angela|1921 holding/i.test(JSON.stringify(facts.leadership || {}))
      && type !== 'technical-dossier';

    const outDirRel = path.relative(projectRoot, outDir).split(path.sep).join('/');

    const proposal = {
      id,
      npc,
      type,
      reader,
      recipient: recipient || null,
      subject,
      skin: skinName,
      sectionManifest,
      outDirRel,
      htmlRel: `${outDirRel}/draft.html`,
      pdfRel: `${outDirRel}/draft.pdf`,
      htmlPath,
      pdfPath,
      flags: honesty.flags,
      recipientResearch: recipientResearch ? {
        query: recipientResearch.query,
        citations: recipientResearch.citations,
      } : null,
      repo_pin: facts.repo_pin || null,
      status: 'pending_review',
      requiresAngelaReview,
      owner_identity_id: ownerIdentityId,
      owner_email: ownerProfile.email ? String(ownerProfile.email).trim().toLowerCase() : null,
      owner_display_name: ownerProfile.display_name || ownerProfile.displayName || null,
      ts: Date.now(),
      spec: 'docs/BRANDED_DOSSIER_SYSTEM.md',
    };
    _proposals.set(id, proposal);
    saveProposalStore();

    const metaPath = path.join(outDir, 'proposal.json');
    fs.writeFileSync(metaPath, JSON.stringify(proposal, null, 2), 'utf8');

    if (typeof broadcast === 'function') {
      broadcast({
        type: 'npc_dossier_proposal',
        npc,
        proposalId: id,
        dossierType: type,
        pdfPath,
        requiresAngelaReview,
      });
      broadcast({
        type: 'proposal_queue_changed',
        kind: 'dossier',
        action: 'created',
        id,
        ts: Date.now(),
      });
    }

    return {
      ok: true,
      proposalId: id,
      pdfPath,
      htmlPath,
      sectionManifest,
      flags: honesty.flags,
      recipientResearch,
      repo_pin: facts.repo_pin || null,
      requiresAngelaReview,
      output: `Dossier draft ready (approval required): ${pdfPath}`,
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function getProposals(opts = {}) {
  const all = Array.from(_proposals.values());
  if (opts.operator) return all;
  if (opts.identityId) {
    return all.filter((p) => p.owner_identity_id === opts.identityId);
  }
  return all;
}

function getProposalById(id) {
  return _proposals.get(id) || null;
}

function approveProposal(id, opts = {}) {
  const p = _proposals.get(id);
  if (!p) return { ok: false, error: `Proposal ${id} not found` };
  if (p.status !== 'pending_review') {
    return { ok: false, error: `Proposal ${id} is not pending_review (${p.status})` };
  }
  const note = opts.note ? String(opts.note).slice(0, 400) : null;
  p.status = 'approved';
  p.approvedAt = Date.now();
  p.review = {
    decision: 'approved',
    note,
    reviewedAt: new Date().toISOString(),
  };
  saveProposalStore();
  return { ok: true, pdfPath: p.pdfPath, htmlPath: p.htmlPath, note: note || 'Approved for operator use — skill does not send email' };
}

function rejectProposal(id, opts = {}) {
  const p = _proposals.get(id);
  if (!p) return { ok: false, error: `Proposal ${id} not found` };
  if (p.status !== 'pending_review') {
    return { ok: false, error: `Proposal ${id} is not pending_review (${p.status})` };
  }
  const note = opts.note ? String(opts.note).slice(0, 400) : null;
  if (!note) {
    return { ok: false, error: 'Rejection requires a note explaining why' };
  }
  p.status = 'rejected';
  p.review = {
    decision: 'rejected',
    note,
    reviewedAt: new Date().toISOString(),
  };
  saveProposalStore();
  return { ok: true };
}

async function fetchRecipientResearch(npc, recipient, deps, params) {
  const q = params.recipient_query
    || `Research ${recipient} for a partnership dossier: core business, strengths, government/cyber focus, likely needs from a teaming partner. Facts only — include source URLs.`;

  if (typeof deps.runCitedResearch === 'function') {
    return deps.runCitedResearch(q, { count: 5, read: 0 });
  }

  if (typeof deps.runResearch === 'function') {
    const rr = await deps.runResearch(npc, q, { quiet: true });
    if (rr?.results) {
      return {
        query: q,
        citations: (rr.results || []).map((r, i) => ({
          index: i + 1,
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })),
        summary: String(rr?.summary || rr?.output || rr?.text || ''),
      };
    }
    return { query: q, summary: String(rr?.summary || rr?.output || rr?.text || ''), citations: [] };
  }

  return null;
}

module.exports = {
  DOCUMENT_TYPES,
  SPEC_PATH,
  loadSkin,
  loadFactsForSubject,
  selectSections,
  buildDraftHtml,
  buildFitSectionHtml,
  normalizeRecipientResearch,
  filterRecipientCitations,
  auditRecipientCitationTraceability,
  bindTechnicalFactsToCommit,
  runHonestyPass,
  runDossierTask,
  getProposals,
  getProposalById,
  resolveProposalArtifact,
  approveProposal,
  rejectProposal,
  isGitRepository,
};
