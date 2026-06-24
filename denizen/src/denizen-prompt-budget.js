'use strict';

/**
 * Prompt budget helpers — trim static NPC context and Anthropic cache blocks.
 */

function extractThinkIdentity(soul, role, maxChars = 720) {
  const normalised = String(soul || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sections = ['Core Identity', 'Role', 'Values'];
  const parts = [];
  for (const sec of sections) {
    const re = new RegExp(`## ${sec}\\n([\\s\\S]*?)(?=\\n## |$)`);
    const m = normalised.match(re);
    if (m) parts.push(`## ${sec}\n${m[1].trim()}`);
  }
  let out = parts.join('\n\n');
  if (!out.trim()) {
    out = normalised.replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
  }
  const cap = Math.max(200, Number(maxChars) || 720);
  if (out.length > cap) out = `${out.slice(0, cap)}…`;
  const roleLine = String(role || '').trim();
  if (roleLine && !out.includes('## Role')) {
    out = `${out}\n\n## Role\n${roleLine}`;
  }
  return out.trim();
}

function capText(text, maxChars) {
  const t = String(text || '').trim();
  const cap = Math.max(80, Number(maxChars) || 1200);
  if (t.length <= cap) return t;
  return `${t.slice(0, cap)}…`;
}

/**
 * Anthropic Messages API system blocks with optional prompt caching on static text.
 * @returns {string|Array<{type:string,text:string,cache_control?:object}>}
 */
function buildAnthropicSystem(staticText, dynamicText, opts = {}) {
  const enableCache = opts.enableCache !== false;
  const stat = String(staticText || '').trim();
  const dyn = String(dynamicText || '').trim();
  if (!enableCache) {
    return [stat, dyn].filter(Boolean).join('\n\n');
  }
  const blocks = [];
  if (stat) {
    blocks.push({
      type: 'text',
      text: stat,
      cache_control: { type: 'ephemeral' },
    });
  }
  if (dyn) blocks.push({ type: 'text', text: dyn });
  if (!blocks.length) return '';
  return blocks.length === 1 ? blocks : blocks;
}

function compactThinkUserPrompt(nudge, codeInstruction = '') {
  const head = [
    nudge,
    codeInstruction,
    'Respond with ONE JSON object only.',
    '{"action":"work|talk|visit|meeting|run_skill|break|wander","thought":"one sentence","message":"≤120 chars or empty","target":"","location":"desk","taskPhase":"continuing|finished","save":"brief note","outcome":"ok","skill":""}',
    'Prefer work or talk. run_skill only on direct order or sprint task.',
  ].filter(Boolean).join('\n\n');
  return head;
}

/**
 * Collapse older player-chat turns into a short summary; keep recent turns verbatim.
 * @param {Array<{from:string,text:string}>} memories
 * @param {string} npcName
 */
function compactChatHistory(memories, npcName, opts = {}) {
  const list = Array.isArray(memories) ? memories : [];
  const recentCount = Math.max(2, Number(opts.recentCount) || 4);
  const compactAfter = Math.max(recentCount + 2, Number(opts.compactAfter) || 8);
  const maxSummary = Math.max(120, Number(opts.maxSummaryChars) || 480);
  const enabled = opts.enabled !== false;

  const toMessage = (m) => ({
    role: m.from === npcName ? 'assistant' : 'user',
    content: m.from === npcName ? String(m.text || '') : `${m.from} says: "${String(m.text || '')}"`,
  });

  if (!enabled || list.length <= compactAfter) {
    const slice = list.slice(-Math.max(recentCount, Number(opts.maxMessages) || recentCount));
    return {
      messages: enforceAlternation(slice.map(toMessage)),
      contextSummary: '',
      conversationMsgs: slice.length,
      compactedTurns: 0,
    };
  }

  const older = list.slice(0, -recentCount);
  const recent = list.slice(-recentCount);
  const bulletCap = Math.min(8, older.length);
  const bullets = older.slice(-bulletCap).map((m) => {
    const who = m.from === npcName ? npcName : m.from;
    const text = String(m.text || '').replace(/\s+/g, ' ').slice(0, 80);
    return `- ${who}: ${text}${text.length >= 80 ? '…' : ''}`;
  });
  let contextSummary = `Earlier in this thread (${older.length} turns, compacted):\n${bullets.join('\n')}`;
  if (contextSummary.length > maxSummary) {
    contextSummary = `${contextSummary.slice(0, maxSummary)}…`;
  }

  return {
    messages: enforceAlternation(recent.map(toMessage)),
    contextSummary,
    conversationMsgs: recent.length,
    compactedTurns: older.length,
  };
}

/** Mistral/Ministral requires strict user/assistant alternation. */
function enforceAlternation(messages) {
  const out = [];
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const content = String(msg.content || '').trim();
    if (!content) continue;
    if (out.length > 0 && out[out.length - 1].role === role) {
      out[out.length - 1].content += ` ${content}`;
    } else {
      out.push({ role, content });
    }
  }
  if (out.length > 0 && out[0].role === 'assistant') out.shift();
  return out;
}

module.exports = {
  extractThinkIdentity,
  capText,
  buildAnthropicSystem,
  compactThinkUserPrompt,
  compactChatHistory,
  enforceAlternation,
};
