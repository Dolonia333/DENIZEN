'use strict';

/**
 * Discover existing skills locally (Jelly + approved) and on GitHub before authoring new ones.
 */

const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');

const execAsync = promisify(exec);

const DEFAULT_REPOS = [
  'Dolonia333/DENIZEN',
  'openclaw/openclaw',
];

function tokenize(text) {
  return String(text || '').toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'need', 'want',
  'can', 'you', 'our', 'your', 'team', 'skill', 'tool', 'make', 'build', 'create',
]);

function loadLocalSkillCatalog({ registry, approvedMap = {} } = {}) {
  const items = [];
  if (registry?.list) {
    for (const s of registry.list()) {
      items.push({
        name: s.name,
        description: s.description || '',
        source: s.source || 'native',
      });
    }
  }
  for (const name of Object.keys(approvedMap)) {
    if (!items.some((i) => i.name === name)) {
      items.push({
        name,
        description: 'CEO-approved custom skill',
        source: 'approved',
      });
    }
  }
  return items;
}

function scoreSkillMatch(purpose, skill) {
  const tokens = tokenize(purpose);
  if (!tokens.length) return 0;
  const name = String(skill.name || '').toLowerCase();
  const hay = `${name} ${skill.description}`.toLowerCase();
  let hits = 0;
  if (name && tokens.includes(name)) hits += 2;
  for (const t of tokens) {
    if (hay.includes(t)) hits += 1;
  }
  return hits / (tokens.length + (name && tokens.includes(name) ? 1 : 0));
}

function findBestLocalMatch(purpose, catalog = []) {
  let best = null;
  let bestScore = 0;
  for (const skill of catalog) {
    const score = scoreSkillMatch(purpose, skill);
    if (score > bestScore) {
      bestScore = score;
      best = skill;
    }
  }
  if (!best || bestScore < 0.35) return null;
  return { ...best, score: bestScore };
}

async function searchGithubCode(query, repos = DEFAULT_REPOS) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return { hits: [], raw: '' };

  const hits = [];
  const chunks = [];

  for (const repo of repos) {
    try {
      const { stdout } = await execAsync(
        `gh search code "${q.replace(/"/g, '')}" --repo ${repo} --limit 5`,
        { windowsHide: true, timeout: 20000 },
      );
      const lines = String(stdout || '').trim().split('\n').filter(Boolean);
      for (const line of lines.slice(0, 5)) {
        hits.push({ repo, line: line.slice(0, 240) });
      }
      if (lines.length) chunks.push(`## ${repo}\n${lines.join('\n')}`);
    } catch (_) {
      /* gh unavailable or rate limited */
    }
  }

  return {
    hits,
    raw: chunks.join('\n\n').slice(0, 2500),
  };
}

function scanFilesystemSkillDirs(denizenRoot) {
  const roots = [
    path.join(denizenRoot, 'jelly', 'skills'),
    path.join(denizenRoot, 'skills'),
    path.join(denizenRoot, 'skills-pending'),
  ];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const idx = path.join(root, name, 'index.js');
      const mjs = path.join(root, name, `${name}.mjs`);
      if (fs.existsSync(idx) || fs.existsSync(mjs)) {
        found.push({ name, path: root });
      }
    }
  }
  return found;
}

async function discoverSkills({
  purpose,
  registry,
  approvedMap,
  denizenRoot,
  webResearch,
  repos,
} = {}) {
  const catalog = loadLocalSkillCatalog({ registry, approvedMap });
  const localMatch = findBestLocalMatch(purpose, catalog);
  const fsSkills = denizenRoot ? scanFilesystemSkillDirs(denizenRoot) : [];

  let github = { hits: [], raw: '' };
  try {
    github = await searchGithubCode(`${purpose} skill jelly openclaw`, repos);
  } catch (_) {}

  let webHints = '';
  if ((!github.raw || github.hits.length === 0) && webResearch?.research) {
    try {
      const wr = await webResearch.research(
        `github openclaw jelly skill ${purpose}`,
        { count: 4, read: 0 },
      );
      webHints = webResearch.formatForNpc(wr).slice(0, 1200);
    } catch (_) {}
  }

  return {
    catalog,
    localMatch,
    fsSkills,
    github,
    webHints,
    summary: formatDiscoverySummary({ localMatch, github, webHints, fsSkills }),
  };
}

function formatDiscoverySummary({ localMatch, github, webHints, fsSkills }) {
  const parts = [];
  if (localMatch) {
    parts.push(`Local match: ${localMatch.name} (${Math.round(localMatch.score * 100)}% overlap) — ${localMatch.description || 'no description'}`);
  }
  if (github.hits?.length) {
    parts.push(`GitHub hits: ${github.hits.map((h) => `${h.repo}: ${h.line}`).join('; ')}`);
  } else if (webHints) {
    parts.push(`Web skill hints:\n${webHints.slice(0, 600)}`);
  }
  if (fsSkills?.length) {
    parts.push(`On-disk skills: ${fsSkills.map((s) => s.name).join(', ')}`);
  }
  return parts.join('\n').slice(0, 2500);
}

module.exports = {
  loadLocalSkillCatalog,
  findBestLocalMatch,
  searchGithubCode,
  discoverSkills,
  formatDiscoverySummary,
  scoreSkillMatch,
  tokenize,
};
