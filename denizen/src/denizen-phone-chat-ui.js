/**
 * Phone Messages app — thread list, contacts, group chats.
 * Wraps #player-chat-panel when the phone Chat app is open.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-phone-chat-style';
  let shellReady = false;
  let view = 'threads';
  let threads = [];
  let groupPick = new Set();
  let groupMode = false;
  let panelStatus = '';
  let creatingGroup = false;

  function chat() {
    return window.__DenizenPlayerChat || null;
  }

  function sess() {
    return globalThis.DenizenVisitorSession || null;
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function portraitForKey(npcKey, scale = 2) {
    const roster = globalThis.DenizenNpcRoster;
    const folder = String(npcKey || '').toLowerCase().replace(/^xp_/, '');
    const entry = (roster?.entries || []).find((e) => e.folder === folder || e.textureKey === npcKey);
    if (!entry) return null;
    const col = 1 % 4;
    const row = Math.floor(1 / 4);
    const fw = 32;
    const fh = 48;
    const sw = fw * scale;
    const sh = fh * scale;
    return {
      style: [
        `background-image:url('assets/${entry.assetName}.png')`,
        `background-position:${-col * sw}px ${-row * sh}px`,
        `background-size:${4 * sw}px ${4 * sh}px`,
        `width:${sw}px`,
        `height:${sh}px`,
      ].join(';'),
      label: entry.display,
      folder: entry.folder,
      textureKey: entry.textureKey,
    };
  }

  function portraitHtml(npcKey, scale, cls) {
    const p = portraitForKey(npcKey, scale);
    if (!p) return `<div class="phc-portrait phc-portrait-fallback ${cls || ''}">?</div>`;
    return `<div class="phc-portrait ${cls || ''}" style="${p.style}" aria-hidden="true"></div>`;
  }

  function npcContacts() {
    const roster = globalThis.DenizenNpcRoster;
    return (roster?.entries || [])
      .filter((e) => e?.folder)
      .map((e) => ({
        key: e.folder,
        label: e.display,
        textureKey: e.textureKey,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function isPhoneChatActive() {
    const panel = document.getElementById('player-chat-panel');
    if (panel?.dataset?.phoneChat === '1') return true;
    return document.documentElement.classList.contains('denizen-phone-open')
      && document.documentElement.classList.contains('denizen-chat-open');
  }

  function showToast(text) {
    const msg = String(text || '').trim();
    if (!msg) return;
    panelStatus = msg;
    render();
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      if (panelStatus === msg) panelStatus = '';
      render();
    }, 2600);
  }

  let shellClickWired = false;

  function wireShellDelegation(shell) {
    if (!shell || shellClickWired) return;
    shellClickWired = true;
    const delegate = globalThis.DenizenTouchBind?.delegatePress;
    if (delegate) {
      delegate(shell, '[data-action]', (_e, btn) => runAction(btn.dataset.action, btn));
      return;
    }
    shell.addEventListener('click', (event) => {
      const btn = event.target.closest?.('[data-action]');
      if (!btn || !shell.contains(btn)) return;
      event.preventDefault();
      event.stopPropagation();
      runAction(btn.dataset.action, btn);
    });
  }

  function runAction(action, el) {
    if (!action) return;
    switch (action) {
      case 'new-group':
        groupMode = true;
        groupPick.clear();
        panelStatus = 'Tap NPCs to add them — pick at least 2.';
        setView('group-pick');
        return;
      case 'pick-npc': {
        const key = el?.dataset?.npcKey;
        if (!key) return;
        if (groupPick.has(key)) groupPick.delete(key);
        else groupPick.add(key);
        panelStatus = groupPick.size
          ? `${groupPick.size} selected — need ${Math.max(0, 2 - groupPick.size)} more.`
          : 'Tap NPCs to add them — pick at least 2.';
        renderGroupFooter();
        renderContacts();
        return;
      }
      case 'create-group':
        createGroup();
        return;
      case 'open-dm':
        openDm(el?.dataset?.npcKey, el?.dataset?.npcName);
        return;
      case 'open-thread': {
        const id = el?.dataset?.threadId;
        const row = threads.find((t) => (t.threadId || t.thread_id) === id);
        const pc = chat();
        if (!pc || !row || !id) return;
        pc.setPhoneShellEnabled(true);
        pc.openThread({
          threadId: id,
          type: row.type || (String(id).startsWith('group:') ? 'group' : 'dm'),
          npcKey: row.npc_key || row.npcKey,
          npcName: threadTitle(row),
          groupId: row.group_id || row.groupId || (String(id).startsWith('group:') ? id.slice(6) : null),
          title: threadTitle(row),
          members: row.member_npc_keys || row.members || [],
        }).then(() => setView('thread'));
        return;
      }
      case 'tab':
        if (el?.dataset?.tab !== 'contacts') groupMode = false;
        setView(el?.dataset?.tab || 'threads');
        return;
      case 'back':
        onBack();
        return;
      case 'speak': {
        const vi = window.DenizenVoiceInput;
        if (!(vi?.isSupported?.() ?? vi?.supported)) {
          showToast('Voice unavailable — allow mic or set OPENAI_API_KEY on server');
          return;
        }
        if (typeof window.DenizenSetPresence === 'function' && !window.DenizenPresence?.zionPresent) {
          try { window.DenizenSetPresence(true); } catch (_) {}
        }
        if (vi.isListening?.()) vi.stop();
        else vi.start?.();
        return;
      }
      default:
        break;
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #player-chat-panel[data-phone-chat="1"] {
        display: flex !important;
        flex-direction: column;
        padding: 0;
        overflow: hidden;
      }
      #player-chat-panel[data-phone-chat="1"] {
        overflow: hidden !important;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-phone-shell {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        position: relative;
        z-index: 3;
        pointer-events: auto;
      }
      #player-chat-panel[data-phone-chat="1"][data-phc-view="thread"] #player-chat-phone-shell {
        flex: 0 0 auto;
        min-height: auto;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-input-row {
        display: block;
        flex: 0 0 auto !important;
        position: relative;
        z-index: 12;
        pointer-events: auto !important;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-input,
      #player-chat-panel[data-phone-chat="1"] #player-chat-send,
      #player-chat-panel[data-phone-chat="1"] #player-chat-attach,
      #player-chat-panel[data-phone-chat="1"] #player-chat-speak {
        pointer-events: auto !important;
        touch-action: manipulation;
      }
      #player-chat-panel[data-phc-view="threads"] #player-chat-log,
      #player-chat-panel[data-phc-view="contacts"] #player-chat-log,
      #player-chat-panel[data-phc-view="group-pick"] #player-chat-log,
      #player-chat-panel[data-phc-view="threads"] #player-chat-input-row,
      #player-chat-panel[data-phc-view="contacts"] #player-chat-input-row,
      #player-chat-panel[data-phc-view="group-pick"] #player-chat-input-row,
      #player-chat-panel[data-phc-view="threads"] #player-chat-attach-chips,
      #player-chat-panel[data-phc-view="contacts"] #player-chat-attach-chips,
      #player-chat-panel[data-phc-view="group-pick"] #player-chat-attach-chips {
        display: none !important;
        pointer-events: none !important;
      }
      /* ChatGPT-style composer bar in the phone thread view */
      #player-chat-panel[data-phone-chat="1"] .pc-composer-shell {
        margin: 8px 10px calc(10px + env(safe-area-inset-bottom, 0px));
        padding: 0;
      }
      #player-chat-panel[data-phone-chat="1"] .pc-composer-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 6px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 26px;
        box-shadow: none;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-attach {
        width: 38px;
        height: 38px;
        min-width: 38px;
        border-radius: 50%;
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 24px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-attach:active {
        background: rgba(51,65,85,.6);
        color: #e2e8f0;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-input {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        box-shadow: none;
        color: #e2e8f0;
        font-size: 16px; /* ≥16px prevents iOS zoom-on-focus */
        padding: 8px 2px;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-speak {
        width: 38px;
        height: 38px;
        min-width: 38px;
        max-width: 38px;
        border-radius: 50%;
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 0; /* hide whatever label the voice module writes */
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        overflow: hidden;
        flex-shrink: 0;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-speak::before {
        content: '🎤';
        font-size: 18px;
        line-height: 1;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-speak.listening::before {
        content: '⏹';
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-send {
        width: 38px;
        height: 38px;
        min-width: 38px;
        max-width: 38px;
        border-radius: 50%;
        background: #4ade80;
        color: #0f172a;
        border: none;
        font-size: 0; /* replace 'Send' text with the arrow glyph */
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        overflow: hidden;
        flex-shrink: 0;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-send::before {
        content: '↑';
        font-size: 19px;
        line-height: 1;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-attach-chips {
        margin: 0 12px;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-attach-chips.has-items {
        padding: 6px 0 0 0;
      }
      #player-chat-panel[data-phone-chat="1"] #player-chat-header { display: none; }
      #player-chat-panel[data-phone-chat="1"] #player-chat-log {
        flex: 1;
        min-height: 0;
        max-height: none;
      }
      #player-chat-panel[data-phone-chat="1"][data-phc-view="threads"] #player-chat-log,
      #player-chat-panel[data-phone-chat="1"][data-phc-view="contacts"] #player-chat-log,
      #player-chat-panel[data-phone-chat="1"][data-phc-view="group-pick"] #player-chat-log,
      #player-chat-panel[data-phone-chat="1"][data-phc-view="threads"] #player-chat-input-row,
      #player-chat-panel[data-phone-chat="1"][data-phc-view="contacts"] #player-chat-input-row,
      #player-chat-panel[data-phone-chat="1"][data-phc-view="group-pick"] #player-chat-input-row {
        display: none !important;
      }
      #player-chat-panel[data-phone-chat="1"][data-phc-view="thread"] #phc-list-wrap {
        display: none !important;
      }
      #phc-nav {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid #1e293b;
        background: linear-gradient(180deg, rgba(15,23,42,.98), rgba(15,23,42,.88));
        flex-shrink: 0;
      }
      #phc-nav .phc-back {
        border: 1px solid #334155;
        background: rgba(15,23,42,.9);
        color: #93c5fd;
        border-radius: 8px;
        min-width: 36px;
        min-height: 36px;
        font-size: 18px;
        cursor: pointer;
      }
      #phc-nav .phc-title {
        flex: 1;
        font: 700 15px/1.2 system-ui, sans-serif;
        color: #e2e8f0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #phc-nav .phc-action.phc-speak { font-size: 0; }
      #phc-nav .phc-action.phc-speak::before { content: '🎤'; font-size: 16px; line-height: 1; }
      #phc-nav .phc-action.phc-speak.listening::before { content: '⏹'; }
      #phc-nav .phc-action.phc-speak.listening { background: rgba(127,29,29,.7); border-color: #fca5a5; }
      #phc-nav .phc-action {
        border: 1px solid #334155;
        background: rgba(30,41,59,.9);
        color: #bae6fd;
        border-radius: 8px;
        padding: 6px 10px;
        font: 600 11px system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
        min-width: 36px;
        min-height: 36px;
      }
      #phc-nav .phc-action.phc-new-group {
        background: linear-gradient(135deg, rgba(37,99,235,.35), rgba(29,78,216,.25));
        border-color: #3b82f6;
        color: #dbeafe;
        font-size: 12px;
        padding: 6px 12px;
        white-space: nowrap;
      }
      #phc-list-wrap {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        touch-action: pan-y;
      }
      #phc-group-footer {
        flex: 0 0 auto;
        padding: 10px 12px max(10px, env(safe-area-inset-bottom, 0px));
        border-top: 1px solid #1e293b;
        background: rgba(2,6,23,.96);
      }
      #phc-group-footer[hidden] { display: none !important; }
      #phc-group-footer .phc-action {
        width: 100%;
        min-height: 48px;
        padding: 12px;
        border: 1px solid #3b82f6;
        border-radius: 12px;
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        color: #eff6ff;
        font: 700 14px system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }
      #phc-group-footer .phc-action.phc-dim {
        opacity: 0.55;
      }
      #phc-tabs {
        display: flex;
        border-top: 1px solid #1e293b;
        background: rgba(2,6,23,.96);
        flex-shrink: 0;
      }
      #phc-tabs button {
        flex: 1;
        border: none;
        background: transparent;
        color: #64748b;
        padding: 10px 8px max(10px, env(safe-area-inset-bottom, 0px));
        font: 600 12px system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        transition: transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94), color 0.18s ease, opacity 0.18s ease;
      }
      #phc-tabs button.denizen-press-active,
      #phc-tabs button:active {
        transform: scale(0.97);
        opacity: 0.8;
      }
      #phc-tabs button.active { color: #60a5fa; }
      .phc-thread {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        text-align: left;
        border: none;
        border-bottom: 1px solid rgba(51,65,85,.45);
        background: transparent;
        padding: 10px 12px;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        transition: transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94), background 0.18s ease;
      }
      .phc-thread.denizen-press-active,
      .phc-thread:active { background: rgba(30,41,59,.55); transform: scale(0.98); }
      .phc-thread * { pointer-events: none; }
      .phc-thread-body { flex: 1; min-width: 0; }
      .phc-thread-name {
        font: 700 14px system-ui, sans-serif;
        color: #e2e8f0;
      }
      .phc-thread-preview {
        font: 12px/1.35 system-ui, sans-serif;
        color: #94a3b8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: 2px;
      }
      .phc-portrait {
        border-radius: 10px;
        image-rendering: pixelated;
        flex-shrink: 0;
        background-color: #0f172a;
        border: 1px solid #334155;
      }
      .phc-portrait-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        color: #64748b;
        font-weight: 700;
      }
      .phc-contacts-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
        gap: 10px;
        padding: 12px;
      }
      .phc-contact {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        border: 1px solid #334155;
        border-radius: 12px;
        background: rgba(15,23,42,.65);
        padding: 10px 8px;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        position: relative;
        z-index: 1;
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
        transition: transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94), background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
      }
      .phc-contact.denizen-press-active,
      .phc-contact:active {
        transform: scale(0.96);
        background: rgba(30,41,59,.75);
      }
      .phc-contact * {
        pointer-events: none;
      }
      .phc-contact.selected {
        border-color: #4ade80;
        background: rgba(20,83,45,.35);
        box-shadow: 0 0 0 2px rgba(74,222,128,.45);
      }
      .phc-thread,
      .phc-action,
      .phc-back,
      #phc-tabs button {
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }
      .phc-action,
      .phc-back {
        transition: transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94), background 0.18s ease, opacity 0.18s ease;
      }
      .phc-action.denizen-press-active,
      .phc-back.denizen-press-active,
      .phc-action:active,
      .phc-back:active {
        transform: scale(0.97);
        opacity: 0.88;
      }
      .phc-action.phc-primary {
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        border-color: #3b82f6;
        color: #eff6ff;
      }
      .phc-action.phc-primary.phc-dim {
        opacity: 0.55;
      }
      #phc-create-group-btn {
        min-height: 48px;
        touch-action: manipulation;
        pointer-events: auto !important;
      }
      .phc-status {
        padding: 8px 12px;
        color: #93c5fd;
        font: 12px/1.35 system-ui, sans-serif;
        border-bottom: 1px solid #1e293b;
      }
      .phc-status.warn { color: #fde68a; }
      .phc-contact-name {
        font: 600 11px system-ui, sans-serif;
        color: #e2e8f0;
        text-align: center;
      }
      .phc-empty {
        padding: 28px 16px;
        text-align: center;
        color: #64748b;
        font: 13px system-ui, sans-serif;
      }
      .phc-group-bar {
        padding: 8px 12px;
        border-bottom: 1px solid #1e293b;
        color: #93c5fd;
        font: 12px system-ui, sans-serif;
      }
      .phc-new-group-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        width: calc(100% - 24px);
        margin: 12px 12px 4px;
        padding: 12px 14px;
        border: 1px solid #3b82f6;
        border-radius: 12px;
        background: linear-gradient(135deg, rgba(37,99,235,.22), rgba(29,78,216,.12));
        color: #dbeafe;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        text-align: left;
      }
      .phc-new-group-card * { pointer-events: none; }
      .phc-new-group-icon {
        font: 700 20px/1 system-ui, sans-serif;
        color: #60a5fa;
      }
      .phc-new-group-label {
        font: 700 14px system-ui, sans-serif;
        color: #e2e8f0;
      }
      .phc-new-group-hint {
        font: 12px system-ui, sans-serif;
        color: #94a3b8;
      }
    `;
    document.head.appendChild(s);
  }

  function ensureShell() {
    const panel = document.getElementById('player-chat-panel');
    if (!panel) return null;
    injectStyles();
    let shell = document.getElementById('player-chat-phone-shell');
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'player-chat-phone-shell';
      shell.innerHTML = `
      <nav id="phc-nav">
        <button type="button" class="phc-back" id="phc-back-btn" data-action="back" aria-label="Back">‹</button>
        <div class="phc-title" id="phc-nav-title">Messages</div>
        <button type="button" class="phc-action phc-speak" id="phc-speak-btn" data-action="speak" hidden aria-label="Speak">🎤</button>
        <button type="button" class="phc-action phc-new-group" id="phc-new-group-btn" data-action="new-group" hidden>+ Group</button>
      </nav>
      <div id="phc-list-wrap"></div>
      <div id="phc-group-footer" hidden></div>
      <div id="phc-tabs">
        <button type="button" data-action="tab" data-tab="threads" class="active">Messages</button>
        <button type="button" data-action="tab" data-tab="contacts">Contacts</button>
      </div>
    `;
      const log = panel.querySelector('#player-chat-log');
      const inputRow = panel.querySelector('#player-chat-input-row');
      if (log) panel.insertBefore(shell, log);
      else panel.appendChild(shell);
      shellReady = true;
    }
    if (!document.getElementById('phc-group-footer')) {
      const footer = document.createElement('div');
      footer.id = 'phc-group-footer';
      footer.hidden = true;
      const tabs = document.getElementById('phc-tabs');
      if (tabs) shell.insertBefore(footer, tabs);
      else shell.appendChild(footer);
    }
    const newGroupBtn = document.getElementById('phc-new-group-btn');
    if (newGroupBtn) newGroupBtn.classList.add('phc-new-group');
    wireShellDelegation(shell);
    return panel;
  }

  function setGroupFooterVisible(show) {
    const footer = document.getElementById('phc-group-footer');
    if (!footer) return;
    footer.hidden = !show;
  }

  function renderGroupFooter() {
    const footer = document.getElementById('phc-group-footer');
    if (!footer) return;
    const pickCount = groupPick.size;
    footer.innerHTML = `<button type="button" class="phc-action phc-primary${pickCount < 2 ? ' phc-dim' : ''}" data-action="create-group" id="phc-create-group-btn">
      ${creatingGroup ? 'Creating…' : `Create group (${pickCount} selected)`}
    </button>`;
  }

  function setView(next) {
    const changed = view !== next;
    view = next;
    if (changed) {
      // Switching views shows a different list — start it at the top and
      // invalidate the render cache so it repaints even if HTML matches.
      const wrap = document.getElementById('phc-list-wrap');
      if (wrap) {
        wrap._phcLastHtml = null;
        wrap.scrollTop = 0;
      }
    }
    const panel = document.getElementById('player-chat-panel');
    if (panel) {
      panel.dataset.phcView = view;
      if (view === 'group-pick' || view === 'contacts' || view === 'threads') {
        panel.dataset.phoneChat = '1';
      }
    }
    const tabs = document.getElementById('phc-tabs');
    if (tabs) {
      tabs.style.display = (view === 'thread') ? 'none' : 'flex';
      tabs.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === view || (view === 'group-pick' && b.dataset.tab === 'contacts'));
      });
    }
    setGroupFooterVisible(view === 'group-pick' || (view === 'contacts' && groupMode));
    if (view === 'group-pick' || (view === 'contacts' && groupMode)) renderGroupFooter();
    updateNav();
    render();
  }

  const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  const setHidden = (el, v) => { if (el && el.hidden !== v) el.hidden = v; };

  function updateNav() {
    const title = document.getElementById('phc-nav-title');
    const back = document.getElementById('phc-back-btn');
    const newGroup = document.getElementById('phc-new-group-btn');
    const speakBtn = document.getElementById('phc-speak-btn');
    if (!title || !back) return;
    if (view === 'thread') {
      const t = chat()?.getActiveThread?.();
      setText(title, t?.title || t?.npcName || 'Chat');
      setHidden(back, false);
      setHidden(newGroup, true);
      if (speakBtn) {
        const vi = window.DenizenVoiceInput;
        const supported = !!(vi && (vi.isSupported?.() ?? vi.supported));
        setHidden(speakBtn, !supported);
        speakBtn.classList.toggle('listening', !!(vi?.isListening?.()));
        // Glyph (🎤/⏹) is rendered via CSS ::before keyed on .listening —
        // rewriting textContent here fought the CSS and churned the DOM.
      }
    } else if (view === 'group-pick') {
      setText(title, 'New group');
      setHidden(back, false);
      setHidden(newGroup, true);
      setHidden(speakBtn, true);
    } else {
      setText(title, view === 'contacts' ? 'Contacts' : 'Messages');
      setHidden(back, true);
      setHidden(newGroup, view !== 'contacts');
      setHidden(speakBtn, true);
    }
  }

  function onBack() {
    if (view === 'thread' || view === 'group-pick') {
      groupMode = false;
      groupPick.clear();
      chat()?.setPhoneShellEnabled?.(true);
      setView('threads');
      return;
    }
    window.__DenizenPlayerChat?.close?.();
    globalThis.DenizenPhoneUi?.goHome?.();
  }

  function shortNpcLabel(name) {
    const raw = String(name || '').trim();
    if (!raw) return '';
    const roster = globalThis.DenizenNpcRoster;
    const entry = (roster?.entries || []).find((e) => e.display === raw || e.folder === raw.toLowerCase());
    if (entry?.display) return entry.display;
    return raw.split(/\s+/)[0] || raw;
  }

  function threadTitle(t) {
    if (t.type === 'group') return t.title || t.name || 'Group';
    const label = t.title || t.npcName || (t.npc_key ? portraitForKey(t.npc_key)?.label : null) || t.npc_key;
    return shortNpcLabel(label) || 'Chat';
  }

  function mergeThreads(remote, local) {
    const map = new Map();
    (remote || []).forEach((t) => {
      const id = t.thread_id;
      if (!id) return;
      map.set(id, { ...t, threadId: id });
    });
    (local || []).forEach((t) => {
      const id = t.threadId;
      if (!id) return;
      const prev = map.get(id) || {};
      map.set(id, {
        ...prev,
        ...t,
        threadId: id,
        preview: t.preview || prev.preview || '',
        updated_at: t.updatedAt || prev.updated_at,
      });
    });
    return [...map.values()].sort((a, b) => {
      const ta = new Date(a.updated_at || a.updatedAt || 0).getTime();
      const tb = new Date(b.updated_at || b.updatedAt || 0).getTime();
      return tb - ta;
    });
  }

  async function refreshThreads() {
    const sid = sess()?.getSessionId?.();
    let remote = [];
    if (sid) {
      remote = await sess()?.listChatThreads?.().catch(() => []) || [];
    }
    const local = chat()?.listLocalThreads?.() || [];
    threads = mergeThreads(remote, local);
    if (view !== 'thread') render();
  }

  function openDm(npcKey, npcName) {
    const pc = chat();
    if (!pc) return;
    pc.setPhoneShellEnabled(true);
    pc.setVisible(true);
    pc.openThread({
      threadId: `dm:${npcKey}`,
      type: 'dm',
      npcKey,
      npcName: npcName || portraitForKey(npcKey)?.label || npcKey,
      title: npcName || portraitForKey(npcKey)?.label || npcKey,
    }).then(() => {
      setView('thread');
    });
  }

  async function createGroup() {
    if (creatingGroup) return;
    if (groupPick.size < 2) {
      panelStatus = 'Select at least 2 NPCs (cards turn green when picked).';
      showToast(panelStatus);
      renderContacts();
      return;
    }
    const sid = sess()?.getSessionId?.();
    if (!sid) {
      panelStatus = 'Sign in via Profile before creating group chats.';
      showToast(panelStatus);
      renderContacts();
      return;
    }
    creatingGroup = true;
    panelStatus = 'Creating group…';
    renderGroupFooter();
    renderContacts();
    const keys = [...groupPick];
    const labels = keys.map((k) => portraitForKey(k)?.label || k);
    try {
      const res = await sess().createGroupChat({
        member_npc_keys: keys,
        name: labels.slice(0, 3).join(', '),
      });
      const threadId = res?.thread_id || (res?.group?.id ? `group:${res.group.id}` : null);
      const groupId = res?.group?.id || (threadId ? String(threadId).replace(/^group:/, '') : null);
      if (!threadId || !groupId || groupId === 'undefined') {
        throw new Error(res?.error || 'Server did not return a group thread');
      }
      groupMode = false;
      groupPick.clear();
      panelStatus = '';
      const pc = chat();
      if (!pc) throw new Error('Chat panel is not ready — close and reopen Messages.');
      pc.setPhoneShellEnabled(true);
      pc.setVisible(true);
      await pc.openThread({
        threadId,
        type: 'group',
        groupId,
        title: res.group?.name || labels.join(', '),
        members: keys,
      });
      setView('thread');
      refreshThreads().catch(() => null);
      showToast('Group created');
    } catch (err) {
      panelStatus = err?.message || 'Could not create group';
    } finally {
      creatingGroup = false;
      renderGroupFooter();
      if (view === 'group-pick' || groupMode) renderContacts();
    }
  }

  /**
   * Set list HTML without losing the user's scroll position: skip identical
   * re-renders entirely (refreshThreads fires on every incoming message), and
   * restore scrollTop when content genuinely changed.
   */
  function setListHtml(wrap, html) {
    if (wrap._phcLastHtml === html) return;
    const prevScroll = wrap.scrollTop;
    wrap.innerHTML = html;
    wrap._phcLastHtml = html;
    wrap.scrollTop = prevScroll;
  }

  function renderThreads() {
    const wrap = document.getElementById('phc-list-wrap');
    if (!wrap) return;
    if (!threads.length) {
      setListHtml(wrap, '<div class="phc-empty">No conversations yet.<br>Tap <b>Contacts</b> to message an NPC.</div>');
      return;
    }
    setListHtml(wrap, threads.map((t) => {
      const id = t.threadId || t.thread_id;
      const isGroup = t.type === 'group' || String(id).startsWith('group:');
      const npcKey = t.npc_key || t.npcKey || (isGroup ? null : String(id).replace(/^dm:/, ''));
      const name = threadTitle(t);
      const preview = t.preview || (t.preview_role === 'user' ? 'You: …' : 'Tap to open');
      const avatars = isGroup
        ? `<div class="phc-portrait phc-portrait-fallback" style="width:40px;height:40px">👥</div>`
        : portraitHtml(npcKey, 1.25, '');
      return `<button type="button" class="phc-thread" data-action="open-thread" data-thread-id="${esc(id)}">
        ${avatars}
        <div class="phc-thread-body">
          <div class="phc-thread-name">${esc(name)}</div>
          <div class="phc-thread-preview">${esc(preview)}</div>
        </div>
      </button>`;
    }).join(''));
  }

  function renderContacts() {
    const wrap = document.getElementById('phc-list-wrap');
    if (!wrap) return;
    const contacts = npcContacts();
    if (groupMode || view === 'group-pick') {
      const pickCount = groupPick.size;
      const statusLine = panelStatus
        || (pickCount
          ? `${pickCount} selected — ${pickCount < 2 ? `pick ${2 - pickCount} more` : 'ready to create'}`
          : 'Tap NPC cards to add them to the group (green = selected).');
      const statusWarn = !!(panelStatus && (creatingGroup === false));
      setListHtml(wrap, `
        <div class="phc-group-bar">Pick <b>2 or more</b> coworkers, then tap <b>Create group</b> below.</div>
        ${statusLine ? `<div class="phc-status${statusWarn ? ' warn' : ''}">${esc(statusLine)}</div>` : ''}
        <div class="phc-contacts-grid" id="phc-group-grid">${contacts.map((c) => `
          <button type="button" class="phc-contact${groupPick.has(c.key) ? ' selected' : ''}" data-action="pick-npc" data-npc-key="${esc(c.key)}">
            ${portraitHtml(c.key, 2, '')}
            <div class="phc-contact-name">${esc(c.label)}</div>
          </button>`).join('')}</div>`);
      renderGroupFooter();
      return;
    }
    setListHtml(wrap, `
      <button type="button" class="phc-new-group-card" data-action="new-group">
        <span class="phc-new-group-icon">＋</span>
        <span class="phc-new-group-label">New group chat</span>
        <span class="phc-new-group-hint">Pick 2+ coworkers</span>
      </button>
      <div class="phc-contacts-grid">${contacts.map((c) => `
      <button type="button" class="phc-contact" data-action="open-dm" data-npc-key="${esc(c.key)}" data-npc-name="${esc(c.label)}">
        ${portraitHtml(c.key, 2, '')}
        <div class="phc-contact-name">${esc(c.label)}</div>
      </button>`).join('')}</div>`);
  }

  function render() {
    if (!isPhoneChatActive()) return;
    if (view === 'threads') renderThreads();
    else if (view === 'contacts' || view === 'group-pick') renderContacts();
    updateNav();
  }

  /** Compact glyphs for the round phone composer buttons; originals restored on close. */
  function setComposerGlyphs(phone) {
    const send = document.getElementById('player-chat-send');
    const speak = document.getElementById('player-chat-speak');
    if (send) {
      if (phone) {
        if (!send._deskLabel) send._deskLabel = send.textContent;
        send.textContent = '↑';
      } else if (send._deskLabel) send.textContent = send._deskLabel;
    }
    if (speak) {
      if (phone) {
        if (!speak._deskLabel) speak._deskLabel = speak.textContent;
        speak.textContent = '🎤';
      } else if (speak._deskLabel) speak.textContent = speak._deskLabel;
    }
  }

  function activate() {
    const panel = ensureShell();
    if (!panel) return;
    panel.dataset.phoneChat = '1';
    setComposerGlyphs(true);
    chat()?.setPhoneShellEnabled?.(true);
    if (view !== 'group-pick' && !groupMode) {
      setView(chat()?.getActiveThreadId?.() ? 'thread' : 'threads');
    } else {
      updateNav();
      render();
    }
    refreshThreads();
  }

  function deactivate() {
    const panel = document.getElementById('player-chat-panel');
    if (panel) {
      delete panel.dataset.phoneChat;
      delete panel.dataset.phcView;
    }
    setComposerGlyphs(false);
    chat()?.setPhoneShellEnabled?.(false);
    groupMode = false;
    groupPick.clear();
  }

  function init() {
    setInterval(() => {
      if (view === 'thread' && isPhoneChatActive()) updateNav();
    }, 450);
    document.addEventListener('denizen-phone-app-open', (e) => {
      if (e.detail?.appId === 'chat') activate();
    });
    document.addEventListener('denizen-phone-app-close', (e) => {
      if (e.detail?.appId === 'chat') deactivate();
    });
    const obs = new MutationObserver(() => {
      if (isPhoneChatActive() && !shellReady) activate();
      // Only tear down when the PHONE itself closed. The old check keyed on
      // denizen-chat-open, which the phone-app flow never sets — so any
      // unrelated root class change (voice, presence, rotation) nuked the
      // active chat shell mid-use.
      const panel = document.getElementById('player-chat-panel');
      if (panel?.dataset?.phoneChat === '1'
        && !document.documentElement.classList.contains('denizen-phone-open')) {
        deactivate();
      }
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  globalThis.DenizenPhoneChatUI = {
    init,
    activate,
    deactivate,
    refreshThreads,
    isPhoneChatActive,
    onThreadOpened() {
      setView('thread');
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
