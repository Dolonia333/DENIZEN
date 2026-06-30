/**
 * Agent Office Manager
 * The browser-side brain that coordinates AI agents in the pixel office.
 * Connects to the server's /agent-ws WebSocket for cofounder agent commands.
 */

class AgentOfficeManager {
  /**
   * @param {Phaser.Scene} scene - The office scene
   * @param {AgentActions} actions - The action executor
   */
  constructor(scene, actions) {
    this.scene = scene;
    this.actions = actions;
    this.ws = null;
    this.connected = false;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this._officeConfig = null;
    this._tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._isThinkLeader = false;
    this._thinkLeaderTimer = null;
    this._loadOfficeConfig();

    // Agent registry: npcKey -> { role, name, status, currentTask, assignedDesk }
    this.agents = new Map();

    // Task queue
    this.tasks = [];
    this._taskIdCounter = 0;

    // Desk assignments: deskInstanceId -> npcKey
    this.deskAssignments = new Map();

    // State reporting interval
    this._stateReportInterval = null;

    // Role definitions
    this.ROLES = {
      desk_worker: { label: 'Developer', color: '#4ade80', idleArea: 'desk' },
      researcher: { label: 'Researcher', color: '#60a5fa', idleArea: 'bookshelf' },
      receptionist: { label: 'Receptionist', color: '#f472b6', idleArea: 'reception' },
      it_support: { label: 'IT Support', color: '#fbbf24', idleArea: 'roaming' },
      stock_trader: { label: 'Trader', color: '#a78bfa', idleArea: 'desk' },
      cofounder: { label: 'CTO', color: '#f97316', idleArea: 'roaming' },
      security: { label: 'Security', color: '#ef4444', idleArea: 'reception' },
      project_mgr: { label: 'Project Mgr', color: '#8b5cf6', idleArea: 'roaming' },
      product_mgr: { label: 'Product Mgr', color: '#ec4899', idleArea: 'roaming' },
      qa_engineer: { label: 'QA Engineer', color: '#14b8a6', idleArea: 'desk' },
      devops: { label: 'DevOps', color: '#f59e0b', idleArea: 'desk' },
      designer: { label: 'Designer', color: '#a855f7', idleArea: 'desk' },
      data_engineer: { label: 'Data Engineer', color: '#06b6d4', idleArea: 'desk' },
      intern: { label: 'Intern', color: '#84cc16', idleArea: 'roaming' },
    };

    // Status indicator dots and task labels
    this._statusDots = new Map(); // npcKey -> Phaser.GameObjects.Arc
    this._taskLabels = new Map(); // npcKey -> Phaser.GameObjects.Text

    // Proximity acknowledgment cooldowns
    this._npcLastAcknowledged = new Map();

    // Bouncer Kali/Zenmap — one full investigation per threat key per window
    this._bouncerInvestigationAt = new Map();
    this._bouncerInvestigationCooldownMs = 900000;
    this._honeypotActive = false;
    this._honeypotSpot = null;
    this._bouncerInvestigationShowTerminal = false;
    this._bouncerLinuxChatAt = new Map();
    this._incidentReportAt = new Map();
    this._bouncerStatusDedupAt = new Map();

    // Mood state per NPC
    this._moods = new Map();

    // NPC key to display name mapping (from shared roster)
    const roster = globalThis.DenizenNpcRoster;
    if (!roster) {
      console.error('[AgentManager] DenizenNpcRoster missing — load src/npc-roster.js before agent-office-manager.js');
    }
    this.NPC_NAMES = roster ? { ...roster.keyToDisplay } : {};
  }

  /**
   * Initialize the agent system
   */
  init() {
    console.log('[AgentManager] Initializing agent office system');

    // Default role assignments
    const defaultRoles = {
      xp_abby: 'cofounder',
      xp_alex: 'desk_worker',
      xp_bob: 'researcher',
      xp_dan: 'it_support',
      xp_jenny: 'desk_worker',
      xp_lucy: 'receptionist',
      xp_bouncer: 'security',
      xp_conference_man: 'project_mgr',
      xp_conference_woman: 'product_mgr',
      xp_edward: 'desk_worker',
      xp_josh: 'desk_worker',
      xp_molly: 'qa_engineer',
      xp_oscar: 'devops',
      xp_pier: 'data_engineer',
      xp_rob: 'designer',
      xp_roki: 'intern',
      xp_grok: 'researcher',
    };

    // Register agents with their roles
    Object.entries(defaultRoles).forEach(([npcKey, role]) => {
      this.registerAgent(npcKey, role);
    });

    // Assign desks to desk workers
    this._assignDesks();

    // Connect to server WebSocket
    window.__DenizenAgentManager = this;
    this.connect();
    this._bindRemoteReconnect();

    // Start periodic state reporting (every 10 seconds)
    this._stateReportInterval = this.scene.time.addEvent({
      delay: 10000,
      loop: true,
      callback: () => this._sendOfficeState(),
    });

    // Start initial agent behaviors after a short delay
    this.scene.time.delayedCall(2000, () => {
      this._startInitialBehaviors();
    });
  }

  /**
   * Register an NPC as an agent with a role
   */
  registerAgent(npcKey, role) {
    const name = this.NPC_NAMES[npcKey] || npcKey;
    const roleDef = this.ROLES[role] || this.ROLES.desk_worker;

    this.agents.set(npcKey, {
      npcKey,
      name,
      role,
      roleDef,
      status: 'idle',
      currentTask: null,
      assignedDesk: null,
      lastAction: Date.now(),
    });

    // Show role label
    this.actions.showRoleLabel(npcKey, name, roleDef.label);

    console.log(`[AgentManager] Registered ${name} as ${roleDef.label}`);
  }

  /**
   * Assign available desks to desk-based workers
   */
  _assignDesks() {
    if (!this.scene._interactables) return;

    // Find all desks that have a chair nearby (usable workstations)
    const allDesks = this.scene._interactables.filter(it =>
      it.id && /desk|cubicle/i.test(it.id) && it.def && it.def.type === 'surface'
    );

    // Filter to desks that actually have a chair within range
    const usableDesks = allDesks.filter(desk => {
      return this.actions._findChairNearDesk(desk, 80) !== null;
    });

    // Separate manager office desks from open office desks
    const managerDesks = usableDesks.filter(d => d.sprite.x >= 880 && d.sprite.y <= 240);
    const openDesks = usableDesks.filter(d => d.sprite.x < 880 || d.sprite.y > 240);
    const assignedDeskIds = new Set();

    this.agents.forEach((agent, npcKey) => {
      let deskPool;
      if (agent.role === 'cofounder') {
        // CTO gets a manager office desk, fallback to open office
        deskPool = managerDesks.length > 0 ? managerDesks : openDesks;
      } else {
        // Everyone gets a desk — it's an office, everyone needs a workstation
        deskPool = openDesks;
      }

      // Find first unassigned desk
      const desk = deskPool.find(d => !assignedDeskIds.has(d.instanceId || d.id));
      if (desk) {
        const deskId = desk.instanceId || desk.id;
        agent.assignedDesk = deskId;
        assignedDeskIds.add(deskId);
        this.deskAssignments.set(deskId, npcKey);
        // Store desk position for fallback use in office-scene.js
        const deskObj = this.actions._getFurniture(deskId);
        if (deskObj?.sprite) {
          agent._assignedDeskPos = { x: deskObj.sprite.x, y: deskObj.sprite.y };
        }
        console.log(`[AgentManager] Assigned ${agent.name} to desk ${deskId} (has chair nearby)`);
      }
    });
  }

  /** Pull think cadence from server — browser cannot read .env. */
  async _loadOfficeConfig() {
    try {
      const r = await fetch('/api/office-config');
      if (r.ok) {
        this._officeConfig = await r.json();
        console.log('[AgentManager] Office config loaded — think',
          `${(this._officeConfig.thinkMinMs / 1000)}-${(this._officeConfig.thinkMaxMs / 1000)}s`,
          this._officeConfig.economyMode ? '(economy)' : '');
      }
    } catch (_) {}
  }

  _getThinkCadence() {
    const c = this._officeConfig || {};
    return {
      thinkMinMs: c.thinkMinMs ?? 360000,
      thinkMaxMs: c.thinkMaxMs ?? 600000,
      thinkStaggerMs: c.thinkStaggerMs ?? 15000,
      pauseThinkDuringCeoChat: c.pauseThinkDuringCeoChat !== false,
      pauseThinksInCeoMode: c.pauseThinksInCeoMode !== false,
      mobileThinkMultiplier: c.mobileThinkMultiplier ?? 2.5,
    };
  }

  /** One browser tab runs think loops — extra tabs were tripling LM Studio load. */
  _refreshThinkLeader() {
    const key = 'denizen-think-leader';
    let leader = null;
    try {
      leader = JSON.parse(sessionStorage.getItem(key) || 'null');
    } catch (_) {}
    const stale = !leader || Date.now() - (leader.at || 0) > 45000;
    if (stale) {
      sessionStorage.setItem(key, JSON.stringify({ id: this._tabId, at: Date.now() }));
      this._isThinkLeader = true;
    } else {
      this._isThinkLeader = leader.id === this._tabId;
    }
    if (this._isThinkLeader && !this._thinkLeaderTimer) {
      this._thinkLeaderTimer = setInterval(() => {
        sessionStorage.setItem(key, JSON.stringify({ id: this._tabId, at: Date.now() }));
      }, 15000);
    }
    return this._isThinkLeader;
  }

