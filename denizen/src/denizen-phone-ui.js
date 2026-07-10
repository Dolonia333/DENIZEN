/**
 * Denizen OS — the in-game smartphone HUD.
 *
 * Replaces the bottom dock with a concept phone: hardware frame (side buttons,
 * punch-hole camera, speaker), live status bar (clock / signal / wifi / real
 * battery), boot splash, wallpaper home screen with clock widget, gradient app
 * icons with notification badges + live state dots, favorites dock, and a
 * native Settings app. Apps proxy the legacy dock chips' click handlers, so
 * every tool keeps its existing logic untouched; panel apps render their
 * panels INSIDE the phone screen via geometry overrides keyed off
 * html[data-denizen-phone-app].
 *
 * - Lazy tools: tapping an app whose script hasn't loaded shows an in-phone
 *   loading screen, kicks the lazy loader, and auto-opens when ready.
 * - Role-gated tools (e.g. tour replays the CEO can't use) hide from the grid
 *   once scripts settle instead of being dead buttons.
 * - Home / Back return to the grid from any app; ✕ / backdrop / Esc close.
 * - Long-press any app (or tap Edit) to rearrange apps, group into folders, and set the
 *   4-slot dock (default: Chat, Voice, Profile, NPC Team). Layout persists in
 *   localStorage (`denizen-phone-layout`).
 * - Escape hatch: load with ?phonemode=0 to restore the legacy bottom dock.
 */
