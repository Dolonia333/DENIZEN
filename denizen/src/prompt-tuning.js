'use strict';
/**
 * Central knobs for LLM prompt size, meeting rate, and think cadence.
 * Override via environment variables (see denizen/.env).
 *
 * DENIZEN_ECONOMY_MODE=true applies a bundled low-telemetry preset (fewer
 * thinks, no real-work nudges, longer skill cooldown).
 */

const { minPasswordLength, isDevPasswordRelaxed } = require('./denizen-team-password.js');

function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

function envFloat(name, fallback) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function envBool(name, fallback = false) {
  if (process.env[name] == null || process.env[name] === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(process.env[name]));
}

const economy = envBool('DENIZEN_ECONOMY_MODE', true);
const publicDemo = envBool('DENIZEN_PUBLIC_DEMO', false);

let _publicDemoFolders = null;
try {
  const demoRoster = require('./demo-roster');
  _publicDemoFolders = demoRoster.publicDemoNpcFolders(process.env);
} catch (_) {
  _publicDemoFolders = publicDemo ? ['abby', 'alex', 'lucy', 'bouncer'] : null;
}

module.exports = {
  economyMode: economy,
  publicDemoMode: publicDemo || !!_publicDemoFolders,
  publicDemoNpcFolders: _publicDemoFolders,
  publicDemoAnthropicKey: String(process.env.DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY || ''),
  publicDemoModel: String(process.env.DENIZEN_PUBLIC_DEMO_MODEL || 'claude-haiku-3-5-20241022'),
  publicDemoUseCloud: Boolean(
    process.env.DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY
    || (publicDemo && process.env.ANTHROPIC_API_KEY)
  ),
  memoryChars: envInt('DENIZEN_MEMORY_CHARS', economy ? 180 : 280),
  thinkMinMs: envInt('DENIZEN_THINK_MIN_MS', economy ? 150000 : 120000),
  thinkMaxMs: envInt('DENIZEN_THINK_MAX_MS', economy ? 240000 : 200000),
  thinkStaggerMs: envInt('DENIZEN_THINK_STAGGER_MS', economy ? 15000 : 10000),
  /** Min gap between ANY two NPC think LLM calls (serializes LM Studio queue). */
  globalThinkGapMs: envInt('DENIZEN_GLOBAL_THINK_GAP_MS', economy ? 12000 : 8000),
  npcMeetingCooldownMs: envInt('DENIZEN_NPC_MEETING_COOLDOWN_MS', economy ? 420000 : 300000),
  cofounderMeetingCooldownMs: envInt('DENIZEN_COFOUNDER_MEETING_COOLDOWN_MS', 300000),
  cofounderThinkMinMs: envInt('DENIZEN_COFOUNDER_THINK_MIN_MS', economy ? 60000 : 45000),
  cofounderThinkMaxMs: envInt('DENIZEN_COFOUNDER_THINK_MAX_MS', economy ? 120000 : 90000),
  /** Abby office-dispatcher LM timeout (JSON commands, not deep reasoning). */
  cofounderLmTimeoutMs: envInt('DENIZEN_COFOUNDER_LM_TIMEOUT_MS', economy ? 60000 : 90000),
  compactLiveContext: envBool('DENIZEN_COMPACT_LIVE_CONTEXT', true),
  compactThinkPrompt: envBool('DENIZEN_COMPACT_THINK_PROMPT', true),
  includePcAccessBlock: envBool('DENIZEN_INCLUDE_PC_ACCESS', false),
  infraContextChance: envFloat('DENIZEN_INFRA_CONTEXT_CHANCE', economy ? 0.04 : 0.06),
  codeContextChanceActive: envFloat('DENIZEN_CODE_CONTEXT_CHANCE_ACTIVE', economy ? 0.1 : 0.14),
  codeContextChanceIdle: envFloat('DENIZEN_CODE_CONTEXT_CHANCE_IDLE', economy ? 0.03 : 0.04),
  thinkMaxTokens: envInt('DENIZEN_THINK_MAX_TOKENS', economy ? 320 : 360),
  thinkSliceLen: envInt('DENIZEN_THINK_SLICE_LEN', economy ? 1200 : 1500),
  /** HTTP timeout for autonomous think() LM Studio calls (ms). */
  lmThinkTimeoutMs: envInt('DENIZEN_LM_THINK_TIMEOUT_MS', economy ? 90000 : 120000),
  /** HTTP timeout when think() uses the fast local slot (Gemma etc.). */
  lmThinkFastTimeoutMs: envInt('DENIZEN_LM_THINK_FAST_TIMEOUT_MS', 45000),
  /**
   * Route autonomous think() through lmstudio-fast (small JSON decisions).
   * SOUL Provider still applies to player chat and NPC↔NPC dialogue.
   */
  thinkUseFastModel: envBool('DENIZEN_THINK_USE_FAST_MODEL', true),
  /** Max chars of SOUL injected into autonomous think() (full SOUL still on disk). */
  thinkSoulMaxChars: envInt('DENIZEN_THINK_SOUL_MAX_CHARS', economy ? 720 : 1100),
  /** Anthropic prompt caching on static system blocks (BYOK / cloud NPC paths). */
  anthropicPromptCache: envBool('DENIZEN_ANTHROPIC_PROMPT_CACHE', true),
  evidenceRule: 'Do not claim you fixed, shipped, researched, or filed something unless you ran run_skill or produced an artifact this cycle. Say you will check instead.',
  autoClaimSprintTasks: envBool('DENIZEN_AUTO_CLAIM_SPRINT', !economy),
  /** Off by default — enables run_skill nudges (drives ~27% run_skill in telemetry). Set true to force real tools. */
  realWorkMode: envBool('DENIZEN_REAL_WORK_MODE', economy ? false : false),
  realWorkCyclesWithoutSkill: envInt('DENIZEN_REAL_WORK_CYCLES', economy ? 8 : 6),
  /** Hard cap: max autonomous run_skill per NPC per cooldown window (directives bypass). */
  runSkillCooldownMs: envInt('DENIZEN_RUN_SKILL_COOLDOWN_MS', 900000),
  runSkillMaxPerWindow: envInt('DENIZEN_RUN_SKILL_MAX_PER_WINDOW', 1),
  pauseThinkDuringCeoChat: envBool('DENIZEN_PAUSE_THINK_DURING_CEO_CHAT', true),
  /** On touch clients, stretch autonomous think cadence (client-side delay only). */
  mobileThinkMultiplier: envFloat('DENIZEN_MOBILE_THINK_MULTIPLIER', 2.5),
  /** Pause autonomous thinks while mobile CEO mode is active (client-side). */
  pauseThinksInCeoMode: envBool('DENIZEN_PAUSE_THINKS_CEO_MODE', true),
  skipThinkWhenSkillPending: envBool('DENIZEN_SKIP_THINK_WHEN_SKILL_PENDING', true),
  /** Algorithmic planner for routine think cycles — saves ~85% autonomous LLM calls. */
  hybridDirector: envBool('DENIZEN_HYBRID_DIRECTOR', economy),
  playerChatMaxTokens: envInt('DENIZEN_PLAYER_CHAT_MAX_TOKENS', economy ? 220 : 300),
  playerChatHistoryMsgs: envInt('DENIZEN_PLAYER_CHAT_HISTORY_MSGS', economy ? 4 : 8),
  /** Verbatim turns kept in the messages array when compaction is on. */
  playerChatRecentMsgs: envInt('DENIZEN_PLAYER_CHAT_RECENT_MSGS', economy ? 4 : 6),
  /** Compact older turns into a summary block once memory exceeds this count. */
  playerChatCompactAfter: envInt('DENIZEN_PLAYER_CHAT_COMPACT_AFTER', economy ? 6 : 10),
  playerChatSummaryChars: envInt('DENIZEN_PLAYER_CHAT_SUMMARY_CHARS', economy ? 400 : 520),
  playerChatCompaction: envBool('DENIZEN_PLAYER_CHAT_COMPACTION', true),
  playerChatMemoryChars: envInt('DENIZEN_PLAYER_CHAT_MEMORY_CHARS', economy ? 320 : 500),
  /** Shorter CEO/visitor chat system prompt — drops the 2k-token action catalog. */
  compactPlayerChat: envBool('DENIZEN_COMPACT_PLAYER_CHAT', true),
  playerChatTimeoutMs: envInt('DENIZEN_PLAYER_CHAT_TIMEOUT_MS', 45000),
  /** Visitor onboarding — team/demo org slugs and access codes (server-side only). */
  teamCode: String(process.env.DENIZEN_TEAM_CODE || '1921'),
  ceoAccessCode: String(process.env.DENIZEN_CEO_ACCESS_CODE || 'Dolonia').trim(),
  demoOrgSlug: String(process.env.DENIZEN_DEMO_ORG_SLUG || 'acme'),
  teamOrgSlug: String(process.env.DENIZEN_TEAM_ORG_SLUG || 'zion'),
  minPasswordLength: minPasswordLength(),
  devPasswordRelaxed: isDevPasswordRelaxed(),
};