  /**
   * Start initial agent behaviors — role-based startup + autonomous AI thinking
   */
  _startInitialBehaviors() {
    if (this._demoMode) return;

    // Role-based startup behaviors (existing — NPCs settle into the office)
    this.agents.forEach((agent, npcKey) => {
      switch (agent.role) {
        case 'cofounder':
          if (agent.assignedDesk) {
            // Teleport CTO directly to her private office desk — no walking across office
            this.actions.teleportToDesk(npcKey, agent.assignedDesk);
            agent.status = 'working';
            this.scene.time.delayedCall(5000, () => {
              this.actions.speak(npcKey, 'Good morning team!');
            });
          }
          break;
        case 'desk_worker':
        case 'stock_trader':
        case 'researcher':
        case 'qa_engineer':
        case 'devops':
        case 'designer':
        case 'data_engineer':
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
          break;
        case 'receptionist':
        case 'it_support':
        case 'security':
        case 'project_mgr':
        case 'product_mgr':
        case 'intern':
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
          break;
      }
    });

    // After everyone settles in, start AI think loops (staggered; one tab only)
    const cadence = this._getThinkCadence();
    const thinkStagger = cadence.thinkStaggerMs;
    let delay = 20000;
    this.agents.forEach((agent, npcKey) => {
      this.scene.time.delayedCall(delay, () => {
        if (this._refreshThinkLeader()) this._npcThinkLoop(npcKey);
      });
      delay += thinkStagger;
    });

    // Update status indicators every 500ms
    this.scene.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => this._updateStatusIndicators(),
    });

    // #5 — Per-role ambient routines. Runs every 60s on receptionist +
    // security NPCs so they USE the reception area even when their
    // LM think loop picks 'work'. Keeps Lucy/Pier/Bouncer from glueing
    // to their desks all day.
    this.scene.time.addEvent({
      delay: 60000,
      loop: true,
      callback: () => this._tickRoleRoutines(),
    });

    // #8 — Reception visitor spawn. Every 5 minutes a conference_* NPC
    // walks to the reception area and stands (as if a visitor arrived),
    // giving Lucy a reason to greet them.
    this.scene.time.addEvent({
      delay: 300000,
      loop: true,
      callback: () => this._spawnReceptionVisitor(),
    });
    // Fire one ~45s after startup so the demo has early reception activity.
    this.scene.time.delayedCall(45000, () => this._spawnReceptionVisitor());

    // #9 — Receptionist tour: every 15s, check if the player has been
    // idle long enough to warrant Lucy walking over to offer help. Cheap
    // tick — most calls are no-ops.
    this.scene.time.addEvent({
      delay: 15000,
      loop: true,
      callback: () => this._maybeOfferTour(),
    });

    // Assign initial moods per role
    this._assignInitialMoods();

    // Idle behavior timers — staggered so NPCs don't all fire at once
    this._startIdleBehaviors();

    // Ambient spontaneous chatter
    this._startAmbientChatter();

    // Proximity acknowledgment tracker
    this._startProximityTracker();

    // Morning broadcast — fires 10s after startup so it doesn't overlap greetings
    this.scene.time.delayedCall(10000, () => {
      this._broadcastOfficeEvent('morning', {});
    });
  }

  /**
   * #9 — Lucy offers a guided tour when the player has been standing
   * around lost. Walks to the player, greets them, then introduces them
   * to 2-3 nearby NPCs. Cooldown of 5 minutes so she doesn't pester.
   */
  _maybeOfferTour() {
    if (!this.agents) return;
    const lucy = this.agents.get('xp_lucy');
    if (!lucy || lucy.status === 'task_override' || lucy.status === 'tour_guide') return;
    if (!this.scene.player) return;

    // Cooldown: don't pester the player more than once every 5 minutes.
    const now = this.scene.time.now;
    if (this._lastTourAt && (now - this._lastTourAt) < 5 * 60 * 1000) return;

    // Need the player to have been idle for ~45s.
    const idleMs = this._lastPlayerActiveAt ? (Date.now() - this._lastPlayerActiveAt) : 0;
    if (idleMs < 45000) return;

    this._lastTourAt = now;
    this._runLucyTour().catch(err => {
      console.warn('[Tour] Tour error:', err?.message || err);
      // Reset Lucy's status so she's not stuck as 'tour_guide'
      const lucy = this.agents?.get('xp_lucy');
      if (lucy && lucy.status === 'tour_guide') lucy.status = 'working';
    });
  }

  /**
   * Wait until the player is within `dist` pixels of `targetX/Y`.
   * Polls every 600ms. Resolves true when close enough, false on timeout.
   * Shows a `waitBubble` text on `npcKey` while waiting (e.g. "This way…").
   */
  _waitForPlayerNear(targetX, targetY, { dist = 160, timeoutMs = 20000, npcKey, waitBubble } = {}) {
    return new Promise((resolve) => {
      const player = this.scene.player;
      if (!player) return resolve(false);

      let elapsed = 0;
      let bubbleShown = false;

      const check = () => {
        if (!this.scene?.player) return resolve(false);
        const d = Math.hypot(this.scene.player.x - targetX, this.scene.player.y - targetY);
        if (d <= dist) return resolve(true);

        elapsed += 600;
        if (elapsed >= timeoutMs) return resolve(false);

        // Show "follow me" bubble once after 2s of waiting
        if (!bubbleShown && elapsed >= 2000 && npcKey && waitBubble) {
          bubbleShown = true;
          try { this.actions.speak(npcKey, waitBubble); } catch (_) {}
        }

        this.scene.time.delayedCall(600, check);
      };
      check();
    });
  }

  /**
   * Wait until the player sends a new chat message (any NPC), or timeout.
   * Returns the message text if one arrives, or null on timeout.
   * Hooks into the WS message flow by registering a one-shot listener.
   */
  _waitForPlayerReply(timeoutMs = 25000) {
    return new Promise((resolve) => {
      let resolved = false;
      const timer = this.scene.time.delayedCall(timeoutMs, () => {
        if (!resolved) { resolved = true; resolve(null); }
      });
      // One-shot hook: _pendingReplyResolvers is checked in the WS message handler
      if (!this._pendingReplyResolvers) this._pendingReplyResolvers = [];
      this._pendingReplyResolvers.push((text) => {
        if (!resolved) {
          resolved = true;
          try { timer.remove(); } catch (_) {}
          resolve(text);
        }
      });
    });
  }

  /**
   * Walk Lucy to the player, ask if they want a tour, wait for a reply,
   * then escort them to 2 nearby NPCs — checking proximity at each stop
   * so Lucy actually waits for the player to follow before moving on.
   */
  async _runLucyTour() {
    const lucyKey = 'xp_lucy';
    const lucy = this.agents.get(lucyKey);
    const lucySprite = this.actions._getNpc(lucyKey);
    const player = this.scene.player;
    if (!lucy || !lucySprite || !player) return;

    console.log('[Tour] Lucy starting tour for the player');
    lucy.status = 'tour_guide';
    this.actions.standUp(lucyKey);

    // Step 1 — walk to player
    const offsetX = player.x > 640 ? -48 : 48;
    this.actions.walkTo(lucyKey, player.x + offsetX, player.y);
    await new Promise(r => this.scene.time.delayedCall(3500, r));

    // Step 2 — greet and ask if they want a tour (a real question)
    this.actions.speak(lucyKey, "Hey! I'm Lucy. Want me to introduce you to the team?");

    // Wait up to 20s for the player to reply.
    // If they say yes / okay / sure / please / tour → proceed.
    // Silence or "no" → bow out gracefully.
    const reply = await this._waitForPlayerReply(20000);
    const declined = reply && /\bno\b|nope|not now|later|busy/i.test(reply);
    const silent   = reply === null;

    if (declined || silent) {
      const msg = declined
        ? "No problem — I'm at reception if you need me!"
        : "I'll be here if you change your mind!";
      this.actions.speak(lucyKey, msg);
      await new Promise(r => this.scene.time.delayedCall(2500, r));
      this.actions.goToRoom(lucyKey, 'reception');
      lucy.status = 'working';
      return;
    }

    // Step 3 — pick 2 nearby NPCs to visit (sorted by distance to player)
    const candidates = [];
    this.agents.forEach((agent, key) => {
      if (key === lucyKey) return;
      const sprite = this.actions._getNpc(key);
      if (!sprite) return;
      const d = Math.hypot(sprite.x - player.x, sprite.y - player.y);
      candidates.push({ key, agent, sprite, d });
    });
    candidates.sort((a, b) => a.d - b.d);
    const tourStops = candidates.slice(0, 2);

    this.actions.speak(lucyKey, "Great — follow me!");
    await new Promise(r => this.scene.time.delayedCall(1800, r));

    for (const stop of tourStops) {
      const stopSprite = this.actions._getNpc(stop.key);
      if (!stopSprite) continue;

      // Lucy walks to the stop NPC
      this.actions.walkTo(lucyKey, stopSprite.x + 36, stopSprite.y);
      await new Promise(r => this.scene.time.delayedCall(3200, r));

      // Pause — wait for the player to actually walk over (up to 20s)
      const playerArrived = await this._waitForPlayerNear(
        stopSprite.x, stopSprite.y,
        { dist: 180, timeoutMs: 20000, npcKey: lucyKey, waitBubble: 'Come on over!' }
      );

      if (!playerArrived) {
        // Player didn't follow — abort gracefully
        this.actions.speak(lucyKey, "Looks like you wandered off — catch me at reception!");
        await new Promise(r => this.scene.time.delayedCall(2000, r));
        break;
      }

      // Introduce the NPC
      const roleLabel = stop.agent.roleDef?.label || stop.agent.role || 'team member';
      this.actions.speak(lucyKey, `This is ${stop.agent.name}, our ${roleLabel}.`);
      await new Promise(r => this.scene.time.delayedCall(2800, r));

      // Ask the NPC to introduce themselves — and wait for them to speak
      this._send({
        type: 'npc_introduce',
        npcName: stop.agent.name,
        context: 'Lucy is giving the CEO a tour. Introduce yourself in one warm sentence — name, role, one thing you care about.',
      });

      // Give player a moment to chat with this NPC if they want
      await new Promise(r => this.scene.time.delayedCall(6000, r));
    }

    // Tour done
    this.actions.speak(lucyKey, "That's the team! I'll be at reception if you need anything.");
    await new Promise(r => this.scene.time.delayedCall(2500, r));
    this.actions.goToRoom(lucyKey, 'reception');
    lucy.status = 'working';
  }

  /**
   * #5 — Role-specific ambient routines. Called on a timer so Lucy/Pier/Bouncer
   * actually use reception / patrol instead of always heading to their desk.
   */
  _bouncerInvestigationKey(threat) {
    return `${threat?.category || 'unknown'}:${threat?.source || 'unknown'}`;
  }

  _canRunBouncerInvestigation(threat) {
    const key = this._bouncerInvestigationKey(threat);
    const last = this._bouncerInvestigationAt.get(key) || 0;
    return Date.now() - last >= this._bouncerInvestigationCooldownMs;
  }

  _markBouncerInvestigation(threat) {
    this._bouncerInvestigationAt.set(this._bouncerInvestigationKey(threat), Date.now());
  }

  _bouncerLinuxChatAllowed(threat) {
    const key = this._bouncerInvestigationKey(threat || {});
    const last = this._bouncerLinuxChatAt.get(key) || 0;
    if (Date.now() - last < this._bouncerInvestigationCooldownMs) return false;
    this._bouncerLinuxChatAt.set(key, Date.now());
    return true;
  }

  /** Skip Kali + chat spam during CEO chats with other NPCs or dev-only threats. */
  _shouldDeferBouncerInvestigation(threat) {
    const src = String(threat?.source || '').toLowerCase();
    if (src === 'filesystem' || src === 'internal') return true;
    if (src === '::1' || src === '127.0.0.1' || src.startsWith('127.')) return true;
    const pc = this.scene?._playerChat;
    if (pc?._ceoConvo && pc._ceoConvo.npcName !== 'Bouncer') return true;
    return false;
  }

  _isCeoChatWithOtherNpc() {
    const pc = this.scene?._playerChat;
    return !!(pc?._ceoConvo && pc._ceoConvo.npcName !== 'Bouncer');
  }

  _tickRoleRoutines() {
    if (!this.agents) return;
    const securityBusy = new Set(['engaging', 'securing', 'honeypot']);
    this.agents.forEach((agent, npcKey) => {
      if (!agent || agent.status === 'task_override') return;
      const role = (agent.role || '').toLowerCase();
      const isRecept = role === 'receptionist' || agent.name === 'Lucy' || agent.name === 'Pier';
      const isSec = role === 'security' || agent.name === 'Bouncer';
      if (!isRecept && !isSec) return;

      if (isSec && securityBusy.has(agent.status)) return;

      // Only interrupt benign statuses — don't break meetings/reports.
      const interruptible = !agent.status
        || ['working','idle','wandering','break','visiting','reading'].indexOf(agent.status) !== -1;
      if (!interruptible) return;

      if (isRecept) {
        // Alternate between sitting at reception desk and standing to greet.
        const variant = Math.random();
        this.actions.standUp(npcKey);
        if (variant < 0.5) {
          this.actions.goToRoom(npcKey, 'reception');
          agent.status = 'receptionist_patrol';
          this.scene.time.delayedCall(2500, () => {
            this.actions.speak(npcKey, 'Let me know if you need anything.');
          });
        } else {
          this.actions.goToRoom(npcKey, 'reception');
          agent.status = 'receptionist_patrol';
          this.scene.time.delayedCall(2500, () => {
            this.actions.emote(npcKey, 'wave');
          });
        }
        this.scene.time.delayedCall(14000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
      } else if (isSec) {
        // SECURITY behaviour. Priority order:
        //   1. Active robber → confront it (top priority).
        //   2. Player loitering in a restricted room (manager_office /
        //      storage) for >30s → walk over with a polite challenge.
        //   3. Otherwise run the ambient patrol so the office still
        //      sees a guard moving around.
        const robbers = this.scene._robberCtrl?.getActiveRobbers?.() || [];
        const RESTRICTED = ['manager_office', 'storage'];
        const playerInRestricted = this._lastPlayerRoom && RESTRICTED.indexOf(this._lastPlayerRoom) !== -1;
        const loiterMs = playerInRestricted
          ? (Date.now() - (this._playerRoomEnteredAt || Date.now()))
          : 0;
        const loiterTooLong = loiterMs > 30000
          && (!this._lastLoiterCheckAt || (Date.now() - this._lastLoiterCheckAt) > 5 * 60 * 1000);

        if (robbers.length > 0 && !this._isCeoChatWithOtherNpc()) {
          this._confrontNearestRobber(npcKey, agent, robbers);
        } else if (loiterTooLong) {
          this._lastLoiterCheckAt = Date.now();
          this._challengePlayerLoiter(npcKey, agent, this._lastPlayerRoom);
        } else {
          // Ambient patrol loop: reception → open_office → reception → desk.
          this.actions.standUp(npcKey);
          agent.status = 'patrolling';
          this.actions.goToRoom(npcKey, 'reception');
          this.scene.time.delayedCall(6000, () => {
            this.actions.goToRoom(npcKey, 'open_office');
          });
          this.scene.time.delayedCall(14000, () => {
            this.actions.goToRoom(npcKey, 'reception');
          });
          this.scene.time.delayedCall(22000, () => {
            if (agent.assignedDesk) {
              this.actions.useComputer(npcKey, agent.assignedDesk);
              agent.status = 'working';
            }
          });
        }
      }
    });
  }

  /**
   * #8 — Scripted "visitor arrives" moment. Picks a non-core NPC
   * (conference_man or conference_woman if free) to walk into reception
   * and stand, giving receptionist NPCs something real to react to.
   */
  /**
   * Full threat-response sequence:
   *   1. Walk to robber
   *   2. Challenge + interrogate (Bouncer asks; robber gives suspicious answer)
   *   3. Resolve (flee / sass / stand defiant)
   *   4. Report the incident to the player via AI brain
   *   5. Set up a countermeasure at the affected area
   *   6. If 2+ threats recently — offer/set up a honeypot
   */
  _confrontNearestRobber(secKey, agent, robbers) {
    const secSprite = this.actions._getNpc(secKey);
    if (!secSprite) return;

    // Don't double-engage
    if (agent.status === 'engaging') return;

    // Pick the nearest visible robber.
    let nearest = null;
    let nearestD2 = Infinity;
    for (const r of robbers) {
      if (!r?.position) continue;
      const dx = r.position.x - secSprite.x;
      const dy = r.position.y - secSprite.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < nearestD2) { nearestD2 = d2; nearest = r; }
    }
    if (!nearest) return;

    agent.status = 'engaging';
    this._shiftMoodOnEvent('threat_detected');
    this.actions.standUp(secKey);
    this.actions.emote(secKey, '!');

    // Track recent threats for honeypot trigger
    if (!this._recentThreats) this._recentThreats = [];
    this._recentThreats.push({ category: nearest.category, at: Date.now() });
    // Keep only the last 5 minutes worth
    this._recentThreats = this._recentThreats.filter(t => Date.now() - t.at < 5 * 60 * 1000);

    const sev      = String(nearest.severity || 'medium').toLowerCase();
    const category = nearest.category || 'unknown';

    // ── Real tool triggers (cooldown per category+source — no Kali spam) ───
    if (!this._shouldDeferBouncerInvestigation(nearest)) {
      if (this._canRunBouncerInvestigation(nearest)) {
        this._markBouncerInvestigation(nearest);
        this._send({ type: 'bouncer_run_linux', threat: nearest, openTerminal: false });
      } else {
        console.log(`[Security] Skipping duplicate Kali run for ${this._bouncerInvestigationKey(nearest)}`);
      }
    }

    // ── Step 1: walk to robber ───────────────────────────────────────────────
    this.actions.walkTo(secKey, nearest.position.x - 36, nearest.position.y);

    // ── Step 2: interrogation questions ─────────────────────────────────────
    // Bouncer asks a sharp question tailored to what the robber is doing.
    const INTERROGATE = {
      file_access:   ["What are you looking for in those files?", "Those are not yours — who sent you?", "Care to explain what is so interesting in there?"],
      data_breach:   ["Whose credentials are you using?", "What are you pulling off that machine?", "You are logged into an account that is not yours."],
      network_scan:  ["Why are you scanning our network?", "Which ports were you hoping to find open?", "You are mapping our systems. Start talking."],
      brute_force:   ["How long have you been on that lock?", "Who told you to get in here?", "That door is not going to open for you."],
      shell_exec:    ["What commands are you running?", "You do not have shell access. Explain yourself.", "I can see what you are typing. Stop."],
      api_abuse:     ["How many requests have you made?", "Which endpoint are you probing?", "That is not a public endpoint. Who gave you the docs?"],
      process_spawn: ["What process did you just launch?", "That executable does not belong here.", "What are you trying to run on our systems?"],
      exfiltration:  ["What is in the bag?", "You are not walking out with that.", "Put it down. Now. What did you copy?"],
      scan_probe:    ["You have walked past reception three times.", "What are you casing?", "You are not here for a meeting. I have been watching."],
      packet_anomaly:["You are listening to traffic that is not yours.", "What are you capturing?", "That device should not be on our network."],
      unknown:       ["Who are you and what are you doing here?", "You do not have access to this area.", "Start talking."],
    };

    // Robber deflections — what they claim vs what is obvious
    const ROBBER_DEFLECT = {
      file_access:   ["Just looking for the bathroom.", "Someone asked me to grab something.", "I work on the third floor."],
      data_breach:   ["I was just checking my email.", "IT asked me to run some diagnostics.", "The screen was already unlocked."],
      network_scan:  ["New network setup, checking connectivity.", "IT support, routine scan.", "Just checking the wifi."],
      brute_force:   ["My keycard stopped working.", "Facilities sent me.", "I just need five minutes in there."],
      shell_exec:    ["Running updates.", "Maintenance script.", "DevOps asked me to run something."],
      api_abuse:     ["Load testing. Totally authorized.", "Just checking uptime.", "Public API, no big deal."],
      process_spawn: ["Deploying a patch.", "IT asked me to install something.", "It is a scheduled task."],
      exfiltration:  ["Just my laptop. Personal stuff.", "Archiving old files, totally normal.", "Boss asked me to move some data."],
      scan_probe:    ["Waiting for a friend.", "Dropped something earlier.", "Just admiring the lobby."],
      packet_anomaly:["Network troubleshooting.", "My analyzer is misconfigured.", "Wrong building, wrong cable."],
      unknown:       ["I am allowed to be here.", "Nobody told me this was off-limits.", "I have a meeting."],
    };

    // Bouncer follow-up after hearing the excuse
    const FOLLOWUP = {
      high:     ["Not convincing. Step away.", "That story does not check out.", "Wrong answer."],
      critical: ["You are done here.", "We are past talking.", "Last chance to walk out on your own."],
      low:      ["Nice try.", "Right. Let me get you to the exit.", "Not today."],
      medium:   ["I have heard better lies.", "Try again in another building.", "You are going to want to leave now."],
    };

    const qPool   = INTERROGATE[category]   || INTERROGATE.unknown;
    const dPool   = ROBBER_DEFLECT[category]|| ROBBER_DEFLECT.unknown;
    const fuPool  = FOLLOWUP[sev]           || FOLLOWUP.medium;
    const question = qPool [Math.floor(Math.random() * qPool.length)];
    const deflect  = dPool [Math.floor(Math.random() * dPool.length)];
    const followup = fuPool[Math.floor(Math.random() * fuPool.length)];

    this.scene.time.delayedCall(2800, () => {
      // Bouncer asks the question
      this.actions.speak(secKey, question);

      // Robber deflects ~1.8s later (enough to be readable)
      this.scene.time.delayedCall(2200, () => {
        const robberObj = this.scene._robberCtrl?.robbers?.get(nearest.threatId);
        if (robberObj) {
          this.scene._robberCtrl?._showBubble(robberObj, `🦹 ${deflect}`);
        }

        // Bouncer's follow-up — sceptical, final
        this.scene.time.delayedCall(2000, () => {
          this.actions.speak(secKey, followup);

          // ── Step 3: resolve (flee/sass/stand) ─────────────────────────────
          this.scene.time.delayedCall(800, () => {
            const result = this.scene._robberCtrl?.confront?.(nearest.threatId, agent.name || 'Bouncer');
            const outcome = result?.outcome || 'fled';

            // ── Step 4: report to player ───────────────────────────────────
            // Wait a moment so the resolution animation plays first
            this.scene.time.delayedCall(3500, () => {
              this._reportIncidentToPlayer(secKey, agent, nearest, outcome);
            });
          });
        });
      });
    });
  }

  /** Security-only lines — never flood CEO/Lucy chat. */
  _bouncerSecurityStatus(text, kind = 'status') {
    const body = String(text || '').trim();
    if (!body) return;
    const now = Date.now();
    const last = this._bouncerStatusDedupAt.get(body) || 0;
    if (now - last < 45000) return;
    this._bouncerStatusDedupAt.set(body, now);
    if (window.DenizenSecurityFeed?.ingest) {
      window.DenizenSecurityFeed.ingest({ text: body, kind });
    } else if (this.scene?._playerChat) {
      this.scene._playerChat._addToLog('Bouncer', body);
    }
  }

  /**
   * Walk Bouncer to the player and post a scripted incident report to the
   * security feed (not CEO chat — keeps Lucy conversations readable).
   */
  _reportIncidentToPlayer(secKey, agent, threat, outcome) {
    const player = this.scene.player;
    if (!player) { agent.status = 'patrolling'; return; }

    const reportKey = `${threat.category}:${threat.source || threat.detail || ''}`.slice(0, 96);
    const lastReport = this._incidentReportAt.get(reportKey) || 0;
    if (Date.now() - lastReport < 90000) {
      agent.status = 'patrolling';
      return;
    }
    this._incidentReportAt.set(reportKey, Date.now());

    const offsetX = player.x > 640 ? -48 : 48;
    this.actions.walkTo(secKey, player.x + offsetX, player.y);
    this.actions.emote(secKey, '!');

    // Countermeasure description by category
    const COUNTERMEASURES = {
      file_access:    'locked down the filing area and flagged those files for audit',
      data_breach:    'forced a session logout on that terminal and changed the access policy',
      network_scan:   'blocked that IP range at the perimeter and added a watchpoint on the subnet',
      brute_force:    'added a 3-strike lockout on that door and flagged the access logs',
      shell_exec:     'killed the process, revoked the shell access, and set an alert on that user',
      api_abuse:      'rate-limited that client ID and flagged the endpoint for review',
      process_spawn:  'terminated the process tree and quarantined the entry point',
      exfiltration:   'intercepted the data transfer and flagged the user for review',
      scan_probe:     'set a tripwire on the front perimeter — next scan pings me directly',
      packet_anomaly: 'isolated that network segment and set a traffic alert on the tap point',
      unknown:        'escorted them out and marked their access as revoked',
    };

    const outcomeDesc = {
      fled:   'they ran',
      sassed: 'they got mouthy then ran',
      stood:  'they held their ground — threat is still active, keep your eyes open',
    }[outcome] || 'handled';

    const cm = COUNTERMEASURES[threat.category] || COUNTERMEASURES.unknown;

    const reportContext = [
      `You just caught a ${threat.severity} ${threat.category.replace(/_/g, ' ')} threat.`,
      `Detail: ${threat.detail || '(no detail)'}`,
      `When you confronted them: ${outcomeDesc}.`,
      `Countermeasure you set up: ${cm}.`,
      `Report this concisely to the CEO in 2-3 sentences in your voice — stoic, dry, professional.`,
      `Mention what the threat was doing, what you did, and what you set up to prevent recurrence.`,
    ].join(' ');

    this.scene.time.delayedCall(3000, () => {
      const text = window.DenizenSecurityFeed?.formatIncidentReport?.(reportContext)
        || `${threat.category.replace(/_/g, ' ')} — handled. ${cm}.`;
      window.DenizenSecurityFeed?.ingest?.({ text, kind: 'incident' });
      try { this.actions.speak(secKey, String(text).slice(0, 120)); } catch (_) {}
      if (window.DenizenSecurityFeed?.show) {
        window.DenizenSecurityFeed.show();
      }

      // Mood shift: threat resolved
      this._shiftMoodOnEvent('threat_resolved');

      // Broadcast office reaction to the catch
      this._broadcastOfficeEvent('threat_caught', {});

      // ── Step 5: set up a physical countermeasure ──────────────────────────
      this.scene.time.delayedCall(5000, () => {
        this._setupCountermeasure(secKey, agent, threat);
      });
    });
  }

  /**
   * Bouncer walks to the affected area and visually "secures" it —
   * shows a glowing "SECURED" marker and speaks about what he's doing.
   * The marker fades after 60s (visual only, not permanent).
   */
  _setupCountermeasure(secKey, agent, threat) {
    const COUNTERMEASURE_POS = {
      file_access:    { x: 960, y: 160,  label: '🔒 Files locked' },
      data_breach:    { x: 388, y: 156,  label: '🖥 Terminal locked' },
      network_scan:   { x: 844, y: 300,  label: '📡 Perimeter watchpoint' },
      brute_force:    { x: 340, y: 444,  label: '🚪 Lockout active' },
      shell_exec:     { x: 648, y: 156,  label: '💻 Shell revoked' },
      api_abuse:      { x: 456, y: 156,  label: '🌐 Rate limit set' },
      process_spawn:  { x: 50,  y: 400,  label: '⚙️ Entry quarantined' },
      exfiltration:   { x: 400, y: 444,  label: '📦 Transfer blocked' },
      scan_probe:     { x: 200, y: 560,  label: '👁 Tripwire set' },
      packet_anomaly: { x: 1100, y: 400, label: '📶 Segment isolated' },
    };

    const cm = COUNTERMEASURE_POS[threat.category];
    if (!cm) { agent.status = 'patrolling'; return; }

    const cmLine = {
      file_access:   'Locking down the files.',
      data_breach:   'Killing that terminal session.',
      network_scan:  'Setting a watchpoint on the perimeter.',
      brute_force:   'Adding a strike-lockout on that door.',
      shell_exec:    'Revoking the shell access.',
      api_abuse:     'Throttling that endpoint.',
      process_spawn: 'Quarantining the entry point.',
      exfiltration:  'Blocking the egress path.',
      scan_probe:    'Setting a tripwire out front.',
      packet_anomaly:'Isolating that network segment.',
    }[threat.category] || 'Securing the area.';

    agent.status = 'securing';
    this.actions.walkTo(secKey, cm.x, cm.y);

    this.scene.time.delayedCall(3500, () => {
      this.actions.speak(secKey, cmLine);

      // Drop a visual "secured" marker at this position
      this.scene.time.delayedCall(800, () => {
        this._placeSecuredMarker(cm.x, cm.y, cm.label);

        // Check if we should set up a honeypot
        const recentCount = (this._recentThreats || []).filter(t => Date.now() - t.at < 5 * 60 * 1000).length;
        if (recentCount >= 2 && !this._honeypotActive) {
          this.scene.time.delayedCall(4000, () => {
            this._setupHoneypot(secKey, agent);
          });
        } else {
          this.scene.time.delayedCall(4000, () => {
            agent.status = 'patrolling';
          });
        }
      });
    });
  }

  /**
   * Place a glowing "SECURED" text marker at a world position.
   * Fades out after 60 seconds.
   */
  _placeSecuredMarker(x, y, label) {
    if (!this.scene?.add) return;
    const marker = this.scene.add.text(x, y - 20, label, {
      fontSize: '8px',
      fontFamily: 'monospace',
      color: '#4ade80',
      backgroundColor: '#052e16cc',
      padding: { x: 4, y: 2 },
    });
    marker.setOrigin(0.5, 1);
    marker.setDepth(9000);

    // Pulse animation
    this.scene.tweens.add({
      targets: marker,
      alpha: { from: 1, to: 0.6 },
      duration: 800,
      yoyo: true,
      repeat: 5,
    });

    // Fade out and destroy after 60s
    this.scene.time.delayedCall(60000, () => {
      this.scene.tweens.add({
        targets: marker,
        alpha: 0,
        duration: 2000,
        onComplete: () => { try { marker.destroy(); } catch (_) {} },
      });
    });
  }

  /**
   * Honeypot mode: Bouncer picks a tempting spot for intruders (a computer
   * near the edge, a filing cabinet in a low-traffic area), walks there,
   * and waits. Any robber that comes within 120px triggers an immediate
   * confrontation — no walk-to needed, Bouncer is already there.
   *
   * Shows a "🍯 Bait set" whisper bubble. Deactivates after 3 minutes
   * or when a robber is caught.
   */
  _setupHoneypot(secKey, agent) {
    if (this._honeypotActive) return;
    this._honeypotActive = true;

    // Honeypot spots — tempting locations where an intruder might go
    const HONEYPOT_SPOTS = [
      { x: 960, y: 160,  label: '🍯 Watching the files...' },
      { x: 388, y: 156,  label: '🍯 Staking out the terminal...' },
      { x: 1100, y: 400, label: '🍯 Watching the server room...' },
      { x: 648, y: 156,  label: '🍯 Bait deployed at the desk...' },
    ];
    const spot = HONEYPOT_SPOTS[Math.floor(Math.random() * HONEYPOT_SPOTS.length)];
    this._honeypotSpot = { ...spot, setAt: Date.now() };

    agent.status = 'honeypot';
    this.actions.walkTo(secKey, spot.x, spot.y);

    this.scene.time.delayedCall(3500, () => {
      this.actions.speak(secKey, spot.label);

      // Visual whisper indicator
      this._placeSecuredMarker(spot.x, spot.y + 20, '🍯 Bait');

      // Notify the player
      const player = this.scene.player;
      if (player && this.ws?.readyState === WebSocket.OPEN) {
        this._send({
          type: 'bouncer_honeypot',
          message: `Bouncer set up a honeypot at (${Math.round(spot.x)}, ${Math.round(spot.y)}) — waiting for the next intruder.`,
          position: { x: Math.round(spot.x), y: Math.round(spot.y) },
        });
      }

      // Proximity check: poll every second while in honeypot mode
      const poll = () => {
        if (!this._honeypotActive || agent.status !== 'honeypot') return;

        const robbers = this.scene._robberCtrl?.getActiveRobbers?.() || [];
        const spriteNow = this.actions._getNpc(secKey);
        if (!spriteNow) { this._honeypotActive = false; return; }

        const tripped = robbers.find(r => {
          if (!r?.position) return false;
          const d = Math.hypot(r.position.x - spriteNow.x, r.position.y - spriteNow.y);
          return d < 120;
        });

        if (tripped) {
          this._honeypotActive = false;
          this._honeypotSpot = null;
          agent.status = 'engaging';

          // Bouncer springs the trap
          this.actions.emote(secKey, '!');
          this.actions.speak(secKey, 'Got one. Knew you would come back.');

          this.scene.time.delayedCall(1200, () => {
            const result = this.scene._robberCtrl?.confront?.(tripped.threatId, agent.name || 'Bouncer');
            this.scene.time.delayedCall(2500, () => {
              this._reportIncidentToPlayer(secKey, agent, tripped, result?.outcome || 'fled');
            });
          });
          return;
        }

        this.scene.time.delayedCall(1000, poll);
      };
      this.scene.time.delayedCall(1000, poll);

      // Honeypot expires after 3 minutes
      this.scene.time.delayedCall(3 * 60 * 1000, () => {
        if (this._honeypotActive) {
          this._honeypotActive = false;
          this._honeypotSpot = null;
          this.actions.speak(secKey, 'Nobody took the bait. Resetting patrol.');
          agent.status = 'patrolling';
        }
      });
    });
  }

  /** CEO asked Bouncer to confront active robbers (player chat). */
  _bouncerConfrontOnPlayerOrder() {
    const secKey = Object.entries(this.NPC_NAMES).find(([, v]) => v === 'Bouncer')?.[0] || 'xp_bouncer';
    const agent = this.agents?.get(secKey);
    const robbers = this.scene._robberCtrl?.getActiveRobbers?.() || [];
    if (!agent || robbers.length === 0) return false;
    this._confrontNearestRobber(secKey, agent, robbers);
    return true;
  }

  /** CEO asked about honeypot — deploy if not already active. */
  _bouncerHoneypotOnPlayerOrder() {
    const secKey = Object.entries(this.NPC_NAMES).find(([, v]) => v === 'Bouncer')?.[0] || 'xp_bouncer';
    const agent = this.agents?.get(secKey);
    if (!agent) return { active: false, deployed: false };
    if (this._honeypotActive) {
      return { active: true, deployed: false, spot: this._honeypotSpot };
    }
    this._setupHoneypot(secKey, agent);
    return { active: true, deployed: true, spot: this._honeypotSpot };
  }

  /**
   * Bouncer politely challenges the player when they've been hanging
   * around a restricted room (manager_office / storage) for >30s.
   * Cooldown is 5 minutes so the Bouncer doesn't pester. Matches the
   * SOUL.md voice: firm-but-warm, dry humor, never rude.
   */
  _challengePlayerLoiter(secKey, agent, room) {
    const player = this.scene.player;
    if (!player) return;
    const secSprite = this.actions._getNpc(secKey);
    if (!secSprite) return;

    console.log(`[Security] Bouncer challenging player loitering in ${room}`);
    agent.status = 'engaging';
    this.actions.standUp(secKey);

    // Walk to player with a small offset so they don't overlap.
    const offsetX = player.x > 640 ? -48 : 48;
    this.actions.walkTo(secKey, player.x + offsetX, player.y);

    // Severity scales with room: storage is more sensitive than the
    // CTO's office (which everyone visits sometimes anyway).
    const ROOM_LINES = {
      manager_office: [
        'Can I help you find something?',
        'Looking for Abby? She is usually in around now.',
        'This is the CTO office — anything you need?',
      ],
      storage: [
        'Storage is staff-only, my friend.',
        'Anything I can grab for you from here?',
        'You are a bit deep in the supply room.',
      ],
    };
    const pool = ROOM_LINES[room] || ROOM_LINES.manager_office;
    const line = pool[Math.floor(Math.random() * pool.length)];

    this.scene.time.delayedCall(2500, () => {
      this.actions.emote(secKey, '?');
      this.scene.time.delayedCall(300, () => {
        this.actions.speak(secKey, line);
      });
      // Return to patrol after a moment so the Bouncer doesn't shadow
      // the player around the office.
      this.scene.time.delayedCall(8000, () => {
        agent.status = 'patrolling';
        this.actions.goToRoom(secKey, 'reception');
      });
    });
  }

  _spawnReceptionVisitor() {
    if (!this.agents) return;
    const candidates = ['xp_conference_man', 'xp_conference_woman'];
    for (const key of candidates) {
      const agent = this.agents.get(key);
      if (!agent) continue;
      if (agent.status === 'task_override') continue;
      // Skip if already visiting
      if (agent.status === 'visitor_arrival') return;

      this.actions.standUp(key);
      agent.status = 'visitor_arrival';
      // Walk to reception center
      this.actions.goToRoom(key, 'reception');
      this.scene.time.delayedCall(3500, () => {
        this.actions.emote(key, 'wave');
        this.actions.speak(key, 'Hi, I\'m here for a meeting.');
        this._broadcastOfficeEvent('visitor_arrived', {});
      });
      // Nudge the receptionists to greet by name
      const lucyKey = 'xp_lucy';
      if (this.agents.get(lucyKey)) {
        this.scene.time.delayedCall(5000, () => {
          this.actions.standUp(lucyKey);
          this.actions.goToRoom(lucyKey, 'reception');
          this.scene.time.delayedCall(3500, () => {
            this.actions.speak(lucyKey, 'Welcome! Let me check you in.');
          });
        });
      }
      // Visitor wanders off (heads to conference) after a bit
      this.scene.time.delayedCall(16000, () => {
        this.actions.goToRoom(key, 'conference');
        agent.status = 'working';
      });
      return;
    }
  }

  /**
   * Update visual status indicators (colored dots + task labels) above each NPC
   */
  _updateStatusIndicators() {
    this.agents.forEach((agent, npcKey) => {
      const npc = this.actions._getNpc(npcKey);
      if (!npc) return;

      // Status dot color based on agent status
      const colors = {
        working: 0x4ade80,    // green
        talking: 0x60a5fa,    // blue
        collaborating: 0x60a5fa,
        break: 0xfbbf24,      // yellow
        meeting: 0xa855f7,    // purple
        error: 0xef4444,      // red
        idle: 0x94a3b8,       // gray
        checking: 0x06b6d4,   // cyan
        reporting: 0xf97316,  // orange
      };
      const color = colors[agent.status] || colors.idle;

      // Create or update dot
      let dot = this._statusDots.get(npcKey);
      if (!dot) {
        dot = this.scene.add.circle(0, 0, 3, color);
        dot.setDepth(9999);
        this._statusDots.set(npcKey, dot);
      }
      dot.setFillStyle(color);
      dot.setPosition(npc.x, npc.y - 56);
      dot.setVisible(true);

      // Task label — only show if NPC has an active task
      let label = this._taskLabels.get(npcKey);
      if (agent._taskLabel) {
        if (!label) {
          label = this.scene.add.text(0, 0, '', {
            fontSize: '6px',
            fontFamily: 'monospace',
            color: '#94a3b8',
            backgroundColor: '#0f172a80',
            padding: { x: 2, y: 1 },
          });
          label.setDepth(9998);
          label.setOrigin(0.5, 1);
          this._taskLabels.set(npcKey, label);
        }
        label.setText(agent._taskLabel.slice(0, 25));
        label.setPosition(npc.x, npc.y - 58);
        label.setVisible(true);
      } else if (label) {
        label.setVisible(false);
      }
    });
  }

  /**
   * Autonomous NPC think loop — each NPC periodically asks LM Studio what to do next.
   * Replaces all hardcoded patrol/checkin/wander behaviors.
   */
  _npcThinkLoop(npcKey) {
    const agent = this.agents.get(npcKey);
    if (!agent) return;

    const cadence = this._getThinkCadence();

    if (!this._refreshThinkLeader()) {
      this.scene.time.delayedCall(60000, () => this._npcThinkLoop(npcKey));
      return;
    }

    const mobileTuning = window.__DenizenMobileTuning || {};
    const pauseCeoMode = cadence.pauseThinksInCeoMode !== false
      && mobileTuning.pauseThinksInCeoMode !== false;
    if (pauseCeoMode && window.__DenizenCeoMode) {
      this.scene.time.delayedCall(60000, () => this._npcThinkLoop(npcKey));
      return;
    }

    if (agent.status === 'task_override') {
      // Server command took over — check again later
      this.scene.time.delayedCall(15000, () => this._npcThinkLoop(npcKey));
      return;
    }

    if (cadence.pauseThinkDuringCeoChat !== false && agent.status === 'ceo_conversation') {
      this.scene.time.delayedCall(45000, () => this._npcThinkLoop(npcKey));
      return;
    }

    // Build office context for the NPC
    const nearbyNpcs = [];
    this.agents.forEach((a, k) => {
      if (k !== npcKey) {
        nearbyNpcs.push(`${a.name} (${a.role}) — ${a.status || 'idle'}`);
      }
    });

    // #4 — Compute nearby furniture so the NPC can pick concrete destinations.
    // Sample the 5 closest interactables to the NPC's current position.
    const nearbyFurniture = this._computeNearbyFurniture(npcKey, 5);

    const sess = globalThis.DenizenVisitorSession;
    const context = {
      description: `Office time: ${new Date().toLocaleTimeString()}. Time of day: ${this._getTimeOfDay()}. Your status: ${agent.status || 'idle'}. Your current mood: ${this._getMood(npcKey)}. ` +
        `Nearby coworkers: ${nearbyNpcs.join(', ')}.`,
      nearbyFurniture,
      officeId: window.__DenizenOfficeId || sess?.getOfficeId?.() || null,
      identityId: sess?.getIdentityId?.() || null,
      isOperatorOffice: !!window.__DenizenIsOperatorOffice,
    };

    // Ask server for NPC's decision
    this._send({
      type: 'npc_think',
      npcName: agent.name,
      office_id: context.officeId,
      context,
    });

    // Schedule next think from server config (not browser prompt-tuning defaults)
    let nextDelay = cadence.thinkMinMs + Math.random() * Math.max(0, cadence.thinkMaxMs - cadence.thinkMinMs);
    if (window.__DenizenIsTouch) {
      const mult = cadence.mobileThinkMultiplier ?? mobileTuning.mobileThinkMultiplier ?? 1;
      if (mult > 1) nextDelay = Math.round(nextDelay * mult);
    }
    this.scene.time.delayedCall(nextDelay, () => this._npcThinkLoop(npcKey));
  }

  /**
   * #4 — Return short human-readable labels for the N closest interactables
   * to a given NPC. Used in the think prompt so the model can pick concrete
   * destinations ("coffee machine 40px away") instead of vague "work".
   */
  _computeNearbyFurniture(npcKey, maxItems = 5) {
    const npc = this.scene?.npcs?.find(n => n.npcKey === npcKey)
      || (this.scene?.npcs || []).find(n => n._npcKey === npcKey)
      || null;
    // Fallback: the scene stores npcs by texture key, so look there too.
    const sprite = npc || (Array.isArray(this.scene?.npcs) ? this.scene.npcs.find(n => n.texture?.key === npcKey) : null);
    if (!sprite) return [];
    const items = Array.isArray(this.scene?._interactables) ? this.scene._interactables : [];
    if (items.length === 0) return [];
    const scored = [];
    for (const it of items) {
      if (!it || !it.sprite || !it.id) continue;
      const d = Math.hypot(it.sprite.x - sprite.x, it.sprite.y - sprite.y);
      // Build a friendly short label
      let kind = 'object';
      const id = String(it.id);
      if (/coffee|espresso|kettle/i.test(id)) kind = 'coffee machine';
      else if (/vending|snack/i.test(id))      kind = 'vending machine';
      else if (/fridge|microwave/i.test(id))   kind = 'kitchen appliance';
      else if (/bookshelf|shelf|bookcase/i.test(id)) kind = 'bookshelf';
      else if (/printer|copier/i.test(id))     kind = 'printer';
      else if (/couch|sofa/i.test(id))         kind = 'couch';
      else if (/desk/i.test(id))               kind = 'desk';
      else if (/chair|seat|stool/i.test(id))   kind = 'chair';
      else if (/whiteboard|board/i.test(id))   kind = 'whiteboard';
      else if (/plant|pot/i.test(id))          continue; // decor clutter
      else continue; // skip anything we can't label usefully
      scored.push({ kind, d });
    }
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, maxItems).map(s => `${s.kind} (${Math.round(s.d)}px)`);
  }

  /**
   * Execute an NPC's autonomous decision from LM Studio
   */
  _executeNpcDecision(npcName, decision) {
    // Find the NPC key from name
    const npcKey = Object.entries(this.NPC_NAMES).find(
      ([k, v]) => v.toLowerCase() === npcName?.toLowerCase()
    )?.[0];
    if (!npcKey) return;

    const agent = this.agents.get(npcKey);
    if (!agent || agent.status === 'task_override') return;

    // Don't let the think loop pull Bouncer off an active threat response.
    if (['engaging', 'securing', 'honeypot'].includes(agent.status)) {
      const keep = decision.action === 'talk' || decision.action === 'report';
      if (!keep) return;
    }

    const thought = decision.thought || '';
    let action = decision.action || 'work';
    let target = decision.target || null;
    let location = decision.location || null;
    const message = decision.message || '';

    // Conversation focus — if this NPC was just addressed (within 8s),
    // don't let them wander off. Convert any move-y action into a stay-
    // put 'talk' back at the addresser so they acknowledge before
    // continuing whatever else they had planned. Real people don't pivot
    // to a coffee run mid-sentence.
    const npcSprite = this.actions._getNpc(npcKey);
    const ceoConvoUntil = npcSprite?.ai?._ceoConvoUntil || 0;
    const inCeoConvo = agent.status === 'ceo_conversation'
      || ceoConvoUntil > this.scene.time.now
      || npcSprite?.ai?.taskState === 'reporting';

    // Autonomous think must not pull an NPC away during CEO conversation.
    if (inCeoConvo) return;

    const addressedUntil = npcSprite?.ai?._addressedUntil || 0;
    const addressedBy = npcSprite?.ai?._addressedBy;
    if (addressedUntil > this.scene.time.now && addressedBy && action !== 'talk') {
      // '__player__' is the CEO talking to them — it is NOT in NPC_NAMES, which
      // is why this guard used to silently skip player conversations and let
      // the NPC wander off mid-reply. Handle it explicitly.
      const isPlayer = addressedBy === '__player__';
      const addressedByName = isPlayer ? 'the CEO' : this.NPC_NAMES[addressedBy];
      if (addressedByName) {
        // Any action that would move them away counts as "walking off".
        const movey = ['work', 'break', 'coffee', 'wander', 'visit', 'collaborate', 'meeting', 'check', 'read'].indexOf(action) !== -1;
        if (movey) {
          console.log(`[NPC Focus] ${npcName} was just addressed by ${addressedByName} — staying put to respond`);
          action = 'talk';
          // For the player we keep them in place (no NPC target to route to);
          // for a peer we point the reply back at that peer.
          target = isPlayer ? null : addressedByName;
          location = null;
        }
      }
    }

    // Follow-me lock — if this NPC is trailing the player, an autonomous
    // decision must NOT walk them off (the follow tick would fight it and
    // they'd jitter). Strip any movement; let them still speak in place.
    if (this.actions.isFollowing && this.actions.isFollowing(npcKey)) {
      const movey = ['work', 'break', 'coffee', 'wander', 'visit', 'collaborate', 'meeting', 'check', 'read'].indexOf(action) !== -1;
      if (movey || location || (action === 'talk' && target)) {
        action = 'talk';
        target = null;
        location = null;
      }
    }

    // Track task label for visual display
    if (decision.taskPhase === 'starting' && message) {
      agent._taskLabel = message.slice(0, 30);
    } else if (decision.taskPhase === 'finished') {
      agent._taskLabel = null;
    } else if (action === 'work' && message && message !== 'Working...') {
      agent._taskLabel = message.slice(0, 30);
    }

    console.log(`[NPC Think] ${npcName}: "${thought}" → ${action}${target ? ` → ${target}` : ''}${location ? ` @ ${location}` : ''}`);

    // Show thought bubble briefly
    if (thought) {
      this.actions.think(npcKey, thought);
    }

    // Helper: find target NPC key
    const findTargetKey = (name) => name ? Object.entries(this.NPC_NAMES).find(
      ([k, v]) => v.toLowerCase() === name.toLowerCase()
    )?.[0] : null;

    // Helper: move to a location. Extended to cover every room in the map
    // so NPCs can actually pick manager_office, reception, and open_office
    // from the think prompt.
    const goToLocation = (key, loc) => {
      if (loc === 'breakroom')           this.actions.goToBreakroom(key);
      else if (loc === 'conference')     this.actions.goToRoom(key, 'conference');
      else if (loc === 'storage')        this.actions.goToRoom(key, 'storage');
      else if (loc === 'manager_office') this.actions.goToRoom(key, 'manager_office');
      else if (loc === 'reception')      this.actions.goToRoom(key, 'reception');
      else if (loc === 'open_office')    this.actions.goToRoom(key, 'open_office');
      else if (loc === 'desk' && this.agents.get(key)?.assignedDesk) {
        this.actions.useComputer(key, this.agents.get(key).assignedDesk);
      }
    };

    switch (action) {
      case 'talk': {
        agent.status = 'talking';
        const targetKey = findTargetKey(target);
        if (targetKey && message) {
          this.actions.standUp(npcKey);
          // Fire the server request the moment the speaker arrives and the
          // opening bubble is shown (speakTo resolves after that happens).
          this.actions.speakTo(npcKey, targetKey, message).then(() => {
            this._send({
              type: 'npc_conversation',
              npcName: target,
              fromName: npcName,
              text: message,
              turn: 1,
            });
          });
        } else if (message) {
          this.actions.speak(npcKey, message);
        }
        break;
      }

      case 'collaborate': {
        // Two NPCs go to a location together and have a conversation
        const targetKey = findTargetKey(target);
        if (targetKey && message) {
          this.actions.standUp(npcKey);
          this.actions.standUp(targetKey);
          agent.status = 'collaborating';

          const targetAgent = this.agents.get(targetKey);
          if (targetAgent) targetAgent.status = 'collaborating';

          // Both walk to the location
          if (location && location !== 'desk') {
            goToLocation(npcKey, location);
            this.scene.time.delayedCall(1000, () => goToLocation(targetKey, location));
          }

          // Initiator speaks first, then server is notified on arrival
          this.scene.time.delayedCall(3000, () => {
            this.actions.speakTo(npcKey, targetKey, message).then(() => {
              this._send({
                type: 'npc_conversation',
                npcName: target,
                fromName: npcName,
                text: message,
                turn: 1,
              });
            });
          });

          // Both return to desks after collaboration
          this.scene.time.delayedCall(20000, () => {
            if (agent.assignedDesk) {
              this.actions.useComputer(npcKey, agent.assignedDesk);
              agent.status = 'working';
            }
            if (targetAgent?.assignedDesk) {
              this.actions.useComputer(targetKey, targetAgent.assignedDesk);
              targetAgent.status = 'working';
            }
          });
        }
        break;
      }

      case 'work':
        // #6 — Ambient wander: 30% of the time, if the NPC picks "work"
        // without a fresh task/message, they take a short detour to a
        // random nearby room before settling. Adds motion across the map
        // instead of 16 NPCs glued to their desks.
        if (agent.assignedDesk) {
          const noTask = !message || message === 'Working...';
          if (noTask && Math.random() < 0.3) {
            this.actions.standUp(npcKey);
            const rooms = ['open_office', 'breakroom', 'reception', 'storage', 'conference'];
            const pick = rooms[Math.floor(Math.random() * rooms.length)];
            goToLocation(npcKey, pick);
            agent.status = 'wandering';
            // Return to desk after the ambient walk
            this.scene.time.delayedCall(9000, () => {
              if (agent.assignedDesk) {
                this.actions.useComputer(npcKey, agent.assignedDesk);
                agent.status = 'working';
              }
            });
          } else {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        } else {
          // No desk — go to breakroom rather than random center clustering
          const wx = 80 + Math.random() * 150;
          const wy = 520 + Math.random() * 80;
          this.actions.walkTo(npcKey, wx, wy);
          agent.status = 'working';
        }
        if (message) {
          this.scene.time.delayedCall(1500, () => {
            this.actions.speak(npcKey, message);
          });
        }
        break;

      case 'break': {
        this.actions.standUp(npcKey);
        agent.status = 'break';

        // If targeting someone, invite them along
        const breakTargetKey = findTargetKey(target);
        if (breakTargetKey) {
          this.actions.standUp(breakTargetKey);
          const breakTargetAgent = this.agents.get(breakTargetKey);
          if (breakTargetAgent) breakTargetAgent.status = 'break';
          this.actions.goToBreakroom(breakTargetKey);
        }

        this.actions.goToBreakroom(npcKey);

        if (message) {
          this.scene.time.delayedCall(3000, () => {
            if (breakTargetKey) {
              this.actions.speakTo(npcKey, breakTargetKey, message);
              // Get AI response from break partner
              this.scene.time.delayedCall(2000, () => {
                this._send({
                  type: 'npc_conversation',
                  npcName: target,
                  fromName: npcName,
                  text: message,
                });
              });
            } else {
              this.actions.speak(npcKey, message);
            }
          });
        }

        // Return to desk after break (~30s)
        this.scene.time.delayedCall(30000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          } else {
            agent.status = 'idle';
          }
          if (breakTargetKey) {
            const bta = this.agents.get(breakTargetKey);
            if (bta?.assignedDesk) {
              this.actions.useComputer(breakTargetKey, bta.assignedDesk);
              bta.status = 'working';
            } else if (bta) {
              bta.status = 'idle';
            }
          }
        });
        break;
      }

      case 'check':
        this.actions.standUp(npcKey);
        agent.status = 'checking';
        if (location) {
          goToLocation(npcKey, location);
        } else if (message?.toLowerCase().includes('server')) {
          this.actions.goToRoom(npcKey, 'storage');
        } else if (message?.toLowerCase().includes('research')) {
          this.actions.checkBookshelf(npcKey);
        } else {
          this.actions.goToRoom(npcKey, 'open_office');
        }
        if (message) {
          this.scene.time.delayedCall(2000, () => {
            this.actions.speak(npcKey, message);
          });
        }
        // Return to desk after
        this.scene.time.delayedCall(12000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;

      case 'report': {
        // Task completion — visual "clock out" to manager
        const reportTargetKey = findTargetKey(target);
        this.actions.standUp(npcKey);
        agent.status = 'reporting';
        this.actions.emote(npcKey, '!');

        if (reportTargetKey) {
          // Walk toward manager, then speak
          this.scene.time.delayedCall(1500, () => {
            this.actions.speakTo(npcKey, reportTargetKey, message || 'Task complete.');
            // Request AI response from the manager
            this.scene.time.delayedCall(2000, () => {
              this._send({
                type: 'npc_conversation',
                npcName: target,
                fromName: npcName,
                text: message || 'Task complete.',
              });
            });
          });
        } else if (message) {
          this.scene.time.delayedCall(1500, () => {
            this.actions.speak(npcKey, message);
          });
        }

        // Return to desk after reporting
        this.scene.time.delayedCall(15000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;
      }

      case 'error': {
        // API error — NPC goes to breakroom to "reset"
        this.actions.emote(npcKey, '!');
        agent.status = 'error';

        this.scene.time.delayedCall(1000, () => {
          this.actions.standUp(npcKey);
        });

        this.scene.time.delayedCall(2000, () => {
          this.actions.goToBreakroom(npcKey);
        });

        // Show truncated error message as speech once in breakroom
        this.scene.time.delayedCall(5000, () => {
          const errorText = (message || 'Error').slice(0, 80) + ' — taking a break';
          this.actions.speak(npcKey, errorText);
        });

        // After 20 seconds, walk back to desk and resume
        this.scene.time.delayedCall(20000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          } else {
            agent.status = 'idle';
          }
        });
        break;
      }

      case 'read': {
        // Walk to the bookshelf and read. Represents research / looking things up.
        agent.status = 'reading';
        this.actions.standUp(npcKey);
        this.actions.checkBookshelf(npcKey);
        if (message) {
          this.scene.time.delayedCall(2500, () => this.actions.think(npcKey, message));
        }
        // Return to desk after a reading cycle
        this.scene.time.delayedCall(18000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;
      }

      case 'visit': {
        // Drop-by check-in — walk to coworker's desk without necessarily talking.
        const visitTargetKey = findTargetKey(target);
        if (!visitTargetKey) break;
        agent.status = 'visiting';
        this.actions.standUp(npcKey);
        this.actions.visit(npcKey, visitTargetKey);
        if (message) {
          this.scene.time.delayedCall(2500, () => {
            this.actions.speakTo(npcKey, visitTargetKey, message);
          });
        }
        // Return to desk after a short visit
        this.scene.time.delayedCall(14000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;
      }

      case 'coffee': {
        // Grab a coffee / snack. Short breakroom hop.
        agent.status = 'break';
        this.actions.standUp(npcKey);
        this.actions.goToCoffee(npcKey);
        if (message) {
          this.scene.time.delayedCall(3000, () => this.actions.speak(npcKey, message));
        }
        this.scene.time.delayedCall(12000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;
      }

      case 'wander': {
        // Stretch the legs — walk to the NPC's natural hangout room, or a
        // random room if location is unspecified. Used sparingly by the model.
        agent.status = 'wandering';
        this.actions.standUp(npcKey);
        const wanderRooms = ['open_office', 'breakroom', 'conference', 'reception', 'storage', 'manager_office'];
        const pick = location && wanderRooms.indexOf(location) !== -1
          ? location
          : wanderRooms[Math.floor(Math.random() * wanderRooms.length)];
        goToLocation(npcKey, pick);
        if (message) {
          this.scene.time.delayedCall(3500, () => this.actions.speak(npcKey, message));
        }
        this.scene.time.delayedCall(12000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            agent.status = 'working';
          }
        });
        break;
      }

      case 'meeting': {
        agent.status = 'meeting';
        this.actions.standUp(npcKey);
        if (message) this.actions.speak(npcKey, message);
        this.actions.joinMeeting(npcKey);

        // Pull attendees into the conference room alongside the caller.
        // If the think decision named a specific target, bring them.
        // If not, managers (cofounder / project_mgr / product_mgr) pull
        // up to 2 idle coworkers so the room doesn't look empty.
        const meetingAttendeeKeys = [];
        const explicitTargetKey = findTargetKey(target);
        if (explicitTargetKey) {
          meetingAttendeeKeys.push(explicitTargetKey);
        } else if (['cofounder', 'project_mgr', 'product_mgr'].includes(agent.role)) {
          const candidates = [...this.agents.entries()]
            .filter(([k, a]) => k !== npcKey && a.status !== 'meeting' && a.status !== 'walking')
            .slice(0, 2)
            .map(([k]) => k);
          meetingAttendeeKeys.push(...candidates);
        }

        meetingAttendeeKeys.forEach((attendeeKey, i) => {
          const attendeeAgent = this.agents.get(attendeeKey);
          if (!attendeeAgent) return;
          attendeeAgent.status = 'meeting';
          this.scene.time.delayedCall(800 + i * 600, () => {
            this.actions.standUp(attendeeKey);
            this.actions.joinMeeting(attendeeKey);
          });
        });

        const allMeetingKeys = [npcKey, ...meetingAttendeeKeys];

        // Everyone returns to their desks after ~30s
        this.scene.time.delayedCall(30000, () => {
          allMeetingKeys.forEach(k => {
            const a = this.agents.get(k);
            if (!a || a.status !== 'meeting') return;
            a.status = 'working';
            a._taskLabel = null;
            this.actions.standUp(k);
            if (a.assignedDesk) {
              setTimeout(() => this.actions.useComputer(k, a.assignedDesk), 1500);
            }
          });
        });
        break;
      }

      case 'run_skill': {
        // NPC is running an OpenClaw skill — treat visually like "work" (sit at desk)
        // The skill runs server-side; the NPC picks up the result in their next think cycle.
        agent.status = 'working';
        if (agent.assignedDesk) {
          this.actions.useComputer(npcKey, agent.assignedDesk);
        }
        if (message) {
          this.scene.time.delayedCall(1200, () => {
            this.actions.speak(npcKey, message);
          });
        }
        break;
      }

      default:
        if (agent.assignedDesk) {
          this.actions.useComputer(npcKey, agent.assignedDesk);
          agent.status = 'working';
        }
    }

    // ── Directive cascade: when a manager explicitly delegates, push a real directive ──
    // Covers a 'delegate' action (future) and talk actions explicitly flagged as assignments.
    if (decision && decision.target && decision.message &&
        (decision.action === 'delegate' ||
         (decision.action === 'talk' && decision._isAssignment))) {
      this._send({
        type: 'npc_assign_directive',
        from: npcName,
        to: decision.target,
        task: decision.message,
      });
    }
  }

  // ---- WebSocket Connection ----

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const existing = window.__DenizenAgentWs;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      this.ws = existing;
      this.connected = existing.readyState === WebSocket.OPEN;
      existing.onmessage = (evt) => {
        try {
          this._handleServerMessage(JSON.parse(evt.data));
        } catch (err) {
          console.warn('[AgentManager] Failed to parse message:', err);
        }
      };
      existing.onopen = () => {
        this.connected = true;
        this._reconnectAttempt = 0;
        this.scene?._playerChat?.setWsConnected?.(true);
        const sess = globalThis.DenizenVisitorSession;
        if (sess?.getSessionId?.()) {
          sess.registerWebSocket(existing);
        } else {
          this._send({ type: 'visitor_register', is_ceo: true });
        }
        this._loadOfficeConfig();
        this._sendClientProfile();
        this._sendOfficeState();
      };
      existing.onclose = () => {
        this.connected = false;
        this.scene?._playerChat?.setWsConnected?.(false);
        this._scheduleReconnect();
      };
      existing.onerror = () => {
        this.connected = false;
        this.scene?._playerChat?.setWsConnected?.(false);
      };
      if (this.connected) {
        this.scene?._playerChat?.setWsConnected?.(true);
        const sess = globalThis.DenizenVisitorSession;
        if (sess?.getSessionId?.()) {
          sess.registerWebSocket(existing);
        } else {
          this._send({ type: 'visitor_register', is_ceo: true });
        }
        this._sendOfficeState();
      }
      console.log('[AgentManager] Reusing early chat WebSocket');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Connect to same host/port as the page (server.js serves both HTTP and WS)
    const routed = globalThis.DenizenSpectateRouting?.resolveAgentWsUrl?.();
    const url = routed || `${protocol}//${window.location.host}/agent-ws`;

    console.log('[AgentManager] Connecting to', url);

    try {
      this.ws = new WebSocket(url);
      // Expose globally so other modules (voice-gate, openclaw-chat) can
      // listen on the same connection without opening a second one.
      window.__DenizenAgentWs = this.ws;
    } catch (err) {
      console.warn('[AgentManager] WebSocket creation failed:', err);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[AgentManager] Connected to agent WebSocket');
      this.connected = true;
      this._reconnectAttempt = 0;
      this.scene?._playerChat?.setWsConnected?.(true);

      const sess = globalThis.DenizenVisitorSession;
      if (sess?.getSessionId?.()) {
        sess.registerWebSocket(this.ws);
      } else {
        this._send({ type: 'visitor_register', is_ceo: true });
      }

      this._loadOfficeConfig();
      this._sendClientProfile();
      this._sendOfficeState();
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        this._handleServerMessage(msg);
      } catch (err) {
        console.warn('[AgentManager] Failed to parse message:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('[AgentManager] WebSocket closed');
      this.connected = false;
      this.scene?._playerChat?.setWsConnected?.(false);
      this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('[AgentManager] WebSocket error:', err);
      this.scene?._playerChat?.setWsConnected?.(false);
    };
  }

  _bindRemoteReconnect() {
    if (this._remoteReconnectBound) return;
    this._remoteReconnectBound = true;
    window.addEventListener('online', () => this.connect());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.connect();
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = Math.min(2000 * Math.pow(2, this._reconnectAttempt), 30000);
    this._reconnectAttempt++;
    console.log(`[AgentManager] Reconnecting in ${delay}ms`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Send a message to the server
   */
  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Handle messages from the server (cofounder agent commands)
   */
  _shouldHandleOfficeMsg(msg) {
    const target = msg?.office_id || msg?.officeId;
    if (!target) return true;
    const mine = window.__DenizenOfficeId
      || globalThis.DenizenVisitorSession?.getOfficeId?.()
      || null;
    if (!mine) return window.__DenizenCeoMode || !!window.__DenizenIsOperatorOffice;
    if (target === mine) return true;
    if (target === 'ceo-operator' && (window.__DenizenIsOperatorOffice || window.__DenizenCeoMode)) {
      return true;
    }
    return false;
  }

  _handleServerMessage(msg) {
    if (!this._shouldHandleOfficeMsg(msg)) return;

    // Demo mode: still allow CEO-facing replies (chat, search briefs, browser mirror).
    const _demoCeoTypes = new Set([
      'player_chat_response',
      'npc_report_to_ceo',
      'research_brief_done',
      'npc_skill_start',
      'npc_skill_result',
      'lucy_browser_mirror',
      'lucy_browser_frame',
      'npc_browser_mirror',
      'npc_browser_frame',
      'bouncer_security',
    ]);
    if (this._demoMode && !_demoCeoTypes.has(msg.type)) return;
    // Per-message console.log was firing ~5/sec across the batched
    // world_state_batch + the per-NPC npc_decision traffic — fine for
    // the first day but unreadable now. Decision logs already happen
    // inside _executeNpcDecision; world-state mirror is silent on
    // purpose. We only surface unknown types now (see `default:`).

    switch (msg.type) {
      case 'office_registered':
        globalThis.DenizenVisitorSession?.applyOfficeRegistration?.(msg);
        window.__DenizenOfficeId = msg.office_id || window.__DenizenOfficeId;
        window.__DenizenIsOperatorOffice = !!msg.is_operator_office;
        console.log('[AgentManager] Office registered:', msg.office_id, msg.is_operator_office ? '(operator)' : '');
        break;
      case 'office_bus_message':
        globalThis.DenizenVisitorHandoffUI?.showIncoming?.(msg);
        break;
      case 'agent_command':
        this._executeAgentCommand(msg);
        break;
      case 'spawn_agent':
        this._spawnAgent(msg);
        break;
      case 'cofounder_speak':
        this._cofounderSpeak(msg);
        break;
      case 'assign_task':
        this._assignTask(msg);
        break;
      case 'office_update':
        // Server sending office layout changes
        break;
      case 'npc_response': {
        // An NPC's brain generated a response — show it as speech
        const responderKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];
        const originalSpeakerKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.fromName?.toLowerCase()
        )?.[0];

        if (responderKey) {
          this.actions.speak(responderKey, msg.text);
          console.log(`[AgentManager] ${msg.npcName} responds to ${msg.fromName}: "${msg.text}"`);
        }

        // Reply-back loop: if we're under the turn cap, have the original
        // speaker say something back. Creates a natural two-way conversation
        // instead of the one-shot "A speaks, B replies" we had before.
        // Raised from 2 to 4 — gives conversations room to actually exchange
        // ideas instead of A-speaks/B-replies/done. NPCs can now follow up,
        // disagree, or build on each other's lines across 4 turns.
        const MAX_CHAT_TURNS = 4;
        const currentTurn = typeof msg.turn === 'number' ? msg.turn : 1;
        const canReplyBack =
          responderKey &&
          originalSpeakerKey &&
          msg.text &&
          !msg.text.toLowerCase().includes('no reply') &&
          currentTurn < MAX_CHAT_TURNS;

        if (canReplyBack) {
          // Estimate how long the TTS for this reply will take (~100ms/char, min 2s)
          // so the next turn fires AFTER the speaker finishes talking, not before.
          const estSpeakMs = Math.max(2000, Math.min((msg.text?.length || 0) * 95, 8000));

          this.scene.time.delayedCall(estSpeakMs + 600, () => {
            // Walk the responder toward the original speaker so the
            // conversation has spatial weight.
            const targetSprite = this.actions._getNpc(originalSpeakerKey);
            if (targetSprite) {
              try { this.actions.walkTo(responderKey, targetSprite.x - 24, targetSprite.y); }
              catch (_) { /* sprite gone — okay */ }
            }

            // Register a one-shot callback so the NEXT npc_response from the
            // original speaker resolves here, keeping turns in lock-step.
            // Key: "<speakerName>→<responderName>" so multiple simultaneous
            // conversations don't cross-wire.
            const key = `${msg.fromName}→${msg.npcName}`;
            if (!this._npcConvoCallbacks) this._npcConvoCallbacks = {};
            this._npcConvoCallbacks[key] = null; // mark as pending

            this._send({
              type: 'npc_conversation',
              npcName: msg.fromName,   // original speaker responds now
              fromName: msg.npcName,   // responder is now the listener
              text: msg.text,
              turn: currentTurn + 1,
            });
          });
        }
        break;
      }
      case 'npc_decision': {
        // NPC's autonomous decision from LM Studio think loop
        this._executeNpcDecision(msg.npcName, msg.decision || {});
        break;
      }
      case 'npc_cascade': {
        // A leader's decision cascading down to a report
        const cascadeTargetKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];
        const cascadeFromKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.fromName?.toLowerCase()
        )?.[0];
        if (cascadeTargetKey && cascadeFromKey && msg.message) {
          // The leader speaks to the report, then request a reply on arrival
          console.log('[Cascade] ' + msg.fromName + ' -> ' + msg.npcName + ': "' + msg.message + '"');
          this.actions.speakTo(cascadeFromKey, cascadeTargetKey, msg.message).then(() => {
            this._send({
              type: 'npc_conversation',
              npcName: msg.npcName,
              fromName: msg.fromName,
              text: msg.message,
              turn: 1,
            });
          });
        }
        break;
      }
      case 'player_chat_ack': {
        if (this.scene._playerChat && msg.npcName) {
          this.scene._playerChat.logPlayerChatAck(msg.npcName, msg.queueLen);
        }
        break;
      }
      case 'bouncer_security': {
        const bKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0] || 'xp_bouncer';
        const line = String(msg.text || '').trim();
        if (line) {
          window.DenizenSecurityFeed?.ingest?.({ text: line, kind: 'incident' });
          try { this.actions.speak(bKey, line.slice(0, 120)); } catch (_) {}
          window.DenizenSecurityFeed?.show?.();
        }
        break;
      }
      case 'player_chat_response': {
        // NPC responding to the CEO (player) — route to PlayerChat UI
        const respondingKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];

        // Tell PlayerChat whether there are actions (so it knows whether to auto-resume)
        const hasActions = Array.isArray(msg.actions) && msg.actions.length > 0;
        if (this.scene._playerChat) {
          this.scene._playerChat._hasActions = hasActions;
          this.scene._playerChat.handleNpcResponse(msg.npcName, msg.text, msg.delegation, msg.error, {
            crmActions: msg.crm_actions,
          });
          globalThis.DenizenCrmBridge?.handlePlayerChatResponse?.(msg);
        } else if (respondingKey) {
          this.actions.speak(respondingKey, msg.text);
        }

        // Execute any actions the NPC decided to take
        if (respondingKey && hasActions) {
          const leaving = msg.actions.some((a) => (
            ['useComputer', 'goToRoom', 'goToBreakroom', 'checkBookshelf', 'standUp'].includes(a.action)
          ));
          if (leaving && this.scene._playerChat?._ceoConvo?.npcKey === respondingKey) {
            this.scene._playerChat._endCeoConversation('npc leaving to work');
          }
          this._executeNpcActions(respondingKey, msg.npcName, msg.actions);
        }

        console.log(`[AgentManager] ${msg.npcName} responds to CEO: "${msg.text}"${msg.delegation ? ` [delegating to ${msg.delegation.delegateTo}]` : ''}${msg.actions?.length ? ` [${msg.actions.length} actions]` : ''}`);
        break;
      }
      case 'player_group_chat_response': {
        if (this.scene._playerChat) {
          this.scene._playerChat.handleGroupResponse(msg.groupId, msg.npcName, msg.text, msg.error);
        }
        break;
      }
      case 'voice_chat_filler':
      case 'voice_chat_token':
      case 'voice_chat_sentence':
      case 'voice_chat_done':
      case 'player_chat_cancelled': {
        globalThis.DenizenVoiceSession?.handleWsMessage?.(msg);
        if (msg.type === 'voice_chat_token' && this.scene._playerChat) {
          this.scene._playerChat.handleVoiceStreamToken?.(msg.npcName, msg.token);
        }
        if (msg.type === 'player_chat_cancelled' && this.scene._playerChat) {
          this.scene._playerChat.handlePlayerChatCancelled?.(msg);
        }
        break;
      }
      case 'station_task_enqueued': {
        this._addWorkFeedEntry(
          msg.npcName || 'Station',
          '⚙',
          `Queued on your Denizen station${msg.kind ? ` (${msg.kind})` : ''}`,
          null,
        );
        if (this.scene?._workFeed) {
          this.scene._workFeed.addEntry({
            npcName: msg.npcName || 'Station',
            phase: 'queued',
            phaseEmoji: '⚙',
            note: `Station task${msg.kind ? `: ${msg.kind}` : ''}`,
            action: msg.taskId || '',
            ts: msg.ts || Date.now(),
          });
        }
        break;
      }
      case 'bouncer_honeypot': {
        // Bouncer set up a honeypot — surface it in the player chat panel
        if (this.scene._playerChat) {
          this.scene._playerChat._addToLog('Bouncer', `🍯 ${msg.message || 'Honeypot set.'}`);
        }
        break;
      }
      case 'bouncer_linux_status': {
        if (this._isCeoChatWithOtherNpc()) break;
        const bouncerKey = 'xp_bouncer';
        const showTerminal = /terminal/i.test(String(msg.message || ''));
        if (showTerminal) {
          if (this.scene._playerChat) {
            this.scene._playerChat._addToLog('Bouncer', `🐉 ${msg.message || 'Running Kali Linux commands...'}`);
          }
          try { this.actions.speak(bouncerKey, 'Opening Kali Linux terminal...'); } catch (_) {}
          const ba = this.agents?.get(bouncerKey);
          if (ba?.assignedDesk) { try { this.actions.useComputer(bouncerKey, ba.assignedDesk); } catch (_) {} }
        }
        break;
      }
      case 'bouncer_linux_result': {
        if (this._isCeoChatWithOtherNpc()) break;
        const bouncerKey = 'xp_bouncer';
        if (!this._bouncerLinuxChatAllowed(msg.threat)) break;
        if (this.scene._playerChat) {
          if (msg.status === 'done') {
            const stepCount = Array.isArray(msg.steps) ? msg.steps.length : '?';
            const ipNote    = msg.ip ? ` [attacker: ${msg.ip}]` : '';
            this.scene._playerChat._addToLog('Bouncer', `🐉 Kali done (${(msg.elapsed / 1000 || 0).toFixed(1)}s, ${stepCount} commands${ipNote}) — see report above.`);
          } else {
            this.scene._playerChat._addToLog('Bouncer', `⚠ Kali Linux error: ${msg.message}`);
          }
        }
        if (msg.status === 'done') {
          try { this.actions.emote(bouncerKey, '!'); } catch (_) {}
        }
        break;
      }
      case 'bouncer_player_order': {
        if (msg.order === 'confront') {
          const ok = this._bouncerConfrontOnPlayerOrder();
          if (!ok) {
            this._bouncerSecurityStatus('No active intruder on the map to confront.', 'status');
          }
        } else if (msg.order === 'deploy_honeypot') {
          const hp = this._bouncerHoneypotOnPlayerOrder();
          if (this.scene._playerChat) {
            const note = hp.deployed
              ? `Honeypot deployed${hp.spot ? ` at (${Math.round(hp.spot.x)}, ${Math.round(hp.spot.y)})` : ''} — I will catch the next one within 120px.`
              : 'Honeypot is already active — still watching.';
            this.scene._playerChat._addToLog('Bouncer', note);
          }
        } else if (msg.order === 'honeypot_status') {
          if (this.scene._playerChat) {
            if (this._honeypotActive) {
              const s = this._honeypotSpot;
              const where = s ? ` at (${Math.round(s.x)}, ${Math.round(s.y)})` : '';
              this.scene._playerChat._addToLog('Bouncer', `Honeypot is armed${where} — watching for intruders within 120px.`);
            } else {
              this.scene._playerChat._addToLog('Bouncer', 'Honeypot is not armed right now. Say "deploy honeypot" if you want one set.');
            }
          }
        }
        break;
      }
      case 'bouncer_tool_status': {
        // Legacy desktop-tool path — zenmap/nmap now run via Kali only; keep wireshark msgs quiet.
        if (msg.tool === 'zenmap' || msg.tool === 'nmap') break;

        const bouncerKey = 'xp_bouncer';
        const bouncerAgent = this.agents?.get(bouncerKey);
        const toolIcon = msg.tool === 'zenmap' ? '🗺' : '🦈';
        const toolName = msg.tool === 'zenmap' ? 'Zenmap' : 'Wireshark';

        if (msg.status === 'starting') {
          if (this.scene._playerChat) {
            this.scene._playerChat._addToLog('Bouncer', `${toolIcon} Running ${toolName} on ${msg.threat?.source || 'the network'}...`);
          }
          // Show the Bouncer at his desk typing (he's working the tool)
          if (bouncerAgent?.assignedDesk) {
            this.actions.useComputer(bouncerKey, bouncerAgent.assignedDesk);
          }
        } else if (msg.status === 'done') {
          if (this.scene._playerChat) {
            this.scene._playerChat._addToLog('Bouncer', `${toolIcon} ${toolName} scan complete — ${msg.steps || '?'} steps. Check your screen for the results.`);
          }
          // Bouncer emotes satisfaction
          this.actions.emote(bouncerKey, '✓');
        } else if (msg.status === 'error') {
          if (this.scene._playerChat) {
            this.scene._playerChat._addToLog('Bouncer', `⚠ ${toolName} couldn't run: ${msg.message || 'unknown error'}. Is it installed?`);
          }
        }

        // Also show a speech bubble on the Bouncer sprite
        const bubbleText = {
          starting: `${toolIcon} Running ${toolName}...`,
          done:     `${toolIcon} ${toolName} done.`,
          error:    `⚠ ${toolName} failed.`,
        }[msg.status];
        if (bubbleText) {
          try { this.actions.speak(bouncerKey, bubbleText); } catch (_) {}
        }
        break;
      }
      case 'npc_work_output': {
        // An NPC started, continued, or finished a task — show in the work feed
        this._addWorkFeedEntry(msg.npcName, msg.phaseEmoji || '•', msg.note || '', msg.artifactPath || null);
        // Also forward to the DOM-based Work Feed HUD panel (Tab to toggle)
        if (this.scene?._workFeed) {
          this.scene._workFeed.addEntry({
            npcName:      msg.npcName      || '?',
            phase:        msg.phase        || '',
            phaseEmoji:   msg.phaseEmoji   || '•',
            note:         msg.note         || '',
            action:       msg.action       || '',
            artifactPath: msg.artifactPath || null,
            ts:           msg.ts           || Date.now(),
          });
        }
        break;
      }
      case 'agent_error': {
        // CofounderAgent hit an error — show the NPC going to breakroom
        const errorAgentKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.agentId?.toLowerCase()
        )?.[0];
        if (errorAgentKey) {
          const errorAgent = this.agents.get(errorAgentKey);
          if (errorAgent && errorAgent.status !== 'error') {
            errorAgent.status = 'error';
            this.actions.emote(errorAgentKey, '!');
            this.scene.time.delayedCall(1000, () => {
              this.actions.standUp(errorAgentKey);
            });
            this.scene.time.delayedCall(2000, () => {
              this.actions.goToBreakroom(errorAgentKey);
            });
            this.scene.time.delayedCall(5000, () => {
              const errText = (msg.message || 'API error').slice(0, 60) + ' — resetting';
              this.actions.speak(errorAgentKey, errText);
            });
            // Return to desk after 20 seconds
            this.scene.time.delayedCall(20000, () => {
              if (errorAgent.assignedDesk) {
                this.actions.useComputer(errorAgentKey, errorAgent.assignedDesk);
              }
              errorAgent.status = 'idle';
            });
          }
        }
        break;
      }
      case 'npc_email_arrived': {
        // n8n said new mail landed → secretary NPC walks to her desk
        // and emotes so the player sees the office responding to a
        // real outside event. Pure visual flourish; the actual draft
        // composition already happened server-side.
        const secKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === String(msg.npcName || '').toLowerCase()
        )?.[0];
        if (!secKey) break;
        const agent = this.agents.get(secKey);
        if (!agent || agent.status === 'task_override') break;
        try {
          this.actions.standUp(secKey);
          this.actions.emote(secKey, msg.escalated ? '!' : '✉');
          if (agent.assignedDesk) {
            this.scene.time.delayedCall(800, () => {
              this.actions.useComputer(secKey, agent.assignedDesk);
              agent.status = 'working';
            });
          }
          // Brief line so the player can see what triggered it.
          this.scene.time.delayedCall(1500, () => {
            const preview = String(msg.subject || '').slice(0, 40);
            const line = msg.escalated
              ? `Flagged email from ${msg.from || 'someone'} — needs your eyes.`
              : `Drafting reply to ${msg.from || 'an email'}.`;
            this.actions.speak(secKey, msg.escalated ? line : preview ? `${line} Re: ${preview}` : line);
          });
        } catch (err) {
          console.warn('[AgentManager] npc_email_arrived handler failed:', err?.message || err);
        }
        break;
      }
      case 'furniture_placed': {
        // Live spawn — the server just persisted a new item via
        // /api/place-furniture. Try to instantiate the sprite immediately
        // so the placement is visible without a reload. Falls back to a
        // simple console log if the editor bridge isn't loaded yet (e.g.
        // headless tests). Either way the layout file has the truth.
        const item = msg.item;
        const by = msg.by || 'an NPC';
        if (item && window.DenizenLiveFurniture?.spawn) {
          const placement = {
            id: item.prefabId,
            instanceId: item.instanceId,
            x: item.x,
            y: item.y,
          };
          const entry = window.DenizenLiveFurniture.spawn(placement);
          if (entry) {
            console.log(`[AgentManager] Live-spawned ${item.prefabId} (${item.instanceId}) placed by ${by}`);
            // Brief visual flourish on the placer so the player can see
            // who's responsible without staring at logs.
            const placerKey = Object.entries(this.NPC_NAMES).find(
              ([k, v]) => v.toLowerCase() === String(by).toLowerCase()
            )?.[0];
            if (placerKey && this.actions?.emote) this.actions.emote(placerKey, 'idea');
          } else {
            console.warn(`[AgentManager] Live spawn failed for ${item.prefabId} — will appear on next reload`);
          }
        }
        break;
      }
      case 'furniture_removed': {
        const instanceId = msg.instanceId;
        if (instanceId && window.DenizenLiveFurniture?.remove) {
          const ok = window.DenizenLiveFurniture.remove(instanceId);
          console.log(`[AgentManager] Live-removed ${instanceId} (${ok ? 'success' : 'not found'})`);
        }
        break;
      }
      case 'world_state_batch': {
        // Batched worldState mutations from the server (~200ms cadence).
        // Mirror into window.DenizenWorldState so other browser modules
        // (diag panel, operator UI, future indicators) can read current
        // NPC mood/fatigue/stuck-loop/lastAddressed without hitting the
        // HTTP endpoint per tick.
        if (typeof window !== 'undefined') {
          const mirror = window.DenizenWorldState = window.DenizenWorldState || {
            npcs: {}, threats: [], environment: {}, events: [], at: 0,
          };
          mirror.at = msg.ts || Date.now();
          if (Array.isArray(msg.changes)) {
            for (const change of msg.changes) {
              const k = change?.kind;
              const p = change?.payload;
              if (!k) continue;
              if (k === 'npc' && p?.name) {
                mirror.npcs[p.name] = p.state || mirror.npcs[p.name] || {};
              } else if (k === 'threat' && p) {
                mirror.threats.unshift(p);
                if (mirror.threats.length > 16) mirror.threats.length = 16;
              } else if (k === 'environment' && p) {
                mirror.environment = { ...mirror.environment, ...p };
              } else if (k === 'event' && p) {
                mirror.events.unshift(p);
                if (mirror.events.length > 32) mirror.events.length = 32;
              } else if (k === 'presence' && p) {
                mirror.environment.zionPresent = !!p.zionPresent;
              }
            }
          }
          if (Array.isArray(msg.busMessages) && msg.busMessages.length) {
            try {
              window.dispatchEvent(new CustomEvent('denizen-agent-bus', {
                detail: { messages: msg.busMessages, ts: msg.ts || Date.now() },
              }));
            } catch (_) {}
          }
          // Fan out a single "tick" event so subscribers can poll.
          try {
            window.dispatchEvent(new CustomEvent('denizen:worldstate', {
              detail: { ts: mirror.at, changeCount: msg.changes?.length || 0 },
            }));
          } catch (_) { /* CustomEvent unavailable in some test contexts */ }
        }
        break;
      }
      case 'openclaw_task': {
        // Server is asking OpenClaw to do real browser automation on behalf of an NPC.
        // 1. Animate Lucy so the player can see she's handling it.
        // 2. Forward the instruction to OpenClaw via the gateway bridge.
        const lucyKey = 'xp_lucy';
        const lucyAgent = this.agents.get(lucyKey);
        if (lucyAgent) {
          lucyAgent.status = 'working';
          try {
            this.actions.standUp(lucyKey);
            this.actions.emote(lucyKey, '🌐');
            if (lucyAgent.assignedDesk) {
              this.scene.time.delayedCall(600, () => {
                this.actions.useComputer(lucyKey, lucyAgent.assignedDesk);
              });
            }
            const taskLabel = msg.meta?.jobTitle
              ? `Filling out application — ${msg.meta.jobTitle} at ${msg.meta.company}`
              : 'Handling web task via OpenClaw...';
            this.scene.time.delayedCall(1000, () => {
              this.actions.speak(lucyKey, taskLabel.slice(0, 80));
            });
          } catch (err) {
            console.warn('[AgentManager] openclaw_task Lucy animation failed:', err?.message);
          }
        }

        // Forward to OpenClaw gateway
        const bridge = window.__DenizenGatewayBridge;
        if (bridge && bridge.connected) {
          bridge.sendChat(msg.instruction || JSON.stringify(msg), { urgent: false })
            .then(r => console.log('[AgentManager] openclaw_task sent to gateway:', r))
            .catch(err => console.warn('[AgentManager] openclaw_task gateway send failed:', err?.message));
        } else {
          console.warn('[AgentManager] openclaw_task: gateway not connected — task not forwarded to OpenClaw');
          if (lucyAgent) {
            this.scene.time.delayedCall(2000, () => {
              this.actions.speak(lucyKey, 'OpenClaw not connected — check the gateway.');
            });
          }
        }
        break;
      }
      case 'directive_assigned': {
        // A directive was pushed to an NPC (manager → report). Log it and
        // optionally animate the target NPC so the player sees they have a task.
        const targetKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.to?.toLowerCase()
        )?.[0];
        console.log(`[Directive] ${msg.from} → ${msg.to}: "${String(msg.task || '').slice(0, 60)}"`);
        if (targetKey) {
          try { this.actions.emote(targetKey, '!'); } catch (_) {}
        }
        break;
      }
      case 'lucy_browser_mirror':
      case 'npc_browser_mirror':
        window.DenizenBrowserMirror?.ingest?.(msg);
        break;
      case 'lucy_browser_frame':
      case 'npc_browser_frame':
        window.DenizenBrowserMirror?.onFrame?.(msg);
        break;
      case 'npc_skill_start': {
        // Desk skills animate at the desk; web-search keeps Lucy with the CEO.
        if (msg.skill === 'web-search') {
          window.DenizenBrowserMirror?.ingest?.({
            searching: true,
            open: true,
            status: 'searching',
            query: msg.skillParams?.query || '',
          });
          window.DenizenBrowserMirror?.show?.();
          break;
        }
        const skillNpcKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];
        if (skillNpcKey) {
          const inCeoConvo = this.scene._playerChat?._ceoConvo?.npcKey === skillNpcKey;
          if (inCeoConvo) break;
          const skillAgent = this.agents.get(skillNpcKey);
          if (skillAgent?.assignedDesk) {
            try { this.actions.useComputer(skillNpcKey, skillAgent.assignedDesk); } catch (_) {}
          }
        }
        break;
      }
      case 'npc_skill_result': {
        if (msg.skill === 'web-search' && this.scene._playerChat?._lucySearchActive) {
          this.scene._playerChat._lucySearchActive = null;
        }
        const skillResultKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];
        if (skillResultKey) {
          try {
            this.actions.emote(skillResultKey, msg.ok ? '✓' : '!');
          } catch (_) {}
        }
        // web-search already posts a full brief via npc_report_to_ceo — skip robot status line.
        if (this.scene._playerChat && msg.skill !== 'web-search') {
          const note = `${msg.npcName} finished running ${msg.skill}${msg.ok ? '' : ' (error)'}.`;
          this.scene._playerChat._addToLog(msg.npcName, note);
        }
        break;
      }
      case 'meeting_convene': {
        // Walk participants into the conference room so the discussion is visible.
        const names = msg.participants || [];
        names.forEach((name, i) => {
          const k = Object.entries(this.NPC_NAMES).find(([kk, v]) => v.toLowerCase() === name.toLowerCase())?.[0];
          if (k) {
            this.scene.time.delayedCall(i * 400, () => {
              try { this.actions.standUp(k); this.actions.goToRoom(k, 'conference'); } catch (_) {}
            });
            const ag = this.agents.get(k); if (ag) ag.status = 'meeting';
          }
        });
        if (this.scene._playerChat) this.scene._playerChat._addToLog('System', `Meeting started: "${msg.topic}" — ${names.join(', ')}`);
        break;
      }
      case 'npc_meeting_turn': {
        // One participant speaks — show it as a bubble over them.
        const k = Object.entries(this.NPC_NAMES).find(([kk, v]) => v.toLowerCase() === msg.npcName?.toLowerCase())?.[0];
        if (k) { try { this.actions.speak(k, String(msg.text).slice(0, 160)); } catch (_) {} }
        if (this.scene._playerChat) this.scene._playerChat._addToLog(msg.npcName, msg.text);
        break;
      }
      case 'meeting_adjourn': {
        // Send everyone back to their desks; surface the decision + action items.
        (msg.participants || []).forEach((name, i) => {
          const k = Object.entries(this.NPC_NAMES).find(([kk, v]) => v.toLowerCase() === name.toLowerCase())?.[0];
          if (k) {
            const ag = this.agents.get(k);
            this.scene.time.delayedCall(i * 400, () => {
              try { if (ag?.assignedDesk) this.actions.useComputer(k, ag.assignedDesk); else this.actions.goToRoom(k, 'open_office'); } catch (_) {}
            });
            if (ag) ag.status = 'working';
          }
        });
        if (this.scene._playerChat) {
          const items = (msg.actionItems || []).map(a => `${a.to}: ${a.task}`).join(' | ');
          this.scene._playerChat._addToLog('System', `Meeting wrapped: "${msg.topic}".${items ? ' Action items → ' + items : ''}`);
        }
        if (this.scene?._workFeed && msg.artifactPath) {
          try { this.scene._workFeed.add?.({ npc: 'Team', kind: 'meeting', text: `Meeting notes: ${msg.artifactPath}` }); } catch (_) {}
        }
        break;
      }
      case 'npc_report_to_ceo': {
        const lucySearchResult = this.scene._playerChat?._lucySearchActive != null;
        if (this.scene._playerChat?._lucySearchActive) {
          this.scene._playerChat._lucySearchActive = null;
        }
        // An NPC is following through on a promise it made the CEO. Surface it
        // so "I'll report back" actually reaches you: chat log + bubble + emote.
        // Discord/Slack fan-out is server-side only — job_standup and other
        // standup events are already broadcast from server.js when configured.
        const reporterKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];
        if (reporterKey) {
          try { this.actions.emote(reporterKey, '📋'); } catch (_) {}
          try { this.actions.speak(reporterKey, String(msg.text).slice(0, 120)); } catch (_) {}
        }
        const pc = this.scene._playerChat || window.__DenizenPlayerChat;
        if (pc) {
          if (typeof pc._onNpcReport === 'function') {
            pc._onNpcReport(msg.npcName, msg.text);
          } else {
            const prefix = lucySearchResult ? '' : '[report] ';
            pc._addToLog(msg.npcName, `${prefix}${msg.text}`);
          }
        }
        break;
      }
      case 'research_brief_done': {
        if (this.scene._playerChat) {
          const who = msg.npcName || 'Bob';
          const topic = msg.topic ? `"${msg.topic}"` : 'topic';
          const detail = msg.path || msg.summary || msg.text || 'brief ready';
          this.scene._playerChat._addToLog(who, `[research brief] ${topic}: ${detail}`);
        }
        break;
      }
      case 'research_queue_update': {
        if (this.scene._playerChat) {
          const pending = typeof msg.pending === 'number' ? msg.pending : null;
          const added = msg.topic ? `Added "${msg.topic}"` : 'Queue updated';
          const count = pending != null ? ` — ${pending} pending` : '';
          this.scene._playerChat._addToLog(msg.npcName || 'Lucy', `[research queue] ${added}${count}`);
        }
        break;
      }
      case 'job_standup':
      case 'job_crm_event':
      case 'crm_event': {
        if (this.scene._playerChat) {
          const note = msg.kind === 'deal-won'
            ? `🏆 CRM: ${msg.title || 'Deal won'}${msg.value != null ? ` (${msg.value})` : ''}`
            : msg.kind === 'pipeline-brief'
              ? `📊 ${msg.text || msg.report || 'CRM pipeline brief'}`
              : msg.kind === 'task-overdue'
                ? `⏰ ${msg.npcName || 'Marcus'}: overdue task "${msg.title || 'Task'}"${msg.due ? ` (due ${msg.due})` : ''}`
                : msg.kind === 'at-risk'
                  ? `⚠️ ${msg.npcName || 'Marcus'}: at-risk deal "${msg.title || 'Deal'}"${msg.stage ? ` — ${msg.stage}` : ''}`
                  : msg.kind === 'setup-reminder'
                ? `📋 ${msg.npcName || 'Sarah'}: ${msg.text || 'CRM setup reminder'}`
                : (msg.report || msg.text || `CRM: ${msg.kind || msg.action || 'event'}`);
          this.scene._playerChat._addToLog(msg.npcName || 'CRM', note, {
            crmActions: Array.isArray(msg.crm_actions) ? msg.crm_actions : null,
          });
        }
        if (this.scene?._workFeed && msg.kind === 'deal-won') {
          try {
            this.scene._workFeed.addEntry({
              npcName: 'CRM',
              phase: 'deal-won',
              phaseEmoji: '🏆',
              note: `${msg.title || 'Deal won'}${msg.value != null ? ` — ${msg.value}` : ''}`,
              action: 'crm',
              ts: Date.now(),
            });
          } catch (_) {}
        }
        break;
      }
      case 'npc_mood_change': {
        // Keep agent-office-manager._moods in sync with npc-brains._npcMoods.
        // npc-brains is the source of truth for mood; manager is the display layer.
        const moodKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];
        if (moodKey) {
          // Map brain moods → manager mood strings (manager uses simpler set)
          const MOOD_MAP = {
            energized: 'excited', frustrated: 'stressed', tired: 'tired',
            excited: 'excited', focused: 'focused', stressed: 'stressed',
            neutral: 'focused',
          };
          this._setMood(moodKey, MOOD_MAP[msg.mood] || msg.mood);
        }
        break;
      }

      case 'npc_request_user_approval': {
        // An NPC (or their manager) needs the CEO to grant access before they can proceed.
        // 1. Walk the NPC to the player. 2. Emote + speak. 3. Surface an approval card in chat.
        const reqKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === msg.npcName?.toLowerCase()
        )?.[0];
        if (reqKey) {
          try {
            // Walk toward the player (use visit action so they actually approach)
            this.actions.walkToPlayer?.(reqKey) ||
              this.actions.goToRoom(reqKey, 'open_office');
          } catch (_) {}
          try { this.actions.emote(reqKey, '🙋'); } catch (_) {}
          const speakText = msg.onBehalfOf
            ? `Hey — ${msg.onBehalfOf} is blocked. Can you approve: "${String(msg.task).slice(0, 80)}"?`
            : `I need your go-ahead on: "${String(msg.task).slice(0, 80)}"`;
          try { this.actions.speak(reqKey, speakText); } catch (_) {}
        }
        if (this.scene._playerChat) {
          this.scene._playerChat._addApprovalRequest({
            npcName:    msg.npcName,
            onBehalfOf: msg.onBehalfOf || null,
            task:       msg.task || '(unknown task)',
            waitingFor: msg.waitingFor || null,
            permission: msg.permission || msg.task,
          });
        }
        break;
      }

      case 'npc_permission_granted': {
        // A permission was granted — confirm it in the chat log.
        if (this.scene._playerChat) {
          this.scene._playerChat._addToLog(
            'System',
            `✅ ${msg.npcName} granted access: "${msg.permission}"`
          );
        }
        break;
      }

      case 'npc_think_wake': {
        const wakeKey = Object.entries(this.NPC_NAMES).find(
          ([, v]) => v.toLowerCase() === msg.npcName?.toLowerCase(),
        )?.[0];
        if (wakeKey) this._npcThinkLoop(wakeKey);
        break;
      }

      case 'npc_chain_step_assigned': {
        const assignKey = Object.entries(this.NPC_NAMES).find(
          ([, v]) => v.toLowerCase() === msg.npc?.toLowerCase(),
        )?.[0];
        if (assignKey) this._npcThinkLoop(assignKey);
        break;
      }

      case 'npc_chain_started': {
        // A multi-step task chain was kicked off
        console.log(`[Chain] Started: "${msg.name}" — ${(msg.steps || []).join(' → ')} (${msg.totalSteps} steps)`);
        if (this.scene?._workFeed) {
          this.scene._workFeed.addEntry({
            npcName: msg.name || 'Chain',
            phase: 'starting',
            phaseEmoji: '🔗',
            note: `Chain started: ${msg.name} | ${(msg.steps || []).join(' → ')}`,
            artifactPath: null,
          });
        }
        break;
      }

      case 'npc_chain_step_done': {
        // One NPC finished their step in the chain
        console.log(`[Chain] Step done: ${msg.npc} → artifact: ${msg.artifactPath} (${msg.remaining} steps remain)`);
        if (this.scene?._workFeed) {
          this.scene._workFeed.addEntry({
            npcName: msg.npc || '?',
            phase: 'finished',
            phaseEmoji: '🔗',
            note: `Chain step ${msg.step + 1} done — ${msg.remaining} step${msg.remaining !== 1 ? 's' : ''} remaining`,
            artifactPath: msg.artifactPath || null,
          });
        }
        break;
      }

      case 'npc_chain_complete': {
        // All steps in the chain are done
        console.log(`[Chain] Complete: "${msg.name}" — ${(msg.artifacts || []).length} artifacts produced`);
        if (this.scene?._workFeed) {
          this.scene._workFeed.addEntry({
            npcName: msg.name || 'Chain',
            phase: 'finished',
            phaseEmoji: '🔗',
            note: `Chain complete: "${msg.name}" (${(msg.artifacts || []).length} artifacts)`,
            artifactPath: null,
          });
        }
        break;
      }

      case 'assistant_handoff':
        globalThis.DenizenVisitorHandoffUI?.showIncoming?.(msg);
        break;

      case 'skill_gap_progress':
      case 'skill_gap_complete':
      case 'skill_proposal_pending':
      case 'npc_code_proposal':
      case 'npc_dossier_proposal':
      case 'proposal_queue_changed':
      case 'npc_code_proposal_approved':
      case 'npc_code_proposal_rejected':
      case 'npc_dossier_proposal_approved':
      case 'npc_dossier_proposal_rejected':
      case 'skill_proposal_decided':
      case 'mesh_watchdog_alert':
      case 'health_runbook_progress':
      case 'health_runbook_complete':
      case 'resource_pressure_alert':
      case 'mesh_scale_action':
        try {
          document.dispatchEvent(new CustomEvent('denizen-ws-message', { detail: msg }));
          if (/proposal|dossier|skill_proposal/i.test(msg.type || '')) {
            document.dispatchEvent(new CustomEvent('denizen-proposals-changed', { detail: msg }));
          }
        } catch (_) {}
        break;

      case 'lucy_handoff_alert': {
        const handoff = msg.handoff || msg;
        const from = handoff?.from_display_name || handoff?.fromDisplayName || 'Someone';
        const message = String(handoff?.message || '');
        const speakText = `Heads up — handoff from ${from}: ${message.slice(0, 60)}`;
        const lucyKey = 'xp_lucy';
        if (this.agents?.get(lucyKey)) {
          try {
            this.actions.speak(lucyKey, speakText);
          } catch (_) {}
          const player = this.scene?.player;
          if (player && this.actions?.walkTo) {
            try {
              this.actions.standUp?.(lucyKey);
              const facing = this.scene.facing || 'down';
              const off = { up: { x: 0, y: 40 }, down: { x: 0, y: -40 }, left: { x: 40, y: 0 }, right: { x: -40, y: 0 } };
              const o = off[facing] || off.down;
              this.actions.walkTo(lucyKey, player.x + o.x, player.y + o.y);
            } catch (_) {}
          }
        }
        if (globalThis.__DenizenCeoMode) {
          this.scene?._playerChat?._addToLog?.('Lucy', speakText);
        }
        break;
      }

      default:
        console.log('[AgentManager] Unknown message type:', msg.type);
    }
  }

  /**
   * Execute a command from the cofounder agent
   */
  _executeAgentCommand(msg) {
    const { agentId, action, params } = msg;

    // Map agentId to npcKey
    let npcKey = null;
    if (agentId === 'cofounder') {
      npcKey = this._findNpcByRole('cofounder');
    } else {
      // Try matching by name
      npcKey = Object.entries(this.NPC_NAMES).find(
        ([k, v]) => v.toLowerCase() === agentId?.toLowerCase()
      )?.[0];
      if (!npcKey) npcKey = `xp_${agentId}`;
    }

    if (!npcKey) {
      console.warn(`[AgentManager] Unknown agent: ${agentId}`);
      return;
    }

    // Mark NPC as under CofounderAgent control — prevents think loop conflicts
    const agent = this.agents.get(npcKey);
    if (agent && action !== 'speak' && action !== 'think' && action !== 'emote') {
      agent.status = 'task_override';
      // Release after 15 seconds so think loop can resume
      this.scene.time.delayedCall(15000, () => {
        if (agent.status === 'task_override') agent.status = 'idle';
      });
    }

    switch (action) {
      case 'walkTo':
        this.actions.walkTo(npcKey, params.x, params.y);
        break;
      case 'speak':
        this.actions.speak(npcKey, params.text);
        break;
      case 'think':
        this.actions.think(npcKey, params.text);
        break;
      case 'emote':
        this.actions.emote(npcKey, params.type);
        break;
      case 'useComputer':
        this.actions.useComputer(npcKey, params.deskId || this.agents.get(npcKey)?.assignedDesk);
        break;
      case 'checkBookshelf':
        this.actions.checkBookshelf(npcKey, params.shelfId);
        break;
      case 'goToBreakroom':
        this.actions.goToBreakroom(npcKey);
        break;
      case 'reportToCEO':
        this.actions.reportToCEO(npcKey);
        break;
      case 'sitAt':
        this.actions.sitAt(npcKey, params.furnitureId);
        break;
      case 'standUp':
        this.actions.standUp(npcKey);
        break;
      case 'assignTask':
        this._assignTaskToAgent(params.targetAgent, params.task, params.desk);
        break;
      case 'setIdle':
        this.actions.setIdle(npcKey);
        break;
      case 'speakTo': {
        // Stagger speech so bubbles don't overlap; decrement when speakTo finishes
        // (do not reset the counter on a fixed 1s timer — that overlapped pending staggered calls)
        this._speechQueue = this._speechQueue || 0;
        const staggerDelay = this._speechQueue * 3500; // 3.5s between speeches
        this._speechQueue++;

        const targetName = params.target || params.targetAgent;
        const targetKey = Object.entries(this.NPC_NAMES).find(
          ([k, v]) => v.toLowerCase() === targetName?.toLowerCase()
        )?.[0] || `xp_${targetName?.toLowerCase()}`;

        const releaseSpeechSlot = () => {
          this._speechQueue = Math.max(0, (this._speechQueue || 0) - 1);
        };

        this.scene.time.delayedCall(staggerDelay, () => {
          const speakPromise = this.actions.speakTo(npcKey, targetKey, params.text);
          if (speakPromise && typeof speakPromise.then === 'function') {
            speakPromise.then(releaseSpeechSlot).catch(releaseSpeechSlot);
          } else {
            releaseSpeechSlot();
          }

          // Request a response from the target NPC's brain
          const speakerName = this.NPC_NAMES[npcKey] || agentId;
          if (targetName) {
            this.scene.time.delayedCall(2500, () => {
              this._send({
                type: 'npc_conversation',
                npcName: targetName,
                fromName: speakerName,
                text: params.text,
              });
            });
          }
        });
        break;
      }
      case 'goToRoom':
        this.actions.goToRoom(npcKey, params.room || params.roomKey);
        break;
      case 'joinMeeting':
        this.actions.joinMeeting(npcKey);
        break;
      case 'attendMeeting':
        this.actions.attendMeeting(npcKey);
        break;
      case 'leaveMeeting':
        this.actions.leaveMeeting(npcKey);
        break;
      case 'callMeeting': {
        // Leadership sits in chairs, lower-rank staff stands in rows
        const CHAIR_RANKS = new Set([
          'abby', 'marcus', 'sarah', 'alex', 'jenny', 'bob', 'dan'
        ]);
        const attendees = params.attendees || [];

        // Caller (usually leadership) sits
        const callerName = (this.NPC_NAMES[npcKey] || '').toLowerCase();
        if (CHAIR_RANKS.has(callerName)) {
          this.actions.joinMeeting(npcKey);
        } else {
          this.actions.attendMeeting(npcKey);
        }

        // Route each attendee: leaders sit, others stand
        const meetingNpcKeys = [npcKey];
        attendees.forEach((name, i) => {
          const aKey = Object.entries(this.NPC_NAMES).find(
            ([k, v]) => v.toLowerCase() === name.toLowerCase()
          )?.[0];
          if (aKey) {
            meetingNpcKeys.push(aKey);
            const isLeader = CHAIR_RANKS.has(name.toLowerCase());
            setTimeout(() => {
              if (isLeader) {
                this.actions.joinMeeting(aKey);
              } else {
                this.actions.attendMeeting(aKey);
              }
            }, (i + 1) * 1500);
          }
        });

        // Auto-end meeting after 30 seconds — everyone stands and returns to desks
        if (this._meetingTimeout) clearTimeout(this._meetingTimeout);
        this._meetingTimeout = setTimeout(() => {
          meetingNpcKeys.forEach(key => {
            this.actions.leaveMeeting(key);
            const agent = this.agents.get(key);
            if (agent?.assignedDesk) {
              setTimeout(() => this.actions.useComputer(key, agent.assignedDesk), 1500);
            }
          });
          this._meetingTimeout = null;
        }, 30000);
        break;
      }
    }
  }

  /**
   * Assign a task to a worker agent
   */
  _assignTaskToAgent(targetAgentName, taskType, deskId) {
    const npcKey = Object.entries(this.NPC_NAMES).find(
      ([k, v]) => v.toLowerCase() === targetAgentName?.toLowerCase()
    )?.[0];

    if (!npcKey) {
      console.warn(`[AgentManager] Cannot assign task: unknown agent ${targetAgentName}`);
      return;
    }

    const agent = this.agents.get(npcKey);
    if (!agent) return;

    agent.status = 'task_override';
    agent.currentTask = taskType;

    const taskId = `task_${++this._taskIdCounter}`;
    const task = { id: taskId, type: taskType, agent: npcKey, desk: deskId, startedAt: Date.now() };
    this.tasks.push(task);

    // Execute task based on type
    switch (taskType) {
      case 'research':
        this.actions.speak(npcKey, `Starting research task...`);
        this.actions.checkBookshelf(npcKey);
        // After some time at bookshelf, go to desk
        this.scene.time.delayedCall(15000, () => {
          if (agent.assignedDesk) {
            this.actions.useComputer(npcKey, agent.assignedDesk);
            this.actions.speak(npcKey, 'Writing up findings...');
          }
          this.scene.time.delayedCall(20000, () => {
            this._completeTask(taskId);
          });
        });
        break;
      case 'code':
      case 'development':
        this.actions.speak(npcKey, 'Working on code...');
        if (agent.assignedDesk || deskId) {
          this.actions.useComputer(npcKey, deskId || agent.assignedDesk);
        }
        this.scene.time.delayedCall(30000, () => {
          this._completeTask(taskId);
        });
        break;
      case 'stock_monitoring':
        this.actions.speak(npcKey, 'Monitoring markets...');
        if (agent.assignedDesk || deskId) {
          this.actions.useComputer(npcKey, deskId || agent.assignedDesk);
        }
        break;
      default:
        this.actions.speak(npcKey, `Working on: ${taskType}`);
        if (agent.assignedDesk) {
          this.actions.useComputer(npcKey, agent.assignedDesk);
        }
        this.scene.time.delayedCall(20000, () => {
          this._completeTask(taskId);
        });
    }
  }

  /**
   * Complete a task
   */
  _completeTask(taskId) {
    const taskIdx = this.tasks.findIndex(t => t.id === taskId);
    if (taskIdx === -1) return;

    const task = this.tasks[taskIdx];
    this.tasks.splice(taskIdx, 1);

    const agent = this.agents.get(task.agent);
    if (agent) {
      agent.status = 'idle';
      agent.currentTask = null;
      this.actions.speak(task.agent, 'Task complete!');
      this.actions.emote(task.agent, 'done');
    }

    // Notify server
    this._send({
      type: 'task_complete',
      agentId: task.agent,
      taskId: task.id,
      taskType: task.type,
    });
  }

  /**
   * Handle cofounder speaking (from server AI)
   */
  _cofounderSpeak(msg) {
    const cofKey = this._findNpcByRole('cofounder');
    if (cofKey) {
      this.actions.speak(cofKey, msg.text);
    }
  }

  /**
   * Handle task assignment from server
   */
  _assignTask(msg) {
    this._assignTaskToAgent(msg.targetAgent, msg.task, msg.desk);
  }

  /**
   * Spawn a new agent (reuse an idle NPC)
   */
  _spawnAgent(msg) {
    const { agentId, role } = msg;
    // Find an idle NPC that isn't strongly assigned
    const idleEntry = Array.from(this.agents.entries()).find(
      ([k, a]) => a.status === 'idle' && a.role === 'desk_worker'
    );

    if (idleEntry) {
      const [npcKey] = idleEntry;
      this.registerAgent(npcKey, role);
      this.actions.speak(npcKey, `New role: ${this.ROLES[role]?.label || role}`);
      this.actions.emote(npcKey, 'star');
    } else {
      console.warn('[AgentManager] No available NPCs to spawn new agent');
    }
  }

  /**
   * Find NPC key by role
   */
  _findNpcByRole(role) {
    for (const [npcKey, agent] of this.agents) {
      if (agent.role === role) return npcKey;
    }
    return null;
  }

  /**
   * Execute actions that an NPC decided to take after talking to the CEO.
   * Actions come from the NPC brain as parsed [ACTION:...] tags.
   */
  _executeNpcActions(npcKey, npcName, actions) {
    let delay = 2000; // Start actions after speech bubble shows

    actions.forEach(act => {
      this.scene.time.delayedCall(delay, () => {
        const params = Array.isArray(act.params) ? act.params : [];
        console.log(`[AgentManager] ${npcName} executing: ${act.action}`, params);

        switch (act.action) {
          case 'useComputer': {
            const agent = this.agents.get(npcKey);
            this.actions.useComputer(npcKey, agent?.assignedDesk);
            break;
          }
          case 'goToBreakroom':
            this.actions.goToBreakroom(npcKey);
            break;

          case 'goToRoom': {
            const room = params[0] || 'open_office';
            this.actions.goToRoom(npcKey, room);
            break;
          }
          case 'checkBookshelf':
            this.actions.checkBookshelf(npcKey);
            break;

          case 'standUp':
            this.actions.standUp(npcKey);
            break;

          case 'speakTo': {
            const targetName = params[0];
            const spkText = params[1] || 'Hey, got a minute?';
            const targetKey = Object.entries(this.NPC_NAMES).find(
              ([k, v]) => v.toLowerCase() === targetName?.toLowerCase()
            )?.[0] || `xp_${targetName?.toLowerCase()}`;

            this.actions.speakTo(npcKey, targetKey, spkText);

            // Also send to NPC brain so the target can respond
            this.scene.time.delayedCall(3000, () => {
              this._send({
                type: 'npc_conversation',
                npcName: targetName,
                fromName: npcName,
                text: spkText,
              });
            });
            break;
          }
          case 'callMeeting': {
            const attendeeStr = params[0] || '';
            const attendees = attendeeStr.split(',').map(n => n.trim()).filter(Boolean);
            this._executeAgentCommand({
              agentId: npcName,
              action: 'callMeeting',
              params: { attendees },
            });
            break;
          }
          case 'thinkAloud': {
            // Internal monologue — surfaces as a thought bubble (cloud)
            // instead of a speech bubble. Useful for ambient texture
            // ("I should follow up with Marcus...") that shouldn't
            // pin nearby NPCs into a conversation.
            const thoughtText = (params[0] || '').trim();
            if (thoughtText && this.actions.think) {
              this.actions.think(npcKey, thoughtText);
            }
            break;
          }
          case 'removeFurniture': {
            // Counterpart to placeFurniture — let NPCs undo or
            // reorganize. Only items whose instanceId starts with "npc_"
            // are removable; the server enforces that.
            const instanceId = params[0] || '';
            fetch('/api/remove-furniture', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ by: npcName, instanceId }),
            }).then(r => r.json()).then(res => {
              if (res?.ok) {
                console.log(`[AgentManager] ${npcName} removed ${instanceId}`);
              } else {
                console.warn(`[AgentManager] removeFurniture rejected:`, res?.error);
              }
            }).catch(err => console.warn('[AgentManager] removeFurniture error:', err?.message || err));
            break;
          }
          case 'placeFurniture': {
            // Params: [prefabId, x, y, reason]. POST to the server endpoint;
            // the server validates the whitelist + bounds, persists, and
            // emits an event. We don't directly spawn the sprite client-side
            // here — on next page reload the saved layout brings it in.
            // (A future enhancement: also spawn the sprite live without
            // requiring reload.)
            const prefabId = params[0] || '';
            const x = parseInt(params[1], 10);
            const y = parseInt(params[2], 10);
            const reason = params.slice(3).join(':') || null;
            fetch('/api/place-furniture', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ by: npcName, prefabId, x, y, reason }),
            }).then(r => r.json()).then(res => {
              if (res?.ok) {
                console.log(`[AgentManager] ${npcName} placed ${prefabId} at (${x},${y})`);
                if (this.actions?.emote) this.actions.emote(npcKey, 'idea');
              } else {
                console.warn(`[AgentManager] placeFurniture rejected:`, res?.error);
              }
            }).catch(err => console.warn('[AgentManager] placeFurniture error:', err?.message || err));
            break;
          }
          case 'requestAnimation': {
            // Stage 2 of the self-advancement roadmap. NPC proposes a
            // new animation; it goes to an operator-review queue. The
            // animation does NOT appear instantly — that's by design.
            // Params: [animName, description]. Description may contain
            // colons, so re-join everything after the first param.
            const animName = (params[0] || '').trim();
            const description = params.slice(1).join(':').trim();
            fetch('/api/request-animation', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ by: npcName, animName, description }),
            }).then(r => r.json()).then(res => {
              if (res?.ok) {
                console.log(`[AgentManager] ${npcName} proposed animation "${animName}"`);
                if (this.actions?.emote) this.actions.emote(npcKey, 'idea');
              } else {
                console.warn(`[AgentManager] requestAnimation rejected:`, res?.error);
              }
            }).catch(err => console.warn('[AgentManager] requestAnimation error:', err?.message || err));
            break;
          }
          case 'requestCapability': {
            // Stage 4 step 1 of the self-advancement roadmap. NPC
            // proposes a brand new ACTION (verb) that doesn't exist
            // yet. Goes to an operator-review queue. The verb does
            // NOT become available instantly — even on approval an
            // operator still has to hand-write the implementation in
            // src/agent-actions.js. That gate is non-negotiable.
            // Params: [verbName, description]. Description may
            // contain colons, so re-join everything after the first
            // param.
            const verbName = (params[0] || '').trim();
            const description = params.slice(1).join(':').trim();
            fetch('/api/request-capability', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ by: npcName, verbName, description }),
            }).then(r => r.json()).then(res => {
              if (res?.ok) {
                console.log(`[AgentManager] ${npcName} proposed capability "${verbName}"`);
                if (this.actions?.emote) this.actions.emote(npcKey, 'idea');
              } else {
                console.warn(`[AgentManager] requestCapability rejected:`, res?.error);
              }
            }).catch(err => console.warn('[AgentManager] requestCapability error:', err?.message || err));
            break;
          }
          default:
            console.log(`[AgentManager] Unknown NPC action: ${act.action}`);
        }
      });
      delay += 2500; // Stagger multiple actions
    });
  }

  /**
   * Handle CEO (player) speaking to agents
   */
  ceoSpeak(text) {
    this._send({
      type: 'ceo_speak',
      text,
      timestamp: Date.now(),
    });
  }

  /**
   * Send current office state to server
   */
  _sendClientProfile() {
    if (!this.connected || !window.__DenizenIsTouch) return;
    this._send({
      type: 'client_profile',
      touch: true,
      ceoMode: !!window.__DenizenCeoMode,
    });
  }

  _sendOfficeState() {
    if (!this.connected) return;
    this._sendClientProfile();

    const agentList = [];
    this.agents.forEach((agent, npcKey) => {
      const npc = this.actions._getNpc(npcKey);
      // Velocity for group/convoy awareness — needs to be in the state
      // snapshot so worldState can compute "walking with you" downstream.
      // Phaser arcade bodies expose velocity directly; round to 1 px/s
      // to keep the JSON small.
      const v = npc && npc.body && npc.body.velocity
        ? { x: Math.round(npc.body.velocity.x), y: Math.round(npc.body.velocity.y) }
        : { x: 0, y: 0 };
      agentList.push({
        id: npcKey,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        currentTask: agent.currentTask,
        assignedDesk: agent.assignedDesk,
        position: npc ? { x: Math.round(npc.x), y: Math.round(npc.y) } : null,
        velocity: v,
        // "Busy state" hint that's more meaningful than `status`: tells
        // peers whether this NPC is interruptible. Computed cheaply here
        // because we have access to npc.ai / agent state in one place.
        busy: agent.status === 'meeting' || agent.status === 'walking'
              || npc?.ai?.taskState === 'walking' || npc?.ai?.taskState === 'sitting',
      });
    });

    // Collect furniture info
    const furniture = [];
    if (this.scene._interactables) {
      this.scene._interactables.forEach(it => {
        if (it.id && it.sprite) {
          furniture.push({
            id: it.id,
            instanceId: it.instanceId,
            type: it.def?.type,
            position: { x: Math.round(it.sprite.x), y: Math.round(it.sprite.y) },
            assignedTo: this.deskAssignments.get(it.instanceId || it.id) || null,
          });
        }
      });
    }

    // Robber snapshot — live positions of any active threats so the
    // Bouncer's brain prompt can react to where intruders actually are.
    // Empty array when no threats, cheap to ship.
    const robbers = (this.scene._robberCtrl?.getActiveRobbers?.() || []);

    this._send({
      type: 'office_state',
      agents: agentList,
      furniture,
      robbers,
      honeypot: this._honeypotActive ? {
        active: true,
        position: this._honeypotSpot ? { x: this._honeypotSpot.x, y: this._honeypotSpot.y } : null,
        label: this._honeypotSpot?.label || null,
        setAt: this._honeypotSpot?.setAt || null,
      } : { active: false },
      tasks: this.tasks.map(t => ({ id: t.id, type: t.type, agent: t.agent })),
      time: this.scene.worldClock?.toString() || '',
    });

    // Player presence + idle tracking — feeds the receptionist's "looks
    // lost, walk over and offer a tour" behavior. Cheap: compares the
    // player sprite's position to the last sample and bumps the activity
    // timestamp when they've moved more than 2px.
    const player = this.scene.player;
    if (player && typeof player.x === 'number') {
      const now = Date.now();
      if (!this._lastPlayerSample) {
        this._lastPlayerSample = { x: player.x, y: player.y, at: now };
        this._lastPlayerActiveAt = now;
      } else {
        const dx = player.x - this._lastPlayerSample.x;
        const dy = player.y - this._lastPlayerSample.y;
        if ((dx * dx + dy * dy) > 4) this._lastPlayerActiveAt = now;
        this._lastPlayerSample = { x: player.x, y: player.y, at: now };
      }
      const idleMs = now - (this._lastPlayerActiveAt || now);
      const roomInfo = this.actions.getRoom ? this.actions.getRoom(player.x, player.y) : null;
      const room = roomInfo?.key || null;
      // Track how long the player's been in their current room — used
      // by the Bouncer's R5 loitering challenge. Resets every time the
      // room changes.
      if (room !== this._lastPlayerRoom) {
        this._lastPlayerRoom = room;
        this._playerRoomEnteredAt = now;
      }
      this._send({
        type: 'player_idle',
        idleMs,
        position: {
          x: Math.round(player.x),
          y: Math.round(player.y),
          room,
        },
      });
    }
  }

  /**
   * Update (called from scene update loop)
   */
  update() {
    this.actions.update();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM 1 — Idle Behaviors
  // ─────────────────────────────────────────────────────────────────────────

  _startIdleBehaviors() {
    let stagger = 0;
    this.agents.forEach((agent, npcKey) => {
      const delay = stagger + 45000 + Math.random() * 45000;
      this.scene.time.delayedCall(delay, () => this._tickIdleBehavior(npcKey));
      stagger += 3000;
    });
  }

  _tickIdleBehavior(npcKey) {
    const IDLE_PHRASES = {
      cofounder:    ['Thinking...', 'Hmm.', 'Need to revisit that.', 'Almost.', 'Good.'],
      desk_worker:  ['Almost got it.', 'Hm.', 'That is weird.', 'Nice.', 'Come on...', 'Wait.'],
      researcher:   ['Interesting.', 'Let me check that.', 'Hmm.', 'Not quite.', 'One more source.'],
      receptionist: ['Mmhm.', 'Good.', 'On it.', 'Let me look that up.', 'Almost done.'],
      security:     ['Clear.', 'Quiet today.', 'Checking.', 'Fine.', 'Eyes open.'],
      it_support:   ['That should not do that.', 'Hm.', 'Easy fix.', 'Oh come on.', 'There it is.'],
      qa_engineer:  ['Found one.', 'That is a bug.', 'Edge case.', 'Really?', 'As expected.'],
      devops:       ['Should be fine.', 'Monitoring.', 'Clean.', 'Hmm.', 'Good pipeline.'],
      designer:     ['That kerning.', 'Better.', 'Not quite right.', 'Almost.', 'Clean.'],
      data_engineer:['Pipeline looks good.', 'Hmm.', 'Interesting pattern.', 'Clean data.', 'Almost.'],
      intern:       ['Okay.', 'Got it.', 'Right.', 'Makes sense.', 'Cool.', 'Wait...'],
      default:      ['Hmm.', 'Okay.', 'Nice.', 'Working on it.', 'Almost.'],
    };

    const RESTRICTED_STATUSES = new Set([
      'task_override', 'engaging', 'meeting', 'honeypot',
      'tour_guide', 'securing', 'reporting', 'talking', 'collaborating',
    ]);

    const agent = this.agents.get(npcKey);
    if (!agent) return;
    if (RESTRICTED_STATUSES.has(agent.status)) {
      this.scene.time.delayedCall(45000 + Math.random() * 45000, () => this._tickIdleBehavior(npcKey));
      return;
    }

    const role = agent.role || 'default';
    const phrasePool = IDLE_PHRASES[role] || IDLE_PHRASES.default;
    const phrase = phrasePool[Math.floor(Math.random() * phrasePool.length)];

    const roll = Math.random();
    if (roll < 0.20) {
      // Coffee run
      this.actions.goToCoffee(npcKey);
      agent.status = 'break';
      this.scene.time.delayedCall(12000, () => {
        if (agent.assignedDesk) {
          this.actions.useComputer(npcKey, agent.assignedDesk);
          agent.status = 'working';
        }
      });
    } else if (roll < 0.45) {
      this.actions.think(npcKey, '*stretches*');
    } else if (roll < 0.70) {
      this.actions.emote(npcKey, '...');
    } else {
      this.actions.think(npcKey, phrase);
    }

    this.scene.time.delayedCall(45000 + Math.random() * 45000, () => this._tickIdleBehavior(npcKey));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM 2 — Ambient Spontaneous Chatter
  // ─────────────────────────────────────────────────────────────────────────

  _startAmbientChatter() {
    this._ambientChatActive = false; // mutex — prevents overlapping chatter sessions
    this.scene.time.delayedCall(150000 + Math.random() * 90000, () => this._tickAmbientChatter());
  }

  _tickAmbientChatter() {
    // Mutex: if a chatter session is already running, skip and reschedule.
    if (this._ambientChatActive) {
      this.scene.time.delayedCall(30000, () => this._tickAmbientChatter());
      return;
    }
    const RESTRICTED_STATUSES = new Set([
      'task_override', 'engaging', 'meeting', 'honeypot',
      'tour_guide', 'talking', 'collaborating', 'reporting',
    ]);

    const freeAgents = [];
    this.agents.forEach((agent, npcKey) => {
      if (!RESTRICTED_STATUSES.has(agent.status)) {
        freeAgents.push({ npcKey, agent });
      }
    });

    if (freeAgents.length < 2) {
      this.scene.time.delayedCall(150000 + Math.random() * 90000, () => this._tickAmbientChatter());
      return;
    }

    // Pick 2 distinct random agents
    const idx1 = Math.floor(Math.random() * freeAgents.length);
    let idx2 = Math.floor(Math.random() * (freeAgents.length - 1));
    if (idx2 >= idx1) idx2++;

    const { npcKey: initiatorKey, agent: initiatorAgent } = freeAgents[idx1];
    const { npcKey: responderKey, agent: responderAgent } = freeAgents[idx2];

    const responderSprite = this.actions._getNpc(responderKey);
    if (!responderSprite) {
      this.scene.time.delayedCall(150000 + Math.random() * 90000, () => this._tickAmbientChatter());
      return;
    }

    // Lock — session is now active
    this._ambientChatActive = true;

    // Walk initiator toward responder
    this.actions.walkTo(initiatorKey, responderSprite.x - 32, responderSprite.y);
    initiatorAgent.status = 'talking';
    responderAgent.status = 'talking';

    // Opener from past LLM dialogue; responder reply via npc_conversation replay.
    const pairUrl = `/api/ambient-dialogue/pair?initiator=${encodeURIComponent(initiatorAgent.name)}&responder=${encodeURIComponent(responderAgent.name)}`;
    fetch(pairUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((pair) => {
        const line = String(pair?.opener || 'Quick question when you have a second.').trim();
        this.scene.time.delayedCall(2500, () => {
          this.actions.speak(initiatorKey, line);
          this._send({
            type: 'npc_conversation',
            npcName: responderAgent.name,
            fromName: initiatorAgent.name,
            text: line,
            turn: 1,
            ambient: true,
          });
        });
      })
      .catch(() => {
        const line = 'Quick question when you have a second.';
        this.scene.time.delayedCall(2500, () => {
          this.actions.speak(initiatorKey, line);
          this._send({
            type: 'npc_conversation',
            npcName: responderAgent.name,
            fromName: initiatorAgent.name,
            text: line,
            turn: 1,
            ambient: true,
          });
        });
      });

    // Both return to desks after 18s — release the mutex when done
    this.scene.time.delayedCall(18000, () => {
      if (initiatorAgent.assignedDesk) {
        this.actions.useComputer(initiatorKey, initiatorAgent.assignedDesk);
        initiatorAgent.status = 'working';
      } else {
        initiatorAgent.status = 'idle';
      }
      if (responderAgent.assignedDesk) {
        this.actions.useComputer(responderKey, responderAgent.assignedDesk);
        responderAgent.status = 'working';
      } else {
        responderAgent.status = 'idle';
      }
      this._ambientChatActive = false; // release mutex
    });

    this.scene.time.delayedCall(150000 + Math.random() * 90000, () => this._tickAmbientChatter());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM 3 — Proximity Acknowledgment
  // ─────────────────────────────────────────────────────────────────────────

  _startProximityTracker() {
    this.scene.time.addEvent({
      delay: 600,
      loop: true,
      callback: () => this._tickProximity(),
    });
  }

  _tickProximity() {
    const ACK_LINES = {
      cofounder:    ['Hey.', 'Good timing.', 'Come in.'],
      desk_worker:  ['Hey.', 'What is up?', 'Oh hey.'],
      receptionist: ['Hi! Need anything?', 'Hey there!', 'Good to see you.'],
      security:     ['Hey.', 'All good?', 'What is up?'],
      it_support:   ['Need something?', 'Hey.', 'What broke?'],
      qa_engineer:  ['Hey.', 'What is going on?', 'Find a bug?'],
      devops:       ['Hey.', 'Pipeline still green.', 'What is up?'],
      designer:     ['Oh hey.', 'What do you think?', 'Hey.'],
      researcher:   ['Hey.', 'Good timing actually.', 'Come look at this.'],
      data_engineer:['Hey.', 'Numbers look good.', 'What is up?'],
      intern:       ['Oh! Hey.', 'Hi.', 'Hey, good to see you.'],
      default:      ['Hey.', 'What is up?', 'Oh hey.'],
    };

    const NON_BUSY_STATUSES = new Set(['working', 'idle', 'wandering', 'break']);
    const player = this.scene.player;
    if (!player) return;

    const now = Date.now();
    this.agents.forEach((agent, npcKey) => {
      if (!NON_BUSY_STATUSES.has(agent.status)) return;
      const npcSprite = this.actions._getNpc(npcKey);
      if (!npcSprite) return;
      const d = Math.hypot(player.x - npcSprite.x, player.y - npcSprite.y);
      if (d > 75) return;
      const lastAck = this._npcLastAcknowledged.get(npcKey) || 0;
      if (now - lastAck < 40000) return;

      this._npcLastAcknowledged.set(npcKey, now);
      const role = agent.role || 'default';
      const pool = ACK_LINES[role] || ACK_LINES.default;
      const ackLine = pool[Math.floor(Math.random() * pool.length)];

      this.actions.emote(npcKey, '...');
      this.scene.time.delayedCall(300, () => {
        this.actions.speak(npcKey, ackLine);
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM 4 — Emotional State / Mood
  // ─────────────────────────────────────────────────────────────────────────

  _getMood(npcKey) {
    return this._moods.get(npcKey) || 'focused';
  }

  _setMood(npcKey, mood) {
    this._moods.set(npcKey, mood);
  }

  _assignInitialMoods() {
    const ROLE_DEFAULT_MOODS = {
      cofounder:    'focused',
      security:     'focused',
      devops:       'focused',
      receptionist: 'relaxed',
      designer:     'relaxed',
      researcher:   'curious',
      data_engineer:'curious',
      intern:       'excited',
      qa_engineer:  'focused',
      it_support:   'focused',
    };
    this.agents.forEach((agent, npcKey) => {
      const mood = ROLE_DEFAULT_MOODS[agent.role] || 'focused';
      this._moods.set(npcKey, mood);
    });
  }

  _shiftMoodOnEvent(eventType) {
    this.agents.forEach((agent, npcKey) => {
      const role = agent.role || '';
      const current = this._getMood(npcKey);
      switch (eventType) {
        case 'threat_detected':
          if (role === 'security') {
            this._setMood(npcKey, 'focused');
          } else {
            this._setMood(npcKey, 'stressed');
          }
          break;
        case 'threat_resolved':
          if (role === 'security') {
            this._setMood(npcKey, 'relaxed');
          } else if (current === 'stressed') {
            this._setMood(npcKey, 'focused');
          }
          break;
        case 'morning': {
          const ROLE_DEFAULT_MOODS = {
            cofounder:    'focused',
            security:     'focused',
            devops:       'focused',
            receptionist: 'relaxed',
            designer:     'relaxed',
            researcher:   'curious',
            data_engineer:'curious',
            intern:       'excited',
            qa_engineer:  'focused',
            it_support:   'focused',
          };
          const defaultMood = ROLE_DEFAULT_MOODS[role] || 'focused';
          this._setMood(npcKey, defaultMood);
          break;
        }
        case 'good_deploy':
          if (role === 'devops') {
            this._setMood(npcKey, 'excited');
          } else {
            this._setMood(npcKey, 'relaxed');
          }
          break;
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM 5 — Office Event Reactions
  // ─────────────────────────────────────────────────────────────────────────

  _broadcastOfficeEvent(eventType, data) {
    const EVENT_REACTIONS = {
      threat_caught: [
        'Did you see that?',
        'Bouncer handled that fast.',
        'Glad we have security.',
        'That was intense.',
      ],
      visitor_arrived: [
        'Oh, we have a visitor.',
        'Looks like someone is here.',
        'I should clean up my desk.',
      ],
      job_applied: [
        'Heard we are hiring.',
        'Good, we need more hands.',
        'Wonder who applied.',
      ],
      morning: [
        'Morning.',
        'Good morning.',
        'Coffee first.',
        'Here we go.',
      ],
    };

    const RESTRICTED_STATUSES = new Set([
      'task_override', 'engaging', 'meeting', 'tour_guide',
    ]);

    const reactions = EVENT_REACTIONS[eventType];
    if (!reactions) return;

    const freeAgents = [];
    this.agents.forEach((agent, npcKey) => {
      if (!RESTRICTED_STATUSES.has(agent.status)) {
        freeAgents.push({ npcKey, agent });
      }
    });

    if (freeAgents.length === 0) return;

    // Pick 1-2 reactors
    const count = Math.min(freeAgents.length, 1 + Math.floor(Math.random() * 2));
    const shuffled = freeAgents.slice().sort(() => Math.random() - 0.5);
    const reactors = shuffled.slice(0, count);

    reactors.forEach(({ npcKey }, i) => {
      const reaction = reactions[Math.floor(Math.random() * reactions.length)];
      const delay = 1000 + Math.random() * 1000 + i * 800;
      this.scene.time.delayedCall(delay, () => {
        try { this.actions.speak(npcKey, reaction); } catch (_) {}
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SYSTEM 6 — Time-of-Day Context
  // ─────────────────────────────────────────────────────────────────────────

  _getTimeOfDay() {
    const h = new Date().getHours();
    if (h >= 5 && h < 10)  return 'morning';
    if (h >= 10 && h < 14) return 'midday';
    if (h >= 14 && h < 18) return 'afternoon';
    return 'evening';
  }

  /**
   * Work output feed — shows a small rolling HUD in the bottom-left corner
   * of the screen listing the last 6 things NPCs reported they were working on.
   * Each entry fades out after 30 seconds so the screen does not fill up.
   *
   * Called by the npc_work_output WS message handler.
   */
  _addWorkFeedEntry(npcName, phaseEmoji, note, artifactPath) {
    if (!this.scene?.add) return;

    // Lazy-init feed container
    if (!this._workFeed) {
      this._workFeed = [];
      this._workFeedY = 0;
    }

    // Build one line: "✓ Alex — Fixed chatter bug  [→ reports/bugs/...]"
    const artifactTag = artifactPath ? `  [→ ${artifactPath.slice(0, 38)}]` : '';
    const line = `${phaseEmoji} ${npcName} — ${note.slice(0, 70)}${artifactTag}`;

    // Calculate Y position — stack from bottom of visible area
    const cam = this.scene.cameras?.main;
    const baseX = cam ? cam.scrollX + 8 : 8;
    const baseY = cam ? cam.scrollY + (cam.height || 600) - 20 : 580;

    // Shift all existing entries up
    this._workFeed.forEach(entry => {
      if (entry?.text) {
        try { entry.text.setY(entry.text.y - 14); } catch (_) {}
      }
    });

    // Create new entry text
    try {
      // Finished tasks get a brighter accent; artifact entries get green tint
      const textColor = artifactPath ? '#4ade80' : (phaseEmoji === '✓' ? '#e2e8f0' : '#94a3b8');
      const txt = this.scene.add.text(baseX, baseY, line, {
        fontSize: '7px',
        fontFamily: 'monospace',
        color: textColor,
        backgroundColor: '#0f172a99',
        padding: { x: 4, y: 2 },
        wordWrap: { width: 340 },
      });
      txt.setDepth(8500);
      txt.setScrollFactor(1);  // follow camera

      const entry = { text: txt };
      this._workFeed.push(entry);

      // Keep only last 6
      if (this._workFeed.length > 6) {
        const old = this._workFeed.shift();
        try { old.text.destroy(); } catch (_) {}
      }

      // Fade out after 30 seconds
      this.scene.time.delayedCall(30000, () => {
        try {
          this.scene.tweens.add({
            targets: txt,
            alpha: 0,
            duration: 1500,
            onComplete: () => {
              try { txt.destroy(); } catch (_) {}
              this._workFeed = (this._workFeed || []).filter(e => e.text !== txt);
            },
          });
        } catch (_) {}
      });
    } catch (_) {}
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this._stateReportInterval) {
      this._stateReportInterval.remove();
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}

window.AgentOfficeManager = AgentOfficeManager;