(function () {
  'use strict';

  // ---- Mode gate -----------------------------------------------------------
  let enabled = true;
  try {
    const q = new URLSearchParams(window.location.search).get('phonemode');
    if (q === '0' || q === 'false' || q === 'off') enabled = false;
  } catch (_) {}
  if (!enabled) return;

  const FAB_ID = 'denizen-phone-fab';
  const SHELL_ID = 'denizen-phone-shell';
  const FRAME_ID = 'denizen-phone-frame';
  const SCREEN_ID = 'denizen-phone-screen';
  const STYLE_ID = 'denizen-phone-ui-style';
  const APP_ATTR = 'data-denizen-phone-app';
  const OS_NAME = 'Denizen OS';
  const OS_VERSION = '1.0';

  // Specificity hammer: 4× repeated class (+ the app attribute in panel rules)
  // beats every existing panel rule — the strongest is player-chat's 4-class
  // portrait rule, which is also injected later than this sheet, so a tie
  // would lose. 5 class-levels wins outright regardless of injection order.
  const M = 'html.denizen-phone-mode.denizen-phone-mode.denizen-phone-mode.denizen-phone-mode';

  const isTouch = () => document.documentElement.classList.contains('denizen-touch');
  const isDesktop = () => !isTouch();

  /** Office Build + scene editor tools — dev, Dolonia host, CEO, or ?editor=1 */
  function isOfficeBuilderAllowed() {
    try {
      const host = String(window.location.hostname || '').toLowerCase();
      const params = new URLSearchParams(window.location.search);
      if (params.has('editor')) return true;
      if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
      if (host === 'denizen.dolonia.cloud' || host.endsWith('.dolonia.cloud')) return true;
      const sess = globalThis.DenizenVisitorSession;
      if (sess?.isCeoPrincipal?.()) return true;
    } catch (_) {}
    return false;
  }

  // ---- App registry --------------------------------------------------------
  // type 'panel'    : opens an existing floating panel, constrained to the screen
  // type 'action'   : proxies a toggle chip; stays on the grid with live state
  // type 'launch'   : closes the phone, then triggers (tours / full-screen guides)
  // type 'internal' : renders its own screen inside the phone (Settings / Office Guide)
  // type 'navigate' : leave the phone and open a full Denizen page (CRM at /crm/)
  // c: [light, dark] icon tile gradient; dock placement comes from saved home layout
  const APPS = [
    { id: 'chat', tabler: 'messages', icon: '💬', label: 'Chat', type: 'panel', trigger: '#player-chat-fab', panel: '#player-chat-panel',
      c: ['#60a5fa', '#1d4ed8'],
      open: () => window.__DenizenPlayerChat?.open?.(), close: () => window.__DenizenPlayerChat?.close?.() },
    { id: 'voice', tabler: 'microphone', icon: '🎤', label: 'Voice', type: 'action', trigger: '#denizen-mic-button',
      c: ['#f87171', '#b91c1c'],
      toastOn: 'Microphone toggled', stateDot: () => null },
    { id: 'presence', tabler: 'user', icon: '👤', label: 'Walk-up', type: 'action', trigger: '#denizen-presence-chip',
      c: ['#fbbf24', '#b45309'],
      stateDot: () => !!window.DenizenPresence?.zionPresent,
      stateText: () => (window.DenizenPresence?.zionPresent ? 'voice on' : 'voice off') },
    { id: 'listen', tabler: 'volume', icon: '🔊', label: 'Listen-in', type: 'action', trigger: '#denizen-audio-mode-chip',
      c: ['#a78bfa', '#6d28d9'],
      stateText: () => {
        const m = document.getElementById('denizen-audio-mode-chip')?.dataset?.mode;
        return m === 'focus' ? 'focus' : m === 'mute-all' ? 'muted' : m ? 'listen-in' : '';
      },
      stateDot: () => {
        const m = document.getElementById('denizen-audio-mode-chip')?.dataset?.mode;
        return m ? m !== 'mute-all' : null;
      } },
    { id: 'health', tabler: 'stethoscope', icon: '🩺', label: 'Health', type: 'panel', trigger: '#denizen-diag-chip', panel: '#denizen-diag-panel',
      c: ['#34d399', '#047857'],
      open: () => window.DenizenDiag?.show?.(), close: () => window.DenizenDiag?.hide?.() },
    { id: 'lm', tabler: 'chart-dots', icon: '📊', label: 'LM Stats', type: 'panel', trigger: '#denizen-llm-tel-chip', panel: '#denizen-llm-tel-panel',
      c: ['#22d3ee', '#0e7490'] },
    { id: 'mesh', tabler: 'hexagon', icon: '⬡', label: 'Power Grid', type: 'panel', trigger: '#denizen-mesh-jobs-chip', panel: '#denizen-mesh-jobs-panel',
      c: ['#818cf8', '#3730a3'], badgeFrom: '#denizen-mesh-jobs-chip' },
    { id: 'approvals', tabler: 'clipboard-list', icon: '📋', label: 'Approvals', type: 'panel', trigger: '#denizen-proposals-chip', panel: '#denizen-proposals-panel',
      c: ['#fb923c', '#c2410c'], badgeFrom: '#denizen-proposals-chip',
      open: () => window.DenizenProposals?.show?.(),
      close: () => window.DenizenProposals?.hide?.(),
      available: () => {
        const sess = globalThis.DenizenVisitorSession;
        if (!sess?.getSessionId?.()) return false;
        if (sess.isCeoPrincipal?.() || sess.getProfile?.()?.canApproveSkills) return true;
        return !!sess.getIdentityId?.();
      } },
    { id: 'newsroom', tabler: 'news', icon: '📰', label: 'Newsroom', type: 'panel', trigger: '#denizen-content-pipeline-chip', panel: '#denizen-content-pipeline-panel',
      c: ['#f97316', '#c2410c'], badgeFrom: '#denizen-content-pipeline-chip', available: () => true },
    { id: 'npcteam', tabler: 'building', icon: '🏢', label: 'Office Team', type: 'panel', panel: '#denizen-npc-team-panel',
      c: ['#f472b6', '#9d174d'],
      open: () => window.DenizenVisitorNpcTeamUI?.show?.(), close: () => window.DenizenVisitorNpcTeamUI?.hide?.(),
      available: () => true },
    { id: 'workflow', tabler: 'tools', icon: '🛠️', label: 'Office Build', type: 'internal', c: ['#e94560', '#9f1239'],
      available: () => isOfficeBuilderAllowed() },
    { id: 'browser', tabler: 'world-www', icon: '🌐', label: 'Browser', type: 'panel', trigger: '#denizen-browser-mirror-chip', panel: '#denizen-browser-mirror-panel',
      c: ['#38bdf8', '#0369a1'],
      available: () => true,
      open: () => { ensureBrowserMirrorReady().catch(() => {}); },
      close: () => window.DenizenBrowserMirror?.hide?.() },
    { id: 'security', tabler: 'shield', icon: '🛡️', label: 'Security', type: 'panel', trigger: '#denizen-security-chip', panel: '#denizen-security-feed',
      c: ['#f87171', '#7f1d1d'] },
    { id: 'profile', tabler: 'id-badge-2', icon: '🪪', label: 'Citizen ID', type: 'special-profile', c: ['#2dd4bf', '#0f766e'] },
    { id: 'station', tabler: 'device-desktop', icon: '🖥️', label: 'Link Station', type: 'internal', c: ['#4ade80', '#15803d'],
      stateDot: () => {
        const st = globalThis.DenizenNodeUI?.getState?.();
        if (!st?.sessionReady) return null;
        if (st.desktopLinked) return true;
        if (st.needsDesktopPairing || st.needsDesktopDownload) return false;
        return null;
      },
      stateText: () => {
        const st = globalThis.DenizenNodeUI?.getState?.();
        if (!st?.sessionReady) return '';
        if (st.desktopLinked) return 'linked';
        if (st.needsDesktopPairing || st.needsDesktopDownload) return 'not linked';
        return '';
      } },
    { id: 'compute', tabler: 'bolt', icon: '💠', label: 'City Power', type: 'special-compute', c: ['#c084fc', '#7e22ce'] },
    { id: 'tour', tabler: 'book', icon: '📖', label: 'Office Tour', type: 'launch', trigger: '#denizen-onboarding-replay-chip',
      c: ['#67e8f9', '#155e75'], gated: true },
    { id: 'meshtour', tabler: 'map', icon: '🗺️', label: 'Power Tour', type: 'launch', trigger: '#denizen-superuser-replay-chip',
      c: ['#a3e635', '#3f6212'], gated: true },
    { id: 'guide', tabler: 'compass', icon: '🧭', label: 'Office Guide', type: 'internal',
      c: ['#facc15', '#854d0e'], gated: true },
    { id: 'crm', tabler: 'address-book', icon: '📇', label: 'CRM', type: 'navigate', url: '/crm/', c: ['#f0b429', '#b45309'],
      available: () => true },
    { id: 'market', tabler: 'chart-line', icon: '📈', label: 'Roki Market', type: 'panel', panel: '#denizen-market-panel',
      c: ['#34d399', '#047857'],
      open: () => window.DenizenMarketPanel?.show?.(), close: () => window.DenizenMarketPanel?.hide?.(),
      available: () => true },
    { id: 'settings', tabler: 'settings', icon: '⚙️', label: 'Settings', type: 'internal', c: ['#94a3b8', '#334155'] },
  ];

  function appIconMarkup(app, size = 26) {
    const T = globalThis.DenizenTablerIcons;
    const name = app?.tabler;
    if (T?.icon && name) {
      T.ensureStyles?.();
      return T.icon(name, { size: Math.round(size * 0.78), className: 'dzp-ti' });
    }
    return app?.icon || '';
  }

  function paintPhoneFab() {
    if (!fabEl) return;
    const badge = fabEl.querySelector('.dzp-fab-badge');
    const badgeHtml = badge ? badge.outerHTML : '<span class="dzp-fab-badge"></span>';
    const T = globalThis.DenizenTablerIcons;
    const glyph = T?.icon
      ? T.icon('device-mobile', { size: 24, className: 'dzp-fab-ti' })
      : '📱';
    fabEl.innerHTML = `${glyph}${badgeHtml}`;
  }

  function repaintAppIcons() {
    if (!shellEl) return;
    shellEl.querySelectorAll('.dzp-app[data-app]').forEach((btn) => {
      const app = appById[btn.dataset.app];
      const el = btn.querySelector('.dzp-app-icon');
      if (app && el) el.innerHTML = appIconMarkup(app);
    });
    shellEl.querySelectorAll('.dzp-folder[data-folder]').forEach((btn) => {
      const folder = phoneLayout.folders[btn.dataset.folder];
      if (!folder) return;
      const previews = folder.apps.map((id) => appById[id]).filter(Boolean).slice(0, 4);
      const wrap = btn.querySelector('.dzp-folder-icons');
      if (!wrap) return;
      wrap.innerHTML = previews.map((a) =>
        `<span style="--tile-a:${a.c[0]};--tile-b:${a.c[1]}">${appIconMarkup(a, 18)}</span>`,
      ).join('');
    });
    paintPhoneFab();
  }

  // Panel ids that get geometry overrides (per app id)
  const PANEL_FOR_APP = {
    chat: '#player-chat-panel',
    health: '#denizen-diag-panel',
    lm: '#denizen-llm-tel-panel',
    mesh: '#denizen-mesh-jobs-panel',
    approvals: '#denizen-proposals-panel',
    newsroom: '#denizen-content-pipeline-panel',
    npcteam: '#denizen-npc-team-panel',
    browser: '#denizen-browser-mirror-panel',
    security: '#denizen-security-feed',
    profile: '#denizen-account-panel',
    compute: '#denizen-node-ui-chip',
    market: '#denizen-market-panel',
  };

  const LAYOUT_STORAGE_KEY = 'denizen-phone-layout';
  const OFFICE_GUIDE_STORAGE_KEY = 'denizen-office-guide-progress-v1';
  const MAX_DOCK_APPS = 4;
  const DEFAULT_DOCK_IDS = ['chat', 'voice', 'workflow', 'profile'];
  const FOLDER_PREFIX = 'folder:';
  const OFFICE_GUIDE_STEPS = [
    {
      id: 'phone',
      tag: 'START',
      title: 'Phone is the key',
      body: 'Your phone carries chat, Citizen ID, your assistant, City Power, and every next step. It keeps your place connected when you come back.',
      action: 'Open Citizen ID',
      act: 'profile',
    },
    {
      id: 'assistant',
      tag: 'TEAM',
      title: 'Claim your assistant',
      body: 'Meet someone in the office, claim them, and make them your familiar home base for real work and follow-up.',
      action: 'Open chat',
      act: 'chat',
    },
    {
      id: 'firm',
      tag: 'OFFICE',
      title: 'Build your office firm',
      body: 'Start with one useful task. The office gives the work a visible place: desks, teammates, handoffs, accepted connections, status, and memory.',
      action: 'Open Office Team',
      act: 'npcteam',
    },
    {
      id: 'station',
      tag: 'STATION',
      title: 'Claim this machine',
      body: 'Open Link Station on your phone to connect Denizen Desktop. You choose its permissions and when it helps.',
      action: 'Open Link Station',
      act: 'station',
    },
    {
      id: 'city',
      tag: 'CITY NEXT',
      title: 'Power the city',
      body: 'Once your office station is ready, idle capacity can help shared city work and earn credits. The city is the next level your office powers.',
      action: 'Power Tour',
      act: 'meshtour',
    },
  ];

  const appById = Object.fromEntries(APPS.map((a) => [a.id, a]));

  function defaultPhoneLayout() {
    const dockSet = new Set(DEFAULT_DOCK_IDS);
    return {
      v: 1,
      dock: [...DEFAULT_DOCK_IDS],
      grid: APPS.map((a) => a.id).filter((id) => !dockSet.has(id)),
      folders: {},
    };
  }

  function knownAppIds() {
    return APPS.map((a) => a.id);
  }

  function isFolderRef(ref) {
    return typeof ref === 'string' && ref.startsWith(FOLDER_PREFIX);
  }

  function folderKeyFromRef(ref) {
    return ref.slice(FOLDER_PREFIX.length);
  }

  function folderRef(key) {
    return `${FOLDER_PREFIX}${key}`;
  }

  function collectPlacedIds(layout) {
    const placed = new Set(layout.dock || []);
    for (const ref of layout.grid || []) {
      if (isFolderRef(ref)) {
        const f = layout.folders?.[folderKeyFromRef(ref)];
        (f?.apps || []).forEach((id) => placed.add(id));
      } else {
        placed.add(ref);
      }
    }
    return placed;
  }

  function normalizePhoneLayout(raw) {
    const base = defaultPhoneLayout();
    if (!raw || typeof raw !== 'object') return base;
    const known = new Set(knownAppIds());
    const folders = {};
    if (raw.folders && typeof raw.folders === 'object') {
      for (const [key, folder] of Object.entries(raw.folders)) {
        if (!folder || !Array.isArray(folder.apps)) continue;
        const apps = folder.apps.filter((id) => known.has(id));
        if (apps.length) {
          folders[key] = {
            name: String(folder.name || 'Folder').slice(0, 24),
            apps,
          };
        }
      }
    }

    const dock = (Array.isArray(raw.dock) ? raw.dock : base.dock)
      .filter((id) => known.has(id) && !isFolderRef(id))
      .slice(0, MAX_DOCK_APPS);

    const placed = new Set(dock);
    const grid = [];
    const pushGrid = (ref) => {
      if (isFolderRef(ref)) {
        const key = folderKeyFromRef(ref);
        if (!folders[key] || placed.has(ref)) return;
        folders[key].apps.forEach((id) => placed.add(id));
        placed.add(ref);
        grid.push(folderRef(key));
        return;
      }
      if (!known.has(ref) || placed.has(ref)) return;
      placed.add(ref);
      grid.push(ref);
    };

    if (Array.isArray(raw.grid)) raw.grid.forEach(pushGrid);
    for (const id of known) {
      if (!placed.has(id)) pushGrid(id);
    }

    return {
      v: 1,
      dock: dock.length ? dock : [...base.dock],
      grid,
      folders,
    };
  }

  function readPhoneLayout() {
    try {
      const raw = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || 'null');
      return normalizePhoneLayout(raw);
    } catch (_) {
      return defaultPhoneLayout();
    }
  }

  function writePhoneLayout(layout) {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch (_) {}
  }

  function newFolderKey() {
    return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  }

  let phoneLayout = readPhoneLayout();
  let editMode = false;
  let openFolderKey = null;
  let editBarEl = null;
  let folderSheetEl = null;
  let dragState = null;
  let longPressTimer = null;
  const tapSuppressUntil = new WeakMap();

  let shellEl = null;
  let screenEl = null;
  let gridEl = null;
  let dockEl = null;
  let homeScrEl = null;
  let appbarEl = null;
  let appbarTitleEl = null;
  let clockEl = null;
  let widgetTimeEl = null;
  let widgetDateEl = null;
  let widgetHelloEl = null;
  let batteryEl = null;
  let toastEl = null;
  let fabEl = null;
  let settingsEl = null;
  let officeGuideActiveId = OFFICE_GUIDE_STEPS[0]?.id || null;
  let pressFn = null;
  let currentApp = null;
  let clockTimer = null;
  let appWatchTimer = null;
  let statusTimer = null;
  let toastTimer = null;
  let loadingToken = 0;
  let screenObs = null;
  let scriptsSettled = false;
  let batteryState = { level: 0.87, charging: false };
  // Back-button trap: while the phone overlay is open we keep one extra history
  // entry on the stack so the browser/hardware Back gesture closes the open app
  // (then the phone) instead of navigating away from the game — which would
  // dump the user back on the login page.
  let phoneBackTrap = false;
  let suppressPhonePop = false;

  function $(sel) { return document.querySelector(sel); }

  function panelVisible(sel) {
    const el = $(sel);
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function chipBadgeCount(sel) {
    const el = $(sel);
    if (!el) return 0;
    const m = `${el.textContent || ''} ${el.title || ''}`.match(/\d+/);
    return m ? Math.min(99, parseInt(m[0], 10)) : 0;
  }

  function appAvailable(app) {
    if (typeof app.available === 'function') return !!app.available();
    if (app.type === 'internal' || app.type === 'navigate' || app.type === 'special-profile' || app.type === 'special-compute') return true;
    if ($(app.trigger) || (app.panel && $(app.panel))) return true;
    // Until lazy scripts settle, assume the tool is still on its way; gated
    // apps (role-dependent chips) hide once we know they're not coming.
    return !scriptsSettled;
  }

  function canUseApprovals() {
    const sess = globalThis.DenizenVisitorSession;
    if (!sess?.getSessionId?.()) return false;
    if (sess.isCeoPrincipal?.() || sess.getProfile?.()?.canApproveSkills) return true;
    return !!sess.getIdentityId?.();
  }

  const BROWSER_MIRROR_SRC = './src/browser-mirror-panel.js?v=lucymirror6';

  function browserMirrorScriptUrl() {
    const tagged = document.querySelector('script[src*="browser-mirror-panel"]');
    if (tagged?.src) return tagged.src;
    return BROWSER_MIRROR_SRC;
  }
  let browserMirrorLoadPromise = null;

  function kickLazyLoad() {
    try { globalThis.DenizenLazyScripts?.loadDeferred?.(); } catch (_) {}
    if (!window.DenizenBrowserMirror) {
      loadBrowserMirrorScript().catch(() => {});
    }
  }

  function loadBrowserMirrorScript() {
    if (window.DenizenBrowserMirror) return Promise.resolve(true);
    if (browserMirrorLoadPromise) return browserMirrorLoadPromise;
    browserMirrorLoadPromise = (async () => {
      try {
        if (globalThis.DenizenLazyScripts?.loadDeferred) {
          await globalThis.DenizenLazyScripts.loadDeferred();
          if (window.DenizenBrowserMirror) return true;
        }
        if (globalThis.DenizenLazyScripts?.load) {
          await globalThis.DenizenLazyScripts.load([BROWSER_MIRROR_SRC]);
          if (window.DenizenBrowserMirror) return true;
        }
      } catch (_) {}
      const existing = document.querySelector('script[src*="browser-mirror-panel"]');
      if (existing && !window.DenizenBrowserMirror) {
        const ok = await waitFor(() => !!window.DenizenBrowserMirror, 12_000);
        if (ok) return true;
      }
      if (!existing) {
        await new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = browserMirrorScriptUrl();
          s.async = true;
          s.onload = () => resolve();
          s.onerror = () => resolve();
          document.head.appendChild(s);
        });
        const ok = await waitFor(() => !!window.DenizenBrowserMirror, 12_000);
        if (ok) return true;
      }
      return !!(document.getElementById('denizen-browser-mirror-panel')
        || document.getElementById('denizen-browser-mirror-chip'));
    })();
    return browserMirrorLoadPromise;
  }

  async function ensureBrowserMirrorReady() {
    const ok = await loadBrowserMirrorScript();
    if (!ok && !window.DenizenBrowserMirror) return false;
    scheduleSyncScreenVars();
    try {
      window.DenizenBrowserMirror?.show?.();
    } catch (_) {}
    scheduleSyncScreenVars();
    return await waitFor(() => {
      const el = document.getElementById('denizen-browser-mirror-panel');
      if (!el || !el.classList.contains('open')) return false;
      const r = el.getBoundingClientRect();
      if (r.width > 8 && r.height > 8) return true;
      return document.documentElement.getAttribute('data-denizen-phone-app') === 'browser';
    }, 12_000);
  }

  function waitFor(test, timeoutMs, stepMs = 250) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (test()) return resolve(true);
        if (Date.now() - t0 >= timeoutMs) return resolve(false);
        setTimeout(tick, stepMs);
      };
      tick();
    });
  }

  let meShellEl = null;
  let meBodyEl = null;
  let meSubtitleEl = null;
  let meTab = 'profile';
  const mePanelHomes = {};

  function rememberMePanel(id) {
    const el = document.getElementById(id);
    if (!el || !meBodyEl || meBodyEl.contains(el)) return;
    mePanelHomes[id] = { parent: el.parentElement, nextSibling: el.nextSibling };
    el.dataset.dzpDocked = '1';
    meBodyEl.appendChild(el);
  }

  function restoreMePanel(id) {
    const el = document.getElementById(id);
    const home = mePanelHomes[id];
    if (!el) return;
    delete el.dataset.dzpDocked;
    if (!home?.parent) return;
    const { parent, nextSibling } = home;
    if (nextSibling && nextSibling.parentElement === parent) {
      parent.insertBefore(el, nextSibling);
    } else {
      parent.appendChild(el);
    }
    delete mePanelHomes[id];
  }

  function dockMePanels() {
    if (isTouch() || !meBodyEl) return;
    rememberMePanel('denizen-account-panel');
    rememberMePanel('denizen-node-ui-chip');
  }

  function undockMePanels() {
    restoreMePanel('denizen-node-ui-chip');
    restoreMePanel('denizen-account-panel');
  }

  function updateMeSubtitle() {
    if (!meSubtitleEl) return;
    const sess = globalThis.DenizenVisitorSession;
    const profile = sess?.getProfile?.() || {};
    const name = profile.displayName || sess?.getDisplayName?.() || 'Guest';
    const credits = globalThis.DenizenNodeUI?.getState?.()?.credits;
    const creditsLabel = Number.isFinite(credits) ? ` · ${Math.round(credits)} credits` : '';
    meSubtitleEl.textContent = `${name}${creditsLabel}`;
  }

  function setMeTab(tab) {
    meTab = tab === 'compute' ? 'compute' : 'profile';
    if (meShellEl) meShellEl.dataset.tab = meTab;
    meShellEl?.querySelectorAll('.dzp-me-tab').forEach((btn) => {
      const on = btn.dataset.tab === meTab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (meBodyEl) meBodyEl.scrollTop = 0;
  }

  function closeMeShell() {
    undockMePanels();
    meShellEl?.classList.remove('open');
    meShellEl?.setAttribute('aria-hidden', 'true');
    shellEl?.querySelector(`#${FRAME_ID}`)?.classList.remove('dzp-me-open');
  }

  function openMeInPhone(tab) {
    buildShell();
    setAppOpenUi({
      id: 'me',
      tabler: tab === 'compute' ? 'bolt' : 'id-badge-2',
      icon: tab === 'compute' ? '💠' : '🪪',
      label: tab === 'compute' ? 'City Power' : 'Citizen ID',
      type: 'special-me',
    });
    shellEl.querySelector(`#${FRAME_ID}`).classList.add('dzp-me-open');
    meShellEl.classList.add('open');
    meShellEl.setAttribute('aria-hidden', 'false');
    setMeTab(tab);
    dockMePanels();
    globalThis.DenizenNodeUI?.showPanel?.({ persist: false });
    globalThis.DenizenAccountPanel?.expandForPhone?.();
    globalThis.DenizenAccountPanel?.renderProfile?.();
    globalThis.DenizenNodeUI?.expandForDrawer?.();
    updateMeSubtitle();
    requestAnimationFrame(scheduleSyncScreenVars);
    if (!$('#denizen-account-panel')) showPlaceholder('Profile is still loading — hang tight.');
  }

  function dockProfilePanel() {
    dockMePanels();
  }

  function undockProfilePanel() {
    undockMePanels();
  }

  // ---- Styles --------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const geometry = `
        position: fixed !important;
        top: var(--dzp-screen-top, 20vh) !important;
        left: var(--dzp-screen-left, 30vw) !important;
        width: var(--dzp-screen-w, 340px) !important;
        height: var(--dzp-screen-h, 500px) !important;
        right: auto !important;
        bottom: auto !important;
        max-width: none !important;
        max-height: none !important;
        min-width: 0 !important;
        min-height: 0 !important;
        margin: 0 !important;
        transform: none !important;
        border-radius: 18px !important;
        box-sizing: border-box !important;
        z-index: 2147483520 !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        overflow: auto;
    `;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      /* The dock and standalone HUD cards retire in phone mode */
      ${M} #denizen-bottom-dock { display: none !important; }
      ${M}.denizen-desktop #denizen-account-panel,
      ${M}.denizen-desktop #denizen-node-ui-chip,
      ${M}.denizen-desktop #denizen-node-ui-restore,
      ${M}.denizen-desktop #denizen-visitor-credits-chip { display: none !important; }

      /* ---- FAB: a tiny phone with a lit screen ---- */
      #${FAB_ID} {
        position: fixed;
        right: max(14px, env(safe-area-inset-right, 0px));
        bottom: max(14px, env(safe-area-inset-bottom, 0px));
        z-index: 2147483490;
        width: 54px;
        height: 64px;
        border-radius: 14px;
        border: 2px solid #475569;
        background:
          linear-gradient(160deg, rgba(125, 211, 252, 0.16), rgba(2, 6, 23, 0) 55%),
          linear-gradient(180deg, #1e293b, #020617 80%);
        color: #e2e8f0;
        font-size: 22px;
        line-height: 1;
        cursor: pointer;
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55), inset 0 0 0 3px #020617;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), border-color 0.2s ease;
      }
      #${FAB_ID} .dzp-fab-ti {
        color: #7dd3fc;
        filter: drop-shadow(0 1px 3px rgba(2, 6, 23, 0.55));
      }
      #${FAB_ID}::after {
        content: '';
        position: absolute;
        left: 50%;
        bottom: 5px;
        width: 16px;
        height: 3px;
        border-radius: 2px;
        background: #475569;
        transform: translateX(-50%);
      }
      @media (hover: hover) and (pointer: fine) {
        #${FAB_ID}:hover { transform: scale(1.06); border-color: #60a5fa; }
      }
      #${FAB_ID}.denizen-press-active,
      #${FAB_ID}:active {
        transform: scale(0.94);
        border-color: #60a5fa;
      }
      #${FAB_ID}.active { border-color: #4ade80; }
      #${FAB_ID} .dzp-fab-badge {
        position: absolute;
        top: -5px;
        right: -5px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ef4444;
        border: 2px solid #020617;
        display: none;
      }
      #${FAB_ID}.has-badge .dzp-fab-badge { display: block; }

      #${SHELL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483496;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.55);
        backdrop-filter: blur(2px);
      }
      #${SHELL_ID}.open { display: flex; }

      /* ---- Hardware: body, side buttons, antenna lines, glass ---- */
      #${FRAME_ID} {
        position: relative;
        display: flex;
        flex-direction: column;
        width: min(390px, calc(100vw - 36px));
        height: min(760px, calc(100dvh - 36px));
        max-height: calc(100dvh - 20px);
        min-height: 0;
        background: linear-gradient(165deg, #1a2334, #0b1220 40%, #060b16);
        border: 1px solid #46556e;
        border-radius: 34px;
        box-shadow:
          0 30px 80px rgba(0, 0, 0, 0.78),
          inset 0 0 0 3px #18202f,
          inset 0 0 0 5px #020617;
        overflow: visible;
      }
      /* Laptop / desktop / tablet phone mode: fit viewport, pin nav to chin */
      html.denizen-phone-mode #${FRAME_ID} {
        width: min(400px, calc(100vw - 48px));
        height: min(720px, calc(100dvh - 24px));
        max-height: calc(100dvh - 24px);
      }
      html.denizen-desktop.denizen-phone-mode #${FRAME_ID} {
        width: min(440px, calc(100vw - 72px));
        height: min(860px, calc(100dvh - 72px));
        max-height: calc(100dvh - 24px);
      }
      @media (max-height: 820px) {
        html.denizen-phone-mode #${FRAME_ID} {
          height: min(calc(100dvh - 24px), 720px);
          width: min(400px, calc(100vw - 48px));
          max-height: calc(100dvh - 16px);
        }
      }
      @media (max-height: 700px) {
        html.denizen-phone-mode #${FRAME_ID} {
          height: calc(100dvh - 16px);
          width: min(380px, calc(100vw - 32px));
          max-height: calc(100dvh - 12px);
        }
      }
      @media (max-width: 520px) {
        html.denizen-phone-mode #${FRAME_ID} {
          width: calc(100vw - 32px);
        }
      }
      html.denizen-touch.denizen-phone #${FRAME_ID} {
        width: calc(100dvw - 14px);
        height: calc(100dvh - 14px);
        border-radius: 22px;
      }
      @keyframes dzp-pop-in {
        from { transform: scale(0.92); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      @media (prefers-reduced-motion: no-preference) {
        #${SHELL_ID}.open #${FRAME_ID} { animation: dzp-pop-in 0.22s ease; }
      }
      @media (prefers-reduced-motion: reduce) {
        #${FRAME_ID} .dzp-app .dzp-app-icon,
        #${FRAME_ID} .dzp-nav button,
        #${FRAME_ID} .dzp-appbar .dzp-back,
        #${FAB_ID} { transition: none; }
      }
      /* side buttons */
      #${FRAME_ID} .dzp-hw {
        position: absolute;
        background: linear-gradient(90deg, #2c3a52, #131b2c);
        border-radius: 3px;
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
      }
      #${FRAME_ID} .dzp-hw.power { right: -4px; top: 158px; width: 4px; height: 64px; }
      #${FRAME_ID} .dzp-hw.vol-up { left: -4px; top: 128px; width: 4px; height: 44px; }
      #${FRAME_ID} .dzp-hw.vol-down { left: -4px; top: 180px; width: 4px; height: 44px; }
      /* antenna lines */
      #${FRAME_ID}::before, #${FRAME_ID}::after {
        content: '';
        position: absolute;
        width: 26px;
        height: 1px;
        background: rgba(148, 163, 184, 0.4);
        pointer-events: none;
      }
      #${FRAME_ID}::before { top: 56px; left: -1px; transform: rotate(90deg); transform-origin: left; }
      #${FRAME_ID}::after { bottom: 56px; right: -1px; transform: rotate(90deg); transform-origin: right; }
      /* glass reflection */
      #${FRAME_ID} .dzp-glass {
        position: absolute;
        inset: 5px;
        border-radius: 30px;
        pointer-events: none;
        z-index: 5;
        background: linear-gradient(118deg, rgba(255, 255, 255, 0.045) 0%, rgba(255, 255, 255, 0.015) 28%, transparent 42%);
      }

      /* ---- Status bar: clock / punch-hole camera / signal+wifi+battery ---- */
      #${FRAME_ID} .dzp-statusbar {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 22px 6px;
        color: #cbd5e1;
        font: 600 12px/1.2 system-ui, sans-serif;
        letter-spacing: 0.04em;
        flex: 0 0 auto;
        user-select: none;
        z-index: 2;
      }
      #${FRAME_ID} .dzp-cam {
        position: absolute;
        left: 50%;
        top: 11px;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 7px;
      }
      #${FRAME_ID} .dzp-cam .lens {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #2f436b 18%, #060b16 60%);
        box-shadow: inset 0 0 2px 1px #000, 0 0 0 2px #0b1220;
      }
      #${FRAME_ID} .dzp-cam .speaker {
        width: 38px;
        height: 4px;
        border-radius: 3px;
        background: repeating-linear-gradient(90deg, #1f2c44 0 2px, #0a111f 2px 4px);
        box-shadow: inset 0 0 2px #000;
      }
      #${FRAME_ID} .dzp-status-right { display: flex; align-items: center; gap: 7px; }
      #${FRAME_ID} .dzp-signal { display: inline-flex; align-items: flex-end; gap: 1.5px; height: 10px; }
      #${FRAME_ID} .dzp-signal i { width: 3px; border-radius: 1px; background: #cbd5e1; }
      #${FRAME_ID} .dzp-signal i:nth-child(1) { height: 4px; }
      #${FRAME_ID} .dzp-signal i:nth-child(2) { height: 6px; }
      #${FRAME_ID} .dzp-signal i:nth-child(3) { height: 8px; }
      #${FRAME_ID} .dzp-signal i:nth-child(4) { height: 10px; opacity: 0.45; }
      #${FRAME_ID} .dzp-carrier { font-size: 9px; letter-spacing: 0.12em; color: #94a3b8; }
      #${FRAME_ID} .dzp-batt {
        position: relative;
        width: 24px;
        height: 11px;
        border: 1px solid #94a3b8;
        border-radius: 3px;
        display: inline-flex;
        align-items: center;
      }
      #${FRAME_ID} .dzp-batt::after {
        content: '';
        position: absolute;
        right: -3.5px;
        top: 2.5px;
        width: 2px;
        height: 4px;
        border-radius: 0 1px 1px 0;
        background: #94a3b8;
      }
      #${FRAME_ID} .dzp-batt .fill {
        position: absolute;
        left: 1px;
        top: 1px;
        bottom: 1px;
        border-radius: 1.5px;
        background: #4ade80;
        max-width: calc(100% - 2px);
      }
      #${FRAME_ID} .dzp-batt.low .fill { background: #f87171; }
      #${FRAME_ID} .dzp-batt.charging .fill { background: #facc15; }
      #${FRAME_ID} .dzp-batt-pct { font-size: 10px; color: #94a3b8; }

      /* ---- App title bar (between status bar and screen, app open only) ---- */
      #${FRAME_ID} .dzp-appbar {
        display: none;
        align-items: center;
        gap: 8px;
        padding: 4px 14px 6px;
        flex: 0 0 auto;
        z-index: 2;
      }
      #${FRAME_ID}.dzp-app-open .dzp-appbar { display: flex; }
      #${FRAME_ID} .dzp-appbar .dzp-back {
        border: none;
        background: rgba(148, 163, 184, 0.12);
        color: #cbd5e1;
        border-radius: 999px;
        cursor: pointer;
        font: 600 13px/1 system-ui, sans-serif;
        padding: 6px 12px;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        transition: transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94), background 0.18s ease, color 0.18s ease;
      }
      @media (hover: hover) and (pointer: fine) {
        #${FRAME_ID} .dzp-appbar .dzp-back:hover { background: rgba(148, 163, 184, 0.22); color: #f1f5f9; }
      }
      #${FRAME_ID} .dzp-appbar .dzp-back.denizen-press-active,
      #${FRAME_ID} .dzp-appbar .dzp-back:active {
        transform: scale(0.96);
        background: rgba(148, 163, 184, 0.28);
        color: #f1f5f9;
      }
      #${FRAME_ID} .dzp-appbar-title {
        color: #e2e8f0;
        font: 600 13px/1.2 system-ui, sans-serif;
        letter-spacing: 0.02em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ---- Screen ---- */
      #${SCREEN_ID} {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        margin: 2px 10px;
        border-radius: 18px;
        background: #050a14;
        border: 1px solid #16203355;
        overflow: hidden;
      }

      /* boot splash */
      #${FRAME_ID} .dzp-boot {
        position: absolute;
        inset: 0;
        z-index: 4;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        background: #02050c;
        color: #7dd3fc;
        transition: opacity 0.3s ease;
      }
      #${FRAME_ID} .dzp-boot .hex { font-size: 44px; line-height: 1; animation: dzp-boot-pulse 0.9s ease infinite alternate; }
      #${FRAME_ID} .dzp-boot .name { font: 700 15px/1.2 system-ui, sans-serif; letter-spacing: 0.34em; color: #e2e8f0; }
      #${FRAME_ID} .dzp-boot .ver { font: 500 10px/1.2 system-ui, sans-serif; letter-spacing: 0.2em; color: #475569; }
      #${FRAME_ID} .dzp-boot.fading { opacity: 0; }
      #${FRAME_ID} .dzp-boot.done { display: none; }
      @keyframes dzp-boot-pulse { from { opacity: 0.45; } to { opacity: 1; } }

      /* wallpaper home */
      #${FRAME_ID} .dzp-homescr {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        height: 100%;
        min-height: 0;
        background:
          radial-gradient(120% 60% at 50% 108%, rgba(56, 122, 223, 0.28), transparent 60%),
          radial-gradient(80% 40% at 80% -5%, rgba(125, 211, 252, 0.12), transparent 65%),
          repeating-linear-gradient(0deg, transparent 0 23px, rgba(125, 211, 252, 0.035) 23px 24px),
          repeating-linear-gradient(90deg, transparent 0 23px, rgba(125, 211, 252, 0.035) 23px 24px),
          linear-gradient(168deg, #0c1730, #050a14 65%);
      }
      #${FRAME_ID} .dzp-homescr::before {
        content: '⬡';
        position: absolute;
        right: -28px;
        bottom: 36px;
        font-size: 170px;
        line-height: 1;
        color: rgba(125, 211, 252, 0.05);
        pointer-events: none;
      }
      #${FRAME_ID}.dzp-app-open .dzp-homescr { display: none; }

      #${FRAME_ID} .dzp-widget {
        grid-row: 1;
        flex: 0 0 auto;
        padding: 20px 20px 6px;
        user-select: none;
        text-shadow: 0 2px 12px rgba(2, 6, 23, 0.8);
      }
      #${FRAME_ID} .dzp-widget .t { color: #f1f5f9; font: 300 44px/1 system-ui, sans-serif; letter-spacing: 0.01em; }
      #${FRAME_ID} .dzp-widget .d { color: #94a3b8; font: 500 12px/1.6 system-ui, sans-serif; }
      #${FRAME_ID} .dzp-widget .g { color: #7dd3fc; font: 600 11px/1.6 system-ui, sans-serif; letter-spacing: 0.06em; }

      #${FRAME_ID} .dzp-grid {
        grid-row: 2;
        min-height: 0;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        align-content: start;
        gap: 16px 6px;
        padding: 14px 12px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }

      /* favorites dock — row 3 = bottom of home screen (above gesture nav) */
      #${FRAME_ID} .dzp-dock {
        grid-row: 3;
        flex: 0 0 auto;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        margin: 6px 10px 10px;
        padding: 10px 6px 6px;
        border-radius: 22px;
        background: rgba(148, 163, 184, 0.09);
        backdrop-filter: blur(6px);
        border: 1px solid rgba(148, 163, 184, 0.12);
      }
      #${FRAME_ID} .dzp-dock .dzp-app-label { display: none; }
      #${FRAME_ID} .dzp-dock .dzp-app-status { display: none; }
      /* Hover / focus name chip — dock icons alone are not enough */
      #${FRAME_ID} .dzp-dock .dzp-app,
      #${FRAME_ID} .dzp-dock .dzp-folder {
        position: relative;
      }
      #${FRAME_ID} .dzp-dock .dzp-app::after,
      #${FRAME_ID} .dzp-dock .dzp-folder::after {
        content: attr(data-label);
        position: absolute;
        left: 50%;
        bottom: calc(100% + 6px);
        transform: translateX(-50%) translateY(4px);
        padding: 5px 9px;
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.96);
        border: 1px solid rgba(148, 163, 184, 0.35);
        color: #f8fafc;
        font: 650 11px/1.2 system-ui, sans-serif;
        white-space: nowrap;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        opacity: 0;
        pointer-events: none;
        z-index: 40;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
        transition: opacity 0.12s ease, transform 0.12s ease;
      }
      #${FRAME_ID} .dzp-dock .dzp-app:hover::after,
      #${FRAME_ID} .dzp-dock .dzp-app:focus-visible::after,
      #${FRAME_ID} .dzp-dock .dzp-folder:hover::after,
      #${FRAME_ID} .dzp-dock .dzp-folder:focus-visible::after {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      #${FRAME_ID}.dzp-editing .dzp-dock .dzp-app::after,
      #${FRAME_ID}.dzp-editing .dzp-dock .dzp-folder::after {
        display: none;
      }
      #${FRAME_ID} .dzp-dock .dzp-slot-empty {
        min-height: 56px;
        border-radius: 17px;
        border: 1.5px dashed rgba(148, 163, 184, 0.22);
        background: rgba(15, 23, 42, 0.35);
      }

      #${FRAME_ID} .dzp-edit-bar {
        display: none;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 14px 4px;
        color: #e2e8f0;
        font: 600 12px/1.2 system-ui, sans-serif;
      }
      #${FRAME_ID} .dzp-edit-bar .hint { color: #94a3b8; font-weight: 500; font-size: 10px; }
      #${FRAME_ID} .dzp-edit-bar button {
        border: none;
        border-radius: 999px;
        padding: 6px 14px;
        background: #38bdf8;
        color: #0f172a;
        font: 700 11px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      #${FRAME_ID} .dzp-homescr.dzp-editing .dzp-edit-bar { display: flex; }
      #${FRAME_ID} .dzp-homescr.dzp-editing .dzp-edit-enter { display: none; }
      #${FRAME_ID} .dzp-homescr.dzp-editing .dzp-widget { opacity: 0.45; }
      #${FRAME_ID} .dzp-edit-enter {
        position: absolute;
        top: 8px;
        right: 10px;
        z-index: 4;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 999px;
        padding: 5px 12px;
        background: rgba(15, 23, 42, 0.82);
        color: #bae6fd;
        font: 700 11px/1 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-backdrop-filter: blur(8px);
        backdrop-filter: blur(8px);
      }
      #${FRAME_ID} .dzp-grid .dzp-slot-empty {
        min-height: 72px;
        border-radius: 17px;
        border: 1.5px dashed rgba(56, 189, 248, 0.28);
        background: rgba(15, 23, 42, 0.28);
      }
      #${FRAME_ID} .dzp-homescr.dzp-editing .dzp-app.dzp-jiggle .dzp-app-icon {
        animation: dzp-jiggle 0.28s ease-in-out infinite alternate;
      }
      @keyframes dzp-jiggle {
        from { transform: rotate(-1.5deg) scale(1); }
        to { transform: rotate(1.5deg) scale(1.02); }
      }
      #${FRAME_ID} .dzp-app.dzp-dragging { opacity: 0.35; }
      #${FRAME_ID} .dzp-app.dzp-drop-target .dzp-app-icon {
        box-shadow: 0 0 0 2px #38bdf8, 0 4px 12px rgba(0, 0, 0, 0.45);
      }
      #${FRAME_ID} .dzp-drag-ghost {
        position: fixed;
        z-index: 99999;
        pointer-events: none;
        opacity: 0.92;
        transform: translate(-50%, -50%);
      }
      #${FRAME_ID} .dzp-folder .dzp-folder-icons {
        width: 56px;
        height: 56px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px;
        padding: 8px;
        border-radius: 17px;
        background: rgba(148, 163, 184, 0.14);
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.45),
          inset 0 1px 0 rgba(255, 255, 255, 0.12);
      }
      #${FRAME_ID} .dzp-folder .dzp-folder-icons span {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        border-radius: 6px;
        background: linear-gradient(145deg, var(--tile-a, #1e293b), var(--tile-b, #0f172a));
      }
      #${FRAME_ID} .dzp-folder-sheet {
        position: absolute;
        inset: 0;
        z-index: 4;
        display: none;
        flex-direction: column;
        background: rgba(5, 10, 20, 0.72);
        backdrop-filter: blur(10px);
        padding: 16px 12px 12px;
      }
      #${FRAME_ID} .dzp-folder-sheet.open { display: flex; }
      #${FRAME_ID} .dzp-folder-sheet .dzp-folder-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
        color: #f1f5f9;
        font: 600 14px/1.2 system-ui, sans-serif;
      }
      #${FRAME_ID} .dzp-folder-sheet .dzp-folder-grid {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px 6px;
        align-content: start;
        overflow-y: auto;
      }

      /* ---- App icons ---- */
      #${FRAME_ID} .dzp-app {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px 0;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        -webkit-user-select: none;
      }
      #${FRAME_ID} .dzp-app * {
        pointer-events: none;
      }
      #${FRAME_ID} .dzp-app.dzp-hidden { display: none; }
      #${FRAME_ID} .dzp-app-icon .dzp-ti,
      #${FRAME_ID} .dzp-folder-icons .dzp-ti {
        color: rgba(255, 255, 255, 0.96);
        filter: drop-shadow(0 1px 2px rgba(2, 6, 23, 0.45));
      }
      #${FRAME_ID} .dzp-folder-icons .dzp-ti {
        font-size: 14px !important;
      }
      #${FRAME_ID} .dzp-appbar-title .dzp-ti {
        margin-right: 4px;
        vertical-align: -0.2em;
        color: #e2e8f0;
      }
      #${FRAME_ID} .dzp-app .dzp-app-icon {
        position: relative;
        width: 56px;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 26px;
        border-radius: 17px;
        background: linear-gradient(145deg, var(--tile-a, #1e293b), var(--tile-b, #0f172a));
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.45),
          inset 0 1px 0 rgba(255, 255, 255, 0.22),
          inset 0 -2px 6px rgba(0, 0, 0, 0.28);
        transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), filter 0.2s ease, box-shadow 0.2s ease;
      }
      @media (hover: hover) and (pointer: fine) {
        #${FRAME_ID} .dzp-app:hover .dzp-app-icon { transform: scale(1.06); filter: brightness(1.1); }
      }
      #${FRAME_ID} .dzp-app.denizen-press-active .dzp-app-icon,
      #${FRAME_ID} .dzp-app:active .dzp-app-icon {
        transform: scale(0.92);
        filter: brightness(1.14);
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.35),
          inset 0 1px 0 rgba(255, 255, 255, 0.22),
          inset 0 -2px 6px rgba(0, 0, 0, 0.28);
      }
      #${FRAME_ID} .dzp-app .dzp-app-label {
        color: #e2e8f0;
        font: 11px/1.2 system-ui, sans-serif;
        max-width: 76px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-shadow: 0 1px 6px rgba(2, 6, 23, 0.9);
      }
      #${FRAME_ID} .dzp-app .dzp-app-status {
        color: #7dd3fc;
        font: 9px/1.1 system-ui, sans-serif;
        max-width: 76px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-height: 10px;
      }
      #${FRAME_ID} .dzp-app .dzp-badge {
        position: absolute;
        top: -4px;
        right: 4px;
        min-width: 17px;
        height: 17px;
        padding: 0 4px;
        border-radius: 9px;
        background: #ef4444;
        color: #fff;
        font: 700 10px/17px system-ui, sans-serif;
        text-align: center;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
        display: none;
      }
      #${FRAME_ID} .dzp-app.has-badge .dzp-badge { display: block; }
      #${FRAME_ID} .dzp-app .dzp-dot {
        position: absolute;
        top: 0;
        left: 6px;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #475569;
        border: 1.5px solid #050a14;
        display: none;
      }
      #${FRAME_ID} .dzp-app.dot-on .dzp-dot { display: block; background: #4ade80; box-shadow: 0 0 6px rgba(74, 222, 128, 0.8); }
      #${FRAME_ID} .dzp-app.dot-off .dzp-dot { display: block; background: #64748b; }

      /* loading / unavailable screen */
      #${FRAME_ID} .dzp-placeholder {
        position: absolute;
        inset: 0;
        z-index: 3;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        padding: 24px;
        text-align: center;
        color: #94a3b8;
        font: 13px/1.5 system-ui, sans-serif;
        background: linear-gradient(168deg, #0c1730, #050a14 65%);
      }
      #${FRAME_ID} .dzp-placeholder.show { display: flex; }
      #${FRAME_ID} .dzp-placeholder .spin {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 3px solid rgba(125, 211, 252, 0.2);
        border-top-color: #7dd3fc;
        animation: dzp-spin 0.8s linear infinite;
      }
      #${FRAME_ID} .dzp-placeholder.err .spin { display: none; }
      @keyframes dzp-spin { to { transform: rotate(360deg); } }

      /* toast inside the screen */
      #${FRAME_ID} .dzp-toast {
        position: absolute;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%) translateY(6px);
        z-index: 6;
        max-width: 85%;
        padding: 8px 16px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.94);
        border: 1px solid #334155;
        color: #e2e8f0;
        font: 600 11px/1.3 system-ui, sans-serif;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${FRAME_ID} .dzp-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

      /* ---- Settings (native app) ---- */
      #${FRAME_ID} .dzp-settings {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: none;
        flex-direction: column;
        gap: 10px;
        padding: 16px 14px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        background: linear-gradient(168deg, #0c1730, #050a14 65%);
        color: #cbd5e1;
        font: 13px/1.5 system-ui, sans-serif;
      }
      #${FRAME_ID} .dzp-settings.show { display: flex; }
      #${FRAME_ID} .dzp-settings .sec {
        background: rgba(148, 163, 184, 0.07);
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 14px;
        padding: 12px 14px;
      }
      #${FRAME_ID} .dzp-settings .sec h3 {
        margin: 0 0 6px;
        font: 700 11px/1.2 system-ui, sans-serif;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #7dd3fc;
      }
      #${FRAME_ID} .dzp-settings .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 5px 0;
        font-size: 12px;
      }
      #${FRAME_ID} .dzp-settings .row .v { color: #94a3b8; }
      #${FRAME_ID} .dzp-settings button {
        border: 1px solid #334155;
        background: #0f172a;
        color: #cbd5e1;
        border-radius: 10px;
        cursor: pointer;
        font: 600 12px/1.2 system-ui, sans-serif;
        padding: 8px 14px;
        touch-action: manipulation;
      }
      #${FRAME_ID} .dzp-settings button:hover { border-color: #60a5fa; color: #dbeafe; }

      #${FRAME_ID} .dzp-settings.dzp-office-guide {
        gap: 12px;
        background:
          radial-gradient(80% 34% at 18% 0%, rgba(45, 212, 191, 0.16), transparent 62%),
          linear-gradient(168deg, #07141f, #050a14 68%);
      }
      #${FRAME_ID} .dzp-settings.dzp-workflow {
        padding: 0;
        gap: 0;
        overflow: hidden;
        background: #0a0e1a;
      }
      #${FRAME_ID} .dzp-workflow-frame {
        flex: 1;
        width: 100%;
        min-height: 0;
        border: 0;
        background: #0a0e1a;
      }
      #${FRAME_ID} .dzp-office-guide .og-hero {
        border: 1px solid rgba(45, 212, 191, 0.22);
        border-radius: 16px;
        padding: 14px;
        background: rgba(15, 23, 42, 0.52);
      }
      #${FRAME_ID} .dzp-office-guide .og-kicker {
        display: inline-flex;
        margin-bottom: 8px;
        color: #5eead4;
        font: 800 10px/1.2 system-ui, sans-serif;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      #${FRAME_ID} .dzp-office-guide h3 {
        margin: 0 0 8px;
        color: #f8fafc;
        font: 800 19px/1.12 system-ui, sans-serif;
      }
      #${FRAME_ID} .dzp-office-guide p {
        margin: 0;
        color: #b6c4d3;
        font: 12px/1.48 system-ui, sans-serif;
      }
      #${FRAME_ID} .dzp-office-guide .og-progress {
        height: 7px;
        margin-top: 12px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(148, 163, 184, 0.18);
      }
      #${FRAME_ID} .dzp-office-guide .og-progress span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #5eead4, #a3e635);
      }
      #${FRAME_ID} .dzp-office-guide .og-progress-label {
        margin-top: 7px;
        color: #94a3b8;
        font: 700 10px/1.2 system-ui, sans-serif;
      }
      #${FRAME_ID} .dzp-office-guide .og-step-list {
        display: grid;
        gap: 8px;
      }
      #${FRAME_ID} .dzp-office-guide .og-step {
        display: grid;
        grid-template-columns: 24px 1fr auto;
        align-items: center;
        gap: 9px;
        width: 100%;
        text-align: left;
        border: 1px solid rgba(148, 163, 184, 0.14);
        background: rgba(15, 23, 42, 0.56);
        color: #dbeafe;
        border-radius: 12px;
        padding: 10px;
      }
      #${FRAME_ID} .dzp-office-guide .og-step.active {
        border-color: rgba(94, 234, 212, 0.54);
        background: rgba(20, 184, 166, 0.1);
      }
      #${FRAME_ID} .dzp-office-guide .og-check {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.36);
        color: transparent;
        font: 800 12px/1 system-ui, sans-serif;
      }
      #${FRAME_ID} .dzp-office-guide .og-step.done .og-check {
        color: #052e2b;
        border-color: #5eead4;
        background: #5eead4;
      }
      #${FRAME_ID} .dzp-office-guide .og-step-main {
        min-width: 0;
      }
      #${FRAME_ID} .dzp-office-guide .og-step-title {
        display: block;
        color: #f1f5f9;
        font: 800 12px/1.25 system-ui, sans-serif;
      }
      #${FRAME_ID} .dzp-office-guide .og-step-tag {
        display: block;
        margin-top: 3px;
        color: #7dd3fc;
        font: 800 9px/1.2 system-ui, sans-serif;
        letter-spacing: 0.08em;
      }
      #${FRAME_ID} .dzp-office-guide .og-caret {
        color: #64748b;
        font: 800 14px/1 system-ui, sans-serif;
      }
      #${FRAME_ID} .dzp-office-guide .og-detail {
        border: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 16px;
        padding: 14px;
        background: rgba(2, 6, 23, 0.42);
      }
      #${FRAME_ID} .dzp-office-guide .og-detail .og-tag {
        margin-bottom: 8px;
        color: #7dd3fc;
        font: 800 10px/1.2 system-ui, sans-serif;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      #${FRAME_ID} .dzp-office-guide .og-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      #${FRAME_ID} .dzp-office-guide .og-actions button {
        min-height: 38px;
        border-radius: 10px;
        font-size: 11px;
      }
      #${FRAME_ID} .dzp-office-guide .og-actions .primary {
        border-color: rgba(94, 234, 212, 0.48);
        color: #ccfbf1;
        background: rgba(20, 184, 166, 0.14);
      }

      /* ---- Gesture nav: back / home pill / close — pinned to phone chin ---- */
      #${FRAME_ID} .dzp-nav {
        flex: 0 0 auto;
        margin-top: auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 8px 34px max(10px, env(safe-area-inset-bottom, 0px));
      }
      #${FRAME_ID} .dzp-nav button {
        border: none;
        background: none;
        color: #64748b;
        cursor: pointer;
        font: 600 15px/1.2 system-ui, sans-serif;
        padding: 8px 14px;
        min-height: 38px;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        transition: transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94), color 0.18s ease, opacity 0.18s ease;
      }
      @media (hover: hover) and (pointer: fine) {
        #${FRAME_ID} .dzp-nav button:hover { color: #e2e8f0; }
      }
      #${FRAME_ID} .dzp-nav button.denizen-press-active,
      #${FRAME_ID} .dzp-nav button:active {
        transform: scale(0.94);
        color: #e2e8f0;
        opacity: 0.85;
      }
      #${FRAME_ID} .dzp-nav .dzp-home {
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #${FRAME_ID} .dzp-nav .dzp-home::after {
        content: '';
        width: 96px;
        height: 5px;
        border-radius: 3px;
        background: #475569;
        transition: background 0.12s ease;
      }
      #${FRAME_ID} .dzp-nav .dzp-home:hover::after { background: #94a3b8; }

      /* ---- Landscape phone: reclaim vertical space for apps ---- */
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-hw.power {
        top: 50%;
        height: 52px;
        margin-top: -26px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-hw.vol-up {
        top: 50%;
        margin-top: -42px;
        height: 36px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-hw.vol-down {
        top: 50%;
        margin-top: 6px;
        height: 36px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-statusbar {
        padding: 6px 18px 4px;
        font-size: 11px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-appbar {
        padding: 2px 12px 4px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-nav {
        padding: 4px 28px max(6px, env(safe-area-inset-bottom, 0px));
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-nav .dzp-home::after {
        width: 72px;
        height: 4px;
      }
      /* Home: clock already in status bar — use full screen height for apps */
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-homescr {
        display: flex;
        flex-direction: row;
        align-items: stretch;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-widget {
        display: none;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-grid {
        flex: 1 1 auto;
        min-width: 0;
        grid-template-columns: repeat(6, 1fr);
        gap: 10px 6px;
        padding: 10px 8px 10px 12px;
        align-content: start;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-grid .dzp-app .dzp-app-icon {
        width: 48px;
        height: 48px;
        font-size: 22px;
        border-radius: 14px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-grid .dzp-app-label {
        font-size: 9px;
        max-width: 58px;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-dock {
        flex: 0 0 auto;
        width: 56px;
        margin: 8px 10px 8px 0;
        padding: 8px 6px;
        grid-template-columns: 1fr;
        grid-template-rows: repeat(4, auto);
        gap: 8px;
        align-self: center;
      }
      html.denizen-touch.denizen-phone.denizen-landscape #${FRAME_ID} .dzp-dock .dzp-app .dzp-app-icon {
        width: 42px;
        height: 42px;
        font-size: 20px;
        border-radius: 12px;
      }

      html.denizen-phone-open #${FAB_ID},
      html.denizen-chat-open #${FAB_ID} {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      ${M} #player-chat-fab,
      ${M} #denizen-bottom-dock #player-chat-fab,
      ${M} #denizen-proposals-chip {
        display: none !important;
      }

      /* ---- Panel containment: each app's panel renders inside the screen ---- */
      ${Object.entries(PANEL_FOR_APP).filter(([id]) => id !== 'profile' && id !== 'compute').map(([app, sel]) =>
        `${M}[${APP_ATTR}="${app}"] ${sel} { ${geometry} }`
      ).join('\n')}

      /* Me shell — Citizen ID | City Power tabs (matches mobile drawer, inside phone) */
      #${FRAME_ID}.dzp-me-open .dzp-appbar { display: none !important; }
      #${FRAME_ID} .dzp-me-shell {
        display: none;
        position: absolute;
        inset: 0;
        z-index: 3;
        flex-direction: column;
        background: #050a14;
        overflow: hidden;
      }
      #${FRAME_ID} .dzp-me-shell.open {
        display: flex;
      }
      #${FRAME_ID} .dzp-me-head {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px 8px 4px;
      }
      #${FRAME_ID} .dzp-me-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #${FRAME_ID} .dzp-me-tabs {
        flex: 1;
        min-width: 0;
        display: flex;
        gap: 4px;
        padding: 3px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid #1e293b;
      }
      #${FRAME_ID} .dzp-me-tab {
        flex: 1;
        min-height: 36px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: #94a3b8;
        font: 600 12px/1 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${FRAME_ID} .dzp-me-tab.active {
        background: rgba(59, 130, 246, 0.22);
        color: #e2e8f0;
        box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.45);
      }
      #${FRAME_ID} .dzp-me-close {
        flex: 0 0 auto;
        min-width: 36px;
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid #334155;
        background: rgba(15, 23, 42, 0.9);
        color: #e2e8f0;
        font: 600 18px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      #${FRAME_ID} .dzp-me-subtitle {
        color: #94a3b8;
        font: 500 11px/1.3 system-ui, sans-serif;
        padding: 0 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${FRAME_ID} .dzp-me-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0 8px 10px;
      }
      #${FRAME_ID} .dzp-me-shell[data-tab="profile"] .dzp-me-body #denizen-node-ui-chip {
        display: none !important;
      }
      #${FRAME_ID} .dzp-me-shell[data-tab="compute"] .dzp-me-body #denizen-account-panel {
        display: none !important;
      }
      #${FRAME_ID} .dzp-me-body #denizen-account-panel,
      #${FRAME_ID} .dzp-me-body #denizen-node-ui-chip {
        position: static !important;
        top: auto !important;
        right: auto !important;
        left: auto !important;
        bottom: auto !important;
        width: 100% !important;
        min-width: 0 !important;
        max-width: none !important;
        min-height: 0 !important;
        max-height: none !important;
        height: auto !important;
        margin: 0 !important;
        transform: none !important;
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        z-index: auto !important;
        box-shadow: none !important;
        border-radius: 10px !important;
        box-sizing: border-box !important;
        padding: 10px 12px !important;
        font: 14px/1.45 system-ui, sans-serif !important;
        gap: 8px !important;
        flex: 0 0 auto !important;
        overflow: visible !important;
      }
      #${FRAME_ID} .dzp-me-body #denizen-node-ui-chip[data-panel-hidden="1"] {
        display: flex !important;
      }
      #${FRAME_ID} .dzp-me-body #denizen-account-panel .acct-toggle,
      #${FRAME_ID} .dzp-me-body #denizen-node-ui-chip .node-hide-btn,
      #${FRAME_ID} .dzp-me-body #denizen-node-ui-chip .node-contrib-toggle {
        display: none !important;
      }
      #${FRAME_ID} .dzp-me-body #denizen-account-panel #prof-shell {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
        width: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      #${FRAME_ID} .dzp-me-body #denizen-account-panel #prof-shell .prof-panel.active {
        flex: 1 1 auto;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      #${FRAME_ID} .dzp-me-body #denizen-node-ui-chip .node-contrib-body {
        display: grid !important;
        grid-template-columns: 1fr 1fr;
        gap: 4px 10px !important;
      }
      #${FRAME_ID} .dzp-me-body #denizen-node-ui-chip .node-contrib-row:has(#denizen-node-level),
      #${FRAME_ID} .dzp-me-body #denizen-node-ui-chip .node-fleet,
      #${FRAME_ID} .dzp-me-body #denizen-node-ui-chip .node-modes,
      #${FRAME_ID} .dzp-me-body #denizen-node-ui-chip .node-download {
        grid-column: 1 / -1;
      }

      ${M}[${APP_ATTR}="chat"] #player-chat-panel {
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        min-height: 0 !important;
      }
      ${M}[${APP_ATTR}="chat"] #player-chat-panel #player-chat-phone-shell {
        flex: 1 1 auto !important;
        min-height: 0 !important;
      }
      ${M}[${APP_ATTR}="chat"] #player-chat-panel[data-phc-view="thread"] #player-chat-phone-shell {
        flex: 0 0 auto !important;
      }
      ${M}[${APP_ATTR}="npcteam"] #denizen-npc-team-panel.open,
      ${M}[${APP_ATTR}="approvals"] #denizen-proposals-panel.open,
      ${M}[${APP_ATTR}="market"] #denizen-market-panel.open,
      ${M}[${APP_ATTR}="browser"] #denizen-browser-mirror-panel.open,
      ${M}[${APP_ATTR}="newsroom"] #denizen-content-pipeline-panel.open {
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }
      ${M}[${APP_ATTR}="browser"] #denizen-browser-mirror-panel.open .bm-body {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      ${M}[${APP_ATTR}="browser"] #denizen-browser-mirror-panel.open .bm-viewport {
        flex: 1 1 auto;
        min-height: 120px;
        max-height: none;
      }
      ${M}[${APP_ATTR}="npcteam"] #denizen-npc-team-panel .nt-body,
      ${M}[${APP_ATTR}="approvals"] #denizen-proposals-panel.open,
      ${M}[${APP_ATTR}="market"] #denizen-market-panel.open,
      ${M}[${APP_ATTR}="newsroom"] #denizen-content-pipeline-panel {
        -webkit-overflow-scrolling: touch;
      }
      ${M}[${APP_ATTR}="market"] #denizen-market-panel.open {
        display: block !important;
        overflow: auto !important;
      }

      /* Legacy profile/compute phone rules retired — panels live in .dzp-me-shell */
    `;
    document.head.appendChild(s);
  }

  // ---- Geometry sync -------------------------------------------------------
  function syncScreenVars() {
    if (!screenEl || !shellEl?.classList.contains('open')) return;
    const r = screenEl.getBoundingClientRect();
    const root = document.documentElement.style;
    root.setProperty('--dzp-screen-top', `${Math.round(r.top)}px`);
    root.setProperty('--dzp-screen-left', `${Math.round(r.left)}px`);
    root.setProperty('--dzp-screen-w', `${Math.round(r.width)}px`);
    root.setProperty('--dzp-screen-h', `${Math.round(r.height)}px`);
  }

  function scheduleSyncScreenVars() {
    syncScreenVars();
    requestAnimationFrame(() => {
      syncScreenVars();
      requestAnimationFrame(syncScreenVars);
    });
    setTimeout(syncScreenVars, 60);
    setTimeout(syncScreenVars, 220);
  }

  // ---- Status bar: clock, battery, widget ----------------------------------
  function fmtTime(d) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function greeting(d) {
    const h = d.getHours();
    if (h < 5) return 'Working late';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function paintClock() {
    const d = new Date();
    const t = fmtTime(d);
    if (clockEl) clockEl.textContent = t;
    if (widgetTimeEl) widgetTimeEl.textContent = t;
    if (widgetDateEl) {
      widgetDateEl.textContent = d.toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric',
      });
    }
    if (widgetHelloEl) widgetHelloEl.textContent = `${greeting(d)} · ${OS_NAME}`;
  }

  function paintBattery() {
    if (!batteryEl) return;
    const pct = Math.round(batteryState.level * 100);
    batteryEl.querySelector('.fill').style.width = `${Math.max(4, pct)}%`;
    batteryEl.classList.toggle('low', pct <= 20 && !batteryState.charging);
    batteryEl.classList.toggle('charging', !!batteryState.charging);
    const pctEl = shellEl?.querySelector('.dzp-batt-pct');
    if (pctEl) pctEl.textContent = `${pct}%`;
  }

  function watchBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then((b) => {
      const sync = () => {
        batteryState = { level: b.level, charging: b.charging };
        paintBattery();
      };
      sync();
      b.addEventListener('levelchange', sync);
      b.addEventListener('chargingchange', sync);
    }).catch(() => {});
  }

  // ---- Shell construction ----------------------------------------------------
  function buildShell() {
    if (shellEl) return shellEl;
    shellEl = document.createElement('div');
    shellEl.id = SHELL_ID;
    shellEl.innerHTML = `
      <div id="${FRAME_ID}" role="dialog" aria-label="Denizen phone">
        <span class="dzp-hw power"></span>
        <span class="dzp-hw vol-up"></span>
        <span class="dzp-hw vol-down"></span>
        <div class="dzp-glass"></div>
        <div class="dzp-statusbar">
          <span class="dzp-clock">--:--</span>
          <span class="dzp-cam"><span class="speaker"></span><span class="lens"></span></span>
          <span class="dzp-status-right">
            <span class="dzp-signal"><i></i><i></i><i></i><i></i></span>
            <span class="dzp-carrier">OFFICE</span>
            <span class="dzp-batt"><span class="fill"></span></span>
            <span class="dzp-batt-pct">87%</span>
          </span>
        </div>
        <div class="dzp-appbar">
          <button type="button" class="dzp-back" aria-label="Back to home screen">‹ Back</button>
          <span class="dzp-appbar-title"></span>
        </div>
        <div id="${SCREEN_ID}">
          <div class="dzp-homescr">
            <div class="dzp-edit-bar">
              <span>Home Screen<span class="hint"> · drag to move · drop on app to folder</span></span>
              <button type="button" class="dzp-edit-done">Done</button>
            </div>
            <button type="button" class="dzp-edit-enter" aria-label="Edit home screen">Edit</button>
            <div class="dzp-widget">
              <div class="t">--:--</div>
              <div class="d"></div>
              <div class="g"></div>
            </div>
            <div class="dzp-grid" role="menu" aria-label="Phone apps"></div>
            <div class="dzp-dock" role="menu" aria-label="Favorite apps"></div>
            <div class="dzp-folder-sheet" aria-hidden="true">
              <div class="dzp-folder-head">
                <span class="dzp-folder-title">Folder</span>
                <button type="button" class="dzp-folder-close">Done</button>
              </div>
              <div class="dzp-folder-grid" role="menu"></div>
            </div>
          </div>
          <div class="dzp-me-shell" aria-hidden="true" data-tab="profile">
            <div class="dzp-me-head">
              <div class="dzp-me-toolbar">
                <div class="dzp-me-tabs" role="tablist" aria-label="Citizen ID and City Power">
                  <button type="button" class="dzp-me-tab active" data-tab="profile" role="tab" aria-selected="true">Citizen ID</button>
                  <button type="button" class="dzp-me-tab" data-tab="compute" role="tab" aria-selected="false">City Power</button>
                </div>
                <button type="button" class="dzp-me-close" aria-label="Back to home">×</button>
              </div>
              <div class="dzp-me-subtitle"></div>
            </div>
            <div class="dzp-me-body"></div>
          </div>
          <div class="dzp-settings"></div>
          <div class="dzp-placeholder"><div class="spin"></div><div class="msg"></div></div>
          <div class="dzp-toast"></div>
          <div class="dzp-boot done"><div class="hex">⬡</div><div class="name">DENIZEN</div><div class="ver">OS ${OS_VERSION}</div></div>
        </div>
        <div class="dzp-nav">
          <button type="button" class="dzp-nav-back" aria-label="Back">◁</button>
          <button type="button" class="dzp-home" aria-label="Home"></button>
          <button type="button" class="dzp-close" aria-label="Close phone">✕</button>
        </div>
      </div>`;
    document.body.appendChild(shellEl);

    screenEl = shellEl.querySelector(`#${SCREEN_ID}`);
    homeScrEl = shellEl.querySelector('.dzp-homescr');
    gridEl = shellEl.querySelector('.dzp-grid');
    dockEl = shellEl.querySelector('.dzp-dock');
    editBarEl = shellEl.querySelector('.dzp-edit-bar');
    folderSheetEl = shellEl.querySelector('.dzp-folder-sheet');
    appbarEl = shellEl.querySelector('.dzp-appbar');
    appbarTitleEl = shellEl.querySelector('.dzp-appbar-title');
    clockEl = shellEl.querySelector('.dzp-clock');
    widgetTimeEl = shellEl.querySelector('.dzp-widget .t');
    widgetDateEl = shellEl.querySelector('.dzp-widget .d');
    widgetHelloEl = shellEl.querySelector('.dzp-widget .g');
    batteryEl = shellEl.querySelector('.dzp-batt');
    toastEl = shellEl.querySelector('.dzp-toast');
    settingsEl = shellEl.querySelector('.dzp-settings');
    meShellEl = shellEl.querySelector('.dzp-me-shell');
    meBodyEl = shellEl.querySelector('.dzp-me-body');
    meSubtitleEl = shellEl.querySelector('.dzp-me-subtitle');

    const bind = window.DenizenTouchBind?.bindPress;
    pressFn = (el, fn) => { if (bind) bind(el, fn); else el.addEventListener('click', fn); };
    pressFn(shellEl.querySelector('.dzp-home'), () => goHome(true));
    pressFn(shellEl.querySelector('.dzp-back'), () => {
      if (tryWorkflowToolBack()) return;
      goHome(true);
    });
    pressFn(meShellEl?.querySelector('.dzp-me-close'), () => goHome(true));
    meShellEl?.querySelectorAll('.dzp-me-tab').forEach((tabBtn) => {
      pressFn(tabBtn, () => setMeTab(tabBtn.dataset.tab));
    });
    pressFn(shellEl.querySelector('.dzp-nav-back'), () => {
      if (tryWorkflowToolBack()) return;
      if (currentApp) goHome(true);
      else closePhoneFromUi();
    });
    pressFn(shellEl.querySelector('.dzp-close'), closePhoneFromUi);
    shellEl.addEventListener('pointerdown', (e) => {
      if (e.target === shellEl) closePhoneFromUi();
    });

    pressFn(editBarEl.querySelector('.dzp-edit-done'), () => exitEditMode(true));
    pressFn(homeScrEl.querySelector('.dzp-edit-enter'), () => enterEditMode());
    pressFn(folderSheetEl.querySelector('.dzp-folder-close'), closeFolderSheet);
    bindHomeScreenEdit();
    buildGrid();
    watchBattery();

    if (typeof ResizeObserver !== 'undefined') {
      screenObs = new ResizeObserver(() => scheduleSyncScreenVars());
      screenObs.observe(screenEl);
      const frameObs = shellEl.querySelector(`#${FRAME_ID}`);
      if (frameObs) screenObs.observe(frameObs);
    }
    window.addEventListener('resize', syncScreenVars);
    window.addEventListener('orientationchange', () => setTimeout(syncScreenVars, 120));
    window.addEventListener('denizen-device-profile-change', () => setTimeout(syncScreenVars, 80));
    return shellEl;
  }

  function linkPrefetch(href, { rel = 'prefetch', key } = {}) {
    if (!href || document.querySelector(`link[data-dzp-prefetch="${key || href}"]`)) return;
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    link.setAttribute('data-dzp-prefetch', key || href);
    document.head.appendChild(link);
  }

  function prefetchNavigateApp(app) {
    if (app?.type !== 'navigate' || !app.url) return;
    try {
      linkPrefetch(new URL(app.url, window.location.origin).href, { key: `page-${app.id}` });
    } catch (_) {}
    if (app.id === 'crm') prefetchCrmBundle();
  }

  let crmPrefetchStarted = false;
  let crmManifestCache = null;

  function crmCriticalAssets(manifest) {
    if (!manifest) return [];
    const js = manifest.critical || manifest.js || [];
    return [...js, ...(manifest.css || [])];
  }

  function prefetchCrmBundle() {
    if (crmPrefetchStarted) return;
    crmPrefetchStarted = true;
    linkPrefetch('/crm/', { key: 'crm-page' });
    fetch('/crm/manifest.json', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((manifest) => {
        if (!manifest) return;
        crmManifestCache = manifest;
        const assets = crmCriticalAssets(manifest);
        for (const href of assets) {
          const rel = href.endsWith('.js') ? 'modulepreload' : 'prefetch';
          linkPrefetch(href, { rel, key: href });
        }
      })
      .catch(() => {
        linkPrefetch('/crm/', { key: 'crm-page-fallback' });
      });
  }

  async function warmCrmCritical(maxMs = 180) {
    const manifest = crmManifestCache
      || await fetch('/crm/manifest.json', { cache: 'force-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    if (manifest) crmManifestCache = manifest;
    const urls = crmCriticalAssets(manifest);
    if (!urls.length) return;
    await Promise.race([
      Promise.allSettled(urls.map((href) => fetch(href, { cache: 'force-cache' }))),
      new Promise((resolve) => setTimeout(resolve, maxMs)),
    ]);
  }

  function suppressAppTap(el, ms = 500) {
    if (el) tapSuppressUntil.set(el, Date.now() + ms);
  }

  function shouldSuppressAppTap(el) {
    const until = tapSuppressUntil.get(el);
    return !!(until && Date.now() < until);
  }

  function wireAppTap(btn, onTap) {
    let longTimer = null;
    let origin = null;

    const clearLong = () => {
      if (longTimer) clearTimeout(longTimer);
      longTimer = null;
    };

    btn.addEventListener('pointerdown', (e) => {
      if (editMode) return;
      if (e.button !== 0) return;
      origin = { x: e.clientX, y: e.clientY };
      clearLong();
      longTimer = setTimeout(() => {
        longTimer = null;
        origin = null;
        enterEditMode();
        window.DenizenHaptics?.impact?.();
      }, 480);
    });

    btn.addEventListener('pointermove', (e) => {
      if (!origin) return;
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 12) clearLong();
    });

    const endPointer = () => {
      clearLong();
      origin = null;
    };
    btn.addEventListener('pointerup', endPointer);
    btn.addEventListener('pointercancel', endPointer);

    pressFn(btn, () => {
      if (shouldSuppressAppTap(btn)) return;
      if (editMode) return;
      onTap();
    });
  }

  function makeAppButton(app, opts = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dzp-app';
    if (editMode) btn.classList.add('dzp-jiggle');
    btn.dataset.app = app.id;
    if (opts.zone) btn.dataset.zone = opts.zone;
    if (opts.index != null) btn.dataset.index = String(opts.index);
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('aria-label', app.label);
    btn.setAttribute('title', app.label);
    btn.dataset.label = app.label;
    btn.innerHTML = `
      <span class="dzp-app-icon" style="--tile-a:${app.c[0]};--tile-b:${app.c[1]}">${appIconMarkup(app)}</span>
      <span class="dzp-app-label">${app.label}</span>
      <span class="dzp-app-status"></span>
      <span class="dzp-badge"></span>
      <span class="dzp-dot"></span>`;
    if (app.type === 'navigate') {
      btn.addEventListener('pointerenter', () => prefetchNavigateApp(app), { passive: true });
      btn.addEventListener('pointerdown', () => prefetchNavigateApp(app), { passive: true });
    }
    wireAppTap(btn, () => {
      if (openFolderKey) return;
      activateApp(app);
    });
    bindEditPointer(btn);
    return btn;
  }

  function makeFolderButton(folderKey, folder, opts = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dzp-app dzp-folder';
    if (editMode) btn.classList.add('dzp-jiggle');
    btn.dataset.folder = folderKey;
    if (opts.zone) btn.dataset.zone = opts.zone;
    if (opts.index != null) btn.dataset.index = String(opts.index);
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('aria-label', folder.name || 'Folder');
    btn.setAttribute('title', folder.name || 'Folder');
    btn.dataset.label = folder.name || 'Folder';
    const previews = folder.apps.map((id) => appById[id]).filter(Boolean).slice(0, 4);
    const mini = previews.map((a) =>
      `<span style="--tile-a:${a.c[0]};--tile-b:${a.c[1]}">${appIconMarkup(a, 18)}</span>`,
    ).join('');
    btn.innerHTML = `
      <span class="dzp-folder-icons">${mini}</span>
      <span class="dzp-app-label">${folder.name || 'Folder'}</span>
      <span class="dzp-app-status"></span>`;
    wireAppTap(btn, () => {
      if (editMode) return;
      openFolderSheet(folderKey);
    });
    bindEditPointer(btn);
    return btn;
  }

  function renderHomeItem(ref, zone, index) {
    if (isFolderRef(ref)) {
      const key = folderKeyFromRef(ref);
      const folder = phoneLayout.folders[key];
      if (!folder) return null;
      return makeFolderButton(key, folder, { zone, index });
    }
    const app = appById[ref];
    if (!app) return null;
    return makeAppButton(app, { zone, index });
  }

  function buildGrid() {
    if (!gridEl || !dockEl) return;
    phoneLayout = normalizePhoneLayout(phoneLayout);
    gridEl.innerHTML = '';
    dockEl.innerHTML = '';

    phoneLayout.grid.forEach((ref, index) => {
      const el = renderHomeItem(ref, 'grid', index);
      if (el) gridEl.appendChild(el);
    });
    if (editMode) {
      const slot = document.createElement('div');
      slot.className = 'dzp-slot-empty';
      slot.dataset.zone = 'grid';
      slot.dataset.index = String(phoneLayout.grid.length);
      gridEl.appendChild(slot);
    }

    for (let i = 0; i < MAX_DOCK_APPS; i += 1) {
      const appId = phoneLayout.dock[i];
      if (appId && appById[appId]) {
        dockEl.appendChild(makeAppButton(appById[appId], { zone: 'dock', index: i }));
      } else if (editMode) {
        const slot = document.createElement('div');
        slot.className = 'dzp-slot-empty';
        slot.dataset.zone = 'dock';
        slot.dataset.index = String(i);
        dockEl.appendChild(slot);
      }
    }

    refreshAppStatuses();
  }

  function persistLayout() {
    phoneLayout = normalizePhoneLayout(phoneLayout);
    writePhoneLayout(phoneLayout);
    buildGrid();
  }

  function enterEditMode() {
    if (editMode || currentApp) return;
    closeFolderSheet();
    editMode = true;
    homeScrEl?.classList.add('dzp-editing');
    buildGrid();
    showToast('Drag apps — drop one on another to make a folder');
  }

  function exitEditMode(save = true) {
    if (!editMode) return;
    editMode = false;
    homeScrEl?.classList.remove('dzp-editing');
    clearDragUi();
    if (save) persistLayout();
    else buildGrid();
  }

  function openFolderSheet(folderKey) {
    const folder = phoneLayout.folders[folderKey];
    if (!folder || !folderSheetEl) return;
    openFolderKey = folderKey;
    folderSheetEl.querySelector('.dzp-folder-title').textContent = folder.name || 'Folder';
    const inner = folderSheetEl.querySelector('.dzp-folder-grid');
    inner.innerHTML = '';
    folder.apps.forEach((id) => {
      const app = appById[id];
      if (!app) return;
      inner.appendChild(makeAppButton(app));
    });
    folderSheetEl.classList.add('open');
    folderSheetEl.setAttribute('aria-hidden', 'false');
    refreshAppStatuses();
  }

  function closeFolderSheet() {
    openFolderKey = null;
    folderSheetEl?.classList.remove('open');
    folderSheetEl?.setAttribute('aria-hidden', 'true');
    buildGrid();
  }

  function insertAt(zone, index, ref) {
    if (zone === 'dock') {
      if (isFolderRef(ref)) return;
      const dock = [...phoneLayout.dock];
      dock.splice(index, 0, ref);
      phoneLayout.dock = dock.slice(0, MAX_DOCK_APPS);
      return;
    }
    const grid = [...phoneLayout.grid];
    grid.splice(index, 0, ref);
    phoneLayout.grid = grid;
  }

  function pullFromZone(zone, index) {
    if (zone === 'dock') {
      const ref = phoneLayout.dock[index];
      phoneLayout.dock = phoneLayout.dock.filter((_, i) => i !== index);
      return ref;
    }
    if (zone === 'grid') {
      const ref = phoneLayout.grid[index];
      phoneLayout.grid = phoneLayout.grid.filter((_, i) => i !== index);
      return ref;
    }
    return null;
  }

  function moveLayoutItem(fromZone, fromIndex, toZone, toIndex, payload) {
    const ref = pullFromZone(fromZone, fromIndex);
    if (!ref) return;

    if (payload.groupWith && toZone === 'grid' && !isFolderRef(ref)) {
      const targetRef = payload.groupWith.ref;
      if (isFolderRef(targetRef)) {
        const key = folderKeyFromRef(targetRef);
        const folder = phoneLayout.folders[key];
        if (folder && !folder.apps.includes(ref)) folder.apps.push(ref);
        phoneLayout.dock = phoneLayout.dock.filter((id) => id !== ref);
        phoneLayout.grid = phoneLayout.grid.filter((r) => r !== ref);
        return;
      }
      const key = newFolderKey();
      const targetApp = targetRef;
      if (!appById[targetApp] || targetApp === ref) {
        insertAt(toZone, toIndex, ref);
        return;
      }
      phoneLayout.folders[key] = {
        name: appById[targetApp]?.label || 'Folder',
        apps: [targetApp, ref],
      };
      phoneLayout.grid = phoneLayout.grid.filter((r) => r !== targetApp && r !== ref);
      phoneLayout.dock = phoneLayout.dock.filter((id) => id !== targetApp && id !== ref);
      const replaceAt = phoneLayout.grid.indexOf(targetApp);
      const folderItem = folderRef(key);
      if (replaceAt >= 0) phoneLayout.grid.splice(replaceAt, 0, folderItem);
      else phoneLayout.grid.splice(Math.max(0, toIndex), 0, folderItem);
      return;
    }

    if (toZone === 'dock') {
      if (isFolderRef(ref)) {
        insertAt('grid', Math.max(0, toIndex), ref);
        return;
      }
      phoneLayout.dock = phoneLayout.dock.filter((id) => id !== ref);
      phoneLayout.grid = phoneLayout.grid.filter((r) => r !== ref);
      const dock = [...phoneLayout.dock];
      dock.splice(toIndex, 0, ref);
      phoneLayout.dock = dock.slice(0, MAX_DOCK_APPS);
      return;
    }

    phoneLayout.dock = phoneLayout.dock.filter((id) => id !== ref);
    if (isFolderRef(ref)) {
      phoneLayout.grid = phoneLayout.grid.filter((r) => r !== ref);
      phoneLayout.grid.splice(Math.max(0, toIndex), 0, ref);
      return;
    }
    phoneLayout.grid = phoneLayout.grid.filter((r) => r !== ref);
    phoneLayout.grid.splice(Math.max(0, toIndex), 0, ref);
  }

  function clearDragUi() {
    if (dragState?.ghost) dragState.ghost.remove();
    dragState = null;
    shellEl?.querySelectorAll('.dzp-drop-target').forEach((el) => el.classList.remove('dzp-drop-target'));
    shellEl?.querySelectorAll('.dzp-dragging').forEach((el) => el.classList.remove('dzp-dragging'));
  }

  function dragPayloadFromEl(el) {
    if (!el) return null;
    if (el.dataset.app) {
      return { ref: el.dataset.app, appId: el.dataset.app };
    }
    if (el.dataset.folder) {
      return { ref: folderRef(el.dataset.folder), folderKey: el.dataset.folder };
    }
    return null;
  }

  function bindEditPointer(btn) {
    btn.addEventListener('pointerdown', (e) => {
      if (!editMode) return;
      if (e.button !== 0) return;
      const target = e.currentTarget;
      const payload = dragPayloadFromEl(target);
      if (!payload) return;
      e.preventDefault();
      e.stopPropagation();
      target.setPointerCapture(e.pointerId);
      const ghost = target.cloneNode(true);
      ghost.classList.add('dzp-drag-ghost');
      ghost.style.width = `${target.offsetWidth}px`;
      document.body.appendChild(ghost);
      target.classList.add('dzp-dragging');
      dragState = {
        el: target,
        ghost,
        payload,
        fromZone: target.dataset.zone,
        fromIndex: Number(target.dataset.index),
        x: e.clientX,
        y: e.clientY,
        moved: false,
      };
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
    });

    btn.addEventListener('pointermove', (e) => {
      if (!dragState || dragState.el !== e.currentTarget) return;
      dragState.moved = true;
      dragState.ghost.style.left = `${e.clientX}px`;
      dragState.ghost.style.top = `${e.clientY}px`;
      shellEl?.querySelectorAll('.dzp-drop-target').forEach((el) => el.classList.remove('dzp-drop-target'));
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.dzp-app, .dzp-slot-empty');
      if (hit && hit !== dragState.el) hit.classList.add('dzp-drop-target');
    });

    const finishDrag = (e) => {
      if (!dragState || dragState.el !== e.currentTarget) return;
      const state = dragState;
      const moved = state.moved;
      clearDragUi();
      if (moved) suppressAppTap(state.el, 550);
      if (!moved) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.dzp-app, .dzp-slot-empty');
      if (!hit || hit === state.el) {
        buildGrid();
        return;
      }
      const toZone = hit.dataset.zone;
      const toIndex = Number(hit.dataset.index);
      const groupWith = hit.classList.contains('dzp-app') ? { ref: hit.dataset.folder ? folderRef(hit.dataset.folder) : hit.dataset.app } : null;
      moveLayoutItem(state.fromZone, state.fromIndex, toZone, toIndex, {
        ...state.payload,
        groupWith,
      });
      phoneLayout = normalizePhoneLayout(phoneLayout);
      buildGrid();
      writePhoneLayout(phoneLayout);
      if (groupWith?.ref) {
        showToast('Folder created — tap to open');
      }
    };

    btn.addEventListener('pointerup', finishDrag);
    btn.addEventListener('pointercancel', finishDrag);
  }

  function bindHomeScreenEdit() {
    const startLongPress = (e) => {
      if (editMode || currentApp || openFolderKey) return;
      if (e.target?.closest?.('.dzp-app, .dzp-edit-enter, .dzp-edit-done')) return;
      if (e.target?.closest?.('.dzp-widget, .dzp-grid, .dzp-dock')) {
        if (longPressTimer) clearTimeout(longPressTimer);
        const origin = { x: e.clientX, y: e.clientY };
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          enterEditMode();
        }, 520);
        const cancel = (ev) => {
          if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > 12) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        };
        const stop = () => {
          clearTimeout(longPressTimer);
          longPressTimer = null;
          homeScrEl?.removeEventListener('pointermove', cancel);
          homeScrEl?.removeEventListener('pointerup', stop);
          homeScrEl?.removeEventListener('pointercancel', stop);
        };
        homeScrEl?.addEventListener('pointermove', cancel);
        homeScrEl?.addEventListener('pointerup', stop);
        homeScrEl?.addEventListener('pointercancel', stop);
      }
    };
    homeScrEl?.addEventListener('pointerdown', startLongPress);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readOfficeGuideProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(OFFICE_GUIDE_STORAGE_KEY) || '{}');
      const done = Array.isArray(raw.done) ? raw.done.filter(Boolean) : [];
      const active = raw.active && OFFICE_GUIDE_STEPS.some((s) => s.id === raw.active)
        ? raw.active
        : officeGuideActiveId;
      return { done: new Set(done), active };
    } catch (_) {
      return { done: new Set(), active: officeGuideActiveId };
    }
  }

  function writeOfficeGuideProgress(progress) {
    try {
      localStorage.setItem(OFFICE_GUIDE_STORAGE_KEY, JSON.stringify({
        done: [...(progress.done || [])],
        active: progress.active || officeGuideActiveId,
      }));
    } catch (_) {}
  }

  function toggleOfficeGuideStep(stepId) {
    const progress = readOfficeGuideProgress();
    if (progress.done.has(stepId)) progress.done.delete(stepId);
    else progress.done.add(stepId);
    progress.active = stepId;
    officeGuideActiveId = stepId;
    writeOfficeGuideProgress(progress);
  }

  function runOfficeGuideAction(act) {
    if (!act) return;
    if (act === 'capabilities') {
      globalThis.DenizenCapabilitiesGuide?.open?.({ tab: 'overview' });
      return;
    }
    const app = appById[act];
    if (!app) return;
    clearAppUi();
    activateApp(app);
  }

  function renderOfficeGuide(app) {
    setAppOpenUi(app);
    settingsEl?.classList.add('show', 'dzp-office-guide');
    const progress = readOfficeGuideProgress();
    const fallbackStep = OFFICE_GUIDE_STEPS[0];
    const activeStep = OFFICE_GUIDE_STEPS.find((s) => s.id === progress.active) || fallbackStep;
    officeGuideActiveId = activeStep?.id || fallbackStep?.id || null;
    progress.active = officeGuideActiveId;
    writeOfficeGuideProgress(progress);
    const doneCount = OFFICE_GUIDE_STEPS.filter((step) => progress.done.has(step.id)).length;
    const pct = OFFICE_GUIDE_STEPS.length ? Math.round((doneCount / OFFICE_GUIDE_STEPS.length) * 100) : 0;
    const isDone = activeStep && progress.done.has(activeStep.id);
    settingsEl.innerHTML = `
      <div class="og-hero">
        <span class="og-kicker">Office first</span>
        <h3>Office Guide</h3>
        <p>Your phone is the office key. Build your firm here, then use City Power to grow into the city.</p>
        <div class="og-progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
        <div class="og-progress-label">${doneCount} of ${OFFICE_GUIDE_STEPS.length} office steps complete</div>
      </div>
      <div class="og-step-list" role="list">
        ${OFFICE_GUIDE_STEPS.map((step) => `
          <button type="button" class="og-step${step.id === activeStep.id ? ' active' : ''}${progress.done.has(step.id) ? ' done' : ''}" data-step="${escapeHtml(step.id)}" role="listitem">
            <span class="og-check" aria-hidden="true">✓</span>
            <span class="og-step-main">
              <span class="og-step-title">${escapeHtml(step.title)}</span>
              <span class="og-step-tag">${escapeHtml(step.tag)}</span>
            </span>
            <span class="og-caret" aria-hidden="true">›</span>
          </button>
        `).join('')}
      </div>
      <div class="og-detail">
        <div class="og-tag">${escapeHtml(activeStep.tag)}</div>
        <h3>${escapeHtml(activeStep.title)}</h3>
        <p>${escapeHtml(activeStep.body)}</p>
        <div class="og-actions">
          <button type="button" class="primary" data-act="${escapeHtml(activeStep.act)}">${escapeHtml(activeStep.action)}</button>
          <button type="button" data-complete="${escapeHtml(activeStep.id)}">${isDone ? 'Mark open' : 'Mark done'}</button>
          <button type="button" data-act="capabilities">Full guide</button>
        </div>
      </div>
    `;
    settingsEl.onclick = (e) => {
      const stepBtn = e.target?.closest?.('[data-step]');
      if (stepBtn) {
        officeGuideActiveId = stepBtn.dataset.step;
        const next = readOfficeGuideProgress();
        next.active = officeGuideActiveId;
        writeOfficeGuideProgress(next);
        renderOfficeGuide(app);
        return;
      }
      const completeBtn = e.target?.closest?.('[data-complete]');
      if (completeBtn) {
        toggleOfficeGuideStep(completeBtn.dataset.complete);
        renderOfficeGuide(app);
        return;
      }
      const actBtn = e.target?.closest?.('[data-act]');
      if (actBtn) runOfficeGuideAction(actBtn.dataset.act);
    };
  }

  function resetPhoneLayout() {
    phoneLayout = defaultPhoneLayout();
    writePhoneLayout(phoneLayout);
    exitEditMode(true);
    showToast('Home screen reset');
  }

  function refreshAppStatuses() {
    if (!gridEl) return;
    let anyBadge = false;
    for (const app of APPS) {
      const buttons = shellEl?.querySelectorAll(`.dzp-app[data-app="${app.id}"]`) || [];
      for (const btn of buttons) {
      btn.classList.toggle('dzp-hidden', !appAvailable(app));

      const statusCell = btn.querySelector('.dzp-app-status');
      if (statusCell) {
        if (app.stateText) statusCell.textContent = app.stateText() || '';
        else if (app.trigger && !$(app.trigger) && !scriptsSettled
          && app.type !== 'special-profile' && app.type !== 'special-compute' && app.type !== 'internal') {
          statusCell.textContent = 'loading…';
        } else statusCell.textContent = '';
      }

      if (app.stateDot) {
        const v = app.stateDot();
        btn.classList.toggle('dot-on', v === true);
        btn.classList.toggle('dot-off', v === false);
      }

      if (app.badgeFrom) {
        const n = chipBadgeCount(app.badgeFrom);
        btn.classList.toggle('has-badge', n > 0);
        const b = btn.querySelector('.dzp-badge');
        if (b) b.textContent = n > 9 ? '9+' : String(n);
        if (n > 0) anyBadge = true;
      }
      }
    }
    for (const btn of shellEl?.querySelectorAll('.dzp-app.dzp-folder') || []) {
      const key = btn.dataset.folder;
      const folder = phoneLayout.folders[key];
      if (!folder) continue;
      const visible = folder.apps.some((id) => appAvailable(appById[id]));
      btn.classList.toggle('dzp-hidden', !visible);
    }
    fabEl?.classList.toggle('has-badge', anyBadge);
  }

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  // ---- App lifecycle ---------------------------------------------------------
  function setAppOpenUi(app) {
    currentApp = app;
    document.documentElement.setAttribute(APP_ATTR, app.id);
    shellEl.querySelector(`#${FRAME_ID}`).classList.add('dzp-app-open');
    if (appbarTitleEl) {
      appbarTitleEl.innerHTML = `${appIconMarkup(app, 16)} <span>${app.label}</span>`;
    }
    scheduleSyncScreenVars();
  }

  function clearAppUi() {
    const closingId = currentApp?.id || null;
    if (closingId === 'me') {
      closeMeShell();
      if (!isTouch()) globalThis.DenizenNodeUI?.hidePanel?.({ persist: false });
    }
    currentApp = null;
    document.documentElement.removeAttribute(APP_ATTR);
    shellEl?.querySelector(`#${FRAME_ID}`)?.classList.remove('dzp-app-open');
    const ph = shellEl?.querySelector('.dzp-placeholder');
    if (ph) { ph.classList.remove('show', 'err'); }
    settingsEl?.classList.remove('show', 'dzp-office-guide', 'dzp-station-connect', 'dzp-workflow');
    if (settingsEl) settingsEl.onclick = null;
    globalThis.DenizenPhoneStationConnect?.unmount?.();
    loadingToken += 1;
    if (appWatchTimer) { clearInterval(appWatchTimer); appWatchTimer = null; }
    refreshAppStatuses();
    scheduleSyncScreenVars();
    if (closingId) {
      document.dispatchEvent(new CustomEvent('denizen-phone-app-close', { detail: { appId: closingId } }));
    }
  }

  function showPlaceholder(msg, isError = false) {
    const ph = shellEl.querySelector('.dzp-placeholder');
    ph.querySelector('.msg').textContent = msg;
    ph.classList.toggle('err', isError);
    ph.classList.add('show');
  }

  function hidePlaceholder() {
    const ph = shellEl?.querySelector('.dzp-placeholder');
    if (ph) ph.classList.remove('show', 'err');
  }

  function armPanelWatch(app) {
    // Bounce back to the grid when the user closes the panel via its own ✕ —
    // but only after we've actually seen it visible, and after consecutive
    // misses, so slow async opens and in-app navigation don't get cut short.
    const missLimit = app.id === 'chat' ? 8 : 2;
    let seen = false;
    let misses = 0;
    if (appWatchTimer) clearInterval(appWatchTimer);
    appWatchTimer = setInterval(() => {
      if (!currentApp || currentApp.id !== app.id) return;
      if (panelVisible(app.panel)) { seen = true; misses = 0; return; }
      if (!seen) return;
      misses += 1;
      if (misses >= missLimit) goHome(false);
    }, 500);
  }

  async function openPanelApp(app) {
    const token = ++loadingToken;
    setAppOpenUi(app);

    if (app.id === 'approvals' && !canUseApprovals()) {
      showPlaceholder('Approvals need a Citizen ID — open Citizen ID, sign in, then try again.', true);
      return;
    }

    if (app.id === 'approvals') {
      showPlaceholder(`Loading ${app.label}…`);
      kickLazyLoad();
      const ready = await waitFor(() => window.DenizenProposals, 12_000);
      if (token !== loadingToken || currentApp?.id !== app.id) return;
      if (!ready) {
        showPlaceholder(`${app.label} couldn't load — hard-refresh (Ctrl+Shift+R) and try again.`, true);
        setTimeout(() => { if (currentApp?.id === app.id) goHome(false); }, 3200);
        return;
      }
      hidePlaceholder();
      scheduleSyncScreenVars();
      try { await window.DenizenProposals?.show?.(); } catch (_) {}
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      scheduleSyncScreenVars();
      await waitFor(() => panelVisible(app.panel), 8_000);
      if (token !== loadingToken || currentApp?.id !== app.id) return;
      if (!panelVisible(app.panel)) {
        showPlaceholder(`${app.label} didn't open — sign in with Citizen ID first.`, true);
        setTimeout(() => { if (currentApp?.id === app.id) goHome(false); }, 3200);
        return;
      }
      armPanelWatch(app);
      scheduleSyncScreenVars();
      document.dispatchEvent(new CustomEvent('denizen-phone-app-open', { detail: { appId: app.id } }));
      return;
    }

    if (app.id === 'browser') {
      showPlaceholder(`Loading ${app.label}…`);
      const ready = await ensureBrowserMirrorReady();
      if (token !== loadingToken || currentApp?.id !== app.id) return;
      if (!ready) {
        showPlaceholder(`${app.label} couldn't load — hard-refresh (Ctrl+Shift+R) and try again.`, true);
        setTimeout(() => { if (currentApp?.id === app.id) goHome(false); }, 3200);
        return;
      }
      hidePlaceholder();
      armPanelWatch(app);
      scheduleSyncScreenVars();
      document.dispatchEvent(new CustomEvent('denizen-phone-app-open', { detail: { appId: app.id } }));
      return;
    }

    // Tool not loaded yet? Kick the lazy loader and wait for it right here.
    if (!$(app.panel) && !$(app.trigger)) {
      showPlaceholder(`Loading ${app.label}…`);
      kickLazyLoad();
      const ok = await waitFor(() => $(app.panel) || $(app.trigger), 12_000);
      if (token !== loadingToken || currentApp?.id !== app.id) return;
      if (!ok) {
        showPlaceholder(`${app.label} isn't available for this account.`, true);
        setTimeout(() => { if (currentApp?.id === app.id) goHome(false); }, 2200);
        return;
      }
      hidePlaceholder();
    }

    if (!panelVisible(app.panel)) {
      if (app.open) app.open();
      else if (app.trigger) $(app.trigger)?.click();
    }
    // Some panels open asynchronously — give them a beat before judging.
    if (!panelVisible(app.panel)) {
      showPlaceholder(`Opening ${app.label}…`);
      await waitFor(() => panelVisible(app.panel), 5_000);
      if (token !== loadingToken || currentApp?.id !== app.id) return;
      hidePlaceholder();
      if (!panelVisible(app.panel)) {
        showPlaceholder(`${app.label} didn't open — it may not be available right now.`, true);
        setTimeout(() => { if (currentApp?.id === app.id) goHome(false); }, 2200);
        return;
      }
    }
    armPanelWatch(app);
    scheduleSyncScreenVars();
    document.dispatchEvent(new CustomEvent('denizen-phone-app-open', { detail: { appId: app.id } }));
  }

  async function runActionApp(app) {
    if (app.id === 'voice') {
      const vi = window.DenizenVoiceInput;
      if (!vi) {
        showToast('Loading voice…');
        kickLazyLoad();
        await waitFor(() => window.DenizenVoiceInput, 10_000);
      }
      const voice = window.DenizenVoiceInput;
      if (!(voice?.isSupported?.() ?? voice?.supported)) {
        showToast('Voice unavailable — allow mic or set OPENAI_API_KEY on server');
        return;
      }
      if (typeof window.DenizenSetPresence === 'function' && !window.DenizenPresence?.zionPresent) {
        try { window.DenizenSetPresence(true); } catch (_) {}
      }
      if (window.DenizenVoiceSession?.isActive?.()) {
        window.DenizenVoiceSession.stop();
        window.DenizenVoiceCallUi?.hide?.();
        showToast('Voice call ended');
      } else if (window.DenizenVoiceCallUi?.openCall) {
        window.DenizenVoiceCallUi.openCall();
        showToast('Voice call — speak naturally');
      } else if (voice.isListening?.()) {
        voice.stop();
        showToast('Voice stopped');
      } else {
        voice.start();
        showToast('Listening — tap Speak again when done');
      }
      setTimeout(refreshAppStatuses, 200);
      return;
    }
    let trigger = $(app.trigger);
    if (!trigger) {
      showToast(`Loading ${app.label}…`);
      kickLazyLoad();
      await waitFor(() => $(app.trigger), 10_000);
      trigger = $(app.trigger);
      if (!trigger) { showToast(`${app.label} isn't available right now`); return; }
    }
    trigger.click();
    setTimeout(() => {
      refreshAppStatuses();
      const txt = app.stateText?.();
      showToast(txt ? `${app.label}: ${txt}` : (app.toastOn || `${app.label} toggled`));
    }, 350);
  }

  async function runLaunchApp(app) {
    let trigger = $(app.trigger);
    if (!trigger) {
      showToast(`Loading ${app.label}…`);
      kickLazyLoad();
      await waitFor(() => $(app.trigger), 8_000);
      trigger = $(app.trigger);
      if (!trigger) { showToast(`${app.label} isn't available for this account`); return; }
    }
    closePhoneFromUi();
    setTimeout(() => trigger.click(), 180);
  }

  async function runNavigateApp(app) {
    const path = app.url || '/';
    let href = path;
    try {
      href = new URL(path, window.location.origin).href;
    } catch (_) {}
    showToast(`Opening ${app.label}…`);
    // Fast exit — don't rebuild the home grid while navigating away.
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    clearDragUi();
    editMode = false;
    openFolderKey = null;
    currentApp = null;
    loadingToken += 1;
    if (appWatchTimer) { clearInterval(appWatchTimer); appWatchTimer = null; }
    document.documentElement.removeAttribute(APP_ATTR);
    document.documentElement.classList.remove('denizen-phone-open');
    shellEl?.classList.remove('open');
    shellEl?.querySelector(`#${FRAME_ID}`)?.classList.remove('dzp-app-open');
    homeScrEl?.classList.remove('dzp-editing');
    fabEl?.classList.remove('active');
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    if (app.id === 'crm') {
      prefetchCrmBundle();
      await warmCrmCritical(200);
      try {
        const sess = globalThis.DenizenVisitorSession;
        const sid = sess?.getSessionId?.();
        const tok = sess?.getSessionToken?.();
        const raw = JSON.parse(localStorage.getItem('denizen-visitor-session') || '{}');
        const ceo = sess?.isCeoPrincipal?.() || raw.access_method === 'ceo';
        if (sid || ceo) {
          localStorage.setItem('denizen-visitor-session', JSON.stringify({
            ...raw,
            session_id: sid || raw.session_id,
            sessionId: sid || raw.sessionId,
            session_token: tok || raw.session_token || raw.sessionToken || null,
            sessionToken: tok || raw.session_token || raw.sessionToken || null,
            access_method: ceo ? 'ceo' : (raw.access_method || raw.accessMethod),
            accessMethod: ceo ? 'ceo' : (raw.access_method || raw.accessMethod),
            tier: ceo ? 'ceo' : (raw.tier || sess?.getTier?.()),
            display_name: sess?.getDisplayName?.() || raw.display_name,
            displayName: sess?.getDisplayName?.() || raw.displayName,
            org_slug: raw.org_slug || raw.orgSlug,
            orgSlug: raw.org_slug || raw.orgSlug,
          }));
        }
        const crmUrl = new URL(href, window.location.origin);
        if (sid) crmUrl.searchParams.set('dz_sid', sid);
        if (tok) crmUrl.searchParams.set('dz_stok', tok);
        href = crmUrl.toString();
      } catch (_) {}
    }
    window.location.assign(href);
  }

  async function renderStationConnect(app) {
    setAppOpenUi(app);
    settingsEl.classList.remove('dzp-office-guide');
    settingsEl.classList.add('show', 'dzp-station-connect');
    settingsEl.innerHTML = '<div id="dzp-station-host"></div>';
    const host = settingsEl.querySelector('#dzp-station-host');
    if (!globalThis.DenizenPhoneStationConnect?.render) {
      showPlaceholder('Loading Link Station…');
      const lazy = globalThis.DenizenLazyScripts;
      if (lazy?.load) {
        await lazy.load(['./src/visitor-phone-station-connect.js?v=st2']);
      }
      hidePlaceholder();
    }
    if (!globalThis.DenizenPhoneStationConnect?.render) {
      showPlaceholder('Link Station could not load — hard-refresh and try again.', true);
      return;
    }
    await globalThis.DenizenPhoneStationConnect.render(host);
    document.dispatchEvent(new CustomEvent('denizen-phone-app-open', { detail: { appId: app.id } }));
  }

  function renderWorkflowApp(app) {
    setAppOpenUi(app);
    settingsEl.classList.remove('dzp-office-guide', 'dzp-station-connect');
    settingsEl.classList.add('show', 'dzp-workflow');
    settingsEl.innerHTML = '<iframe class="dzp-workflow-frame" src="/workflow-dashboard.html?embed=1" title="Office workflow tools"></iframe>';
    document.dispatchEvent(new CustomEvent('denizen-phone-app-open', { detail: { appId: app.id } }));
  }

  function renderSettings(app) {
    setAppOpenUi(app);
    const sess = globalThis.DenizenVisitorSession;
    const role = sess?.isCeoPrincipal?.() ? 'CEO' : (
      String(sess?.getProfile?.()?.teamRole || '').toLowerCase() === 'owner' ? 'CEO' : (sess?.getTier?.() || 'visitor')
    );
    const mode = isTouch() ? 'Touch' : 'Desktop';
    settingsEl.classList.remove('dzp-office-guide');
    settingsEl.innerHTML = `
      <div class="sec">
        <h3>About this phone</h3>
        <div class="row"><span>System</span><span class="v">${OS_NAME} ${OS_VERSION}</span></div>
        <div class="row"><span>Device</span><span class="v">Denizen One (concept)</span></div>
        <div class="row"><span>Network</span><span class="v">MESH · agent fabric</span></div>
        <div class="row"><span>Signed in as</span><span class="v">${role}</span></div>
        <div class="row"><span>Input mode</span><span class="v">${mode}</span></div>
      </div>
      <div class="sec">
        <h3>Home Screen</h3>
        <div class="row">
          <span>Rearrange apps<br><span class="v">Long-press any app, or tap Edit on the home screen</span></span>
          <button type="button" data-act="edit-home">Edit</button>
        </div>
        <div class="row">
          <span>Reset layout<br><span class="v">Restore default dock: Chat, Voice, Profile, NPC Team</span></span>
          <button type="button" data-act="reset-home">Reset</button>
        </div>
      </div>
      <div class="sec">
        <h3>AI Connections</h3>
        <div id="dzp-mcp-settings-host"><p class="v">Loading…</p></div>
      </div>
      <div class="sec">
        <h3>Interface</h3>
        <div class="row">
          <span>Classic toolbar<br><span class="v">Reload with the legacy bottom dock</span></span>
          <button type="button" data-act="legacy">Switch</button>
        </div>
      </div>
      <div class="sec">
        <h3>Help</h3>
        <div class="row">
          <span>What can Denizen do?</span>
          <button type="button" data-act="guide">Open guide</button>
        </div>
      </div>`;
    settingsEl.classList.add('show');
    void loadPhoneMcpSettings();
    const onAct = (e) => {
      const act = e.target?.closest?.('[data-act]')?.dataset?.act;
      if (act === 'legacy') {
        try {
          const u = new URL(window.location.href);
          u.searchParams.set('phonemode', '0');
          window.location.href = u.toString();
        } catch (_) {}
      } else if (act === 'edit-home') {
        goHome(true);
        enterEditMode();
      } else if (act === 'reset-home') {
        resetPhoneLayout();
      } else if (act === 'guide') {
        const guide = APPS.find((a) => a.id === 'guide');
        if (guide) renderOfficeGuide(guide);
      }
    };
    settingsEl.onclick = onAct;
  }

  async function loadPhoneMcpSettings() {
    const host = settingsEl?.querySelector('#dzp-mcp-settings-host');
    if (!host) return;
    try {
      if (!globalThis.DenizenVisitorMcpConnectUI?.renderSettingsPanel) {
        await globalThis.DenizenLazyScripts?.load?.(['./src/visitor-mcp-connect-ui.js?v=mcp7jobs']);
        globalThis.DenizenVisitorMcpConnectUI?.attach?.();
      }
      await globalThis.DenizenVisitorMcpConnectUI?.renderSettingsPanel?.(host);
    } catch (_) {
      host.innerHTML = '<p class="v">Sign in and claim an assistant to connect MCP.</p>';
    }
  }

  function activateApp(app) {
    if (app.type === 'action') { runActionApp(app); return; }
    if (app.type === 'launch') { runLaunchApp(app); return; }
    if (app.type === 'navigate') { runNavigateApp(app); return; }
    if (app.type === 'internal') {
      if (app.id === 'guide') renderOfficeGuide(app);
      else if (app.id === 'station') { void renderStationConnect(app); }
      else if (app.id === 'workflow') renderWorkflowApp(app);
      else renderSettings(app);
      return;
    }
    if (app.type === 'special-profile' || app.type === 'special-compute') {
      if (isTouch()) {
        closePhoneFromUi();
        const tab = app.id === 'compute' ? 'compute' : 'profile';
        setTimeout(() => {
          globalThis.DenizenMobileSidebar?.open?.();
          if (tab === 'compute') {
            document.querySelector('#denizen-mobile-drawer .drawer-tab[data-tab="compute"]')?.click();
          }
        }, 120);
        return;
      }
      openMeInPhone(app.id === 'compute' ? 'compute' : 'profile');
      return;
    }
    openPanelApp(app);
  }

  function closeCurrentApp(alsoClosePanel = true) {
    if (!currentApp) return;
    const app = currentApp;
    if (alsoClosePanel) {
      if (app.type === 'panel' && panelVisible(app.panel)) {
        if (app.close) app.close();
        if (panelVisible(app.panel)) $(app.trigger)?.click();
      }
      if (app.type === 'special-compute' && isDesktop()) {
        globalThis.DenizenNodeUI?.hidePanel?.({ persist: false });
      }
    }
    clearAppUi();
  }

  function tryWorkflowToolBack() {
    if (currentApp?.id !== 'workflow') return false;
    const frame = settingsEl?.querySelector?.('.dzp-workflow-frame');
    if (!frame?.contentWindow) return false;
    try {
      const loc = frame.contentWindow.location;
      const path = String(loc.pathname || '');
      if (/workflow-dashboard\.html$/i.test(path)) return false;
      frame.contentWindow.history.back();
      return true;
    } catch (_) {
      // Cross-origin or empty — reload Office Build home inside the iframe.
      try {
        frame.src = '/workflow-dashboard.html?embed=1';
        return true;
      } catch (__) {
        return false;
      }
    }
  }

  function goHome(alsoClosePanel = true) {
    closeCurrentApp(alsoClosePanel);
    closeFolderSheet();
    if (editMode) exitEditMode(true);
    syncScreenVars();
  }

  // ---- Phone open / close ----------------------------------------------------
  function maybeBoot() {
    let booted = false;
    try { booted = sessionStorage.getItem('dzp-booted') === '1'; } catch (_) {}
    if (booted) return;
    try { sessionStorage.setItem('dzp-booted', '1'); } catch (_) {}
    const boot = shellEl.querySelector('.dzp-boot');
    boot.classList.remove('done', 'fading');
    setTimeout(() => boot.classList.add('fading'), 700);
    setTimeout(() => boot.classList.add('done'), 1050);
  }

  // ---- Back-button trap -----------------------------------------------------
  function armPhoneBackTrap() {
    if (phoneBackTrap) return;
    try {
      window.history.pushState({ dzpPhone: 1 }, '');
      phoneBackTrap = true;
    } catch (_) {}
  }

  // Pop the trap we pushed (used when the phone is closed via UI, not Back), so
  // the history stack stays clean and the next Back press behaves normally.
  function disarmPhoneBackTrap() {
    if (!phoneBackTrap) return;
    phoneBackTrap = false;
    suppressPhonePop = true;
    try { window.history.back(); } catch (_) { suppressPhonePop = false; }
  }

  function onPhonePopState() {
    if (suppressPhonePop) { suppressPhonePop = false; return; }
    if (!phoneBackTrap) return; // not our entry — let the browser navigate
    phoneBackTrap = false; // the browser just popped our trap
    if (!shellEl?.classList.contains('open')) return;
    if (currentApp) {
      // Step out of the open app back to the home grid, keep trapping Back.
      goHome(true);
      armPhoneBackTrap();
    } else {
      // At the home grid — Back closes the phone (trap already consumed).
      closePhone();
    }
  }

  function openPhone() {
    buildShell();
    phoneLayout = normalizePhoneLayout(readPhoneLayout());
    buildGrid();
    prefetchCrmBundle();
    kickLazyLoad();
    shellEl.classList.add('open');
    fabEl?.classList.add('active');
    document.documentElement.classList.add('denizen-phone-open');
    maybeBoot();
    refreshAppStatuses();
    paintClock();
    paintBattery();
    syncScreenVars();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(paintClock, 15_000);
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(refreshAppStatuses, 1_200);
    armPhoneBackTrap();
  }

  // Pure close — no history side effects. Safe to call from the popstate
  // handler (where the trap is already gone) and from closePhoneFromUi().
  function closePhone() {
    closeCurrentApp(true);
    closeFolderSheet();
    if (editMode) exitEditMode(true);
    shellEl?.classList.remove('open');
    fabEl?.classList.remove('active');
    document.documentElement.classList.remove('denizen-phone-open');
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    // Release keyboard focus so WASD/arrows reach Phaser again after using phone apps.
    try {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        el.blur();
      }
      window.game?.input?.keyboard?.enableGlobalCapture?.();
    } catch (_) {}
  }

  // Close triggered by the user (FAB / Esc / external API): also drop the trap.
  function closePhoneFromUi() {
    disarmPhoneBackTrap();
    closePhone();
  }

  function togglePhone() {
    if (shellEl?.classList.contains('open')) closePhoneFromUi();
    else openPhone();
  }

  function buildFab() {
    if (document.getElementById(FAB_ID)) return;
    fabEl = document.createElement('button');
    fabEl.id = FAB_ID;
    fabEl.type = 'button';
    fabEl.innerHTML = '<span class="dzp-fab-badge"></span>';
    paintPhoneFab();
    fabEl.title = 'Open your office key — chat, Citizen ID, City Power, and tools';
    fabEl.setAttribute('aria-label', 'Open phone');
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) bind(fabEl, togglePhone);
    else fabEl.addEventListener('click', togglePhone);
    document.body.appendChild(fabEl);
  }

  function markScriptsSettled() {
    // Small grace period: chips mount in the same tick or shortly after the
    // ready event; once settled, role-gated apps that never mounted hide.
    setTimeout(() => {
      scriptsSettled = true;
      refreshAppStatuses();
    }, 3000);
  }

  function maybeOpenPhoneFromQuery() {
    try {
      const q = new URLSearchParams(window.location.search);
      const phone = q.get('phone');
      if (phone !== '1' && phone !== 'open') return;
      q.delete('phone');
      const clean = q.toString();
      const url = `${window.location.pathname}${clean ? `?${clean}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', url);
      setTimeout(() => openPhone(), 500);
    } catch (_) {}
  }

  function boot() {
    document.documentElement.classList.add('denizen-phone-mode');
    injectStyles();
    buildFab();
    prefetchCrmBundle();
    maybeOpenPhoneFromQuery();
    // The hidden dock no longer takes vertical space — reclaim it for the game.
    document.documentElement.style.setProperty('--denizen-dock-height', '0px');

    document.addEventListener('denizen-deferred-scripts-ready', () => {
      markScriptsSettled();
      repaintAppIcons();
    });
    document.addEventListener('denizen-browser-mirror-ready', () => setTimeout(refreshAppStatuses, 50));
    loadBrowserMirrorScript().catch(() => {});
    document.addEventListener('denizen-visitor-session-ready', () => setTimeout(refreshAppStatuses, 500));
    document.addEventListener('denizen-visitor-profile-updated', () => setTimeout(refreshAppStatuses, 100));
    document.addEventListener('denizen-visitor-profile-switching', () => setTimeout(refreshAppStatuses, 100));
    // Fallback: settle even if the ready event never fires (cached fast loads).
    setTimeout(markScriptsSettled, 25_000);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!shellEl?.classList.contains('open')) return;
      if (currentApp) goHome(true);
      else closePhoneFromUi();
    });

    window.addEventListener('popstate', onPhonePopState);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.DenizenPhoneUi = {
    open: openPhone,
    close: closePhoneFromUi,
    toggle: togglePhone,
    goHome,
    openApp: (id) => {
      const app = APPS.find((a) => a.id === id);
      if (!app) return false;
      openPhone();
      activateApp(app);
      return true;
    },
    isOpen: () => !!shellEl?.classList.contains('open'),
    currentApp: () => currentApp?.id || null,
    getLayout: () => normalizePhoneLayout(phoneLayout),
    resetLayout: resetPhoneLayout,
    enterEditMode,
    exitEditMode,
  };
  window.DenizenPhoneUI = window.DenizenPhoneUi;
})();
