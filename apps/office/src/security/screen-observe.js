'use strict';
/**
 * screen-observe.js — read-only screen understanding for any NPC.
 *
 * 1. Screenshot the CEO's real desktop (Brave, any app).
 * 2. Vision model describes what's visible (no mouse/keyboard unless asked).
 * 3. If unclear or no Brave Search API key, fall back to visible web-search / research.
 * 4. Optionally queue topics for Bob's research list (training material).
 */

const fs = require('node:fs');
const path = require('node:path');
const webResearch = require('../intelligence/web-research');

const desktopAgent = require('../compute/desktop-agent');

function autoResearchEnabled() {
  return String(process.env.SCREEN_OBSERVE_AUTO_RESEARCH || 'true').toLowerCase() !== 'false';
}

function queueTrainingEnabled() {
  return String(process.env.SCREEN_OBSERVE_QUEUE_RESEARCH || 'true').toLowerCase() !== 'false';
}

/**
 * @param {object} opts
 * @param {string} opts.npcName
 * @param {string} opts.instruction - CEO message / context
 * @param {function} [opts.broadcast]
 * @param {function} [opts.runWebSearch] - (npc, query) => Promise<{ok, summary}>
 * @param {function} [opts.injectSkillResult] - (npc, skill, text) => void
 * @param {function} [opts.queueResearch] - (topic, priority) => void
 */
async function runScreenObserve(opts = {}) {
  const npcName = String(opts.npcName || 'Lucy');
  const instruction = String(opts.instruction || 'Describe what is on my screen.').slice(0, 500);
  const broadcast = opts.broadcast || (() => {});

  broadcast({
    type: 'npc_skill_start',
    npcName,
    skill: 'screen-observe',
    skillParams: { instruction: instruction.slice(0, 120) },
    ts: Date.now(),
  });

  let observe;
  try {
    observe = await desktopAgent.runObserveOnly({ instruction, broadcast, npcName });
  } catch (err) {
    const msg = `Screen capture failed: ${err.message}`;
    if (opts.injectSkillResult) opts.injectSkillResult(npcName, 'screen-observe', msg);
    broadcast({ type: 'npc_skill_result', npcName, skill: 'screen-observe', ok: false, output: msg, ts: Date.now() });
    return { ok: false, summary: msg, screenshot: null };
  }

  if (!observe.ok) {
    const msg = observe.error || observe.summary || 'Could not read the screen.';
    if (opts.injectSkillResult) opts.injectSkillResult(npcName, 'screen-observe', msg);
    broadcast({ type: 'npc_skill_result', npcName, skill: 'screen-observe', ok: false, output: msg, ts: Date.now() });
    return { ok: false, summary: msg, screenshot: observe.screenshotB64 || null };
  }

  let summary = observe.summary || 'I looked at your screen but could not summarize it clearly.';
  const topics = Array.isArray(observe.topics) ? observe.topics.filter(Boolean).slice(0, 3) : [];
  const searchQuery = String(observe.searchQuery || '').trim()
    || (topics[0] ? `${topics[0]} overview` : '');

  const researchBits = [];

  if (autoResearchEnabled() && searchQuery && typeof opts.runWebSearch === 'function') {
    try {
      const wr = await webResearch.research(searchQuery, { count: 4, read: 1 });
      if (wr.error && !wr.results.length && opts.runWebSearch) {
        const browser = await opts.runWebSearch(npcName, searchQuery);
        if (browser?.ok && browser.summary) {
          researchBits.push(`\n\nWeb lookup (browser — no search API):\n${browser.summary.slice(0, 1200)}`);
        }
      } else if (wr.results.length) {
        researchBits.push(`\n\nWeb research for "${searchQuery}":\n${webResearch.formatForNpc(wr).slice(0, 1500)}`);
      }
    } catch (err) {
      if (opts.runWebSearch) {
        try {
          const browser = await opts.runWebSearch(npcName, searchQuery);
          if (browser?.ok && browser.summary) {
            researchBits.push(`\n\nWeb lookup (browser fallback):\n${browser.summary.slice(0, 1200)}`);
          }
        } catch (_) {}
      }
    }
  }

  if (queueTrainingEnabled() && typeof opts.queueResearch === 'function') {
    const toQueue = topics.length ? topics : (searchQuery ? [searchQuery] : []);
    for (const topic of toQueue.slice(0, 2)) {
      try { opts.queueResearch(topic, 'normal'); } catch (_) {}
    }
  }

  if (researchBits.length) summary += researchBits.join('');

  if (opts.injectSkillResult) opts.injectSkillResult(npcName, 'screen-observe', summary);
  broadcast({
    type: 'npc_skill_result',
    npcName,
    skill: 'screen-observe',
    ok: true,
    output: summary.slice(0, 300),
    screenshot: observe.screenshotB64 || null,
    ts: Date.now(),
  });
  broadcast({
    type: 'npc_report_to_ceo',
    npcName,
    text: summary.slice(0, 2000),
    ts: Date.now(),
  });

  return {
    ok: true,
    summary,
    screenshot: observe.screenshotB64 || null,
    topics,
    searchQuery: searchQuery || null,
  };
}

module.exports = { runScreenObserve, autoResearchEnabled };
