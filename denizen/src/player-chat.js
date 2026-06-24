/**
 * Player Chat System
 * Lets the player (CEO) communicate directly with individual NPCs.
 *
 * Targeting logic:
 * 1. If player is near an NPC and facing them → that NPC is the target
 * 2. If the message mentions an NPC name → that NPC walks to the player
 * 3. If no target found → broadcasts to nearest NPC
 *
 * NPCs respond via their individual AI brains, can delegate tasks up hierarchy.
 */

class PlayerChat {
  constructor(scene, agentManager) {
    this.scene = scene;
    this.manager = agentManager;
    this._visible = false;
    this._input = null;
    this._container = null;
    this._chatLog = [];       // { from, text, time } — legacy flat log
    this._threads = new Map(); // threadId -> { type, npcKey, npcName, groupId, title, members, messages[] }
    this._activeThreadId = null;
    this._phoneShellEnabled = false;
    this._maxLog = 50;
    this._waitingForResponse = false;
    this._typingNpc = null;
    /** Active CEO↔NPC conversation — NPC stays nearby until cleared. */
    this._ceoConvo = null;
    this._ceoConvoIdleMs = 180000;
    this._ceoConvoWalkDist = 40;
    this._ceoConvoHoldMs = 300000;
    this._ceoReapproachAt = 0;
    this._ceoConvoIdleTimer = null;

    const roster = globalThis.DenizenNpcRoster;
    if (!roster) {
      console.error('[PlayerChat] DenizenNpcRoster missing — load src/npc-roster.js before player-chat.js');
    }
    this._npcNames = roster ? [...roster.displayNames] : [];
    this._nameToKey = roster ? { ...roster.nameToKey } : {};

    // Expose the active chat instance so voice-input and dispatcher paths
    // can deliver transcripts without needing scene internals.
    window.__DenizenPlayerChat = this;

    /** Arrow state while the chat input is focused — Phaser can't see DOM keys. */
    this._moveKeys = { left: false, right: false, up: false, down: false };
    if (scene) scene._chatMoveKeys = this._moveKeys;

    this._buildUI();
    this.setWsConnected(!!(this.manager?.connected || this.manager?.ws?.readyState === WebSocket.OPEN));
    if (scene) this._attachVisitorUi();
    this._bindDeferredVisitorUi();
  }

  _bindDeferredVisitorUi() {
    if (this._deferredVisitorUiBound) return;
    this._deferredVisitorUiBound = true;
    document.addEventListener('denizen-deferred-scripts-ready', () => {
      if (!this.scene) return;
      this._visitorUiScene = null;
      this._attachVisitorUi();
    });
  }

  _attachVisitorUi() {
    if (!this.scene || this._visitorUiScene === this.scene) return;
    this._visitorUiScene = this.scene;
    if (globalThis.DenizenVisitorClaimUI?.attach) {
      globalThis.DenizenVisitorClaimUI.attach(this, this.scene);
    }
    if (globalThis.DenizenVisitorHandoffUI?.attach) {
      globalThis.DenizenVisitorHandoffUI.attach(this);
    }
    if (globalThis.DenizenVisitorProjectsUI?.attach) {
      globalThis.DenizenVisitorProjectsUI.attach(this);
    }
    if (globalThis.DenizenVisitorAssistantLabels?.attach) {
      globalThis.DenizenVisitorAssistantLabels.attach(this.scene, this.manager);
    }
    if (globalThis.DenizenVisitorOnboarding?.attach) {
      globalThis.DenizenVisitorOnboarding.attach(this.scene, this);
    }
  }

  /** Bind full office scene + AgentOfficeManager after early bootstrap chat. */
  upgrade(scene, agentManager) {
    this.scene = scene;
    this.manager = agentManager;
    if (scene) {
      scene._playerChat = this;
      scene._chatMoveKeys = this._moveKeys;
    }
    // AgentOfficeManager reuses window.__DenizenAgentWs — do NOT close the early
    // manager's socket here or chat goes offline right when the scene loads.
    if (typeof agentManager?.connect === 'function') {
      try { agentManager.connect(); } catch (_) {}
    }
    this.setWsConnected(!!(agentManager?.connected || agentManager?.ws?.readyState === WebSocket.OPEN));
    this._attachVisitorUi();
    console.log('[PlayerChat] upgraded with office scene');
  }

  /** Texture key of the visitor's claimed personal assistant, or null. */
  getClaimedAssistantNpcKey() {
    const sess = globalThis.DenizenVisitorSession;
    const asst = sess?.getAssistant?.();
    if (!asst?.npc_key) return null;
    return sess.npcKeyToTextureKey?.(asst.npc_key) || null;
  }

