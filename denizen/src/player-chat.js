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
    /** Dedupe voice + Send double-fires within one utterance. */
    this._lastSendText = '';
    this._lastSendAt = 0;
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
    this._refreshComposerRefs();
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

  /** Phaser keyboard captures eat WASD/Space in focused chat fields — release them. */
  _ensureKeyboardForChat() {
    try {
      window.__DenizenGameInputBlocked = false;
      const game = window.game;
      if (game?.input) game.input.enabled = true;
      game?.input?.keyboard?.clearCaptures?.();
    } catch (_) {}
  }

  _autoResizeChatInput() {
    const el = this._input;
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, 132);
    el.style.height = `${Math.max(next, 24)}px`;
  }

  _refreshComposerRefs() {
    const panel = document.getElementById('player-chat-panel');
    if (!panel) return;
    this._upgradeComposerDom(panel);
    this._container = panel;
    this._input = panel.querySelector('#player-chat-input');
    this._logEl = panel.querySelector('#player-chat-log');
    this._targetLabel = panel.querySelector('#player-chat-target');
    this._attachChipsEl = panel.querySelector('#player-chat-attach-chips');
    this._autoResizeChatInput();
  }

  static _composerHtml() {
    return `
        <div id="player-chat-composer">
          <div id="player-chat-attach-chips" aria-label="Pending attachments"></div>
          <div id="player-chat-input-row" class="pc-composer-shell">
            <div class="pc-composer-bar">
              <button id="player-chat-attach" type="button" title="Add photos & files (or drag-drop / paste)" aria-label="Add attachment">
                <span class="pc-attach-icon" aria-hidden="true">+</span>
              </button>
              <input id="player-chat-file" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.csv,.json,.log,.yaml,.yml" style="display:none" />
              <textarea id="player-chat-input" rows="1" placeholder="Message…" autocomplete="off" enterkeyhint="send"></textarea>
              <div class="pc-composer-actions">
                <button id="player-chat-speak" type="button" title="Voice input">
                  <span class="pc-speak-glyph" aria-hidden="true"></span>
                  <span class="pc-speak-label">Speak</span>
                </button>
                <button id="player-chat-send" type="button" aria-label="Send message">
                  <span class="pc-send-glyph" aria-hidden="true">↑</span>
                </button>
              </div>
            </div>
          </div>
        </div>`;
  }

  _upgradeComposerDom(panel) {
    if (!panel || panel.querySelector('.pc-composer-bar')) return;
    panel.querySelector('#player-chat-composer')?.remove();
    panel.querySelector('#player-chat-attach-chips')?.remove();
    panel.querySelector('#player-chat-input-row')?.remove();
    panel.insertAdjacentHTML('beforeend', PlayerChat._composerHtml());
  }

  _chatFabClosedLabel() {
    return this.manager?.connected ? 'Chat' : 'Chat (offline)';
  }

  _syncFabLabel() {
    if (!this._fab) return;
    const compact = document.documentElement.classList.contains('denizen-touch')
      && this._fab.closest('#denizen-bottom-dock');
    const paint = globalThis.DenizenTablerIcons?.paintChip;
    if (this._visible) {
      if (paint) paint(this._fab, 'x', compact ? '' : 'Close', { iconOnly: compact, title: 'Close chat' });
      else this._fab.textContent = compact ? '✕' : '✕ Close';
      this._fab.setAttribute('aria-pressed', 'true');
      this._fab.title = 'Close chat';
    } else {
      const label = this._chatFabClosedLabel();
      if (paint) {
        paint(this._fab, 'messages', label, { iconOnly: compact, title: label });
      } else if (globalThis.DenizenBottomDock?.renderChip) {
        globalThis.DenizenBottomDock.renderChip('player-chat-fab', label, { iconOnly: compact });
      } else {
        this._fab.textContent = compact ? '💬' : label;
      }
      this._fab.setAttribute('aria-pressed', 'false');
      if (!compact) this._fab.title = 'Talk to NPCs (Enter or T also works)';
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
    this._refreshComposerRefs();
    if (!this._container) return;
    const next = !!visible;
    if (this._visible === next && (this._container.style.display === 'none') === !next) {
      return;
    }
    this._visible = next;
    this._container.style.display = next ? 'flex' : 'none';
    document.documentElement.classList.toggle('denizen-chat-open', next);
    this._syncFabLabel();
    try { globalThis.DenizenVoiceInput?.refreshSpeakFab?.(); } catch (_) {}
    if (next && window.__DenizenIsTouch) {
      globalThis.DenizenMobileSidebar?.close?.();
    }
    if (next) {
      if (!window.__DenizenIsTouch) this._input?.focus();
      else this._input?.blur();
    } else {
      this._input?.blur();
      this._clearChatMoveKeys();
      // Closing the panel does not end the conversation — NPC stays with you.
    }
  }

  toggle() {
    this.setVisible(!this._visible);
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
    else if (!window.__DenizenIsTouch) this._input.focus();
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
    if (globalThis.DenizenPhoneChatUI?.isPhoneChatActive?.()) {
      globalThis.DenizenPhoneChatUI.onThreadOpened?.(thread);
    }
    return thread;
  }

  async openWithNpc(npcKey, npcName, opts = {}) {
    const folder = this._folderForNpcKey(npcKey);
    this._refreshComposerRefs();
    const panel = this._container;
    if (panel && !globalThis.DenizenPhoneChatUI?.isPhoneChatActive?.()) {
      delete panel.dataset.phoneChat;
      delete panel.dataset.phcView;
    }
    this._updateTargetLabel(npcName);
    this._lastTargetKey = npcKey;
    this.setVisible(true);
    try {
      if (!window.__DenizenIsTouch) this._input?.focus?.();
    } catch (_) {}

    try {
      await this.openThread({
        threadId: `dm:${folder}`,
        type: 'dm',
        npcKey: folder,
        npcName,
        title: npcName,
      });
    } catch (err) {
      console.warn('[PlayerChat] openThread failed:', err?.message || err);
    }

    this._beginCeoConversation(npcKey, npcName, null);
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
        await this._walkNpcToPlayer(npcKey).catch(() => {});
      } else {
        this.manager.actions.emote(npcKey, '!');
      }
      if (targetNpc) this._stopNpcForConversation(targetNpc, npcKey, null);
    }

    try {
      if (!window.__DenizenIsTouch) this._input?.focus?.();
    } catch (_) {}
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
      if (!this._isBouncerChatActive()) return;
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
    const hasAttachments = !!(this._pendingAttachments && this._pendingAttachments.length);
    if (!text.trim() && !hasAttachments) return;

    // Dedupe identical text sent twice in quick succession (double Enter, voice echo).
    const _sendNow = Date.now();
    if (text.trim() && this._lastSendText === text.trim()
      && _sendNow - (this._lastSendAt || 0) < 700 && !hasAttachments) {
      return;
    }
    this._lastSendAt = _sendNow;
    this._lastSendText = text.trim();

    window.DenizenHaptics?.tap?.();

    // Files/photos queued via 📎, drag-drop, or paste ride along on this message.
    const outgoingAttachments = hasAttachments ? this._takePendingAttachments() : [];

    const trimmed = window.DenizenOpenClawDispatch?.fixVoiceMishearings?.(text.trim()) || text.trim();
    const normalized = window.DenizenOpenClawDispatch?.normalizePlayerUtterance?.(trimmed) || trimmed;

    // (dedupe already handled at the top of sendMessage — a second check here
    // would see the _lastSendText we just recorded and kill every send)

    const wantsBrowserOpen = window.DenizenOpenClawDispatch?.wantsLucyBrowserOpen?.(trimmed) || false;

    // If the user is actively chatting, treat that as presence and turn voice
    // on automatically. Fire-and-forget: a stalled presence call must never
    // block sending the message (it used to await here and could hang sends).
    if (!globalThis.DenizenPresence?.zionPresent && typeof globalThis.DenizenSetPresence === 'function') {
      Promise.resolve().then(() => globalThis.DenizenSetPresence(true)).catch(() => {});
    }

    // Add to chat log
    this._addToLog('You', trimmed || '📎', {
      attachments: outgoingAttachments.map((a) => ({ name: a.name, mime: a.mime, thumbUrl: a.thumbUrl })),
    });
    if (trimmed) this._showPlayerBubble(trimmed);
    if (globalThis.DenizenVisitorSession?.isDemo?.()) {
      try { document.dispatchEvent(new CustomEvent('denizen-demo-engaged')); } catch (_) {}
    }

    // With attachments, "look at this" means the FILES — suppress ambiguous
    // intent shortcuts so the message reaches the NPC brain with the files.
    const _suppressIntents = outgoingAttachments.length > 0;
    const extractSearch = _suppressIntents ? null : window.DenizenOpenClawDispatch?.extractSearchQuery;
    const extractJobBoard = _suppressIntents ? null : window.DenizenOpenClawDispatch?.extractJobBoardSearchIntent;
    const extractObserve = _suppressIntents ? null : window.DenizenOpenClawDispatch?.extractScreenObserveIntent;
    const extractScreenControl = _suppressIntents ? null : window.DenizenOpenClawDispatch?.extractScreenControlIntent;
    const extractBrowserStatus = window.DenizenOpenClawDispatch?.extractBrowserStatusIntent;
    const extractOpenBrowser = window.DenizenOpenClawDispatch?.extractOpenBrowserIntent;
    const extractOpenBrave = window.DenizenOpenClawDispatch?.extractOpenBraveIntent;
    const extractCloseBrowser = window.DenizenOpenClawDispatch?.extractCloseBrowserIntent;
    const extractBrowserRetry = window.DenizenOpenClawDispatch?.extractBrowserRetryIntent;
    const extractBrowserRead = _suppressIntents ? null : window.DenizenOpenClawDispatch?.extractBrowserReadIntent;
    const isCancelUtterance = window.DenizenOpenClawDispatch?.isCancelUtterance;
    const extractJobBoardHelp = window.DenizenOpenClawDispatch?.extractJobBoardHelpIntent;
    const extractQueue = window.DenizenOpenClawDispatch?.extractResearchQueueIntent;
    const extractBrief = window.DenizenOpenClawDispatch?.extractResearchBriefIntent;
    let searchQueryEarly = extractSearch ? extractSearch(normalized) : null;
    if (!searchQueryEarly && extractSearch) {
      searchQueryEarly = extractSearch(trimmed) || extractSearch(text.trim());
    }
    const extractBareTopic = _suppressIntents ? null : window.DenizenOpenClawDispatch?.extractBareSearchTopic;
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
    this._waitingForResponse = true;
    this._updateTargetLabel(targetName);
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
          this._addToLog('System', '(no group reply — model may be busy)');
        }
      }, this._chatResponseTimeoutMs(this._getActiveThread()?.title));
      return;
    }

    this.manager._send({
      type: 'player_chat',
      npcName: targetName,
      npcKey: targetKey,
      text: trimmed,
      attachments: outgoingAttachments.length
        ? outgoingAttachments.map(({ name, mime, size, data }) => ({ name, mime, size, data }))
        : undefined,
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

    const timeoutMs = this._chatResponseTimeoutMs(targetName);
    this._responseTimeout = setTimeout(() => {
      if (this._waitingForResponse) {
        this._waitingForResponse = false;
        this._clearTyping();
        this._addToLog(targetName, this._chatTimeoutMessage(targetName));
      }
    }, timeoutMs);
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

  handleNpcResponse(npcName, text, delegation, error) {
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
      if (!this._isBouncerChatActive()) {
        if (error) this._addToLog('System', `⚠️ ${error}`);
        return;
      }
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
    this._addToLog(npcName, safeText, dmThreadId ? { threadId: dmThreadId } : {});
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

    // While waiting on a slow provider (Grok CLI bridge), pin the NPC in
    // place — re-walking every frame made them chase a moving player.
    if (this._waitingForResponse && this._lastTargetKey === npcKey) {
      npc.body.setVelocity(0, 0);
      if (npc._pathFollower) npc._pathFollower.stop();
      if (npc.ai.taskState !== 'reporting') npc.ai.taskState = 'reporting';
      const dx = player.x - npc.x;
      const dy = player.y - npc.y;
      if (Math.abs(dx) > Math.abs(dy)) npc.ai.facing = dx < 0 ? 'left' : 'right';
      else npc.ai.facing = dy < 0 ? 'up' : 'down';
      return;
    }

    if (npc.ai.taskState === 'reporting' && dist <= holdDist + 12) {
      const dx = player.x - npc.x;
      const dy = player.y - npc.y;
      if (Math.abs(dx) > Math.abs(dy)) npc.ai.facing = dx < 0 ? 'left' : 'right';
      else npc.ai.facing = dy < 0 ? 'up' : 'down';
      npc.body.setVelocity(0, 0);
      return;
    }

    if (dist > holdDist + 48 && npc.ai.taskState !== 'walking' && now >= this._ceoReapproachAt) {
      this._ceoReapproachAt = now + 4000;
      this._walkNpcToPlayer(npcKey).then(() => {
        const n = this.manager?.actions?._getNpc(npcKey);
        if (n && this._ceoConvo?.npcKey === npcKey) this._stopNpcForConversation(n, npcKey, null);
      }).catch(() => {});
    }
  }

  _usesSubscriptionCliChat(npcName) {
    const key = String(npcName || '').toLowerCase();
    if (key === 'grok' || key === 'claude') return true;
    const brain = this.manager?.npcBrains?.brains?.[npcName];
    const chat = brain?.chatProvider;
    return chat === 'grok-cli' || chat === 'claude-cli';
  }

  /** @deprecated use _usesSubscriptionCliChat */
  _usesGrokCliChat(npcName) {
    return this._usesSubscriptionCliChat(npcName);
  }

  _chatResponseTimeoutMs(npcName) {
    return this._usesSubscriptionCliChat(npcName) ? 180000 : 60000;
  }

  _chatTimeoutMessage(npcName) {
    const key = String(npcName || '').toLowerCase();
    if (key === 'claude' || this.manager?.npcBrains?.brains?.[npcName]?.chatProvider === 'claude-cli') {
      return '(still thinking via Claude CLI — bridge can take 1–3 min; keep the PC bridge running)';
    }
    if (this._usesSubscriptionCliChat(npcName)) {
      return '(still thinking via Grok CLI — bridge can take 1–3 min; keep the PC bridge running)';
    }
    return '(no response — LM Studio may be busy; check ⋯ diag chip bottom-left)';
  }

  // --- UI ---

  _buildUI() {
    if (!this._chatStyleInjected) {
    this._chatStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      #player-chat-panel {
        --pc-bg: #0a0f18;
        --pc-surface: #121826;
        --pc-elevated: #1a2233;
        --pc-border: rgba(255, 255, 255, 0.08);
        --pc-text: #f1f5f9;
        --pc-muted: #94a3b8;
        --pc-accent: #3b82f6;
        --pc-user: #2563eb;
        position: fixed;
        bottom: calc(var(--denizen-dock-height, 56px) + 12px + env(safe-area-inset-bottom, 0px));
        left: max(20px, env(safe-area-inset-left, 0px));
        width: min(400px, calc(100vw - 32px));
        height: min(440px, calc(100vh - 120px));
        max-height: min(52vh, 440px);
        background: var(--pc-bg);
        border: 1px solid var(--pc-border);
        border-radius: 20px;
        display: none;
        flex-direction: column;
        z-index: 100200;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        color: var(--pc-text);
        overflow: hidden;
        box-shadow:
          0 24px 64px rgba(0, 0, 0, 0.45),
          0 0 0 1px rgba(255, 255, 255, 0.03) inset;
        contain: layout style;
        -webkit-backdrop-filter: blur(24px) saturate(140%);
        backdrop-filter: blur(24px) saturate(140%);
      }
      #player-chat-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--pc-border);
        background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent);
        flex-shrink: 0;
      }
      .pc-header-avatar {
        flex: 0 0 36px;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        font-weight: 600;
        color: #e2e8f0;
        background: linear-gradient(145deg, #334155, #1e293b);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      }
      #player-chat-header .chat-header-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      #player-chat-close-btn {
        display: none;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 10px;
        border: none;
        background: transparent;
        color: var(--pc-muted);
        font: 500 18px/1 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
        flex-shrink: 0;
        transition: background 0.15s, color 0.15s;
      }
      #player-chat-close-btn:hover {
        background: rgba(255, 255, 255, 0.06);
        color: var(--pc-text);
      }
      #player-chat-panel .chat-mobile-hint,
      #player-chat-panel .chat-desktop-hint { display: none !important; }
      #player-chat-panel:not([data-phone-chat="1"]) #player-chat-phone-shell {
        display: none !important;
      }
      #player-chat-header .target {
        color: var(--pc-text);
        font-weight: 600;
        font-size: 15px;
        letter-spacing: -0.01em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pc-header-status {
        color: var(--pc-muted);
        font-size: 12px;
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #player-chat-log {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 14px 14px 10px;
        min-height: 80px;
        scroll-behavior: smooth;
        background: linear-gradient(180deg, rgba(255,255,255,0.015), transparent 120px);
      }
      #player-chat-log::-webkit-scrollbar { width: 6px; }
      #player-chat-log::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.25);
        border-radius: 999px;
      }
      #player-chat-log .msg {
        max-width: 85%;
        margin: 0;
        padding: 10px 14px;
        line-height: 1.45;
        border-radius: 18px;
        overflow-wrap: anywhere;
        font-size: 14px;
        border: 1px solid transparent;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
      }
      #player-chat-log .msg.you {
        align-self: flex-end;
        border-bottom-right-radius: 6px;
        background: var(--pc-user);
        color: #fff;
        border-color: rgba(255, 255, 255, 0.08);
      }
      #player-chat-log .msg.npc,
      #player-chat-log .msg.typing {
        align-self: flex-start;
        border-bottom-left-radius: 6px;
        background: var(--pc-elevated);
        border-color: var(--pc-border);
        color: var(--pc-text);
      }
      #player-chat-log .msg.system {
        align-self: center;
        max-width: 92%;
        padding: 6px 12px;
        text-align: center;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.1);
        border-color: rgba(148, 163, 184, 0.14);
      }
      #player-chat-log .msg.system.error {
        background: rgba(239, 68, 68, 0.12);
        border-color: rgba(248, 113, 113, 0.2);
      }
      #player-chat-log .msg .sender {
        display: block;
        font-weight: 600;
        font-size: 11px;
        margin: 0 0 4px;
        color: #a5b4fc;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      #player-chat-log .msg .text { color: inherit; }
      #player-chat-log .msg.system .text { color: var(--pc-muted); font-size: 12px; }
      #player-chat-log .msg.system.error .text { color: #fca5a5; font-size: 12px; }
      #player-chat-log .msg.typing {
        padding: 12px 16px;
        min-width: 56px;
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
      #player-chat-composer {
        flex-shrink: 0;
        border-top: 1px solid var(--pc-border);
        background: var(--pc-surface);
      }
      .pc-composer-shell {
        padding: 10px 12px 12px;
      }
      .pc-composer-bar {
        display: flex;
        align-items: flex-end;
        gap: 4px;
        padding: 6px 8px 6px 4px;
        border-radius: 24px;
        border: 1px solid var(--pc-border);
        background: var(--pc-elevated);
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .pc-composer-bar:focus-within {
        border-color: rgba(59, 130, 246, 0.45);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
      }
      #player-chat-input-row {
        display: block;
        padding: 0;
        border-top: none;
        flex-shrink: 0;
      }
      #player-chat-input {
        flex: 1 1 auto;
        min-width: 0;
        width: 100%;
        min-height: 22px;
        max-height: 120px;
        background: transparent;
        border: none;
        color: var(--pc-text);
        padding: 8px 4px;
        font-family: inherit;
        font-size: 14px;
        line-height: 1.45;
        outline: none;
        resize: none;
        overflow-y: auto;
      }
      #player-chat-input::placeholder { color: #64748b; }
      #player-chat-send {
        flex: 0 0 32px;
        width: 32px;
        height: 32px;
        min-width: 32px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: var(--pc-accent);
        color: #fff;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, opacity 0.15s, transform 0.1s;
      }
      #player-chat-send .pc-send-glyph {
        font-size: 17px;
        font-weight: 700;
        line-height: 1;
        margin-top: -1px;
      }
      #player-chat-send:hover:not(:disabled) { background: #1d4ed8; }
      #player-chat-send:active:not(:disabled) { transform: scale(0.96); }
      #player-chat-send:disabled {
        opacity: 0.35;
        cursor: not-allowed;
        background: #334155;
      }
      #player-chat-speak {
        flex: 0 0 auto;
        min-height: 32px;
        padding: 0 10px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: var(--pc-muted);
        cursor: pointer;
        font-family: inherit;
        font-size: 13px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: background 0.15s, color 0.15s;
      }
      #player-chat-speak .pc-speak-glyph { font-size: 16px; line-height: 1; }
      #player-chat-speak:hover { background: rgba(255,255,255,0.06); color: var(--pc-text); }
      #player-chat-speak.listening {
        background: rgba(239, 68, 68, 0.15);
        color: #fca5a5;
      }
      #player-chat-attach {
        flex: 0 0 32px;
        width: 32px;
        height: 32px;
        min-width: 32px;
        background: transparent;
        color: var(--pc-muted);
        border: none;
        border-radius: 50%;
        padding: 0;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, color 0.15s;
      }
      #player-chat-attach .pc-attach-icon {
        font-size: 22px;
        font-weight: 300;
        line-height: 1;
      }
      #player-chat-attach:hover { color: var(--pc-text); background: rgba(255,255,255,0.06); }
      .pc-composer-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
        padding-left: 2px;
      }
      #player-chat-attach-chips {
        display: none;
        flex-wrap: wrap;
        gap: 8px;
        padding: 10px 12px 0;
      }
      #player-chat-attach-chips.has-items { display: flex; }
      .pc-attach-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--pc-elevated);
        border: 1px solid var(--pc-border);
        border-radius: 10px;
        padding: 4px 8px;
        font-size: 11px;
        color: #cbd5e1;
        max-width: 180px;
      }
      .pc-attach-chip img {
        width: 28px; height: 28px;
        object-fit: cover;
        border-radius: 4px;
        display: block;
      }
      .pc-attach-chip .pc-chip-name {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .pc-attach-chip .pc-chip-x {
        cursor: pointer; color: #f87171; font-weight: bold; padding: 0 2px;
      }
      #player-chat-panel.pc-drag-over {
        outline: 2px dashed #4ade80;
        outline-offset: -4px;
      }
      .msg .pc-msg-attachments { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; }
      .msg .pc-msg-attachments img {
        max-width: 180px; max-height: 130px;
        border-radius: 6px; border: 1px solid #334155; display: block;
      }
      .msg .pc-msg-file-chip {
        display: inline-flex; align-items: center; gap: 4px;
        background: #1e293b; border: 1px solid #334155; border-radius: 6px;
        padding: 3px 8px; font-size: 10px; color: #cbd5e1;
      }
      #player-chat-fab {
        background: var(--pc-surface, #121826);
        color: var(--pc-text, #f1f5f9);
        border: 1px solid rgba(74, 222, 128, 0.45);
        border-radius: 999px;
        padding: 10px 18px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        transition: background 0.15s, border-color 0.15s;
      }
      #player-chat-fab:hover { background: var(--pc-elevated, #1a2233); }
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
        }
        html.denizen-touch #player-chat-send,
        html.denizen-touch #player-chat-speak {
          width: 40px;
          min-width: 40px;
          height: 40px;
          min-height: 40px;
          padding: 0;
        }
        @media (orientation: landscape) {
          #player-chat-panel {
            height: min(55dvh, 360px);
            max-height: min(55dvh, 360px);
          }
        }
      }
      html:not(.denizen-touch) #player-chat-panel {
        width: min(420px, calc(100vw - 32px));
        height: min(520px, calc(100vh - 100px));
        max-height: min(58vh, 520px);
      }
      html:not(.denizen-touch) #player-chat-close-btn { display: flex; }
      html:not(.denizen-touch) #player-chat-log {
        flex: 1;
        min-height: 180px;
        max-height: none;
        padding: 16px;
      }
      html:not(.denizen-touch) #player-chat-log:empty::before {
        content: "No messages yet";
        align-self: center;
        margin: auto 0 4px;
        color: var(--pc-muted);
        font-size: 14px;
        font-weight: 500;
      }
      html:not(.denizen-touch) #player-chat-log:empty::after {
        content: "Click someone in the office or press Enter nearby";
        align-self: center;
        margin: 0 auto auto;
        color: #64748b;
        font-size: 12px;
        text-align: center;
        max-width: 220px;
        line-height: 1.4;
      }
      html:not(.denizen-touch) #player-chat-input { font-size: 15px; }
      html:not(.denizen-touch) #player-chat-speak .pc-speak-label { display: none; }
      html:not(.denizen-touch) #player-chat-speak {
        width: 32px;
        min-width: 32px;
        height: 32px;
        padding: 0;
        border-radius: 50%;
        justify-content: center;
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
      html.denizen-touch.denizen-phone.denizen-landscape .pc-composer-shell {
        padding: 8px 10px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape .pc-composer-bar {
        gap: 4px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #player-chat-input {
        min-height: 40px;
        font-size: 16px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #player-chat-send,
      html.denizen-touch.denizen-phone.denizen-landscape #player-chat-speak {
        width: 40px;
        min-width: 40px;
        height: 40px;
        min-height: 40px;
        padding: 0;
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
        content: "Say hello";
        align-self: center;
        margin: auto 0 4px;
        color: var(--pc-muted);
        font-size: 14px;
        font-weight: 500;
      }
      html.denizen-touch #player-chat-log:empty::after {
        content: "Tap an NPC in the office";
        align-self: center;
        margin: 0 auto auto;
        color: #64748b;
        font-size: 12px;
      }
      html.denizen-touch #player-chat-log .msg.system {
        -webkit-backdrop-filter: blur(12px);
        backdrop-filter: blur(12px);
        box-shadow: none;
      }
      html.denizen-touch #player-chat-log .msg.system.error .text {
        color: #fecaca;
      }
      html.denizen-touch .pc-composer-shell {
        padding: 10px 12px max(10px, env(safe-area-inset-bottom, 0px));
      }
      html.denizen-touch .pc-composer-bar {
        padding: 5px 6px 5px 2px;
      }
      html.denizen-touch #player-chat-input {
        min-height: 28px;
        font-size: 16px;
        padding: 10px 6px;
      }
      html.denizen-touch #player-chat-send,
      html.denizen-touch #player-chat-speak {
        flex: none;
        width: 40px;
        min-width: 40px;
        height: 40px;
        min-height: 40px;
        padding: 0;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
      }
      html.denizen-touch #player-chat-send {
        background: var(--pc-accent);
      }
      html.denizen-touch #player-chat-speak {
        background: transparent;
      }
      html.denizen-touch #player-chat-speak .pc-speak-label {
        display: none;
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
      /* Chat has its own mic — hide global speak + phone FABs until chat closes */
      html.denizen-chat-open #denizen-speak-fab,
      html.denizen-chat-open #denizen-phone-fab {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
    }

    let panel = document.getElementById('player-chat-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'player-chat-panel';
      panel.innerHTML = `
        <div id="player-chat-header">
          <div class="pc-header-avatar" id="player-chat-avatar" aria-hidden="true"></div>
          <div class="chat-header-main">
            <span class="target" id="player-chat-target">Messages</span>
            <span class="pc-header-status" id="player-chat-header-status">Click an NPC to start</span>
          </div>
          <button type="button" id="player-chat-close-btn" aria-label="Close chat">✕</button>
        </div>
        <div id="player-chat-log" role="log" aria-live="polite" aria-label="Chat messages"></div>
        ${PlayerChat._composerHtml()}
      `;
      document.body.appendChild(panel);
    } else {
      this._upgradeComposerDom(panel);
    }

    const existingFab = document.getElementById('player-chat-fab');
    if (existingFab) {
      this._fab = existingFab;
    } else {
      const fab = document.createElement('button');
      fab.id = 'player-chat-fab';
      fab.type = 'button';
      fab.className = 'ws-off';
      globalThis.DenizenTablerIcons?.paintChip?.(fab, 'messages', 'Chat', { title: 'Talk to NPCs (Enter or T also works)' })
        || globalThis.DenizenBottomDock?.renderChip?.('player-chat-fab', 'Chat');
      if (!fab.innerHTML) fab.textContent = '💬 Chat';
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
    this._autoResizeChatInput();

    if (this._composerListenersWired) return;
    this._composerListenersWired = true;

    // --- Attachments: + picker, drag-drop onto the panel, paste into the input ---
    this._pendingAttachments = this._pendingAttachments || [];
    this._attachChipsEl = panel.querySelector('#player-chat-attach-chips');
    const attachBtn = panel.querySelector('#player-chat-attach');
    const fileInput = panel.querySelector('#player-chat-file');
    if (attachBtn && fileInput) {
      // bindPress (pointerup-based) fires on real phones even when parent
      // touch handlers preventDefault — a bare click listener does not.
      const openPicker = () => fileInput.click();
      if (window.DenizenTouchBind?.bindPress) {
        window.DenizenTouchBind.bindPress(attachBtn, openPicker);
      } else {
        attachBtn.addEventListener('click', openPicker);
      }
      fileInput.addEventListener('change', () => {
        this._addPendingFiles(fileInput.files);
        fileInput.value = '';
      });
    }
    // Document-level capture so drops land anywhere over the app (including
    // the phone frame around the chat panel) while chat is open. Capture
    // phase beats overlays that stopPropagation.
    const chatDropActive = () => {
      if (!this._container) return false;
      const style = getComputedStyle(this._container);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const row = document.getElementById('player-chat-input-row');
      const bar = this._container.querySelector('.pc-composer-bar');
      return !!(row && bar && getComputedStyle(row).display !== 'none');
    };
    const hasFiles = (e) => !!(e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files'));
    const hasLinkOrText = (e) => {
      const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : [];
      return types.includes('text/uri-list') || types.includes('text/plain');
    };
    document.addEventListener('dragover', (e) => {
      if (!chatDropActive() || !(hasFiles(e) || hasLinkOrText(e))) return;
      e.preventDefault();
      panel.classList.add('pc-drag-over');
    }, { capture: true });
    document.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) panel.classList.remove('pc-drag-over');
    }, { capture: true });
    document.addEventListener('drop', (e) => {
      panel.classList.remove('pc-drag-over');
      if (!chatDropActive()) return;
      if (e.dataTransfer?.files?.length) {
        e.preventDefault();
        e.stopPropagation();
        this._addPendingFiles(e.dataTransfer.files);
        return;
      }
      // A dropped link or text snippet goes into the input (never navigate away).
      const uri = e.dataTransfer?.getData?.('text/uri-list') || e.dataTransfer?.getData?.('text/plain') || '';
      const dropped = String(uri).split(/\r?\n/)[0].trim();
      if (dropped) {
        e.preventDefault();
        e.stopPropagation();
        const cur = this._input?.value || '';
        if (this._input) {
          this._input.value = cur ? `${cur.replace(/\s+$/, '')} ${dropped}` : dropped;
          this._input.dispatchEvent(new Event('input', { bubbles: true }));
          try { this._input.focus(); } catch (_) {}
        }
      }
    }, { capture: true });
    this._input.addEventListener('paste', (e) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        e.preventDefault();
        this._addPendingFiles(files);
      }
    });
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
      this._ensureKeyboardForChat();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (this._input.value.trim() || this._pendingAttachments?.length) {
          this.sendMessage(this._input.value);
          this._input.value = '';
          this._autoResizeChatInput();
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
    this._input.addEventListener('focus', () => {
      const r = window.__DenizenRawMoveKeys;
      if (r) Object.keys(r).forEach((k) => { r[k] = false; });
      this._clearChatMoveKeys();
      this._ensureKeyboardForChat();
    });
    this._input.addEventListener('input', () => {
      this._autoResizeChatInput();
      syncSendButton();
    });
    this._input.addEventListener('blur', () => this._clearChatMoveKeys());
    window.addEventListener('blur', () => this._clearChatMoveKeys());
    document.addEventListener('keydown', (e) => {
      if (document.activeElement !== this._input) return;
      this._ensureKeyboardForChat();
    }, true);
    if (this._chatCaptureTimer) clearInterval(this._chatCaptureTimer);
    this._chatCaptureTimer = setInterval(() => {
      if (document.activeElement === this._input && this._visible) this._ensureKeyboardForChat();
    }, 900);
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
      const glyph = speakBtn.querySelector('.pc-speak-glyph');
      const label = speakBtn.querySelector('.pc-speak-label');
      if (glyph) {
        const T = globalThis.DenizenTablerIcons;
        glyph.innerHTML = T?.speakGlyph
          ? T.speakGlyph(on, { size: 18, className: 'pc-ti' })
          : (on ? '⏹' : '🎤');
      }
      if (label) {
        label.textContent = on ? 'Stop' : 'Speak';
        label.style.display = document.documentElement.classList.contains('denizen-touch') ? '' : 'none';
      }
      speakBtn.setAttribute('aria-label', on ? 'Stop voice input' : 'Start voice input');
      speakBtn.title = on ? 'Stop voice input' : 'Voice input';
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
      sendBtn.disabled = !String(this._input?.value || '').trim()
        && !(this._pendingAttachments && this._pendingAttachments.length);
    };
    this._syncSendButton = syncSendButton;
    const onSend = (e) => {
      if (e?.preventDefault) e.preventDefault();
      if (e?.stopPropagation) e.stopPropagation();
      const text = String(this._input?.value || '').trim();
      if (!text && !this._pendingAttachments?.length) return;
      this.sendMessage(text);
      this._input.value = '';
      this._autoResizeChatInput();
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
        if (!window.__DenizenIsTouch) return;
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
    if (this._waitingForResponse && this._typingNpc !== name) {
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

  /**
   * Background skill completion — never impersonate NPCs or spam robot lines in open chat.
   */
  notifySkillResult(npcName, skill, ok = true) {
    const sk = String(skill || '').trim();
    if (!sk || sk === 'web-search' || sk === 'research') return;
    if (!String(npcName || '').trim() || !this._visible) return;
    const thread = this._getActiveThread();
    const activeNpc = thread?.type === 'dm'
      ? thread.npcName
      : (this._ceoConvo?.npcName || null);
    if (activeNpc) return;
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

  /** True when the player is actively in a Bouncer DM (chat should show security lines too). */
  _isBouncerChatActive() {
    const thread = this._getActiveThread?.();
    if (thread?.type === 'dm' && thread.npcName === 'Bouncer') return true;
    if (this._ceoConvo?.npcName === 'Bouncer') return true;
    if (this._lastUserChatTarget === 'Bouncer'
      && Date.now() - (this._lastUserChatAt || 0) < 45000) return true;
    return false;
  }

  /**
   * Skill-result notifications for the chat log. Deliberately quiet:
   * ambient skills (web-search/research) and other NPCs' skill lines never
   * appear in an open DM — the NPC's own reply carries the result instead.
   */
  notifySkillResult(npcName, skill, _ok) {
    const s = String(skill || '').toLowerCase();
    if (s === 'web-search' || s === 'websearch' || s === 'research') return;
    const activeNpc = this._getActiveThread?.()?.npcName || this._ceoConvo?.npcName || null;
    if (activeNpc && String(npcName) !== String(activeNpc)) return;
    // Own-NPC skill in its own DM: a subtle system note only.
    if (activeNpc) this._addToLog('System', `${npcName} finished ${skill}.`);
  }

  /**
   * Queue files (from 📎 picker, drag-drop, or paste) to send with the next message.
   * Keeps full base64 for the wire and a small canvas thumbnail for display so
   * cached thread messages stay tiny.
   */
  _addPendingFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!Array.isArray(this._pendingAttachments)) this._pendingAttachments = [];
    const MAX = 3;
    const IMG_CAP = 6 * 1024 * 1024;
    const TXT_CAP = 512 * 1024;
    for (const f of files) {
      if (this._pendingAttachments.length >= MAX) {
        this._addToLog('System', `Max ${MAX} attachments per message — extra files skipped.`);
        break;
      }
      const isImage = /^image\//i.test(f.type || '');
      if (f.size > (isImage ? IMG_CAP : TXT_CAP)) {
        this._addToLog('System', `${f.name} is too large (max ${isImage ? '6MB for images' : '512KB for files'}).`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const att = {
          name: f.name || 'file',
          mime: f.type || '',
          size: f.size,
          data: dataUrl.slice(dataUrl.indexOf(',') + 1),
          thumbUrl: null,
        };
        this._pendingAttachments.push(att);
        this._renderAttachChips();
        if (isImage) {
          this._makeThumb(dataUrl, (thumb) => {
            att.thumbUrl = thumb;
            this._renderAttachChips();
          });
        }
      };
      reader.readAsDataURL(f);
    }
  }

  /** Downscale an image data URL to a ≤160px JPEG thumbnail (bounded size). */
  _makeThumb(dataUrl, cb) {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 160 / Math.max(img.width, img.height, 1));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          cb(canvas.toDataURL('image/jpeg', 0.7));
        } catch (_) { cb(null); }
      };
      img.onerror = () => cb(null);
      img.src = dataUrl;
    } catch (_) { cb(null); }
  }

  _renderAttachChips() {
    try { this._syncSendButton?.(); } catch (_) {}
    const el = this._attachChipsEl;
    if (!el) return;
    const items = this._pendingAttachments || [];
    el.innerHTML = '';
    el.classList.toggle('has-items', items.length > 0);
    items.forEach((att, i) => {
      const chip = document.createElement('span');
      chip.className = 'pc-attach-chip';
      if (att.thumbUrl) {
        const img = document.createElement('img');
        img.src = att.thumbUrl;
        chip.appendChild(img);
      }
      const name = document.createElement('span');
      name.className = 'pc-chip-name';
      name.textContent = att.name;
      chip.appendChild(name);
      const x = document.createElement('span');
      x.className = 'pc-chip-x';
      x.textContent = '×';
      x.title = 'Remove';
      const removeChip = () => {
        this._pendingAttachments.splice(i, 1);
        this._renderAttachChips();
      };
      if (window.DenizenTouchBind?.bindPress) {
        window.DenizenTouchBind.bindPress(x, removeChip);
      } else {
        x.onclick = removeChip;
      }
      chip.appendChild(x);
      el.appendChild(chip);
    });
  }

  /** Take (and clear) pending attachments for sending. */
  _takePendingAttachments() {
    const items = this._pendingAttachments || [];
    this._pendingAttachments = [];
    this._renderAttachChips();
    return items;
  }

  _addToLog(sender, text, opts = {}) {
    const entry = { from: sender, text, time: Date.now() };
    if (Array.isArray(opts.attachments) && opts.attachments.length) {
      entry.attachments = opts.attachments;
    }
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
    const prevScroll = log.scrollTop;
    const nearBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 80;

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

    // Attachment previews: thumbUrl is generated locally by our own FileReader/canvas
    // (never from server or NPC text) and gated to data:image/ URLs only.
    const attachHtml = (m) => {
      if (!Array.isArray(m.attachments) || !m.attachments.length) return '';
      const parts = m.attachments.map((a) => {
        if (a.thumbUrl && /^data:image\//.test(a.thumbUrl)) {
          return `<img src="${a.thumbUrl}" alt="${esc(a.name)}" title="${esc(a.name)}" />`;
        }
        return `<span class="pc-msg-file-chip">📄 ${esc(a.name)}</span>`;
      }).join('');
      return `<div class="pc-msg-attachments">${parts}</div>`;
    };

    let html = recent.map((m) => {
      if (m.from === 'You') {
        return `<div class="msg you"><span class="text">${esc(m.text)}</span>${attachHtml(m)}</div>`;
      }
      if (m.from === 'System') {
        return `<div class="msg system error"><span class="text">${esc(m.text)}</span></div>`;
      }
      const label = isGroup
        ? `<span class="sender npc">${esc(this._displayNpcName(m.from))}</span>`
        : '';
      return `<div class="msg npc">${label}<span class="text">${esc(m.text)}</span></div>`;
    }).join('');

    if (this._typingNpc && this._waitingForResponse) {
      html += `<div class="msg npc typing" aria-label="${esc(this._displayNpcName(this._typingNpc))} is typing"><span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span></div>`;
    }

    log.innerHTML = html;
    // Stick to bottom only if the user was already there or just sent a
    // message — never yank them away from reading older messages.
    const lastMsg = recent[recent.length - 1];
    if (nearBottom || lastMsg?.from === 'You' || this._waitingForResponse) {
      log.scrollTop = log.scrollHeight;
    } else {
      log.scrollTop = prevScroll;
    }
    this._refreshHeaderStatus();
  }

  _refreshHeaderStatus() {
    const status = document.getElementById('player-chat-header-status');
    if (!status) return;
    const name = this._currentChatTargetName;
    let statusText = 'Click an NPC to start';
    if (name) {
      if (this._waitingForResponse && this._usesGrokCliChat(name)) {
        statusText = 'Grok CLI thinking…';
      } else if (this._waitingForResponse) {
        statusText = 'Typing…';
      } else {
        statusText = 'In conversation';
      }
    }
    status.textContent = statusText;
  }

  _updateTargetLabel(name) {
    this._currentChatTargetName = name || '';
    const display = name ? this._displayNpcName(name) : 'Messages';
    if (this._targetLabel) this._targetLabel.textContent = display;
    this._refreshHeaderStatus();
    const avatar = document.getElementById('player-chat-avatar');
    if (avatar) {
      if (name) {
        avatar.textContent = String(this._displayNpcName(name)).trim().charAt(0).toUpperCase() || '•';
      } else {
        const T = globalThis.DenizenTablerIcons;
        avatar.innerHTML = T?.icon ? T.icon('messages', { size: 16, className: 'pc-ti' }) : '💬';
      }
    }
  }
}

window.PlayerChat = PlayerChat;
