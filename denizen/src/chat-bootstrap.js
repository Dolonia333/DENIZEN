/**

 * Instant chat chrome — visible before Phaser / office-scene finish loading.

 * Opens WebSocket + PlayerChat as soon as deferred scripts parse (~seconds),

 * not after the full office scene creates (~minutes on slow tunnels).

 */

(function () {

  'use strict';



  const STYLES = `

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

    #player-chat-fab.ws-off { border-color: #f87171; color: #fecaca; }

    #player-chat-fab.ws-on { border-color: #4ade80; }

    #denizen-ws-banner {

      position: fixed; top: 0; left: 0; right: 0; z-index: 100003;

      background: rgba(127, 29, 29, 0.95); color: #fecaca;

      text-align: center; padding: 8px 12px;

      font: 12px/1.4 ui-monospace, monospace; display: none;

    }

    #denizen-load-banner {

      position: fixed; top: 0; left: 0; right: 0; z-index: 100001;

      background: rgba(15, 23, 42, 0.92); color: #94a3b8;

      text-align: center; padding: 6px 10px;

      font: 11px/1.4 ui-monospace, monospace;

      border-bottom: 1px solid #334155;

    }

    #denizen-load-banner strong { color: #4ade80; }

  `;



  let fab = null;

  let loadBanner = null;

  let attached = false;

  let earlyManager = null;



  function injectStyles() {

    if (document.getElementById('denizen-chat-bootstrap-style')) return;

    const s = document.createElement('style');

    s.id = 'denizen-chat-bootstrap-style';

    s.textContent = STYLES;

    document.head.appendChild(s);

  }



  function ensureFab() {

    if (fab) return fab;

    fab = document.createElement('button');

    fab.id = 'player-chat-fab';

    fab.type = 'button';

    fab.className = 'ws-off';

    fab.textContent = '💬 Chat';

    fab.title = 'Talk to NPCs';

    document.body.appendChild(fab);

    return fab;

  }



  function ensureBanners() {

    if (!loadBanner) {

      loadBanner = document.createElement('div');

      loadBanner.id = 'denizen-load-banner';

      loadBanner.innerHTML = '<strong>Denizen</strong> loading office… <span id="denizen-load-pct">0%</span> — 💬 Chat works now';

      document.body.appendChild(loadBanner);

    }

    if (!document.getElementById('denizen-ws-banner')) {

      const b = document.createElement('div');

      b.id = 'denizen-ws-banner';

      b.textContent = 'Chat offline — hard-refresh (Ctrl+Shift+R). Server not running? Start it in the denizen folder.';

      document.body.appendChild(b);

    }

  }



  function wsUrl() {
    const routed = globalThis.DenizenSpectateRouting?.resolveAgentWsUrl?.();
    if (routed) return routed;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/agent-ws`;
  }



  function createEarlyChatManager(playerChat) {

    const mgr = {

      connected: false,

      ws: null,

      NPC_NAMES: {},

      actions: null,

      _pendingReplyResolvers: [],

      _reconnectAttempt: 0,

      _reconnectTimer: null,

      _send(msg) {

        if (mgr.ws?.readyState === WebSocket.OPEN) {

          mgr.ws.send(JSON.stringify(msg));

        }

      },

      connect() {
        if (mgr.ws && (mgr.ws.readyState === WebSocket.OPEN || mgr.ws.readyState === WebSocket.CONNECTING)) {
          return;
        }
        const openSocket = () => {
          try {
            mgr.ws = new WebSocket(wsUrl());
            window.__DenizenAgentWs = mgr.ws;
          } catch (err) {
            console.warn('[ChatBootstrap] WebSocket failed:', err);
            mgr._scheduleReconnect(playerChat);
            return;
          }
          mgr.ws.onopen = () => {

          mgr.connected = true;

          mgr._reconnectAttempt = 0;

          playerChat?.setWsConnected?.(true);

          console.log('[ChatBootstrap] WebSocket connected (early chat)');

        };

        mgr.ws.onmessage = (evt) => {

          try {

            const msg = JSON.parse(evt.data);

            if (msg.type === 'office_registered') {
              globalThis.DenizenVisitorSession?.applyOfficeRegistration?.(msg);
            } else if (msg.type === 'bouncer_security') {
              const line = String(msg.text || '').trim();
              if (line) {
                window.DenizenSecurityFeed?.ingest?.({ text: line, kind: 'incident' });
                window.DenizenSecurityFeed?.show?.();
              }
            } else if (msg.type === 'player_chat_response' && playerChat) {

              playerChat._hasActions = !!(msg.actions && msg.actions.length);

              playerChat.handleNpcResponse(msg.npcName, msg.text, msg.delegation, msg.error, {
                crmActions: msg.crm_actions,
              });

              globalThis.DenizenCrmBridge?.handlePlayerChatResponse?.(msg);

            } else if (msg.type === 'player_group_chat_response' && playerChat) {

              playerChat.handleGroupResponse(msg.groupId, msg.npcName, msg.text, msg.error);

            } else if (msg.type === 'player_chat_ack' && playerChat) {

              playerChat.logPlayerChatAck(msg.npcName, msg.queueLen);

            } else if (
              msg.type === 'voice_chat_filler'
              || msg.type === 'voice_chat_token'
              || msg.type === 'voice_chat_sentence'
              || msg.type === 'voice_chat_done'
              || msg.type === 'player_chat_cancelled'
            ) {
              globalThis.DenizenVoiceSession?.handleWsMessage?.(msg);
              if (msg.type === 'voice_chat_token' && playerChat) {
                playerChat.handleVoiceStreamToken?.(msg.npcName, msg.token);
              }
              if (msg.type === 'player_chat_cancelled' && playerChat) {
                playerChat.handlePlayerChatCancelled?.(msg);
              }
            } else if (msg.type === 'station_task_enqueued' && playerChat) {
              playerChat._addToLog?.('System', `⚙ Station task queued${msg.kind ? `: ${msg.kind}` : ''}`);
            } else if (msg.type === 'npc_skill_start' && playerChat && msg.skill === 'web-search') {
              playerChat._addToLog('System', 'Lucy\'s browser is launching — tap 🌐 browser in the dock to watch live.');
              window.DenizenBrowserMirror?.ingest?.({
                searching: true,
                open: true,
                status: 'searching',
                query: msg.skillParams?.query || '',
              });
            } else if (msg.type === 'lucy_browser_mirror' || msg.type === 'npc_browser_mirror') {
              window.DenizenBrowserMirror?.ingest?.(msg);
            } else if (msg.type === 'lucy_browser_frame' || msg.type === 'npc_browser_frame') {
              window.DenizenBrowserMirror?.onFrame?.(msg);
            } else if (msg.type === 'npc_report_to_ceo' && playerChat
              && !(window.__DenizenAgentManager?.connected && window.__DenizenAgentManager?.ws === mgr.ws)) {
              if (playerChat._lucySearchActive) playerChat._lucySearchActive = null;

              if (typeof playerChat._onNpcReport === 'function') {
                playerChat._onNpcReport(msg.npcName || 'Lucy', msg.text || '');
              } else {
                playerChat._addToLog(msg.npcName || 'Lucy', msg.text || '');
              }

            }

          } catch (_) {}

        };

        mgr.ws.onclose = () => {

          mgr.connected = false;

          playerChat?.setWsConnected?.(false);

          mgr._scheduleReconnect(playerChat);

        };

        mgr.ws.onerror = () => {
          mgr.connected = false;
          playerChat?.setWsConnected?.(false);
        };
        };
        if (globalThis.DenizenSpectateRouting?.loadConfig) {
          globalThis.DenizenSpectateRouting.loadConfig().finally(openSocket);
        } else {
          openSocket();
        }
      },

      _scheduleReconnect(playerChat) {

        if (mgr._reconnectTimer) return;

        const delay = Math.min(2000 * Math.pow(2, mgr._reconnectAttempt), 30000);

        mgr._reconnectAttempt++;

        mgr._reconnectTimer = setTimeout(() => {

          mgr._reconnectTimer = null;

          mgr.connect();

        }, delay);

      },

    };

    mgr.connect();

    window.addEventListener('online', () => mgr.connect());

    document.addEventListener('visibilitychange', () => {

      if (document.visibilityState === 'visible') mgr.connect();

    });

    return mgr;

  }



  function tryEarlyPlayerChat() {

    if (attached || !window.PlayerChat || !globalThis.DenizenNpcRoster) return false;

    try {

      earlyManager = createEarlyChatManager(null);

      const pc = new window.PlayerChat(null, earlyManager);

      earlyManager._playerChatRef = pc;

      earlyManager.ws.onmessage = (evt) => {

        try {

          const msg = JSON.parse(evt.data);

          if (msg.type === 'player_chat_response') {

            pc._hasActions = !!(msg.actions && msg.actions.length);

            pc.handleNpcResponse(msg.npcName, msg.text, msg.delegation, msg.error, {
              crmActions: msg.crm_actions,
            });

            globalThis.DenizenCrmBridge?.handlePlayerChatResponse?.(msg);

          } else if (msg.type === 'player_group_chat_response') {

            pc.handleGroupResponse(msg.groupId, msg.npcName, msg.text, msg.error);

          } else if (msg.type === 'player_chat_ack') {

            pc.logPlayerChatAck(msg.npcName, msg.queueLen);

          } else if (msg.type === 'npc_skill_start' && msg.skill === 'web-search') {
            pc._addToLog('System', 'Lucy\'s browser is launching — tap 🌐 browser in the dock to watch live.');
            window.DenizenBrowserMirror?.ingest?.({
              searching: true,
              open: true,
              status: 'searching',
              query: msg.skillParams?.query || '',
            });
          } else if (msg.type === 'lucy_browser_mirror' || msg.type === 'npc_browser_mirror') {
            window.DenizenBrowserMirror?.ingest?.(msg);
          } else if (msg.type === 'lucy_browser_frame' || msg.type === 'npc_browser_frame') {
            window.DenizenBrowserMirror?.onFrame?.(msg);
          } else if (msg.type === 'npc_report_to_ceo') {

            if (pc._lucySearchActive) pc._lucySearchActive = null;

            if (typeof pc._onNpcReport === 'function') {
              pc._onNpcReport(msg.npcName || 'Lucy', msg.text || '');
            } else {
              pc._addToLog(msg.npcName || 'Lucy', msg.text || '');
            }

          }

        } catch (_) {}

      };

      attach(pc);

      pc._addToLog('System', 'Chat ready — office still loading; messages route to NPCs now.');

      return true;

    } catch (err) {

      console.warn('[ChatBootstrap] early PlayerChat failed:', err);

      return false;

    }

  }



  function onFabClick() {

    const pc = window.__DenizenPlayerChat;

    if (pc && typeof pc.toggle === 'function') {

      pc.toggle();

      return;

    }

    if (tryEarlyPlayerChat()) {

      window.__DenizenPlayerChat?.toggle?.();

      return;

    }

    const el = document.getElementById('denizen-load-banner');

    if (el) {

      el.innerHTML = '<strong>Starting chat…</strong> loading scripts — try again in a few seconds';

      el.style.background = 'rgba(113, 63, 18, 0.95)';

      el.style.color = '#fde68a';

    }

  }



  function initVisitorSession() {

    if (globalThis.DenizenVisitorSession?.init) {

      globalThis.DenizenVisitorSession.init().catch((err) => {

        console.warn('[ChatBootstrap] visitor session init failed:', err?.message || err);

      });

      return true;

    }

    return false;

  }



  function boot() {

    injectStyles();

    ensureBanners();

    ensureFab();

    if (!initVisitorSession()) {

      const visPoll = setInterval(() => {

        if (initVisitorSession()) clearInterval(visPoll);

      }, 200);

      setTimeout(() => clearInterval(visPoll), 15000);

    }

    if (window.DenizenTouchBind?.bindPress) window.DenizenTouchBind.bindPress(fab, onFabClick);

    else fab.addEventListener('click', onFabClick);

    const poll = setInterval(() => {

      if (tryEarlyPlayerChat()) clearInterval(poll);

    }, 400);

    setTimeout(() => clearInterval(poll), 120000);

    console.log('[ChatBootstrap] instant 💬 button ready');

  }



  function rewireFab(playerChat) {

    if (!playerChat) return;

    ensureFab();

    if (!fab) return;

    fab.replaceWith(fab.cloneNode(true));

    fab = document.getElementById('player-chat-fab');

    if (!fab) return;

    playerChat._fab = fab;

    playerChat._useBootstrapFab = true;

    const onFab = (e) => {

      if (e?.stopPropagation) e.stopPropagation();

      playerChat.toggle();

    };

    if (window.DenizenTouchBind?.bindPress) window.DenizenTouchBind.bindPress(fab, onFab);

    else fab.addEventListener('click', onFab);

    playerChat._syncFabLabel?.();

  }



  function attach(playerChat) {

    if (!playerChat) return;

    const firstAttach = !attached;

    attached = true;

    if (firstAttach && loadBanner) {

      loadBanner.style.display = 'none';

    }

    rewireFab(playerChat);

    playerChat.setWsConnected(!!(playerChat.manager?.connected || playerChat.manager?.ws?.readyState === WebSocket.OPEN));

    if (firstAttach) console.log('[ChatBootstrap] attached to PlayerChat');

  }



  function setLoadPct(pct) {

    const el = document.getElementById('denizen-load-pct');

    if (el) el.textContent = `${Math.round(pct)}%`;

    if (pct >= 100 && loadBanner) {

      loadBanner.style.display = 'none';

    }

  }



  window.__DenizenChatBootstrap = { attach, rewireFab, setLoadPct, boot };



  boot();

})();


