'use strict';

/**
 * In-memory team competency aggregates (Phase 5.1 scaffold).
 */

const npcRoster = require('./npc-roster');

/** displayName -> { skills, avgOutcome, artifactCount, recentScores, recentTrend } */
const profiles = new Map();

function npcKey(displayName) {
  const entry = (npcRoster.entries || []).find((e) => e.display === displayName);
  return entry?.folder || String(displayName || '').toLowerCase();
}

function parseSkillTags(memoryText = '') {
  const skills = {};
  const re = /\[SKILL:([^:\]]+):\+(\d+)\]/gi;
  let m;
  while ((m = re.exec(memoryText)) !== null) {
    const name = m[1].trim().toLowerCase();
    const n = Number(m[2]) || 1;
    skills[name] = (skills[name] || 0) + n;
  }
  return skills;
}

function ensureProfile(displayName) {
  if (!profiles.has(displayName)) {
    profiles.set(displayName, {
      npc_key: npcKey(displayName),
      display_name: displayName,
      skills: {},
      avgOutcome: 0,
      artifactCount: 0,
      recentScores: [],
      recentTrend: '0',
    });
  }
  return profiles.get(displayName);
}

/**
 * @param {string} displayName
 * @param {{ score: number, skillDelta?: Record<string, number> }} result
 */
function recordOutcome(displayName, result = {}) {
  const p = ensureProfile(displayName);
  const score = Number(result.score);
  if (Number.isFinite(score)) {
    p.recentScores.push(score);
    if (p.recentScores.length > 40) p.recentScores = p.recentScores.slice(-40);
    p.avgOutcome = p.recentScores.reduce((a, b) => a + b, 0) / p.recentScores.length;
    if (p.recentScores.length >= 7) {
      const recent = p.recentScores.slice(-7).reduce((a, b) => a + b, 0) / 7;
      const prior = p.recentScores.slice(-14, -7);
      const priorAvg = prior.length
        ? prior.reduce((a, b) => a + b, 0) / prior.length
        : recent;
      p.recentTrend = (recent - priorAvg >= 0 ? '+' : '') + (recent - priorAvg).toFixed(1);
    }
  }
  if (score >= 4) p.artifactCount += 1;

  const delta = result.skillDelta || {};
  for (const [skill, weight] of Object.entries(delta)) {
    const w = Number(weight) || 0;
    if (!w) continue;
    p.skills[skill] = Math.round(((p.skills[skill] || 0) + w) * 10) / 10;
  }
}

function ingestMemorySkills(displayName, memoryText) {
  const p = ensureProfile(displayName);
  const parsed = parseSkillTags(memoryText);
  for (const [skill, count] of Object.entries(parsed)) {
    const scaled = count * Math.max(0.4, (p.avgOutcome || 3) / 5);
    p.skills[skill] = Math.round(((p.skills[skill] || 0) + scaled) * 10) / 10;
  }
}

function getTeamProfile() {
  const out = {};
  for (const [name, p] of profiles.entries()) {
    out[name] = { ...p, recentScores: [...p.recentScores] };
  }
  return out;
}

function getNpcProfile(displayName) {
  const p = profiles.get(displayName);
  return p ? { ...p, recentScores: [...p.recentScores] } : null;
}

function getTeamGaps(minScore = 5) {
  const skillTotals = new Map();
  for (const p of profiles.values()) {
    for (const [skill, val] of Object.entries(p.skills || {})) {
      const arr = skillTotals.get(skill) || [];
      arr.push({ npc: p.display_name, score: val });
      skillTotals.set(skill, arr);
    }
  }
  const gaps = [];
  for (const [skill, entries] of skillTotals.entries()) {
    const top = entries.reduce((best, e) => (e.score > best.score ? e : best), { score: 0 });
    if (top.score < minScore) {
      gaps.push({
        skill,
        top_score: top.score,
        top_npc: top.npc || null,
        weak_npcs: entries.filter((e) => e.score < minScore).map((e) => e.npc),
      });
    }
  }
  return gaps.sort((a, b) => a.top_score - b.top_score);
}

module.exports = {
  recordOutcome,
  ingestMemorySkills,
  getTeamProfile,
  getNpcProfile,
  getTeamGaps,
  _profiles: profiles,
};
