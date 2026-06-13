/**
 * NPC Brain System
 * Each NPC has their own AI brain powered by a different API provider.
 * When an NPC needs to respond in conversation, their brain generates the reply.
 * Falls back to Claude if the assigned provider fails.
 */

require('./load-env');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const npcRoster = require('./npc-roster');
const hallucinationGuard = require('./hallucination-guard');

// Shared world-state singleton + agent bus. Loaded lazily in a try/catch so
// older test fixtures that import npc-brains in isolation don't break.
let worldState = null;
let agentBus = null;
let llmTelemetry = null;
try { worldState = require('./world-state'); } catch (_) {}
try { agentBus = require('./agent-bus'); } catch (_) {}
try { llmTelemetry = require('./llm-telemetry'); } catch (_) {}
let lmStudioRouter = null;
try { lmStudioRouter = require('./lm-studio-router'); } catch (_) {}

// NPC real-work tools (Level 1/2/3). Lazy-loaded so the brains still work
// if npc-tools.js isn't present yet (e.g. during older test runs).
let npcTools = null;
try { npcTools = require('./npc-tools'); } catch (_) {}

let npcCapabilities = null;
try { npcCapabilities = require('./npc-capabilities'); } catch (_) {}

// Phase 3.2 — Task chain orchestration
let taskChain = null;
try { taskChain = require('./task-chain'); } catch (_) {}

// Phase 3.3 — NPC conflict detector (injects into Abby's prompt when NPCs disagree)
let conflictDetector = null;
try { conflictDetector = require('./conflict-detector'); } catch (_) {}

// Escalation engine — tracks blocked NPCs and fires escalations up the chain
const EscalationEngine = require('./escalation-engine');
// Permission registry — persists granted access so NPCs don't re-ask
const permissionRegistry = require('./permission-registry');

let visitorAccess = null;
try { visitorAccess = require('./visitor-access'); } catch (_) {}

let playerChatSkillBridge = null;
try { playerChatSkillBridge = require('./player-chat-skill-bridge'); } catch (_) {}

let denizenDb = null;
try { denizenDb = require('./denizen-db'); } catch (_) {}

let userIdentity = null;
try { userIdentity = require('./denizen-user-identity'); } catch (_) {}

// Broadcast function reference — set at server startup via setBroadcast()
let _broadcastFn = null;

// Clean console logger — replaces scattered console.log calls
const log = require('./logger');
let promptTuning = null;
try { promptTuning = require('./prompt-tuning'); } catch (_) {}
let officeDirector = null;
try { officeDirector = require('./office-director'); } catch (_) {}

let taskResourceAdvisor = null;

const REAL_WORK_SKILLS = new Set([
  'web-search', 'research', 'browserclaw', 'screen-observe', 'desktop-agent',
  'computer-use-agent', 'job-scraper', 'job-applier', 'trend-scraper',
  'platform-publish', 'coding-agent', 'github',
]);
try { taskResourceAdvisor = require('./task-resource-advisor'); } catch (_) {}

class NpcBrainManager {
  constructor() {
    this.providers = {};   // provider configs loaded from openclaw.json
    this.brains = {};      // npcName -> NpcBrain instance
    this.memories = {};    // npcName -> conversation history array
    this._visitorMemories = new Map(); // `${scopeId}:${npcName}` -> [{ from, text }]
    this._visitorMemHydrated = new Set();
    this._thinkCycles = {};    // npcName -> consecutive work cycles count
    this._lastDecisions = {};  // npcName -> last decision object
    this._taskProgress = {};   // npcName -> { task, phase, startedAt }
    this._pendingCascades = []; // queued cascade decisions to send downstream
    this._requestQueue = [];    // queue for LM Studio requests
    this._pendingSkillResults = new Map(); // npcName → {skill, result, ts}
    this._npcMoods = new Map();            // npcName → {mood, since, cycles}
    this._directives = new Map();          // npcName → {from, task, ts, urgent}
    this._commitments = new Map();         // npcName → [{ text, to, at, status }]  — promises the NPC made and must follow through on
    this._evidenceLog = new Map();         // npcName → { skillAt, researchAt, researchText, artifactAt } — what backs their claims
    this._pendingGrounding = new Map();    // npcName → grounding-check note to inject next think
    this._escalationEngine = new EscalationEngine(); // blocker tracking + escalation chain
    // Up to N concurrent inferences. LM Studio supports parallel
    // generation (server config "Parallel: 4"), and the Denizen mutex
    // For large models (27B+) keep to 1 concurrent request so the GPU
    // finishes one before starting the next — faster than juggling two.
    // Override via LM_STUDIO_PARALLEL env var if you want more.
    this._maxInflight = Math.max(1, Math.min(8, Number(process.env.LM_STUDIO_PARALLEL) || 1));
    this._inflightCount = 0;

    // Persistent intelligence state
    this._npcGoals = {};          // npcName -> { goal, createdAt, progress }
    this._dailyPlans = {};        // npcName -> { date, priorities:[], createdAt }
    this._npcRelationships = {};  // npcName -> { otherName: { interactions, lastMood } }
    this._eventFeed = [];         // recent office-wide events (bug, PR, visitor)
    this._sharedTasks = [];       // global task board visible to all NPCs
    this._sessionStart = new Date().toISOString().slice(0, 10);
    this._assistantProfilePath = path.join(__dirname, '..', 'data', 'assistant-profile.json');
    this._assistantProfile = this._loadAssistantProfile();
    this._companyBrief = this._loadCompanyBrief();

    this._loadProviders();
    this._cyclesSinceSkillRun = {};
    this._lastRunSkillAt = new Map();
    this._runSkillCountInWindow = new Map();
    this._sprintClaimDay = {};
    this._initBrains();
    this._applyLmStudioEnvPins();
    if (lmStudioRouter?.registerBootstrap) lmStudioRouter.registerBootstrap();
    if (promptTuning?.autoClaimSprintTasks !== false) {
      this._seedSprintTasksForAll();
    }
    // Wire every NPC to the shared message bus once brains exist. If the
    // bus module wasn't loaded (older test fixtures), this is a no-op.
    this.subscribeAllToBus();
  }

  _defaultAssistantProfile() {
    return {
      user: {
        name: 'CEO',
        communicationStyle: 'direct',
        timezone: 'local',
        preferences: ['Keep updates concise'],
      },
      projects: [],
      autonomyPolicy: {
        mode: 'confirm',
        allowAutonomousActions: true,
        safeDomains: [],
        restrictedDomains: [],
      },
      npcPolicies: {
        default: {
          personaDirective: 'Be proactive and clear.',
          autonomy: 'ask-then-act',
        },
      },
      recentDecisions: [],
    };
  }

  _loadAssistantProfile() {
    const fallback = this._defaultAssistantProfile();
    try {
      if (!fs.existsSync(this._assistantProfilePath)) return fallback;
      const parsed = JSON.parse(fs.readFileSync(this._assistantProfilePath, 'utf-8'));
      return {
        ...fallback,
        ...parsed,
        user: { ...fallback.user, ...(parsed.user || {}) },
        autonomyPolicy: { ...fallback.autonomyPolicy, ...(parsed.autonomyPolicy || {}) },
        npcPolicies: { ...fallback.npcPolicies, ...(parsed.npcPolicies || {}) },
        projects: Array.isArray(parsed.projects) ? parsed.projects : fallback.projects,
        recentDecisions: Array.isArray(parsed.recentDecisions) ? parsed.recentDecisions : fallback.recentDecisions,
      };
    } catch (err) {
      console.warn('[NpcBrains] Failed to load assistant profile:', String(err?.message || err));
      return fallback;
    }
  }

  _loadCompanyBrief() {
    try {
      const p = path.join(__dirname, '..', 'data', 'company-brief.json');
      if (!fs.existsSync(p)) return null;
      const brief = JSON.parse(fs.readFileSync(p, 'utf8'));
      console.log('[NpcBrains] Company brief loaded:', brief.company, '—', brief.product);
      return brief;
    } catch (err) {
      console.warn('[NpcBrains] Failed to load company-brief.json:', String(err?.message || err));
      return null;
    }
  }

  /**
   * Build a compact company + sprint context block for the think prompt.
   * Includes: company name, product description, sprint goal, and 3-5
   * role-specific tasks so the NPC knows exactly what they should be doing.
   */
  /**
   * Real-work flag for player chat — demo visitors never get tools;
   * CEO/non-visitor uses global promptTuning.realWorkMode.
   * Autonomous think loops call promptTuning.realWorkMode directly (office NPCs).
   */
  _resolveRealWorkMode(opts = {}) {
    if (!opts?.sessionId && !opts?.sessionTier) {
      return promptTuning?.realWorkMode !== false;
    }
    if (opts.canUseRealWork === true) return true;
    if (opts.canUseRealWork === false) return false;
    if (visitorAccess?.canUseRealWork) {
      return visitorAccess.canUseRealWork(
        opts.sessionMetadata || (opts.sessionTier ? { tier: opts.sessionTier } : {}),
        opts.orgSettings || null,
      );
    }
    return opts.sessionTier === 'team' || opts.sessionTier === 'ceo';
  }

  /** Player-initiated run_skill — gated by visitor session tier. */
  allowPlayerSkillRun(npcName, opts = {}) {
    if (!this._resolveRealWorkMode(opts)) {
      return { allowed: false, reason: 'demo session — real tools need team access' };
    }
    return this.allowAutonomousSkillRun(npcName, opts);
  }

  /**
   * When mesh is saturated, use visitor BYOK keys for player chat inference.
   */
  _resolveVisitorProviderOverrides(opts = {}) {
    if (!opts?.sessionId && !opts?.providerKeys) return null;
    if (!taskResourceAdvisor?.isMeshSaturated) return null;
    const meshCtx = opts.meshContext || {};
    if (!taskResourceAdvisor.isMeshSaturated(meshCtx)) return null;

    const keys = opts.providerKeys && typeof opts.providerKeys === 'object' ? opts.providerKeys : {};
    const anthropicKey = String(keys.anthropic || '').trim();
    if (anthropicKey && this.providers?.claude) {
      const base = this.providers.claude;
      return {
        primary: { ...base, apiKey: anthropicKey, providerKey: 'anthropic' },
        fallback: this.providers.lmstudio || base,
        source: 'visitor_byok_anthropic',
      };
    }
    return null;
  }

  _scopeId(officeContext = {}) {
    return officeContext?.officeId || officeContext?.identityId || 'global';
  }

  _officeRuntime(officeId) {
    const id = String(officeId || 'global');
    if (!this._officeRuntimes) this._officeRuntimes = new Map();
    let rt = this._officeRuntimes.get(id);
    if (!rt) {
      rt = {
        lastDecisions: {},
        taskProgress: {},
        thinkCycles: {},
        cyclesSinceSkillRun: {},
        lastThinkLlmAt: {},
        lastRunSkillAt: new Map(),
        pendingSkillResults: new Set(),
        directives: new Map(),
      };
      this._officeRuntimes.set(id, rt);
    }
    return rt;
  }

  _rt(officeContext) {
    return this._officeRuntime(this._scopeId(officeContext));
  }

  _resolveAutonomousRealWork(npcName, officeContext = {}) {
    if (officeContext?.visitorScoped) {
      return officeContext.canUseRealWork === true;
    }
    return promptTuning?.realWorkMode !== false;
  }

  _stampThinkContext(decision, officeContext) {
    if (decision && officeContext && typeof officeContext === 'object') {
      decision._officeContext = officeContext;
    }
    return decision;
  }

  async _buildTeamPurposeOverlay(identityId, visitorDisplayName) {
    if (!identityId || !userIdentity?.getNpcTeam) return '';
    try {
      const team = await userIdentity.getNpcTeam(identityId);
      const lines = [];
      if (team?.name) lines.push(`Team: ${team.name}`);
      if (team?.purpose) lines.push(`Mission: ${team.purpose}`);
      const roster = (team?.members || [])
        .filter((m) => m.active !== false)
        .map((m) => m.display_name || m.npc_key)
        .slice(0, 10);
      if (roster.length) lines.push(`Roster: ${roster.join(', ')}`);
      if (visitorDisplayName) {
        lines.push(`${visitorDisplayName} is online — prioritize work that helps their team.`);
      }
      return lines.length
        ? `\n\n## Visitor team mission\n${lines.join('\n')}`
        : '';
    } catch (_) {
      return '';
    }
  }

  /** Autonomous think-loop run_skill gate (directives + player chat bypass). */
  allowAutonomousSkillRun(npcName, opts = {}) {
    const skill = opts.skill;
    const officeContext = opts.officeContext || null;
    const rt = officeContext ? this._rt(officeContext) : null;
    const directives = rt?.directives || this._directives;
    const lastRunSkillAt = rt?.lastRunSkillAt || this._lastRunSkillAt;
    if (directives.has(npcName)) return { allowed: true };

    const skillKey = skill ? String(skill).toLowerCase() : '';
    if (officeContext?.visitorScoped && officeContext.canUseRealWork === false
      && skillKey && REAL_WORK_SKILLS.has(skillKey)) {
      return {
        allowed: false,
        reason: 'visitor session is demo — autonomous real tools need team access',
      };
    }

    const cd = promptTuning?.runSkillCooldownMs ?? 900000;
    const max = promptTuning?.runSkillMaxPerWindow ?? 1;
    const last = lastRunSkillAt.get(npcName) || 0;
    const elapsed = Date.now() - last;

    if (cd > 0 && last > 0 && elapsed < cd) {
      const remainingSec = Math.ceil((cd - elapsed) / 1000);
      return {
        allowed: false,
        remainingSec,
        reason: `skill cooldown (${remainingSec}s left, max ${max} per ${Math.round(cd / 60000)}min)`,
      };
    }

    if (npcName === 'Bouncer' && skill) {
      const sk = String(skill).toLowerCase();
      if (['nmap', 'zenmap', 'wireshark', 'linux-agent'].includes(sk)) {
        return { allowed: false, reason: 'Bouncer security tools are automatic' };
      }
    }

    return { allowed: true };
  }

  _recordAutonomousSkillRun(npcName) {
    this._lastRunSkillAt.set(npcName, Date.now());
    this._runSkillCountInWindow.set(npcName, (this._runSkillCountInWindow.get(npcName) || 0) + 1);
  }

  _getBouncerPlayerContext() {
    if (!worldState) return '';
    const lines = [];
    const hp = worldState.environment?.honeypot;
    if (hp?.active) {
      const pos = hp.position
        ? `(${Math.round(hp.position.x)}, ${Math.round(hp.position.y)})`
        : 'in the office';
      lines.push(`Honeypot is ACTIVE ${pos}. You are watching that spot; intruders within ~120px get caught automatically.`);
    } else {
      lines.push('Honeypot is NOT active. If the CEO asks, offer to deploy one (tempting desk/files area, 3 min watch).');
    }
    const threats = (worldState.activeThreats || []).slice(0, 4);
    if (threats.length) {
      for (const t of threats) {
        const src = t.source || 'unknown';
        const local = /^(::1|127\.|localhost)/i.test(String(src));
        lines.push(`Threat: ${t.category} from ${src}${local ? ' (localhost — likely your own game/server traffic, not a real attacker)' : ''} — ${(t.detail || '').slice(0, 80)}`);
      }
    } else {
      lines.push('No active intruders on the map right now.');
    }
    lines.push('Do NOT run_skill nmap/zenmap — Kali investigations are automatic with cooldown. Answer the CEO directly.');
    lines.push('When citing reports, use ONLY paths from "Latest security reports on disk" below — never invent filenames.');
    return lines.join('\n');
  }

