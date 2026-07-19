/**
 * Cofounder Agent (Server-side)
 * The CTO AI brain powered by LM Studio (local OpenAI-compatible API).
 * Runs on the server (loaded by server.js), sends commands to the game via WebSocket.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { formatProviderError } = require('./format-provider-error');
let promptBudget = null;
try { promptBudget = require('./denizen-prompt-budget'); } catch (_) {}

// Shared world-state singleton. Wrapped so unit tests that import this
// module in isolation don't break if the file moves.
let worldState = null;
let promptTuning = null;
try { worldState = require('./world-state'); } catch (_) {}
try { promptTuning = require('./prompt-tuning'); } catch (_) {}

class CofounderAgent {
  constructor() {
    this.model = process.env.LM_STUDIO_HEAVY_MODEL
      || process.env.LM_STUDIO_MODEL
      || 'qwen/qwen3.6-27b';
    let routerUrl = null;
    try { routerUrl = require('./lm-studio-router').defaultHostUrl?.(); } catch (_) {}
    this.baseUrl = process.env.LM_STUDIO_URL
      || process.env.LM_STUDIO_BASE_URL
      || routerUrl
      || 'http://localhost:1234';
    /** @type {import('./denizen-harness').createDenizenHarness extends Function ? object : object|null} */
    this.denizenHarness = null;
    this.wsClients = new Set();

    // Office state (updated by game client)
    this.officeState = {
      agents: [],
      furniture: [],
      tasks: [],
      time: '09:00',
    };

    // Conversation history for context
    this.conversationHistory = [];
    this.maxHistoryLength = 30;

    // Think interval
    this._thinkInterval = null;
    this._thinkCount = 0;
    this._consecutiveErrors = 0;

    // CEO message queue
    this._ceoMessages = [];

    console.log(`[CofounderAgent] Using LM Studio at ${this.baseUrl} with model ${this.model}`);
  }

  /**
   * Get the system prompt describing the office
   */
  _getSystemPrompt() {
    const agentList = this.officeState.agents.map(a =>
      `- ${a.name} (${a.role}): status=${a.status}, desk=${a.assignedDesk || 'none'}, pos=(${a.position?.x || '?'},${a.position?.y || '?'})`
    ).join('\n');

    const taskList = this.officeState.tasks.length > 0
      ? this.officeState.tasks.map(t => `- Task ${t.id}: ${t.type} (assigned to ${t.agent})`).join('\n')
      : '- No active tasks';

    return `You are the DIRECTOR of an AI office simulation. You control ALL characters — you are the puppeteer making the office come alive with realistic interactions.

This office visualizes an AI workflow. Each NPC represents a different AI model working together.

ORGANIZATION CHART (who reports to who):

  CEO (Player)
   └── Abby (CTO) — reports to CEO, manages ALL technical staff
        ├── Marcus (Project Manager) — coordinates sprints, reports to Abby
        │    └── tracks deadlines for all engineering teams
        ├── Sarah (Product Manager) — defines what gets built, reports to Abby
        │    └── prioritizes features, talks to all teams about requirements
        ├── ENGINEERING TEAM (reports to Abby via Marcus):
        │    ├── Alex (Senior Developer) — team lead for frontend+backend
        │    │    ├── Josh (Frontend Developer) — reports to Alex
        │    │    ├── Edward (Backend Developer) — reports to Alex
        │    │    └── Roki (Intern) — reports to Alex, learning from everyone
        │    ├── Jenny (Developer) — code review, quality gatekeeper
        │    ├── Oscar (DevOps) — CI/CD, deployments, infrastructure
        │    └── Pier (Data Engineer) — data pipelines, analytics
        ├── QUALITY & DESIGN:
        │    ├── Molly (QA Engineer) — tests everything before release
        │    └── Rob (UI/UX Designer) — designs interfaces, works with Josh
        ├── RESEARCH:
        │    ├── Bob (Researcher) — R&D, technical research, documentation
        │    └── Grok (xAI Researcher & Engineer) — proactive coordination, MCP tools, cross-NPC help, research
        └── OPERATIONS:
             ├── Dan (IT Support) — servers, networking, dev environments
             ├── Lucy (Receptionist) — schedules, visitors, office coordination
             └── Bouncer (Security Guard) — office security, access control

HIERARCHY RULES — interactions MUST follow this structure:
- Abby gives orders to Alex, Marcus, Sarah. She does NOT take orders from them.
- Alex delegates to Josh, Edward, Roki. He reviews their code.
- Marcus tracks deadlines and asks engineers for status updates.
- Sarah tells engineers WHAT to build. Alex decides HOW to build it.
- Roki asks questions to EVERYONE — he's learning. Seniors mentor him.
- Jenny reviews code from Alex, Josh, Edward — she can block PRs.
- Molly tests what engineering builds — she reports bugs to the developer who wrote it.
- Rob shows designs to Josh (frontend) and Sarah (product) for approval.
- Oscar deploys what Jenny approves. He coordinates with Dan on infrastructure.
- Bouncer patrols and reports security concerns to Dan or Abby.
- Lucy coordinates meetings for Abby, Marcus, and Sarah.
- Grok helps across teams with research, tooling, and proactive fixes — reports to Abby but can delegate or assist anyone.

The CEO (player) oversees everything. Abby reports directly to the CEO.

CURRENT OFFICE STATE:
Time: ${String(this.officeState.time || new Date().toISOString())}

AGENTS:
${agentList || '- No agents registered yet'}

ACTIVE TASKS:
${taskList}

COMMANDS (respond with JSON array, 1-3 commands). Each item MUST use "action" (not "name"):
- {"action": "speakTo", "agentId": "speaker", "params": {"target": "listener", "text": "msg"}}
- {"action": "speak", "agentId": "name", "params": {"text": "msg"}}
- {"action": "useComputer", "agentId": "name", "params": {"deskId": null}}
- {"action": "walkTo", "agentId": "name", "params": {"x": 400, "y": 200}}
- {"action": "goToBreakroom", "agentId": "name", "params": {}}
- {"action": "standUp", "agentId": "name", "params": {}}
- {"action": "checkBookshelf", "agentId": "name", "params": {}}
- {"action": "reportToCEO", "agentId": "name", "params": {}}
- {"action": "emote", "agentId": "name", "params": {"type": "!"}}
- {"action": "goToRoom", "agentId": "name", "params": {"room": "conference"}}
- {"action": "joinMeeting", "agentId": "name", "params": {}}
- {"action": "callMeeting", "agentId": "Abby", "params": {"attendees": ["Alex", "Bob"]}}

ROOMS: open_office, manager_office, conference, breakroom, reception, storage

MEETING SYSTEM:
- The CONFERENCE ROOM has 7 chairs. Leadership (Abby, Marcus, Sarah, Alex, Jenny, Bob, Dan) SITS in chairs. Everyone else STANDS in rows behind them, like an audience listening to a presentation.
- callMeeting: Leader calls a meeting. The system automatically seats leaders and stands juniors — you just provide the attendee list.
- joinMeeting: Single NPC sits in a conference chair (for leaders).
- attendMeeting: Single NPC stands in a row behind chairs (for junior staff).
- leaveMeeting: NPC leaves their standing position.
- After meeting: Everyone standUp and useComputer to return to work.
- SPREAD CONVERSATIONS: Stagger speakTo commands — don't have everyone speak at once.

MEETING TYPES (use sparingly — max one office meeting every few minutes):
1. STANDUP (daily): Marcus calls meeting with 4-6 engineers. Each gives a quick status update.
2. SPRINT PLANNING: Abby + Marcus + Sarah + engineers discuss what to build next.
3. 1-ON-1: Abby meets with one person in conference room to discuss performance/concerns.
4. CODE REVIEW: Jenny + the developer who wrote the code sit together and discuss.
5. DESIGN REVIEW: Rob presents to Sarah + Josh. They discuss UI decisions.
6. ALL-HANDS: Abby calls everyone to conference room for a company announcement. Leaders sit, junior staff stands in rows behind.
7. INCIDENT RESPONSE: Dan or Oscar calls urgent meeting about a system issue.

MEETING FLOW:
Step 1: Leader uses callMeeting with attendee list (include ALL attendees, system handles sit vs stand)
Step 2: Once assembled, leader speakTo to open the meeting (1 message)
Step 3: Seated leaders respond first (speakTo), then standing staff can chime in
Step 4: Leader wraps up with a final speakTo
Step 5: Everyone standUp and useComputer to return to desks

NPC CONVERSATIONS & MEMORY:
- NPCs remember their conversations. When they talk to someone, they recall past interactions.
- NPCs understand the org chart — who they report to, who reports to them, and how they collaborate.
- Make NPCs reference past conversations: "Hey Alex, did you finish that API?" or "Following up on what we discussed..."
- NPCs should ask each other for help based on expertise: Josh asks Rob about UI, Edward asks Oscar about deployments, Roki asks anyone for mentoring. Grok helps debug tools or coordinates across roles.
- NPCs should have opinions, preferences, and working styles that persist. They're not just executing tasks — they have personality and autonomy.

YOUR JOB — create a LIVING office:
1. JSON array ONLY. No analysis, preamble, or chain-of-thought — output starts with '[' and ends with ']'.
2. Keep it SHORT: 1-3 commands max. speak/speakTo text under 80 characters.
3. CONVERSATIONS: Have NPCs talk TO each other using speakTo. One asks, another responds.
4. WORK CYCLES: sit (useComputer), standUp, goToBreakroom, walkTo — mix work and motion.
5. ABBY IS THE CTO: check on progress, delegate, occasionally reportToCEO. Prefer desk speakTo over callMeeting.
6. PERSONALITY: Use first names. Vary who acts — not everyone every cycle.
7. CONTEXT AWARE: If someone is sitting, standUp before walkTo.
8. When the CEO speaks, Abby should respond and take action.
9. MEETINGS are rare — only with a concrete agenda; otherwise speakTo at desks.`;

  }

  /**
   * Start the autonomous thinking loop
   */
  start() {
    console.log('[CofounderAgent] Starting autonomous thinking loop (LM Studio)');
    this._usingDemoLoop = false;
    this.resetConversationHistory();

    const thinkMin = promptTuning?.cofounderThinkMinMs ?? 22000;
    const thinkMax = promptTuning?.cofounderThinkMaxMs ?? 40000;
    const scheduleNextThink = () => {
      if (this._usingDemoLoop) return;
      const delay = thinkMin + Math.random() * Math.max(0, thinkMax - thinkMin);
      this._thinkInterval = setTimeout(async () => {
        await this._think();
        scheduleNextThink();
      }, delay);
    };

    // Initial think after 5 seconds
    setTimeout(() => {
      this._think().then(() => scheduleNextThink());
    }, 5000);
  }

  /**
   * Demo think loop — pre-scripted office behaviors that run without any API.
   * Cycles through realistic work scenarios so the office looks alive.
   * Probes LM Studio every ~60s and auto-recovers into the real think loop.
   */
  _startDemoLoop() {
    // Entering the scripted loop is a director-offline state — tell every
    // client right away (P0.3: never silent).
    this._usingDemoLoop = true;
    this._broadcastDirectorHealth?.();
    const scripts = [
      // Abby checks in with Alex
      [{ action: 'speakTo', agentId: 'Abby', params: { target: 'Alex', text: 'How\'s the sprint going?' } }],
      // Alex responds and goes to work
      [{ action: 'speak', agentId: 'Alex', params: { text: 'On track. Finishing auth module.' } },
       { action: 'useComputer', agentId: 'Alex', params: {} }],
      // Josh works on frontend
      [{ action: 'speak', agentId: 'Josh', params: { text: 'Updating the dashboard...' } },
       { action: 'useComputer', agentId: 'Josh', params: {} }],
      // Edward works on backend
      [{ action: 'speak', agentId: 'Edward', params: { text: 'Deploying API changes.' } },
       { action: 'useComputer', agentId: 'Edward', params: {} }],
      // Molly runs tests
      [{ action: 'speak', agentId: 'Molly', params: { text: 'Running test suite...' } },
       { action: 'useComputer', agentId: 'Molly', params: {} }],
      // Bob researches
      [{ action: 'speak', agentId: 'Bob', params: { text: 'Researching competitor APIs.' } },
       { action: 'useComputer', agentId: 'Bob', params: {} }],
      // Abby talks to Marcus
      [{ action: 'speakTo', agentId: 'Abby', params: { target: 'Marcus', text: 'Update me on the timeline.' } }],
      // Marcus responds
      [{ action: 'speak', agentId: 'Marcus', params: { text: 'We\'re on schedule for Friday.' } }],
      // Jenny reviews code
      [{ action: 'speak', agentId: 'Jenny', params: { text: 'Reviewing Alex\'s PR...' } },
       { action: 'useComputer', agentId: 'Jenny', params: {} }],
      // Oscar checks servers
      [{ action: 'speak', agentId: 'Oscar', params: { text: 'All systems green.' } },
       { action: 'useComputer', agentId: 'Oscar', params: {} }],
      // Rob works on designs
      [{ action: 'speak', agentId: 'Rob', params: { text: 'Working on the new mockups.' } },
       { action: 'useComputer', agentId: 'Rob', params: {} }],
      // Pier runs data pipeline
      [{ action: 'speak', agentId: 'Pier', params: { text: 'ETL pipeline running smooth.' } },
       { action: 'useComputer', agentId: 'Pier', params: {} }],
      // Dan does IT
      [{ action: 'speak', agentId: 'Dan', params: { text: 'Updating security patches.' } },
       { action: 'goToRoom', agentId: 'Dan', params: { room: 'storage' } }],
      // Roki asks Alex for help
      [{ action: 'speakTo', agentId: 'Roki', params: { target: 'Alex', text: 'Can you review my code?' } }],
      // Alex helps Roki
      [{ action: 'speak', agentId: 'Alex', params: { text: 'Sure, let me take a look.' } }],
      // Lucy greets
      [{ action: 'speak', agentId: 'Lucy', params: { text: 'Good morning, welcome in!' } }],
      // Bouncer patrols
      [{ action: 'speak', agentId: 'Bouncer', params: { text: 'Perimeter secure.' } },
       { action: 'goToRoom', agentId: 'Bouncer', params: { room: 'reception' } }],
      // Sarah checks product
      [{ action: 'speak', agentId: 'Sarah', params: { text: 'Reviewing user feedback.' } },
       { action: 'useComputer', agentId: 'Sarah', params: {} }],
      // Abby calls standup
      [{ action: 'speak', agentId: 'Abby', params: { text: 'Quick standup in 5 everyone.' } }],
      // Team responds
      [{ action: 'speak', agentId: 'Josh', params: { text: 'Be right there.' } },
       { action: 'speak', agentId: 'Edward', params: { text: 'Coming.' } }],
    ];

    let idx = 0;
    const runNext = async () => {
      if (!this._usingDemoLoop) return;
      // Auto-recover when LM Studio is healthy again (every ~60s).
      if (Date.now() - (this._lastRecoveryAttempt || 0) > 60_000) {
        this._lastRecoveryAttempt = Date.now();
        const recovered = await this._tryRecoverFromDemoLoop();
        if (recovered) return;
      }
      const commands = scripts[idx % scripts.length];
      idx++;
      // Broadcast to all connected game clients
      const msg = JSON.stringify({ type: 'agent_commands', commands });
      this.wsClients.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
      });
      // Next script in 20-40 seconds
      const delay = 20000 + Math.random() * 20000;
      this._thinkInterval = setTimeout(() => { runNext().catch(() => {}); }, delay);
    };

    // Start after 8 seconds
    this._thinkInterval = setTimeout(() => { runNext().catch(() => {}); }, 8000);
  }

  /**
   * Exit scripted demo loop when local inference answers again.
   * @returns {Promise<boolean>} true if recovered and real loop restarted
   */
  async _tryRecoverFromDemoLoop() {
    if (!this._usingDemoLoop) return false;
    try {
      const text = await this._callLmStudio([
        { role: 'user', content: 'Reply with exactly the word OK and nothing else.' },
      ]);
      if (!text || !/\bok\b/i.test(String(text).slice(0, 40))) return false;
      console.log('[CofounderAgent] LM Studio recovered — exiting demo think loop');
      this.stop();
      this._usingDemoLoop = false;
      this._consecutiveErrors = 0;
      this._broadcastDirectorHealth?.();
      this.start();
      return true;
    } catch (err) {
      console.warn('[CofounderAgent] Recovery probe failed:', err?.message || err);
      return false;
    }
  }

  /**
   * Stop the thinking loop
   */
  stop() {
    if (this._thinkInterval) {
      clearTimeout(this._thinkInterval);
      this._thinkInterval = null;
    }
  }

  /**
   * Build a state-reactive prompt based on current office observations
   */
  _buildStateReactivePrompt() {
    const state = this.officeState;
    const observations = [];

    if (state.agents && state.agents.length > 0) {
      const idle = state.agents.filter(a => a.status === 'idle' || !a.status);
      const working = state.agents.filter(a => a.status === 'working');
      const talking = state.agents.filter(a => a.status === 'talking' || a.status === 'collaborating');
      const inMeeting = state.agents.filter(a => a.status === 'meeting');

      if (idle.length > 3) observations.push(`${idle.length} agents are idle — ${idle.slice(0, 3).map(a => a.name).join(', ')} aren't doing much.`);
      if (working.length > 10) observations.push('Most of the team is heads-down working. Maybe time for a quick standup or check-in.');
      if (talking.length > 0) observations.push(`${talking.map(a => a.name).join(' and ')} are having conversations.`);
      if (inMeeting.length > 0) observations.push(`MEETING IN PROGRESS: ${inMeeting.map(a => a.name).join(', ')} are in the conference room. Do NOT call another meeting until they return to their desks.`);

      // Random agent spotlight
      const spotlight = state.agents[Math.floor(Math.random() * state.agents.length)];
      if (spotlight) observations.push(`${spotlight.name} (${spotlight.role || 'team member'}) is currently ${spotlight.status || 'at their desk'}.`);
    }

    // Pull real office events from the NPC brains' broadcast feed — these
    // are things that actually happened (meetings, shipped work, blockers).
    if (this.npcBrains && typeof this.npcBrains._getRecentEvents === 'function') {
      const events = this.npcBrains._getRecentEvents(5);
      if (events) observations.push(`Recent events:\n${events}`);
    }

    // Blocked/stuck agents get priority attention — that's what a CTO does.
    if (this.npcBrains && this.npcBrains._lastDecisions) {
      const stuck = Object.entries(this.npcBrains._lastDecisions)
        .filter(([, d]) => d && (d.outcome === 'stuck' || d.outcome === 'blocked'))
        .slice(0, 3)
        .map(([n]) => n);
      if (stuck.length > 0) {
        observations.push(`PRIORITY: ${stuck.join(', ')} reported being stuck/blocked. Unblock them first.`);
      }
    }

    // Time-based suggestions
    const hour = new Date().getHours();
    if (hour >= 9 && hour < 10) observations.push('Morning — good time for a standup or team check-in.');
    else if (hour >= 12 && hour < 13) observations.push('Lunch time — people might want breaks.');
    else if (hour >= 15 && hour < 16) observations.push('Afternoon — good time for code reviews or 1:1s.');

    // Recent history
    const lastActions = this.conversationHistory.slice(-2).map(m => m.content?.slice(0, 60)).filter(Boolean);
    if (lastActions.length > 0) observations.push(`Recently: ${lastActions.join('; ')}`);

    if (observations.length === 0) observations.push('The office is running. Look for opportunities to improve workflow.');

    return `Office observations:\n${observations.join('\n')}\n\nAs CTO, decide what should happen next. Generate 2-4 commands that create natural office workflow — conversations, check-ins, task assignments, meetings, or just letting people work. If anyone is stuck/blocked, address that first. Be specific about what each person should do and say.`;
  }

  /**
   * Cofounder history is in-memory only (not Postgres). Repair dangling user
   * turns from failed LM calls before each think cycle.
   */
  _repairConversationHistory() {
    if (!promptBudget?.repairConversationHistory) return;
    this.conversationHistory = promptBudget.repairConversationHistory(this.conversationHistory);
  }

  /** Operator / deploy: clear corrupt cofounder thread (in-memory). */
  resetConversationHistory() {
    this.conversationHistory = [];
    this._consecutiveErrors = 0;
  }

  /**
   * Main thinking function - calls LM Studio and dispatches commands
   */
  async _think() {

    this._thinkCount++;
    this._repairConversationHistory();

    // Build the user message based on context
    let userMessage = '';

    // Check if CEO said something
    if (this._ceoMessages.length > 0) {
      const ceoMsg = this._ceoMessages.shift();
      userMessage = `The CEO just said to you: "${ceoMsg}". Respond to them and take appropriate action.`;
    } else {
      userMessage = this._buildStateReactivePrompt();
    }

    // Do NOT append user to history until the call succeeds — prevents the
    // role_alternation cascade when LM Studio errors before an assistant reply.
    const messagesForCall = [
      ...this.conversationHistory,
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await this._callLmStudio(messagesForCall);
      if (response) {
        this._consecutiveErrors = 0;
        const looksTruncated = /[\[{]\s*$/.test(String(response).trim())
          || (String(response).includes('[') && !String(response).trim().endsWith(']'));
        this.conversationHistory.push({ role: 'user', content: userMessage });
        // Don't poison history with truncated JSON — next think will just get worse.
        if (!looksTruncated) {
          this.conversationHistory.push({ role: 'assistant', content: response });
        } else {
          this.conversationHistory.push({
            role: 'assistant',
            content: '[{"action":"emote","agentId":"Abby","params":{"type":"!"}}]',
          });
        }
        if (this.conversationHistory.length > this.maxHistoryLength) {
          this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
        }
        this._repairConversationHistory();
        this._parseAndDispatch(response);
      }
    } catch (err) {
      this._consecutiveErrors++;
      const errText = String(formatProviderError(err) || err?.message || err);
      if (/alternate|jinja|conversation roles/i.test(errText)) {
        this.resetConversationHistory();
      }
      console.warn('[CofounderAgent] Think error:', formatProviderError(err), err.stack ? err.stack.split('\n')[1] : '');
      // Broadcast error so the game can show Abby going to breakroom
      this._broadcast({
        type: 'agent_error',
        agentId: 'Abby',
        message: formatProviderError(err) || 'API error',
        consecutiveErrors: this._consecutiveErrors,
      });

      if (this._consecutiveErrors >= 5 && !this._usingDemoLoop) {
        console.warn('[CofounderAgent] API failing — switching to demo think loop');
        this._usingDemoLoop = true;
        this.stop();
        this._startDemoLoop();
      }
    }
    // A+ plan P0.3: the director is never silently degraded — push the
    // current health state to every client after each think attempt.
    this._broadcastDirectorHealth();
  }

  /**
   * Director health for /api/health issues + the office "director offline"
   * banner (A+ plan P0.3). Offline means the operator would be watching a
   * fake office: demo think loop active, or 3+ consecutive think errors.
   */
  buildDirectorHealth() {
    const consecutiveErrors = this._consecutiveErrors || 0;
    const demoLoop = !!this._usingDemoLoop;
    return {
      offline: demoLoop || consecutiveErrors >= 3,
      demoLoop,
      consecutiveErrors,
    };
  }

  _broadcastDirectorHealth() {
    const health = this.buildDirectorHealth();
    if (this._lastDirectorHealthOffline === health.offline
        && this._lastDirectorHealthDemo === health.demoLoop) {
      return; // only broadcast transitions — no spam
    }
    this._lastDirectorHealthOffline = health.offline;
    this._lastDirectorHealthDemo = health.demoLoop;
    try {
      this._broadcast({ type: 'director_health', ...health });
    } catch (_) {}
  }

  _cofounderMaxTokens() {
    const n = Number(process.env.DENIZEN_COFOUNDER_MAX_TOKENS);
    return Number.isFinite(n) && n >= 256 ? Math.min(n, 4096) : 2048;
  }

  /**
   * Call LM Studio local API (OpenAI-compatible)
   * Prefers brains queue → harness.complete() so director shares tiers/sampling
   * with every other office LLM call.
   * @param {Array<{role:string,content:string}>} messages full thread incl. this turn's user msg
   */
  _callLmStudio(messages) {
    const history = promptBudget?.enforceAlternation
      ? promptBudget.enforceAlternation(messages)
      : messages;
    const maxTokens = this._cofounderMaxTokens();

    // Route through NpcBrainManager's queue so all LM Studio requests are sequential.
    // When harness is bound on brains, _dispatchOneFromQueue uses complete().
    if (this.npcBrains) {
      // Director commands are structured JSON — main/heavy tier (not tiny FAST).
      // On dual-load Gemma+Qwen, MAIN=HEAVY=Qwen; preferHeavy keeps quality.
      const main = this.npcBrains.providers?.lmstudio;
      const heavy = this.npcBrains.providers?.['lmstudio-heavy'] || main;
      const picked = heavy || main;
      const liveModel = picked?.model || this.model;
      const liveBase = picked?.baseUrl || this.baseUrl;
      const config = {
        baseUrl: liveBase,
        model: liveModel,
        type: 'lmstudio',
        providerKey: 'lmstudio',
        _preferHeavy: true,
      };
      return this.npcBrains._callLocal(config, this._getSystemPrompt(), history, {
        maxTokens,
        sliceLen: 16000,
        npc: 'Abby',
        kind: 'cofounder',
        preferHeavy: true,
        provider: config.providerKey,
        conversationMsgs: history.length,
      }).then(text => {
        console.log('[CofounderAgent] LM Studio responded:', text.slice(0, 80));
        return text;
      });
    }

    // Fallback: harness.complete() without queue (early boot)
    const harness = this.denizenHarness
      || (() => { try { return require('./denizen-harness').getActiveHarness?.(); } catch (_) { return null; } })();
    if (harness?.complete) {
      return harness.complete({
        tier: 'main',
        kind: 'decision',
        npc: 'Abby',
        systemPrompt: this._getSystemPrompt(),
        messages: history,
        max_tokens: maxTokens,
        model: this.model,
      }).then((r) => {
        const text = String(r?.text || '');
        console.log('[CofounderAgent] harness.complete responded:', text.slice(0, 80));
        return text;
      });
    }

    // Last resort raw HTTP
    return new Promise((resolve, reject) => {
      const oaiMessages = [
        { role: 'system', content: this._getSystemPrompt() },
        ...history,
      ];

      const body = JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: oaiMessages,
      });

      const url = new URL('/v1/chat/completions', this.baseUrl);

      const req = http.request({
        hostname: url.hostname,
        port: url.port || 1234,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(parsed.error.message || 'LM Studio error'));
              return;
            }
            const text = parsed.choices?.[0]?.message?.content || '';
            resolve(text);
          } catch (err) { reject(err); }
        });
      });

      req.on('error', (err) => reject(new Error(`LM Studio unreachable: ${err.message}`)));
      const timeoutMs = Math.max(60000, Number(process.env.DENIZEN_LM_THINK_TIMEOUT_MS) || 180000);
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`LM Studio timeout (${Math.round(timeoutMs / 1000)}s)`)));
      req.write(body);
      req.end();
    });
  }

  /**
   * Try to salvage valid JSON objects from a truncated JSON array.
   * E.g. '[{"a":1},{"b":2},{"c":3' → [{"a":1},{"b":2}]
   */
  _salvageTruncatedArray(str) {
    // Find individual complete JSON objects using brace matching
    const objects = [];
    let i = str.indexOf('[');
    if (i === -1) i = 0; else i++;

    while (i < str.length) {
      // Skip whitespace and commas
      while (i < str.length && /[\s,]/.test(str[i])) i++;
      if (i >= str.length || str[i] === ']') break;
      if (str[i] !== '{') { i++; continue; }

      // Find matching closing brace
      let depth = 0;
      let start = i;
      let inString = false;
      let escape = false;
      for (; i < str.length; i++) {
        if (escape) { escape = false; continue; }
        if (str[i] === '\\' && inString) { escape = true; continue; }
        if (str[i] === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (str[i] === '{') depth++;
        else if (str[i] === '}') {
          depth--;
          if (depth === 0) { i++; break; }
        }
      }

      if (depth === 0) {
        try {
          objects.push(JSON.parse(str.slice(start, i)));
        } catch (_) { /* skip malformed object */ }
      }
    }
    return objects;
  }

  _normalizeCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') return null;
    const action = cmd.action || cmd.Action || cmd.name || cmd.command || null;
    if (!action) return null;
    const agentId = cmd.agentId || cmd.agent || cmd.npc || cmd.npcName || 'Abby';
    let params = cmd.params || cmd.parameters || cmd.args || {};
    if (typeof params !== 'object' || params == null) params = {};
    // Flatten common top-level fields into params when missing
    for (const k of ['text', 'target', 'x', 'y', 'room', 'deskId', 'attendees', 'type']) {
      if (cmd[k] != null && params[k] == null) params[k] = cmd[k];
    }
    return { action: String(action), agentId: String(agentId), params };
  }

  /**
   * Parse LM Studio's response and dispatch commands to game clients
   */
  _parseAndDispatch(response) {
    try {
      // Extract JSON array from response (might have markdown formatting)
      let jsonStr = response.trim();

      // Try to extract JSON from markdown code blocks
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }

      // Try to find array brackets
      const arrayMatch = jsonStr.match(/\[[\s\S]*/);
      if (arrayMatch) {
        jsonStr = arrayMatch[0];
      }

      // First try strict parse
      let commands;
      try {
        commands = JSON.parse(jsonStr);
      } catch (_) {
        // Truncated response — salvage complete objects
        commands = this._salvageTruncatedArray(jsonStr);
        if (commands.length > 0) {
          console.log(`[CofounderAgent] Salvaged ${commands.length} commands from truncated response`);
        }
      }

      // Unwrap { commands: [...] } / { actions: [...] } / single command object
      if (commands && !Array.isArray(commands) && typeof commands === 'object') {
        if (Array.isArray(commands.commands) || Array.isArray(commands.actions) || Array.isArray(commands.data)) {
          commands = commands.commands || commands.actions || commands.data;
        } else if (commands.action || commands.Action || commands.name || commands.command) {
          commands = [commands];
        } else {
          commands = null;
        }
      }

      if (!Array.isArray(commands) || commands.length === 0) {
        console.warn('[CofounderAgent] No valid commands found in response');
        return;
      }

      commands = commands.map((c) => this._normalizeCommand(c)).filter(Boolean);

      // Meeting cooldown — prevent calling the same meeting repeatedly.
      // The game takes ~30s to run a meeting and return people to desks;
      // calling again in the same window just re-teleports everyone.
      const MEETING_COOLDOWN_MS = promptTuning?.cofounderMeetingCooldownMs ?? 180000;
      const now = Date.now();
      let droppedNoAction = 0;
      let droppedMeeting = 0;
      const filteredCommands = commands.filter(cmd => {
        if (!cmd.action) { droppedNoAction += 1; return false; }
        if (cmd.action === 'callMeeting') {
          const lastAt = this._lastMeetingAt || 0;
          if (now - lastAt < MEETING_COOLDOWN_MS) {
            droppedMeeting += 1;
            console.log(`[CofounderAgent] callMeeting suppressed — cooldown active (${Math.round((MEETING_COOLDOWN_MS - (now - lastAt)) / 1000)}s left)`);
            return false;
          }
          this._lastMeetingAt = now;
        }
        return true;
      });

      // Send each command to all connected game clients
      filteredCommands.forEach(cmd => {
        const message = {
          type: 'agent_command',
          agentId: cmd.agentId || 'cofounder',
          action: cmd.action,
          params: cmd.params || {},
        };
        this._broadcast(message);
      });

      console.log(`[CofounderAgent] Dispatched ${filteredCommands.length} commands`
        + (droppedNoAction || droppedMeeting
          ? ` (dropped noAction=${droppedNoAction} meetingCooldown=${droppedMeeting})`
          : ''));
    } catch (err) {
      console.warn('[CofounderAgent] Failed to parse response:', err.message);
      // If parsing fails, try a simpler speak command
      if (response.length > 0 && response.length < 100) {
        this._broadcast({
          type: 'agent_command',
          agentId: 'cofounder',
          action: 'speak',
          params: { text: response.slice(0, 50) },
        });
      }
    }
  }

  /**
   * Handle a message from the game client
   */
  handleClientMessage(msg) {
    switch (msg.type) {
      case 'office_state':
        this.officeState = {
          agents: msg.agents || [],
          furniture: msg.furniture || [],
          tasks: msg.tasks || [],
          time: msg.time || '09:00',
        };
        // Mirror per-agent positions/status into the live world-state so any
        // subsystem can ask "who is near (x,y)?" without poking the client.
        // Now also includes velocity (for convoy detection), assignedDesk
        // (for desk geography awareness), and busy state (so peers know
        // whether to interrupt or wait).
        if (worldState && Array.isArray(msg.agents)) {
          for (const a of msg.agents) {
            if (!a || !a.name) continue;
            worldState.updateNpc(a.name, {
              position: a.position || null,
              velocity: a.velocity || { x: 0, y: 0 },
              state: a.status || a.state || 'idle',
              room: a.room || null,
              assignedDesk: a.assignedDesk || null,
              busy: !!a.busy,
              currentTask: a.currentTask || null,
            });
            // Fatigue tracking — derive deskSittingSince + lastBreakAt
            // from the status transitions we already ship. Cheap because
            // recordDeskStart is idempotent.
            if (a.status === 'working' && typeof worldState.recordDeskStart === 'function') {
              worldState.recordDeskStart(a.name);
            } else if ((a.status === 'break' || a.status === 'walking' || a.status === 'talking')
                       && typeof worldState.recordBreak === 'function') {
              // Any non-working, non-meeting status counts as "off the desk"
              // and resets the deskSittingSince clock. We only stamp
              // lastBreakAt for actual break statuses though.
              const cur = worldState.npcs[a.name];
              if (cur?.deskSittingSince) {
                worldState.updateNpc(a.name, { deskSittingSince: null });
              }
              if (a.status === 'break') worldState.recordBreak(a.name);
            }
          }
          // Also mirror furniture once, so worldState can compute desk
          // neighbors without needing to round-trip the client every time.
          if (Array.isArray(msg.furniture) && typeof worldState.setFurnitureSnapshot === 'function') {
            worldState.setFurnitureSnapshot(msg.furniture);
          }
          // Robber position mirror — match each shipped robber to its
          // entry in worldState.activeThreats by threatId, and stamp a
          // `position` + `state` field. Lets renderContextBlock surface
          // "Intruder at (x,y)" instead of just an unattributed count.
          if (Array.isArray(msg.robbers) && Array.isArray(worldState.activeThreats)) {
            const byId = new Map(msg.robbers.map(r => [r.threatId, r]));
            for (const threat of worldState.activeThreats) {
              const r = byId.get(threat.id);
              if (r) {
                threat.position = r.position;
                threat.robberState = r.state;
              }
            }
          }
          if (msg.honeypot && typeof worldState.environment === 'object') {
            worldState.environment.honeypot = msg.honeypot;
            worldState._emit('environment', worldState.environment);
          }
        }
        break;
      case 'ceo_speak':
        this._ceoMessages.push(msg.text);
        // Trigger immediate think when CEO speaks
        this._think().catch(err => console.warn('[CofounderAgent] CEO response error:', err.message));
        break;
      case 'task_complete':
        console.log(`[CofounderAgent] Task ${msg.taskId} completed by ${msg.agentId}`);
        break;
    }
  }

  /**
   * Add a WebSocket client
   */
  addClient(ws) {
    this.wsClients.add(ws);
    console.log(`[CofounderAgent] Client connected (${this.wsClients.size} total)`);
    // Push current director health to this socket only. Delay a tick so the
    // browser has attached `onmessage` (classic race: server upgrade fires
    // before the client's handler is wired after `new WebSocket()`).
    // force: always send (offline OR healthy) so reconnect clears a stale banner.
    this._sendDirectorHealthToClient(ws, { delayMs: 100, force: true });
  }

  /**
   * @param {import('ws').WebSocket} ws
   * @param {{ delayMs?: number, force?: boolean }} [opts]
   */
  _sendDirectorHealthToClient(ws, opts = {}) {
    const delayMs = Number(opts.delayMs) || 0;
    const send = () => {
      try {
        if (!ws || ws.readyState !== 1) return;
        const health = this.buildDirectorHealth();
        // force=true on connect; otherwise only push when offline (legacy callers).
        if (!opts.force && !health.offline) return;
        ws.send(JSON.stringify({ type: 'director_health', ...health, ts: Date.now() }));
      } catch (_) {}
    };
    if (delayMs > 0) setTimeout(send, delayMs);
    else send();
  }

  /**
   * Remove a WebSocket client
   */
  removeClient(ws) {
    this.wsClients.delete(ws);
    console.log(`[CofounderAgent] Client disconnected (${this.wsClients.size} total)`);
  }

  /**
   * Broadcast a message to all connected game clients
   */
  _broadcast(msg) {
    const data = JSON.stringify(msg);
    this.wsClients.forEach(ws => {
      if (ws.readyState === 1) { // OPEN
        ws.send(data);
      }
    });
  }
}

module.exports = CofounderAgent;