  /** Wait for agent-ws to open (reconnect after scene handoff or brief drop). */
  async _ensureWsOpen(timeoutMs = 5000) {
    const mgr = this.manager;
    if (!mgr) return false;
    if (mgr.ws?.readyState === WebSocket.OPEN) return true;
    if (typeof mgr.connect === 'function') {
      try { mgr.connect(); } catch (_) {}
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (mgr.ws?.readyState === WebSocket.OPEN) {
        this.setWsConnected(true);
        return true;
      }
      if (!mgr.ws || mgr.ws.readyState === WebSocket.CLOSED || mgr.ws.readyState === WebSocket.CLOSING) {
        if (typeof mgr.connect === 'function') {
          try { mgr.connect(); } catch (_) {}
        }
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    const ok = mgr.ws?.readyState === WebSocket.OPEN;
    this.setWsConnected(ok);
    return ok;
  }

  _setChatMoveKey(key, down) {
    const map = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    };
    const dir = map[key];
    if (!dir) return;
    this._moveKeys[dir] = down;
    if (this.scene) this.scene._chatMoveKeys = this._moveKeys;
  }

  _clearChatMoveKeys() {
    this._moveKeys.left = false;
    this._moveKeys.right = false;
    this._moveKeys.up = false;
    this._moveKeys.down = false;
    if (this.scene) this.scene._chatMoveKeys = this._moveKeys;
  }

  _chatFabClosedLabel() {
    return this.manager?.connected ? '💬 Chat' : '💬 Chat (offline)';
  }

  _syncFabLabel() {
    if (!this._fab) return;
    const compact = document.documentElement.classList.contains('denizen-touch')
      && this._fab.closest('#denizen-bottom-dock');
    if (this._visible) {
      this._fab.textContent = compact ? '✕' : '✕ Close';
      this._fab.setAttribute('aria-pressed', 'true');
      this._fab.title = 'Close chat';
    } else {
      const label = this._chatFabClosedLabel();
      this._fab.textContent = compact ? '💬' : label;
      this._fab.setAttribute('aria-pressed', 'false');
      this._fab.title = compact ? (this._fab.dataset.fullLabel || label) : 'Talk to NPCs (Enter or T also works)';
    }
  }

  /**
   * Toggle chat visibility
   */
  setWsConnected(connected) {
    if (this._fab) {
      this._fab.classList.toggle('ws-on', !!connected);
      this._fab.classList.toggle('ws-off', !connected);
      this._syncFabLabel();
    }
    const banner = document.getElementById('denizen-ws-banner');
    const remote = !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    if (banner && remote) {
      banner.style.display = connected ? 'none' : 'block';
    }
  }

  setVisible(visible) {
    if (!this._container) return;
    const next = !!visible;
    if (this._visible === next && (this._container.style.display === 'none') === !next) {
      return;
    }
    this._visible = next;
    this._container.style.display = next ? 'flex' : 'none';
    document.documentElement.classList.toggle('denizen-chat-open', next);
    this._syncFabLabel();
    if (next && window.__DenizenIsTouch) {
      globalThis.DenizenMobileSidebar?.close?.();
    }
    if (next) {
      // Focus the box on open (touch too) so the soft keyboard pops up. This
      // runs inside the tap that opened chat, which is what iOS/Android require.
      try { this._input?.focus({ preventScroll: true }); } catch (_) { this._input?.focus(); }
    } else {
      this._input?.blur();
      this._clearChatMoveKeys();
      // Closing the panel does not end the conversation — NPC stays with you.
    }
  }

  toggle() {
    const showing = this._container
      && getComputedStyle(this._container).display !== 'none';
    this.setVisible(!showing);
  }

  /** True only while the text box is focused — i.e. the player is actually
   *  typing. Movement is blocked just for this window, not the whole time the
   *  panel is on screen, so walking is fluent: type, Enter, you're moving. */
  isTyping() {
    return document.activeElement === this._input;
  }

  /**
   * Open chat and focus input
   */
  open() {
    if (!this._visible) this.toggle();
    else { try { this._input?.focus({ preventScroll: true }); } catch (_) { this._input?.focus(); } }
  }

  /**
   * Open chat targeted at a specific NPC (e.g. tap-to-talk from the office).
   * @param {string} npcKey
   * @param {string} npcName
   * @param {{ walk?: boolean }} [opts]
   */
  _folderForNpcKey(npcKey) {
    const roster = globalThis.DenizenNpcRoster;
    const key = String(npcKey || '');
    const entry = (roster?.entries || []).find((e) => e.textureKey === key || e.folder === key);
    return entry?.folder || String(key).replace(/^xp_/, '').toLowerCase();
  }

  _folderForNpcName(npcName) {
    const roster = globalThis.DenizenNpcRoster;
    const entry = (roster?.entries || []).find((e) => e.display === npcName);
    return entry?.folder || String(npcName || '').toLowerCase();
  }

  _dmThreadId(npcKeyOrFolder) {
    const folder = this._folderForNpcKey(npcKeyOrFolder);
    return `dm:${folder}`;
  }

  _groupThreadId(groupId) {
    return `group:${groupId}`;
  }

  _ensureThread(meta = {}) {
    const id = meta.threadId || meta.id;
    if (!id) return null;
    let thread = this._threads.get(id);
    if (!thread) {
      thread = {
        threadId: id,
        type: meta.type || (String(id).startsWith('group:') ? 'group' : 'dm'),
        npcKey: meta.npcKey || null,
        npcName: meta.npcName || null,
        groupId: meta.groupId || (String(id).startsWith('group:') ? String(id).slice(6) : null),
        title: meta.title || meta.npcName || meta.name || 'Chat',
        members: Array.isArray(meta.members) ? meta.members : [],
        messages: [],
        preview: '',
        updatedAt: Date.now(),
      };
      this._threads.set(id, thread);
    } else {
      if (meta.npcKey) thread.npcKey = meta.npcKey;
      if (meta.npcName) thread.npcName = meta.npcName;
      if (meta.title || meta.name) thread.title = meta.title || meta.name;
      if (meta.members?.length) thread.members = meta.members;
    }
    return thread;
  }

  _getActiveThread() {
    if (!this._activeThreadId) return null;
    return this._threads.get(this._activeThreadId) || null;
  }

  _threadCacheScope() {
    const sess = globalThis.DenizenVisitorSession;
    return sess?.getIdentityId?.() || sess?.getSessionId?.() || 'anon';
  }

  _threadCacheKey(threadId) {
    return `denizen-chat:${this._threadCacheScope()}:${threadId}`;
  }

  _loadCachedMessages(threadId) {
    try {
      const raw = localStorage.getItem(this._threadCacheKey(threadId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _saveCachedMessages(threadId, messages) {
    if (!threadId || !Array.isArray(messages)) return;
    try {
      localStorage.setItem(
        this._threadCacheKey(threadId),
        JSON.stringify(messages.slice(-this._maxLog)),
      );
    } catch (_) {}
  }

  setPhoneShellEnabled(enabled) {
    this._phoneShellEnabled = !!enabled;
  }

  getActiveThreadId() {
    return this._activeThreadId;
  }

  getActiveThread() {
    return this._getActiveThread();
  }

  listLocalThreads() {
    return [...this._threads.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async openThread(meta = {}) {
    const threadId = meta.threadId || meta.id
      || (meta.groupId ? this._groupThreadId(meta.groupId) : null)
      || (meta.npcKey ? this._dmThreadId(meta.npcKey) : null);
    if (!threadId) return null;
    const thread = this._ensureThread({ ...meta, threadId });
    this._activeThreadId = threadId;
    if (thread.type === 'dm' && thread.npcKey && thread.npcName) {
      const texKey = globalThis.DenizenNpcRoster?.nameToKey?.[thread.npcName.toLowerCase()]
        || globalThis.DenizenVisitorSession?.npcKeyToTextureKey?.(thread.npcKey);
      this._updateTargetLabel(thread.npcName);
      this._beginCeoConversation(texKey, thread.npcName, null);
      this._lastTargetKey = texKey;
    } else if (thread.type === 'group') {
      this._updateTargetLabel(thread.title || 'Group');
      this._ceoConvo = null;
    }
    const cached = this._loadCachedMessages(threadId);
    if (cached.length) {
      thread.messages = cached;
      this._renderLog();
    }
    const history = await globalThis.DenizenVisitorSession?.getChatHistory?.(threadId).catch(() => null);
    const me = globalThis.DenizenVisitorSession?.getDisplayName?.() || 'You';
    if (Array.isArray(history) && history.length) {
      thread.messages = history.map((m) => ({
        from: (m.from === 'user' || m.from === 'You' || m.from === me || m.role === 'user') ? 'You' : (m.from || 'NPC'),
        text: m.text || m.content || '',
        time: m.time || m.created_at || Date.now(),
      }));
    } else if (!thread.messages.length && cached.length) {
      thread.messages = cached;
    }
    this._saveCachedMessages(threadId, thread.messages);
    this._renderLog();
    globalThis.DenizenPhoneChatUI?.onThreadOpened?.(thread);
    return thread;
  }

  async openWithNpc(npcKey, npcName, opts = {}) {
    const folder = this._folderForNpcKey(npcKey);
    await this.openThread({
      threadId: `dm:${folder}`,
      type: 'dm',
      npcKey: folder,
      npcName,
      title: npcName,
    });
    if (!this._visible) this.toggle();

    this._updateTargetLabel(npcName);
    this._beginCeoConversation(npcKey, npcName, null);
    this._lastTargetKey = npcKey;
    const walk = opts.walk !== false;
    const player = this.scene?.player;
    const sceneReady = !!(this.scene && player);
    if (walk && sceneReady && this.manager?.actions) {
      const targetNpc = this.scene.npcs?.find(n => n.texture?.key === npcKey);
      const dist = targetNpc && player
        ? Math.hypot(targetNpc.x - player.x, targetNpc.y - player.y)
        : 999;
      const needsWalkToPlayer = dist > this._ceoConvoWalkDist;
      if (needsWalkToPlayer) {
        this._addToLog('System', `${npcName} is coming over...`);
        this.manager.actions.emote(npcKey, '!');
        await this._walkNpcToPlayer(npcKey);
      } else {
        this.manager.actions.emote(npcKey, '!');
      }
      if (targetNpc) this._stopNpcForConversation(targetNpc, npcKey, null);
    }

    if (!window.__DenizenIsTouch) this._input.focus();
  }

  /**
   * Close chat
   */
  close() {
    if (this._visible) this.toggle();
  }

  _getLucyLastSearchQuery() {
    const mem = String(this._lucyLastSearchQuery || '').trim();
    if (mem) return mem;
    try {
      return String(sessionStorage.getItem('denizen_lucy_last_search') || '').trim();
    } catch (_) {
      return '';
    }
  }

  _setLucyLastSearchQuery(query) {
    const q = String(query || '').trim();
    if (!q) return;
    this._lucyLastSearchQuery = q;
    try { sessionStorage.setItem('denizen_lucy_last_search', q); } catch (_) {}
  }

  /** Deduped NPC report lines (early chat + office scene both receive WS events). */
  _onNpcReport(npcName, text) {
    const body = String(text || '').trim();
    if (!body) return;
    if (npcName === 'Lucy' && !this._lucySearchActive && /takeaway|Browser stays open/i.test(body)) {
      return;
    }
    if (npcName === 'Bouncer' && window.DenizenSecurityFeed?.isSecurityTraffic?.(body)) {
      window.DenizenSecurityFeed.ingest({ text: body, kind: 'report' });
      return;
    }
    const key = `${npcName}:${body.slice(0, 200)}`;
    if (!this._recentReportKeys) this._recentReportKeys = new Set();
    if (this._recentReportKeys.has(key)) return;
    this._recentReportKeys.add(key);
    setTimeout(() => this._recentReportKeys.delete(key), 30000);
    if (this._searchTimeoutTimer) {
      clearTimeout(this._searchTimeoutTimer);
      this._searchTimeoutTimer = null;
    }
    this._addToLog(npcName, body);
  }

  _armSearchTimeout(targetKey, targetName, label, ms = 150000) {
    if (this._searchTimeoutTimer) clearTimeout(this._searchTimeoutTimer);
    this._searchTimeoutTimer = setTimeout(() => {
      if (this._lucySearchActive !== label) return;
      this._lucySearchActive = null;
      this._addToLog('System', 'Search is taking longer than expected — check your taskbar for Lucy\'s browser window, or say "close the browser" and try again.');
      this._refreshCeoConversationHold(targetKey, targetName, null);
    }, ms);
  }

  /** POST /api/lucy-search — async (202); results arrive via WebSocket. */
  _lucySearchFetch(payload, targetKey, targetName) {
    const label = payload.openOnly ? 'browser' : (payload.query || 'search');
    this._lucySearchActive = label;
    this._lucySearchContext = true;
    if (!payload.openOnly && payload.query) {
      this._setLucyLastSearchQuery(payload.query);
    }
    return fetch('/api/lucy-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        const text = await r.text();
        let j;
        try {
          j = JSON.parse(text);
        } catch (_) {
          if (text.trimStart().startsWith('<')) {
            throw new Error('Server returned HTML (tunnel may have timed out — watch chat for Lucy\'s report)');
          }
          throw new Error(text.slice(0, 160) || `HTTP ${r.status}`);
        }
        if (j.pending) {
          this._addToLog('System', 'Opening Lucy\'s browser — watch your taskbar for a Chromium or Chrome window.');
          this._armSearchTimeout(targetKey, targetName, label);
          return j;
        }
        this._lucySearchActive = null;
        if (j.ok && j.summary) {
          this._addToLog('Lucy', j.summary);
        } else {
          this._addToLog('System', `Search failed: ${j.error || j.summary || 'unknown error'}`);
        }
        this._refreshCeoConversationHold(targetKey, targetName, null);
        return j;
      })
      .catch((err) => {
        this._lucySearchActive = null;
        this._addToLog('System', `Search failed: ${err?.message || err}`);
        this._refreshCeoConversationHold(targetKey, targetName, null);
      });
  }

  get isOpen() { return this._visible; }

  /**
   * Find the NPC the player is currently facing (proximity + direction check)
   */
  _findFacingNpc() {
    const player = this.scene.player;
    if (!player || !Array.isArray(this.scene.npcs)) return null;

    const facing = this.scene.facing || 'down';
    const facingVec = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    }[facing];

    const maxDist = 80; // slightly larger than furniture interact distance
    let best = null;
    let bestDist = maxDist;

    this.scene.npcs.forEach(npc => {
      const dx = npc.x - player.x;
      const dy = npc.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > maxDist || dist < 1) return;

      // Dot product — must be roughly in front of player
      const dot = (dx / dist) * facingVec.x + (dy / dist) * facingVec.y;
      if (dot < 0.2) return;

      if (dist < bestDist) {
        bestDist = dist;
        best = npc;
      }
    });

    return best;
  }

  /**
   * Find NPC mentioned by name in the message
   */
  _findNamedNpc(message) {
    const lower = message.toLowerCase();
    for (const name of this._npcNames) {
      // Word boundary check: name must be standalone word
      const regex = new RegExp('\\b' + name.toLowerCase() + '\\b');
      if (regex.test(lower)) {
        return { name, key: this._nameToKey[name.toLowerCase()] };
      }
    }
    return null;
  }

  /**
   * Find the closest NPC to the player
   */
  _findNearestNpc() {
    const player = this.scene.player;
    if (!player || !Array.isArray(this.scene.npcs)) return null;

    let best = null;
    let bestDist = Infinity;

    this.scene.npcs.forEach(npc => {
      const dist = Math.hypot(npc.x - player.x, npc.y - player.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = npc;
      }
    });

    return best;
  }

  /**
   * Get NPC display name from texture key
   */
  _getNpcName(npcKey) {
    return this.manager?.NPC_NAMES?.[npcKey] || npcKey.replace('xp_', '').replace(/_/g, ' ');
  }

  _shouldEndCeoConversation(text) {
    return /\b(bye|goodbye|that'?s all|we'?re done|talk later|see you later|you can go now|go back to (your )?desk|dismissed|stop talking|leave me)\b/i.test(String(text || ''));
  }

  _playerGaveTask(text) {
    return /\b(go (?:to|check|fix|do|ahead)|head to (?:your )?desk|work on|take over|open the|check the|fix the|run the|deploy|implement|now try|do it now|handle that|get on that)\b/i.test(String(text || ''));
  }

  _scheduleCeoConvoIdleCheck() {
    if (this._ceoConvoIdleTimer) {
      this._ceoConvoIdleTimer.remove(false);
      this._ceoConvoIdleTimer = null;
    }
    if (!this._ceoConvo || !this.scene?.time) return;
    this._ceoConvoIdleTimer = this.scene.time.delayedCall(this._ceoConvoIdleMs, () => {
      if (this._ceoConvo && Date.now() - this._ceoConvo.lastActivityAt >= this._ceoConvoIdleMs - 500) {
        this._endCeoConversation('idle timeout');
      }
    });
  }

  _cancelNpcQueuedActions(npcKey) {
    const actions = this.manager?.actions;
    if (!actions) return;
    if (actions._actionQueues) actions._actionQueues.set(npcKey, Promise.resolve());
    if (actions._followers?.has(npcKey)) actions.stopFollow(npcKey);
    const npc = actions._getNpc(npcKey);
    if (npc?.body) npc.body.setVelocity(0, 0);
    if (npc?._pathFollower) npc._pathFollower.stop();
  }

  _beginCeoConversation(npcKey, npcName, addressText) {
    if (this._ceoConvo?.npcKey && this._ceoConvo.npcKey !== npcKey) {
      this._endCeoConversation('switched target');
    }
    this._cancelNpcQueuedActions(npcKey);
    this._ceoConvo = { npcKey, npcName, lastActivityAt: Date.now() };
    this._refreshCeoConversationHold(npcKey, npcName, addressText);
    this._scheduleCeoConvoIdleCheck();
  }

  _refreshCeoConversationHold(npcKey, npcName, addressText) {
    if (!this._ceoConvo || this._ceoConvo.npcKey !== npcKey) return;
    this._ceoConvo.lastActivityAt = Date.now();

    const agent = this.manager?.agents?.get(npcKey);
    if (agent) agent.status = 'ceo_conversation';

    const npc = this.manager?.actions?._getNpc(npcKey);
    if (npc?.ai) {
      const now = this.scene.time?.now || 0;
      npc.ai._ceoConvoUntil = now + this._ceoConvoHoldMs;
      npc.ai._addressedUntil = now + this._ceoConvoHoldMs;
      npc.ai._addressedBy = '__player__';
    }

    if (addressText && this.manager?._send && agent?.name) {
      this.manager._send({
        type: 'npc_addressed',
        target: agent.name,
        from: 'the CEO',
        text: String(addressText).slice(0, 200),
        ts: Date.now(),
      });
    }
    this._scheduleCeoConvoIdleCheck();
  }

  _endCeoConversation(reason) {
    if (!this._ceoConvo) return;
    const { npcKey, npcName } = this._ceoConvo;
    console.log(`[PlayerChat] End CEO conversation with ${npcName} (${reason || 'done'})`);
    this._ceoConvo = null;
    if (this._ceoConvoIdleTimer) {
      this._ceoConvoIdleTimer.remove(false);
      this._ceoConvoIdleTimer = null;
    }
    const agent = this.manager?.agents?.get(npcKey);
    if (agent && agent.status === 'ceo_conversation') {
      agent.status = 'working';
    }
    const npc = this.manager?.actions?._getNpc(npcKey);
    if (npc?.ai) {
      npc.ai._ceoConvoUntil = 0;
      npc.ai._addressedUntil = 0;
      npc.ai._addressedBy = null;
    }
    if (this.manager?.actions?.isFollowing?.(npcKey)) {
      this.manager.actions.stopFollow(npcKey);
    }
    this._resumeNpc(npcKey);
  }

  /**
   * Stop an NPC, make them face the player, and freeze in place
   */
  _stopNpcForConversation(npc, npcKey, addressText) {
    if (!npc?.ai) return;
    const actions = this.manager?.actions;

    if (actions?._sittingNpcs?.has(npcKey)) {
      actions._standUpNpc(npcKey);
    }

    npc.body.setVelocity(0, 0);
    if (npc._pathFollower) npc._pathFollower.stop();
    npc.ai.mode = 'agent_task';
    npc.ai.taskState = 'reporting';
    npc.ai.taskTarget = null;
    npc.ai._lastTarget = null;

    this._refreshCeoConversationHold(npcKey, this._getNpcName(npcKey), addressText);

    const player = this.scene.player;
    if (player) {
      const dx = player.x - npc.x;
      const dy = player.y - npc.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        npc.ai.facing = dx < 0 ? 'left' : 'right';
      } else {
        npc.ai.facing = dy < 0 ? 'up' : 'down';
      }
      if (npc.ai.facing === 'up') npc.setFrame(12);
      else if (npc.ai.facing === 'down') npc.setFrame(0);
      else if (npc.ai.facing === 'left') npc.setFrame(4);
      else npc.setFrame(8);
      npc.anims.stop();
    }
  }

  /** Walk NPC to a spot beside the CEO (offset from player position). */
  async _walkNpcToPlayer(npcKey) {
    const player = this.scene.player;
    const actions = this.manager?.actions;
    if (!player || !actions) return;
    this._cancelNpcQueuedActions(npcKey);
    if (actions.reportToCEO) {
      await actions.reportToCEO(npcKey);
      return;
    }
    if (!actions.walkTo) return;
    const facing = this.scene.facing || 'down';
    const off = { up: { x: 0, y: 40 }, down: { x: 0, y: -40 }, left: { x: 40, y: 0 }, right: { x: -40, y: 0 } };
    const o = off[facing] || off.down;
    await actions.walkTo(npcKey, player.x + o.x, player.y + o.y);
  }

  /**
   * Send a player message to an NPC
   */
  async sendMessage(text) {
    if (!text.trim()) return;
    if (globalThis.DenizenPublicDemo?.active && globalThis.DenizenPublicDemo?.readOnly) {
      this._addToLog('System', 'Public demo is watch-only — use Team login for chat.');
      return;
    }
    window.DenizenHaptics?.tap?.();

    const trimmed = window.DenizenOpenClawDispatch?.fixVoiceMishearings?.(text.trim()) || text.trim();
    const normalized = window.DenizenOpenClawDispatch?.normalizePlayerUtterance?.(trimmed) || trimmed;
    const wantsBrowserOpen = window.DenizenOpenClawDispatch?.wantsLucyBrowserOpen?.(trimmed) || false;

    // If the user is actively chatting, treat that as presence and turn
    // voice on automatically so NPC replies can be heard without requiring
    // a manual Alt+V toggle first.
    if (!globalThis.DenizenPresence?.zionPresent && typeof globalThis.DenizenSetPresence === 'function') {
      try { await globalThis.DenizenSetPresence(true); }
      catch (_) { /* non-fatal; chat still proceeds */ }
    }

    // Add to chat log
    this._addToLog('You', trimmed);
    this._showPlayerBubble(trimmed);
    if (globalThis.DenizenVisitorSession?.isDemo?.()) {
      try { document.dispatchEvent(new CustomEvent('denizen-demo-engaged')); } catch (_) {}
    }

    const extractSearch = window.DenizenOpenClawDispatch?.extractSearchQuery;
    const extractJobBoard = window.DenizenOpenClawDispatch?.extractJobBoardSearchIntent;
    const extractObserve = window.DenizenOpenClawDispatch?.extractScreenObserveIntent;
    const extractScreenControl = window.DenizenOpenClawDispatch?.extractScreenControlIntent;
    const extractBrowserStatus = window.DenizenOpenClawDispatch?.extractBrowserStatusIntent;
    const extractOpenBrowser = window.DenizenOpenClawDispatch?.extractOpenBrowserIntent;
    const extractOpenBrave = window.DenizenOpenClawDispatch?.extractOpenBraveIntent;
    const extractCloseBrowser = window.DenizenOpenClawDispatch?.extractCloseBrowserIntent;
    const extractBrowserRetry = window.DenizenOpenClawDispatch?.extractBrowserRetryIntent;
    const extractBrowserRead = window.DenizenOpenClawDispatch?.extractBrowserReadIntent;
    const isCancelUtterance = window.DenizenOpenClawDispatch?.isCancelUtterance;
    const extractJobBoardHelp = window.DenizenOpenClawDispatch?.extractJobBoardHelpIntent;
    const extractQueue = window.DenizenOpenClawDispatch?.extractResearchQueueIntent;
    const extractBrief = window.DenizenOpenClawDispatch?.extractResearchBriefIntent;
    let searchQueryEarly = extractSearch ? extractSearch(normalized) : null;
    if (!searchQueryEarly && extractSearch) {
      searchQueryEarly = extractSearch(trimmed) || extractSearch(text.trim());
    }
    const extractBareTopic = window.DenizenOpenClawDispatch?.extractBareSearchTopic;
    if (!searchQueryEarly && extractBareTopic && (this._lucySearchContext || this._ceoConvo?.npcName === 'Lucy')) {
      searchQueryEarly = extractBareTopic(trimmed) || extractBareTopic(text.trim());
    }
    if (isCancelUtterance && (isCancelUtterance(trimmed) || isCancelUtterance(normalized))) {
      searchQueryEarly = null;
    }
    const queueIntentEarly = extractQueue ? extractQueue(trimmed) : null;
    const briefIntentEarly = extractBrief ? extractBrief(trimmed) : null;
    const listQueryEarly = /\b(?:what(?:'s| is) on (?:my )?research list|show (?:my )?research (?:list|queue)|list (?:my )?research queue|what(?:'s| is) in (?:my )?research queue)\b/i.test(trimmed);
    const namedEarly = this._findNamedNpc(trimmed);
    const lucySearchEarly = searchQueryEarly && (!namedEarly || namedEarly.name === 'Lucy');
    const browserRetryEarly = extractBrowserRetry ? extractBrowserRetry(trimmed) : null;
    const lastSearchEarly = this._getLucyLastSearchQuery();
    const denizenNativeEarly = window.DenizenOpenClawDispatch?.isDenizenNativeIntent?.(normalized)
      || lucySearchEarly
      || wantsBrowserOpen
      || !!(browserRetryEarly?.retrySearch && lastSearchEarly)
      || !!(extractBrowserRead?.(trimmed) || extractBrowserRead?.(normalized))
      || !!(isCancelUtterance?.(trimmed) || isCancelUtterance?.(normalized))
      || !!(extractOpenBrave?.(normalized) || extractCloseBrowser?.(normalized)
        || (extractObserve?.(normalized) && !searchQueryEarly) || (extractScreenControl?.(normalized) && !searchQueryEarly));

    // Determine target NPC
    let targetNpc = null;
    let targetKey = null;
    let targetName = null;
    let needsWalkToPlayer = false;
    const player = this.scene?.player;
    const sceneReady = !!(this.scene && player);
    const pinnedThread = this._getActiveThread();

    if (pinnedThread?.type === 'dm' && pinnedThread.npcName) {
      targetName = pinnedThread.npcName;
      targetKey = globalThis.DenizenNpcRoster?.nameToKey?.[targetName.toLowerCase()]
        || globalThis.DenizenVisitorSession?.npcKeyToTextureKey?.(pinnedThread.npcKey);
      if (targetKey && sceneReady) {
        targetNpc = this.scene.npcs?.find((n) => n.texture?.key === targetKey) || null;
      }
    }

    // 1. Check if a name is mentioned in the message (priority — explicit intent)
    const named = !pinnedThread?.type || pinnedThread.type !== 'dm'
      ? this._findNamedNpc(trimmed)
      : null;
    if (named) {
      targetKey = named.key;
      targetName = named.name;
      targetNpc = this.scene.npcs?.find(n => n.texture?.key === targetKey);
    }

    // 1b. Continue active CEO conversation when no new name is mentioned.
    if (!named && this._ceoConvo?.npcKey) {
      const convoNpc = this.scene.npcs?.find(n => n.texture?.key === this._ceoConvo.npcKey);
      if (convoNpc) {
        targetNpc = convoNpc;
        targetKey = this._ceoConvo.npcKey;
        targetName = this._ceoConvo.npcName;
      }
    }

    // 2. If no name mentioned, check if facing an NPC nearby
    if (!targetNpc) {
      const facingNpc = this._findFacingNpc();
      if (facingNpc) {
        targetNpc = facingNpc;
        targetKey = facingNpc.texture?.key;
        targetName = this._getNpcName(targetKey);
      }
    }

    // 3. Bare greetings with no target → claimed assistant, else Lucy (chief of staff)
    const isBareGreeting = /^(?:hi|hey|hello|yo|sup|good\s+(?:morning|afternoon|evening))[!.?]*$/i.test(trimmed);
    if (!targetNpc && !named && !this._ceoConvo?.npcKey && isBareGreeting) {
      const assistantKey = this.getClaimedAssistantNpcKey();
      if (assistantKey) {
        targetKey = assistantKey;
        targetName = this._getNpcName(targetKey);
        targetNpc = this.scene?.npcs?.find(n => n.texture?.key === targetKey) || null;
      } else {
        targetName = 'Lucy';
        targetKey = this._nameToKey.lucy || this._nameToKey.Lucy || 'xp_lucy';
        targetNpc = this.scene?.npcs?.find(n => n.texture?.key === targetKey) || null;
      }
    }

    // 4. Fallback: nearest NPC
    if (!targetNpc && !targetKey) {
      targetNpc = this._findNearestNpc();
      if (targetNpc) {
        targetKey = targetNpc.texture?.key;
        targetName = this._getNpcName(targetKey);
      }
    }

    if (!targetKey || !targetName) {
      if (named) {
        targetKey = named.key;
        targetName = named.name;
      } else if (this._ceoConvo?.npcKey) {
        targetKey = this._ceoConvo.npcKey;
        targetName = this._ceoConvo.npcName;
      } else {
        targetName = 'Lucy';
        targetKey = this._nameToKey.lucy || this._nameToKey.Lucy || 'xp_lucy';
      }
    }

    if (!targetKey || !targetName) {
      this._addToLog('System', 'No NPC found to talk to.');
      return;
    }

    // Search / browser / research → Lucy (not whoever is nearest or facing).
    const resolveStaffNpc = window.DenizenOpenClawDispatch?.resolveStaffIntentNpc;
    const lucyStaffIntent = window.DenizenOpenClawDispatch?.isLucyStaffIntent?.(trimmed)
      || window.DenizenOpenClawDispatch?.isLucyStaffIntent?.(normalized)
      || lucySearchEarly;
    if (resolveStaffNpc && lucyStaffIntent) {
      const staffNpc = resolveStaffNpc(trimmed, targetName);
      if (staffNpc === 'Lucy' && targetName !== 'Lucy') {
        targetName = 'Lucy';
        targetKey = this._nameToKey.lucy || this._nameToKey.Lucy || 'xp_lucy';
        if (sceneReady) {
          targetNpc = this.scene.npcs?.find(n => n.texture?.key === targetKey) || null;
        }
      }
    }

    const dist = (sceneReady && targetNpc && player)
      ? Math.hypot(targetNpc.x - player.x, targetNpc.y - player.y)
      : 999;
    // Walk over when named, continuing the same chat, or standing too far away.
    const continuingSame = this._ceoConvo?.npcKey === targetKey;
    const isGreetingMsg = /^(?:hi|hey|hello|yo|sup|play\s+lucy)\s*$/i.test(trimmed)
      || /^(?:hi|hey|hello|yo|sup)\s+lucy\s*$/i.test(trimmed);
    if (continuingSame || isGreetingMsg || lucyStaffIntent) {
      needsWalkToPlayer = false;
    } else {
      needsWalkToPlayer = named ? dist > 20 : dist > this._ceoConvoWalkDist;
    }

    const isGreetingUtterance = window.DenizenOpenClawDispatch?.isGreetingUtterance?.(trimmed);
    if (isGreetingUtterance) {
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._waitingForResponse = false;
      this._lastTargetKey = targetKey;
      const greetReply = targetName === 'Lucy'
        ? 'Hey — want me to search something, open my browser, or dig into a topic?'
        : (this.getClaimedAssistantNpcKey() === targetKey
          ? 'Hey! What can I help you with today?'
          : 'Hey! What can I help with?');
      this._addToLog(targetName, greetReply);
      this._refreshCeoConversationHold(targetKey, targetName, null);
      return;
    }

    // Lucy — cancel / stop (voice cut-off like "no Luc").
    if (targetName === 'Lucy' && isCancelUtterance && isCancelUtterance(trimmed)) {
      this._lucySearchActive = null;
      if (this._searchTimeoutTimer) clearTimeout(this._searchTimeoutTimer);
      fetch('/api/lucy-browser/close', { method: 'POST' }).catch(() => {});
      this._addToLog('Lucy', 'Okay — stopping. Browser closed.');
      this._refreshCeoConversationHold(targetKey, targetName, null);
      return;
    }

    // Lucy — close browser on command.
    if (targetName === 'Lucy' && extractCloseBrowser && extractCloseBrowser(trimmed)) {
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._waitingForResponse = false;
      this._lastTargetKey = targetKey;
      this._showPlayerBubble(trimmed);
      if (needsWalkToPlayer) {
        this._addToLog('System', `${targetName} is coming over...`);
        this.manager.actions.emote(targetKey, '!');
        await this._walkNpcToPlayer(targetKey);
      } else {
        this.manager.actions.emote(targetKey, '!');
      }
      this._stopNpcForConversation(targetNpc, targetKey, trimmed);
      fetch('/api/lucy-browser/close', { method: 'POST' })
        .then(r => r.json())
        .then(j => this._addToLog('Lucy', j.message || 'Closing my browser now.'))
        .catch(err => this._addToLog('System', `Close failed: ${err?.message || err}`))
        .finally(() => this._refreshCeoConversationHold(targetKey, 'Lucy', null));
      return;
    }

    // Open CEO's real Brave browser (any NPC can trigger).
    if (extractOpenBrave && extractOpenBrave(trimmed)) {
      this._updateTargetLabel(targetName || 'Lucy');
      if (targetKey) this._beginCeoConversation(targetKey, targetName, trimmed);
      this._showPlayerBubble(trimmed);
      const urlMatch = trimmed.match(/https?:\/\/\S+/i);
      this._addToLog(targetName || 'Lucy', urlMatch ? 'Opening Brave…' : 'Opening your Brave browser…');
      fetch('/api/open-brave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlMatch ? urlMatch[0] : null }),
      }).then(r => r.json()).then(j => {
        if (!j.ok) this._addToLog('System', j.error || 'Could not open Brave.');
        if (targetKey) this._refreshCeoConversationHold(targetKey, targetName, null);
      }).catch(err => {
        this._addToLog('System', `Brave: ${err?.message || err}`);
        if (targetKey) this._refreshCeoConversationHold(targetKey, targetName, null);
      });
      return;
    }

    // Screen control — fill forms / click / type on CEO's real screen (when asked).
    if (extractScreenControl && extractScreenControl(trimmed) && !searchQueryEarly) {
      const controlNpc = targetName || 'Lucy';
      this._updateTargetLabel(controlNpc);
      if (targetKey) this._beginCeoConversation(targetKey, controlNpc, trimmed);
      this._showPlayerBubble(trimmed);
      this._addToLog(controlNpc, 'Taking over your screen to help…');
      fetch('/api/desktop-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcName: controlNpc, instruction: trimmed }),
      }).then(r => r.json()).then(j => {
        if (!j.ok) this._addToLog('System', j.error || 'Screen control failed.');
        if (targetKey) this._refreshCeoConversationHold(targetKey, controlNpc, null);
      }).catch(err => {
        this._addToLog('System', `Screen control: ${err?.message || err}`);
        if (targetKey) this._refreshCeoConversationHold(targetKey, controlNpc, null);
      });
      return;
    }

    // Screen observe — any NPC (screenshot + vision + web research).
    if (extractObserve && extractObserve(trimmed) && !searchQueryEarly) {
      const observeNpc = targetName || 'Lucy';
      this._updateTargetLabel(observeNpc);
      if (targetKey) this._beginCeoConversation(targetKey, observeNpc, trimmed);
      this._showPlayerBubble(trimmed);
      this._addToLog(observeNpc, 'Looking at your screen…');
      fetch('/api/screen-observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npcName: observeNpc, instruction: trimmed }),
      }).then(r => r.json()).then(j => {
        if (j.summary) this._addToLog(observeNpc, j.summary.slice(0, 2000));
        else this._addToLog('System', j.error || 'Screen observe failed.');
        if (targetKey) this._refreshCeoConversationHold(targetKey, observeNpc, null);
      }).catch(err => {
        this._addToLog('System', `Screen observe: ${err?.message || err}`);
        if (targetKey) this._refreshCeoConversationHold(targetKey, observeNpc, null);
      });
      return;
    }

    // Lucy — retry last failed search (optionally reopen browser first).
    const browserRetry = extractBrowserRetry ? extractBrowserRetry(trimmed) : null;
    const lastSearchQuery = this._getLucyLastSearchQuery();
    const wantsSearchAgain = /\b(?:search|do it|try|run it)(?:\s+it)?\s+again\b/i.test(trimmed);
    if (targetName === 'Lucy' && lastSearchQuery && (browserRetry?.retrySearch || (wantsBrowserOpen && wantsSearchAgain))) {
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._waitingForResponse = false;
      this._lastTargetKey = targetKey;
      if (sceneReady) {
        this._showPlayerBubble(trimmed);
        if (this.manager?.actions) this.manager.actions.emote(targetKey, '!');
        this._stopNpcForConversation(targetNpc, targetKey, trimmed);
      }
      const retryQuery = lastSearchQuery;
      const reopen = browserRetry?.openBrowser || wantsBrowserOpen;
      if (reopen) {
        this._addToLog('Lucy', `Opening my browser and searching "${retryQuery}" again…`);
        fetch('/api/lucy-browser/close', { method: 'POST' }).catch(() => {});
      } else {
        this._addToLog('Lucy', `Trying "${retryQuery}" again…`);
      }
      this._lucySearchFetch({ query: retryQuery }, targetKey, 'Lucy');
      return;
    }

    // Lucy — read/summarize a doc in the browser (screen observe, not LM Studio chat).
    if (targetName === 'Lucy' && extractBrowserRead && extractBrowserRead(trimmed)) {
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._waitingForResponse = false;
      this._lastTargetKey = targetKey;
      this._addToLog('Lucy', 'Reading what\'s in the browser…');
      fetch('/api/screen-observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          npcName: 'Lucy',
          instruction: `The CEO said: "${trimmed}". Read the current browser tab and summarize the document in plain English.`,
        }),
      }).then(r => r.json()).then(j => {
        if (j.summary) this._addToLog('Lucy', j.summary.slice(0, 2000));
        else this._addToLog('System', j.error || 'Could not read the browser page.');
      }).catch(err => this._addToLog('System', `Browser read failed: ${err?.message || err}`))
        .finally(() => this._refreshCeoConversationHold(targetKey, targetName, null));
      return;
    }

    // Lucy — open visible Playwright browser (not desktop control, no LM Studio).
    if (targetName === 'Lucy' && wantsBrowserOpen && !wantsSearchAgain) {
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._waitingForResponse = false;
      this._lastTargetKey = targetKey;
      if (sceneReady) {
        this._showPlayerBubble(trimmed);
        if (this.manager?.actions) this.manager.actions.emote(targetKey, '!');
        this._stopNpcForConversation(targetNpc, targetKey, trimmed);
      }
      this._addToLog('Lucy', 'Opening my browser now…');
      this._lucySearchFetch({ query: 'browser', openOnly: true }, targetKey, 'Lucy');
      return;
    }

    // Lucy — Indeed/LinkedIn job search (direct URL, not DuckDuckGo).
    const jobBoardIntent = extractJobBoard ? extractJobBoard(trimmed) : null;
    if (targetName === 'Lucy' && jobBoardIntent) {
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._waitingForResponse = false;
      this._lastTargetKey = targetKey;
      this._showPlayerBubble(trimmed);
      if (needsWalkToPlayer) {
        this._addToLog('System', `${targetName} is coming over...`);
        this.manager.actions.emote(targetKey, '!');
        await this._walkNpcToPlayer(targetKey);
      } else {
        this.manager.actions.emote(targetKey, '!');
      }
      this._stopNpcForConversation(targetNpc, targetKey, trimmed);
      const jbLabel = jobBoardIntent.site === 'linkedin' ? 'LinkedIn Jobs' : 'Indeed';
      this._addToLog('Lucy', `Opening ${jbLabel}${jobBoardIntent.query ? ` for "${jobBoardIntent.query}"` : ''}…`);
      this._lucySearchFetch({
        query: jobBoardIntent.query || `jobs on ${jobBoardIntent.site}`,
        directUrl: jobBoardIntent.url,
        jobBoard: jobBoardIntent.site,
        browserMode: 'chrome',
      }, targetKey, 'Lucy');
      return;
    }

    // Lucy web search — visible browser, bypasses OpenClaw gateway + brain text reply.
    let searchQuery = searchQueryEarly || (extractSearch ? extractSearch(normalized) : null);
    if (!searchQuery && extractBareTopic && targetName === 'Lucy'
      && (this._lucySearchContext || this._ceoConvo?.npcName === 'Lucy')) {
      searchQuery = extractBareTopic(trimmed);
    }
    if (searchQuery && /^(?:search|google|look\s*up|on\s+the\s+web|the\s+web|web)$/i.test(String(searchQuery).trim())) {
      searchQuery = null;
    }
    if (targetName === 'Lucy' && !searchQuery && /\b(?:search|google|look\s+up)\b/i.test(normalized)) {
      const lastQ = this._getLucyLastSearchQuery();
      if (lastQ && (browserRetry?.retrySearch || (wantsBrowserOpen && wantsSearchAgain))) {
        this._updateTargetLabel(targetName);
        this._beginCeoConversation(targetKey, targetName, trimmed);
        this._addToLog('Lucy', `Opening my browser and searching "${lastQ}" again…`);
        fetch('/api/lucy-browser/close', { method: 'POST' }).catch(() => {});
        this._lucySearchFetch({ query: lastQ }, targetKey, 'Lucy');
        return;
      }
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._addToLog('Lucy', 'What should I search for? Try: search Goldendoodles or search remote AI jobs.');
      this._refreshCeoConversationHold(targetKey, 'Lucy', null);
      return;
    }
    if (targetName === 'Lucy' && searchQuery) {
      if (this._lucySearchActive) {
        fetch('/api/lucy-browser/close', { method: 'POST' }).catch(() => {});
      }
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._waitingForResponse = false;
      this._lastTargetKey = targetKey;
      this._showPlayerBubble(trimmed);

      if (needsWalkToPlayer) {
        this._addToLog('System', `${targetName} is coming over...`);
        this.manager.actions.emote(targetKey, '!');
        await this._walkNpcToPlayer(targetKey);
      } else {
        this.manager.actions.emote(targetKey, '!');
      }
      this._stopNpcForConversation(targetNpc, targetKey, trimmed);

      this._addToLog('Lucy', `Looking up "${searchQuery}" — I'll give you a quick brief when it's ready.`);
      this._lucySearchFetch({ query: searchQuery }, targetKey, 'Lucy');
      if (!this.scene?.player) {
        this._addToLog('System', 'Office is still loading — Lucy works from chat; her browser opens as a separate window on your desktop.');
      }
      return;
    }

    // Lucy research brief — Bob writes a deep brief; server broadcasts when done.
    const briefTopic = briefIntentEarly || (extractBrief ? extractBrief(trimmed) : null);
    if (targetName === 'Lucy' && briefTopic) {
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._waitingForResponse = false;
      this._lastTargetKey = targetKey;
      this._showPlayerBubble(trimmed);

      if (needsWalkToPlayer) {
        this._addToLog('System', `${targetName} is coming over...`);
        this.manager.actions.emote(targetKey, '!');
        await this._walkNpcToPlayer(targetKey);
      } else {
        this.manager.actions.emote(targetKey, '!');
      }
      this._stopNpcForConversation(targetNpc, targetKey, trimmed);

      this._addToLog('Lucy', `Queuing a deep research brief on "${briefTopic}" — Bob will write it up.`);
      fetch('/api/research-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: briefTopic }),
      }).then(r => r.json()).then(j => {
        if (!j.ok) {
          this._addToLog('System', `Research brief failed: ${j.error || 'unknown error'}`);
        } else if (j.note) {
          this._addToLog('System', j.note);
        }
      }).catch(err => {
        this._addToLog('System', `Research brief failed: ${err?.message || err}`);
      }).finally(() => {
        this._refreshCeoConversationHold(targetKey, 'Lucy', null);
      });
      return;
    }

    // Content pipeline — start autonomous newsroom chain.
    const newsroomMatch = trimmed.match(
      /\b(?:start|run|kick off)\s+(?:the\s+)?(?:newsroom|content pipeline)(?:\s+(?:on|about|for)\s+(.+?))?\.?$/i,
    );
    if (newsroomMatch) {
      const topic = String(newsroomMatch[1] || 'industry trends today').trim();
      this._showPlayerBubble(trimmed);
      this._addToLog('System', `Starting content pipeline: ${topic}`);
      fetch('/api/content-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, triggeredBy: targetName || 'CEO' }),
      }).then((r) => r.json()).then((j) => {
        if (j.ok) {
          this._addToLog('System', `Pipeline started (${j.steps} steps) — chain ${j.chainId}`);
        } else {
          this._addToLog('System', `Pipeline failed: ${j.error || 'unknown'}`);
        }
      }).catch((err) => {
        this._addToLog('System', `Pipeline failed: ${err?.message || err}`);
      });
      return;
    }

    // Lucy research queue — add a topic for Bob to pick up later.
    const queueIntent = queueIntentEarly || (extractQueue ? extractQueue(trimmed) : null);
    if (targetName === 'Lucy' && queueIntent) {
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._waitingForResponse = false;
      this._lastTargetKey = targetKey;
      this._showPlayerBubble(trimmed);

      if (needsWalkToPlayer) {
        this._addToLog('System', `${targetName} is coming over...`);
        this.manager.actions.emote(targetKey, '!');
        await this._walkNpcToPlayer(targetKey);
      } else {
        this.manager.actions.emote(targetKey, '!');
      }
      this._stopNpcForConversation(targetNpc, targetKey, trimmed);

      const priority = queueIntent.priority || 'normal';
      this._addToLog('Lucy', `Adding "${queueIntent.topic}" to your research queue (${priority} priority).`);
      fetch('/api/research-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: queueIntent.topic, priority }),
      }).then(r => r.json()).then(j => {
        if (!j.ok) {
          this._addToLog('System', `Research queue failed: ${j.error || 'unknown error'}`);
        } else if (typeof j.pending === 'number') {
          this._addToLog('System', `${j.pending} topic${j.pending === 1 ? '' : 's'} pending in queue.`);
        }
      }).catch(err => {
        this._addToLog('System', `Research queue failed: ${err?.message || err}`);
      }).finally(() => {
        this._refreshCeoConversationHold(targetKey, 'Lucy', null);
      });
      return;
    }

    // Lucy research list — show what's queued.
    if (targetName === 'Lucy' && listQueryEarly) {
      this._updateTargetLabel(targetName);
      this._beginCeoConversation(targetKey, targetName, trimmed);
      this._waitingForResponse = false;
      this._lastTargetKey = targetKey;
      this._showPlayerBubble(trimmed);

      if (needsWalkToPlayer) {
        this._addToLog('System', `${targetName} is coming over...`);
        this.manager.actions.emote(targetKey, '!');
        await this._walkNpcToPlayer(targetKey);
      } else {
        this.manager.actions.emote(targetKey, '!');
      }
      this._stopNpcForConversation(targetNpc, targetKey, trimmed);

      fetch('/api/research-queue')
        .then(r => r.json())
        .then(j => {
          const items = Array.isArray(j.items) ? j.items : (Array.isArray(j.queue) ? j.queue : []);
          const pending = typeof j.pending === 'number' ? j.pending : items.length;
          if (!j.ok && j.error) {
            this._addToLog('System', `Couldn't load research queue: ${j.error}`);
            return;
          }
          if (pending === 0) {
            this._addToLog('Lucy', 'Your research list is empty — want me to add something?');
            return;
          }
          const preview = items.slice(0, 5).map((it) => {
            const t = typeof it === 'string' ? it : (it.topic || it.title || '(untitled)');
            const p = typeof it === 'object' && it.priority ? ` [${it.priority}]` : '';
            return `${t}${p}`;
          }).join('; ');
          const more = pending > 5 ? ` (+${pending - 5} more)` : '';
          this._addToLog('Lucy', `${pending} pending: ${preview}${more}`);
        })
        .catch(err => {
          this._addToLog('System', `Couldn't load research queue: ${err?.message || err}`);
        })
        .finally(() => {
          this._refreshCeoConversationHold(targetKey, 'Lucy', null);
        });
      return;
    }

    if (this._waitingForResponse && this._lastTargetKey && this._lastTargetKey !== targetKey) {
      this._addToLog('System', 'Still waiting for a reply — finish that chat or wait.');
      return;
    }

    if (this._shouldEndCeoConversation(trimmed) && this._ceoConvo?.npcKey === targetKey) {
      this._addToLog('System', `${targetName} will head back.`);
      this._ceoConvo._ending = true;
    } else if (this._playerGaveTask(trimmed) && this._ceoConvo?.npcKey === targetKey) {
      this._cancelNpcQueuedActions(targetKey);
      this._ceoConvo._taskRelease = true;
      this._refreshCeoConversationHold(targetKey, targetName, trimmed);
    } else {
      this._beginCeoConversation(targetKey, targetName, trimmed);
    }

    // Show who we're targeting
    this._updateTargetLabel(targetName);
    this._waitingForResponse = true;
    this._lastTargetKey = targetKey; // remember for response handler
    this._lastUserChatTarget = targetName;
    this._lastUserChatAt = Date.now();
    if (targetName === 'Lucy' && globalThis.DenizenNpcCapabilities?.isCapabilitiesQuestion?.(trimmed)) {
      this._lucySearchActive = null;
    }

    // "Follow me" intent — handled client-side for instant response. The NPC
    // starts trailing the player immediately; the message still goes to the
    // server so the brain has context for its spoken reply.
    const acts = this.manager?.actions;
    if (acts && typeof acts.startFollow === 'function') {
      const followRe = /\b(follow me|come with me|come along|follow along|walk with me|tag along|lead the way|after me)\b/i;
      const stopFollowRe = /\b(stop following|stop follow|wait here|stay here|stay there|stay put|that'?s enough|you can stop|hold here|wait there|go back to (your )?desk)\b/i;
      if (stopFollowRe.test(trimmed) && acts.isFollowing(targetKey)) {
        acts.stopFollow(targetKey);
        try { acts.speak(targetKey, "Okay — I'll wait here."); } catch (_) {}
      } else if (followRe.test(trimmed)) {
        acts.startFollow(targetKey);
        try { acts.speak(targetKey, 'Right behind you!'); } catch (_) {}
      }
    }

    // "Hold a meeting about X" intent — convene a dynamic team discussion.
    const meetingMatch = trimmed.match(/\b(?:hold|call|start|set up|run|have)\s+(?:a\s+)?(?:team\s+)?meeting\s+(?:about|on|to discuss|regarding)\s+(.+)/i)
      || trimmed.match(/\b(?:have|get)\s+(?:the\s+)?(?:team|everyone)\s+(?:to\s+)?(?:discuss|meet about|talk about|figure out)\s+(.+)/i);
    if (meetingMatch && meetingMatch[1]) {
      const topic = meetingMatch[1].replace(/[.?!]+$/, '').trim().slice(0, 200);
      this._addToLog('System', `Convening a meeting about: ${topic}…`);
      fetch('/api/meeting', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      }).then(r => r.json()).then(j => {
        if (j.error) this._addToLog('System', `Couldn't start meeting: ${j.error}`);
      }).catch(() => {});
    }

    // Proximity-audio: tell the audio gate the player is now in active
    // conversation with this NPC, so every other NPC's voice line is
    // muted for the duration of the chat. Decays after ~30s of no
    // further messages.
    if (window.DenizenProximityAudio?.setActiveConvoNpc) {
      try { window.DenizenProximityAudio.setActiveConvoNpc(targetName); }
      catch (_) { /* best-effort */ }
    }

    if (sceneReady) {
      if (needsWalkToPlayer && this.manager?.actions) {
        this._addToLog('System', `${targetName} is coming over...`);
        this.manager.actions.emote(targetKey, '!');
        await this._walkNpcToPlayer(targetKey);
      } else if (this.manager?.actions) {
        this.manager.actions.emote(targetKey, '!');
      }
      this._stopNpcForConversation(targetNpc, targetKey, trimmed);
    }

    // OpenClaw gateway — only for real external actions (not Lucy search/browser/greetings).
    const skipOpenClaw = window.DenizenOpenClawDispatch?.isDenizenNativeIntent?.(trimmed)
      || window.DenizenOpenClawDispatch?.isDenizenNativeIntent?.(normalized)
      || lucySearchEarly
      || denizenNativeEarly
      || wantsBrowserOpen
      || !!(browserRetryEarly?.retrySearch && lastSearchEarly);
    if (!skipOpenClaw && window.DenizenOpenClawDispatch?.classify) {
      try {
        const c = window.DenizenOpenClawDispatch.classify(trimmed);
        if (c.kind === 'action') {
          const gate = window.DenizenOpenClawDispatch.evaluateActionPolicy
            ? window.DenizenOpenClawDispatch.evaluateActionPolicy(c.stripped, c)
            : { allowed: true };
          if (!gate.allowed) {
            if (gate.requiresConfirmation) {
              this._addToLog('System', 'OpenClaw policy: confirmation required. Use /run ... or switch policy mode to auto-safe.');
            } else {
              this._addToLog('System', `OpenClaw policy blocked action: ${gate.reason || 'restricted request'}`);
            }
          } else {
            this._addToLog('System', `→ OpenClaw (${c.reason})`);
            window.DenizenOpenClawDispatch
              .sendToGateway(c.stripped, { urgent: c.urgent })
              .then((r) => (r.ok ? r : window.DenizenOpenClawDispatch.sendToHttpProxy(c.stripped, { urgent: c.urgent })))
              .then((r) => {
                if (!r?.ok) this._addToLog('System', `OpenClaw dispatch failed: ${r?.error || 'unknown'}`);
              })
              .catch(err => this._addToLog('System', `OpenClaw error: ${err?.message || err}`));
          }
        }
      } catch (err) {
        console.warn('[PlayerChat] dispatch classify failed:', err?.message || err);
      }
    }

    // Send to server for NPC brain processing
    const wsReady = await this._ensureWsOpen(5000);
    if (!wsReady) {
      const caps = globalThis.DenizenNpcCapabilities;
      if (caps?.isCapabilitiesQuestion?.(trimmed) && targetName && caps.formatCapabilitiesReply) {
        this._waitingForResponse = false;
        this.handleNpcResponse(targetName, caps.formatCapabilitiesReply(targetName));
        return;
      }
      this._waitingForResponse = false;
      this._clearTyping();
      this._addToLog('System', 'Reconnecting chat… try again in a few seconds, or hard-refresh (Ctrl+Shift+R).');
      this._resumeNpc(targetKey);
      return;
    }

    const active = this._getActiveThread();
    if (active?.type === 'group' && active.groupId) {
      this._waitingForResponse = true;
      this.manager._send({
        type: 'player_group_chat',
        group_id: active.groupId,
        text: trimmed,
        session_id: globalThis.DenizenVisitorSession?.getSessionId?.() || null,
      });
      this._setTyping(this._getActiveThread()?.title || 'Group');
      this._responseTimeout = setTimeout(() => {
        if (this._waitingForResponse) {
          this._waitingForResponse = false;
          this._clearTyping();
          this._addToLog('System', '(no group reply — LM Studio may be busy)');
        }
      }, 60000);
      return;
    }

    this.manager._send({
      type: 'player_chat',
      npcName: targetName,
      npcKey: targetKey,
      text: trimmed,
      voice_mode: !!(this._voiceMode || globalThis.DenizenVoiceSession?.isActive?.()),
      turn_id: this._voiceTurnId || null,
      session_id: globalThis.DenizenVisitorSession?.getSessionId?.() || null,
      playerPos: {
        x: Math.round(this.scene?.player?.x || 0),
        y: Math.round(this.scene?.player?.y || 0),
      },
    });

    // Notify any pending reply-waiters (e.g. Lucy's tour waiting for player response)
    const resolvers = this.manager?._pendingReplyResolvers;
    if (Array.isArray(resolvers) && resolvers.length > 0) {
      const toFire = resolvers.splice(0);
      toFire.forEach(fn => { try { fn(trimmed); } catch (_) {} });
    }

    this._setTyping(targetName);

    // Timeout after 60s. Player chat jumps the LM Studio queue but can
    // still wait behind 1–2 in-flight think jobs when the GPU is saturated.
    this._responseTimeout = setTimeout(() => {
      if (this._waitingForResponse) {
        this._waitingForResponse = false;
        this._clearTyping();
        this._addToLog(targetName, '(no response — LM Studio may be busy; check ⋯ diag chip bottom-left)');
      }
    }, 60000);
  }

  /**
   * Resume an NPC after conversation — go back to desk or wander
   */
  _resumeNpc(npcKey) {
    const agent = this.manager?.agents?.get(npcKey);
    if (agent?.assignedDesk && this.manager?.actions) {
      this.manager.actions.useComputer(npcKey, agent.assignedDesk);
    } else {
      const npc = this.manager?.actions?._getNpc(npcKey);
      if (npc?.ai) {
        npc.ai.mode = 'wander';
        npc.ai.taskState = 'idle';
        npc.ai.nextWanderAt = 0;
      }
    }
  }

  /**
   * Handle NPC response from server
   */
  handleGroupResponse(groupId, npcName, text, error) {
    this._waitingForResponse = false;
    this._clearTyping();
    if (this._responseTimeout) {
      clearTimeout(this._responseTimeout);
      this._responseTimeout = null;
    }
    const threadId = this._groupThreadId(groupId);
    const thread = this._ensureThread({
      threadId,
      type: 'group',
      groupId,
      title: this._threads.get(threadId)?.title || 'Group',
    });
    if (error) this._addToLog('System', `⚠️ ${error}`, { threadId });
    const safeText = typeof text === 'string' && text.length > 0 ? text : '(No reply right now.)';
    this._addToLog(npcName, safeText, { threadId });
    thread.preview = `${npcName}: ${safeText}`.slice(0, 120);
    thread.updatedAt = Date.now();
    if (this._activeThreadId === threadId) this._renderLog();
    globalThis.DenizenPhoneChatUI?.refreshThreads?.();
    if (!error) window.DenizenHaptics?.notify?.();
  }

  handlePlayerChatCancelled(msg = {}) {
    if (msg.turn_id && this._voiceTurnId && msg.turn_id !== this._voiceTurnId) return;
    this._voiceStreamLogId = null;
    this._voiceStreamBuf = null;
    this._waitingForResponse = false;
    this._clearTyping();
    if (this._responseTimeout) {
      clearTimeout(this._responseTimeout);
      this._responseTimeout = null;
    }
    try { globalThis.DenizenVoiceCallUi?.setMode?.('listening'); } catch (_) {}
  }

  handleVoiceStreamToken(npcName, token) {
    if (!token) return;
    if (!this._voiceStreamBuf) this._voiceStreamBuf = { npcName, text: '' };
    if (this._voiceStreamBuf.npcName !== npcName) {
      this._voiceStreamBuf = { npcName, text: '' };
    }
    this._voiceStreamBuf.text += String(token);
    this._clearTyping();
    if (!this._voiceStreamLogId) {
      this._voiceStreamLogId = `voice-stream-${Date.now()}`;
      this._addToLog(npcName, this._voiceStreamBuf.text, { streamId: this._voiceStreamLogId });
    } else {
      const entry = this._chatLog.find((m) => m.streamId === this._voiceStreamLogId);
      if (entry) {
        entry.text = this._voiceStreamBuf.text;
        if (this._activeThreadId) this._renderLog();
      }
    }
    try { globalThis.DenizenVoiceCallUi?.setMode?.('speaking'); } catch (_) {}
  }

  handleNpcResponse(npcName, text, delegation, error, extras = {}) {
    this._voiceStreamLogId = null;
    this._voiceStreamBuf = null;
    if (globalThis.DenizenVoiceSession?.isActive?.()) {
      try { globalThis.DenizenVoiceCallUi?.setMode?.('listening'); } catch (_) {}
      try {
        if (!globalThis.DenizenVoiceInput?.isListening?.()) {
          globalThis.DenizenVoiceInput?.start?.();
        }
      } catch (_) {}
    }
    this._waitingForResponse = false;
    this._clearTyping();
    if (this._responseTimeout) {
      clearTimeout(this._responseTimeout);
      this._responseTimeout = null;
    }

    const safeText = typeof text === 'string' && text.length > 0
      ? text
      : '(No reply right now.)';

    if (npcName === 'Bouncer' && window.DenizenSecurityFeed?.isSecurityTraffic?.(safeText)) {
      window.DenizenSecurityFeed.ingest({ text: safeText, kind: 'incident' });
      if (error) this._addToLog('System', `⚠️ ${error}`);
      return;
    }

    // If the server tagged an explicit error on this response, surface
    // it so the user knows WHY the reply is so terse / generic. This
    // is the difference between "Got it, I'll look into that." (looks
    // friendly, hides the failure) and a clear "👉 LM Studio not
    // reachable — open the ⋯ diag chip" message.
    if (error) {
      this._addToLog('System', `⚠️ ${error}`);
    }

    const folder = this._folderForNpcName(npcName);
    const dmThreadId = folder ? `dm:${folder}` : null;
    if (dmThreadId) {
      const thread = this._ensureThread({
        threadId: dmThreadId,
        type: 'dm',
        npcKey: folder,
        npcName,
        title: npcName,
      });
      thread.preview = safeText.slice(0, 120);
      thread.updatedAt = Date.now();
      if (!this._activeThreadId) this._activeThreadId = dmThreadId;
    }
    this._addToLog(npcName, safeText, {
      ...(dmThreadId ? { threadId: dmThreadId } : {}),
      crmActions: extras.crmActions || null,
    });
    globalThis.DenizenPhoneChatUI?.refreshThreads?.();
    if (!error) window.DenizenHaptics?.notify?.();

    // Show speech bubble on the NPC. actions.speak → _showSpeechBubble
    // now also fires window.DenizenSpeak for us (since the autonomous-
    // speech TTS fix), so this single path covers both visual + audio.
    const npcKey = this._nameToKey[npcName?.toLowerCase()] || this._lastTargetKey;
    const bubblePathFired = !!(npcKey && this.manager?.actions);
    if (bubblePathFired) {
      this.manager.actions.speak(npcKey, safeText);
    }

    // Audio fallback — only fire the explicit DenizenSpeak if the bubble
    // path didn't (unknown NPC key, manager not yet wired). Without this
    // guard the player heard EVERY reply twice: once via the bubble,
    // once here. The proximity slot deduped most of them but the timing
    // was close enough that both got through occasionally.
    if (!bubblePathFired
        && globalThis.DenizenPresence?.zionPresent
        && globalThis.DenizenSpeak) {
      try { globalThis.DenizenSpeak(npcName, safeText); }
      catch (err) { console.warn('[PlayerChat] DenizenSpeak failed:', err?.message || err); }
    }

    // Handle delegation — NPC escalates to their superior
    if (delegation && delegation.delegateTo) {
      const superiorName = delegation.delegateTo;
      const superiorKey = this._nameToKey[superiorName?.toLowerCase()];
      const reason = delegation.reason || 'escalating';

      this._addToLog('System', `${npcName} is delegating to ${superiorName}: "${reason}"`);

      if (superiorKey && this.manager?.actions) {
        // After speech bubble shows, NPC walks to their superior
        this.scene.time.delayedCall(2500, () => {
          this.manager.actions.speakTo(npcKey, superiorKey, reason);

          // After speaking to superior, superior comes to the player
          this.scene.time.delayedCall(4000, () => {
            this.manager.actions.reportToCEO(superiorKey);

            // Superior responds to the original task
            this.scene.time.delayedCall(3000, () => {
              if (this.manager?.ws?.readyState === WebSocket.OPEN) {
                this.manager._send({
                  type: 'player_chat',
                  npcName: superiorName,
                  npcKey: superiorKey,
                  text: `[Delegated from ${npcName}] ${delegation.originalMessage || ''}`,
                  playerPos: {
                    x: Math.round(this.scene.player?.x || 0),
                    y: Math.round(this.scene.player?.y || 0),
                  },
                });
              } else {
                this._addToLog('System', 'Not connected to server — delegation stopped. Run `node server.js` and refresh.');
                if (npcKey) this._resumeNpc(npcKey);
                if (superiorKey) this._resumeNpc(superiorKey);
              }
            });
          });
        });
        return; // scheduled chain moves NPCs; do not run generic resume here
      }
      this._addToLog('System', `Delegation skipped — unknown coworker "${superiorName}".`);
    }

    this._hasActions = false;

    if (this._ceoConvo?.npcKey === npcKey) {
      const npc = this.manager?.actions?._getNpc(npcKey);
      const releaseForTask = this._ceoConvo._taskRelease || this._hasActions;
      if (!releaseForTask && npc) {
        this._stopNpcForConversation(npc, npcKey, null);
        this._refreshCeoConversationHold(npcKey, npcName, null);
      }
      if (this._ceoConvo._ending || this._shouldEndCeoConversation(safeText)) {
        this.scene.time.delayedCall(3500, () => {
          if (this._ceoConvo?.npcKey === npcKey) {
            this._endCeoConversation('conversation ended');
          }
        });
      } else if (releaseForTask) {
        this._ceoConvo._taskRelease = false;
        this.scene.time.delayedCall(2500, () => {
          if (this._ceoConvo?.npcKey === npcKey) {
            this._endCeoConversation('task assigned');
          }
        });
      }
    }
  }

  _isTouchUi() {
    return !!window.__DenizenIsTouch
      || document.documentElement.classList.contains('denizen-touch');
  }

  _ensureDomPlayerBubbleStyles() {
    if (document.getElementById('denizen-player-speech-dom-style')) return;
    const s = document.createElement('style');
    s.id = 'denizen-player-speech-dom-style';
    s.textContent = `
      #denizen-player-speech-dom {
        position: fixed;
        z-index: 2147483488;
        max-width: min(280px, calc(100dvw - 24px));
        padding: 9px 13px;
        border-radius: 18px;
        border: 1px solid rgba(147, 197, 253, 0.42);
        background: linear-gradient(
          168deg,
          rgba(64, 156, 255, 0.92) 0%,
          rgba(10, 132, 255, 0.88) 100%
        );
        color: #ffffff;
        font: 600 15px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
        text-align: center;
        pointer-events: none;
        opacity: 0;
        transform: translate(-50%, -100%) scale(0.92);
        transition: opacity 0.15s ease, transform 0.15s ease;
        -webkit-backdrop-filter: blur(20px) saturate(170%);
        backdrop-filter: blur(20px) saturate(170%);
        box-shadow:
          0 4px 16px rgba(10, 132, 255, 0.28),
          inset 0 1px 0 rgba(255, 255, 255, 0.32);
        word-wrap: break-word;
      }
      #denizen-player-speech-dom.show {
        opacity: 1;
        transform: translate(-50%, -100%) scale(1);
      }
      #denizen-player-speech-dom::after {
        content: '';
        position: absolute;
        left: 50%;
        bottom: -8px;
        width: 0;
        height: 0;
        border-left: 8px solid transparent;
        border-right: 8px solid transparent;
        border-top: 8px solid rgba(10, 132, 255, 0.88);
        transform: translateX(-50%);
      }
    `;
    document.head.appendChild(s);
  }

  _hideDomPlayerBubble() {
    const el = this._domPlayerBubbleEl;
    if (!el) return;
    el.classList.remove('show');
    if (this._domPlayerBubbleTimer) {
      clearTimeout(this._domPlayerBubbleTimer);
      this._domPlayerBubbleTimer = null;
    }
  }

  _positionDomPlayerBubble() {
    const el = this._domPlayerBubbleEl;
    if (!el) return;

    const gameEl = document.getElementById('game-container');
    const phoneScreen = document.getElementById('denizen-phone-screen');
    const phoneOpen = document.documentElement.classList.contains('denizen-phone-open');

    let left;
    let top;

    if (gameEl) {
      const rect = gameEl.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 40) {
        const player = this.scene?.player;
        const cam = this.scene?.cameras?.main;
        left = rect.left + rect.width / 2;
        top = rect.top + rect.height * 0.38;
        if (player && cam) {
          const zoom = cam.zoom || 1;
          const sx = ((player.x - cam.scrollX) * zoom / cam.width + 0.5) * rect.width + rect.left;
          const sy = ((player.y - 52 - cam.scrollY) * zoom / cam.height + 0.5) * rect.height + rect.top;
          if (Number.isFinite(sx) && Number.isFinite(sy)) {
            left = sx;
            top = sy;
          }
        }
      }
    }

    if ((left == null || top == null) && phoneOpen && phoneScreen) {
      const pr = phoneScreen.getBoundingClientRect();
      left = pr.left + pr.width / 2;
      top = pr.top + Math.min(72, pr.height * 0.22);
    }

    if (left == null || top == null) return;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  _showDomPlayerBubble(text) {
    this._ensureDomPlayerBubbleStyles();
    let el = this._domPlayerBubbleEl;
    if (!el) {
      el = document.createElement('div');
      el.id = 'denizen-player-speech-dom';
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
      this._domPlayerBubbleEl = el;
    }
    el.textContent = text;
    this._positionDomPlayerBubble();
    el.classList.add('show');
    if (this._domPlayerBubbleTimer) clearTimeout(this._domPlayerBubbleTimer);
    this._domPlayerBubbleTimer = setTimeout(() => this._hideDomPlayerBubble(), 4000);
  }

  /**
   * Show player's speech as a bubble above the player sprite
   */
  _showPlayerBubble(text) {
    const truncated = text.length > 80 ? `${text.slice(0, 77)}...` : text;
    const touch = this._isTouchUi();

    if (this._playerBubble) {
      this._playerBubble.destroy();
      this._playerBubble = null;
    }
    this._hideDomPlayerBubble();

    const player = this.scene?.player;
    if (player && this.scene?.add) {
      const fontSize = touch ? '14px' : '10px';
      this._playerBubble = this.scene.add.text(player.x, player.y - 60, truncated, {
        fontSize,
        fontFamily: 'monospace',
        color: '#ffffff',
        backgroundColor: '#0A84FF',
        padding: { x: touch ? 7 : 5, y: touch ? 5 : 4 },
        wordWrap: { width: touch ? 220 : 180 },
        align: 'center',
      });
      this._playerBubble.setOrigin(0.5, 1);
      this._playerBubble.setDepth(9999);
      if (this.scene.time) {
        this.scene.time.delayedCall(4000, () => {
          if (this._playerBubble) {
            this._playerBubble.destroy();
            this._playerBubble = null;
          }
        });
      }
    }

    if (touch) {
      this._showDomPlayerBubble(truncated);
    }
  }

  /**
   * Update player bubble position (call from scene update)
   */
  updateBubbles() {
    if (this._playerBubble && this.scene?.player) {
      this._playerBubble.x = this.scene.player.x;
      this._playerBubble.y = this.scene.player.y - 60;
    }
    if (this._domPlayerBubbleEl?.classList.contains('show')) {
      this._positionDomPlayerBubble();
    }
    this._tickCeoConversation();
  }

  /** Keep the active CEO-chat NPC beside the player and facing them. */
  _tickCeoConversation() {
    if (!this._ceoConvo) return;
    const { npcKey } = this._ceoConvo;
    const npc = this.manager?.actions?._getNpc(npcKey);
    const player = this.scene.player;
    if (!npc?.ai || !player) return;

    const now = this.scene.time?.now || 0;
    if ((npc.ai._ceoConvoUntil || 0) <= now) return;

    const dist = Math.hypot(npc.x - player.x, npc.y - player.y);
    const holdDist = this._ceoConvoWalkDist;

    if (npc.ai.taskState === 'reporting' && dist <= holdDist + 12) {
      const dx = player.x - npc.x;
      const dy = player.y - npc.y;
      if (Math.abs(dx) > Math.abs(dy)) npc.ai.facing = dx < 0 ? 'left' : 'right';
      else npc.ai.facing = dy < 0 ? 'up' : 'down';
      npc.body.setVelocity(0, 0);
      return;
    }

    if (dist > holdDist + 24 && npc.ai.taskState !== 'walking' && now >= this._ceoReapproachAt) {
      this._ceoReapproachAt = now + 1200;
      this._walkNpcToPlayer(npcKey).then(() => {
        const n = this.manager?.actions?._getNpc(npcKey);
        if (n && this._ceoConvo?.npcKey === npcKey) this._stopNpcForConversation(n, npcKey, null);
      }).catch(() => {});
    }
  }

  // --- UI ---

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = `
      #player-chat-panel {
        position: fixed;
        bottom: calc(var(--denizen-dock-height, 56px) + 10px + env(safe-area-inset-bottom, 0px));
        left: max(20px, env(safe-area-inset-left, 0px));
        width: min(420px, calc(100vw - 40px));
        height: min(320px, calc(100vh - 120px));
        max-height: 280px;
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid #334155;
        border-bottom: none;
        border-radius: 8px 8px 0 0;
        display: none;
        flex-direction: column;
        z-index: 100200;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.5);
      }
      #player-chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-bottom: 1px solid #1e293b;
        color: #94a3b8;
        font-size: 11px;
        flex-shrink: 0;
      }
      #player-chat-header .chat-header-main {
        flex: 1;
        min-width: 0;
      }
      #player-chat-close-btn {
        display: none;
        align-items: center;
        justify-content: center;
        min-width: 40px;
        min-height: 40px;
        border-radius: 8px;
        border: 1px solid #334155;
        background: rgba(15, 23, 42, 0.9);
        color: #e2e8f0;
        font: 600 20px/1 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
        flex-shrink: 0;
      }
      #player-chat-panel .chat-mobile-hint { display: none; }
      #player-chat-header .target {
        color: #4ade80;
        font-weight: bold;
      }
      #player-chat-header .hint {
        color: #475569;
        font-size: 10px;
      }
      #player-chat-log {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow-y: auto;
        padding: 8px 12px;
        min-height: 60px;
        max-height: 160px;
        background:
          radial-gradient(ellipse 80% 50% at 15% 0%, rgba(10, 132, 255, 0.07), transparent 55%),
          radial-gradient(ellipse 70% 45% at 95% 100%, rgba(99, 102, 241, 0.06), transparent 50%),
          rgba(2, 6, 23, 0.35);
      }
      #player-chat-log .msg {
        max-width: 88%;
        margin: 0;
        padding: 9px 13px;
        line-height: 1.38;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        overflow-wrap: anywhere;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        font-size: 15px;
        -webkit-backdrop-filter: blur(20px) saturate(170%);
        backdrop-filter: blur(20px) saturate(170%);
        box-shadow:
          0 2px 10px rgba(0, 0, 0, 0.16),
          inset 0 1px 0 rgba(255, 255, 255, 0.14);
      }
      #player-chat-log .msg.you {
        align-self: flex-end;
        border-bottom-right-radius: 6px;
        background: linear-gradient(
          168deg,
          rgba(64, 156, 255, 0.92) 0%,
          rgba(10, 132, 255, 0.88) 45%,
          rgba(0, 106, 220, 0.84) 100%
        );
        border-color: rgba(147, 197, 253, 0.42);
        box-shadow:
          0 4px 16px rgba(10, 132, 255, 0.28),
          inset 0 1px 0 rgba(255, 255, 255, 0.32);
      }
      #player-chat-log .msg.npc,
      #player-chat-log .msg.typing {
        align-self: flex-start;
        border-bottom-left-radius: 6px;
        background: linear-gradient(
          168deg,
          rgba(82, 82, 86, 0.78) 0%,
          rgba(58, 58, 60, 0.72) 100%
        );
        border-color: rgba(255, 255, 255, 0.09);
        box-shadow:
          0 2px 10px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.08);
      }
      #player-chat-log .msg.system {
        align-self: center;
        max-width: 96%;
        padding: 6px 10px;
        text-align: center;
        border-radius: 999px;
        background: rgba(250, 204, 21, 0.12);
        border-color: rgba(250, 204, 21, 0.2);
      }
      #player-chat-log .msg.system.error {
        background: rgba(127, 29, 29, 0.35);
        border-color: rgba(248, 113, 113, 0.35);
      }
      #player-chat-log .msg .sender {
        display: block;
        font-weight: 600;
        font-size: 11px;
        margin: 0 0 3px;
      }
      #player-chat-log .msg .sender.npc { color: #a5b4fc; }
      #player-chat-log .msg .text { color: #f2f2f7; }
      #player-chat-log .msg.you .text { color: #ffffff; }
      #player-chat-log .msg.npc .text { color: #f2f2f7; }
      #player-chat-log .msg.system .text { color: #fde68a; font-size: 11px; }
      #player-chat-log .msg.system.error .text { color: #fecaca; }
      #player-chat-log .crm-action-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      #player-chat-log .crm-action-chip {
        background: rgba(74, 222, 128, 0.12);
        border: 1px solid rgba(74, 222, 128, 0.45);
        color: #bbf7d0;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
      }
      #player-chat-log .crm-action-chip:hover {
        background: rgba(74, 222, 128, 0.22);
      }
      #player-chat-log .msg.typing {
        padding: 12px 16px;
        min-width: 52px;
      }
      #player-chat-log .typing-dots {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 10px;
      }
      #player-chat-log .typing-dots span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.62);
        animation: player-chat-typing 1.2s ease-in-out infinite;
      }
      #player-chat-log .typing-dots span:nth-child(2) { animation-delay: 0.15s; }
      #player-chat-log .typing-dots span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes player-chat-typing {
        0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
        30% { opacity: 1; transform: translateY(-3px); }
      }
      #player-chat-input-row {
        display: flex;
        gap: 6px;
        padding: 8px 12px;
        border-top: 1px solid #1e293b;
        flex-shrink: 0;
      }
      #player-chat-input {
        flex: 1;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 4px;
        color: #e2e8f0;
        padding: 6px 10px;
        font-family: inherit;
        font-size: 12px;
        outline: none;
      }
      #player-chat-input:focus {
        border-color: #4ade80;
      }
      #player-chat-input::placeholder {
        color: #475569;
      }
      #player-chat-send {
        background: #4ade80;
        color: #0f172a;
        border: none;
        border-radius: 4px;
        padding: 6px 14px;
        cursor: pointer;
        font-family: inherit;
        font-weight: bold;
        font-size: 11px;
      }
      #player-chat-send:hover {
        background: #22c55e;
      }
      #player-chat-send:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      #player-chat-speak {
        background: #1e3a8a;
        color: #dbeafe;
        border: 1px solid #3b82f6;
        border-radius: 4px;
        padding: 6px 10px;
        cursor: pointer;
        font-family: inherit;
        font-weight: bold;
        font-size: 11px;
        min-width: 58px;
      }
      #player-chat-speak:hover { background: #1d4ed8; }
      #player-chat-speak.listening {
        background: #7f1d1d;
        color: #fecaca;
        border-color: #fca5a5;
      }
      #player-chat-fab {
        background: #1e293b;
        color: #e2e8f0;
        border: 2px solid #4ade80;
        border-radius: 999px;
        padding: 10px 20px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(0,0,0,0.45);
      }
      #player-chat-fab:hover { background: #334155; }
      #player-chat-fab.ws-off {
        border-color: #f87171;
        color: #fecaca;
      }
      #player-chat-fab.ws-on {
        border-color: #4ade80;
      }
      #denizen-ws-banner {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 100003;
        background: rgba(127, 29, 29, 0.95);
        color: #fecaca;
        text-align: center;
        padding: 8px 12px;
        font: 12px/1.4 ui-monospace, monospace;
        display: none;
      }
      @media (max-width: 1024px), (max-height: 850px) {
        #player-chat-panel {
          left: max(8px, env(safe-area-inset-left, 0px));
          right: max(8px, env(safe-area-inset-right, 0px));
          width: auto;
          bottom: calc(
            var(--denizen-dock-height, 56px) + 12px + env(safe-area-inset-bottom, 0px) + var(--denizen-keyboard-offset, 0px)
          );
          height: min(48dvh, 340px);
          max-height: min(48dvh, 340px);
          border-radius: 10px;
        }
        #player-chat-header {
          font-size: 12px;
          padding: 9px 12px;
        }
        #player-chat-input {
          font-size: 16px;
          padding: 10px 12px;
        }
        #player-chat-send {
          font-size: 13px;
          padding: 10px 14px;
          min-width: 76px;
        }
        @media (orientation: landscape) {
          #player-chat-panel {
            height: min(55dvh, 360px);
            max-height: min(55dvh, 360px);
          }
        }
      }
      html:not(.denizen-touch) #player-chat-panel {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
        width: min(460px, calc(100vw - 40px));
        height: min(420px, calc(100vh - 120px));
        max-height: min(52vh, 420px);
        background: rgba(8, 13, 25, 0.98);
        border: 1px solid rgba(148, 163, 184, 0.32);
        border-bottom: 1px solid rgba(148, 163, 184, 0.32);
        border-radius: 16px;
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.48);
      }
      html:not(.denizen-touch) #player-chat-close-btn {
        display: flex;
      }
      html:not(.denizen-touch) #player-chat-header {
        padding: 10px 12px 9px;
        font-size: 13px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.84));
      }
      html:not(.denizen-touch) #player-chat-header .target {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 15px;
      }
      html:not(.denizen-touch) #player-chat-header .hint {
        display: none;
      }
      html:not(.denizen-touch) #player-chat-input,
      html:not(.denizen-touch) #player-chat-send,
      html:not(.denizen-touch) #player-chat-speak,
      html:not(.denizen-touch) #player-chat-close-btn {
        box-sizing: border-box;
      }
      html:not(.denizen-touch) #player-chat-log {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        min-height: 150px;
        max-height: none;
        line-height: 1.45;
        padding: 12px;
      }
      html:not(.denizen-touch) #player-chat-log:empty::before {
        content: "No messages yet";
        align-self: center;
        margin: auto;
        color: #64748b;
        font-size: 13px;
      }
      html:not(.denizen-touch) #player-chat-input-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: rgba(2, 6, 23, 0.92);
      }
      html:not(.denizen-touch) #player-chat-input {
        min-width: 0;
        min-height: 44px;
        font-size: 15px;
        border-radius: 999px;
        padding: 10px 14px;
        background: #0f172a;
        border-color: rgba(148, 163, 184, 0.36);
      }
      html:not(.denizen-touch) #player-chat-send,
      html:not(.denizen-touch) #player-chat-speak {
        flex: none;
        min-width: 58px;
        min-height: 44px;
        border-radius: 999px;
        padding: 9px 14px;
        font-size: 13px;
        white-space: nowrap;
      }
      html:not(.denizen-touch) #player-chat-speak {
        background: rgba(37, 99, 235, 0.86);
      }
      html.denizen-touch #player-chat-panel {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
        background: rgba(8, 13, 25, 0.98);
        border: 1px solid rgba(148, 163, 184, 0.32);
        border-radius: 16px;
        box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.55);
      }
      html.denizen-touch #player-chat-panel .chat-desktop-hint { display: none; }
      html.denizen-touch #player-chat-panel .chat-mobile-hint { display: none; }
      html.denizen-touch #player-chat-close-btn { display: flex; }
      html.denizen-touch #player-chat-input,
      html.denizen-touch #player-chat-send,
      html.denizen-touch #player-chat-speak,
      html.denizen-touch #player-chat-close-btn {
        box-sizing: border-box;
      }
      html.denizen-touch.denizen-chat-open:not(.denizen-phone-mode) #player-chat-panel {
        top: max(8px, env(safe-area-inset-top, 0px)) !important;
        bottom: calc(var(--denizen-dock-height, 40px) + 10px + env(safe-area-inset-bottom, 0px) + var(--denizen-keyboard-offset, 0px)) !important;
        left: max(8px, env(safe-area-inset-left, 0px)) !important;
        right: max(8px, env(safe-area-inset-right, 0px)) !important;
        width: auto !important;
        height: auto !important;
        max-height: none !important;
        z-index: 2147483630 !important;
      }
      /* Portrait phones: keep the office visible — chat fills the space below it */
      html.denizen-touch.denizen-chat-open.denizen-portrait.denizen-tap-move:not(.denizen-phone-mode) #player-chat-panel {
        top: calc(var(--denizen-play-top, 0px) + var(--denizen-phone-portrait-game-height, calc(100dvw * 9 / 16)) + 10px) !important;
      }
      html.denizen-touch.denizen-tablet.denizen-chat-open:not(.denizen-phone-mode) #player-chat-panel {
        top: auto !important;
        bottom: calc(var(--denizen-dock-height, 44px) + 12px + env(safe-area-inset-bottom, 0px) + var(--denizen-keyboard-offset, 0px)) !important;
        left: 50% !important;
        right: auto !important;
        width: min(var(--denizen-panel-max-width, 540px), calc(100dvw - 24px)) !important;
        height: min(48dvh, 520px) !important;
        max-height: min(48dvh, 520px) !important;
        transform: translateX(-50%) !important;
      }
      html.denizen-touch.denizen-phone.denizen-landscape.denizen-chat-open:not(.denizen-phone-mode) #player-chat-panel {
        top: max(6px, env(safe-area-inset-top, 0px)) !important;
        bottom: calc(var(--denizen-dock-height, 38px) + 8px + env(safe-area-inset-bottom, 0px) + var(--denizen-keyboard-offset, 0px)) !important;
        left: auto !important;
        right: max(6px, env(safe-area-inset-right, 0px)) !important;
        width: min(380px, 58dvw, calc(100dvw - 16px)) !important;
        min-width: min(320px, calc(100dvw - 16px)) !important;
        max-width: calc(100dvw - 16px) !important;
        height: auto !important;
        max-height: none !important;
        transform: none !important;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #player-chat-header {
        padding: 8px 10px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #player-chat-header .hint {
        display: none;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #player-chat-log {
        min-height: 0;
        padding: 8px 10px;
        font-size: 13px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #player-chat-input-row {
        gap: 6px;
        padding: 8px 10px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #player-chat-input,
      html.denizen-touch.denizen-phone.denizen-landscape #player-chat-send,
      html.denizen-touch.denizen-phone.denizen-landscape #player-chat-speak {
        min-height: 40px;
        padding: 8px 10px;
        font-size: 13px;
      }
      html.denizen-touch #player-chat-log {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        min-height: 120px;
        max-height: none;
        line-height: 1.45;
        padding: 12px;
        -webkit-overflow-scrolling: touch;
      }
      html.denizen-touch #player-chat-log:empty::before {
        content: "Say hi";
        align-self: center;
        margin: auto;
        color: #64748b;
        font-size: 13px;
      }
      html.denizen-touch #player-chat-log .msg.system {
        -webkit-backdrop-filter: blur(12px);
        backdrop-filter: blur(12px);
        box-shadow: none;
      }
      html.denizen-touch #player-chat-log .msg.system.error .text {
        color: #fecaca;
      }
      html.denizen-touch #player-chat-input-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 8px;
        padding: 10px 12px max(10px, env(safe-area-inset-bottom, 0px));
        background: rgba(2, 6, 23, 0.92);
      }
      html.denizen-touch #player-chat-input {
        min-width: 0;
        min-height: 46px;
        font-size: 16px;
        border-radius: 999px;
        padding: 11px 14px;
        background: #0f172a;
        border-color: rgba(148, 163, 184, 0.36);
      }
      html.denizen-touch #player-chat-send,
      html.denizen-touch #player-chat-speak {
        flex: none;
        min-width: 48px;
        min-height: 46px;
        font-size: 15px;
        border-radius: 999px;
        padding: 10px 14px;
        white-space: nowrap;
      }
      html.denizen-touch #player-chat-send {
        min-width: 66px;
      }
      html.denizen-touch #player-chat-speak {
        background: rgba(37, 99, 235, 0.86);
      }
      html.denizen-touch #player-chat-header {
        padding: 10px 12px 9px;
        font-size: 13px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.84));
      }
      html.denizen-touch #player-chat-header .target {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 15px;
      }
      html.denizen-touch.denizen-chat-open #game-container,
      html.denizen-touch.denizen-chat-open #game-container canvas {
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);

    let panel = document.getElementById('player-chat-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'player-chat-panel';
      panel.innerHTML = `
        <div id="player-chat-header">
          <div class="chat-header-main">
            <span class="target" id="player-chat-target">Chat</span>
            <span class="hint chat-desktop-hint"> - Enter send · Speak (pauses OK) · Esc close</span>
            <span class="hint chat-mobile-hint"> — face them or say their name</span>
          </div>
          <button type="button" id="player-chat-close-btn" aria-label="Close chat">×</button>
        </div>
        <div id="player-chat-log" role="log" aria-live="polite" aria-label="Chat messages"></div>
        <div id="player-chat-input-row">
          <input id="player-chat-input" type="text" placeholder="Message an NPC…" autocomplete="off" enterkeyhint="send" />
          <button id="player-chat-speak" type="button" title="Tap to speak — tap again when done">🎤 Speak</button>
          <button id="player-chat-send" type="button" aria-label="Send message">Send</button>
        </div>
      `;
      document.body.appendChild(panel);
    }

    const existingFab = document.getElementById('player-chat-fab');
    if (existingFab) {
      this._fab = existingFab;
    } else {
      const fab = document.createElement('button');
      fab.id = 'player-chat-fab';
      fab.type = 'button';
      fab.className = 'ws-off';
      fab.textContent = '💬 Chat';
      fab.title = 'Talk to NPCs (Enter or T also works)';
      document.body.appendChild(fab);
      this._fab = fab;
    }

    if (!document.getElementById('denizen-ws-banner')) {
      const banner = document.createElement('div');
      banner.id = 'denizen-ws-banner';
      banner.textContent = 'Chat offline — hard-refresh (Ctrl+Shift+R). If NPCs still won\'t reply, restart the server in the denizen folder.';
      document.body.appendChild(banner);
    }

    window.__DenizenChatBootstrap?.attach?.(this);

    this._container = panel;
    this._input = panel.querySelector('#player-chat-input');
    this._logEl = panel.querySelector('#player-chat-log');
    this._targetLabel = panel.querySelector('#player-chat-target');
    globalThis.__DenizenPlayerChat = this;
    this._bindCrmActionClicks();
    let syncSendButton = () => {};

    // Arrow keys drive movement via scene._chatMoveKeys (Phaser can't read keys
    // while a DOM input is focused). Walk and type at the same time.
    const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

    this._input.addEventListener('keydown', (e) => {
      if (MOVE_KEYS.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        this._setChatMoveKey(e.key, true);
        return;
      }
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (this._input.value.trim()) {
          this.sendMessage(this._input.value);
          this._input.value = '';
          syncSendButton();
        }
      } else if (e.key === 'Escape') {
        this._clearChatMoveKeys();
        this.close();
      }
    });

    this._input.addEventListener('keyup', (e) => {
      if (MOVE_KEYS.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        this._setChatMoveKey(e.key, false);
        return;
      }
      e.stopPropagation();
    });
    this._input.addEventListener('blur', () => this._clearChatMoveKeys());
    window.addEventListener('blur', () => this._clearChatMoveKeys());
    this._input.addEventListener('keypress', (e) => e.stopPropagation());
    const focusMobileInput = (e) => {
      if (!window.__DenizenIsTouch || !this._input) return;
      e?.stopPropagation?.();
      if (document.activeElement === this._input) return;
      try {
        this._input.focus({ preventScroll: false });
      } catch (_) {
        this._input.focus();
      }
    };
    this._input.addEventListener('pointerup', focusMobileInput);
    this._input.addEventListener('touchend', focusMobileInput, { passive: true });
    this._input.addEventListener('click', focusMobileInput);

    const bindPress = window.DenizenTouchBind?.bindPress;

    // Speak button — toggle voice input (continuous; click again when done).
    const speakBtn = panel.querySelector('#player-chat-speak');
    const closeBtn = panel.querySelector('#player-chat-close-btn');
    const onCloseChat = (e) => {
      if (e?.preventDefault) e.preventDefault();
      this.close();
    };
    if (closeBtn) {
      if (bindPress) bindPress(closeBtn, onCloseChat);
      else closeBtn.addEventListener('click', onCloseChat);
    }

    const refreshSpeakBtn = () => {
      const vi = window.DenizenVoiceInput;
      const on = !!(vi && vi.isListening && vi.isListening());
      const touch = !!window.__DenizenIsTouch;
      const phoneLandscape = touch
        && document.documentElement.classList.contains('denizen-phone')
        && document.documentElement.classList.contains('denizen-landscape');
      speakBtn.classList.toggle('listening', on);
      speakBtn.textContent = on
        ? (phoneLandscape ? '⏹' : (touch ? '⏹ Stop' : 'Stop'))
        : (phoneLandscape ? '🎤' : (touch ? '🎤 Speak' : 'Speak'));
      speakBtn.setAttribute('aria-label', on ? 'Stop voice input' : 'Start voice input');
      const supported = !!(vi && (vi.isSupported?.() ?? vi.supported));
      speakBtn.disabled = !supported;
      const touchUi = !!window.__DenizenIsTouch
        || document.documentElement.classList.contains('denizen-touch');
      speakBtn.style.display = (supported || touchUi) ? '' : 'none';
      speakBtn.title = supported
        ? 'Speak — tap again when done'
        : 'Voice needs Chrome desktop or OPENAI_API_KEY on server';
    };
    const onSpeak = (e) => {
      if (e?.preventDefault) e.preventDefault();
      if (e?.stopPropagation) e.stopPropagation();
      const vi = window.DenizenVoiceInput;
      if (!(vi?.isSupported?.() ?? vi?.supported)) {
        vi?.toggle?.(e);
        refreshSpeakBtn();
        return;
      }
      if (typeof window.DenizenSetPresence === 'function' && !window.DenizenPresence?.zionPresent) {
        try { window.DenizenSetPresence(true); } catch (_) {}
      }
      if (vi.isListening()) vi.stop();
      else vi.start();
      refreshSpeakBtn();
    };
    if (bindPress) bindPress(speakBtn, onSpeak);
    else speakBtn.addEventListener('click', onSpeak);
    setInterval(refreshSpeakBtn, 400);
    refreshSpeakBtn();

    // Send button — send and keep the box focused for the next message.
    const sendBtn = panel.querySelector('#player-chat-send');
    syncSendButton = () => {
      if (!sendBtn) return;
      sendBtn.disabled = !String(this._input?.value || '').trim();
    };
    this._input.addEventListener('input', syncSendButton);
    const onSend = (e) => {
      if (e?.preventDefault) e.preventDefault();
      if (e?.stopPropagation) e.stopPropagation();
      const text = String(this._input?.value || '').trim();
      if (!text) return;
      this.sendMessage(text);
      this._input.value = '';
      syncSendButton();
      try {
        this._input.focus({ preventScroll: false });
      } catch (_) {
        this._input.focus();
      }
    };
    if (bindPress) bindPress(sendBtn, onSend);
    else sendBtn.addEventListener('click', onSend);
    syncSendButton();

    // Block game input while interacting with panel
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    const gameEl = document.getElementById('game-container');
    if (gameEl) {
      gameEl.addEventListener('pointerdown', () => {
        if (!this._visible || document.activeElement !== this._input) return;
        this._clearChatMoveKeys();
        this._input.blur();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this._visible) return;
      if (document.activeElement === this._input) return;
      this._clearChatMoveKeys();
      this.close();
    });
  }

  /**
   * Render a permission-request card in the chat log.
   * Grant fires POST /api/grant-permission; Deny just dismisses the card.
   */
  _addApprovalRequest({ npcName, onBehalfOf, task, waitingFor, permission }) {
    const log = this._logEl;
    if (!log) return;

    // Also persist in the chat history as a plain entry so it survives re-renders.
    const label = onBehalfOf
      ? `${npcName} is asking on behalf of ${onBehalfOf}: "${task}"`
      : `${npcName} is requesting approval: "${task}"`;
    this._chatLog.push({ from: npcName, text: `[approval request] ${label}`, time: Date.now() });
    if (this._chatLog.length > this._maxLog) this._chatLog = this._chatLog.slice(-this._maxLog);

    // Build the card DOM element.
    const card = document.createElement('div');
    card.className = 'msg approval-card';
    card.style.cssText = [
      'background:#1a2540;border:1px solid #4a90e2;border-radius:6px;',
      'padding:8px 10px;margin:4px 0;',
    ].join('');

    const esc = s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const who = onBehalfOf ? `${esc(npcName)} (for ${esc(onBehalfOf)})` : esc(npcName);
    const waiting = waitingFor ? ` (was waiting on ${esc(waitingFor)})` : '';

    card.innerHTML = `
      <div style="color:#7eb8f7;font-weight:bold;margin-bottom:4px">🙋 Approval Request</div>
      <div style="color:#ccc;font-size:12px;margin-bottom:6px">
        <b>${who}</b>${waiting}:<br>${esc(task)}
      </div>
      <div style="display:flex;gap:6px">
        <button class="approve-btn" style="
          background:#2563eb;color:#fff;border:none;border-radius:4px;
          padding:4px 10px;cursor:pointer;font-size:12px;flex:1">
          Grant
        </button>
        <button class="deny-btn" style="
          background:#444;color:#ccc;border:none;border-radius:4px;
          padding:4px 10px;cursor:pointer;font-size:12px;flex:1">
          Deny
        </button>
      </div>
    `;

    const grantBtn = card.querySelector('.approve-btn');
    const denyBtn  = card.querySelector('.deny-btn');

    grantBtn.addEventListener('click', () => {
      grantBtn.textContent = '…';
      grantBtn.disabled = true;
      fetch('/api/grant-permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          npcName,
          permission: permission || task,
          scope: task,
        }),
      })
        .then(r => r.json())
        .then(res => {
          if (res.ok) {
            card.style.borderColor = '#22c55e';
            card.querySelector('[style*="Approval Request"]') &&
              (card.querySelector('div').textContent = '✅ Granted');
            card.querySelector('div:last-child').remove();
          } else {
            grantBtn.textContent = 'Grant';
            grantBtn.disabled = false;
            this._addToLog('System', `Grant failed: ${res.error || 'unknown error'}`);
          }
        })
        .catch(err => {
          grantBtn.textContent = 'Grant';
          grantBtn.disabled = false;
          this._addToLog('System', `Grant error: ${err.message || err}`);
        });
    });

    denyBtn.addEventListener('click', () => {
      card.style.opacity = '0.4';
      card.querySelector('div:last-child').remove();
      this._addToLog('System', `Denied: ${npcName}'s request for "${task}"`);
    });

    log.appendChild(card);
    log.scrollTop = log.scrollHeight;
  }

  /**
   * One ack per NPC per window — incident reports + retries were spamming
   * "heard you (GPU queue: N)" while the queue climbed behind think loops.
   */
  logPlayerChatAck(npcName, queueLen) {
    const name = String(npcName || '').trim();
    if (!name) return;
    if (name === 'Bouncer') {
      const userAsked = this._lastUserChatTarget === 'Bouncer'
        && Date.now() - (this._lastUserChatAt || 0) < 12000;
      if (!userAsked) return;
    }
    const now = Date.now();
    if (!this._lastAckByNpc) this._lastAckByNpc = {};
    const prev = this._lastAckByNpc[name];
    if (prev && now - prev.at < 12000) return;

    this._lastAckByNpc[name] = { at: now, queueLen };
    if (this._waitingForResponse && !this._typingNpc) {
      this._setTyping(name);
    }
  }

  _setTyping(npcName) {
    this._typingNpc = npcName ? String(npcName) : null;
    this._renderLog();
  }

  _clearTyping() {
    if (!this._typingNpc) return;
    this._typingNpc = null;
    this._renderLog();
  }

  _classifySystemMessage(text) {
    const t = String(text || '').trim();
    if (!t) return 'hidden';
    if (/^⚠️|failed|error|Reconnecting|Couldn't|not connected|Denied:|Grant failed/i.test(t)) {
      return 'error';
    }
    if (/^\(no .*reply/i.test(t)) return 'error';
    return 'hidden';
  }

  _displayNpcName(name) {
    const raw = String(name || '').trim();
    if (!raw) return 'NPC';
    const roster = globalThis.DenizenNpcRoster;
    const entry = (roster?.entries || []).find((e) => e.display === raw || e.folder === raw.toLowerCase());
    if (entry?.display) return entry.display;
    const first = raw.split(/\s+/)[0];
    return first || raw;
  }

  _addToLog(sender, text, opts = {}) {
    const entry = {
      from: sender,
      text,
      time: Date.now(),
      crmActions: Array.isArray(opts.crmActions) ? opts.crmActions : null,
      streamId: opts.streamId || null,
    };
    const threadId = opts.threadId || this._activeThreadId;
    if (threadId && this._threads.has(threadId)) {
      const thread = this._threads.get(threadId);
      thread.messages.push(entry);
      if (thread.messages.length > this._maxLog) {
        thread.messages = thread.messages.slice(-this._maxLog);
      }
      if (sender === 'You') thread.preview = String(text || '').slice(0, 120);
      else if (sender !== 'System') thread.preview = `${sender}: ${String(text || '').slice(0, 100)}`;
      thread.updatedAt = Date.now();
      this._saveCachedMessages(threadId, thread.messages);
      if (this._activeThreadId === threadId) this._renderLog();
      globalThis.DenizenPhoneChatUI?.refreshThreads?.().catch(() => null);
      return;
    }
    this._chatLog.push(entry);
    if (this._chatLog.length > this._maxLog) {
      this._chatLog = this._chatLog.slice(-this._maxLog);
    }
    this._renderLog();
  }

  _messagesForRender() {
    const active = this._getActiveThread();
    if (active?.messages?.length) return active.messages;
    if (this._phoneShellEnabled && this._activeThreadId) {
      const t = this._threads.get(this._activeThreadId);
      if (t?.messages) return t.messages;
    }
    return this._chatLog;
  }

  _renderLog() {
    const log = this._logEl;
    if (!log) return;

    const esc = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const active = this._getActiveThread();
    const isGroup = active?.type === 'group';
    const recent = this._messagesForRender().slice(-40).filter((m) => {
      if (m.from !== 'System') return true;
      return this._classifySystemMessage(m.text) === 'error';
    });

    let html = recent.map((m) => {
      if (m.from === 'You') {
        return `<div class="msg you"><span class="text">${esc(m.text)}</span></div>`;
      }
      if (m.from === 'System') {
        return `<div class="msg system error"><span class="text">${esc(m.text)}</span></div>`;
      }
      const label = isGroup
        ? `<span class="sender npc">${esc(this._displayNpcName(m.from))}</span>`
        : '';
      const chips = this._renderCrmActionChips(m.crmActions, esc);
      return `<div class="msg npc">${label}<span class="text">${esc(m.text)}</span>${chips}</div>`;
    }).join('');

    if (this._typingNpc && this._waitingForResponse) {
      html += `<div class="msg npc typing" aria-label="${esc(this._displayNpcName(this._typingNpc))} is typing"><span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span></div>`;
    }

    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
  }

  _renderCrmActionChips(actions, esc) {
    if (!Array.isArray(actions) || !actions.length) return '';
    const chips = actions.map((action) => {
      const label = esc(action?.label || action?.tab || 'Open');
      const attrs = [
        `data-action-type="${esc(action?.type || 'open_tab')}"`,
        action.url ? `data-action-url="${esc(action.url)}"` : '',
        action.text ? `data-action-text="${esc(action.text)}"` : '',
        action.href ? `data-action-href="${esc(action.href)}"` : '',
        action.tab ? `data-action-tab="${esc(action.tab)}"` : '',
        action.subTab || action.sub ? `data-action-sub="${esc(action.subTab || action.sub)}"` : '',
        action.npc ? `data-action-npc="${esc(action.npc)}"` : '',
        action.message ? `data-action-message="${esc(action.message)}"` : '',
      ].filter(Boolean).join(' ');
      return `<button type="button" class="crm-action-chip" ${attrs}>${label}</button>`;
    }).join('');
    return `<div class="crm-action-chips">${chips}</div>`;
  }

  _bindCrmActionClicks() {
    const log = this._logEl;
    if (!log || log._crmBound) return;
    log._crmBound = true;
    log.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.crm-action-chip');
      if (!btn) return;
      const action = {
        type: btn.dataset.actionType || 'open_tab',
        url: btn.dataset.actionUrl || null,
        text: btn.dataset.actionText || null,
        href: btn.dataset.actionHref || null,
        tab: btn.dataset.actionTab || null,
        subTab: btn.dataset.actionSub || null,
        npc: btn.dataset.actionNpc || null,
        message: btn.dataset.actionMessage || null,
        label: btn.textContent || '',
      };
      if (action.type === 'ask_npc' && action.message) {
        const key = this._nameToKey[String(action.npc || '').toLowerCase()];
        if (key) this._lastTargetKey = key;
        void this.sendMessage(action.message);
        return;
      }
      globalThis.DenizenCrmBridge?.executeCrmAction?.(action);
    });
  }

  _updateTargetLabel(name) {
    if (this._targetLabel) {
      this._targetLabel.textContent = name ? this._displayNpcName(name) : 'Messages';
    }
  }
}

window.PlayerChat = PlayerChat;