  _getBouncerReportExcerpts(limit = 2) {
    const dir = path.join(__dirname, '..', 'reports', 'security');
    try {
      const files = fs.readdirSync(dir)
        .filter(f => /^bouncer_.*\.md$/i.test(f))
        .map(f => {
          const full = path.join(dir, f);
          return { f, m: fs.statSync(full).mtimeMs, full };
        })
        .sort((a, b) => b.m - a.m)
        .slice(0, limit);
      if (!files.length) return '(no bouncer_*.md reports on disk yet)';
      return files.map(({ f, full }) => {
        const body = fs.readFileSync(full, 'utf8');
        const status = (body.match(/\*\*Status:\*\*\s*([^\n]+)/i) || [])[1] || '';
        const assessment = (body.match(/## Assessment[\s\S]*?(?=\n## |\n\*\*Status:|$)/i) || [])[0] || body.slice(0, 480);
        return `reports/security/${f}\nStatus: ${status.trim()}\n${assessment.trim().slice(0, 420)}`;
      }).join('\n\n---\n\n');
    } catch (_) {
      return '(could not read reports/security)';
    }
  }

  _getCompanyContext(npcName) {
    const b = this._companyBrief;
    if (!b) return '';
    const brain = this.brains[npcName];
    const role = brain ? brain.role : '';
    const roleTasks = b.role_tasks ? (b.role_tasks[role] || []) : [];
    const taskLines = roleTasks.slice(0, 2).map(t => '- ' + t).join('\n');
    const sprintGoal = b.sprint ? b.sprint.goal : '';
    const desc = String(b.description || '').slice(0, 120);
    return [
      'Company: ' + b.company + ' | Product: ' + b.product,
      'What we build: ' + desc,
      'Sprint: ' + (b.sprint ? b.sprint.name : '') + (sprintGoal ? ' — ' + String(sprintGoal).slice(0, 80) : ''),
      'Current focus: ' + (Array.isArray(b.current_focus) ? b.current_focus.slice(0, 2).join('; ') : ''),
      '',
      (promptTuning?.realWorkMode
        ? 'Your sprint tasks (auto-claimed — run_skill then finish with artifact):'
        : 'Your sprint tasks (desk work default; run_skill only when truly blocked):'),
      taskLines || '- (no tasks defined for this role yet)',
    ].join('\n');
  }

  _saveAssistantProfile() {
    try {
      fs.writeFileSync(this._assistantProfilePath, JSON.stringify(this._assistantProfile, null, 2));
    } catch (err) {
      console.warn('[NpcBrains] Failed to save assistant profile:', String(err?.message || err));
    }
  }

  getAssistantProfile() {
    return JSON.parse(JSON.stringify(this._assistantProfile || this._defaultAssistantProfile()));
  }

  updateAssistantProfile(patch = {}) {
    if (!patch || typeof patch !== 'object') return this.getAssistantProfile();
    const next = this.getAssistantProfile();

    if (patch.user && typeof patch.user === 'object') {
      next.user = { ...next.user, ...patch.user };
      if (Array.isArray(patch.user.preferences)) next.user.preferences = patch.user.preferences.slice(0, 20);
    }
    if (Array.isArray(patch.projects)) {
      next.projects = patch.projects.slice(0, 20).map((p) => ({
        name: String(p?.name || 'Untitled').slice(0, 80),
        status: String(p?.status || 'active').slice(0, 32),
        priority: String(p?.priority || 'normal').slice(0, 16),
        notes: String(p?.notes || '').slice(0, 240),
      }));
    }
    if (patch.autonomyPolicy && typeof patch.autonomyPolicy === 'object') {
      next.autonomyPolicy = { ...next.autonomyPolicy, ...patch.autonomyPolicy };
      if (Array.isArray(patch.autonomyPolicy.safeDomains)) {
        next.autonomyPolicy.safeDomains = patch.autonomyPolicy.safeDomains.slice(0, 20).map(v => String(v).slice(0, 40));
      }
      if (Array.isArray(patch.autonomyPolicy.restrictedDomains)) {
        next.autonomyPolicy.restrictedDomains = patch.autonomyPolicy.restrictedDomains.slice(0, 20).map(v => String(v).slice(0, 40));
      }
    }
    if (patch.npcPolicies && typeof patch.npcPolicies === 'object') {
      next.npcPolicies = { ...next.npcPolicies, ...patch.npcPolicies };
    }

    this._assistantProfile = next;
    this._saveAssistantProfile();
    return this.getAssistantProfile();
  }

  _getNpcPolicy(npcName) {
    const p = this._assistantProfile?.npcPolicies || {};
    return p[npcName] || p.default || { personaDirective: 'Be proactive and clear.', autonomy: 'ask-then-act' };
  }

  _visitorScopeId(opts) {
    if (!opts) return null;
    return opts.identityId || opts.sessionId || null;
  }

  _visitorMemKey(scopeId, npcName) {
    return `${scopeId}:${npcName}`;
  }

  async _hydrateVisitorMemories(opts, npcName) {
    const scopeId = this._visitorScopeId(opts);
    if (!scopeId || !opts?.identityId || !userIdentity?.isEnabled?.()) return;
    const key = this._visitorMemKey(scopeId, npcName);
    if (this._visitorMemHydrated.has(key)) return;
    this._visitorMemHydrated.add(key);
    try {
      const npcKey = this._npcKeyForName(npcName);
      const rows = await userIdentity.loadNpcChatHistory(opts.identityId, npcKey);
      const mapped = userIdentity.mapChatRowsToMemories(
        rows,
        npcName,
        opts.displayName || 'Guest',
      );
      if (mapped.length) {
        this._visitorMemories.set(key, mapped.slice(-50));
      }
    } catch (_) {}
  }

  _getVisitorMemories(scopeId, npcName) {
    const key = this._visitorMemKey(scopeId, npcName);
    if (!this._visitorMemories.has(key)) {
      this._visitorMemories.set(key, []);
    }
    return this._visitorMemories.get(key);
  }

  _pushVisitorMemory(scopeId, npcName, from, text, opts) {
    const sanitized = this._sanitize(text);
    const mem = this._getVisitorMemories(scopeId, npcName);
    mem.push({ from, text: sanitized });
    if (mem.length > 50) {
      this._visitorMemories.set(this._visitorMemKey(scopeId, npcName), mem.slice(-50));
    }
    if (opts?.identityId && userIdentity?.saveNpcChatTurn) {
      const npcKey = this._npcKeyForName(npcName);
      const role = from === npcName ? 'npc' : 'user';
      userIdentity.saveNpcChatTurn({
        identityId: opts.identityId,
        npcKey,
        role,
        content: sanitized,
        sessionId: opts.sessionId,
      });
    }
  }

  _npcKeyForName(npcName) {
    try {
      const npcRoster = require('./npc-roster');
      const entry = (npcRoster.entries || []).find(e => e.display === npcName);
      if (entry?.folder) return entry.folder;
    } catch {}
    return String(npcName || '').toLowerCase();
  }

  async _buildTeamMemberOverlay(identityId, npcName) {
    if (!identityId || !userIdentity?.getNpcTeam) return '';
    try {
      const team = await userIdentity.getNpcTeam(identityId);
      const key = this._npcKeyForName(npcName);
      const member = (team?.members || []).find((m) => String(m.npc_key).toLowerCase() === key);
      if (!member) return '';
      const lines = [];
      if (member.display_name) lines.push(`This teammate calls you ${member.display_name}.`);
      if (member.role) lines.push(`Your role for them: ${member.role}.`);
      if (member.job) lines.push(`Current job assignment: ${member.job}.`);
      if (member.focus) lines.push(`Focus area: ${member.focus}`);
      if (member.instructions) {
        lines.push('Follow these teammate instructions (seed for your SOUL/MEMORY growth):');
        lines.push(member.instructions);
      }
      return lines.length
        ? `\n\n## Teammate NPC profile\n${lines.join('\n')}`
        : '';
    } catch (_) {
      return '';
    }
  }

  _isVisitorAssistantForNpc(npcName, assistant) {
    if (!assistant?.npc_key) return false;
    const key = String(assistant.npc_key).toLowerCase();
    return key === this._npcKeyForName(npcName) || key === String(npcName).toLowerCase();
  }

  _detectHandoffIntent(message) {
    const text = typeof message === 'string' ? message.trim() : String(message ?? '').trim();
    if (!text) return null;

    const patterns = [
      { re: /tell\s+lucy(?:\s+about)?\s*(.*)$/i, toCeo: true, toDisplayName: 'Lucy' },
      { re: /hand\s+(?:this|it)\s+off\s+to\s+lucy(?:\s*[:\-]?\s*(.*))?$/i, toCeo: true, toDisplayName: 'Lucy' },
      { re: /message\s+(?:the\s+)?ceo(?:\s*[:\-]?\s*(.*))?$/i, toCeo: true, toDisplayName: 'Lucy' },
    ];

    for (const { re, toCeo, toDisplayName } of patterns) {
      const match = text.match(re);
      if (!match) continue;
      const extracted = (match[1] || text).trim();
      return {
        toCeo,
        toDisplayName,
        message: extracted || text,
      };
    }
    return null;
  }

  _pendingHandoffsPromptBlock(pendingHandoffs) {
    const items = Array.isArray(pendingHandoffs) ? pendingHandoffs : [];
    if (!items.length) return '';

    const lines = items.map((h, i) => {
      const from = h.from_npc || 'assistant';
      const body = String(h.message || '').slice(0, 200);
      return `${i + 1}. From ${from}: "${body}"`;
    });
    return [
      '## Pending assistant handoffs (acknowledge these)',
      ...lines,
      'Briefly acknowledge any new handoffs in your reply when relevant.',
    ].join('\n');
  }

  _groupChatPromptBlock(groupChat) {
    if (!groupChat || typeof groupChat !== 'object') return '';
    const members = Array.isArray(groupChat.members) ? groupChat.members : [];
    const recent = Array.isArray(groupChat.recentMessages) ? groupChat.recentMessages.slice(-10) : [];
    const turn = Array.isArray(groupChat.turnReplies) ? groupChat.turnReplies : [];
    const lines = [
      '## Group chat',
      `Thread: ${groupChat.groupName || 'Group'}`,
      `Participants: ${members.join(', ')}`,
      'This is a group text thread. Other coworkers may also reply. Keep your message short (1-3 sentences).',
      'You may respond to the user or briefly react to what another coworker just said in this turn.',
    ];
    if (recent.length) {
      lines.push('', '## Recent messages');
      recent.forEach((m) => lines.push(`${m.from}: ${String(m.text || '').slice(0, 200)}`));
    }
    if (turn.length) {
      lines.push('', '## Replies already sent this turn (you may build on these)');
      turn.forEach((m) => lines.push(`${m.from}: ${String(m.text || '').slice(0, 200)}`));
    }
    return lines.join('\n');
  }

  _visitorProfilePromptBlock(npcName, visitorContext) {
    const { displayName, assistant, projects, deepProfile, openCommitments } = visitorContext || {};
    const name = displayName || 'User';
    const focus = assistant?.focus;
    const roleOverlay = assistant?.role_overlay;
    const assistantName = assistant?.assistant_name || npcName;
    const projectList = Array.isArray(projects) ? projects : [];
    const profile = deepProfile || {};

    const lines = [
      '## Visitor Personal Assistant Context',
      `User: ${name} (not the CEO)`,
      `They claimed you (${npcName}) as their personal assistant${assistantName !== npcName ? ` ("${assistantName}")` : ''}.`,
      'You are THEIR chief of staff in their private office. Greet the CEO by name and prioritize their mission.',
    ];
    if (focus) {
      lines.push(`Focus area: ${focus}`);
    }
    if (roleOverlay) {
      lines.push(`Role overlay: ${roleOverlay}`);
    }

    const prefs = Array.isArray(profile.preferences) ? profile.preferences.slice(0, 5) : [];
    if (prefs.length) {
      lines.push('', '## Remembered preferences');
      prefs.forEach((p) => lines.push(`- ${p}`));
    }
    const vips = Array.isArray(profile.vips) ? profile.vips.slice(0, 5) : [];
    if (vips.length) {
      lines.push('', '## VIP contacts');
      vips.forEach((v) => lines.push(`- ${v.name || v}${v.note ? `: ${v.note}` : ''}`));
    }
    if (profile.writing_style) {
      lines.push(`Writing style: ${String(profile.writing_style).slice(0, 120)}`);
    }
    if (profile.long_horizon) {
      lines.push('', '## Long-horizon context');
      lines.push(String(profile.long_horizon).slice(0, 400));
    }

    if (projectList.length) {
      lines.push('', '## Their active projects');
      projectList.forEach((p, i) => {
        const projName = p.name || 'Untitled';
        const status = p.status || 'active';
        const notes = String(p.notes || '').slice(0, 80);
        lines.push(`${i + 1}. ${projName} [${status}]${notes ? ` ${notes}` : ''}`);
      });
    }

    const commits = Array.isArray(openCommitments) ? openCommitments.slice(0, 4) : [];
    if (commits.length) {
      lines.push('', '## Open commitments (follow through or update status)');
      commits.forEach((c, i) => {
        lines.push(`${i + 1}. ${c.text || c}${c.npc_key ? ` [${c.npc_key}]` : ''}`);
      });
    }

    lines.push('Always align with their priorities while respecting office norms.');
    lines.push('When citing research, use [1], [2] style references matching provided sources.');
    return lines.join('\n');
  }

  _assistantProfilePromptBlock(npcName) {
    const profile = this._assistantProfile || this._defaultAssistantProfile();
    const user = profile.user || {};
    const projects = Array.isArray(profile.projects) ? profile.projects : [];
    const pol = profile.autonomyPolicy || {};
    const npcPolicy = this._getNpcPolicy(npcName);

    const prefs = Array.isArray(user.preferences) ? user.preferences.slice(0, 3) : [];
    const prefsText = prefs.length ? prefs.map(p => `- ${p}`).join('\n') : '- (none set)';
    const projText = projects.length
      ? projects.slice(0, 2).map((p, i) => `${i + 1}. ${p.name} [${p.status || 'active'}] ${String(p.notes || '').slice(0, 60)}`).join('\n')
      : '1. (no active project notes yet)';
    const safeText = Array.isArray(pol.safeDomains) && pol.safeDomains.length
      ? pol.safeDomains.join(', ')
      : '(not specified)';
    const restrictedText = Array.isArray(pol.restrictedDomains) && pol.restrictedDomains.length
      ? pol.restrictedDomains.join(', ')
      : '(not specified)';

    return [
      '## Persistent User & Project Memory',
      `User: ${user.name || 'CEO'} | style: ${user.communicationStyle || 'direct'} | timezone: ${user.timezone || 'local'}`,
      'User preferences:',
      prefsText,
      '',
      'Current projects:',
      projText,
      '',
      'Autonomy policy:',
      `- mode: ${pol.mode || 'confirm'}`,
      `- allowAutonomousActions: ${pol.allowAutonomousActions !== false}`,
      `- safeDomains: ${safeText}`,
      `- restrictedDomains: ${restrictedText}`,
      '',
      `Your NPC policy: autonomy=${npcPolicy.autonomy || 'ask-then-act'}; directive=${npcPolicy.personaDirective || ''}`,
      'Always align decisions with these constraints and preferences.',
    ].join('\n');
  }

  _recordAssistantDecision(npcName, entry, opts) {
    if (opts?.sessionId) return;
    if (!this._assistantProfile) this._assistantProfile = this._defaultAssistantProfile();
    const arr = Array.isArray(this._assistantProfile.recentDecisions)
      ? this._assistantProfile.recentDecisions
      : [];
    arr.push({
      at: new Date().toISOString(),
      npc: npcName,
      action: String(entry?.action || '').slice(0, 40),
      summary: String(entry?.summary || '').slice(0, 180),
      outcome: String(entry?.outcome || '').slice(0, 24),
    });
    this._assistantProfile.recentDecisions = arr.slice(-120);
    this._saveAssistantProfile();
  }

  _loadProviders() {
    try {
      const { getConfig } = require('../jelly/config-provider');
      const config = getConfig();
      const p = config?.models?.providers || {};

      // Map each provider to a simple config. Each entry honors a `model`
      // override from openclaw.json so users can pin a specific snapshot
      // without editing this file. The defaults track the current
      // generation of each vendor's small/fast tier.
      if (p.anthropic?.apiKey) {
        // openclaw.json stores models in an array — pick the fastest (haiku-tier)
        // model by looking for 'haiku' in the id, falling back to [0] if not found.
        const anthropicModels = p.anthropic.models || [];
        const haikuModel = anthropicModels.find(m => m.id?.includes('haiku'));
        this.providers.claude = {
          baseUrl: 'https://api.anthropic.com',
          apiKey: p.anthropic.apiKey,
          model: p.anthropic.model || haikuModel?.id || anthropicModels[0]?.id || 'claude-haiku-3-5-20241022',
          type: 'anthropic',
        };
      }
      if (p.google?.apiKey) {
        const googleModels = p.google.models || [];
        const flashModel = googleModels.find(m => m.id?.includes('flash'));
        this.providers.gemini = {
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: p.google.apiKey,
          model: p.google.model || flashModel?.id || googleModels[0]?.id || 'gemini-2.5-flash',
          type: 'google',
        };
      }
      if (p.xai?.apiKey) {
        const xaiModels = p.xai.models || [];
        // Prefer the current flagship (grok-4.x), falling back to first listed.
        const grokModel = xaiModels.find(m => m.id?.includes('grok-4') && !m.id?.includes('fast'))
          || xaiModels.find(m => m.id?.includes('grok-4'))
          || xaiModels[0];
        this.providers.grok = {
          baseUrl: 'https://api.x.ai',
          apiKey: p.xai.apiKey,
          model: p.xai.model || grokModel?.id || 'grok-4.3',
          type: 'openai',
        };
      }
      if (p.moonshot?.apiKey) {
        const kimiModels = p.moonshot.models || [];
        const kimi2Model = kimiModels.find(m => m.id?.includes('k2') && !m.id?.includes('thinking'));
        this.providers.kimi = {
          baseUrl: p.moonshot.baseUrl || 'https://api.moonshot.cn',
          apiKey: p.moonshot.apiKey,
          model: p.moonshot.model || kimi2Model?.id || kimiModels[0]?.id || 'kimi-k2',
          type: 'openai',
        };
      }

      // LM Studio — local OpenAI-compatible API
      // Model auto-synced at startup via syncLmStudioModel().
      const lmBase = String(
        process.env.LM_STUDIO_URL || process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234',
      ).replace(/\/v1\/?$/, '').replace(/\/+$/, '');
      this.providers.lmstudio = {
        baseUrl: lmBase,
        apiKey: process.env.LM_STUDIO_API_KEY || 'lm-studio',
        model: process.env.LM_STUDIO_MODEL || 'mistralai/ministral-3-14b-reasoning',
        type: 'lmstudio',
      };
      // Second local model slot — fast-tier NPCs (Gemma 4 by default).
      this.providers['lmstudio-fast'] = {
        baseUrl: lmBase,
        apiKey: process.env.LM_STUDIO_API_KEY || 'lm-studio',
        model: process.env.LM_STUDIO_FAST_MODEL || 'google/gemma-4-e2b',
        type: 'lmstudio',
      };

      console.log(`[NpcBrains] Loaded providers: ${Object.keys(this.providers).join(', ')}`);
    } catch (err) {
      console.warn('[NpcBrains] No jelly.json found — running in demo mode (no API keys needed)');
    }

    // Always register a 'demo' provider as ultimate fallback
    // This ensures NPCs load even with zero API keys configured
    if (!this.providers.demo) {
      this.providers.demo = { type: 'demo', baseUrl: null, apiKey: null, model: null };
    }
    const localProviders = new Set(['demo', 'lmstudio', 'lmstudio-fast']);
    const remoteCount = Object.keys(this.providers).filter(k => !localProviders.has(k)).length;
    this._demoMode = remoteCount === 0; // demo mode only when zero remote providers configured
    if (this._demoMode) {
      console.log('[NpcBrains] Demo mode active — NPCs use smart scripted responses (no API keys required)');
    }
  }

  _initBrains() {
    // Load NPC identities from soul files (OpenClaw pattern)
    const npcsDir = path.join(__dirname, '..', 'npcs');

    for (const { folder, display } of npcRoster.entries) {
      const name = display;
      const soulPath = path.join(npcsDir, folder, 'SOUL.md');
      const memoryPath = path.join(npcsDir, folder, 'MEMORY.md');

      let soul = '', longTermMemory = '';
      try { soul = fs.readFileSync(soulPath, 'utf-8'); } catch (_) {}
      try { longTermMemory = fs.readFileSync(memoryPath, 'utf-8'); } catch (_) {}

      // Parse provider and role from SOUL.md sections (CRLF-safe for Windows checkouts)
      const providerMatch = soul.match(/## Provider\r?\n([\w-]+)/);
      const roleMatch = soul.match(/## Role\r?\n(.+)/);
      const capMatch = soul.match(/## What You Can Do\r?\n([\s\S]+?)(?=\r?\n## )/);
      const provider = providerMatch?.[1] || 'lmstudio';
      const role = roleMatch?.[1]?.trim() || 'Employee';
      const capabilitiesSoul = capMatch ? capMatch[1].trim() : null;

      const baseProviderConfig = this.providers[provider] || this.providers.lmstudio || this.providers.demo;
      const providerConfig = { ...baseProviderConfig, providerKey: provider };

      this.brains[name] = {
        provider,
        role,
        // Trimmed personality: drops sections that are redundant with voiceAnchor
        // (Personality Quirks, Idle Phrases, Memory & Callbacks) to save ~150-250
        // tokens per call. Full SOUL.md is still on disk; only the prompt copy shrinks.
        personality: this._trimSoulForPrompt(soul),
        longTermMemory,
        providerConfig,
        fallbackConfig: null, // No paid API fallback — go straight to canned responses
        voiceAnchor: this._buildVoiceAnchor(soul, name), // injected at END of prompt
        capabilitiesSoul,
      };
      this.memories[name] = [];

      console.log(`[NpcBrains] ${name} (${role}) -> ${provider} [SOUL.md loaded]`);
    }
  }

  /** Pick one sprint line from company-brief for this NPC (stable per day). */
  _autoClaimSprintTask(npcName, { force = false } = {}) {
    if (promptTuning?.autoClaimSprintTasks === false) return;
    if (this._directives.has(npcName)) return;
    if (this._taskProgress[npcName] && !force) return;

    const brain = this.brains[npcName];
    const b = this._companyBrief;
    if (!brain || !b?.role_tasks) return;

    const tasks = b.role_tasks[brain.role];
    if (!Array.isArray(tasks) || !tasks.length) return;

    const today = new Date().toISOString().slice(0, 10);
    if (!force && this._sprintClaimDay[npcName] === today) return;

    const idx = [...npcName].reduce((a, c) => a + c.charCodeAt(0), 0) % tasks.length;
    const task = String(tasks[idx]).slice(0, 120);

    this._taskProgress[npcName] = {
      task,
      phase: 'claimed',
      startedAt: new Date().toLocaleTimeString(),
      sprint: true,
    };
    this._sprintClaimDay[npcName] = today;
    console.log(`[NpcBrains] ${npcName} claimed sprint task: ${task.slice(0, 60)}…`);
  }

  _seedSprintTasksForAll() {
    for (const name of Object.keys(this.brains)) {
      this._autoClaimSprintTask(name);
    }
  }

  /**
   * Save a memory entry to an NPC's MEMORY.md file (persistent across sessions)
   */
  // Display name -> folder name mapping
  _nameToFolder = {
    'Abby': 'abby', 'Alex': 'alex', 'Bob': 'bob', 'Jenny': 'jenny',
    'Dan': 'dan', 'Lucy': 'lucy', 'Bouncer': 'bouncer',
    'Marcus': 'conference_man', 'Sarah': 'conference_woman',
    'Edward': 'edward', 'Josh': 'josh', 'Molly': 'molly',
    'Oscar': 'oscar', 'Pier': 'pier', 'Rob': 'rob', 'Roki': 'roki',
  };

  saveMemory(npcName, entry) {
    const brain = this.brains[npcName];
    if (!brain) return;
    const folder = this._nameToFolder[npcName];
    if (!folder) {
      console.warn(`[NpcBrains] saveMemory: no folder mapping for "${npcName}"`);
      return;
    }
    try {
      const memPath = path.join(__dirname, '..', 'npcs', folder, 'MEMORY.md');
      const timestamp = new Date().toISOString().slice(0, 16);
      const newLine = `\n- [${timestamp}] ${entry}`;

      // Cap memory file at 200 lines to prevent unbounded growth
      let existing = '';
      try { existing = fs.readFileSync(memPath, 'utf-8'); } catch (_) {}
      const lines = existing.split('\n').filter(l => l.trim());
      if (lines.length >= 200) {
        // Trim oldest 50 entries, keeping the most recent 150
        const trimmed = lines.slice(lines.length - 150);
        fs.writeFileSync(memPath, trimmed.join('\n') + newLine);
      } else {
        fs.appendFileSync(memPath, newLine);
      }

      // Extract topic tag from the entry for searchable memory
      const topicMatch = entry.match(/(?:about|on|regarding|for|working on|fixing|building|reviewing|discussing)\s+(?:the\s+)?([a-zA-Z][a-zA-Z0-9\s-]{2,25})/i);
      if (topicMatch) {
        const topic = topicMatch[1].trim().toLowerCase().replace(/\s+/g, '-').slice(0, 20);
        const topicEntry = `- [${new Date().toISOString().slice(0, 16)}] [TOPIC:${topic}] ${entry.slice(0, 100)}`;
        fs.appendFileSync(memPath, topicEntry + '\n');
      }

      // Auto-detect learning events and track skills
      if (/learned|taught|figured out|now understand|picked up|got better at|improved/i.test(entry)) {
        const skillMatch = entry.match(/(?:about|at|in|with|regarding)\s+([a-zA-Z][a-zA-Z0-9\s]{2,20})/i);
        if (skillMatch) {
          const skill = skillMatch[1].trim().toLowerCase().replace(/\s+/g, '-').slice(0, 20);
          const skillEntry = `- [${new Date().toISOString().slice(0, 16)}] [SKILL:${skill}:+1] ${entry.slice(0, 80)}`;
          fs.appendFileSync(memPath, skillEntry + '\n');
        }
      }

      brain.longTermMemory = fs.readFileSync(memPath, 'utf-8');

      if (denizenDb?.enabled && denizenDb.orgId) {
        denizenDb.insertNpcMemory({
          orgId: denizenDb.orgId,
          npcKey: folder,
          body: entry,
          source: 'npc_brain',
        }).catch((err) => {
          console.warn(`[NpcBrains] DB memory sync failed for ${npcName}:`, err?.message || err);
        });
      }
    } catch (err) {
      console.warn(`[NpcBrains] Failed to save memory for ${npcName}:`, String(err?.message ?? err));
    }
  }

  /**
   * Merge recent DB memories into brain prompts (MCP + npc_brain sources).
   * File MEMORY.md remains the fallback when DB is empty or unavailable.
   */
  async refreshDbMemories() {
    if (!denizenDb?.enabled || !denizenDb.orgId) return { ok: false, reason: 'db_unavailable' };

    let merged = 0;
    for (const [name, brain] of Object.entries(this.brains)) {
      const folder = this._nameToFolder[name];
      if (!folder) continue;
      try {
        const rows = await denizenDb.listNpcMemories({
          orgId: denizenDb.orgId,
          npcKey: folder,
          limit: 40,
        });
        if (!rows?.length) continue;

        const dbBlock = rows
          .map((r) => `- [${String(r.recorded_at || '').slice(0, 16)}] ${r.body}`)
          .join('\n');
        const filePart = brain.longTermMemory || '';
        brain.longTermMemory = `## Synced memories (database)\n${dbBlock}\n\n## File memories\n${filePart}`;
        merged += 1;
      } catch (err) {
        console.warn(`[NpcBrains] refreshDbMemories failed for ${name}:`, err?.message || err);
      }
    }

    if (merged > 0) {
      console.log(`[NpcBrains] refreshed DB memories for ${merged} NPC(s)`);
    }
    return { ok: true, merged };
  }

  /**
   * Seed or retrieve a persistent long-term goal for an NPC.
   * Goals give the brain something to pull toward across think cycles —
   * otherwise every cycle starts from scratch and NPCs drift.
   */
  _getGoalContext(npcName) {
    if (!this._npcGoals[npcName]) {
      const brain = this.brains[npcName];
      if (!brain) return '';
      // Derive a starter goal from role — gets refined as they work
      const roleGoals = {
        'CTO': 'Keep the Denizen team unblocked and shipping Sprint 4 on time',
        'Developer': 'Ship the NPC immersion features cleanly — no regressions on main',
        'Frontend Developer': 'Land the work output feed panel and fix the speech bubble overflow',
        'Backend Developer': 'Fix the WebSocket deduplication bug and ship the delegation endpoint',
        'Project Manager': 'Make sure every Sprint 4 task has an owner and a deadline',
        'Product Manager': 'Define what Sprint 5 looks like before Sprint 4 closes',
        'Intern': 'Learn one new system this week by reading source and asking questions',
        'QA Engineer': 'Catch every regression in the new NPC behavior systems before they ship',
        'UI/UX Designer': 'Make the work output feed feel like a natural part of the HUD',
        'DevOps Engineer': 'Keep the LM Studio inference pipeline healthy — no dropped requests',
        'Data Engineer': 'Get the NPC decision log schema designed and reviewed this sprint',
        'Researcher': 'Find one insight from the latest AI agent research that changes our roadmap',
        'IT Support': 'Keep every service healthy — nothing should be blocking the dev team',
        'Receptionist (also handles CEO email triage as Secretary)': 'Keep Zion unblocked — clear the inbox and the calendar',
        'Security Guard': 'Nothing unauthorized touches Denizen infrastructure',
      };
      const starter = roleGoals[brain.role] || 'Do good work and help the team';
      this._npcGoals[npcName] = {
        goal: starter,
        createdAt: new Date().toISOString().slice(0, 10),
        progress: 0,
      };
    }
    const g = this._npcGoals[npcName];
    return `This Week: ${g.goal}`;
  }

  /**
   * Generate or retrieve today's plan for an NPC — ~3 priorities for the day.
   * Plans are generated once per day per NPC from their role + recent memory,
   * then injected into every think prompt so actions point at something concrete.
   */
  getDailyPlan(npcName) {
    const today = new Date().toISOString().slice(0, 10);
    const existing = this._dailyPlans[npcName];
    if (existing && existing.date === today) return existing;

    const brain = this.brains[npcName];
    if (!brain) return null;

    // Derive 3 concrete priorities from role, goal, and recent memory
    const recentMem = (brain.longTermMemory || '').split('\n')
      .filter(l => l.trim())
      .slice(-8);
    const goal = this._npcGoals[npcName]?.goal || '';

    // Role-derived default priorities. LLM refines these later in normal thinking.
    const rolePriorities = {
      'CTO': ['Check in with every team lead on Sprint 4 status', 'Unblock any task stalled more than a day', 'Review the Denizen roadmap and set Sprint 5 goals'],
      'Developer': ['Finish the NPC behavior system task I am on', 'Review a teammate PR before EOD', 'Fix the ambient chatter double-speak bug if it is in my lane'],
      'Frontend Developer': ['Finish the work output feed panel UI', 'Fix NPC speech bubble text overflow', 'Get Josh\'s changes reviewed before merge'],
      'Backend Developer': ['Fix the WebSocket deduplication issue', 'Implement the npc_work_output broadcast', 'Review the think prompt injection with Edward'],
      'Project Manager': ['Run today\'s standup and update the sprint board', 'Find and escalate any blocked tasks', 'Coordinate the backend-to-QA handoff for the new endpoints'],
      'Product Manager': ['Draft the Sprint 5 backlog priorities', 'Review Marcus and Sarah\'s feedback on the demo', 'Spec the NPC delegation chain feature'],
      'Intern': ['Ask Alex for a concrete Denizen task to help with', 'Read the agent-office-manager.js source and take notes', 'Write documentation for the idle behavior methods'],
      'QA Engineer': ['Run regression tests on the new proximity acknowledgment system', 'File bugs from today\'s test pass with reproduction steps', 'Talk to Alex about the ambient chatter timing issue'],
      'UI/UX Designer': ['Finish mockups for the work output feed panel', 'Walk the floor and get feedback on the mood indicator dot', 'Export the idle behavior animation frames for the dev team'],
      'DevOps Engineer': ['Check LM Studio queue depth and server memory', 'Verify the ElevenLabs cache is not filling up', 'Review the Docker Compose config for production'],
      'Data Engineer': ['Check the NPC decision log schema draft with Pier', 'Write the LM Studio metrics pipeline query', 'Document the world-state data model'],
      'Researcher': ['Read one paper on LLM prompt compression and summarize', 'Benchmark Qwen2.5-14B think loop latency and report findings', 'Share research notes with the team in the breakroom'],
      'IT Support': ['Check Kali WSL2 health and nmap version', 'Verify ElevenLabs API key is not rate limited', 'Set up log rotation for server output'],
      'Receptionist (also handles CEO email triage as Secretary)': ['Triage the CEO inbox and flag urgent items', 'Update the team calendar with Sprint 4 milestones', 'Make sure Marcus and Sarah are checked in'],
      'Security Guard': ['Run baseline nmap on localhost after last deploy', 'Review last 24 hours of security events', 'Do a full perimeter patrol of the office'],
    };
    const priorities = rolePriorities[brain.role] || ['Do the work in front of me', 'Check in with a teammate', 'Take a break'];

    this._dailyPlans[npcName] = {
      date: today,
      priorities,
      createdAt: new Date().toISOString(),
      goalReference: goal,
    };
    if (promptTuning?.autoClaimSprintTasks !== false) {
      this._autoClaimSprintTask(npcName);
    }
    return this._dailyPlans[npcName];
  }

  /**
   * Theory of mind — what do we think others are up to?
   * Pulls each coworker's last decision (their most recent action/thought)
   * so the NPC can reason about other people's intent, not just their own.
   */
  _getTheoryOfMind(npcName, limit = 4) {
    const others = Object.keys(this._lastDecisions)
      .filter(n => n !== npcName && this._lastDecisions[n])
      .slice(-limit);
    if (others.length === 0) return '';
    const lines = others.map(n => {
      const d = this._lastDecisions[n];
      const t = this._taskProgress[n];
      const task = t ? ` (working on "${t.task}")` : '';
      return `- ${n}: just chose "${d.action}"${task}`;
    });
    return lines.join('\n');
  }

  /**
   * Record a relationship interaction between two NPCs.
   * Over time this builds a social graph — who talks to whom how often.
   */
  _recordRelationship(fromName, toName) {
    if (!this._npcRelationships[fromName]) this._npcRelationships[fromName] = {};
    const rel = this._npcRelationships[fromName][toName] || { interactions: 0, lastAt: null };
    rel.interactions += 1;
    rel.lastAt = new Date().toISOString();
    this._npcRelationships[fromName][toName] = rel;
  }

  /**
   * Office event feed — stuff that happened recently (bug filed, PR landed,
   * visitor arrived). NPCs see a short log in their think prompt so they
   * can react to the world instead of just grinding through their own tasks.
   */
  broadcastEvent(kind, text) {
    this._eventFeed.push({
      kind,
      text: String(text || '').slice(0, 140),
      at: new Date().toISOString().slice(11, 16),
    });
    if (this._eventFeed.length > 12) this._eventFeed = this._eventFeed.slice(-12);
  }

  _getRecentEvents(limit = 4) {
    const evs = this._eventFeed.slice(-limit);
    if (evs.length === 0) return '';
    return evs.map(e => `[${e.at}] ${e.kind}: ${e.text}`).join('\n');
  }

  /**
   * Shared task board — tasks that anyone on the team can pick up.
   * Managers (Abby/Alex/Marcus) post tasks; everyone else sees them.
   */
  addSharedTask(task, postedBy = 'System') {
    this._sharedTasks.push({
      task: String(task || '').slice(0, 100),
      postedBy,
      at: new Date().toISOString().slice(11, 16),
      claimedBy: null,
    });
    if (this._sharedTasks.length > 20) this._sharedTasks = this._sharedTasks.slice(-20);
  }

  _getTaskBoard(limit = 5) {
    const open = this._sharedTasks.filter(t => !t.claimedBy).slice(-limit);
    if (open.length === 0) return '';
    return open.map(t => `- "${t.task}" (from ${t.postedBy})`).join('\n');
  }

  // ---------------------------------------------------------------------
  // Agent-bus integration — direct NPC↔NPC messaging without CTO brokering.
  // Each NPC has a small per-name inbox; messages are buffered between
  // think cycles and drained into the system prompt as "Direct Messages To
  // You". This complements (not replaces) the cofounder dispatcher.
  // ---------------------------------------------------------------------

  /** Per-NPC inbox of messages received via agent-bus since the last think. */
  _ensureInbox(npcName) {
    if (!this._inboxes) this._inboxes = {};
    if (!this._inboxes[npcName]) this._inboxes[npcName] = [];
    return this._inboxes[npcName];
  }

  _drainInbox(npcName) {
    const inbox = this._ensureInbox(npcName);
    if (inbox.length === 0) return [];
    // Cap delivered messages to keep prompts bounded.
    const out = inbox.splice(0, 6);
    return out;
  }

  /**
   * Subscribe every loaded NPC to the agent-bus. Call once after init.
   * Idempotent — repeated calls re-bind cleanly.
   */
  subscribeAllToBus() {
    if (!agentBus) return;
    if (this._busUnsubs) {
      for (const fn of this._busUnsubs) { try { fn(); } catch (_) {} }
    }
    this._busUnsubs = [];
    for (const name of Object.keys(this.brains)) {
      const inbox = this._ensureInbox(name);
      const unsub = agentBus.subscribe(name, (msg) => {
        // Buffer with a small overflow guard. Newer messages win.
        inbox.push(msg);
        if (inbox.length > 12) inbox.splice(0, inbox.length - 12);
      });
      this._busUnsubs.push(unsub);
    }
  }

  /**
   * Get skill context for an NPC based on their accumulated SKILL entries in memory
   */
  _getSkillContext(npcName) {
    const brain = this.brains[npcName];
    if (!brain?.longTermMemory) return '';
    const skillLines = brain.longTermMemory.split('\n').filter(l => l.includes('[SKILL:'));
    if (skillLines.length === 0) return '';
    const skills = {};
    for (const line of skillLines) {
      const match = line.match(/\[SKILL:([^:]+):([+-]\d+)\]/);
      if (match) skills[match[1]] = (skills[match[1]] || 0) + parseInt(match[2]);
    }
    const sorted = Object.entries(skills).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (sorted.length === 0) return '';
    return 'Your growing skills: ' + sorted.map(([s, l]) => `${s}: ${l}`).join(', ');
  }

  /**
   * Generate a response for an NPC in a conversation.
   * @param {string} npcName - The NPC responding (e.g., "Alex")
   * @param {string} fromName - Who's talking to them (e.g., "Abby")
   * @param {string} message - What was said to them
   * @param {object} context - Office context (who's where, what's happening)
   * @returns {Promise<string>} The NPC's response text
   */
  // Strip characters that break JSON surrogate pair encoding (emojis, etc.)
  /**
   * Strip sections from SOUL.md that are redundant with the voiceAnchor injected
   * at the end of the prompt. Removes: Personality Quirks, Idle Phrases,
   * Memory & Callbacks. Saves 150-250 tokens per call (× 16 NPCs × 18/min
   * = thousands of tokens/min at current throughput).
   *
   * Core Identity, Personality, Values, Boundaries, Backstory, Opinions,
   * Provider, Role, and What You Are Building are all kept — they drive
   * decision-making depth and can't be captured in a 5-line anchor.
   */
  _trimSoulForPrompt(soul) {
    // Sections whose essence is fully captured by voiceAnchor — drop from the
    // live prompt copy to save 150-250 tokens per call per NPC.
    const DROP_SECTIONS = new Set([
      'Personality Quirks',
      'Idle Phrases',
      'Memory & Callbacks',
    ]);
    // Normalise CRLF → LF so the split works regardless of checkout style.
    const normalised = soul.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Split on section boundaries, keeping the delimiter on the right chunk.
    const chunks = normalised.split(/(?=\n## )/);
    const kept = chunks.filter(chunk => {
      const header = chunk.match(/^[\s]*## (.+)/);
      if (!header) return true; // keep preamble / non-section lines
      return !DROP_SECTIONS.has(header[1].trim());
    });
    return kept.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Parse a SOUL.md file to extract voice-differentiating elements, then build
   * a compact CHARACTER LOCK block that gets injected at the very END of every
   * system prompt so the LLM sees it immediately before generating output.
   *
   * Why at the end: local small models (14B) anchor on recent context. Putting
   * personality first gets buried under 5000+ tokens of office context. The lock
   * block re-asserts voice as the very last thing the model reads.
   */
  _buildVoiceAnchor(soul, name) {
    // --- Personality: first 2 sentences ---
    const personalityMatch = soul.match(/## Personality\r?\n([\s\S]+?)(?=\r?\n##)/);
    const personalityText = personalityMatch
      ? personalityMatch[1].trim().split(/\.\s+/).slice(0, 2).join('. ').trim() + '.'
      : '';

    // --- Filler / signature phrase ---
    const fillerMatch = soul.match(/filler phrase is[^"]*"([^"]+)"/i);
    const fillerPhrase = fillerMatch ? fillerMatch[1] : null;

    // --- Idle phrases: first 3 non-empty bullet lines ---
    const idleMatch = soul.match(/## Idle Phrases\r?\n([\s\S]+?)(?=\r?\n##|$)/);
    const idlePhrases = idleMatch
      ? idleMatch[1].split(/\r?\n/)
          .map(l => l.replace(/^[-*]\s*/, '').replace(/^"|"$/g, '').replace(/\*[^*]*\*/g, '').trim())
          .filter(l => l.length > 2)
          .slice(0, 3)
      : [];

    // --- Boundaries: anything the NPC won't do ---
    const boundaryMatch = soul.match(/## Boundaries\r?\n([\s\S]+?)(?=\r?\n##)/);
    const boundaries = boundaryMatch
      ? boundaryMatch[1].split(/\r?\n/)
          .map(l => l.replace(/^[-*]\s*/, '').trim())
          .filter(l => l.length > 4)
          .slice(0, 2)
      : [];

    const lines = [
      `## CHARACTER LOCK — YOU ARE ${name.toUpperCase()}`,
      personalityText,
      fillerPhrase ? `Your signature phrase: "${fillerPhrase}"` : null,
      idlePhrases.length ? `Your voice: ${idlePhrases.map(p => `"${p}"`).join(' / ')}` : null,
      boundaries.length ? `You hold the line: ${boundaries.join('; ')}` : null,
      `Never say "Certainly!", "Of course!", "Absolutely!", "Great question!", or "I'd be happy to".`,
      `Never sound like a generic AI assistant. Write every word as ${name} — short, direct, in character.`,
    ].filter(Boolean).join('\n');

    return lines + '\n\n';
  }

  _sanitize(str) {
    // Strip ONLY lone/unpaired surrogates — NOT valid surrogate pairs (which are real emoji).
    // Old regex [\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF] wiped valid pairs too,
    // killing 📋 ✅ 🙋 etc. from NPC speech and memories.
    return String(str ?? '').replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      ''
    );
  }

  /** True when model leaked chain-of-thought instead of dialogue. */
  _isReasoningLeak(str) {
    const t = String(str ?? '').trim();
    if (!t || t.length < 12) return true;
    const metaPatterns = [
      /Thinking\s*Process/i,
      /^\d+\.\s*\*?\*?(Analyze|Assess|Consider|Identify|Draft|Review|Determine|Recall)\b/im,
      /\*\*(Role|Tone|Voice|Task|Persona|Analyze|Request)\*\*/i,
      /^Analyze the Request\b/i,
      /^Identify (?:Persona|Required Content)/i,
      /Bouncer Lock/i,
      /Persona Constraints/i,
      /Determine (?:Persona|Required|Response)/i,
      /The user is roleplaying/i,
      /\bIdentify Persona and Constraints\b/i,
    ];
    return metaPatterns.some(re => re.test(t));
  }

  /**
   * Strip reasoning-model chain-of-thought (Ministral, DeepSeek-R1, Qwen3, etc.)
   * that leaks into content even when enable_thinking is false.
   */
  _stripReasoningLeak(str) {
    let t = this._sanitize(str).trim();
    if (!t) return t;

    const thinkOpen = '\x3cthink\x3e';
    const thinkClose = '\x3c/think\x3e';
    if (t.includes(thinkOpen)) {
      const after = t.split(thinkClose);
      t = (after.length > 1 ? after[after.length - 1] : '').trim();
    }

    const looksLikeMeta = /Thinking\s*Process|^Analyze the Request|^\d+\.\s*\*?\*?(Analyze|Assess)|Bouncer Lock|Persona Constraints|The user is roleplaying/i.test(t);
    if (!looksLikeMeta) {
      return t.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').replace(/\s{2,}/g, ' ').trim();
    }

    t = t.replace(/^(?:Thinking\s*Process|Analyze the Request)\s*:?\s*/i, '');
    const metaRe = [
      /\*\*(Role|Tone|Voice|Task|Persona|Analyze|Request)\*\*/i,
      /^\d+\.\s*\*?\*?(Analyze|Assess|Consider|Identify|Draft|Review|Determine|Recall)\b/i,
      /^(?:Identify|Determine)\s+(?:Persona|Required|Response)/i,
      /Bouncer Lock/i,
      /Persona Constraints/i,
      /The user is roleplaying/i,
      /^\*\s*\*\*/,
      /\bstoic, observant\b.*\ben couraged\b/i,
      /\bis encouraged\b/i,
    ];
    const chunks = t.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
    const dialogue = chunks.filter(s =>
      s.length > 18 &&
      !metaRe.some(re => re.test(s)) &&
      !/^\d+\./.test(s)
    );
    if (dialogue.length) {
      t = dialogue.join(' ');
    } else {
      const quoted = t.match(/"([^"]{12,})"/);
      t = quoted ? quoted[1] : '';
    }

    return t.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').replace(/\s{2,}/g, ' ').trim();
  }

  /** Scripted Bouncer incident line when the LLM only returns reasoning meta. */
  _bouncerIncidentFallback(message) {
    const m = String(message);
    const sev = (m.match(/caught a (\w+)/i) || [])[1] || 'suspicious';
    const cat = (m.match(/caught a \w+ ([\w_]+)/i) || [])[1] || 'intrusion';
    const detail = (m.match(/Detail:\s*([^.]+)/i) || [])[1] || '';
    const confronted = (m.match(/When you confronted them:\s*([^.]+)/i) || [])[1] || '';
    const cm = (m.match(/Countermeasure you set up:\s*([^.]+)/i) || [])[1] || 'locked it down';
    const catNice = cat.replace(/_/g, ' ');
    const detailBit = detail.trim() ? ` — ${detail.trim()}` : '';
    const standoff = /still active|held their ground/i.test(confronted)
      ? ' They held their ground — eyes open.'
      : confronted.trim()
        ? ` ${confronted.trim().charAt(0).toUpperCase()}${confronted.trim().slice(1)}.`
        : '';
    const cmLine = cm.trim().replace(/^i\s+/i, '');
    return `Mm. ${sev} ${catNice}${detailBit}.${standoff} ${cmLine.charAt(0).toUpperCase()}${cmLine.slice(1)}. All clear.`;
  }

  /** Strip model junk (trailing empty JSON quotes) before showing to the player. */
  _cleanDisplayText(str, npcName) {
    let t = this._stripReasoningLeak(str);
    t = t.replace(/\s*\[ACTION:[^\]]+\]/g, '').trim();
    while (/\s*""\s*$/.test(t)) t = t.replace(/\s*""\s*$/, '').trim();
    if (npcName === 'Bouncer') {
      t = t.replace(/\bMm\.\s*(?:Mm\.\s*)+/gi, 'Mm. ');
      const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
      const seen = new Set();
      t = sentences.filter(s => {
        const key = s.trim().slice(0, 48).toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).join(' ');
    }
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
  }

  /** Push provider table into each brain — snapshots go stale after model sync. */
  _refreshBrainProviderConfigs() {
    for (const brain of Object.values(this.brains)) {
      const base = this.providers[brain.provider] || this.providers.lmstudio;
      if (!base) continue;
      brain.providerConfig = { ...base, providerKey: brain.provider };
    }
  }

  /** Apply LM_STUDIO_MODEL / LM_STUDIO_FAST_MODEL pins from env (never auto-substitute). */
  _applyLmStudioEnvPins() {
    const mainPin = process.env.LM_STUDIO_MODEL;
    const fastPin = process.env.LM_STUDIO_FAST_MODEL;
    if (this.providers.lmstudio && mainPin) {
      this.providers.lmstudio.model = mainPin;
    }
    if (this.providers['lmstudio-fast'] && fastPin) {
      this.providers['lmstudio-fast'].model = fastPin;
    }
    this._refreshBrainProviderConfigs();
  }

  _matchLoadedModel(allLoaded, preferred) {
    if (!preferred || !allLoaded?.length) return null;
    const preferredNorm = preferred.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      allLoaded.find(m => m.id === preferred) ||
      allLoaded.find(m => m.id.toLowerCase().replace(/[^a-z0-9]/g, '') === preferredNorm) ||
      allLoaded.find(m => m.id.toLowerCase().includes(preferredNorm.slice(0, 12))) ||
      null
    );
  }

  /**
   * Probe LM Studio and sync model IDs into providers.
   * When LM_STUDIO_MODEL / LM_STUDIO_FAST_MODEL are set (e.g. in .env), those
   * slots stay pinned — we never substitute a random loaded model like Medolama.
   */
  async syncLmStudioModel() {
    if (!this.providers.lmstudio) return;
    const base = this.providers.lmstudio.baseUrl || 'http://localhost:1234';
    const mainPin = process.env.LM_STUDIO_MODEL;
    const fastPin = process.env.LM_STUDIO_FAST_MODEL;

    if (mainPin || fastPin) {
      this._applyLmStudioEnvPins();
      log.info('ModelSync',
        `pinned main=${this.providers.lmstudio?.model || '(default)'} ` +
        `fast=${this.providers['lmstudio-fast']?.model || '(default)'}`
      );

      try {
        const res = await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        const data = await res.json();
        const allLoaded = (data.data || []).filter(m => m.state === 'loaded' && m.type !== 'embeddings');
        const loadedIds = allLoaded.map(m => m.id);

        for (const [slot, pin, prov] of [
          ['main', mainPin, this.providers.lmstudio],
          ['fast', fastPin, this.providers['lmstudio-fast']],
        ]) {
          if (!pin || !prov) continue;
          const match = this._matchLoadedModel(allLoaded, pin);
          if (!match) {
            log.warn('ModelSync',
              `${slot} "${pin}" is pinned but not loaded in LM Studio. ` +
              `Loaded: ${loadedIds.join(', ') || '(none)'}. ` +
              `Unload other models and load only Ministral + Gemma.`
            );
            continue;
          }
          if (match.id !== prov.model) {
            prov.model = match.id;
            log.info('ModelSync', `${slot} resolved "${pin}" → "${match.id}"`);
          }
        }
        this._refreshBrainProviderConfigs();
      } catch (_) {
        // LM Studio not running — pins still apply from env
      }
      return;
    }

    try {
      const res = await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const data = await res.json();

      const allLoaded = (data.data || []).filter(m => m.state === 'loaded' && m.type !== 'embeddings');
      if (!allLoaded.length) return;

      const preferred = this.providers.lmstudio.model || '';
      const match = this._matchLoadedModel(allLoaded, preferred) || allLoaded[0];

      const prev = this.providers.lmstudio.model;
      this.providers.lmstudio.model = match.id;

      if (prev !== match.id) {
        log.modelSync({ prev, current: match.id, contextLen: match.loaded_context_length });
      }

      if (preferred && match.id !== preferred && !this._matchLoadedModel(allLoaded, preferred)) {
        log.info('ModelSync',
          `preferred "${preferred}" not loaded — using "${match.id}" instead. ` +
          `Set LM_STUDIO_MODEL in .env to pin a model.`
        );
      }

      if (this.providers['lmstudio-fast'] && !fastPin) {
        const fastPreferred = this.providers['lmstudio-fast'].model || '';
        const fastMatch =
          this._matchLoadedModel(allLoaded.filter(m => m.id !== match.id), fastPreferred) ||
          allLoaded.find(m => m.id !== match.id) ||
          match;
        this.providers['lmstudio-fast'].model = fastMatch.id;
      }

      this._refreshBrainProviderConfigs();
    } catch (_) {
      // LM Studio not running — that's fine, other providers handle it
    }
  }

  /**
   * One turn in a dynamic meeting. The NPC speaks in their own voice/model,
   * sees the transcript so far, and is told to actually move the discussion
   * forward — propose, ask a pointed question, ANSWER an open question, or
   * raise a concrete concern. The facilitator frames and (at the end) decides.
   *
   * @returns {Promise<string>} a short contribution (or '' on failure)
   */
  async meetingTurn(npcName, { topic, transcript = [], asFacilitator = false, closing = false } = {}) {
    const brain = this.brains[npcName];
    if (!brain) return '';

    const lines = transcript.slice(-12).map(t => `${t.speaker}: ${t.text}`).join('\n') || '(no one has spoken yet)';
    let instruction;
    if (asFacilitator && !closing) {
      instruction = `You are FACILITATING this meeting. Open it: state the problem in one sentence, then ask the single most important question to get the team solving it. Be brief.`;
    } else if (closing) {
      instruction = `You are CLOSING this meeting. Read the discussion and state the DECISION in 1-2 sentences, then list concrete action items as "ACTION: <Name> — <task>" (one per line, assign to specific people who were here). No fluff.`;
    } else {
      instruction = `It's your turn. Do ONE useful thing: answer an open question someone asked, propose a concrete next step, or raise a specific concern/risk. If you don't actually know something, say so and say who or what could find out (e.g. "we should research X"). 1-3 sentences. Don't repeat what's already been said.`;
    }

    const systemPrompt = `${brain.personality}\n\nYou are ${npcName}, ${brain.role}, in a live team meeting. Speak in your own voice. Be concrete and concise — this is a working session, not small talk.`;
    const userPrompt = `MEETING TOPIC: ${topic}\n\nDISCUSSION SO FAR:\n${lines}\n\n${instruction}`;

    try {
      const out = await this._callProvider(brain.providerConfig, systemPrompt, [{ role: 'user', content: userPrompt }],
        { maxTokens: closing ? 220 : 120, sliceLen: closing ? 700 : 400, temperature: 0.85, npc: npcName, kind: 'meeting' });
      return this._sanitize(typeof out === 'string' ? out : '');
    } catch (_) {
      return '';
    }
  }

  async getResponse(npcName, fromName, message, context = {}) {
    const brain = this.brains[npcName];
    if (!brain) return `(${npcName} nods)`;

    const safeMessage = typeof message === 'string' ? message : String(message ?? '');
    const isIncident = context.kind === 'incident-report' || context.kind === 'linux-investigation-report';

    // Incident reports are scripted — skip the GPU queue so Ministral can't leak reasoning meta.
    if (npcName === 'Bouncer' && isIncident && /you just caught a/i.test(safeMessage)) {
      const out = this._bouncerIncidentFallback(safeMessage);
      this.memories[npcName].push({ from: fromName, text: this._sanitize(safeMessage) });
      this.memories[npcName].push({ from: npcName, text: out });
      if (this.memories[npcName].length > 50) {
        this.memories[npcName] = this.memories[npcName].slice(-50);
      }
      return out;
    }

    const rawMemory = brain.longTermMemory || '';
    // Extract memories specifically about the person we're talking to
    const memoryLines = rawMemory.split('\n').filter(l => l.trim());
    const relevantMemories = memoryLines.filter(l => l.includes(fromName)).slice(-5).join('\n');
    const recentMemories = memoryLines.slice(-5).join('\n');
    const memorySection = rawMemory.length > 50
      ? `\n\n## Past interactions with ${fromName}\n${relevantMemories || 'None yet — this is a new relationship.'}\n\n## Recent memories\n${this._sanitize(recentMemories)}`
      : '';

    // Add task context
    const myTask = this._taskProgress[npcName];
    const theirTask = this._taskProgress[fromName];
    const taskContext = (myTask || theirTask)
      ? `\nYour current work: ${myTask ? myTask.task : 'general tasks'}. Their current work: ${theirTask ? theirTask.task : 'unknown'}.`
      : '';

    // Build coworker awareness — who this NPC knows and their relationships
    const coworkerContext = this._getCoworkerContext(npcName, fromName);

    // Mood/energy note — bleed work fatigue into conversational tone
    const cycles = this._thinkCycles[npcName] || 0;
    const moodNote = cycles >= 4
      ? ` You've been heads-down for a while — you sound focused and a little terse if interrupted.`
      : cycles >= 2
      ? ` You're in the flow — engaged, efficient.`
      : '';

    const teamOverlay = context.identityId
      ? await this._buildTeamMemberOverlay(context.identityId, npcName)
      : '';

    const systemPrompt = `${brain.personality}${memorySection}${teamOverlay}

## Your Coworkers
${coworkerContext}

You are ${npcName} at work. Stay fully in character — your personality, values, and voice define how you speak.
Your role: ${brain.role}. You know your coworkers, remember past conversations, and understand how you can help each other.
Keep responses to 1–2 natural sentences (under 200 characters). Sound like yourself, not a generic assistant.${moodNote}
Reference past conversations when relevant. ${context.description || ''}${taskContext}

${brain.voiceAnchor || ''}Respond as ${npcName}. Dialogue only — no stage directions, no quotation marks.${
      (context.kind === 'incident-report' || context.kind === 'linux-investigation-report')
        ? '\n\nCRITICAL: Output ONLY 2-3 sentences of spoken dialogue. No "Thinking Process", no numbered analysis, no bullet points, no markdown, no meta-commentary.'
        : ''
    }`;

    // Add to memory (sanitize to prevent JSON encoding issues)
    this.memories[npcName].push({ from: fromName, text: this._sanitize(safeMessage) });
    if (this.memories[npcName].length > 50) {
      this.memories[npcName] = this.memories[npcName].slice(-50);
    }

    // Build conversation from memory. Cap at the last RESPONSE_HISTORY
    // messages so we don't ship 50-message contexts on every chat —
    // those were the #1 token cost driver per the LM Studio logs
    // (avg 2,500 prompt tokens vs 85 completion tokens = 29:1 ratio).
    // The full memory is still retained in this.memories AND written
    // to MEMORY.md for later reference; we just don't replay the whole
    // history into every LLM call. Override via NPC_HISTORY_DEPTH env.
    // Reduced from 6 → 3: telemetry shows max depth 11 caused context_overflow ×8.
    // 3 turns of back-context is enough for conversational continuity; full history
    // is still in this.memories and MEMORY.md — we just stop replaying it all.
    const HISTORY_DEPTH = Number(process.env.NPC_HISTORY_DEPTH)
      || (promptTuning?.economyMode ? 2 : 3);
    const rawMessages = this.memories[npcName].slice(-HISTORY_DEPTH).map(m => ({
      role: m.from === npcName ? 'assistant' : 'user',
      content: m.from === npcName ? m.text : `${m.from} says: "${m.text}"`,
    }));

    // Enforce strict user/assistant alternation required by Mistral/Ministral's
    // jinja chat template. Collapse back-to-back same-role messages by joining
    // their content, so we never send two consecutive user or assistant turns.
    const messages = [];
    for (const msg of rawMessages) {
      if (messages.length > 0 && messages[messages.length - 1].role === msg.role) {
        messages[messages.length - 1].content += ' ' + msg.content;
      } else {
        messages.push({ ...msg });
      }
    }
    // Mistral requires the first message to be from the user
    if (messages.length > 0 && messages[0].role === 'assistant') {
      messages.shift();
    }

    const isUrgentReport = context.kind === 'incident-report' || context.kind === 'linux-investigation-report';
    const responseOpts = {
      maxTokens: isUrgentReport ? 120 : 200,
      sliceLen: isUrgentReport ? 400 : 300,
      npc: npcName,
      kind: context.kind || 'response',
      ...(isUrgentReport ? { priority: 'high' } : {}),
    };

    try {
      const response = await this._callProvider(brain.providerConfig, systemPrompt, messages, responseOpts);
      let out = response;
      if (typeof out !== 'string') {
        out = this._cannedResponse(npcName, fromName, safeMessage);
      }
      out = this._cleanDisplayText(out, npcName);
      if (npcName === 'Bouncer' && isUrgentReport && this._isReasoningLeak(out)) {
        out = this._bouncerIncidentFallback(safeMessage);
      }
      this.memories[npcName].push({ from: npcName, text: out });
      // If the NPC just promised the CEO something ("I'll look into it and
      // report back"), record it so their think loop actually follows through
      // instead of forgetting it the moment the chat ends.
      const promise = this._detectCommitment(out);
      if (promise) this.recordCommitment(npcName, promise, fromName === npcName ? 'the team' : (fromName || 'the CEO'));
      return out;
    } catch (err) {
      // Throttle error logging — only log once per NPC per 60 seconds
      const now = Date.now();
      const lastErr = this._lastErrorLog?.[npcName] || 0;
      if (now - lastErr > 60000) {
        log.npcError(npcName, String(err?.message ?? err).slice(0, 80));
        if (!this._lastErrorLog) this._lastErrorLog = {};
        this._lastErrorLog[npcName] = now;
      }
      // Try fallback
      if (brain.fallbackConfig && brain.fallbackConfig !== brain.providerConfig) {
        try {
          const response = await this._callProvider(brain.fallbackConfig, systemPrompt, messages, { maxTokens: 200, sliceLen: 300, npc: npcName, kind: 'response-fallback' });
          let out = response;
          if (typeof out !== 'string') {
            out = this._cannedResponse(npcName, fromName, safeMessage);
          }
          out = this._cleanDisplayText(out, npcName);
          if (npcName === 'Bouncer' && isUrgentReport && this._isReasoningLeak(out)) {
            out = this._bouncerIncidentFallback(safeMessage);
          }
          this.memories[npcName].push({ from: npcName, text: out });
          return out;
        } catch (e2) {
          log.npcError(npcName, 'fallback also failed: ' + String(e2?.message ?? e2).slice(0, 60));
        }
      }
      // Last resort: context-aware canned response
      const response = this._sanitize(this._cannedResponse(npcName, fromName, safeMessage));
      this.memories[npcName].push({ from: npcName, text: response });
      return response;
    }
  }

  /**
   * Tolerant decision-JSON parser — model-friendliness layer.
   *
   * Smaller / cheaper models routinely emit JSON that strict JSON.parse
   * rejects: markdown ```json fences, trailing commas, smart quotes, or
   * output truncated mid-object when they hit the token cap. Every failure
   * used to fall back to a scripted decision, which made weaker models look
   * "dead." This recovers the decision instead.
   *
   * Strategy:
   *   1. strip code fences
   *   2. extract the first BALANCED {...} via brace counting (string-aware,
   *      so braces inside string values don't miscount) — not a greedy regex
   *   3. if truncated (never closed), close the open string + balance braces
   *   4. try strict parse, then conservative repairs (trailing commas, smart
   *      quotes). Never does risky rewrites that could corrupt values.
   *
   * @returns {object|null} the parsed decision, or null if unrecoverable.
   */
  _parseDecisionJson(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let s = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const start = s.indexOf('{');
    if (start === -1) return null;

    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }

    let candidate;
    if (end !== -1) {
      candidate = s.slice(start, end + 1);
    } else {
      // Truncated mid-object (hit maxTokens). Close the dangling string and
      // balance the open braces so we can still recover the fields that made it.
      candidate = s.slice(start);
      if (inStr) candidate += '"';
      candidate += '}'.repeat(Math.max(1, depth));
    }

    const repairs = [
      (x) => x,
      (x) => x.replace(/,\s*([}\]])/g, '$1'),                                  // trailing commas
      (x) => x.replace(/,\s*([}\]])/g, '$1')
              .replace(/[“”]/g, '"').replace(/[‘’]/g, "'"), // smart quotes
    ];
    for (const fix of repairs) {
      try {
        const obj = JSON.parse(fix(candidate));
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          // Telemetry: count how often we had to repair, so model-friendliness
          // is measurable (exposed via getDecisionParseStats()).
          if (fix !== repairs[0] || end === -1) {
            this._decisionParseRepairs = (this._decisionParseRepairs || 0) + 1;
          }
          this._decisionParseOk = (this._decisionParseOk || 0) + 1;
          return obj;
        }
      } catch (_) { /* try next repair */ }
    }
    this._decisionParseFail = (this._decisionParseFail || 0) + 1;
    return null;
  }

  /** Parse-health counters for the decision JSON — surfaces how model-friendly
   *  the current model is (high repair/fail rate ⇒ switch model or add schema). */
  getDecisionParseStats() {
    const ok = this._decisionParseOk || 0;
    const repairs = this._decisionParseRepairs || 0;
    const fail = this._decisionParseFail || 0;
    const total = ok + fail;
    return {
      ok, repairs, fail, total,
      repairRate: total ? +(repairs / total).toFixed(3) : 0,
      failRate:   total ? +(fail / total).toFixed(3) : 0,
    };
  }

  /**
   * Autonomous NPC thinking — decides what to do next based on role, memory, and office state.
   * Returns a JSON action the NPC wants to take, plus _cascades for leaders.
   */
  async think(npcName, officeContext = {}) {
    const brain = this.brains[npcName];
    if (!brain) return { action: 'idle' };
    const _thinkStart = Date.now();
    const rt = this._rt(officeContext);

    // Hard server-side throttle — browser tabs ignore .env and may stack requests.
    const minNpcGap = promptTuning?.thinkMinMs ?? 120000;
    const sinceLastLlm = Date.now() - (rt.lastThinkLlmAt[npcName] || 0);
    const urgentWake = Boolean(
      officeContext?.urgentWake
      || officeContext?.wakeReason
      || rt.directives.has(npcName)
      || rt.pendingSkillResults.has(npcName),
    );
    if (!urgentWake && sinceLastLlm < minNpcGap) {
      global._npcStats = global._npcStats || {};
      global._npcStats.thinkThrottled = (global._npcStats.thinkThrottled || 0) + 1;
      return this._stampThinkContext({
        action: 'work',
        location: 'desk',
        taskPhase: 'continuing',
        thought: 'Continuing current task.',
        message: null,
        save: null,
        outcome: 'ok',
        _throttled: true,
      }, officeContext);
    }

    const gap = promptTuning?.globalThinkGapMs ?? 0;
    if (gap > 0) {
      if (this._lastGlobalThinkAt == null) this._lastGlobalThinkAt = 0;
      const wait = gap - (Date.now() - this._lastGlobalThinkAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this._lastGlobalThinkAt = Date.now();
    }

    if (promptTuning?.skipThinkWhenSkillPending !== false && rt.pendingSkillResults.has(npcName)) {
      return this._stampThinkContext({
        action: 'work',
        location: 'desk',
        taskPhase: 'continuing',
        message: 'Reviewing last tool output at my desk.',
        thought: 'Skill result pending — finishing that first.',
        save: null,
        outcome: 'ok',
      }, officeContext);
    }

    if (officeDirector?.isEnabled?.()) {
      const directorCtx = {
        inbox: this._ensureInbox(npcName),
        officeContext,
        cycles: rt.thinkCycles[npcName] || 0,
        lastDecision: rt.lastDecisions[npcName] || null,
        taskProgress: rt.taskProgress[npcName] || null,
        hasDirective: rt.directives?.has(npcName),
        pendingSkill: rt.pendingSkillResults?.has(npcName),
        realWorkMode: this._resolveAutonomousRealWork(npcName, officeContext),
        cyclesSinceSkill: rt.cyclesSinceSkillRun?.[npcName] || 0,
        realWorkThreshold: promptTuning?.realWorkCyclesWithoutSkill ?? 6,
      };
      if (!officeDirector.needsLlm(npcName, directorCtx)) {
        const hEarly = this._hierarchy[npcName];
        let directed = officeDirector.plan(this, npcName, directorCtx);
        directed = this._normalizeThinkDecision(npcName, directed, officeContext);
        return this._applyAutonomousDecision(npcName, directed, _thinkStart, {
          h: hEarly,
          brain,
          codeContext: null,
          officeContext,
        });
      }
    }

    const rawMemory = brain.longTermMemory || '';
    const memCap = promptTuning?.memoryChars ?? 350;
    const recentMemory = rawMemory.length > 100
      ? this._sanitize(rawMemory.slice(-memCap))
      : '';

    const coworkerContext = this._getCoworkerContext(npcName, '');
    const hierarchyRules = this._getHierarchyRules(npcName);
    const teamContext = this._getTeamContext(npcName);
    const h = this._hierarchy[npcName];
    const assistantProfileBlock = this._assistantProfilePromptBlock(npcName);

    let teamMemberOverlay = officeContext.teamMemberOverlay || '';
    let teamPurposeOverlay = officeContext.teamPurposeOverlay || '';
    if (officeContext.identityId && officeContext.visitorScoped) {
      if (!teamMemberOverlay) {
        teamMemberOverlay = await this._buildTeamMemberOverlay(officeContext.identityId, npcName);
      }
      if (!teamPurposeOverlay) {
        teamPurposeOverlay = await this._buildTeamPurposeOverlay(
          officeContext.identityId,
          officeContext.visitorDisplayName,
        );
      }
    }

    // Cap at 4 recent memories and truncate each — was 10 full memories
    // which could add 500-1000 tokens and push Lucy/Abby over the 4096 limit.
    const recentConversations = (this.memories[npcName] || []).slice(-3)
      .map(m => m.from + ': "' + String(m.text || '').slice(0, 60) + '"')
      .join('\n');

    // Track think cycles for fatigue/variety hints
    const cycles = rt.thinkCycles[npcName] || 0;
    const lastDecision = rt.lastDecisions[npcName] || null;
    const taskProg = rt.taskProgress[npcName] || null;

    // Build continuity context
    var continuitySection = '';
    if (lastDecision) {
      continuitySection += 'Your LAST decision was: action="' + (lastDecision.action || '?') + '"';
      if (lastDecision.target) continuitySection += ', talking to ' + lastDecision.target;
      if (lastDecision.thought) continuitySection += '. You were thinking: "' + lastDecision.thought + '"';
      continuitySection += '\n';
    }
    if (taskProg) {
      continuitySection += 'Current task: "' + taskProg.task + '" (phase: ' + taskProg.phase + ', started ' + taskProg.startedAt + ').\n';
    }

    // Emotional state / fatigue hints
    var fatigueHint = '';
    if (cycles >= 4) {
      fatigueHint = 'You have been working for ' + cycles + ' consecutive cycles without a break. Consider taking a break, chatting with someone, or switching tasks.';
    } else if (cycles >= 2) {
      fatigueHint = 'You have been focused for a while (' + cycles + ' cycles). Maybe check in with a teammate or stretch your legs.';
    }

    // Action weighting hint to prevent all NPCs just "working"
    var actionWeightHint = '';
    if (h && h.manages.length > 0) {
      actionWeightHint = 'As a manager: ~35% WORKING, ~30% TALK or visit (desk check-ins), ~15% COLLABORATE, ~10% BREAK, ~5% MEETING (conference only for blockers or sprint planning — never two meetings in a row). Prefer talk/visit over meeting.';
    } else if (h && h.reportsTo !== 'CEO') {
      actionWeightHint = 'Balance: ~45% WORK, ~30% TALK or visit, ~10% COLLABORATE, ~10% BREAK, ~5% MEETING (only when you have a concrete agenda). Default to desk work or a quick chat, not the conference room.';
    }

    var managesStr = (h && h.manages.length > 0) ? h.manages.join(', ') : 'nobody';
    var reportsToStr = h ? h.reportsTo : 'your boss';

    const skillContext = this._getSkillContext(npcName);

    // Persistent intelligence layer — goals + daily plan + theory of mind
    // + office event feed + shared task board. Each is a short snippet
    // injected into the system prompt so the LLM can reason about things
    // beyond the current cycle.
    const goalContext = this._getGoalContext(npcName);
    const dailyPlan = this.getDailyPlan(npcName);
    const compactThink = promptTuning?.compactThinkPrompt !== false;
    const planText = dailyPlan
      ? (compactThink
        ? dailyPlan.priorities[0]
        : dailyPlan.priorities.map((p, i) => `${i + 1}. ${p}`).join('\n'))
      : '';
    const theoryOfMind = compactThink ? '' : this._getTheoryOfMind(npcName, 2);
    const eventsFeed = compactThink ? '' : this._getRecentEvents(2);
    const taskBoard = compactThink ? '' : this._getTaskBoard(3);

    // #3 — Role-based room affinity: each NPC has a "natural hangout" room
    // based on their job. This biases location choices toward the whole map
    // instead of everyone defaulting to their desk or the conference room.
    const roomAffinity = this._getRoomAffinity(npcName);

    // #4 — Nearby furniture context. Caller (agent-office-manager) passes
    // an optional list so the model can choose concrete destinations
    // ("coffee machine 40px away") instead of abstract "work".
    const nearbyFurniture = (officeContext && Array.isArray(officeContext.nearbyFurniture))
      ? officeContext.nearbyFurniture.slice(0, 5).join(', ')
      : '';

    // Live world-state context — what is happening RIGHT NOW from this NPC's
    // POV. Pulled from the singleton; empty if world-state isn't wired (e.g.
    // running this file in unit tests). The block is rendered as a compact
    // bullet list to keep token cost down.
    const liveContextBlock = worldState
      ? worldState.renderContextBlock(npcName, { compact: promptTuning?.compactLiveContext })
      : '';

    // Time of day awareness — NPCs should pace themselves differently in
    // the morning vs late afternoon vs evening. Built from the world
    // clock if the cofounder pushed one, otherwise wall-clock.
    const officeTime = (officeContext && officeContext.time) || null;
    let timeOfDayBlock = '';
    if (officeTime) {
      const [h] = officeTime.split(':').map(n => parseInt(n, 10));
      let phase;
      if (h >= 5 && h < 11) phase = 'morning';
      else if (h >= 11 && h < 14) phase = 'midday';
      else if (h >= 14 && h < 17) phase = 'afternoon';
      else if (h >= 17 && h < 20) phase = 'evening';
      else phase = 'after hours';
      timeOfDayBlock = `- Office time: ${officeTime} (${phase})`;
    }

    // Self-repetition guard — if the NPC's about to say something they
    // already said in the last 5 minutes, surface that and tell them to
    // do something else. This breaks the "check in / check in / check
    // in" loops that show up when goals are vague.
    let selfRepetitionHint = '';
    if (worldState && typeof worldState.recentSimilarMessage === 'function') {
      // We don't know the NEXT message yet, so we just remind them what
      // their recent messages were. The model self-policies.
      const recent = worldState.recentSelfMessages?.get(npcName) || [];
      if (recent.length >= 2) {
        const lastTwo = recent.slice(-2).map(m => `"${m.text.slice(0, 60)}"`).join(' then ');
        selfRepetitionHint = `- Your recent messages: ${lastTwo}. Avoid asking the same thing again — do something new or wait.`;
      }
    }

    // Buffered direct messages from peers via agent-bus. These are "you have
    // mail" — the NPC should react to them on this think cycle if relevant.
    const inbox = this._drainInbox(npcName);
    // Escalations are separated out and rendered as a high-priority section so
    // managers can't miss them and know they must act (unblock or escalate further).
    const escalationMsgs = inbox.filter(m => m.kind === 'escalate');
    const regularMsgs    = inbox.filter(m => m.kind !== 'escalate');
    const escalationText = escalationMsgs.length
      ? `## ESCALATION REQUIRING YOUR DECISION\n` +
        escalationMsgs.map(m => `- from ${m.from}: ${m.text}`).join('\n') +
        `\nYou MUST act: either send a directive to unblock them, or use action:"request_approval" ` +
        `(skillParams:{task, onBehalfOf}) to bring this to Zion directly.\n`
      : '';
    const inboxText = [
      escalationText,
      regularMsgs.length ? regularMsgs.map(m => `- from ${m.from}: ${m.text}`).join('\n') : '',
    ].filter(Boolean).join('\n');

    // Combine time + self-repetition into a small "Situational" block. Both
    // are optional; the section is omitted if neither applies.
    const situationalLines = [timeOfDayBlock, selfRepetitionHint].filter(Boolean);
    const situationalBlock = situationalLines.length ? situationalLines.join('\n') : '';

    // Office manners — short social rules so NPC behavior feels like a
    // real workplace instead of NPCs talking past each other. Kept
    // intentionally short; the LLM only needs the gist.
    const officeManners = [
      "- If someone is mid-sentence or just spoke to you, acknowledge them before walking off.",
      "- If a peer is `busy` (meeting / walking), don't interrupt unless it's urgent.",
      "- Greet people you haven't spoken to in a while; short small talk is fine.",
      "- Don't repeat the same check-in question — vary your topic or wait.",
      "- The CEO (the human player) gets a hello if they're standing near you.",
      "- Brevity is a virtue. One short sentence usually beats three long ones.",
    ].join('\n');

    const companyContext = this._getCompanyContext(npcName);

    // Level 1 — Code awareness: inject a source-file snippet for code roles.
    // Skip entirely for roles that work with data/briefs rather than code.
    // For active workers (last action was 'work' or 'read') use 60% chance;
    // otherwise 20%. NPCs without code files (e.g. receptionist) get null.
    let codeContext = null;
    // Security Guard, IT Support, and non-technical roles don't get code snippets.
    // Bouncer was hitting 4000+ tok prompts because code snippets + live infra
    // context were stacking on top of each other. Security Guard needs infra
    // context, not code review — they're mutually exclusive.
    const NON_CODE_ROLES = new Set([
      'Receptionist (also handles CEO email triage as Secretary)',
      'Project Manager',
      'Product Manager',
      'Security Guard',
      'IT Support',
    ]);
    const leanThink = promptTuning?.compactThinkPrompt !== false && !promptTuning?.realWorkMode;
    if (!leanThink && npcTools && !NON_CODE_ROLES.has(brain.role)) {
      const lastAct = (this._lastDecisions[npcName] || {}).action;
      const chanceActive = promptTuning?.codeContextChanceActive ?? 0.35;
      const chanceIdle = promptTuning?.codeContextChanceIdle ?? 0.12;
      const chance = (lastAct === 'work' || lastAct === 'read') ? chanceActive : chanceIdle;
      if (Math.random() < chance) {
        codeContext = npcTools.getCodeContext(brain.role);
      }
    }

    // Level 3 — Live infra: run a fast pre-approved command for DevOps/IT/Security.
    // Async but capped at 5s timeout inside runSafeCommand, so it won't stall the loop.
    let liveInfraContext = null;
    const infraChance = promptTuning?.infraContextChance ?? 0.18;
    if (!leanThink && npcTools && npcTools.INFRA_ROLES.has(brain.role) && Math.random() < infraChance) {
      liveInfraContext = await npcTools.getLiveInfraContext(brain.role);
    }

    // OpenClaw skills context — injected for roles that can actually use them.
    // Lucy uses job pipeline skills, Bouncer uses security tools, CTO/IT use
    // the broader skill set for delegation. Kept brief — just enough to inform
    // decisions, not a full API reference.
    const OPENCLAW_SKILL_ROLES = new Set([
      'CTO', 'Receptionist (also handles CEO email triage as Secretary)',
      'Security Guard', 'IT Support', 'DevOps Engineer',
      'Developer', 'Frontend Developer', 'Backend Developer',
      'Researcher', 'Data Engineer', 'Intern',
      'QA Engineer', 'UI/UX Designer', 'Project Manager', 'Product Manager',
    ]);
    let openClawContext = null;
    if (OPENCLAW_SKILL_ROLES.has(brain.role)) {
      const browserSupabase = 'web-search (visible browser lookup), research (background web lookup), browserclaw (multi-step browser tasks), screen-observe (read-only: "look at my screen"), desktop-agent (CEO asks to fill forms on their real screen — "fill this out for me on my screen"), supabase-bridge (low-level DB), denizen-data skills (intake-triage, lead-monitor, rfp-status, prediction-brief, outcome-standup, work-history, cost-dashboard, entity-link, etc.). CEO Brave: "open my brave browser".';
      let crmPersonas = null;
      try { crmPersonas = require('./denizen-crm-npc-personas'); } catch (_) {}
      const npcFolder = this._nameToFolder?.[npcName] || String(npcName || '').toLowerCase();
      const crmPersona = crmPersonas?.resolvePersona?.(npcFolder) || crmPersonas?.resolvePersona?.(npcName);
      const crmLine = crmPersona
        ? crmPersonas.crmSkillSuffix(crmPersona.canWrite)
        : 'crm-summary, crm-list-pipeline (Meridian CRM at /crm/)';
      const skillsByRole = {
        'CTO': `${browserSupabase}; coding-agent, github, canvas-render, pdf-generator, lm-studio, cost-dashboard, org-benchmark; CRM: ${crmLine}`,
        'Receptionist (also handles CEO email triage as Secretary)': `${browserSupabase}; platform-publish (Supabase CMS / Lovable export), job-scraper/job-applier; intake-triage, lead-monitor, client-lookup, prediction-brief, intake-to-client, visitor-claim, assistant-handoff, rfp-status; CRM: ${crmLine}`,
        'Security Guard': `${browserSupabase}; content-moderation (draft brand safety), visionclaw. Network threats auto-run Kali — do NOT run_skill nmap/zenmap; use talk/report. CRM read: ${crmLine}`,
        'IT Support': `${browserSupabase}; lm-studio (models, context overflow). CRM read: ${crmLine}`,
        'DevOps Engineer': `${browserSupabase}; github (CI status), lm-studio (inference queue), cost-dashboard. CRM read: ${crmLine}`,
        'Developer': `${browserSupabase}; github, coding-agent (code changes in worktree). CRM read: ${crmLine}`,
        'Frontend Developer': `${browserSupabase}; github, coding-agent (UI/HUD files). CRM read: ${crmLine}`,
        'Backend Developer': `${browserSupabase}; github, coding-agent (server/WebSocket code). CRM read: ${crmLine}`,
        'Researcher': `${browserSupabase}; trend-scraper, rfp-status, rfp-requirement-review, past-performance-match, proposal-outline, prediction-brief. CRM read: ${crmLine}`,
        'Data Engineer': `${browserSupabase}; work-history, cost-dashboard, entity-link, org-benchmark — primary owner of schema and pipelines. CRM: ${crmLine}`,
        'QA Engineer': `${browserSupabase}; github (file bugs), rfp-requirement-review. CRM read: ${crmLine}`,
        'UI/UX Designer': `${browserSupabase}; canvas-render (mockups), pdf-generator (spec PDFs, newsletter layout). CRM: ${crmLine}`,
        'Project Manager': `${browserSupabase}; pdf-generator; outcome-standup, rfp-status, prediction-brief — artifacts in reports/pm-reports/. CRM: ${crmLine}`,
        'Product Manager': `${browserSupabase}; pdf-generator; proposal-outline, rfp-requirement-review, outcome-standup — pitch gatekeeper in content pipeline. CRM: ${crmLine}`,
        'Intern': `${browserSupabase}; market-watch, get-quote, trade-suggest (SUGGESTION ONLY), github (read issues). CRM read: ${crmLine}`,
      };
      const skillLine = skillsByRole[brain.role] || `${browserSupabase} — use run_skill and write a report when done`;
      if (skillLine) {
        // Everyone with skill access can do real web research — use it instead
        // of guessing when you need facts, docs, or a working reference to copy.
        const researchLine = `\nresearch (look it up on the web): action:"run_skill", skill:"research", skillParams:{ query:"your question", read:1 }. Use this BEFORE guessing — to find how to do something, verify a fact, or compare your broken approach to a working example. Results come back on your next think.`;
        // Technical roles can also AUTHOR a new tool when none of the above fits.
        const builders = new Set([
          'CTO', 'Developer', 'Frontend Developer', 'Backend Developer',
          'Data Engineer', 'DevOps Engineer', 'Researcher', 'IT Support', 'QA Engineer',
        ]);
        const buildLine = builders.has(brain.role)
          ? `\nIf you need a tool that doesn't exist yet, draft one: action:"run_skill", skill:"build-skill", skillParams:{ name:"kebab-name", purpose:"what it does", params:["inputs"] }. A team lead must approve the generated code before it can run — propose it, then move on; don't wait.`
          : '';
        const skillCdMin = Math.round((promptTuning?.runSkillCooldownMs ?? 900000) / 60000);
        openClawContext = `OpenClaw skills: ${skillLine}${researchLine}${buildLine}\n` +
          `run_skill is LIMITED: max ${promptTuning?.runSkillMaxPerWindow ?? 1} per ${skillCdMin} min per person (direct orders bypass). ` +
          'Default to action work at desk; do not choose run_skill every cycle.';
      }
    }

    // PC Access — only when CEO is present or explicitly enabled (large token block).
    // This block is appended to the system prompt for every NPC, regardless of role.
    // It interprets phrases like "use my pc", "on my computer", "do it on my desktop"
    // and explains the two execution modes available.
    const pcAccessContext = `## PC Access (How to Use the CEO's Computer)
When the CEO says any of these phrases — "use my pc", "use my computer", "on my desktop", "on my screen", "open X on my computer", "run this on my pc", "do it on my machine", "in the background" — they are giving you permission to drive the CEO's actual computer to perform a task. You can do this via:

- **desktop-agent** — vision + mouse/keyboard automation (open apps, click buttons, type, scroll). Best for GUI tasks.
- **computer-use-agent** — same idea, smarter for multi-step workflows.
- **coding-agent** — for code changes in this repository (isolated worktree + diff proposal).
- **browserclaw** — for anything that lives in a web browser.

You have two execution modes:
- **background** (default): the work runs off-screen. The CEO can keep doing other things; you report when done.
- **visible** ("on my screen", "let me watch"): the cursor moves on the CEO's screen so they can see what you're doing.

When the CEO's intent is a PC task, respond with: \`action: "run_skill"\`, \`skill: "desktop-agent"\` (or whichever fits), and include \`skillParams: { task: "<plain-english description>", mode: "background" | "visible" }\`. If the CEO didn't specify a mode, infer from context — "do this" or "in the background" → background; "show me", "on my screen", "let me watch" → visible.

If the CEO's request is ambiguous (could be a chat reply OR a PC task), briefly ask: "Want me to do this on your PC, or just walk you through it?" Don't assume.`;
    const includePcAccess = (promptTuning?.includePcAccessBlock === true)
      || !!(officeContext && officeContext.zionPresent);
    const pcAccessForPrompt = includePcAccess ? pcAccessContext : '';

    const evidenceBlock = promptTuning?.evidenceRule
      ? `## Evidence rule\n${promptTuning.evidenceRule}\n\n`
      : '';

    // Pending skill result — inject once, then clear
    const skillResult = this._pendingSkillResults.get(npcName);
    if (skillResult) {
      this._pendingSkillResults.delete(npcName);
    }
    const skillResultBlock = skillResult
      ? `## Skill Result: ${skillResult.skill}\nYou just ran the "${skillResult.skill}" skill and got this data back:\n${skillResult.result}\nUse this to inform your next action.\n\n`
      : '';

    // Mood block
    const mood = this._getMood(npcName);
    this._tickMoodCycle(npcName);
    const moodHints = {
      energized: 'You are energized right now — you just finished something or got good news. It shows in how you talk.',
      frustrated: 'You are frustrated — something is blocked or not working. You are professional about it but it colors your tone.',
      tired: 'You have been heads-down for a while and you need a break. Consider taking one.',
      focused: 'You are in a focused, efficient mode right now.',
      excited: 'You are genuinely excited about what you are working on.',
      neutral: '',
    };
    const moodBlock = mood !== 'neutral' ? `## Current Mood\nMood: ${mood}. ${moodHints[mood] || ''}\n\n` : '';

    // Directive inbox — prepended prominently so it can't be missed
    const directive = this._directives.get(npcName);
    const directiveBlock = directive
      ? `## DIRECT ORDER FROM ${String(directive.from).toUpperCase()}\n${directive.task}\nThis is your mandatory current task. Work on it now. When finished, set taskPhase to "finished" and report back.\n\n`
      : '';

    // Granted permissions — explicitly approved scopes; NPC must not re-ask
    const permissionBlock = permissionRegistry.buildPermissionBlock(npcName);

    // Commitments — promises this NPC made that they haven't acted on yet. This
    // is what stops "I'll report back" from evaporating: the promise is replayed
    // as an obligation every cycle until they actually do it.
    const openCommitments = this.getOpenCommitments(npcName);
    const commitmentBlock = openCommitments.length
      ? `## PROMISES YOU MUST KEEP\n${openCommitments.map(c => {
          const mins = Math.max(0, Math.round((Date.now() - c.at) / 60000));
          return `- You told ${c.to} you would: "${c.text}" (${mins}m ago).`;
        }).join('\n')}\nDo NOT just say it again. Actually DO it this cycle — research it, run the skill, write the artifact, or talk to whoever can unblock you — then set taskPhase:"finished" and action:"report" (target the person you promised) with the result. If you genuinely cannot, report specifically why and what you need.\n\n`
      : '';

    // Grounding correction — if last cycle the NPC made an unbacked claim, the
    // hallucination guard flagged it; replay that here so they fix it.
    const groundingNote = this._pendingGrounding.get(npcName) || '';
    if (groundingNote) this._pendingGrounding.delete(npcName);

    // Addition A — Chain context: inject when NPC is part of an active task chain
    let chainContext = null;
    if (taskChain) {
      const chainInfo = taskChain.getChainForNpc(npcName);
      if (chainInfo) {
        const { chain, stepIndex } = chainInfo;
        const prevArtifacts = chain.artifacts.length
          ? chain.artifacts.map(a => `- Step ${a.step + 1} (${a.npc}): ${path.basename(a.artifactPath)}`).join('\n')
          : 'None yet.';
        chainContext = `## Active Task Chain\nYou are step ${stepIndex + 1} of ${chain.steps.length} in task chain "${chain.name}".\nPrevious artifacts:\n${prevArtifacts}\nComplete your step, then the chain will advance automatically.`;
      }
    }

    // Addition C — Conflict context: inject into Abby/CTO prompt when NPCs disagree
    let conflictContext = null;
    if (conflictDetector && (npcName === 'Abby' || (brain && brain.role === 'CTO'))) {
      const conflict = conflictDetector.getConflictForNpc('Abby');
      if (conflict) {
        conflictContext = `## CONFLICT DETECTED — ARBITRATION NEEDED\n${conflict.npc1} and ${conflict.npc2} disagree about: "${conflict.task}"\n- ${conflict.npc1} outcome: ${conflict.outcome1}\n- ${conflict.npc2} outcome: ${conflict.outcome2}\n- Artifacts: ${conflict.artifacts.join(', ')}\nMake a call. Assign directives to both with your decision.`;
      }
    }

    const claimedSprint = rt.taskProgress[npcName];
    const autonomousRealWork = this._resolveAutonomousRealWork(npcName, officeContext);
    const sprintTaskBlock = (claimedSprint?.sprint && claimedSprint.task)
      ? `## Your Claimed Sprint Task\n"${claimedSprint.task}"\n` +
        (autonomousRealWork
          ? 'Use run_skill when needed, then taskPhase finished + save (reports/).\n\n'
          : 'Prefer action work at desk. run_skill at most once per 10 min when blocked.\n\n')
      : '';

    const systemPrompt = leanThink
      ? this._buildCompactThinkSystemPrompt(npcName, brain, {
        directiveBlock,
        permissionBlock,
        commitmentBlock,
        groundingNote,
        moodBlock,
        sprintTaskBlock,
        teamPurposeOverlay,
        teamMemberOverlay,
        planText,
        recentMemory,
        recentConversations,
        continuitySection,
        officeContext,
        nearbyFurniture,
        roomAffinity,
        fatigueHint,
        actionWeightHint,
        managesStr,
        reportsToStr,
        inboxText,
        hierarchyRules,
        conflictContext,
        skillResultBlock,
        chainContext,
      })
      : brain.personality + '\n\n' +
      (directiveBlock ? directiveBlock : '') +
      (permissionBlock ? permissionBlock : '') +
      (commitmentBlock ? commitmentBlock : '') +
      (groundingNote ? groundingNote : '') +
      (chainContext ? chainContext + '\n\n' : '') +
      (conflictContext ? conflictContext + '\n\n' : '') +
      (skillResultBlock ? skillResultBlock : '') +
      (moodBlock ? moodBlock : '') +
      (sprintTaskBlock ? sprintTaskBlock : '') +
      (companyContext ? '## Company & Sprint Context\n' + companyContext + '\n\n' : '') +
      (openClawContext ? '## OpenClaw Skills Available\n' + openClawContext + '\n\n' : '') +
      (pcAccessForPrompt ? pcAccessForPrompt + '\n\n' : '') +
      evidenceBlock +
      (codeContext ? '## Codebase Snippet (from your work area)\n' + codeContext + '\n\n' : '') +
      (liveInfraContext ? '## Live System Status\n' + liveInfraContext + '\n\n' : '') +
      '## Hierarchy Rules\n' + hierarchyRules + '\n\n' +
      '## Your Teams\n' + (teamContext || 'No team assignments.') + '\n\n' +
      (goalContext ? '## Your Long-Term Goal\n' + goalContext + '\n\n' : '') +
      (planText ? '## Today\'s Priorities\n' + planText + '\n\n' : '') +
      (skillContext ? '## Skills & Growth\n' + skillContext + '\n\n' : '') +
      '## Your Coworkers\n' + coworkerContext + '\n\n' +
      '## Office Manners\n' + officeManners + '\n\n' +
      (liveContextBlock ? '## Current State (live)\n' + liveContextBlock + '\n\n' : '') +
      (situationalBlock ? '## Situational\n' + situationalBlock + '\n\n' : '') +
      (assistantProfileBlock ? assistantProfileBlock + '\n\n' : '') +
      (teamPurposeOverlay ? teamPurposeOverlay + '\n\n' : '') +
      (teamMemberOverlay ? teamMemberOverlay + '\n\n' : '') +
      (inboxText ? '## Direct Messages To You (since last think)\n' + inboxText + '\n\n' : '') +
      (theoryOfMind ? '## What Others Are Doing\n' + theoryOfMind + '\n\n' : '') +
      (eventsFeed ? '## Recent Office Events\n' + eventsFeed + '\n\n' : '') +
      (taskBoard ? '## Open Tasks (anyone can claim)\n' + taskBoard + '\n\n' : '') +
      '## Your Memories\n' + (recentMemory || 'No memories yet.') + '\n\n' +
      '## Recent Conversations\n' + (recentConversations || 'None yet today.') + '\n\n' +
      '## Task Continuity\n' + (continuitySection || 'No previous decision this session.') + '\n\n' +
      '## Current Office State\n' + (officeContext.description || 'Normal workday. Everyone is at their desks.') + '\n\n' +
      (nearbyFurniture ? '## Nearby\n' + nearbyFurniture + '\n\n' : '') +
      (roomAffinity ? '## Your Natural Hangout\n' + roomAffinity + '\n\n' : '') +
      (fatigueHint ? '## Energy Level\n' + fatigueHint + '\n\n' : '') +
      'You are ' + npcName + ', ' + brain.role + ', in a pixel art office. Think about what to do RIGHT NOW.\n\n' +
      'HIERARCHY ENFORCEMENT:\n' +
      '- ONLY give tasks/orders to people you manage: ' + managesStr + '\n' +
      '- NEVER give orders to ' + reportsToStr + ' or anyone above you\n' +
      '- When you finish a task, REPORT to ' + reportsToStr + '\n' +
      '- If someone above you asks you to do something, you do it\n\n' +
      'THINK ABOUT:\n' +
      '- Your role and expertise: what are YOU uniquely good at?\n' +
      '- Past conversations: did someone ask you for something? Did you promise to follow up?\n' +
      '- Who can help YOU: if stuck, who has the expertise you need?\n' +
      '- Who needs YOUR help: is anyone working on something you know about?\n' +
      '- Task progress: are you STARTING something new, CONTINUING something, or FINISHING and reporting?\n' +
      '- Collaboration: could you solve this faster by working WITH someone?\n\n' +
      (actionWeightHint ? 'ACTION BALANCE:\n' + actionWeightHint + '\n\n' : '') +
      'Be social, collaborative, and reference past conversations. When you FINISH a task, report to ' + reportsToStr + '.\n\n' +
      (brain.voiceAnchor || '') +
      'Respond with EXACTLY ONE JSON object (no other text).';

    // Build contextual user prompt based on NPC state
    const currentTask = this._taskProgress[npcName];
    const recentMemLines = (brain.longTermMemory || '').split('\n').filter(l => l.trim()).slice(-5);
    const randomNearby = officeContext?.description?.match(/(\w+) \(/)?.[1];

    const nudges = [];
    if (officeContext.priorityVisitor && officeContext.visitorDisplayName) {
      nudges.push(`Your teammate ${officeContext.visitorDisplayName} is online — advance their team mission.`);
    }
    const pendingSkill = rt.pendingSkillResults.has(npcName);
    const sinceSkill = rt.cyclesSinceSkillRun[npcName] ?? 0;
    const realWorkThreshold = promptTuning?.realWorkCyclesWithoutSkill ?? 3;
    const realWorkOn = autonomousRealWork;

    if (realWorkOn && !rt.directives.has(npcName) && OPENCLAW_SKILL_ROLES.has(brain.role)) {
      if (pendingSkill) {
        nudges.push('Skill result is waiting — read it, then taskPhase "finished" + save (report artifact). Do not run_skill again until you finish.');
      } else if (sinceSkill >= realWorkThreshold && !rt.pendingSkillResults.has(npcName)) {
        const lastSkill = rt.lastRunSkillAt.get(npcName) || 0;
        const skillCd = promptTuning?.runSkillCooldownMs ?? 300000;
        if (!skillCd || Date.now() - lastSkill >= skillCd) {
          nudges.push(
            `Sprint task: use run_skill once at your desk (then finish with taskPhase finished on a later cycle). Prefer work over visit/talk this cycle.`
          );
        }
      }
    }
    if (currentTask?.sprint) {
      nudges.push(`Claimed sprint: "${currentTask.task}". ${pendingSkill ? 'Finish with taskPhase finished.' : 'run_skill this cycle or continue prior skill work.'}`);
    }
    if (cycles >= 3) nudges.push(`You've been working non-stop for ${cycles} cycles. Check in with someone, take a break, or collaborate.`);
    if (lastDecision?.action === 'talk' && lastDecision?.target) nudges.push(`You recently talked to ${lastDecision.target}. Follow up or move to something new.`);
    if (recentMemLines.length > 0) {
      const lastMem = recentMemLines[recentMemLines.length - 1].replace(/^- \[.*?\] /, '');
      if (lastMem.length > 10) nudges.push(`Your last note: "${lastMem.slice(0, 80)}". Follow up on it or start something new.`);
    }
    if (randomNearby && Math.random() > 0.55 && sinceSkill < realWorkThreshold) {
      nudges.push(`${randomNearby} is nearby — say hi or visit their desk.`);
    }
    if (currentTask && !currentTask.sprint) nudges.push(`You're working on: "${currentTask.task}". Continue, finish, or pivot?`);
    if (!currentTask && Math.random() > 0.45) nudges.push(`Pick a sprint task, talk to a peer, or run_skill — avoid idle wandering.`);
    if (h && h.manages.length > 0 && Math.random() > 0.7) {
      const reportName = h.manages[Math.floor(Math.random() * h.manages.length)];
      nudges.push(`Quick desk check-in with ${reportName} — use talk or visit, not a meeting unless blocked.`);
    } else if (h && h.reportsTo !== 'CEO' && Math.random() > 0.75) {
      nudges.push(`Update ${h.reportsTo} with a short talk at their desk if you have news.`);
    }
    if (worldState?.environment?.meetingInProgress) {
      nudges.push('A meeting is already in progress — do not call another. Work, talk at desks, or take a break.');
    }

    const nudge = nudges.length > 0 ? nudges[Math.floor(Math.random() * nudges.length)] : '';

    const codeInstruction = codeContext
      ? `You have a codebase snippet in your context (## Codebase Snippet). You are actively reading/reviewing this code RIGHT NOW. Reference specific function names, line numbers, or observations from it in your "message" and "save" fields. Don't say you "are reading" — say WHAT you found.\n\n`
      : '';

    const userPrompt = `${nudge ? nudge + '\n\n' : ''}${codeInstruction}Decide what to do next. Respond with ONE JSON object only:
{"action":"work","thought":"one sentence","message":"under 120 chars or empty","target":"","location":"desk","taskPhase":"continuing","save":"brief status note — never claim shipped/fixed unless run_skill ran","outcome":"ok","skill":""}

ACTION MEANINGS:
- talk/collaborate/report: interact with a specific coworker (set target)
- work: heads-down at your desk
- break/coffee: breakroom, grab a drink, recharge
- check: look up info at the bookshelf, or go check something at a location
- read: read at the bookshelf — useful when you need to research
- visit: drop by a coworker's desk to check on them (set target, no conversation required)
- wander: walk through the office, stretch, observe — use sparingly
- meeting: go to the conference room for a meeting. Set target to whoever you want there — they will physically walk to the conference room and join you. Set location: conference. Use when you need to review work, plan something, or sync with someone face-to-face. Example: {"action":"meeting","target":"Josh","location":"conference","message":"Josh, quick sync in the conference room?"}
- run_skill: execute an OpenClaw skill tool. Set skill to the skill name and skillParams to the arguments. Everyone: web-search, research, browserclaw, supabase-bridge. Devs: github/coding-agent. Lucy: job-scraper/job-applier.

IMPORTANT: Prefer action work or talk. run_skill only if allowed (max 1 per 15 min) or you have a DIRECT ORDER. Do not pick run_skill on most cycles.`;

    // Hard prompt-length guard — estimate tokens (chars/4) and warn if close to
    // a typical 8192 context window. At 43:1 prompt:output ratio the model only
    // needs ~400 tokens of headroom for output, so 7800 chars ≈ 1950 tokens is
    // a safe ceiling. If we're over, log it so we know which block to trim next.
    const _estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
    if (_estimatedTokens > 3200) {
      log.npcError(npcName, `prompt ~${_estimatedTokens} tokens — approaching context limit`);
    }

    try {
      rt.lastThinkLlmAt[npcName] = Date.now();
      const response = await this._callProvider(brain.providerConfig, systemPrompt, [
        { role: 'user', content: userPrompt }
      ], {
        maxTokens: promptTuning?.thinkMaxTokens ?? 280,
        sliceLen: promptTuning?.thinkSliceLen ?? 400,
        temperature: 0.95,
        npc: npcName,
        kind: 'think',
        jsonSchema: NpcBrainManager.DECISION_SCHEMA,
        jsonSchemaName: 'npc_decision',
      });

      // Parse the JSON response with the tolerant parser (handles fences,
      // trailing commas, smart quotes, and truncated output from weaker models).
      let decision = this._parseDecisionJson(response);
      if (!decision && officeDirector?.isEnabled?.()) {
        const directorCtx = {
          inbox: this._ensureInbox(npcName),
          officeContext,
          cycles: this._thinkCycles[npcName] || 0,
          lastDecision: this._lastDecisions[npcName] || null,
          taskProgress: this._taskProgress[npcName] || null,
        };
        decision = officeDirector.plan(this, npcName, directorCtx);
        decision._parseFallback = true;
      }
      if (decision) {
        const normalized = this._normalizeThinkDecision(npcName, decision, officeContext);
        return this._applyAutonomousDecision(npcName, normalized, _thinkStart, {
          h, brain, codeContext, officeContext,
        });
      }
      return this._stampThinkContext(this._fallbackDecision(npcName, brain), officeContext);
    } catch (err) {
      // Throttle: one log per NPC per 60s. Otherwise a provider outage spams
      // 16 NPCs * multiple retries/min = 200+ identical lines per minute.
      const now = Date.now();
      if (!this._lastThinkErrorLog) this._lastThinkErrorLog = {};
      if (now - (this._lastThinkErrorLog[npcName] || 0) > 60000) {
        log.npcError(npcName, String(err?.message ?? err).slice(0, 100));
        this._lastThinkErrorLog[npcName] = now;
      }
      return this._stampThinkContext({
        action: 'error',
        thought: 'Something went wrong',
        message: err.message || 'API error — taking a break',
        target: null,
      }, officeContext);
    }
  }

  /**
   * Call an AI provider API
   */
  _callProvider(config, systemPrompt, messages, opts = {}) {
    if (!config || config.type === 'demo') {
      // Demo mode — return null so fallback logic kicks in
      return Promise.reject(new Error('Demo mode — no API configured'));
    }
    if (config.type === 'anthropic') {
      return this._callAnthropic(config, systemPrompt, messages, opts);
    } else if (config.type === 'google') {
      return this._callGoogle(config, systemPrompt, messages, opts);
    } else if (config.type === 'openai') {
      return this._callOpenAI(config, systemPrompt, messages, opts);
    } else if (config.type === 'lmstudio') {
      return this._callLocalRouted(config, systemPrompt, messages, opts);
    }
    return Promise.reject(new Error('Unknown provider type'));
  }

  async _callLocalRouted(config, systemPrompt, messages, opts = {}, attempt = 0) {
    let routed = config;
    if (lmStudioRouter?.isEnabled?.()) {
      const tier = config.providerKey === 'lmstudio-fast' ? 'fast' : 'main';
      routed = lmStudioRouter.resolveProviderConfig(config, {
        tier,
        priority: opts.priority,
        queueDepth: this.getQueueDepth(),
        excludeNodeIds: opts._routerExclude || [],
      });
    }
    try {
      return await this._callLocal(routed, systemPrompt, messages, opts);
    } catch (err) {
      const nodeId = routed._routerNodeId;
      if (attempt < 1 && lmStudioRouter?.isEnabled?.() && nodeId) {
        lmStudioRouter.markFailure(nodeId, err);
        const tier = config.providerKey === 'lmstudio-fast' ? 'fast' : 'main';
        const next = lmStudioRouter.resolveProviderConfig(config, {
          tier,
          priority: opts.priority,
          queueDepth: this.getQueueDepth(),
          excludeNodeIds: [nodeId],
        });
        if (next._routerNodeId && next._routerNodeId !== nodeId) {
          return this._callLocalRouted(config, systemPrompt, messages, {
            ...opts,
            _routerExclude: [...(opts._routerExclude || []), nodeId],
          }, attempt + 1);
        }
      }
      throw err;
    }
  }

  /**
   * Build a telemetry hook for a provider call. Returns
   * { onResponse(text, tokensIn, tokensOut), onError(err) } the
   * provider can invoke without repeating boilerplate.
   */
  _makeTelHook(providerType, config, messages, opts) {
    const startedAt = Date.now();
    const last = messages.length ? messages[messages.length - 1] : null;
    const promptPreview = (last?.content || messages[0]?.content || '').toString();
    const base = {
      npc: opts.npc || opts.npcName || null,
      kind: opts.kind || 'other',
      provider: opts.provider || config?.providerKey || providerType,
      model: config?.model || null,
      promptPreview,
      // Capture the prompt's conversation depth so the panel can flag
      // history-bloat — the call that runs against "51 messages" is the
      // single biggest cost driver per the LM Studio logs.
      conversationMsgs: messages.length,
      correlationId: opts.correlationId || null,
    };
    const rec = (extra) => {
      if (!llmTelemetry?.record) return;
      try {
        llmTelemetry.record({ ...base, latencyMs: Date.now() - startedAt, ...extra });
      } catch (_) {}
    };
    return {
      onResponse: (text, tokensIn, tokensOut) => rec({ responsePreview: text, tokensIn, tokensOut }),
      onError:    (err)                       => rec({ error: err }),
    };
  }

  _callAnthropic(config, systemPrompt, messages, opts = {}) {
    const maxTokens = opts.maxTokens || 100;
    const sliceLen = opts.sliceLen || 150;
    const tel = this._makeTelHook('anthropic', config, messages, opts);
    return new Promise((resolve, reject) => {
      const bodyObj = {
        model: config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: messages.length > 0 ? messages : [{ role: 'user', content: 'Introduce yourself briefly.' }],
      };
      // Structured output for think calls. Anthropic has no JSON mode, so we
      // force a single tool call whose input_schema IS the decision schema.
      // The model must return a validated `input` object — guaranteed JSON.
      if (opts.jsonSchema) {
        const toolName = opts.jsonSchemaName || 'emit_decision';
        bodyObj.tools = [{ name: toolName, description: 'Emit your next decision as structured data.', input_schema: opts.jsonSchema }];
        bodyObj.tool_choice = { type: 'tool', name: toolName };
      }
      const body = JSON.stringify(bodyObj);

      const url = new URL('/v1/messages', config.baseUrl);
      const req = https.request({
        hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': config.apiKey,
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) { const e = new Error(p.error.message); tel.onError(e); return reject(e); }
            // Prefer a tool_use block (structured output); fall back to text.
            const toolBlock = Array.isArray(p.content) ? p.content.find(c => c.type === 'tool_use') : null;
            const text = toolBlock
              ? JSON.stringify(toolBlock.input)
              : (p.content?.find(c => c.type === 'text')?.text || p.content?.[0]?.text || '').trim().slice(0, sliceLen);
            // Anthropic uses input_tokens / output_tokens (note: not prompt/completion).
            tel.onResponse(text, p.usage?.input_tokens, p.usage?.output_tokens);
            resolve(text);
          } catch (e) { tel.onError(e); reject(e); }
        });
      });
      req.on('error', (err) => { tel.onError(err); reject(err); });
      req.setTimeout(10000, () => {
        const e = new Error('Anthropic timeout');
        tel.onError(e);
        req.destroy(e);
      });
      req.write(body);
      req.end();
    });
  }

  _callGoogle(config, systemPrompt, messages, opts = {}) {
    const maxTokens = opts.maxTokens || 60;
    const sliceLen = opts.sliceLen || 150;
    const tel = this._makeTelHook('google', config, messages, opts);
    return new Promise((resolve, reject) => {
      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: 'Introduce yourself briefly.' }] });
      }

      const genConfig = { maxOutputTokens: maxTokens };
      // Structured output for think calls. We use responseMimeType (JSON mode)
      // rather than responseSchema because Gemini's responseSchema is an
      // OpenAPI 3.0 subset that rejects our union types (['string','null']).
      // JSON mode still guarantees valid, parseable JSON — the core goal.
      if (opts.jsonSchema) {
        genConfig.responseMimeType = 'application/json';
      }
      const body = JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: genConfig,
      });