const CEO_CODE_ALIASES = ['dolonia', 'deloonya'];

function ceoAccessCodeSet() {
  const codes = new Set(CEO_CODE_ALIASES);
  const list = String(process.env.DENIZEN_CEO_ACCESS_CODES || '');
  if (list) {
    for (const part of list.split(/[,;|]+/)) {
      const code = String(part || '').trim().toLowerCase();
      if (code) codes.add(code);
    }
  }
  const primary = String(process.env.DENIZEN_CEO_ACCESS_CODE || 'Dolonia').trim().toLowerCase();
  if (primary) codes.add(primary);
  return codes;
}

/** Serializable snapshot for GET /api/office-config (browser cannot read process.env). */
function toClientConfig() {
  const t = module.exports;
  return {
    economyMode: t.economyMode,
    thinkMinMs: t.thinkMinMs,
    thinkMaxMs: t.thinkMaxMs,
    thinkStaggerMs: t.thinkStaggerMs,
    globalThinkGapMs: t.globalThinkGapMs,
    pauseThinkDuringCeoChat: t.pauseThinkDuringCeoChat,
    pauseThinksInCeoMode: t.pauseThinksInCeoMode,
    mobileThinkMultiplier: t.mobileThinkMultiplier,
    realWorkMode: t.realWorkMode,
    hybridDirector: t.hybridDirector,
    compactPlayerChat: t.compactPlayerChat,
    playerChatHistoryMsgs: t.playerChatHistoryMsgs,
    visitorAccess: {
      demoOrgSlug: t.demoOrgSlug,
      teamOrgSlug: t.teamOrgSlug,
      teamCodeRequired: true,
      ceoAccessRequired: !!t.ceoAccessCode,
      minPasswordLength: t.minPasswordLength,
      devPasswordRelaxed: t.devPasswordRelaxed,
      publicUrl: String(process.env.DENIZEN_PUBLIC_URL || process.env.DENIZEN_URL || '').replace(/\/+$/, '') || null,
    },
    publicDemo: {
      enabled: !!t.publicDemoMode,
      readOnly: true,
      npcFolders: t.publicDemoNpcFolders || null,
      cloudProvider: !!t.publicDemoUseCloud,
      model: t.publicDemoUseCloud ? t.publicDemoModel : null,
    },
  };
}

/** Validate visitor access codes — never expose codes to the client. */
function verifyVisitorAccessCode(code, type) {
  const t = module.exports;
  const normalized = String(code || '').trim();
  if (type === 'team') {
    if (normalized && normalized.toLowerCase() === t.teamCode.toLowerCase()) {
      return { ok: true, org_slug: t.teamOrgSlug, tier: 'team' };
    }
    return { ok: false, error: 'Invalid team code' };
  }
  if (type === 'ceo') {
    const ceoCodes = ceoAccessCodeSet();
    if (ceoCodes.size === 0) {
      return { ok: true };
    }
    if (normalized && ceoCodes.has(normalized.toLowerCase())) {
      return { ok: true };
    }
    return { ok: false, error: 'Invalid CEO access code' };
  }
  return { ok: false, error: 'Invalid access type' };
}

module.exports.toClientConfig = toClientConfig;
module.exports.verifyVisitorAccessCode = verifyVisitorAccessCode;
module.exports.ceoAccessCodeSet = ceoAccessCodeSet;
