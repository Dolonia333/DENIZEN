/**
 * NPC Brain System
 * Each NPC has their own AI brain powered by a different API provider.
 * When an NPC needs to respond in conversation, their brain generates the reply.
 * Falls back to Claude if the assigned provider fails.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const npcRoster = require('./npc-roster');

// Shared world-state singleton + agent bus. Loaded lazily in a try/catch so
// older test fixtures that import npc-brains in isolation don't break.
let worldState = null;
let agentBus = null;
let llmTelemetry = null;
try { worldState = require('./world-state'); } catch (_) {}
try { agentBus = require('./agent-bus'); } catch (_) {}
try { llmTelemetry = require('./llm-telemetry'); } catch (_) {}

// NPC real-work tools (Level 1/2/3). Lazy-loaded so the brains still work
// if npc-tools.js isn't present yet (e.g. during older test runs).
let npcTools = null;
try { npcTools = require('./npc-tools'); } catch (_) {}

// Phase 3.2 — Task chain orchestration
let taskChain = null;
try { taskChain = require('./task-chain'); } catch (_) {}

// Phase 3.3 — NPC conflict detector (injects into Abby's prompt when NPCs disagree)
let conflictDetector = null;
try { conflictDetector = require('./conflict-detector'); } catch (_) {}

// Broadcast function reference — set at server startup via setBroadcast()
let _broadcastFn = null;

// Clean console logger — replaces scattered console.log calls
const log = require('./logger');

class NpcBrainManager {
  constructor() {
    this.providers = {};   // provider configs loaded from openclaw.json
    this.brains = {};      // npcName -> NpcBrain instance
    this.memories = {};    // npcName -> conversation history array
    this._thinkCycles = {};    // npcName -> consecutive work cycles count
    this._lastDecisions = {};  // npcName -> last decision object
    this._taskProgress = {};   // npcName -> { task, phase, startedAt }
    this._pendingCascades = []; // queued cascade decisions to send downstream
    this._requestQueue = [];    // queue for LM Studio requests
    this._pendingSkillResults = new Map(); // npcName → {skill, result, ts}
    this._npcMoods = new Map();            // npcName → {mood, since, cycles}
    this._directives = new Map();          // npcName → {from, task, ts, urgent}
    this._commitments = new Map();         // npcName → [{ text, to, at, status }]  — promises the NPC made and must follow through on
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
    this._initBrains();
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
  _getCompanyContext(npcName) {
    const b = this._companyBrief;
    if (!b) return '';
    const brain = this.brains[npcName];
    const role = brain ? brain.role : '';
    const roleTasks = b.role_tasks ? (b.role_tasks[role] || []) : [];
    const taskLines = roleTasks.slice(0, 4).map(t => '- ' + t).join('\n');
    const sprintGoal = b.sprint ? b.sprint.goal : '';
    return [
      'Company: ' + b.company + ' | Product: ' + b.product,
      'What we build: ' + (b.description || ''),
      'Sprint: ' + (b.sprint ? b.sprint.name : '') + (sprintGoal ? ' — ' + sprintGoal : ''),
      'Current focus: ' + (Array.isArray(b.current_focus) ? b.current_focus.slice(0, 3).join('; ') : ''),
      '',
      'Your sprint tasks (pick one to work on):',
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

  _assistantProfilePromptBlock(npcName) {
    const profile = this._assistantProfile || this._defaultAssistantProfile();
    const user = profile.user || {};
    const projects = Array.isArray(profile.projects) ? profile.projects : [];
    const pol = profile.autonomyPolicy || {};
    const npcPolicy = this._getNpcPolicy(npcName);

    const prefs = Array.isArray(user.preferences) ? user.preferences.slice(0, 6) : [];
    const prefsText = prefs.length ? prefs.map(p => `- ${p}`).join('\n') : '- (none set)';
    const projText = projects.length
      ? projects.slice(0, 4).map((p, i) => `${i + 1}. ${p.name} [${p.status || 'active'}, ${p.priority || 'normal'}] ${p.notes || ''}`).join('\n')
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

  _recordAssistantDecision(npcName, entry) {
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
      const configPath = path.join(
        process.env.USERPROFILE || process.env.HOME || '',
        '.openclaw', 'openclaw.json'
      );
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
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
      this.providers.lmstudio = {
        baseUrl: 'http://localhost:1234',
        apiKey: process.env.LM_STUDIO_API_KEY || 'lm-studio',
        model: process.env.LM_STUDIO_MODEL || 'mistralai/ministral-3-14b-reasoning',
        type: 'lmstudio',
      };
      // Second local model slot — for fast background NPCs (e.g. llama 8B).
      // Set LM_STUDIO_FAST_MODEL env var or load a second model in LM Studio.
      // Falls back to the main lmstudio model if not set.
      this.providers['lmstudio-fast'] = {
        baseUrl: 'http://localhost:1234',
        apiKey: process.env.LM_STUDIO_API_KEY || 'lm-studio',
        model: process.env.LM_STUDIO_FAST_MODEL || 'meta-llama-3.1-8b-instruct',
        type: 'lmstudio',
      };

      console.log(`[NpcBrains] Loaded providers: ${Object.keys(this.providers).join(', ')}`);
    } catch (err) {
      console.warn('[NpcBrains] No openclaw.json found — running in demo mode (no API keys needed)');
    }

    // Always register a 'demo' provider as ultimate fallback
    // This ensures NPCs load even with zero API keys configured
    if (!this.providers.demo) {
      this.providers.demo = { type: 'demo', baseUrl: null, apiKey: null, model: null };
    }
    const remoteCount = Object.keys(this.providers).filter(k => k !== 'demo' && k !== 'lmstudio').length;
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
      const provider = providerMatch?.[1] || 'lmstudio';
      const role = roleMatch?.[1]?.trim() || 'Employee';

      const providerConfig = this.providers[provider] || this.providers.lmstudio || this.providers.demo;

      this.brains[name] = {
        provider,
        role,
        personality: soul,  // Full SOUL.md content IS the personality
        longTermMemory,
        providerConfig,
        fallbackConfig: null, // No paid API fallback — go straight to canned responses
      };
      this.memories[name] = [];

      console.log(`[NpcBrains] ${name} (${role}) -> ${provider} [SOUL.md loaded]`);
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
    } catch (err) {
      console.warn(`[NpcBrains] Failed to save memory for ${npcName}:`, String(err?.message ?? err));
    }
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
  _sanitize(str) {
    return String(str ?? '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, '');
  }

  /**
   * Probe LM Studio and sync the active loaded model into providers.lmstudio.
   * Called at server startup so whichever model the user has loaded is used
   * automatically — no manual config changes needed when switching models.
   */
  async syncLmStudioModel() {
    if (!this.providers.lmstudio) return;
    const base = this.providers.lmstudio.baseUrl || 'http://localhost:1234';
    try {
      const res = await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const data = await res.json();
      const loaded = (data.data || []).find(m => m.state === 'loaded' && m.type !== 'embeddings');
      if (loaded) {
        const prev = this.providers.lmstudio.model;
        this.providers.lmstudio.model = loaded.id;
        if (prev !== loaded.id) {
          log.modelSync({ prev, current: loaded.id, contextLen: loaded.loaded_context_length });
        }
      }
    } catch (_) {
      // LM Studio not running — that's fine, other providers handle it
    }
  }

  async getResponse(npcName, fromName, message, context = {}) {
    const brain = this.brains[npcName];
    if (!brain) return `(${npcName} nods)`;

    const safeMessage = typeof message === 'string' ? message : String(message ?? '');

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

    const systemPrompt = `${brain.personality}${memorySection}

## Your Coworkers
${coworkerContext}

You are ${npcName} at work. Stay fully in character — your personality, values, and voice define how you speak.
Your role: ${brain.role}. You know your coworkers, remember past conversations, and understand how you can help each other.
Keep responses to 1–2 natural sentences (under 200 characters). Sound like yourself, not a generic assistant.${moodNote}
Reference past conversations when relevant. ${context.description || ''}${taskContext}

Respond as ${npcName}. Dialogue only — no stage directions, no quotation marks.`;

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
    // Reduced from 10 → 6 to stay within Mistral's context and avoid
    // the strict alternating-role jinja template error at depth 10.
    const HISTORY_DEPTH = Number(process.env.NPC_HISTORY_DEPTH) || 6;
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

    try {
      const response = await this._callProvider(brain.providerConfig, systemPrompt, messages, { maxTokens: 200, sliceLen: 300, npc: npcName, kind: 'response' });
      let out = response;
      if (typeof out !== 'string') {
        out = this._cannedResponse(npcName, fromName, safeMessage);
      }
      out = this._sanitize(out);
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
          out = this._sanitize(out);
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

    const rawMemory = brain.longTermMemory || '';
    const recentMemory = rawMemory.length > 100
      ? this._sanitize(rawMemory.slice(-1200))
      : '';

    const coworkerContext = this._getCoworkerContext(npcName, '');
    const hierarchyRules = this._getHierarchyRules(npcName);
    const teamContext = this._getTeamContext(npcName);
    const h = this._hierarchy[npcName];
    const assistantProfileBlock = this._assistantProfilePromptBlock(npcName);

    // Cap at 4 recent memories and truncate each — was 10 full memories
    // which could add 500-1000 tokens and push Lucy/Abby over the 4096 limit.
    const recentConversations = (this.memories[npcName] || []).slice(-4)
      .map(m => m.from + ': "' + String(m.text || '').slice(0, 80) + '"')
      .join('\n');

    // Track think cycles for fatigue/variety hints
    const cycles = this._thinkCycles[npcName] || 0;
    const lastDecision = this._lastDecisions[npcName] || null;
    const taskProg = this._taskProgress[npcName] || null;

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
      actionWeightHint = 'As a manager, spend ~30% TALKING (check-ins, delegating, updates), ~25% MEETINGS (call people to the conference room — set target + location: conference), ~20% WORKING, ~15% COLLABORATING, ~10% BREAKS. Do NOT just sit at your desk every cycle.';
    } else if (h && h.reportsTo !== 'CEO') {
      actionWeightHint = 'Balance your time: ~35% WORKING, ~25% TALKING (updates, asking for help), ~20% MEETINGS (join or propose one when you have something to discuss — set target + location: conference), ~10% COLLABORATING, ~10% BREAKS.';
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
    const planText = dailyPlan
      ? dailyPlan.priorities.map((p, i) => `${i + 1}. ${p}`).join('\n')
      : '';
    const theoryOfMind = this._getTheoryOfMind(npcName, 4);
    const eventsFeed = this._getRecentEvents(4);
    const taskBoard = this._getTaskBoard(4);

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
    const liveContextBlock = worldState ? worldState.renderContextBlock(npcName) : '';

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
    const inboxText = inbox.length
      ? inbox.map(m => `- from ${m.from}: ${m.text}`).join('\n')
      : '';

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
    if (npcTools && !NON_CODE_ROLES.has(brain.role)) {
      const lastAct = (this._lastDecisions[npcName] || {}).action;
      const chance = (lastAct === 'work' || lastAct === 'read') ? 0.60 : 0.20;
      if (Math.random() < chance) {
        codeContext = npcTools.getCodeContext(brain.role);
      }
    }

    // Level 3 — Live infra: run a fast pre-approved command for DevOps/IT/Security.
    // Async but capped at 5s timeout inside runSafeCommand, so it won't stall the loop.
    let liveInfraContext = null;
    if (npcTools && npcTools.INFRA_ROLES.has(brain.role) && Math.random() < 0.45) {
      liveInfraContext = await npcTools.getLiveInfraContext(brain.role);
    }

    // OpenClaw skills context — injected for roles that can actually use them.
    // Lucy uses job pipeline skills, Bouncer uses security tools, CTO/IT use
    // the broader skill set for delegation. Kept brief — just enough to inform
    // decisions, not a full API reference.
    const OPENCLAW_SKILL_ROLES = new Set([
      'CTO', 'Receptionist (also handles CEO email triage as Secretary)',
      'Security Guard', 'IT Support', 'DevOps Engineer',
      'Developer', 'Researcher', 'Data Engineer', 'Intern',
    ]);
    let openClawContext = null;
    if (OPENCLAW_SKILL_ROLES.has(brain.role)) {
      const skillsByRole = {
        'CTO': 'browserclaw (web automation), coding-agent (Claude Code/Codex), github (PRs/issues/CI), supabase-bridge (database), canvas-render (HTML→screenshot), pdf-generator, lm-studio (model management)',
        'Receptionist (also handles CEO email triage as Secretary)': 'job-scraper (find job listings on LinkedIn/Indeed), job-applier (auto-fill and submit applications), resume-generator (tailor resumes to job descriptions), pdf-generator (generate PDFs), session-health (check job board login status)',
        'Security Guard': 'browserclaw (investigate suspicious URLs), visionclaw (screen/image analysis). Primary tools are in Kali Linux via linux-agent: nmap, ss, netstat, journalctl, whois, tcpdump',
        'IT Support': 'lm-studio (manage models, fix context overflow), supabase-bridge (check database health), browserclaw (look up docs/fixes)',
        'DevOps Engineer': 'supabase-bridge (query metrics), github (check CI status), lm-studio (monitor inference queue)',
        'Developer': 'github (create issues, open PRs, check CI status, list/close issues via gh CLI)',
        'Researcher': 'browserclaw (automated browser for reading docs, papers, and web research)',
        'Data Engineer': 'supabase-bridge (query/insert data, run migrations, inspect schemas)',
        'Intern': 'market-watch (run a full Robinhood market observation cycle — quotes for your watchlist + portfolio snapshot), get-quote (quick price check, skillParams: { symbols: ["NVDA","TSLA"] }), trade-suggest (record a trade idea as a SUGGESTION ONLY — never executed automatically, skillParams: { symbol, tradeAction: "buy"|"sell"|"watch", rationale, targetPrice? })',
      };
      const skillLine = skillsByRole[brain.role] || '';
      if (skillLine) {
        // Technical roles can also AUTHOR a new tool when none of the above fits.
        const builders = new Set(['CTO', 'Developer', 'Data Engineer', 'DevOps Engineer', 'Researcher', 'IT Support']);
        const buildLine = builders.has(brain.role)
          ? `\nIf you need a tool that doesn't exist yet, draft one: action:"run_skill", skill:"build-skill", skillParams:{ name:"kebab-name", purpose:"what it does", params:["inputs"] }. The CEO must approve the generated code before it can run — so propose it, then move on; don't wait.`
          : '';
        openClawContext = `OpenClaw gateway (localhost:18789) is live. Skills you can reference or request:\n${skillLine}${buildLine}\nWhen you delegate real work to OpenClaw, mention the skill name in your message.`;
      }
    }

    // PC Access — every NPC should understand when the CEO asks them to use the PC.
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

    const systemPrompt = brain.personality + '\n\n' +
      (directiveBlock ? directiveBlock : '') +
      (commitmentBlock ? commitmentBlock : '') +
      (chainContext ? chainContext + '\n\n' : '') +
      (conflictContext ? conflictContext + '\n\n' : '') +
      (skillResultBlock ? skillResultBlock : '') +
      (moodBlock ? moodBlock : '') +
      (companyContext ? '## Company & Sprint Context\n' + companyContext + '\n\n' : '') +
      (openClawContext ? '## OpenClaw Skills Available\n' + openClawContext + '\n\n' : '') +
      (pcAccessContext ? pcAccessContext + '\n\n' : '') +
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
      'Be social, collaborative, and reference past conversations. When you FINISH a task, report to ' + reportsToStr + '.\n' +
      'Respond with EXACTLY ONE JSON object (no other text).';

    // Build contextual user prompt based on NPC state
    const currentTask = this._taskProgress[npcName];
    const recentMemLines = (brain.longTermMemory || '').split('\n').filter(l => l.trim()).slice(-5);
    const randomNearby = officeContext?.description?.match(/(\w+) \(/)?.[1];

    const nudges = [];
    if (cycles >= 3) nudges.push(`You've been working non-stop for ${cycles} cycles. Check in with someone, take a break, or collaborate.`);
    if (lastDecision?.action === 'talk' && lastDecision?.target) nudges.push(`You recently talked to ${lastDecision.target}. Follow up or move to something new.`);
    if (recentMemLines.length > 0) {
      const lastMem = recentMemLines[recentMemLines.length - 1].replace(/^- \[.*?\] /, '');
      if (lastMem.length > 10) nudges.push(`Your last note: "${lastMem.slice(0, 80)}". Follow up on it or start something new.`);
    }
    if (randomNearby && Math.random() > 0.5) nudges.push(`${randomNearby} is nearby. Consider talking to them or pulling them into a quick meeting.`);
    if (currentTask) nudges.push(`You're working on: "${currentTask.task}". Continue, finish, or pivot?`);
    if (!currentTask && Math.random() > 0.4) nudges.push(`You don't have a specific task right now. Find something to work on or call a quick meeting.`);
    // Occasionally nudge managers and non-managers alike toward the conference room
    if (h && h.manages.length > 0 && Math.random() > 0.55) {
      const reportName = h.manages[Math.floor(Math.random() * h.manages.length)];
      nudges.push(`You haven't synced with ${reportName} in a while. Pull them into the conference room for a quick check-in.`);
    } else if (h && h.reportsTo !== 'CEO' && Math.random() > 0.65) {
      nudges.push(`You have something to discuss with ${h.reportsTo}. Head to the conference room and call them in.`);
    }

    const nudge = nudges.length > 0 ? nudges[Math.floor(Math.random() * nudges.length)] : '';

    const codeInstruction = codeContext
      ? `You have a codebase snippet in your context (## Codebase Snippet). You are actively reading/reviewing this code RIGHT NOW. Reference specific function names, line numbers, or observations from it in your "message" and "save" fields. Don't say you "are reading" — say WHAT you found.\n\n`
      : '';

    const userPrompt = `${nudge ? nudge + '\n\n' : ''}${codeInstruction}Decide what to do next. Think step by step, then respond with a single JSON object:
{"reasoning": "1-2 sentences tracing: what's my current state, what matters most, why this action", "plan": "one-line projected next 2 steps", "thought": "your internal monologue (one sentence)", "action": "talk|work|collaborate|break|check|meeting|report|read|visit|coffee|wander|run_skill", "target": "NPC name or null", "location": "desk|breakroom|conference|storage|manager_office|reception|open_office|null", "message": "what you say out loud (under 120 chars)", "taskPhase": "starting|continuing|finished|none", "save": "brief note for your memory", "outcome": "ok|stuck|blocked|success|null", "skill": "skill name when action is run_skill (e.g. job-scraper, github, browserclaw) or null", "skillParams": {}}

ACTION MEANINGS:
- talk/collaborate/report: interact with a specific coworker (set target)
- work: heads-down at your desk
- break/coffee: breakroom, grab a drink, recharge
- check: look up info at the bookshelf, or go check something at a location
- read: read at the bookshelf — useful when you need to research
- visit: drop by a coworker's desk to check on them (set target, no conversation required)
- wander: walk through the office, stretch, observe — use sparingly
- meeting: go to the conference room for a meeting. Set target to whoever you want there — they will physically walk to the conference room and join you. Set location: conference. Use when you need to review work, plan something, or sync with someone face-to-face. Example: {"action":"meeting","target":"Josh","location":"conference","message":"Josh, quick sync in the conference room?"}
- run_skill: execute an OpenClaw skill tool. Set skill to the skill name and skillParams to the arguments. Use for: Lucy→job-scraper/job-applier/resume-generator, Alex/Jenny→github, Bob→browserclaw, Dan→lm-studio, Oscar→supabase-bridge

IMPORTANT: You must pick actions OTHER than "work" at least 40% of the time. Use the WHOLE OFFICE — go to the conference room for meetings, the breakroom for coffee, the bookshelf to read. An office where nobody moves is a dead office.`;

    try {
      const response = await this._callProvider(brain.providerConfig, systemPrompt, [
        { role: 'user', content: userPrompt }
      ], { maxTokens: 400, sliceLen: 600, temperature: 0.95, npc: npcName, kind: 'think',
           jsonSchema: NpcBrainManager.DECISION_SCHEMA, jsonSchemaName: 'npc_decision' });

      // Parse the JSON response with the tolerant parser (handles fences,
      // trailing commas, smart quotes, and truncated output from weaker models).
      const decision = this._parseDecisionJson(response);
      if (decision) {

        // Track think cycles (reset on non-work action)
        if (decision.action === 'work') {
          this._thinkCycles[npcName] = (this._thinkCycles[npcName] || 0) + 1;
        } else {
          this._thinkCycles[npcName] = 0;
        }

        // Save last decision for continuity
        this._lastDecisions[npcName] = {
          action: decision.action,
          target: decision.target,
          thought: decision.thought,
          timestamp: new Date().toISOString().slice(0, 16),
        };

        // ── Commitment capture + resolution ───────────────────────────────────
        // They followed through if they finished a task or actually reported /
        // ran a skill — clear their open promises and surface the report.
        const didFollowThrough =
          decision.taskPhase === 'finished' ||
          decision.action === 'report' ||
          (decision.action === 'run_skill') ||
          (decision.outcome === 'success');
        if (didFollowThrough) {
          const resolved = this.resolveCommitments(npcName, decision.action || 'acted');
          // If they'd promised the CEO, surface the report so the CEO actually
          // sees the follow-through (the whole point of "report back").
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
        } else {
          // Otherwise, if this decision itself contains a new promise, record it.
          if (decision.message && ['talk', 'collaborate', 'meeting', 'report'].includes(decision.action)) {
            const promise = this._detectCommitment(decision.message);
            if (promise) this.recordCommitment(npcName, promise, decision.target || 'the team');
          }
        }

        // Track task progress phases
        if (decision.taskPhase === 'starting' && decision.message) {
          this._taskProgress[npcName] = {
            task: decision.message.slice(0, 80),
            phase: 'in-progress',
            startedAt: new Date().toLocaleTimeString(),
          };
        } else if (decision.taskPhase === 'finished') {
          var finishedTask = this._taskProgress[npcName];
          this._taskProgress[npcName] = null;
          // Auto-report to manager when finishing a task
          if (finishedTask && !decision.target && h) {
            decision.target = h.reportsTo !== 'CEO' ? h.reportsTo : null;
            if (decision.action !== 'report') decision.action = 'report';
          }
          // Level 2 — Write artifact to disk when task finishes
          if (npcTools && decision.save) {
            const artifactOpts = {
              reasoning: decision.reasoning ? String(decision.reasoning).slice(0, 400) : null,
              thought: decision.thought ? String(decision.thought).slice(0, 200) : null,
              outcome: decision.outcome || null,
              action: decision.action || null,
              target: decision.target || null,
              codeFile: codeContext ? (brain.role && npcTools.ROLE_CODE_FILES[brain.role] || [])[0] || null : null,
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

          // Addition B — Record artifact for conflict detection
          if (conflictDetector && decision.save) {
            conflictDetector.recordArtifact({
              npc: npcName,
              task: finishedTask ? finishedTask.task : (decision.save || ''),
              outcome: decision.outcome || null,
              artifactPath: decision._artifactPath || '',
              chainId: (taskChain && taskChain.getChainForNpc(npcName))?.chain?.id || null,
            });
          }

          // Addition B — Advance the task chain when this NPC was a chain step
          if (taskChain) {
            const chainInfo = taskChain.getChainForNpc(npcName);
            if (chainInfo) {
              const artifactPath = decision._artifactPath || `reports/unknown/${npcName}_${Date.now()}.md`;
              const _broadcast = _broadcastFn || null;
              taskChain.onStepComplete(
                npcName,
                artifactPath,
                (to, from, task, urgent) => this.assignDirective(to, from, task, urgent),
                _broadcast
              );
            }
          }
        } else if (decision.taskPhase === 'continuing' && this._taskProgress[npcName]) {
          this._taskProgress[npcName].phase = 'continuing';
        }

        // ── Mood updates ──────────────────────────────────────────────────────
        if (decision.outcome === 'blocked' || decision.outcome === 'stuck') {
          this._updateMood(npcName, 'task_blocked');
        } else if (decision.taskPhase === 'finished') {
          this._updateMood(npcName, 'task_finished');
        } else if (decision.action === 'meeting') {
          this._updateMood(npcName, 'meeting_called');
        }
        // Track consecutive work cycles for tiredness
        {
          const workCycles = this._thinkCycles[npcName] || 0;
          if (workCycles >= 3) {
            this._updateMood(npcName, 'long_work_streak');
          }
        }

        // ── Directive inbox: clear on finish + redirect ───────────────────────
        if (decision.taskPhase === 'finished' && this._directives.has(npcName)) {
          const dir = this._directives.get(npcName);
          this._directives.delete(npcName);
          if (decision.action !== 'report') {
            decision.action = 'report';
            decision.target = dir.from;
            decision.message = decision.message || `Done — ${decision.save || 'task complete'}.`;
          }
        }

        // Enhanced memory saving: include WHO, WHAT, DECIDED, NEXT
        if (decision.save) {
          var enrichedSave = decision.save;
          if (decision.taskPhase && decision.taskPhase !== 'none') {
            enrichedSave = '[' + decision.taskPhase.toUpperCase() + '] ' + enrichedSave;
          }
          if (decision.outcome && decision.outcome !== 'null' && decision.outcome !== 'none') {
            enrichedSave = '[OUTCOME:' + decision.outcome + '] ' + enrichedSave;
          }
          if (decision.target && h) {
            var targetH = this._hierarchy[decision.target];
            if (targetH) {
              var rel = (h.manages.indexOf(decision.target) !== -1) ? 'report' :
                        (h.reportsTo === decision.target) ? 'manager' : 'peer';
              enrichedSave += ' (spoke to ' + decision.target + ', my ' + rel + ')';
            }
          }
          this.saveMemory(npcName, enrichedSave);
        }

        // Record relationship interaction for social graph tracking
        if (decision.target && typeof decision.target === 'string') {
          this._recordRelationship(npcName, decision.target);
        }

        // Auto-update goal progress when a task finishes successfully
        if (decision.taskPhase === 'finished' && this._npcGoals[npcName]) {
          this._npcGoals[npcName].progress = (this._npcGoals[npcName].progress || 0) + 1;
        }

        // Broadcast interesting decisions as office events
        if (decision.action === 'meeting' || (decision.outcome === 'success' && decision.taskPhase === 'finished')) {
          const kind = decision.action === 'meeting' ? 'meeting' : 'shipped';
          const text = decision.action === 'meeting'
            ? `${npcName} called a meeting${decision.target ? ' with ' + decision.target : ''}`
            : `${npcName} finished: ${(decision.save || decision.message || '').slice(0, 80)}`;
          this.broadcastEvent(kind, text);
        }
        if (decision.outcome === 'stuck' || decision.outcome === 'blocked') {
          this.broadcastEvent('blocker', `${npcName} is ${decision.outcome}: ${(decision.save || '').slice(0, 60)}`);
        }

        this._recordAssistantDecision(npcName, {
          action: decision.action,
          summary: decision.save || decision.message || decision.thought || '',
          outcome: decision.outcome || 'unknown',
        });

        // Cascade decisions from leaders to their reports
        decision._cascades = [];
        if (h && h.manages.length > 0 && (decision.action === 'talk' || decision.action === 'collaborate' || decision.action === 'meeting' || decision.action === 'report')) {
          decision._cascades = this._cascadeDecision(npcName, decision);
        }

        // If action is "report", ensure it has a target (the manager)
        if (decision.action === 'report' && !decision.target && h) {
          decision.target = h.reportsTo !== 'CEO' ? h.reportsTo : null;
        }

        // Mirror the decision into world-state so anyone asking "what is
        // Alex doing?" gets a fresh answer without round-tripping the LLM.
        // Position is left to agent-office-manager to update when sprites
        // actually move.
        if (worldState) {
          const summary = (decision.message || decision.thought || decision.action || '').toString().slice(0, 120);
          worldState.updateNpc(npcName, {
            state: decision.action || 'idle',
            lastAction: summary,
            currentTask: decision.taskPhase === 'finished' ? null : summary,
          });
          // Record this message so the self-repetition detector can flag
          // "you already asked the same thing 90s ago" on the next think.
          if (decision.message && typeof worldState.recordSelfMessage === 'function') {
            worldState.recordSelfMessage(npcName, decision.message);
          }
          // Record peer contact so the per-pair "last spoke" timer ticks
          // for both directions of the relationship.
          if (decision.target && typeof worldState.recordContact === 'function') {
            worldState.recordContact(npcName, decision.target);
          }
          // Record the exchange itself for the cross-NPC stuck-loop
          // detector. Catches "any updates?" ping-pong that neither NPC
          // can detect alone via self-repetition.
          if (decision.target && decision.message && typeof worldState.recordExchange === 'function') {
            worldState.recordExchange(npcName, decision.target, decision.message);
          }
        }

        // If the NPC chose to talk to a specific peer, also publish on the
        // agent-bus so the recipient sees the message directly on their next
        // think — no CTO brokering required.
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

        // Clean single-line log for this NPC's decision
        {
          const tok = this._lastTokens?.[npcName];
          const summary = decision.save || decision.message || decision.thought || '';
          log.npcAction({
            npcName,
            action:   decision.action || 'idle',
            target:   decision.target || null,
            summary,
            tokIn:    tok?.in,
            tokOut:   tok?.out,
            ms:       Date.now() - _thinkStart,
            artifact: decision._artifactPath || null,
          });
        }

        return decision;
      }
      // Fallback when the LLM returned nothing parseable. Pick a varied
      // role-flavored thought so 16 NPCs don't all say "Focusing on my
      // tasks" — that monoculture was visually identical to a stuck loop
      // and made the office feel scripted. Combines: role label, current
      // task (if any), a small jitter pool.
      return this._fallbackDecision(npcName, brain);
    } catch (err) {
      // Throttle: one log per NPC per 60s. Otherwise a provider outage spams
      // 16 NPCs * multiple retries/min = 200+ identical lines per minute.
      const now = Date.now();
      if (!this._lastThinkErrorLog) this._lastThinkErrorLog = {};
      if (now - (this._lastThinkErrorLog[npcName] || 0) > 60000) {
        log.npcError(npcName, String(err?.message ?? err).slice(0, 100));
        this._lastThinkErrorLog[npcName] = now;
      }
      return { action: 'error', thought: 'Something went wrong', message: err.message || 'API error — taking a break', target: null };
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
      return this._callLocal(config, systemPrompt, messages, opts);
    }
    return Promise.reject(new Error('Unknown provider type'));
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
      provider: providerType,
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

  _processQueue() {
    // Allow up to _maxInflight concurrent calls. LM Studio's server
    // Parallel setting controls how many actually run on the GPU at
    // once — we don't try to outpace it.
    while (this._inflightCount < this._maxInflight && this._requestQueue.length > 0) {
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
    const maxTokens = opts.maxTokens || 150;
    const sliceLen = opts.sliceLen || 150;

    // Telemetry hook — same shape as the remote providers use.
    const _tel = this._makeTelHook(config?.type || 'lmstudio', config, messages, opts);
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
              log.warn('LMStudio', 'model was unloaded — re-syncing...');
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
          const rawText = msg.content || msg.reasoning_content || '';
          const responseText = rawText.trim().slice(0, sliceLen);
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
    // 27B models can take 90–120s on first cold response — give plenty of room
    req.setTimeout(180000, () => {
      markFailure();
      const err = new Error('LM Studio timeout');
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
  async getPlayerResponse(npcName, message) {
    const brain = this.brains[npcName];
    if (!brain) return { text: `(${npcName} nods)`, delegation: null, actions: [] };

    const safeMessage = typeof message === 'string' ? message : String(message ?? '');
    const h = this._hierarchy[npcName];
    const rawMemory = brain.longTermMemory || '';
    const memorySection = rawMemory.length > 50
      ? `\n\n## Your Memories (what you remember from past days)\n${this._sanitize(rawMemory.slice(-1200))}`
      : '';

    const coworkerContext = this._getCoworkerContext(npcName, 'CEO');
    const assistantProfileBlock = this._assistantProfilePromptBlock(npcName);

    // Build role-specific action list
    const roleActions = this._getRoleActions(npcName, h);

    // Build chain-of-command context
    let chainOfCommand = '';
    if (h?.reportsTo === 'CEO') {
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
    const recentMem = this.memories[npcName] || [];
    const recentWork = recentMem.slice(-8).map(m => `${m.from}: "${m.text}"`).join('\n');
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
    const ceoMemories = rawMemory.split('\n')
      .filter(l => l.includes('CEO'))
      .slice(-5)
      .join('\n');
    const ceoHistorySection = ceoMemories
      ? `\n## Past CEO Conversations (what the CEO has told you before)\n${this._sanitize(ceoMemories)}`
      : '';

    const systemPrompt = `${brain.personality}${memorySection}${ceoHistorySection}
${currentTaskSection}
${teamStatus}

  ${assistantProfileBlock}

## Your Coworkers
${coworkerContext}

## Your Role & Position
You are ${npcName}, ${h?.title || brain.role}. The CEO (your ultimate boss) is talking to you directly.
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

## How to Respond to the CEO
1. Show your thinking briefly — what's your take on their request? (1 short sentence)
2. Give your actual response — be specific, reference what you're working on or what you know.
3. If the CEO gives an ORDER:
   - Acknowledge it clearly
   - Explain briefly HOW you'll do it
   - If you manage people, say WHO you'll assign it to and why they're the right person
   - Always include [ACTION:...] or [DELEGATE:...] tags
4. If just chatting/answering a question, no tags needed.
5. You can chain multiple actions: "On it! [ACTION:speakTo:Josh:CEO wants the homepage fixed] [DELEGATE:Josh:frontend task]"

## Rules
- Keep your spoken text under 200 characters. The CEO deserves detailed, thoughtful responses.
- Be natural, professional, and show you understand the company hierarchy.
- Reference your current work, past conversations, and team status when relevant.
- Respond in character as ${npcName}. Dialogue text first, then tags at the end.`;

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
    const matchedPattern = PC_USE_PATTERNS.find(re => re.test(safeMessage));
    let intentAnnotation = '';
    if (matchedPattern) {
      // Infer mode: explicit "in the background" → background; "show me", "let me watch", "on my screen" → visible; otherwise background.
      const wantsVisible = /\b(show\s+me|let\s+me\s+watch|on\s+my\s+screen|as\s+you)\b/i.test(safeMessage);
      const mode = wantsVisible ? 'visible' : 'background';
      intentAnnotation = ` [INTENT:pc_use:mode=${mode}]`;
    }

    // Add to memory (with intent tag if PC-use detected)
    this.memories[npcName].push({ from: 'CEO', text: this._sanitize(safeMessage) + intentAnnotation });
    if (this.memories[npcName].length > 50) {
      this.memories[npcName] = this.memories[npcName].slice(-50);
    }

    const messages = this.memories[npcName].map(m => ({
      role: m.from === npcName ? 'assistant' : 'user',
      content: m.from === npcName ? m.text : `${m.from} says: "${m.text}"`,
    }));

    // Use higher token limits for CEO conversations — they deserve detailed responses
    // Mark player-chat as high-priority so it jumps the LM Studio queue.
    // With 16 NPCs autonomously thinking, the FIFO queue is almost always
    // backed up; without this, player messages queue behind 5-10 jobs
    // and reliably time out at the 15s client timeout.
    const playerOpts = { maxTokens: 300, sliceLen: 500, priority: 'high', npc: npcName, kind: 'chat' };

    let responseText;
    try {
      responseText = await this._callProvider(brain.providerConfig, systemPrompt, messages, playerOpts);
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
      if (brain.fallbackConfig && brain.fallbackConfig !== brain.providerConfig) {
        try {
          responseText = await this._callProvider(brain.fallbackConfig, systemPrompt, messages, playerOpts);
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
    // Remove action tags from displayed text
    responseText = responseText.replace(/\s*\[ACTION:[^\]]+\]/g, '').trim();

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
    this.memories[npcName].push({ from: npcName, text: this._sanitize(responseText) });

    this._recordAssistantDecision(npcName, {
      action: actions.length > 0 ? actions[0].action : (delegation ? 'delegate' : 'chat'),
      summary: responseText,
      outcome: delegation ? 'delegated' : 'ok',
    });

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
NpcBrainManager.DECISION_SCHEMA = {
  type: 'object',
  properties: {
    reasoning:  { type: 'string', description: 'Brief why behind the choice' },
    thought:    { type: 'string', description: 'Short thought-bubble text' },
    action:     { type: 'string', enum: ['talk','collaborate','report','work','break','coffee','check','read','visit','wander','meeting','delegate','run_skill','idle'] },
    target:     { type: ['string','null'], description: 'Coworker name, if any' },
    location:   { type: ['string','null'], description: 'breakroom|conference|storage|manager_office|reception|open_office|desk' },
    message:    { type: 'string', description: 'What you say or do' },
    taskPhase:  { type: ['string','null'], enum: ['starting','continuing','finished','none',null] },
    save:       { type: ['string','null'], description: 'A memory to persist' },
    outcome:    { type: ['string','null'] },
    skill:      { type: ['string','null'], description: 'OpenClaw skill name when action=run_skill' },
    skillParams:{ type: ['object','null'] },
  },
  required: ['action'],
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