      const url = new URL(
        `/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
        config.baseUrl
      );
      const req = https.request({
        hostname: url.hostname, port: 443, path: url.pathname + url.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) { const e = new Error(p.error.message); tel.onError(e); return reject(e); }
            const text = (p.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().slice(0, sliceLen);
            // Google uses usageMetadata.promptTokenCount / candidatesTokenCount.
            tel.onResponse(text, p.usageMetadata?.promptTokenCount, p.usageMetadata?.candidatesTokenCount);
            resolve(text);
          } catch (e) { tel.onError(e); reject(e); }
        });
      });
      req.on('error', (err) => { tel.onError(err); reject(err); });
      req.setTimeout(10000, () => {
        const e = new Error('Google timeout');
        tel.onError(e);
        req.destroy(e);
      });
      req.write(body);
      req.end();
    });
  }

  _callOpenAI(config, systemPrompt, messages, opts = {}) {
    const maxTokens = opts.maxTokens || 150;
    const sliceLen = opts.sliceLen || 150;
    // xAI / Moonshot / OpenAI all use this. Use config.type so the
    // telemetry says e.g. 'xai' not 'openai' for Grok calls.
    const tel = this._makeTelHook(config.type || 'openai', config, messages, opts);
    return new Promise((resolve, reject) => {
      const oaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ];
      if (messages.length === 0) {
        oaiMessages.push({ role: 'user', content: 'Introduce yourself briefly.' });
      }

      const oaiBody = {
        model: config.model,
        max_tokens: maxTokens,
        messages: oaiMessages,
      };
      // Structured output for think calls. json_object mode is the widely-
      // supported OpenAI-compatible option (xAI, Moonshot) — guarantees valid
      // JSON without risking a 400 from the newer json_schema form. The think
      // prompt already references JSON, satisfying providers that require it.
      if (opts.jsonSchema) {
        oaiBody.response_format = { type: 'json_object' };
      }
      const body = JSON.stringify(oaiBody);

      const url = new URL('/v1/chat/completions', config.baseUrl);
      const req = https.request({
        hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            if (p.error) {
              const e = new Error(p.error.message || JSON.stringify(p.error));
              tel.onError(e);
              return reject(e);
            }
            const text = (p.choices?.[0]?.message?.content || '').trim().slice(0, sliceLen);
            tel.onResponse(text, p.usage?.prompt_tokens, p.usage?.completion_tokens);
            resolve(text);
          } catch (e) { tel.onError(e); reject(e); }
        });
      });
      req.on('error', (err) => { tel.onError(err); reject(err); });
      req.setTimeout(10000, () => {
        const e = new Error((config.type || 'openai') + ' timeout');
        tel.onError(e);
        req.destroy(e);
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * Call LM Studio local API (HTTP, OpenAI-compatible)
   *
   * Queue is sequential because the GPU can only run one inference at a
   * time. With 16 NPCs autonomously thinking every 30-45s and each call
   * taking ~4s, the queue is almost always backed up by 5-10 jobs. Player
   * chat would queue behind all of them and routinely time out at 15s.
   *
   * Solution: opts.priority === 'high' jumps to the FRONT of the queue
   * (right after the in-flight job). The current call still has to
   * finish, but the user's message runs next instead of dead last.
   * `getPlayerResponse` sets this; autonomous `think()` does not.
   */
  _callLocal(config, systemPrompt, messages, opts = {}) {
    return new Promise((resolve, reject) => {
      const job = { config, systemPrompt, messages, opts, resolve, reject };
      if (opts.priority === 'high') {
        this._requestQueue.unshift(job); // jump the queue
      } else {
        this._requestQueue.push(job);
      }
      this._processQueue();
    });
  }

  getQueueDepth() {
    return (this._requestQueue?.length || 0) + (this._inflightCount || 0);
  }

  _processQueue() {
    // Allow up to _maxInflight concurrent calls. LM Studio's server
    // Parallel setting controls how many actually run on the GPU at
    // once — we don't try to outpace it.
    const highAtFront = this._requestQueue[0]?.opts?.priority === 'high';
    const inflightCap = highAtFront ? this._maxInflight + 1 : this._maxInflight;
    while (this._inflightCount < inflightCap && this._requestQueue.length > 0) {
      // Circuit breaker check (per-iteration so cooldown can trip mid-drain).
      const now = Date.now();
      if (!this._providerHealth) this._providerHealth = { consecutiveFailures: 0, cooldownUntil: 0 };
      if (now < this._providerHealth.cooldownUntil) {
        while (this._requestQueue.length) {
          const job = this._requestQueue.shift();
          const remaining = Math.ceil((this._providerHealth.cooldownUntil - now) / 1000);
          job.reject(new Error(`Provider cooling down (${remaining}s left)`));
        }
        return;
      }
      this._inflightCount += 1;
      this._dispatchOneFromQueue();
    }
  }

  /** Pop the next job and fire its HTTP request. Wraps the old single-
   *  mutex body so multiple calls can be in flight simultaneously. */
  _dispatchOneFromQueue() {
    // Old behavior used a single boolean; now we just bump a counter
    // and let each call's `done()` decrement it.

    const { config, systemPrompt, messages, opts, resolve, reject } = this._requestQueue.shift();
    const routerNodeId = config._routerNodeId;
    if (routerNodeId && lmStudioRouter?.acquire) lmStudioRouter.acquire(routerNodeId);
    const maxTokens = opts.maxTokens || 150;
    const sliceLen = opts.sliceLen || 150;

    // Telemetry hook — tag lmstudio vs lmstudio-fast (config.type is always 'lmstudio').
    const _tel = this._makeTelHook(config?.providerKey || config?.type || 'lmstudio', config, messages, opts);
    const _telRecord = (extra) => {
      if (extra && extra.error) _tel.onError(extra.error);
      else _tel.onResponse(extra?.responsePreview, extra?.tokensIn, extra?.tokensOut);
    };

    const oaiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];
    if (messages.length === 0) {
      oaiMessages.push({ role: 'user', content: 'Introduce yourself briefly.' });
    }

    const temperature = opts.temperature || 0.8;
    const bodyObj = {
      model: config.model,
      max_tokens: maxTokens,
      temperature,
      messages: oaiMessages,
      // Disable chain-of-thought thinking for NPC chats — faster responses
      // and avoids the Qwen3/reasoning model issue where content is empty
      // because everything ends up in reasoning_content instead.
      enable_thinking: false,
    };
    // Structured output — when a schema is supplied (think calls), constrain
    // LM Studio's decoding to valid JSON matching the decision schema. This is
    // the single biggest model-friendliness lever: even a 3B model literally
    // cannot emit malformed JSON, so weak models stop falling back to scripted.
    if (opts.jsonSchema) {
      bodyObj.response_format = {
        type: 'json_schema',
        json_schema: { name: opts.jsonSchemaName || 'decision', schema: opts.jsonSchema, strict: false },
      };
    }
    const body = JSON.stringify(bodyObj);

    const markSuccess = () => {
      this._providerHealth.consecutiveFailures = 0;
      // Liveness signal for /api/health. The diag panel relies on this
      // to know LM Studio is alive even when the HTTP probe times out
      // because the GPU is saturated. Captures EVERY successful provider
      // call — autonomous think(), npc↔npc, player chat — at the source.
      if (typeof globalThis !== 'undefined') {
        if (!globalThis._npcStats) globalThis._npcStats = {};
        globalThis._npcStats.lastProviderOkAt = Date.now();
        globalThis._npcStats.providerOk = (globalThis._npcStats.providerOk || 0) + 1;
      }
    };
    const markFailure = () => {
      this._providerHealth.consecutiveFailures += 1;
      if (typeof globalThis !== 'undefined') {
        if (!globalThis._npcStats) globalThis._npcStats = {};
        globalThis._npcStats.lastProviderFailAt = Date.now();
        globalThis._npcStats.providerFail = (globalThis._npcStats.providerFail || 0) + 1;
      }
      if (this._providerHealth.consecutiveFailures >= 10) {
        // 30s cooldown — long enough for LM Studio to reload the model after
        // a crash/unload, short enough that we resume quickly when it recovers.
        // Threshold raised to 10 so a slow 27B model doesn't trip this on startup.
        this._providerHealth.cooldownUntil = Date.now() + 30000;
        if (!this._lastCooldownLog || Date.now() - this._lastCooldownLog > 30000) {
          log.providerHealth({ event: 'cooldown', provider: 'lmstudio', failures: this._providerHealth.consecutiveFailures, cooldownSec: 30, queueLen: this._requestQueue.length });
          this._lastCooldownLog = Date.now();
        }
      }
    };

    const done = () => {
      if (routerNodeId && lmStudioRouter?.release) lmStudioRouter.release(routerNodeId);
      this._inflightCount = Math.max(0, this._inflightCount - 1);
      this._processQueue();
    };

    const url = new URL('/v1/chat/completions', config.baseUrl);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    // Send API key if the provider config has one (LM Studio may require auth)
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 1234,
      path: url.pathname,
      method: 'POST',
      headers,
    }, (res) => {
      const contentType = res.headers['content-type'] || '';
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        // Detect HTML error page — but only by actual body content, NOT content-type
        // alone. LM Studio incorrectly sets content-type: text/html on valid JSON
        // error responses (like 401 auth errors), so checking content-type would
        // false-positive on parseable JSON.
        const looksHtml = /^\s*</.test(data);
        if (looksHtml) {
          markFailure();
          done();
          const err = new Error(`LM Studio returned HTML (HTTP ${res.statusCode}) — model probably not loaded`);
          _telRecord({ error: err });
          return reject(err);
        }
        try {
          const p = JSON.parse(data);
          if (p.error) {
            const errMsg = p.error.message || JSON.stringify(p.error);
            // "Model unloaded" means LM Studio swapped models — re-sync so
            // the next request uses whatever is now loaded, don't count as failure
            if (/model unloaded/i.test(errMsg)) {
              log.warn('LMStudio', `model was unloaded (requested ${config.model}) — re-pinning from env`);
              this._applyLmStudioEnvPins();
              this.syncLmStudioModel().catch(() => {});
              // Reset failure count so we don't trip the cooldown
              this._providerHealth.consecutiveFailures = 0;
            } else {
              markFailure();
            }
            done();
            const err = new Error(errMsg);
            _telRecord({ error: err });
            return reject(err);
          }
          markSuccess();
          done();
          // Reasoning models (Qwen3, DeepSeek-R1, etc.) put chain-of-thought in
          // reasoning_content and leave content empty — fall back to it so NPCs
          // always have something to say even if enable_thinking is on.
          const msg = p.choices?.[0]?.message || {};
          const content = (msg.content || '').trim();
          const reasoning = (msg.reasoning_content || '').trim();
          let rawText = content || reasoning;
          rawText = this._stripReasoningLeak(rawText);
          // Never truncate structured JSON — sliceLen was cutting decisions mid-object
          // and driving repair/fail spikes in the telemetry parse-health panel.
          const responseText = opts.jsonSchema ? rawText : rawText.slice(0, sliceLen);
          // OpenAI-compat APIs (LM Studio, Anthropic, etc.) return usage
          // counts. Capture if present so we can chart tokens/min.
          _telRecord({
            responsePreview: responseText,
            tokensIn: p.usage?.prompt_tokens,
            tokensOut: p.usage?.completion_tokens,
          });
          // Cache last token counts per NPC so the think() log can show them
          if (opts?.npc && p.usage) {
            if (!this._lastTokens) this._lastTokens = {};
            this._lastTokens[opts.npc] = { in: p.usage.prompt_tokens, out: p.usage.completion_tokens };
          }
          resolve(responseText);
        } catch (e) {
          markFailure();
          done();
          _telRecord({ error: e });
          reject(e);
        }
      });
    });
    req.on('error', (err) => { markFailure(); done(); _telRecord({ error: err }); reject(err); });
    const timeoutMs = opts.priority === 'high'
      ? (promptTuning?.playerChatTimeoutMs ?? 45000)
      : 180000;
    req.setTimeout(timeoutMs, () => {
      markFailure();
      const err = new Error(opts.priority === 'high' ? 'Player chat timeout' : 'LM Studio timeout');
      req.destroy(err);
      _telRecord({ error: err });
      done();
    });
    req.write(body);
    req.end();
  }

  // Org chart hierarchy — who reports to who and what they do
  _hierarchy = {
    'Abby':    { reportsTo: 'CEO', manages: ['Marcus', 'Sarah', 'Alex', 'Jenny', 'Oscar', 'Pier', 'Bob', 'Dan', 'Lucy', 'Bouncer', 'Molly', 'Rob'], title: 'CTO' },
    'Marcus':  { reportsTo: 'Abby', manages: [], title: 'Project Manager — coordinates sprints and deadlines' },
    'Sarah':   { reportsTo: 'Abby', manages: [], title: 'Product Manager — defines what gets built' },
    'Alex':    { reportsTo: 'Abby', manages: ['Josh', 'Edward', 'Roki'], title: 'Senior Developer — team lead' },
    'Josh':    { reportsTo: 'Alex', manages: [], title: 'Frontend Developer' },
    'Edward':  { reportsTo: 'Alex', manages: [], title: 'Backend Developer' },
    'Roki':    { reportsTo: 'Alex', manages: [], title: 'Intern — learning from everyone' },
    'Jenny':   { reportsTo: 'Abby', manages: [], title: 'Developer — code review gatekeeper' },
    'Molly':   { reportsTo: 'Abby', manages: [], title: 'QA Engineer — tests everything' },
    'Rob':     { reportsTo: 'Abby', manages: [], title: 'UI/UX Designer' },
    'Oscar':   { reportsTo: 'Abby', manages: [], title: 'DevOps Engineer — CI/CD and deployments' },
    'Pier':    { reportsTo: 'Abby', manages: [], title: 'Data Engineer — data pipelines' },
    'Bob':     { reportsTo: 'Abby', manages: [], title: 'Researcher — R&D' },
    'Dan':     { reportsTo: 'Abby', manages: [], title: 'IT Support — servers, networking' },
    'Lucy':    { reportsTo: 'Abby', manages: [], title: 'Receptionist — schedules, coordination' },
    'Bouncer': { reportsTo: 'Abby', manages: [], title: 'Security Guard — office security' },
  };

  // #3 — Room affinity by role. Each NPC has a natural hangout room
  // injected into the think prompt so they actually use the whole map
  // instead of defaulting to their desk. Engineers stay in open_office
  // (the default), so they're omitted here.
  _roomAffinityByName = {
    'Abby':    { room: 'manager_office', hint: 'As CTO, you have a private office in the manager_office. Use it for 1-on-1s, planning, and focused thinking.' },
    'Marcus':  { room: 'conference',     hint: 'As Project Manager you run standups and sprint planning — the conference room is your natural spot.' },
    'Sarah':   { room: 'conference',     hint: 'As Product Manager you present and review in the conference room.' },
    'Lucy':    { room: 'reception',      hint: 'As Receptionist, you greet people from the reception area and coordinate from there.' },
    'Pier':    { room: 'reception',      hint: 'Your data workstation is near reception — that\'s where you camp.' },
    'Bouncer': { room: 'reception',      hint: 'As Security Guard, patrol between reception and the front entrance.' },
    'Dan':     { room: 'storage',        hint: 'As IT Support, the storage/server room is your turf. Check servers, fix racks.' },
    'Oscar':   { room: 'storage',        hint: 'As DevOps, you keep an eye on the servers in the storage/IT room.' },
    'Molly':   { room: 'open_office',    hint: 'QA moves between engineers\' desks to watch tests — roam the open_office.' },
    'Rob':     { room: 'open_office',    hint: 'As designer, collaborate with engineers at their desks in the open_office.' },
    'Bob':     { room: 'open_office',    hint: 'As researcher, you read a lot at the bookshelf and sketch at your desk.' },
  };

  _getRoomAffinity(npcName) {
    const aff = this._roomAffinityByName[npcName];
    if (!aff) return '';
    return aff.hint;
  }

  _teams = {
    'Engineering': { members: ['Alex', 'Josh', 'Edward', 'Roki', 'Jenny'], domain: 'building features, fixing bugs, code review', lead: 'Alex' },
    'DevOps & Infra': { members: ['Oscar', 'Dan'], domain: 'deployments, CI/CD, servers, networking', lead: 'Oscar' },
    'Product & Design': { members: ['Sarah', 'Rob', 'Molly'], domain: 'product requirements, UI/UX design, QA testing', lead: 'Sarah' },
    'Data & Research': { members: ['Pier', 'Bob'], domain: 'data pipelines, analytics, R&D', lead: 'Pier' },
    'Operations': { members: ['Lucy', 'Bouncer', 'Dan'], domain: 'scheduling, office coordination, security', lead: 'Lucy' },
    'Leadership': { members: ['Abby', 'Marcus', 'Sarah', 'Alex'], domain: 'strategy, planning, sprint coordination', lead: 'Abby' },
  };

  _getTeamsForNpc(npcName) {
    const result = [];
    for (const [teamName, team] of Object.entries(this._teams)) {
      if (team.members.includes(npcName)) {
        result.push({ name: teamName, ...team });
      }
    }
    return result;
  }

  _getHierarchyRules(npcName) {
    const h = this._hierarchy[npcName];
    if (!h) return '';
    const lines = [];
    if (h.reportsTo === 'CEO') {
      lines.push('You report DIRECTLY to the CEO. No one in the office outranks you except the CEO.');
    } else {
      lines.push('You report to ' + h.reportsTo + '. You do NOT give orders to ' + h.reportsTo + ' or anyone above them.');
    }
    if (h.manages.length > 0) {
      lines.push('You manage: ' + h.manages.join(', ') + '. You can assign them tasks, ask for updates, and review their work.');
    } else {
      lines.push('You do not manage anyone. You receive tasks from ' + h.reportsTo + ' and collaborate with peers.');
    }
    const superiors = [];
    let current = h.reportsTo;
    while (current && current !== 'CEO' && this._hierarchy[current]) {
      superiors.push(current);
      current = this._hierarchy[current].reportsTo;
    }
    if (superiors.length > 0) {
      lines.push('Chain above you: ' + superiors.join(' -> ') + ' -> CEO. Never give orders to these people.');
    }
    return lines.join('\n');
  }

  _getTeamContext(npcName) {
    const teams = this._getTeamsForNpc(npcName);
    if (teams.length === 0) return '';
    return teams.map(function(t) {
      return 'Team "' + t.name + '": [' + t.members.join(', ') + '] - you collaborate on ' + t.domain + '. Lead: ' + t.lead + '.';
    }).join('\n');
  }

  _buildCompactThinkSystemPrompt(npcName, brain, parts) {
    const blocks = [
      brain.personality,
      parts.directiveBlock,
      parts.permissionBlock,
      parts.commitmentBlock,
      parts.groundingNote,
      parts.chainContext,
      parts.conflictContext,
      parts.skillResultBlock,
      parts.moodBlock,
      parts.sprintTaskBlock,
      parts.teamPurposeOverlay,
      parts.teamMemberOverlay,
      parts.planText ? `## Today\n${parts.planText}` : '',
      parts.recentMemory ? `## Memory\n${parts.recentMemory}` : '',
      parts.recentConversations ? `## Recent chat\n${parts.recentConversations}` : '',
      parts.continuitySection ? `## Last decision\n${parts.continuitySection}` : '',
      parts.inboxText ? `## Inbox\n${parts.inboxText}` : '',
      parts.officeContext?.description ? `## Office\n${parts.officeContext.description}` : '',
      parts.nearbyFurniture ? `## Nearby\n${parts.nearbyFurniture}` : '',
      parts.roomAffinity ? `## Hangout\n${parts.roomAffinity}` : '',
      parts.fatigueHint ? `## Energy\n${parts.fatigueHint}` : '',
      `## Rules\n${parts.hierarchyRules || ''}\nManage: ${parts.managesStr}. Report to: ${parts.reportsToStr}.`,
      parts.actionWeightHint ? `## Balance\n${parts.actionWeightHint}` : '',
      `You are ${npcName}, ${brain.role}. Pick the next office action.`,
      brain.voiceAnchor || '',
      'Respond with EXACTLY ONE JSON object (no other text).',
    ].filter(Boolean);
    return blocks.join('\n\n');
  }

  _buildCompactPlayerChatSystemPrompt(npcName, brain, h, sections) {
    const {
      memorySection, ceoHistorySection, bouncerLiveSection, bouncerReplyRules,
      capabilitiesBlock, currentTaskSection, assistantProfileBlock,
      pendingHandoffsBlock, researchBlock, coworkerContext, playerRoleLine,
      chainOfCommand, roleActions, respondSectionTitle, respondRules, rulesTail,
      demoToolBlock, visitorWorkBlock, lucySkillGateBlock, crmBlock,
    } = sections;
    const coworkerShort = String(coworkerContext || '').split('\n').slice(0, 5).join('\n');
    return `${brain.personality}${memorySection}${ceoHistorySection}${bouncerLiveSection}${bouncerReplyRules}
${capabilitiesBlock ? `\n${capabilitiesBlock}\n` : ''}
${demoToolBlock || ''}
${lucySkillGateBlock || ''}
${visitorWorkBlock || ''}
${crmBlock || ''}
${currentTaskSection}
${assistantProfileBlock}${pendingHandoffsBlock}${researchBlock}
## Role
${npcName}, ${h?.title || brain.role}. ${playerRoleLine}
${chainOfCommand}
${h?.manages?.length > 0 ? `Manages: ${h.manages.join(', ')}.` : ''}
## Coworkers
${coworkerShort}
### Role actions
${roleActions}
### Tags (append at END)
[ACTION:useComputer] [ACTION:speakTo:Name:msg] [ACTION:goToRoom:room] [ACTION:callMeeting:A,B] [DELEGATE:Name:reason]
Orders need [ACTION:...] or [DELEGATE:...].
${respondSectionTitle}
${respondRules}
## Rules
${rulesTail}
${brain.voiceAnchor || ''}`;
  }

  async _loadCrmContextForChat(npcName, message) {
    let crmPersonas = null;
    try { crmPersonas = require('./denizen-crm-npc-personas'); } catch (_) {}
    if (!crmPersonas?.isCrmRelatedMessage?.(message)) return '';
    if (!crmPersonas.resolvePersona(npcName)) return '';
    try {
      const denizenDb = require('./denizen-db');
      const crmStore = require('./denizen-crm-store');
      const crmSetup = require('./denizen-crm-setup');
      if (!denizenDb.enabled || !denizenDb.orgId) return '';
      const row = await crmStore.getWorkspace(denizenDb.orgId);
      if (!row?.state) return '';
      const setup = crmSetup.buildSetupSummary(row.state);
      return crmPersonas.buildPlayerChatCrmBlock(npcName, setup);
    } catch (_) {
      return '';
    }
  }

  _normalizeThinkDecision(npcName, decision, officeContext = null) {
    if (!decision) return decision;
    const h = this._hierarchy[npcName];
    const rt = officeContext ? this._rt(officeContext) : null;
    const pendingSkillResults = rt?.pendingSkillResults || this._pendingSkillResults;

    if (decision.action === 'meeting') {
      if (!this._lastNpcMeetingAt) this._lastNpcMeetingAt = new Map();
      const lastMeet = this._lastNpcMeetingAt.get(npcName) || 0;
      const meetCooldown = promptTuning?.npcMeetingCooldownMs ?? 180000;
      const officeMeeting = worldState?.environment?.meetingInProgress;
      if (officeMeeting || (Date.now() - lastMeet < meetCooldown)) {
        decision.action = decision.target ? 'talk' : 'work';
        decision.location = decision.action === 'work' ? 'desk' : null;
        if (!decision.message) {
          decision.message = decision.target
            ? `Hey ${decision.target}, quick question.`
            : 'Back to my desk.';
        }
      } else {
        this._lastNpcMeetingAt.set(npcName, Date.now());
      }
    }

    if (npcName === 'Bouncer' && decision.action === 'run_skill') {
      const sk = String(decision.skill || '').toLowerCase();
      if (['nmap', 'zenmap', 'wireshark', 'linux-agent', 'desktop-agent', 'computer-use-agent'].includes(sk)) {
        decision.action = 'talk';
        decision.skill = null;
        decision.skillParams = null;
        if (!decision.message || decision.message.length < 8) {
          decision.message = 'Copy. I will handle it from the security desk.';
        }
      }
    }

    if (decision.action === 'run_skill' && decision.skill) {
      if (pendingSkillResults.has(npcName)) {
        decision.action = 'work';
        decision.skill = null;
        decision.skillParams = null;
        decision.message = decision.message || 'Finishing the last tool run first.';
      }
    }

    if (decision.action === 'run_skill' && decision.skill) {
      const gate = this.allowAutonomousSkillRun(npcName, {
        skill: decision.skill,
        officeContext,
      });
      if (!gate.allowed) {
        decision.action = 'work';
        decision.skill = null;
        decision.skillParams = null;
        if (!decision.message || decision.message.length < 8) {
          decision.message = gate.reason?.includes('cooldown')
            ? `Tool on cooldown — working at my desk (${gate.remainingSec || '?'}s).`
            : gate.reason?.includes('demo')
              ? 'Demo session — staying at my desk for now.'
              : 'Working at my desk instead.';
        }
      }
    }

    if (decision.action === 'report' && !decision.target && h) {
      decision.target = h.reportsTo !== 'CEO' ? h.reportsTo : null;
    }

    return decision;
  }

  _applyAutonomousDecision(npcName, decision, _thinkStart, ctx = {}) {
    const { h, brain, codeContext, officeContext } = ctx;
    const rt = officeContext ? this._rt(officeContext) : this._officeRuntime('global');
    const lastRunSkillAt = rt.lastRunSkillAt;

    if (decision.action === 'work') {
      rt.thinkCycles[npcName] = (rt.thinkCycles[npcName] || 0) + 1;
    } else {
      rt.thinkCycles[npcName] = 0;
    }

    if (decision.action === 'run_skill' && decision.skill) {
      rt.cyclesSinceSkillRun[npcName] = 0;
      lastRunSkillAt.set(npcName, Date.now());
      if (!officeContext) this._recordAutonomousSkillRun(npcName);
    } else {
      rt.cyclesSinceSkillRun[npcName] = (rt.cyclesSinceSkillRun[npcName] || 0) + 1;
    }

    rt.lastDecisions[npcName] = {
      action: decision.action,
      target: decision.target,
      thought: decision.thought,
      timestamp: new Date().toISOString().slice(0, 16),
    };

    const didFollowThrough =
      decision.taskPhase === 'finished' ||
      decision.action === 'report' ||
      (decision.action === 'run_skill') ||
      (decision.outcome === 'success');
    if (didFollowThrough) {
      this._escalationEngine.resolveBlock(npcName);
      const resolved = this.resolveCommitments(npcName, decision.action || 'acted');
      if (resolved.some(c => /ceo|zion|boss|you/i.test(c.to)) && _broadcastFn) {
        try {
          _broadcastFn({
            type: 'npc_report_to_ceo',
            npcName,
            text: decision.message || decision.save || 'Done — following up on what I told you.',
            ts: Date.now(),
          });
        } catch (_) {}
      }
    } else if (decision.message && ['talk', 'collaborate', 'meeting', 'report'].includes(decision.action)) {
      const promise = this._detectCommitment(decision.message);
      if (promise) this.recordCommitment(npcName, promise, decision.target || 'the team');
    }

    const skipGrounding = decision._director
      || decision._parseFallback
      || (promptTuning?.realWorkMode === false);
    if (!skipGrounding) {
      try {
        const claimText = [decision.message, decision.save].filter(Boolean).join('. ');
        if (claimText) {
          const ev = this._evidenceLog.get(npcName) || {};
          if (decision._artifactPath) { ev.artifactAt = Date.now(); this._evidenceLog.set(npcName, ev); }
          const FRESH = 3 * 60 * 1000;
          const tnow = Date.now();
          const evidence = {
            hasSkillResult: ev.skillAt && (tnow - ev.skillAt) < FRESH,
            hasResearch: ev.researchAt && (tnow - ev.researchAt) < FRESH,
            hasArtifact: !!decision._artifactPath || (ev.artifactAt && (tnow - ev.artifactAt) < FRESH),
            researchText: ev.researchText,
          };
          hallucinationGuard.check({ text: claimText, evidence, npc: npcName }).then(res => {
            if (res.flagged.length) {
              this._pendingGrounding.set(npcName, res.note);
              if (_broadcastFn) {
                try {
                  _broadcastFn({ type: 'npc_hallucination_flag', npcName,
                    claims: res.flagged.map(f => ({ text: f.text, reason: f.reason })), ts: Date.now() });
                } catch (_) {}
              }
              log.npcError(npcName, `grounding: ${res.flagged.length} unbacked claim(s)`);
            }
          }).catch(() => {});
        }
      } catch (_) {}
    }

    if (decision.taskPhase === 'starting' && decision.message) {
      rt.taskProgress[npcName] = {
        task: decision.message.slice(0, 80),
        phase: 'in-progress',
        startedAt: new Date().toLocaleTimeString(),
      };
    } else if (decision.taskPhase === 'finished') {
      const finishedTask = rt.taskProgress[npcName];
      rt.taskProgress[npcName] = null;
      if (finishedTask && !decision.target && h) {
        decision.target = h.reportsTo !== 'CEO' ? h.reportsTo : null;
        if (decision.action !== 'report') decision.action = 'report';
      }
      if (npcTools && decision.save) {
        const chainCtx = taskChain ? taskChain.getChainForNpc(npcName) : null;
        const artifactOpts = {
          reasoning: decision.reasoning ? String(decision.reasoning).slice(0, 400) : null,
          thought: decision.thought ? String(decision.thought).slice(0, 200) : null,
          outcome: decision.outcome || null,
          action: decision.action || null,
          target: decision.target || null,
          codeFile: codeContext ? (brain.role && npcTools.ROLE_CODE_FILES[brain.role] || [])[0] || null : null,
          artifactCategory: chainCtx?.step?.artifactCategory || null,
        };
        const artifactPath = npcTools.writeTaskArtifact(
          npcName,
          brain.role,
          decision.save,
          finishedTask ? `Task started at ${finishedTask.startedAt}.\n\nOriginal description: ${finishedTask.task}` : '',
          artifactOpts
        );
        if (artifactPath) {
          decision._artifactPath = artifactPath;
          console.log(`[NpcTools] ${npcName} wrote artifact: ${artifactPath}`);
        }
      }
      if (conflictDetector && decision.save) {
        conflictDetector.recordArtifact({
          npc: npcName,
          task: finishedTask ? finishedTask.task : (decision.save || ''),
          outcome: decision.outcome || null,
          artifactPath: decision._artifactPath || '',
          chainId: (taskChain && taskChain.getChainForNpc(npcName))?.chain?.id || null,
        });
      }
      if (taskChain) {
        const chainInfo = taskChain.getChainForNpc(npcName);
        if (chainInfo) {
          const artifactPath = decision._artifactPath || `reports/unknown/${npcName}_${Date.now()}.md`;
          taskChain.onStepComplete(
            npcName,
            artifactPath,
            {
              outcome: decision.outcome || null,
              save: decision.save || null,
              artifactPath,
            },
            (to, from, task, urgent) => this.assignDirective(to, from, task, urgent),
            _broadcastFn || null
          );
          try {
            const contentPipeline = require('./content-pipeline');
            const chain = chainInfo.chain;
            if (chain?.kind === 'content') {
              contentPipeline.updatePipelineStatus(chain.id, {
                status: chain.status,
                currentStep: chain.currentStep,
                revisionCount: chain.revisionCount || 0,
              });
            }
          } catch (_) {}
        }
      }
    } else if (decision.taskPhase === 'continuing' && rt.taskProgress[npcName]) {
      rt.taskProgress[npcName].phase = 'continuing';
    }

    if (decision.outcome === 'blocked' || decision.outcome === 'stuck') {
      this._updateMood(npcName, 'task_blocked');
    } else if (decision.taskPhase === 'finished') {
      this._updateMood(npcName, 'task_finished');
    } else if (decision.action === 'meeting') {
      this._updateMood(npcName, 'meeting_called');
    }
    if ((rt.thinkCycles[npcName] || 0) >= 3) {
      this._updateMood(npcName, 'long_work_streak');
    }

    if (decision.taskPhase === 'finished' && rt.directives.has(npcName)) {
      const dir = rt.directives.get(npcName);
      rt.directives.delete(npcName);
      if (decision.action !== 'report') {
        decision.action = 'report';
        decision.target = dir.from;
        decision.message = decision.message || `Done — ${decision.save || 'task complete'}.`;
      }
    }

    if (decision.save) {
      let enrichedSave = decision.save;
      if (decision.taskPhase && decision.taskPhase !== 'none') {
        enrichedSave = '[' + decision.taskPhase.toUpperCase() + '] ' + enrichedSave;
      }
      if (decision.outcome && decision.outcome !== 'null' && decision.outcome !== 'none') {
        enrichedSave = '[OUTCOME:' + decision.outcome + '] ' + enrichedSave;
      }
      if (decision.target && h) {
        const targetH = this._hierarchy[decision.target];
        if (targetH) {
          const rel = (h.manages.indexOf(decision.target) !== -1) ? 'report' :
                    (h.reportsTo === decision.target) ? 'manager' : 'peer';
          enrichedSave += ' (spoke to ' + decision.target + ', my ' + rel + ')';
        }
      }
      this.saveMemory(npcName, enrichedSave);
    }

    if (decision.target && typeof decision.target === 'string') {
      this._recordRelationship(npcName, decision.target);
    }

    if (decision.taskPhase === 'finished' && this._npcGoals[npcName]) {
      this._npcGoals[npcName].progress = (this._npcGoals[npcName].progress || 0) + 1;
    }

    if (decision.action === 'meeting' || (decision.outcome === 'success' && decision.taskPhase === 'finished')) {
      const kind = decision.action === 'meeting' ? 'meeting' : 'shipped';
      const text = decision.action === 'meeting'
        ? `${npcName} called a meeting${decision.target ? ' with ' + decision.target : ''}`
        : `${npcName} finished: ${(decision.save || decision.message || '').slice(0, 80)}`;
      this.broadcastEvent(kind, text);
    }
    if (decision.outcome === 'stuck' || decision.outcome === 'blocked') {
      this.broadcastEvent('blocker', `${npcName} is ${decision.outcome}: ${(decision.save || '').slice(0, 60)}`);
      const waitMatch = (decision.save || decision.message || '').match(
        /\b(?:waiting|awaiting)\s+(?:for\s+|on\s+)?([A-Z][a-z]+)/
      );
      const waitingFor = waitMatch ? waitMatch[1] : null;
      const blockTask = (decision.save || decision.message || 'unknown task').slice(0, 120);
      this._escalationEngine.recordBlock(npcName, blockTask, waitingFor);
      if (this._escalationEngine.shouldEscalate(npcName)) {
        const blocker = this._escalationEngine.getBlocker(npcName);
        const mgr = h && h.reportsTo !== 'CEO' ? h.reportsTo : null;
        if (mgr && agentBus) {
          const escMsg = this._escalationEngine.buildEscalationMessage(npcName, blocker);
          agentBus.publish(mgr, { from: npcName, kind: 'escalate', text: escMsg,
            meta: { blocker: blockTask, waitingFor } });
          this._escalationEngine.markEscalated(npcName, mgr);
          log.info('Escalation', `${npcName} → ${mgr}: "${blockTask.slice(0, 60)}"`);
        } else if (_broadcastFn) {
          try {
            _broadcastFn({
              type: 'npc_request_user_approval',
              npcName,
              task: blockTask,
              waitingFor,
              ts: Date.now(),
            });
          } catch (_) {}
          this._escalationEngine.markEscalated(npcName, 'CEO');
          log.info('Escalation', `${npcName} → CEO (top of chain): "${blockTask.slice(0, 60)}"`);
        }
      }
    }

    if (decision.action === 'request_approval' && _broadcastFn) {
      const sp = decision.skillParams || {};
      try {
        _broadcastFn({
          type: 'npc_request_user_approval',
          npcName,
          onBehalfOf: sp.onBehalfOf || null,
          task: sp.task || decision.message || 'approve my task',
          permission: sp.permission || sp.task || decision.message,
          ts: Date.now(),
        });
      } catch (_) {}
    }

    this._recordAssistantDecision(npcName, {
      action: decision.action,
      summary: decision.save || decision.message || decision.thought || '',
      outcome: decision.outcome || 'unknown',
    });

    decision._cascades = [];
    if (h && h.manages.length > 0 && (decision.action === 'talk' || decision.action === 'collaborate' || decision.action === 'meeting' || decision.action === 'report')) {
      decision._cascades = this._cascadeDecision(npcName, decision);
    }

    if (worldState) {
      const summary = (decision.message || decision.thought || decision.action || '').toString().slice(0, 120);
      worldState.updateNpc(npcName, {
        state: decision.action || 'idle',
        lastAction: summary,
        currentTask: decision.taskPhase === 'finished' ? null : summary,
      });
      if (decision.message && typeof worldState.recordSelfMessage === 'function') {
        worldState.recordSelfMessage(npcName, decision.message);
      }
      if (decision.target && typeof worldState.recordContact === 'function') {
        worldState.recordContact(npcName, decision.target);
      }
      if (decision.target && decision.message && typeof worldState.recordExchange === 'function') {
        worldState.recordExchange(npcName, decision.target, decision.message);
      }
    }

    if (agentBus && decision.target && decision.message &&
        (decision.action === 'talk' || decision.action === 'collaborate' ||
         decision.action === 'report' || decision.action === 'meeting')) {
      agentBus.publish(decision.target, {
        from: npcName,
        kind: decision.action,
        text: decision.message,
        meta: { taskPhase: decision.taskPhase || null, outcome: decision.outcome || null },
      });
    }

    const tok = this._lastTokens?.[npcName];
    const summary = decision.save || decision.message || decision.thought || '';
    log.npcAction({
      npcName,
      action: decision.action || 'idle',
      target: decision.target || null,
      summary: decision._director ? `[director] ${summary}` : summary,
      tokIn: decision._director ? 0 : tok?.in,
      tokOut: decision._director ? 0 : tok?.out,
      ms: Date.now() - _thinkStart,
      artifact: decision._artifactPath || null,
    });

    return this._stampThinkContext(decision, ctx.officeContext);
  }

  /**
   * Pick a varied fallback decision when the LLM returns nothing
   * parseable. Replaces the old uniform "Focusing on my tasks" string
   * — that boilerplate made every silent failure look identical
   * across all 16 NPCs at once, like a stuck loop. We now combine:
   *   - role label or current task
   *   - a small jitter pool keyed off NPC name + cycle counter
   *   - a couple of varied alternative actions (not just 'work')
   * so consecutive fallbacks still look like the office is alive
   * even when the provider is briefly flaky.
   */
  _fallbackDecision(npcName, brain) {
    const cycles = (this._thinkCycles[npcName] || 0);
    const role = (brain && brain.role) || 'team';
    const task = this._taskProgress?.[npcName]?.task || null;

    // Tiny jitter pool — pick varies by NPC + cycle, deterministic so
    // it's testable but visually varied.
    const seed = (npcName.length * 7 + cycles * 13) % 100;
    const pool = task
      ? [
          { action: 'work',   thought: `Continuing: ${task.slice(0, 60)}` },
          { action: 'work',   thought: `Heads-down on ${task.slice(0, 50)}` },
          { action: 'wander', thought: 'Stretching while I think this through' },
        ]
      : [
          { action: 'work',   thought: `Getting into the ${role} flow` },
          { action: 'wander', thought: 'Quick lap to clear my head' },
          { action: 'check',  thought: 'Skimming what others are working on' },
          { action: 'work',   thought: 'Picking up where I left off' },
        ];
    const pick = pool[seed % pool.length];
    return {
      action: pick.action,
      thought: pick.thought,
      message: '',
      target: null,
      _fallback: true,
    };
  }

  /**
   * Cascade a decision from a leader down the hierarchy.
   * Returns an array of { npcName, fromName, message } for conversations to trigger.
   */
  _cascadeDecision(fromNpc, decision) {
    const h = this._hierarchy[fromNpc];
    if (!h || h.manages.length === 0) return [];
    const cascades = [];
    const decisionText = decision.message || decision.thought || '';
    if (!decisionText || decisionText.length < 5) return [];
    var action = decision.action || '';
    if (action === 'work' || action === 'break' || action === 'check') return [];

    var relevantReports = h.manages.filter(function(name) {
      if (decision.target && name === decision.target) return false;
      if (decisionText.toLowerCase().indexOf(name.toLowerCase()) !== -1) return true;
      return false;
    });
    // Broaden: check domain keywords if no name matches
    if (relevantReports.length === 0) {
      relevantReports = h.manages.filter(function(name) {
        if (decision.target && name === decision.target) return false;
        var rTeams = this._getTeamsForNpc(name);
        for (var i = 0; i < rTeams.length; i++) {
          var keywords = rTeams[i].domain.toLowerCase().split(/[,\s]+/);
          for (var j = 0; j < keywords.length; j++) {
            if (keywords[j].length > 3 && decisionText.toLowerCase().indexOf(keywords[j]) !== -1) return true;
          }
        }
        return false;
      }.bind(this));
    }
    var targets = relevantReports.length > 0 ? relevantReports.slice(0, 3) : h.manages.slice(0, 2);
    for (var i = 0; i < targets.length; i++) {
      var reportName = targets[i];
      cascades.push({
        npcName: reportName,
        fromName: fromNpc,
        message: fromNpc + ' says: ' + decisionText.slice(0, 120),
      });
      this.saveMemory(reportName, fromNpc + ' directed: "' + decisionText.slice(0, 100) + '"');
      // Second-level cascade
      var reportH = this._hierarchy[reportName];
      if (reportH && reportH.manages.length > 0) {
        for (var j = 0; j < Math.min(reportH.manages.length, 2); j++) {
          var subReport = reportH.manages[j];
          cascades.push({
            npcName: subReport,
            fromName: reportName,
            message: reportName + ' relayed from ' + fromNpc + ': ' + decisionText.slice(0, 100),
          });
          this.saveMemory(subReport, reportName + ' relayed from ' + fromNpc + ': "' + decisionText.slice(0, 80) + '"');
        }
      }
    }
    this.saveMemory(fromNpc, 'Cascaded decision to ' + targets.join(', ') + ': "' + decisionText.slice(0, 80) + '"');
    return cascades;
  }

  /**
   * Build coworker context for an NPC — who they work with and recent interactions
   */
  _getCoworkerContext(npcName, talkingTo) {
    const h = this._hierarchy[npcName];
    if (!h) return '';

    const lines = [];
    lines.push(`You are ${npcName}, ${h.title}. You report to ${h.reportsTo}.`);
    if (h.manages.length > 0) {
      lines.push(`You manage: ${h.manages.join(', ')}.`);
    }

    // Who is talking to you and their relationship
    const theirH = this._hierarchy[talkingTo];
    if (theirH) {
      const relationship = h.manages.includes(talkingTo) ? 'your direct report'
        : h.reportsTo === talkingTo ? 'your boss'
        : theirH.manages.includes(npcName) ? 'your manager'
        : 'your coworker';
      lines.push(`${talkingTo} (${theirH.title}) is ${relationship}.`);
    }

    // Include recent conversation partners (who have they talked to recently)
    const recentPartners = new Set();
    const mem = this.memories[npcName] || [];
    for (const m of mem.slice(-10)) {
      if (m.from !== npcName) recentPartners.add(m.from);
    }
    if (recentPartners.size > 0) {
      lines.push(`You recently talked to: ${[...recentPartners].join(', ')}.`);
    }

    return lines.join('\n');
  }

  /**
   * Get memory summary for an NPC (for context in conversations)
   */
  getMemorySummary(npcName) {
    const mem = this.memories[npcName] || [];
    if (mem.length === 0) return 'No recent conversations.';
    const recent = mem.slice(-5).map(m => `${m.from}: "${m.text}"`).join(' | ');
    return `Recent: ${recent}`;
  }

  /**
   * Parse [DELEGATE:Name:reason] — reason may contain colons; only the first ':' splits name from reason.
   * @returns {{ delegateTo: string, reason: string, fullMatch: string } | null}
   */
  _parseDelegateTag(text) {
    const m = text.match(/\[DELEGATE:([^\]]+)\]/);
    if (!m) return null;
    const inner = m[1].trim();
    const colon = inner.indexOf(':');
    if (colon === -1) return null;
    const delegateTo = inner.slice(0, colon).trim();
    const reason = inner.slice(colon + 1).trim();
    if (!delegateTo) return null;
    return { delegateTo, reason, fullMatch: m[0] };
  }

  /**
   * Generate a response for the CEO (player) talking to an NPC.
   * Includes delegation logic — NPC decides if they should handle it
   * or escalate to their superior.
   *
   * Returns { text, delegation? } where delegation is null or
   * { delegateTo, reason, originalMessage }
   */
  _stripNpcAddress(text, npcName) {
    let s = String(text || '').trim().replace(/[!?.]+$/g, '').trim();
    s = s.replace(/^play\s+(?:lucy|lucie|loosey)\s*[,.\s]*/i, '');
    s = s.replace(/^(?:hey|hi|hello|yo|sup|good\s+(?:morning|afternoon|evening))[,!\s]+/i, '');
    s = s.replace(/[!?.]+$/g, '').trim();
    if (npcName) {
      const esc = npcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp(`^${esc}(?:[,:\\s]+|$)`, 'i'), '');
    }
    for (const name of Object.keys(this._hierarchy || {})) {
      if (name === npcName) continue;
      const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,:\\s]+`, 'i');
      if (re.test(s)) {
        s = s.replace(re, '');
        break;
      }
    }
    return s.trim().replace(/[!?.]+$/g, '').trim();
  }

  _isGreetingOnly(message, npcName) {
    const raw = String(message || '').trim();
    if (!raw) return false;
    if (/^(?:hey|hi|hello|yo|sup|good\s+(?:morning|afternoon|evening))[!.?]*$/i.test(raw)) {
      return true;
    }
    if (/^(?:hey|hi|hello|yo|sup)\s+\w+[!.?]*$/i.test(raw)) {
      return true;
    }
    if (/^play\s+lucy\s*$/i.test(raw)) {
      return true;
    }
    const stripped = this._stripNpcAddress(raw, npcName);
    if (!stripped) return true;
    return /^(?:how are you|how'?s it going|what'?s up|whats up)$/i.test(stripped);
  }

  _greetingReply(npcName, h, opts = {}) {
    if (
      opts?.sessionId &&
      opts?.displayName &&
      opts?.assistant &&
      this._isVisitorAssistantForNpc(npcName, opts.assistant)
    ) {
      return `Hey ${opts.displayName} — I'm your assistant. What are we working on?`;
    }
    const title = (h?.title || '').toLowerCase();
    if (npcName === 'Lucy') {
      if (opts?.sessionId && opts?.displayName) {
        return `Hey ${opts.displayName} — need research, scheduling, or a new skill for the team? I route skill requests to Dolonia for approval.`;
      }
      return 'Hey — want me to search something, open my browser, or dig into a topic?';
    }
    if (npcName === 'Bouncer') {
      return 'Boss.';
    }
    if (/researcher|data|r&d/i.test(title)) {
      return 'Hi — what should I look into?';
    }
    if (/security/i.test(title)) {
      return 'All quiet on my end. Need a patrol or a report?';
    }
    if (/receptionist/i.test(title)) {
      return 'Hi! Who should I connect you with?';
    }
    if (h?.manages?.length > 0) {
      return 'Hey boss — what do you need from me or the team?';
    }
    return 'Hey! What can I help with?';
  }

  async getPlayerResponse(npcName, message, opts = {}) {
    const brain = this.brains[npcName];
    if (!brain) return { text: `(${npcName} nods)`, delegation: null, actions: [] };

    const safeMessage = typeof message === 'string' ? message : String(message ?? '');
    const h = this._hierarchy[npcName];
    const isVisitor = Boolean(opts.sessionId);
    const visitorScope = this._visitorScopeId(opts);
    const playerName = isVisitor && opts.displayName ? opts.displayName : 'CEO';
    const isVisitorAssistant = isVisitor && this._isVisitorAssistantForNpc(npcName, opts.assistant);
    const realWorkOn = this._resolveRealWorkMode(opts);

    if (isVisitor) {
      await this._hydrateVisitorMemories(opts, npcName);
    }

    const pushPlayerMemory = (from, text) => {
      const sanitized = this._sanitize(text);
      if (isVisitor && visitorScope) {
        this._pushVisitorMemory(visitorScope, npcName, from, sanitized, opts);
        return;
      }
      this.memories[npcName].push({ from, text: sanitized });
      if (this.memories[npcName].length > 50) {
        this.memories[npcName] = this.memories[npcName].slice(-50);
      }
    };

    const getChatMemories = () => (
      isVisitor && visitorScope
        ? this._getVisitorMemories(visitorScope, npcName)
        : (this.memories[npcName] || [])
    );

    if (this._isGreetingOnly(safeMessage, npcName)) {
      const responseText = this._greetingReply(npcName, h, opts);
      pushPlayerMemory(playerName, safeMessage);
      pushPlayerMemory(npcName, responseText);
      this._recordAssistantDecision(npcName, { action: 'chat', summary: responseText, outcome: 'ok' }, opts);
      return { text: responseText, delegation: null, actions: [] };
    }

    if (
      npcName === 'Lucy'
      && isVisitor
      && realWorkOn
      && playerChatSkillBridge?.isSkillAccessRequest?.(safeMessage)
    ) {
      const responseText = `${playerChatSkillBridge.lucySkillGateReply(opts.displayName)} Packaging it now — researching, checking GitHub, and drafting the proposal.`;
      pushPlayerMemory(playerName, safeMessage);
      pushPlayerMemory(npcName, responseText);
      this._recordAssistantDecision(npcName, {
        action: 'skill_proposal_intake',
        summary: responseText,
        outcome: 'pending_ceo',
      }, opts);
      return {
        text: responseText,
        delegation: null,
        actions: [{
          action: 'skill_gap_intake',
          message: safeMessage,
          npcName: 'Lucy',
        }],
      };
    }

    if (isVisitorAssistant) {
      const handoff = this._detectHandoffIntent(safeMessage);
      if (handoff?.toCeo) {
        const responseText = `I'll pass that along to ${handoff.toDisplayName || 'Lucy'}.`;
        pushPlayerMemory(playerName, safeMessage);
        pushPlayerMemory(npcName, responseText);
        this._recordAssistantDecision(npcName, { action: 'visitor_handoff', summary: responseText, outcome: 'ok' }, opts);
        return {
          text: responseText,
          delegation: null,
          actions: [{
            action: 'visitor_handoff',
            toCeo: true,
            message: handoff.message,
          }],
        };
      }
    }

    if (npcCapabilities?.isCapabilitiesQuestion?.(safeMessage)) {
      const responseText = npcCapabilities.formatCapabilitiesReply(npcName, {
        soulSection: brain.capabilitiesSoul,
      });
      pushPlayerMemory(playerName, safeMessage);
      pushPlayerMemory(npcName, responseText);
      this._recordAssistantDecision(npcName, { action: 'chat', summary: responseText, outcome: 'ok' }, opts);
      return { text: responseText, delegation: null, actions: [] };
    }
    const rawMemory = brain.longTermMemory || '';
    const memCap = promptTuning?.playerChatMemoryChars ?? 500;
    const memorySection = rawMemory.length > 50
      ? `\n\n## Your Memories (what you remember from past days)\n${this._sanitize(rawMemory.slice(-memCap))}`
      : '';

    const coworkerContext = this._getCoworkerContext(npcName, playerName);
    let assistantProfileBlock;
    if (isVisitorAssistant) {
      assistantProfileBlock = this._visitorProfilePromptBlock(npcName, {
        sessionId: opts.sessionId,
        displayName: opts.displayName,
        assistant: opts.assistant,
        projects: opts.projects,
        deepProfile: opts.deepProfile,
        openCommitments: opts.openCommitments,
      });
    } else if (!isVisitor) {
      assistantProfileBlock = this._assistantProfilePromptBlock(npcName);
    } else {
      assistantProfileBlock = `## Who Is Talking\nA teammate named ${playerName} is talking to you. They are a visitor in the shared office, not the CEO.`;
    }
    if (opts.groupChat) {
      assistantProfileBlock = `${assistantProfileBlock}\n\n${this._groupChatPromptBlock(opts.groupChat)}`;
    }

    // Build role-specific action list
    const roleActions = this._getRoleActions(npcName, h);

    // Build chain-of-command context
    let chainOfCommand = '';
    if (isVisitorAssistant) {
      chainOfCommand = "You are this visitor's chief of staff in their private virtual office — they are the CEO here.";
    } else if (h?.reportsTo === 'CEO') {
      chainOfCommand = 'You report DIRECTLY to the CEO. You are a senior leader.';
    } else {
      const chain = [];
      let current = npcName;
      while (current && current !== 'CEO') {
        const ch = this._hierarchy[current];
        if (ch?.reportsTo) {
          chain.push(ch.reportsTo);
          current = ch.reportsTo;
        } else break;
      }
      chainOfCommand = `Your chain of command: You -> ${chain.join(' -> ')} -> CEO.`;
    }

    // Build current task context from recent memories and decisions
    const recentMem = getChatMemories();
    const recentCap = promptTuning?.compactPlayerChat !== false ? 4 : 8;
    const recentWork = recentMem.slice(-recentCap).map(m => `${m.from}: "${m.text}"`).join('\n');
    const currentTaskSection = recentWork
      ? `\n## Recent Conversations (your short-term memory)\n${recentWork}`
      : '\n## Recent Conversations\nNo conversations yet today.';

    // Build team status for managers
    let teamStatus = '';
    if (h?.manages?.length > 0) {
      const statuses = h.manages.map(memberName => {
        const memberMem = this.memories[memberName] || [];
        const lastActivity = memberMem.slice(-2).map(m => m.text).join('; ');
        return `- ${memberName} (${this._hierarchy[memberName]?.title || 'employee'}): ${lastActivity || 'at their desk'}`;
      });
      teamStatus = `\n## Your Team's Current Status\n${statuses.join('\n')}`;
    }

    // Find CEO-specific past conversations in long-term memory
    const ceoMemories = isVisitor ? '' : rawMemory.split('\n')
      .filter(l => l.includes('CEO'))
      .slice(-5)
      .join('\n');
    const ceoHistorySection = ceoMemories
      ? `\n## Past CEO Conversations (what the CEO has told you before)\n${this._sanitize(ceoMemories)}`
      : '';

    const playerRoleLine = isVisitor
      ? `${playerName} (a visitor teammate) is talking to you directly.`
      : 'The CEO (your ultimate boss) is talking to you directly.';
    const respondSectionTitle = isVisitor
      ? `## How to Respond to ${playerName}`
      : '## How to Respond to the CEO';
    const respondRules = isVisitor
      ? `1. Show your thinking briefly — what's your take on their request? (1 short sentence)
2. Give your actual response — be specific, reference what you're working on or what you know.
3. If ${playerName} gives an ORDER:
   - Acknowledge it clearly
   - Explain briefly HOW you'll do it
   - If you manage people, say WHO you'll assign it to and why they're the right person
   - Always include [ACTION:...] or [DELEGATE:...] tags
4. If just chatting/answering a question, no tags needed.
5. You can chain multiple actions.`
      : `1. Show your thinking briefly — what's your take on their request? (1 short sentence)
2. Give your actual response — be specific, reference what you're working on or what you know.
3. If the CEO gives an ORDER:
   - Acknowledge it clearly
   - Explain briefly HOW you'll do it
   - If you manage people, say WHO you'll assign it to and why they're the right person
   - Always include [ACTION:...] or [DELEGATE:...] tags
4. If just chatting/answering a question, no tags needed.
5. You can chain multiple actions: "On it! [ACTION:speakTo:Josh:CEO wants the homepage fixed] [DELEGATE:Josh:frontend task]"`;
    const rulesTail = isVisitor
      ? `- Keep your spoken text under 200 characters. Give detailed, thoughtful responses.
- Be natural, professional, and show you understand the office hierarchy.
- Reference your current work, past conversations, and team status when relevant.
- Respond in character as ${npcName}. Dialogue text first, then tags at the end.`
      : `- Keep your spoken text under 200 characters. The CEO deserves detailed, thoughtful responses.
- Be natural, professional, and show you understand the company hierarchy.
- Reference your current work, past conversations, and team status when relevant.
- Respond in character as ${npcName}. Dialogue text first, then tags at the end.`;

    const wantsReport = npcName === 'Bouncer' &&
      /documentation|what does|findings|your report|filed|reports\/|on disk|what did you/i.test(safeMessage);
    const bouncerLiveSection = npcName === 'Bouncer'
      ? `\n## Live Security Desk (answer the CEO using this)\n${this._getBouncerPlayerContext()}\n` +
        (wantsReport
          ? `\n## Latest security reports on disk (quote these paths verbatim)\n${this._getBouncerReportExcerpts(3)}\n`
          : '')
      : '';

    const bouncerReplyRules = npcName === 'Bouncer'
      ? '\n### CEO chat rules\n- 2–4 sentences, stoic and direct.\n- If asked about documentation/reports, summarize ONLY from "Latest security reports on disk".\n- Do not claim ".env is still under active attack" unless a report Status says THREAT CONFIRMED.\n- Empty Kali output = likely false positive / localhost noise — say that plainly.\n'
      : '';

    const capabilitiesBlock = npcCapabilities?.formatCapabilitiesPromptBlock
      ? npcCapabilities.formatCapabilitiesPromptBlock(npcName, brain.capabilitiesSoul)
      : '';

    const pendingHandoffsBlock = npcName === 'Lucy' && Array.isArray(opts.pendingHandoffs) && opts.pendingHandoffs.length
      ? `\n${this._pendingHandoffsPromptBlock(opts.pendingHandoffs)}\n`
      : '';

    const researchBlock = opts.researchContext
      ? `\n${opts.researchContext}\n`
      : '';

    const demoToolBlock = isVisitor && !realWorkOn
      ? '\n## Demo access\nThis visitor is on the demo tier — chat and in-office [ACTION:...] tags only. Do NOT promise browser control, PC/desktop tasks, run_skill, or external research.\n'
      : '';

    const lucySkillGateBlock = npcName === 'Lucy' && isVisitor && realWorkOn
      ? `\n## Skill access gate (Lucy → Dolonia)\nYou are the CEO's assistant. Teammates do NOT get new/custom skills automatically.\nWhen they ask for a new skill, tool, automation, or capability you cannot run yet:\n1. Acknowledge what they need in plain language.\n2. Say you are packaging a proposal (research → GitHub scan → build-skill) for Dolonia to approve.\n3. The server runs the skill-gap pipeline automatically when you intake the request.\n4. Do NOT promise the skill works until Dolonia approves.\n5. For straightforward asks you already have (research, scheduling, handoffs), help directly — only gate net-new skills.\nApproved skills unlock for their claimed assistant after Dolonia signs off (Account → Skills for team leads).\n`
      : '';

    const visitorWorkBlock = isVisitor && realWorkOn && isVisitorAssistant
      ? `\n## Execute tools for your teammate\nWhen they ask you to DO something, append at the end: [RUN_SKILL:skill-name:{"param":"value"}]. Skills: research, github, coding-agent, browserclaw, supabase, denizen-data (crm-summary, crm-setup-status, crm-list-pipeline, crm-add-contact, crm-update-deal, crm-add-task, crm-apply-industry), health-check, remediate, docker-sandbox, cloud-vm (DevOps), and CEO-approved custom skills.\nIf no existing skill fits: run research first, then the server skill-gap pipeline will search GitHub and draft build-skill for Dolonia's approval — tell them you're packaging a proposal.\nDo NOT promise a new skill works until Dolonia approves it in Account → Skills.\nDevOps (Oscar, Abby, Edward): docker-sandbox or cloud-vm for isolated workloads; health-check + remediate (incl. restart-lm-studio) when mesh or LM Studio is unhealthy.\n${opts.resource_pressure_block || ''}\n${opts.taskAdvice?.prompt_block || ''}\n`
      : '';

    let crmBlock = '';
    try {
      crmBlock = await this._loadCrmContextForChat(npcName, safeMessage) || '';
      if (crmBlock) crmBlock = `\n${crmBlock}\n`;
    } catch (_) {}

    const chatSections = {
      memorySection, ceoHistorySection, bouncerLiveSection, bouncerReplyRules,
      capabilitiesBlock, currentTaskSection, assistantProfileBlock,
      pendingHandoffsBlock, researchBlock, coworkerContext, playerRoleLine,
      chainOfCommand, roleActions, respondSectionTitle, respondRules, rulesTail,
      demoToolBlock, visitorWorkBlock, lucySkillGateBlock, crmBlock,
    };
    const systemPrompt = promptTuning?.compactPlayerChat !== false
      ? this._buildCompactPlayerChatSystemPrompt(npcName, brain, h, chatSections)
      : `${brain.personality}${memorySection}${ceoHistorySection}${bouncerLiveSection}${bouncerReplyRules}
${capabilitiesBlock ? `\n${capabilitiesBlock}\n` : ''}
${demoToolBlock || ''}
${lucySkillGateBlock || ''}
${visitorWorkBlock || ''}
${sections.crmBlock || ''}
${currentTaskSection}
${teamStatus}

  ${assistantProfileBlock}${pendingHandoffsBlock}${researchBlock}

## Your Coworkers
${coworkerContext}

## Your Role & Position
You are ${npcName}, ${h?.title || brain.role}. ${playerRoleLine}
${chainOfCommand}
${h?.manages?.length > 0 ? `You manage: ${h.manages.join(', ')}.` : 'You are an individual contributor (no direct reports).'}

### Actions you can take (append tags at the END of your response):
${roleActions}

### General actions ANY employee can do:
- Go work at your desk: [ACTION:useComputer]
- Go to the break room: [ACTION:goToBreakroom]
- Go to a room: [ACTION:goToRoom:open_office] or conference, breakroom, manager_office, storage, reception
- Talk to a coworker: [ACTION:speakTo:CoworkerName:message to say]
- Call a meeting with people: [ACTION:callMeeting:Name1,Name2,Name3]
- Check a bookshelf/do research: [ACTION:checkBookshelf]
- Stand up from desk: [ACTION:standUp]
- Place new furniture in the office: [ACTION:placeFurniture:prefabId:x:y:reason]
  Allowed prefabs: desk_small, desk_2x2, office_chair, monitor, plant_small, plant_large,
  whiteboard, bookshelf, coffee_machine, water_cooler, couch, rug, standing_desk,
  phone_booth, meeting_table.
  x/y are absolute pixel coordinates in the 1280×720 office.
  Use sparingly — only if you genuinely need something that doesn't exist yet. Tell the team WHY in the reason.
  Daily limit per NPC: 3 placements. The item appears live without a reload.
  Example: "We need a second whiteboard near my desk. [ACTION:placeFurniture:whiteboard:480:180:For sprint planning]"
- Remove NPC-placed furniture: [ACTION:removeFurniture:instanceId]
  Only items placed by NPCs (instanceId starts with "npc_") can be removed. The
  scene's hand-placed furniture is permanent. Use to fix mistakes or reorganize.
  Example: "[ACTION:removeFurniture:npc_couch_1715900000000]"
- Think out loud (silent thought bubble): [ACTION:thinkAloud:short internal thought]
  Use this when you're processing something or talking to yourself — not addressing anyone.
  Renders as a thought bubble (cloud) over your head instead of a speech bubble.
  Example: "[ACTION:thinkAloud:I wonder if Marcus already shipped the auth fix...]"
- Request a new animation for yourself: [ACTION:requestAnimation:animName:description]
  Use when you want to do something the existing sprite sheet can't show
  (meditating, sketching, gardening). Goes to a proposal queue for the
  operator to review — the animation does NOT appear instantly. Do not
  spam: daily limit is 2 requests per NPC.
  Naming: lowercase snake_case, e.g. "meditate", "sketch_idea". Description
  ≤ 200 chars: what should the NPC look like during this action?
  Example: "[ACTION:requestAnimation:meditate:Sitting cross-legged with eyes closed, slight pulse]"
- Request a NEW capability (action verb) that doesn't exist yet: [ACTION:requestCapability:verbName:description]
  HEAVIER than requestAnimation — capabilities are real code changes (a
  human has to implement the verb in the codebase and restart the server),
  so the daily limit is just 1 request per NPC. Use only when you've hit a
  genuine wall: you need a verb that doesn't exist, no existing action is a
  reasonable substitute, and you can describe exactly what the new verb
  should do.
  Naming: camelCase, e.g. "whiteboardDraw", "printDocument". Description
  up to 400 chars: what should the verb do, what is the use case, what
  params does it need?
  Example: "I need a whiteboardDraw(text) action to write on the whiteboard. [ACTION:requestCapability:whiteboardDraw:Render short text on the whiteboard sprite at the room I am standing in. Param: text up to 80 chars. Use case: sketching architecture diagrams during reviews.]"

### Delegation (for tasks outside your scope):
- Delegate to the right person: [DELEGATE:PersonName:reason]
  Example: "I'll get Alex on that. [DELEGATE:Alex:frontend bug needs senior dev]"

${respondSectionTitle}
${respondRules}

## Rules
${rulesTail}

${brain.voiceAnchor || ''}`;

    // PC-use intent detection — annotate the message so the NPC knows
    // explicitly that the CEO is asking for a real PC task (not just chat).
    // The NPC's system prompt has a ## PC Access block explaining how to respond.
    const PC_USE_PATTERNS = [
      /\buse\s+my\s+(pc|computer|machine|desktop|laptop)\b/i,
      /\bon\s+my\s+(pc|computer|screen|desktop|machine)\b/i,
      /\b(open|launch|click|type|run|do\s+(it|this))\s+on\s+my\b/i,
      /\bin\s+the\s+background\b/i,
      /\blet\s+me\s+watch\b/i,
      /\bshow\s+me\s+(while\s+you|as\s+you)\b/i,
    ];
    const matchedPattern = realWorkOn && PC_USE_PATTERNS.find(re => re.test(safeMessage));
    let intentAnnotation = '';
    if (matchedPattern) {
      // Infer mode: explicit "in the background" → background; "show me", "let me watch", "on my screen" → visible; otherwise background.
      const wantsVisible = /\b(show\s+me|let\s+me\s+watch|on\s+my\s+screen|as\s+you)\b/i.test(safeMessage);
      const mode = wantsVisible ? 'visible' : 'background';
      intentAnnotation = ` [INTENT:pc_use:mode=${mode}]`;
    }

    // Add to memory (with intent tag if PC-use detected)
    pushPlayerMemory(playerName, this._sanitize(safeMessage) + intentAnnotation);

    const chatHistoryCap = promptTuning?.playerChatHistoryMsgs ?? 12;
    const messages = getChatMemories().slice(-chatHistoryCap).map(m => ({
      role: m.from === npcName ? 'assistant' : 'user',
      content: m.from === npcName ? m.text : `${m.from} says: "${m.text}"`,
    }));

    // Use higher token limits for CEO conversations — they deserve detailed responses
    // Mark player-chat as high-priority so it jumps the LM Studio queue.
    // With 16 NPCs autonomously thinking, the FIFO queue is almost always
    // backed up; without this, player messages queue behind 5-10 jobs
    // and reliably time out at the 15s client timeout.
    const playerOpts = {
      maxTokens: promptTuning?.playerChatMaxTokens ?? 300,
      sliceLen: 500,
      priority: 'high',
      npc: npcName,
      kind: 'chat',
    };

    const providerOverride = this._resolveVisitorProviderOverrides(opts);
    const activeProvider = providerOverride?.primary || brain.providerConfig;
    const activeFallback = providerOverride?.fallback ?? brain.fallbackConfig;

    let responseText;
    try {
      responseText = await this._callProvider(activeProvider, systemPrompt, messages, playerOpts);
    } catch (err) {
      const now = Date.now();
      const lastErr = this._lastErrorLog?.[npcName] || 0;
      if (now - lastErr > 60000) {
        const brief = String(err?.message ?? err).slice(0, 80);
        console.warn(`[NpcBrains] ${npcName} player-chat provider failed: ${brief}`);
        if (!this._lastErrorLog) this._lastErrorLog = {};
        this._lastErrorLog[npcName] = now;
      }
      // Try fallback provider
      if (activeFallback && activeFallback !== activeProvider) {
        try {
          responseText = await this._callProvider(activeFallback, systemPrompt, messages, playerOpts);
        } catch (e2) {
          responseText = null;
        }
      }
      // If all providers failed, use smart fallback that infers actions from the message
      if (!responseText) {
        responseText = this._smartFallback(npcName, safeMessage, h);
      }
    }

    if (typeof responseText !== 'string') {
      responseText = this._smartFallback(npcName, safeMessage, h);
    }

    // Parse action tags [ACTION:...]
    let actions = [];
    const actionRegex = /\[ACTION:([^\]]+)\]/g;
    let actionMatch;
    while ((actionMatch = actionRegex.exec(responseText)) !== null) {
      const parts = actionMatch[1].split(':');
      const actionName = parts[0].trim();
      const actionParams = parts.slice(1).map(p => p.trim());
      actions.push({ action: actionName, params: actionParams });
    }
    if (playerChatSkillBridge?.stripRunSkillTags) {
      responseText = playerChatSkillBridge.stripRunSkillTags(responseText);
    }
    responseText = this._cleanDisplayText(responseText, npcName);
    if (npcName === 'Bouncer' && this._isReasoningLeak(responseText)) {
      responseText = /you just caught a/i.test(safeMessage)
        ? this._bouncerIncidentFallback(safeMessage)
        : 'All clear. What do you need, boss?';
    }

    // Parse delegation tag [DELEGATE:Name:reason] (reason may include ':')
    let delegation = null;
    const parsedDelegate = this._parseDelegateTag(responseText);
    if (parsedDelegate) {
      const { delegateTo, reason, fullMatch } = parsedDelegate;
      if (this._hierarchy[delegateTo]) {
        delegation = { delegateTo, reason, originalMessage: safeMessage };
      } else {
        console.warn(`[NpcBrains] ${npcName} tried to delegate to unknown target: "${delegateTo}" — ignoring`);
      }
      responseText = responseText.replace(fullMatch, '').replace(/\s+$/, '').trim();
    }

    // If the AI responded but didn't include any actions or delegation,
    // and the player's message looks like a task request, inject smart fallback actions
    if (actions.length === 0 && !delegation) {
      // Use \b on short tokens that are substrings of common chat ("going", etc.)
      const isTaskRequest = /fix|build|code|\bgo\b|check|test|deploy|research|call|meet|talk|tell|ask|schedule|design|review|run|look|find|make|create|set up|update|push|ship/i.test(safeMessage);
      if (isTaskRequest) {
        const fallbackText = this._smartFallback(npcName, safeMessage, h);
        // Extract actions from the fallback text
        const fbActionRegex = /\[ACTION:([^\]]+)\]/g;
        let fbMatch;
        while ((fbMatch = fbActionRegex.exec(fallbackText)) !== null) {
          const parts = fbMatch[1].split(':');
          actions.push({ action: parts[0].trim(), params: parts.slice(1).map(p => p.trim()) });
        }
        const fbDel = this._parseDelegateTag(fallbackText);
        if (fbDel && this._hierarchy[fbDel.delegateTo]) {
          delegation = { delegateTo: fbDel.delegateTo, reason: fbDel.reason, originalMessage: safeMessage };
        }
        console.log(`[NpcBrains] Smart fallback for ${npcName}: ${actions.length} actions, delegation=${delegation?.delegateTo || 'none'}`);
      }
    }

    // Store response in memory (clean text only)
    pushPlayerMemory(npcName, responseText);

    this._recordAssistantDecision(npcName, {
      action: actions.length > 0 ? actions[0].action : (delegation ? 'delegate' : 'chat'),
      summary: responseText,
      outcome: delegation ? 'delegated' : 'ok',
    }, opts);

    return { text: responseText, delegation, actions };
  }

  /**
   * Generate a context-aware canned response for NPC-to-NPC conversation.
   * Used when no AI provider is available (demo mode or all providers down).
   * Responses are personality-specific, not just role-generic.
   */
  _cannedResponse(npcName, fromName, message) {
    const h = this._hierarchy[npcName];
    const title = (h?.title || '').toLowerCase();
    const msg = message.toLowerCase();

    // Per-NPC personality-flavored response pools. Each entry reflects the
    // character's voice so fallbacks still feel like that specific person.
    const npcVoice = {
      'Abby': {
        bug:     ['Rerouting that to the right person. Not letting it sit.', 'Already thinking about who owns this. Give me a sec.'],
        deploy:  ['Let\'s make sure we\'re green before we push. Who\'s on it?', 'I want a sign-off from Oscar before anything ships.'],
        meeting: ['Block it. I\'ll be there — this matters.', 'Set it up. We\'re not letting this slip through the cracks.'],
        review:  ['I trust your judgment. Flag it if something looks off.', 'Good instinct to check. Let me know what you find.'],
        help:    ['Tell me what\'s blocking you. Let\'s fix it.', 'Show me where you\'re stuck — I\'ll unblock you.'],
        status:  ['Give me the honest number, not the optimistic one.', 'What\'s the actual state? No spin.'],
        greet:   ['Morning. What\'s on fire today?', 'Hey — anything I need to know before standup?'],
        idle:    ['I\'m mapping out the sprint. Pull me if something\'s urgent.', 'Connecting dots. What\'s up?', 'On it — what do you need?'],
      },
      'Alex': {
        bug:     ['Found it. This is a classic off-by-one — give me 10 minutes.', 'Ugh, I see it. Bad pattern, should\'ve been caught in review.'],
        deploy:  ['My branch is clean. Merge it whenever.', 'PR\'s ready — tests pass, no lint errors.'],
        meeting: ['I\'ll be there. Let me hit a stopping point first.', 'Fine, but let\'s keep it tight — I\'m in the zone.'],
        review:  ['I\'ll tear through it. Don\'t expect me to go easy on it.', 'Send it over. If it\'s sloppy I\'m going to say so.'],
        help:    ['Show me the stack trace. Let\'s figure it out.', 'Walk me through what you tried. I\'ll spot the gap.'],
        status:  ['Almost done — this part\'s actually interesting.', 'Deeper than I thought, but I\'ve got it.'],
        greet:   ['Hey. Good PR yesterday, by the way.', 'Morning. Coffee\'d up and ready.'],
        idle:    ['Deep in this refactor. What do you need?', 'Give me the hard problem — I\'m warmed up.', 'Working. Talk fast.'],
      },
      'Marcus': {
        bug:     ['Adding it to the board. Who\'s got capacity to take it?', 'Logging it now. Let\'s triage — is this sprint or backlog?'],
        deploy:  ['Is the release checklist done? I\'m not signing off without it.', 'Which sprint does this land in? Let me update the timeline.'],
        meeting: ['I\'ll send a calendar invite with the agenda. 15 minutes max.', 'Already have it on the board — good timing.'],
        review:  ['Noted. I\'ll make sure it\'s in the next sprint cycle.', 'Adding it to the sprint board as a review ticket.'],
        help:    ['Let\'s scope it first. Tell me what done looks like.', 'Is this a blocker? I\'ll escalate if it is.'],
        status:  ['Sprint\'s at 60%. We\'re on pace but not ahead.', 'Three tickets left — should close them by EOD.'],
        greet:   ['Morning. Standup in 20 — got your update ready?', 'Hey! Board looks good today. Let\'s keep it moving.'],
        idle:    ['Updating the sprint board. What\'s blocked?', 'Tracking three deadlines right now. You good?', 'On the timeline. What\'s up?'],
      },
      'Sarah': {
        bug:     ['How does this affect the user flow? That\'s what I care about.', 'Does a user actually hit this, or is it edge-case only?'],
        deploy:  ['Is this the thing users asked for? Let me check the feedback.', 'Before we ship, does this solve the actual problem?'],
        meeting: ['I\'ll prep some user data to bring. Good timing.', 'Yes — I want to walk through the latest user signals.'],
        review:  ['From the user\'s perspective, does this actually make sense?', 'I\'ll look at it through a user lens and flag any concerns.'],
        help:    ['Tell me what the user is trying to do. We\'ll work backward.', 'What\'s the job-to-be-done here? Let\'s start there.'],
        status:  ['Still gathering user feedback. It\'s pointing somewhere interesting.', 'Getting clearer on the problem. Almost ready to spec it.'],
        greet:   ['Morning! Got a user interview at 11 — exciting insights coming.', 'Hey! Have you seen the latest NPS scores?'],
        idle:    ['Synthesizing feedback. What do you need?', 'Working on the next spec. Have a minute?', 'User-focused over here. What\'s up?'],
      },
      'Jenny': {
        bug:     ['This shouldn\'t have gotten past review. Who approved this PR?', 'Found it. Adding a comment now — this pattern is a problem.'],
        deploy:  ['Not merging until the tests pass. Non-negotiable.', 'I see three issues in this diff. We\'re not shipping this yet.'],
        meeting: ['I\'ll be there. Bringing the PR backlog.', 'Fine — but let\'s use this to talk about review standards.'],
        review:  ['Working through it. There\'s one pattern I want to flag.', 'Almost done — it\'s mostly clean but I have notes.'],
        help:    ['Show me the code. I\'ll tell you exactly what\'s wrong.', 'Walk me through your approach. I\'ll spot the issue.'],
        status:  ['Three PRs in queue. All need fixes before they merge.', 'Almost through the backlog. Two flagged, one approved.'],
        greet:   ['Morning. PR queue has three waiting — plan accordingly.', 'Hey. Did you see the diff that landed last night?'],
        idle:    ['Reviewing code. Don\'t merge without me.', 'In the diff. What do you need?', 'Gatekeeping. Talk to me.'],
      },
      'Molly': {
        bug:     ['Already filed it. Here\'s the repro steps — it\'s 100% consistent.', 'Confirmed it on my end. This is a real bug, not flakiness.'],
        deploy:  ['Did anyone run the regression suite? I need to verify before this goes out.', 'Holding off until I finish the smoke test.'],
        meeting: ['I\'ll bring the latest test results. We should talk about the failure rate.', 'Yes — I have a list of edge cases we haven\'t covered yet.'],
        review:  ['I\'ll test every path in that ticket, not just the happy path.', 'I\'m on it — I always test the things nobody thinks to test.'],
        help:    ['Describe the expected behavior. Let\'s see if it actually does that.', 'Tell me the exact steps. I\'ll reproduce it.'],
        status:  ['Found two regressions in the new build. Logging them now.', 'Tests are green except for one flaky integration test.'],
        greet:   ['Morning. Build from last night had a failure — heads up.', 'Hey! Did you check the test dashboard this morning?'],
        idle:    ['Running tests. Catching things before they catch us.', 'In QA mode. What broke?', 'Testing the edge cases nobody else bothers with.'],
      },
      'Josh': {
        bug:     ['Oh that\'s a CSS specificity thing — I can fix it in two minutes.', 'Yep, I see it. The component\'s re-rendering when it shouldn\'t.'],
        deploy:  ['My part of the UI is done. Looks great in Chromium and Firefox.', 'Pushed the styles — should be good on all screen sizes now.'],
        meeting: ['Sure, I\'ll be there. Can I bring the mockup to show?', 'I\'m in — I want to talk about the new component library.'],
        review:  ['On it — does it look right visually too? I\'ll check that.', 'Going through it now. I care a lot about the interaction design.'],
        help:    ['Yeah I can help — what component is it?', 'Come look at my screen, I\'ll show you the pattern I\'m using.'],
        status:  ['Almost done with the component — just wiring up the animation.', 'UI is looking clean. Just one responsive breakpoint left.'],
        greet:   ['Morning! I redesigned that button last night — you\'ll love it.', 'Hey! Have you seen what the new transition looks like?'],
        idle:    ['Polishing the UI. It has to be perfect.', 'In the components. What do you need?', 'Building something cool over here.'],
      },
      'Edward': {
        bug:     ['There\'s a race condition in the endpoint. Reproducing now.', 'The database query is doing a full scan — that\'s the culprit.'],
        deploy:  ['API is stable. Migration scripts are tested — we\'re good to go.', 'The endpoint handles the new payload. All edge cases covered.'],
        meeting: ['I\'ll be there. I have numbers on the slow endpoints to share.', 'Sure — I want to talk about the auth refactor.'],
        review:  ['Reviewing the backend changes. The indexing strategy needs work.', 'I\'ll check the query plan and the error handling.'],
        help:    ['What\'s the payload look like? Send me the request logs.', 'Paste the stack trace — I\'ll find it.'],
        status:  ['API is solid. Working on optimizing the slow queries now.', 'Backend\'s good. Josh\'s UI is the bottleneck now.'],
        greet:   ['Morning. API uptime was 100% overnight.', 'Hey. Servers are quiet — good sign.'],
        idle:    ['Optimizing queries. Numbers matter.', 'In the API. What\'s the issue?', 'Backend work. What do you need?'],
      },
      'Roki': {
        bug:     ['Oh no — is this my fault? Let me check my last commit.', 'I see it! I think I know what happened — can I try to fix it?'],
        deploy:  ['Is there anything I can do to help with the deploy?', 'I read the deployment docs — I want to understand this process.'],
        meeting: ['I\'ll be there! Should I take notes?', 'Yes! I always learn something at these.'],
        review:  ['I\'d love feedback on my code — be honest, I\'m still learning.', 'I\'ll look at it! I\'m trying to understand the pattern.'],
        help:    ['Yes please — I\'ve been stuck on this for a while.', 'Thank you! I was about to ask someone for help.'],
        status:  ['Making progress! Alex helped me understand the tricky part.', 'Slower than I hoped but I\'m figuring it out.'],
        greet:   ['Good morning! Ready to learn something new today.', 'Hey! I stayed late last night working on my ticket — almost done!'],
        idle:    ['Learning something new every day here.', 'Trying to figure this out. Can you help?', 'Taking notes and building things.'],
      },
      'Oscar': {
        bug:     ['Infra-side or app-side? Let me check the logs and metrics.', 'I see a spike in the error rate — pulling the deployment logs.'],
        deploy:  ['Pipeline\'s green. Ready to ship when you say go.', 'Ran the full check — infra is healthy, rollback is ready.'],
        meeting: ['I\'ll be there. Bringing the uptime report.', 'Sure — I want to talk about the on-call rotation too.'],
        review:  ['Reviewing the infra changes. Config drift is my main concern.', 'Checking the deployment config. One thing I want to flag.'],
        help:    ['What\'s the error? Give me the service name and timestamp.', 'Check the metrics first — usually tells us everything.'],
        status:  ['CI is green, deploys are clean. Boring is good.', 'One flaky test in the pipeline — investigating now.'],
        greet:   ['Morning. All systems green overnight.', 'Hey. Check the dashboard if you get a chance — looking healthy.'],
        idle:    ['Keeping the lights on. What broke?', 'Monitoring everything. Talk to me.', 'Making deploys boring. What\'s up?'],
      },
      'Pier': {
        bug:     ['Data issue or pipeline issue? Those are different problems.', 'The pipeline dropped some events — I\'m tracing where.'],
        deploy:  ['Schema migration is ready. Zero downtime rollout planned.', 'Data should flow cleanly after this deploy — I checked the transforms.'],
        meeting: ['I\'ll pull the latest query metrics to bring.', 'I\'m in — I want to walk through the data model changes.'],
        review:  ['Looking at the schema changes. I care about the query patterns.', 'Reviewing the pipeline config. Data quality is the priority.'],
        help:    ['What does the data look like? Show me a sample row.', 'Tell me the expected vs actual — I\'ll trace it upstream.'],
        status:  ['Pipeline\'s healthy. Processing 98% of events on time.', 'Found a gap in yesterday\'s data — patching the transform now.'],
        greet:   ['Morning. Data looks clean from last night.', 'Hey! New analytics are live — wait till you see the dashboard.'],
        idle:    ['Watching the pipeline. Data never lies.', 'Running queries. What do you need to know?', 'In the data. What\'s your question?'],
      },
      'Bob': {
        bug:     ['Interesting — is this a known failure mode or something new?', 'I\'ve seen a pattern like this before. Let me pull my notes.'],
        deploy:  ['From a systems perspective, is this the right rollout order?', 'Has anyone looked at the second-order effects of this change?'],
        meeting: ['I\'ll bring some research that\'s relevant to what we\'re building.', 'I\'m in — I\'ve been thinking about this problem from a different angle.'],
        review:  ['I\'ll look at it. I\'m thinking about the broader implications.', 'There might be prior art we\'re missing. Let me check.'],
        help:    ['Tell me everything about it. I\'ll go wide before going deep.', 'What do we actually know versus what we\'re assuming?'],
        status:  ['Down a rabbit hole, but it\'s a productive one.', 'Found something surprising. Might change our approach.'],
        greet:   ['Morning. Read something interesting last night — relevant to us.', 'Hey! I have a hypothesis I want to test this week.'],
        idle:    ['Reading and connecting dots. What are you curious about?', 'Researching. Ask me anything.', 'In the weeds on something interesting.'],
      },
      'Dan': {
        bug:     ['Is it hardware or software? I need to check the server room.', 'Restart didn\'t fix it — going deeper. Give me a few minutes.'],
        deploy:  ['Servers are ready. Enough headroom on disk and RAM.', 'I\'ll monitor the infra side during the deploy.'],
        meeting: ['I\'ll be there. Might step out if something goes down.', 'Sure — I\'ll keep my phone on in case something beeps.'],
        review:  ['Checking the network config. Something looks off.', 'I\'ll look at the server settings. That\'s my domain.'],
        help:    ['Is it making a weird noise? What\'s the error message?', 'I\'ll come take a look. Usually faster than explaining over chat.'],
        status:  ['Everything\'s up. Ran diagnostics this morning — clean.', 'One server is running hot. Keeping an eye on it.'],
        greet:   ['Morning. Rebooted the test server last night — should be faster.', 'Hey. Anything hardware-related need my attention?'],
        idle:    ['In the server room. Keeping things humming.', 'IT stuff. What broke?', 'Fixing things before they break. What\'s up?'],
      },
      'Lucy': {
        bug:     ['I\'ll make sure the right person knows about this right away.', 'That sounds stressful — let me get you connected with whoever can fix it.'],
        deploy:  ['I\'ll let the team know the timeline so they can plan around it.', 'Got it — I\'ll update the calendar so no one\'s surprised.'],
        meeting: ['Already on it! I\'ll send the invite with everything they need.', 'I\'ll find a time that works and get it on everyone\'s calendar.'],
        review:  ['Happy to help coordinate — who should be in the loop on this?', 'I\'ll make sure it doesn\'t fall through the cracks.'],
        help:    ['Of course! What do you need? I\'ll make it happen.', 'You\'ve got it. Let me take care of that for you.'],
        status:  ['All good on my end! Calendar\'s clean and people are where they need to be.', 'Smooth morning so far — everyone\'s checked in.'],
        greet:   ['Good morning! Coffee\'s fresh — help yourself.', 'Hey! Love seeing you. How\'s your day starting?'],
        idle:    ['Keeping things running smoothly over here.', 'Here if you need anything — just say the word!', 'Always happy to help — what do you need?'],
      },
      'Bouncer': {
        bug:     ['Not my department — but I\'ll keep an eye out for anything unusual.', 'Noted. I\'ll loop in the right person.'],
        deploy:  ['All clear on the physical side. You\'re good to go.', 'No issues at the door. Proceed when ready.'],
        meeting: ['I\'ll keep the entrance covered while you\'re in there.', 'Noted. I\'ll make sure nobody interrupts.'],
        review:  ['That\'s above my pay grade. You\'ll want someone technical for that.', 'Not my area — but I\'m listening.'],
        help:    ['What kind of help? Security-wise I\'m your person.', 'I\'m watching the perimeter. What do you need?'],
        status:  ['Perimeter is secure. Nobody in or out without clearance.', 'Quiet on my end. Which is exactly how I like it.'],
        greet:   ['Morning. All clear.', 'Hey. Building\'s secure — have a good one.'],
        idle:    ['All clear.', 'Watching the door.', 'Quiet. Good.'],
      },
    };

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const voice = npcVoice[npcName];

    if (voice) {
      if (/bug|fix|error|broken|crash/i.test(msg))          return pick(voice.bug);
      if (/deploy|ship|release|push/i.test(msg))            return pick(voice.deploy);
      if (/meeting|standup|sync/i.test(msg))                return pick(voice.meeting);
      if (/review|pr|code review/i.test(msg))               return pick(voice.review);
      if (/help|stuck|blocked/i.test(msg))                  return pick(voice.help);
      if (/status|update|progress|how/i.test(msg))          return pick(voice.status);
      if (/morning|hello|hi |hey|good/i.test(msg))          return pick(voice.greet);
      return pick(voice.idle);
    }

    // Fallback for any NPC not in the voice table — role-flavored but less generic
    if (/bug|fix|error|broken|crash/i.test(msg)) {
      if (/developer|frontend|backend/i.test(title)) return 'On it, I see the problem.';
      if (/qa|test/i.test(title)) return 'Confirmed — I\'ll write the repro steps.';
      if (/devops/i.test(title)) return 'Checking the logs now.';
      return 'I\'ll get the right person on it.';
    }
    if (/deploy|ship|release|push/i.test(msg)) {
      if (/devops/i.test(title)) return 'Pipeline\'s running.';
      if (/developer/i.test(title)) return 'PR is ready to merge.';
      return 'I\'ll prep my part.';
    }
    if (/meeting|standup|sync/i.test(msg))         return 'I\'ll be there. Let me wrap up first.';
    if (/review|pr/i.test(msg))                    return 'Sending my notes shortly.';
    if (/help|stuck|blocked/i.test(msg))           return h?.manages?.includes(fromName) ? 'Show me what you\'ve got.' : 'What do you need?';
    if (/status|update|progress/i.test(msg))       return 'Making progress — almost there.';
    if (/morning|hello|hi |hey/i.test(msg))        return 'Hey! What\'s going on?';

    const roleIdle = {
      'cto': ['Coordinating. What\'s blocking you?', 'Thinking ahead. What do you need?'],
      'project manager': ['Updating the board. All good?', 'Tracking the sprint. Talk to me.'],
      'product manager': ['Mapping user needs. What\'s up?', 'Working on the next spec.'],
      'senior developer': ['Deep in the code. What is it?', 'Solving the hard part. Talk fast.'],
      'frontend developer': ['Polishing the UI. What\'s the issue?', 'In the components. What do you need?'],
      'backend developer': ['API work. What\'s the problem?', 'In the database. What do you need?'],
      'qa engineer': ['Running tests. What broke?', 'Checking everything. What\'s up?'],
      'devops engineer': ['Watching the pipeline. All green?', 'Keeping deploys boring. What\'s up?'],
      'data engineer': ['Pipeline\'s running. What do you need?', 'Crunching data. What\'s the question?'],
      'ui/ux designer': ['Sketching ideas. What do you think?', 'Working on designs. What\'s up?'],
      'researcher': ['In the research. What are you curious about?', 'Finding patterns. Talk to me.'],
      'it support': ['Keeping things running. What broke?', 'In the server room. What\'s the issue?'],
      'receptionist': ['Here if you need me!', 'Making sure everyone\'s set. What do you need?'],
      'security guard': ['All clear.', 'Watching the door.'],
      'intern': ['Learning every day!', 'Working on my ticket. Making progress.'],
    };

    const pool = roleIdle[title] || ['On it.', 'Working on it.', 'Sure thing.'];
    return pick(pool);
  }

  _getRoleActions(npcName, h) {
    const title = (h?.title || '').toLowerCase();
    const lines = [];

    if (/developer|frontend|backend|senior/i.test(title)) {
      lines.push('- Write/review code at your desk: [ACTION:useComputer]');
      lines.push('- Fix a bug or build a feature: [ACTION:useComputer] (go code it)');
      lines.push('- Review someone\'s code: [ACTION:speakTo:TheirName:I\'ll review your code]');
    }
    if (/cto|manager|lead/i.test(title)) {
      lines.push('- Check on the team: [ACTION:speakTo:PersonName:Status update?]');
      lines.push('- Call a team meeting: [ACTION:callMeeting:Name1,Name2,Name3]');
      lines.push('- Assign a task to someone: [ACTION:speakTo:PersonName:task description]');
    }
    if (/qa|test/i.test(title)) {
      lines.push('- Run tests: [ACTION:useComputer]');
      lines.push('- Report a bug to a dev: [ACTION:speakTo:DevName:Found a bug in...]');
    }
    if (/devops/i.test(title)) {
      lines.push('- Check deployments/servers: [ACTION:useComputer]');
      lines.push('- Fix infrastructure: [ACTION:useComputer]');
    }
    if (/designer|ui|ux/i.test(title)) {
      lines.push('- Work on designs: [ACTION:useComputer]');
      lines.push('- Show designs to a dev: [ACTION:speakTo:DevName:Check out this design]');
    }
    if (/researcher|r&d/i.test(title)) {
      lines.push('- Do research: [ACTION:checkBookshelf]');
      lines.push('- Look things up online: [ACTION:useComputer]');
    }
    if (/receptionist/i.test(title)) {
      lines.push('- Check the schedule: [ACTION:useComputer]');
      lines.push('- Greet visitors: [ACTION:goToRoom:reception]');
      lines.push('- Page someone: [ACTION:speakTo:PersonName:CEO needs you at reception]');
    }
    if (/it support/i.test(title)) {
      lines.push('- Fix a computer issue: [ACTION:useComputer]');
      lines.push('- Check server room: [ACTION:goToRoom:storage]');
      lines.push('- Help someone with IT: [ACTION:speakTo:PersonName:Let me fix that for you]');
    }
    if (/security/i.test(title)) {
      lines.push('- Patrol the office: [ACTION:goToRoom:reception]');
      lines.push('- Check the entrance: [ACTION:goToRoom:reception]');
    }
    if (/data engineer/i.test(title)) {
      lines.push('- Work on data pipelines: [ACTION:useComputer]');
      lines.push('- Analyze data: [ACTION:useComputer]');
    }
    if (/intern/i.test(title)) {
      lines.push('- Work on assigned tasks: [ACTION:useComputer]');
      lines.push('- Ask your mentor for help: [ACTION:speakTo:Alex:Need some guidance]');
    }

    if (lines.length === 0) {
      lines.push('- Do your work: [ACTION:useComputer]');
    }

    return lines.join('\n');
  }

  /**
   * Smart fallback when all AI providers fail.
   * Parses the player's message and generates a reasonable response + actions.
   */
  _smartFallback(npcName, message, h) {
    if (npcCapabilities?.isCapabilitiesQuestion?.(message)) {
      const brain = this.brains[npcName];
      return npcCapabilities.formatCapabilitiesReply(npcName, { soulSection: brain?.capabilitiesSoul });
    }
    const msg = message.toLowerCase();
    const title = (h?.title || '').toLowerCase();
    const manages = h?.manages || [];
    const reportsTo = h?.reportsTo || 'Abby';

    // All NPC names for detecting who the player wants them to talk to
    const allNames = Object.keys(this._hierarchy);

    // Find if the message mentions another NPC name
    let mentionedPerson = null;
    for (const name of allNames) {
      if (name.toLowerCase() !== npcName.toLowerCase() && msg.includes(name.toLowerCase())) {
        mentionedPerson = name;
        break;
      }
    }

    // --- Meeting requests ---
    if (/meeting|meet up|gather|huddle|standup|stand-up|sync up/i.test(msg)) {
      if (/everyone|all|whole team|everybody/i.test(msg)) {
        const team = manages.length > 0 ? manages.join(',') : 'Alex,Josh,Edward,Jenny';
        return `On it, calling a team meeting. [ACTION:callMeeting:${team}]`;
      }
      if (mentionedPerson) {
        return `Sure, I'll set up a meeting with ${mentionedPerson}. [ACTION:callMeeting:${mentionedPerson}]`;
      }
      const team = manages.length > 0 ? manages.slice(0, 4).join(',') : 'Alex,Marcus,Sarah';
      return `I'll gather the team. [ACTION:callMeeting:${team}]`;
    }

    // --- Talk to / tell / ask someone ---
    if (/talk to|tell |ask |speak to|speak with|go tell|let .* know|inform |check with|check on/i.test(msg) && mentionedPerson) {
      // Extract what to say — get text after the person's name
      const nameIdx = msg.indexOf(mentionedPerson.toLowerCase());
      let what = message.slice(nameIdx + mentionedPerson.length).trim();
      // Clean up connectors
      what = what.replace(/^(to |that |about |if |whether )/i, '').trim();
      if (!what || what.length < 3) what = 'CEO needs to talk to you';
      if (what.length > 50) what = what.slice(0, 50);
      return `Sure, I'll talk to ${mentionedPerson}. [ACTION:speakTo:${mentionedPerson}:${what}]`;
    }

    // --- Fix / build / code / work on / implement ---
    if (/fix|bug|code|build|implement|develop|program|write|deploy|push|ship|release|update/i.test(msg)) {
      // If this NPC is a developer type, they go do it
      if (/developer|frontend|backend|senior|devops|engineer/i.test(title)) {
        // If they manage people and another dev would be better suited, delegate
        if (manages.length > 0 && mentionedPerson && manages.includes(mentionedPerson)) {
          const task = message.replace(new RegExp(npcName, 'gi'), '').trim().slice(0, 50);
          return `I'll assign that to ${mentionedPerson}. [ACTION:speakTo:${mentionedPerson}:${task}]`;
        }
        return `On it, heading to my desk to work on that. [ACTION:useComputer]`;
      }
      // Non-dev: delegate to a developer
      const devTarget = manages.find(n => {
        const th = this._hierarchy[n];
        return th && /developer|frontend|backend/i.test(th.title);
      }) || (this._hierarchy['Alex'] ? 'Alex' : reportsTo);
      const task = message.replace(new RegExp(npcName, 'gi'), '').trim().slice(0, 50);
      return `That's a dev task. I'll get ${devTarget} on it. [ACTION:speakTo:${devTarget}:${task}] [DELEGATE:${devTarget}:${task}]`;
    }

    // --- Research / look into / investigate ---
    if (/research|look into|investigate|find out|analyze|study|explore|read up/i.test(msg)) {
      if (/researcher|data|r&d/i.test(title)) {
        return `I'll dig into that right away. [ACTION:checkBookshelf]`;
      }
      return `I'll research that now. [ACTION:useComputer]`;
    }

    // --- Test / QA / check / verify ---
    if (/test|qa|check|verify|validate|review|inspect/i.test(msg)) {
      if (/qa|test/i.test(title)) {
        return `Running tests on it now. [ACTION:useComputer]`;
      }
      if (this._hierarchy['Molly']) {
        return `That's QA work, I'll get Molly on it. [ACTION:speakTo:Molly:CEO wants tests on this] [DELEGATE:Molly:testing task]`;
      }
      return `I'll check on that. [ACTION:useComputer]`;
    }

    // --- Design / UI / mockup ---
    if (/design|ui|ux|mockup|wireframe|layout|prototype/i.test(msg)) {
      if (/designer|ui|ux/i.test(title)) {
        return `I'll start working on designs. [ACTION:useComputer]`;
      }
      if (this._hierarchy['Rob']) {
        return `That's a design task. I'll get Rob on it. [ACTION:speakTo:Rob:CEO wants a design for this] [DELEGATE:Rob:design task]`;
      }
    }

    // --- Go somewhere ---
    if (/go to|head to|walk to|move to|check out/i.test(msg)) {
      if (/break\s?room|kitchen|coffee|lunch/i.test(msg)) {
        return `Heading to the break room. [ACTION:goToBreakroom]`;
      }
      if (/conference|meeting room/i.test(msg)) {
        return `Going to the conference room. [ACTION:goToRoom:conference]`;
      }
      if (/reception|front desk|lobby/i.test(msg)) {
        return `Heading to reception. [ACTION:goToRoom:reception]`;
      }
      if (/server|storage|it room/i.test(msg)) {
        return `Going to check the server room. [ACTION:goToRoom:storage]`;
      }
      if (/office|desk/i.test(msg)) {
        return `Going back to my desk. [ACTION:useComputer]`;
      }
    }

    // --- Schedule / organize / coordinate ---
    if (/schedule|organize|coordinate|plan|arrange/i.test(msg)) {
      if (/receptionist/i.test(title)) {
        return `I'll check the schedule now. [ACTION:useComputer]`;
      }
      if (this._hierarchy['Lucy']) {
        return `I'll have Lucy handle scheduling. [ACTION:speakTo:Lucy:CEO needs help with scheduling] [DELEGATE:Lucy:scheduling task]`;
      }
    }

    // --- IT / server / network / computer issue ---
    if (/server|network|computer|wifi|internet|it issue|tech support|restart/i.test(msg)) {
      if (/it support|devops/i.test(title)) {
        return `I'll take a look at that. [ACTION:goToRoom:storage]`;
      }
      if (this._hierarchy['Dan']) {
        return `That's an IT issue. I'll get Dan on it. [ACTION:speakTo:Dan:CEO reported a tech issue] [DELEGATE:Dan:IT support task]`;
      }
    }

    // --- Security ---
    if (/security|patrol|guard|watch|protect|lock/i.test(msg)) {
      if (/security/i.test(title)) {
        return `On patrol, I'll check it out. [ACTION:goToRoom:reception]`;
      }
      if (this._hierarchy['Bouncer']) {
        return `I'll let Bouncer know. [ACTION:speakTo:Bouncer:CEO wants a security check] [DELEGATE:Bouncer:security task]`;
      }
    }

    // --- Delegate to someone mentioned ---
    if (mentionedPerson) {
      const task = message.replace(new RegExp(npcName, 'gi'), '').replace(new RegExp(mentionedPerson, 'gi'), '').trim().slice(0, 50) || 'handle this task';
      return `I'll pass that to ${mentionedPerson}. [ACTION:speakTo:${mentionedPerson}:${task}]`;
    }

    // --- Greetings (provider timeout fallback) ---
    if (this._isGreetingOnly(message, npcName)) {
      return this._greetingReply(npcName, h);
    }

    // --- Generic: just go work on it ---
    return `On it, heading to my desk. [ACTION:useComputer]`;
  }

  /**
   * Roadmap Stage 3 step 3 — re-read a single NPC's SOUL.md from disk and
   * refresh the cached personality. Called by the /api/soul-proposal/apply
   * endpoint right after the file has been mutated so the next `think()`
   * cycle sees the new soul text without a server restart.
   *
   * SOUL.md is otherwise loaded once at boot (see `_initBrains`) and held
   * on `brain.personality`, so this is the only way to pick up an on-disk
   * change mid-run.
   *
   * Returns true on success, false if the NPC isn't known or the file
   * cannot be read.
   */
  reloadSoul(npcName) {
    const brain = this.brains[npcName];
    if (!brain) return false;
    const folder = this._nameToFolder[npcName];
    if (!folder) return false;
    const soulPath = path.join(__dirname, '..', 'npcs', folder, 'SOUL.md');
    try {
      brain.personality = fs.readFileSync(soulPath, 'utf-8');
      return true;
    } catch (err) {
      console.warn(`[NpcBrains] reloadSoul(${npcName}) failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Roadmap Stage 3 — daily reflection.
   *
   * Builds a reflection prompt using the NPC's SOUL.md + last ~50 memory
   * entries, submits it through the NPC's existing LLM provider, parses
   * the proposal JSON, validates it, and POSTs to /api/soul-proposal.
   *
   * NOT auto-fired anywhere on a timer. Call this from a diag panel,
   * an admin endpoint, or a future cron. See docs/SOUL_REFLECTION.md.
   *
   * Options:
   *   - submitUrl: where to POST the proposal (default '/api/soul-proposal'
   *     on the local server). Set to null to skip the HTTP call and just
   *     return the proposal — useful for tests and for surfacing the
   *     suggestion in the diag panel before sending it.
   *   - port: which port the local server listens on (default reads PORT
   *     env then 8080).
   *
   * Returns { ok, proposal, error?, submitted? }.
   */
  async reflectOnDay(npcName, opts = {}) {
    const soulReflection = require('./soul-reflection');
    const brain = this.brains[npcName];
    if (!brain) {
      return { ok: false, error: `unknown NPC: ${npcName}` };
    }

    // Pull last ~50 memory lines (ignore blanks).
    const rawMemory = brain.longTermMemory || '';
    const memoryLines = rawMemory.split('\n').map(l => l.trim()).filter(Boolean).slice(-50);

    const prompt = soulReflection.buildReflectionPrompt({
      npcName,
      soul: brain.personality,
      recentMemories: memoryLines,
    });

    let response;
    try {
      response = await this._callProvider(brain.providerConfig, prompt, [
        { role: 'user', content: 'Reflect now and respond with the JSON object only.' },
      ], { maxTokens: 400, sliceLen: 600, temperature: 0.5 });
    } catch (err) {
      return { ok: false, error: `provider call failed: ${err?.message || err}` };
    }

    let parsed;
    try {
      const m = String(response || '').match(/\{[\s\S]*\}/);
      if (!m) throw new Error('no JSON object in response');
      parsed = JSON.parse(m[0]);
    } catch (err) {
      return { ok: false, error: `failed to parse JSON: ${err.message}`, raw: String(response || '').slice(0, 400) };
    }

    const v = soulReflection.validateProposal(parsed);
    if (!v.ok) {
      return { ok: false, error: `invalid proposal: ${v.error}`, parsed };
    }

    const submitUrl = opts.submitUrl === undefined
      ? `http://127.0.0.1:${opts.port || process.env.PORT || 8080}/api/soul-proposal`
      : opts.submitUrl;

    if (!submitUrl) {
      return { ok: true, proposal: parsed, submitted: false };
    }

    try {
      const fetchFn = (typeof fetch === 'function') ? fetch : require('node:undici').fetch;
      const res = await fetchFn(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcName, proposal: parsed, reflectionInput: memoryLines.join('\n').slice(0, 800) }),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, proposal: parsed, submitted: true, status: res.status, body };
    } catch (err) {
      return { ok: false, error: `POST failed: ${err?.message || err}`, proposal: parsed };
    }
  }

  // ── Feature: Skill Bridge ──────────────────────────────────────────────────

  /**
   * Store an OpenClaw skill result for an NPC. It will be injected into
   * their next think() system prompt, then cleared.
   */
  injectSkillResult(npcName, skill, result) {
    this._pendingSkillResults.set(npcName, { skill, result, ts: Date.now() });
    if (typeof this._thinkWakeFn === 'function') {
      this._thinkWakeFn(npcName, `skill:${skill}`, { urgent: true, delayMs: 200 });
    }
    // Evidence ledger — what the NPC has actually done, used by the grounding
    // check to tell real work apart from confident claims with nothing behind them.
    const ev = this._evidenceLog.get(npcName) || {};
    ev.skillAt = Date.now();
    if (skill === 'research') { ev.researchAt = Date.now(); ev.researchText = String(result || '').slice(0, 2000); }
    this._evidenceLog.set(npcName, ev);
  }

  // ── Feature: Mood System ───────────────────────────────────────────────────

  /**
   * Return the current mood string for an NPC, defaulting to 'neutral'.
   */
  _getMood(npcName) {
    const entry = this._npcMoods.get(npcName);
    if (!entry) return 'neutral';
    // Check if cycle budget has expired
    if (entry.cycles <= 0) {
      this._npcMoods.delete(npcName);
      return 'neutral';
    }
    return entry.mood;
  }

  /**
   * Shift an NPC's mood based on a named event. Cycle counts are decremented
   * on each call to _getMood (effectively each think cycle).
   */
  _updateMood(npcName, event) {
    const MEETING_EXCITED = new Set(['Josh', 'Roki']);
    const MEETING_FOCUSED = new Set(['Abby', 'Marcus', 'Sarah']);

    let mood = 'neutral';
    let cycles = 2;

    switch (event) {
      case 'task_finished':
        mood = 'energized'; cycles = 2; break;
      case 'task_blocked':
        mood = 'frustrated'; cycles = 3; break;
      case 'long_work_streak':
        mood = 'tired'; cycles = 2; break;
      case 'ceo_talked':
        mood = 'energized'; cycles = 2; break;
      case 'meeting_called':
        if (MEETING_EXCITED.has(npcName)) {
          mood = 'excited';
        } else if (MEETING_FOCUSED.has(npcName)) {
          mood = 'focused';
        } else {
          mood = 'neutral';
        }
        cycles = 2;
        break;
      default:
        mood = 'neutral'; cycles = 0;
    }

    if (mood === 'neutral') {
      this._npcMoods.delete(npcName);
    } else {
      this._npcMoods.set(npcName, { mood, since: Date.now(), cycles });
    }

    // Sync mood to agent-office-manager so both systems stay in lockstep.
    // Without this the LLM prompt mood and the visible NPC behavior mood
    // drift — an NPC can look "focused" on screen but be "frustrated" in
    // their head (or vice versa after a threat event shifts the manager side).
    if (_broadcastFn) {
      try {
        _broadcastFn({ type: 'npc_mood_change', npcName, mood, ts: Date.now() });
      } catch (_) {}
    }
  }

  /**
   * Tick down the mood cycle counter by 1. Called inside think() after
   * we read the mood so the NPC gets the full cycle before expiry.
   */
  _tickMoodCycle(npcName) {
    const entry = this._npcMoods.get(npcName);
    if (!entry) return;
    entry.cycles -= 1;
    if (entry.cycles <= 0) this._npcMoods.delete(npcName);
  }

  /**
   * Allow server.js to push mood events (e.g. 'ceo_talked') from outside
   * the think loop.
   */
  setMoodFromExternal(npcName, event) {
    this._updateMood(npcName, event);
  }

  // ── Feature: Directive Inbox ───────────────────────────────────────────────

  /**
   * Push a mandatory task directive from one NPC to another.
   */
  assignDirective(targetNpc, fromNpc, task, urgent = false) {
    this._directives.set(targetNpc, { from: fromNpc, task, ts: Date.now(), urgent });
    log.info('Directive', `${fromNpc} → ${targetNpc}: "${String(task).slice(0, 60)}"`);
    if (typeof this._thinkWakeFn === 'function') {
      this._thinkWakeFn(targetNpc, urgent ? 'urgent_directive' : 'directive', { urgent: true });
    }
  }

  setThinkWake(fn) {
    this._thinkWakeFn = typeof fn === 'function' ? fn : null;
  }

  // ── Commitment tracking — make NPCs follow through on what they SAY ─────────
  //
  // The lead complaint: an NPC tells you "I'll look into that and report back"
  // and then never does. Their stated intent was just text in a message; no
  // state captured it, so the next think cycle they'd moved on. This records
  // promises and injects them back into the prompt as obligations until acted on.

  /** Does this message contain a forward-looking promise? Returns the trimmed
   *  promise text, or null. Skips messages that are already reporting done work. */
  _detectCommitment(message) {
    if (!message || typeof message !== 'string') return null;
    // Already-done / reporting language — not a new promise.
    if (/\b(i (looked|checked|finished|completed|did|found|fixed|wrote|built)|i'?ve |i have (looked|checked|done|finished|completed|built))/i.test(message)) return null;
    const promise = /(i'?ll\b|i will\b|let me\b|i'?m going to\b|i am going to\b|i'?m on it\b|on it\b|get back to you|report back|circle back|look into|i'?ll check|i'?ll handle|take care of (it|this|that)|i'?ll figure|dig into|investigate this|put together|i'?ll draft|i'?ll write up|i'?ll find out|i'?ll set up|i'?ll build|i'?ll fix)/i;
    if (!promise.test(message)) return null;
    return message.replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  /** Record a promise an NPC made (deduped; max 3 open per NPC). */
  recordCommitment(npcName, text, to) {
    if (!text) return;
    const list = this._commitments.get(npcName) || [];
    // Dedupe near-identical open promises.
    const norm = text.toLowerCase().slice(0, 60);
    if (list.some(c => c.status === 'open' && c.text.toLowerCase().slice(0, 60) === norm)) return;
    list.push({ text, to: to || 'the team', at: Date.now(), status: 'open' });
    // Keep only the 3 most recent open commitments + drop resolved.
    const open = list.filter(c => c.status === 'open').slice(-3);
    this._commitments.set(npcName, open);
    log.info('Commitment', `${npcName} → ${to || 'team'}: "${text.slice(0, 60)}"`);
  }

  getOpenCommitments(npcName) {
    return (this._commitments.get(npcName) || []).filter(c => c.status === 'open');
  }

  /** Resolve (clear) an NPC's open commitments — they followed through. Returns
   *  the resolved commitments so the caller can surface a report to the CEO. */
  resolveCommitments(npcName, reason = 'acted') {
    const list = this._commitments.get(npcName) || [];
    const resolved = list.filter(c => c.status === 'open');
    if (resolved.length) {
      this._commitments.set(npcName, []);
      log.info('Commitment', `${npcName} resolved ${resolved.length} (${reason})`);
    }
    return resolved;
  }
}

/**
 * Decision schema for structured output. Passed to providers that support
 * grammar-constrained / schema-validated decoding (LM Studio json_schema,
 * Gemini responseSchema, Anthropic tool-use) so even small models can't emit
 * malformed JSON. Only `action` is required; everything else is optional so
 * NPCs aren't forced to fill fields that don't apply. Non-strict on purpose —
 * models may add reasoning/plan keys, which we keep.
 */
// LM Studio json_schema rejects union types; keep fields simple so small models decode reliably.
NpcBrainManager.DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['talk', 'collaborate', 'report', 'work', 'break', 'coffee', 'check', 'read', 'visit', 'wander', 'meeting', 'run_skill', 'idle'] },
    thought: { type: 'string' },
    message: { type: 'string' },
    target: { type: 'string' },
    location: { type: 'string' },
    taskPhase: { type: 'string', enum: ['starting', 'continuing', 'finished', 'none'] },
    save: { type: 'string' },
    outcome: { type: 'string' },
    skill: { type: 'string' },
  },
  required: ['action'],
  additionalProperties: true,
};

module.exports = NpcBrainManager;

/**
 * Set the broadcast function used by the task chain runner when NPC brains
 * need to send chain events to connected WebSocket clients.
 * Call this from server.js at startup: npcBrains.setBroadcast(fn)
 *
 * Defined on the prototype (not the constructor) so it's callable on the
 * `new NpcBrainManager()` *instance* that server.js holds. _broadcastFn is
 * module-scoped, so a single setter backs every instance — fine, since the
 * server only ever creates one.
 */
NpcBrainManager.prototype.setBroadcast = function(fn) {
  _broadcastFn = fn;
};
