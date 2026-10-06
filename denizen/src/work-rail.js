/**
 * Team workbench rail — orchestrator, crew, inbox, trail, memory.
 * Desktop: right-side rail (denizen-work-rail-open).
 * Phone: Denizen OS Workbench app mounts a separate instance — never syncs
 * open/close with the laptop sidebar.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-work-rail-style';
  const RAIL_ID = 'denizen-work-rail';
  const PHONE_RAIL_ID = 'denizen-work-rail-phone';
  const TAB_ID = 'denizen-work-rail-tab';
  const STORAGE_KEY = 'denizen-work-rail-open';
  const TABS = [
    { id: 'orchestrator', label: 'Abby' },
    { id: 'crew', label: 'Crew' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'trail', label: 'Trail' },
    { id: 'memory', label: 'Memory' },
  ];

  let railEl = null;
  let phoneRailEl = null;
  let tabEl = null;
  let currentTab = 'orchestrator';
  let phoneTab = 'orchestrator';
  let phoneMounted = false;
  let desktopOpenBeforePhone = false;
  let snapshot = { directives: [], drops: [], orchestrator: 'Abby' };

  function isTouchPhone() {
    return document.documentElement.classList.contains('denizen-phone');
  }

  function isDemo() {
    return !!globalThis.DenizenVisitorSession?.isDemo?.();
  }

  function isDesktopRailOpen() {
    return document.documentElement.classList.contains('denizen-work-rail-open');
  }

  function injectStyles() {
    let s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = STYLE_ID;
      document.head.appendChild(s);
    }
    s.textContent = `
      #${TAB_ID} {
        position: absolute;
        top: 50%;
        right: 0;
        z-index: 6;
        transform: translate(calc(100% + 8px), -50%);
        writing-mode: vertical-rl;
        text-orientation: mixed;
        border: 1px solid rgba(163,230,53,0.35);
        border-right: 0;
        border-radius: 10px 0 0 10px;
        background: rgba(8, 14, 28, 0.92);
        color: #d9f99d;
        font: 600 11px/1.2 "IBM Plex Sans", system-ui, sans-serif;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        padding: 14px 7px;
        cursor: pointer;
      }
      html.denizen-phone #${TAB_ID},
      html.denizen-work-rail-open #${TAB_ID},
      html.denizen-work-rail-phone #${TAB_ID} { display: none; }
      /* Phones size the frame edge-to-edge, so the tab stays on the screen edge. */
      html.denizen-touch #${TAB_ID} {
        position: fixed;
        right: 0;
        z-index: 10040;
        transform: translateY(-50%);
      }
      #${RAIL_ID} {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(380px, 42vw);
        z-index: 10050;
        display: none;
        flex-direction: column;
        background: rgba(6, 12, 24, 0.94);
        border-left: 1px solid rgba(80,110,160,0.22);
        color: #e2e8f0;
        font-family: "IBM Plex Sans", system-ui, sans-serif;
        backdrop-filter: blur(10px);
      }
      html.denizen-work-rail-open #${RAIL_ID} { display: flex; }
      /* Phone shell mounts its own instance — never the desktop fixed rail. */
      #${PHONE_RAIL_ID} {
        display: none;
        flex-direction: column;
        position: relative;
        inset: auto;
        width: 100%;
        height: 100%;
        min-height: 0;
        border: 0;
        background: transparent;
        color: #e2e8f0;
        font-family: "IBM Plex Sans", system-ui, sans-serif;
        z-index: auto;
      }
      #dzp-workbench-host #${PHONE_RAIL_ID} {
        display: flex;
        flex: 1;
        min-height: 0;
        width: 100%;
      }
      #${PHONE_RAIL_ID} .wr-close { display: none; }
      #${RAIL_ID} .wr-head,
      #${PHONE_RAIL_ID} .wr-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px 8px; border-bottom: 1px solid rgba(148,163,184,0.14);
      }
      #${RAIL_ID} .wr-head h2,
      #${PHONE_RAIL_ID} .wr-head h2 {
        margin: 0; font-size: 13px; letter-spacing: 0.08em;
        text-transform: uppercase; color: #a3e635;
      }
      #${RAIL_ID} .wr-close {
        background: transparent; border: 0; color: #94a3b8; cursor: pointer; font-size: 16px;
      }
      #${RAIL_ID} .wr-tabs,
      #${PHONE_RAIL_ID} .wr-tabs,
      #dzp-workbench-host .wr-tabs {
        display: flex; gap: 2px; padding: 8px 8px 0; overflow-x: auto;
        flex-shrink: 0;
        position: relative;
        z-index: 6;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
        touch-action: pan-x;
      }
      #${RAIL_ID} .wr-tabs button,
      #${PHONE_RAIL_ID} .wr-tabs button,
      #dzp-workbench-host .wr-tabs button {
        flex: 1; border: 0 !important; background: transparent !important;
        color: #94a3b8 !important;
        font-size: 11px; padding: 6px 4px; cursor: pointer;
        border-radius: 0 !important;
        border-bottom: 2px solid transparent !important;
        min-height: 40px;
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(163, 230, 53, 0.25);
        pointer-events: auto !important;
        position: relative;
        z-index: 1;
      }
      /* Phone: large tappable chips — beat .dzp-settings button styles */
      #${PHONE_RAIL_ID} .wr-tabs button,
      #dzp-workbench-host .wr-tabs button {
        flex: 0 0 auto;
        min-width: 64px;
        min-height: 44px;
        padding: 12px 14px;
        font-size: 13px;
        font-weight: 700;
      }
      #${RAIL_ID} .wr-tabs button.active,
      #${PHONE_RAIL_ID} .wr-tabs button.active,
      #dzp-workbench-host .wr-tabs button.active {
        color: #f1f5f9 !important;
        border-bottom-color: #a3e635 !important;
      }
      #dzp-workbench-host .wr-tabs button:hover,
      #${PHONE_RAIL_ID} .wr-tabs button:hover {
        border-color: transparent !important;
        border-bottom-color: transparent !important;
        color: #e2e8f0 !important;
      }
      #dzp-workbench-host .wr-tabs button.active:hover,
      #${PHONE_RAIL_ID} .wr-tabs button.active:hover {
        border-bottom-color: #a3e635 !important;
        color: #f1f5f9 !important;
      }
      #${RAIL_ID} .wr-body,
      #${PHONE_RAIL_ID} .wr-body {
        flex: 1; overflow: auto; padding: 12px; min-height: 0;
      }
      #${RAIL_ID} .wr-empty,
      #${PHONE_RAIL_ID} .wr-empty { color: #94a3b8; font-size: 13px; line-height: 1.5; }
      #${RAIL_ID} .wr-card,
      #${PHONE_RAIL_ID} .wr-card {
        border: 1px solid rgba(80,110,160,0.2); border-radius: 10px;
        padding: 10px 12px; margin-bottom: 8px; background: rgba(2,6,23,0.4);
      }
      #${RAIL_ID} .wr-card b,
      #${PHONE_RAIL_ID} .wr-card b { color: #f8fafc; }
      #${RAIL_ID} .wr-card small,
      #${PHONE_RAIL_ID} .wr-card small { color: #94a3b8; }
      #${RAIL_ID} textarea, #${RAIL_ID} input[type="text"],
      #${PHONE_RAIL_ID} textarea, #${PHONE_RAIL_ID} input[type="text"] {
        width: 100%; box-sizing: border-box; border-radius: 8px;
        border: 1px solid #334155; background: #020617; color: #e2e8f0;
        padding: 8px; font: 13px/1.4 inherit;
      }
      #${RAIL_ID} .wr-send,
      #${PHONE_RAIL_ID} .wr-send {
        margin-top: 8px; border: 0; border-radius: 999px; padding: 7px 14px;
        background: #a3e635; color: #052e16; font-weight: 700; cursor: pointer;
      }
      #${RAIL_ID} .wr-crew,
      #${PHONE_RAIL_ID} .wr-crew {
        display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
      }
      #${RAIL_ID} .wr-crew button,
      #${PHONE_RAIL_ID} .wr-crew button {
        text-align: left; border-radius: 8px; border: 1px solid #1e293b;
        background: #0b1220; color: #e2e8f0; padding: 8px; cursor: pointer;
      }
      #${RAIL_ID} .denizen-work-rail-host #denizen-work-feed,
      #${RAIL_ID} #denizen-work-feed {
        position: relative !important; left: auto !important; bottom: auto !important;
        width: 100% !important; max-height: none !important; display: flex !important;
        transform: none !important; opacity: 1 !important;
      }
      #${RAIL_ID} #denizen-work-feed-toggle { display: none !important; }
      html.denizen-work-rail-open #denizen-work-feed-toggle { display: none !important; }
      html.denizen-work-rail-open #denizen-phone-fab {
        right: calc(min(380px, 42vw) + 12px) !important;
      }
      html.denizen-work-rail-open.denizen-buzz-ring-open:not(.denizen-phone) #denizen-phone-fab {
        right: calc(min(380px, 42vw) + 168px) !important;
        bottom: 152px !important;
        transform: none !important;
      }
      html.denizen-work-rail-open #denizen-buzz-note {
        right: calc(min(380px, 42vw) + 16px) !important;
      }
    `;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function railMarkup({ closeable }) {
    return `
      <div class="wr-head">
        <h2>Workbench</h2>
        ${closeable ? '<button type="button" class="wr-close" data-wr="close" aria-label="Close workbench">✕</button>' : '<span></span>'}
      </div>
      <div class="wr-tabs" role="tablist" aria-label="Workbench tabs">
        ${TABS.map((t) => `<button type="button" role="tab" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="wr-body" data-wr-body></div>
    `;
  }

  function wireRailClicks(el, { onClose, setTabId }) {
    let lastActAt = 0;
    let lastTabId = '';
    const mark = () => { lastActAt = Date.now(); };
    const recentlyHandled = () => Date.now() - lastActAt < 450;

    const activate = (e) => {
      const close = e.target.closest?.('[data-wr="close"]');
      if (close) {
        e.preventDefault?.();
        e.stopPropagation?.();
        onClose?.();
        return true;
      }
      const tab = e.target.closest?.('[data-tab]');
      if (tab) {
        e.preventDefault?.();
        e.stopPropagation?.();
        setTabId(tab.dataset.tab);
        return true;
      }
      const send = e.target.closest?.('[data-wr="send"]');
      if (send) {
        e.preventDefault?.();
        e.stopPropagation?.();
        void sendToAbby(el);
        return true;
      }
      const crew = e.target.closest?.('[data-crew]');
      if (crew) {
        e.preventDefault?.();
        e.stopPropagation?.();
        talkTo(crew.dataset.crew);
        return true;
      }
      const mer = e.target.closest?.('[data-wr="crm"]');
      if (mer) {
        e.preventDefault?.();
        e.stopPropagation?.();
        window.location.href = '/crm/';
        return true;
      }
      const seat = e.target.closest?.('[data-wr="seat"]');
      if (seat) {
        e.preventDefault?.();
        e.stopPropagation?.();
        globalThis.DenizenSeatAI?.open?.();
        return true;
      }
      const memBtn = e.target.closest?.('[data-wr="memory-search"]');
      if (memBtn) {
        e.preventDefault?.();
        e.stopPropagation?.();
        void searchMemory(el);
        return true;
      }
      return false;
    };

    // Direct per-tab binds — same path as phone Me tabs; survives iOS click-drop.
    // Only suppress duplicate events for the *same* tab (pointerup + synthetic click),
    // never block switching to a different section.
    const bindPress = window.DenizenTouchBind?.bindPress;
    el.querySelectorAll('[data-tab]').forEach((btn) => {
      const go = (e) => {
        const id = btn.dataset.tab;
        if (id === lastTabId && recentlyHandled()) return;
        e?.preventDefault?.();
        e?.stopPropagation?.();
        lastTabId = id;
        mark();
        setTabId(id);
      };
      if (bindPress) bindPress(btn, go, { stop: true });
      else btn.addEventListener('click', go);
    });

    // pointerup is reliable on iOS; suppress the duplicate synthetic click.
    el.addEventListener('pointerup', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (recentlyHandled()) return;
      // Tabs already have dedicated binds — skip so we don't double-switch.
      if (e.target.closest?.('[data-tab]')) return;
      if (!e.target.closest?.('button, [data-wr], [data-crew]')) return;
      if (activate(e)) mark();
    });
    el.addEventListener('click', (e) => {
      if (recentlyHandled()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.target.closest?.('[data-tab]')) {
        // Fallback when TouchBind is unavailable and only click fired.
        const tab = e.target.closest('[data-tab]');
        lastTabId = tab.dataset.tab;
        activate(e);
        mark();
        return;
      }
      activate(e);
    });

    if (window.DenizenTouchBind?.delegatePress) {
      window.DenizenTouchBind.delegatePress(el, '[data-wr], [data-crew]', (e, btn) => {
        if (recentlyHandled()) return;
        const fake = { target: btn, preventDefault() {}, stopPropagation() {} };
        if (activate(fake)) mark();
      }, { stop: true });
    }
  }

  function buildChrome() {
    if (railEl) return;
    railEl = document.createElement('aside');
    railEl.id = RAIL_ID;
    railEl.setAttribute('aria-label', 'Workbench');
    railEl.innerHTML = railMarkup({ closeable: true });
    wireRailClicks(railEl, {
      onClose: closeRail,
      setTabId: (id) => setTab(id, railEl, 'desktop'),
    });
    document.body.appendChild(railEl);

    tabEl = document.createElement('button');
    tabEl.id = TAB_ID;
    tabEl.type = 'button';
    tabEl.textContent = 'Workbench';
    tabEl.title = 'Open the workbench (])';
    tabEl.addEventListener('click', openRail);
    const frame = document.getElementById('game-frame');
    (frame || document.body).appendChild(tabEl);
  }

  function buildPhoneChrome() {
    if (phoneRailEl) return phoneRailEl;
    phoneRailEl = document.createElement('aside');
    phoneRailEl.id = PHONE_RAIL_ID;
    phoneRailEl.setAttribute('aria-label', 'Workbench');
    phoneRailEl.innerHTML = railMarkup({ closeable: false });
    wireRailClicks(phoneRailEl, {
      onClose: null,
      setTabId: (id) => setTab(id, phoneRailEl, 'phone'),
    });
    return phoneRailEl;
  }

  function setTab(id, targetEl, scope) {
    const next = TABS.some((t) => t.id === id) ? id : 'orchestrator';
    if (scope === 'phone') phoneTab = next;
    else currentTab = next;
    const el = targetEl || (scope === 'phone' ? phoneRailEl : railEl);
    const active = scope === 'phone' ? phoneTab : currentTab;
    el?.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === active);
    });
    renderBody(el, active);
  }

  function demoGateHtml() {
    if (!isDemo()) return '';
    return `<p class="wr-empty">Demo can watch the floor. <a href="/office?login=1" style="color:#a3e635">Sign in</a> for the full workbench — directives, approvals, CRM, and Connect AI.</p>`;
  }

  function renderBody(el, tabId) {
    const body = el?.querySelector('[data-wr-body]');
    if (!body) return;
    const tab = tabId || currentTab;
    body.classList.remove('denizen-work-rail-host');
    if (tab === 'orchestrator') {
      const dirs = snapshot.directives || [];
      const leash = snapshot.leash;
      body.innerHTML = `
        ${demoGateHtml()}
        <p class="wr-empty">Abby runs the floor. Send a line — or drop a Buzz screenshot.</p>
        <p class="wr-empty">${esc(leash?.note || snapshot.escalate || 'Spend, destructive ops, and scope changes wait for you.')}</p>
        ${leash && leash.state !== 'ok' ? `<div class="wr-card"><b>Leash · ${esc(leash.state)}</b><div>${esc(leash.note)}</div></div>` : ''}
        <textarea id="wr-note" rows="3" placeholder="Tell Abby what to do next"></textarea>
        <button type="button" class="wr-send" data-wr="send">Send to Abby</button>
        <div style="margin-top:14px">
          ${dirs.length ? dirs.map((d) => `
            <div class="wr-card">
              <b>${esc(d.npc)}</b> · <small>${esc(d.status)}</small>
              <div>${esc(d.task)}</div>
              <small>from ${esc(d.from || '—')}</small>
            </div>`).join('') : '<p class="wr-empty">No open directives yet.</p>'}
        </div>
      `;
      return;
    }
    if (tab === 'crew') {
      const crew = snapshot.crew?.length
        ? snapshot.crew
        : (globalThis.DenizenNpcRoster?.displayNames || []).map((n) => ({ name: n, seated: false, status: 'empty' }));
      body.innerHTML = `
        <p class="wr-empty">Seated desks have a live AI. Empty desks are named staff waiting for a subscription.</p>
        <p><button type="button" class="wr-send" data-wr="seat">Seat an AI</button></p>
        <div class="wr-crew" style="margin-top:10px">
          ${crew.map((c) => {
            const name = c.name || c;
            const seated = !!c.seated;
            const status = c.status || (seated ? 'seated' : 'empty');
            return `<button type="button" data-crew="${esc(name)}"><b>${esc(name)}</b><br><small>${seated ? 'Seated' : 'Empty'} · ${esc(status)}</small></button>`;
          }).join('')}
        </div>
      `;
      return;
    }
    if (tab === 'inbox') {
      const drops = snapshot.drops || [];
      const handoffs = snapshot.handoffs || [];
      const approvals = snapshot.approvals || [];
      body.innerHTML = `
        ${demoGateHtml()}
        <p class="wr-empty">Approvals, handoffs, and Buzz drops land here.</p>
        ${handoffs.map((h) => `
          <div class="wr-card">
            <b>Handoff · ${esc(h.from || 'crew')}</b>
            <div>${esc(h.message || '')}</div>
          </div>`).join('')}
        ${approvals.map((a) => `
          <div class="wr-card">
            <b>Approval · ${esc(a.by || a.kind)}</b>
            <div>${esc(a.summary || '')}</div>
          </div>`).join('')}
        ${drops.map((d) => `
          <div class="wr-card">
            <b>Buzz → ${esc(d.to)}</b> · <small>${esc(d.kind)}</small>
            <div>${esc(d.note || '(no note)')}</div>
          </div>`).join('') || (!handoffs.length && !approvals.length ? '<p class="wr-empty">No Buzz drops yet. Click Buzz to capture.</p>' : '')}
        <p class="wr-empty" style="margin-top:12px"><button type="button" class="wr-send" data-wr="crm">Open Meridian CRM</button></p>
      `;
      try { globalThis.DenizenProposals?.show?.(); } catch (_) {}
      return;
    }
    if (tab === 'trail') {
      const floor = globalThis.DenizenFloorStrip?.recent?.() || [];
      const cards = floor.slice(0, 8).map((line) => {
        const who = line.to ? `${line.from} → ${line.to}` : line.from;
        return `<div class="wr-card"><b>${esc(who)}</b><div>${esc(line.text)}</div></div>`;
      }).join('');
      body.innerHTML = cards || '<p class="wr-empty">Lines from the floor show up here as people talk.</p>';
      if (el === railEl) {
        const feed = document.getElementById('denizen-work-feed');
        if (feed) {
          body.appendChild(feed);
          feed.style.display = 'flex';
        }
      }
      return;
    }
    if (tab === 'memory') {
      const assistant = globalThis.DenizenVisitorSession?.getAssistant?.();
      const rows = snapshot.memory || [];
      body.innerHTML = `
        <p class="wr-empty">Markdown memory from souls on disk. Search the palace, then open a desk.</p>
        <input type="text" data-wr-memory-q placeholder="Search memory" />
        <button type="button" class="wr-send" data-wr="memory-search">Search</button>
        ${assistant ? `<div class="wr-card"><b>${esc(assistant.assistant_name || assistant.npc_key)}</b><div>Your claimed assistant keeps memory across sessions.</div></div>` : ''}
        ${rows.length ? rows.map((m) => `
          <div class="wr-card">
            <b>${esc(m.npc)}</b>
            ${(m.lines || []).map((line) => `<div><small>${esc(line)}</small></div>`).join('')}
          </div>`).join('') : '<p class="wr-empty">No memory lines yet. Claim an assistant or run the floor.</p>'}
      `;
    }
  }

  async function refresh(extra = {}) {
    try {
      const sess = globalThis.DenizenVisitorSession;
      const u = new URL('/api/workbench', window.location.origin);
      const sid = sess?.getSessionId?.();
      if (sid) u.searchParams.set('session_id', sid);
      if (extra.q) u.searchParams.set('q', extra.q);
      const res = await fetch(u.toString(), {
        headers: sess?.authHeaders?.() || {},
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) snapshot = json;
    } catch (_) {}
    if (isDesktopRailOpen() && railEl) renderBody(railEl, currentTab);
    if (phoneMounted && phoneRailEl) renderBody(phoneRailEl, phoneTab);
  }

  async function searchMemory(el) {
    const q = String(el?.querySelector('[data-wr-memory-q], #wr-memory-q')?.value || '').trim();
    if (el === phoneRailEl) phoneTab = 'memory';
    else currentTab = 'memory';
    await refresh({ q });
  }

  async function sendToAbby(el) {
    const ta = el?.querySelector('#wr-note');
    const note = String(ta?.value || '').trim();
    if (!note) return;
    const sess = globalThis.DenizenVisitorSession;
    const res = await fetch('/api/context-drop', {
      method: 'POST',
      headers: sess?.authHeaders?.() || { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note,
        kind: 'note',
        to: 'Abby',
        from: sess?.getDisplayName?.() || 'Visitor',
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (ta) ta.value = '';
    if (json.ok) await refresh();
  }

  function talkTo(name) {
    try {
      globalThis.__DenizenPlayerChat?.open?.();
      const input = document.querySelector('#player-chat-input, #player-chat-panel textarea, #player-chat-panel input');
      if (input) {
        input.focus();
        if (!input.value) input.value = `@${name} `;
      }
    } catch (_) {}
  }

  function openRail() {
    injectStyles();
    buildChrome();
    document.documentElement.classList.add('denizen-work-rail-open');
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
    setTab(currentTab, railEl, 'desktop');
    void refresh();
  }

  function closeRail() {
    document.documentElement.classList.remove('denizen-work-rail-open');
    try { localStorage.setItem(STORAGE_KEY, '0'); } catch (_) {}
    const feed = document.getElementById('denizen-work-feed');
    if (feed && feed.parentElement?.hasAttribute?.('data-wr-body')) {
      document.body.appendChild(feed);
    }
  }

  function toggleRail() {
    if (isDesktopRailOpen()) closeRail();
    else openRail();
  }

  /**
   * Phone app: mount an independent workbench with Abby/Crew/Inbox tabs.
   * Does not open, close, or steal the laptop sidebar — even if it is already extended.
   */
  function mountPhone(host) {
    injectStyles();
    if (!isTouchPhone()) buildChrome();
    if (!host) return;
    desktopOpenBeforePhone = isDesktopRailOpen();
    phoneMounted = true;
    document.documentElement.classList.add('denizen-work-rail-phone');
    // Keep desktop open flag exactly as it was — phone must not sync it.
    if (desktopOpenBeforePhone) {
      document.documentElement.classList.add('denizen-work-rail-open');
    } else {
      document.documentElement.classList.remove('denizen-work-rail-open');
    }
    const phone = buildPhoneChrome();
    host.innerHTML = '';
    host.appendChild(phone);
    setTab(phoneTab, phone, 'phone');
    void refresh();
  }

  function unmountPhone() {
    phoneMounted = false;
    document.documentElement.classList.remove('denizen-work-rail-phone');
    if (phoneRailEl?.parentElement) {
      phoneRailEl.parentElement.removeChild(phoneRailEl);
    }
    // Restore laptop sidebar exactly how it was before the phone app opened.
    if (desktopOpenBeforePhone) {
      document.documentElement.classList.add('denizen-work-rail-open');
      if (railEl) setTab(currentTab, railEl, 'desktop');
    } else {
      document.documentElement.classList.remove('denizen-work-rail-open');
    }
  }

  function boot() {
    if (isTouchPhone()) return;
    injectStyles();
    buildChrome();
    document.addEventListener('keydown', (e) => {
      if (e.key !== ']' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = String(e.target?.tagName || '');
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      e.preventDefault();
      toggleRail();
    });
    document.addEventListener('denizen-buzz-drop', () => {
      currentTab = 'inbox';
      phoneTab = 'inbox';
      if (isDesktopRailOpen() || phoneMounted) void refresh();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  globalThis.DenizenWorkRail = {
    open: openRail,
    close: closeRail,
    toggle: toggleRail,
    mountPhone,
    unmountPhone,
    refresh,
  };
})();
