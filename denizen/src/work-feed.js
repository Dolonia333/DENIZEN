/**
 * Work Output Feed — live HUD panel showing what NPCs are doing in real time.
 *
 * Displays a terminal-style tail log in the bottom-left corner.
 * Press Tab to toggle, or click the [feed] button in the top-left corner.
 *
 * Receives data via WorkFeedPanel.addEntry(data) where data matches the
 * npc_work_output WebSocket message shape:
 *   { npcName, phase, phaseEmoji, note, action, artifactPath, ts }
 */

const NPC_ROLE_COLORS = {
  'Abby':    '#ffffff',
  'Alex':    '#4a9eff',
  'Josh':    '#4a9eff',
  'Edward':  '#4a9eff',
  'Jenny':   '#4a9eff',
  'Roki':    '#aaaaaa',
  'Molly':   '#ffd700',
  'Oscar':   '#44ff88',
  'Dan':     '#44ff88',
  'Sarah':   '#cc88ff',
  'Rob':     '#cc88ff',
  'Marcus':  '#cc88ff',
  'Bob':     '#ffaa44',
  'Lucy':    '#ff88cc',
  'Bouncer': '#ff4444',
  'Pier':    '#44ffff',
};

class WorkFeedPanel {
  constructor(scene) {
    this.scene = scene;
    this._visible = false;
    this._entries = [];       // full history, newest first
    this._maxHistory = 100;   // keep up to 100 in memory
    this._maxVisible = 20;    // show at most 20 in the DOM

    this._panel = null;
    this._list = null;
    this._toggleBtn = null;

    this._createDOM();
    this._createToggleButton();
    this._bindKeys();

    // Portrait phones: the feed docks under the game (CSS below) and starts
    // open, so the space under the 16:9 frame shows the work instead of
    // empty skyline. Hiding it with the Feed pill is remembered.
    if (WorkFeedPanel._isPortraitPhone() && !WorkFeedPanel._dockDismissed()) this.show();
  }

  static _isPortraitPhone() {
    const c = document.documentElement.classList;
    return c.contains('denizen-phone') && c.contains('denizen-portrait');
  }

  static _dockDismissed() {
    try { return localStorage.getItem('denizen-feed-dock-hidden') === '1'; } catch (_) { return false; }
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  show() {
    if (this._visible) return;
    this._visible = true;
    if (this._panel) {
      // Open directly under the Feed button — it moves (the public demo
      // banner nudges the top-left pills down), so measure at open time.
      const r = this._toggleBtn?.getBoundingClientRect?.();
      if (r && r.height) this._panel.style.top = `${Math.round(r.bottom + 6)}px`;
      this._panel.style.display = 'flex';
      // Small slide-in: start slightly left, animate to final position
      this._panel.style.transform = 'translateX(-20px)';
      this._panel.style.opacity = '0';
      requestAnimationFrame(() => {
        this._panel.style.transition = 'transform 0.18s ease-out, opacity 0.18s ease-out';
        this._panel.style.transform = 'translateX(0)';
        this._panel.style.opacity = '1';
      });
    }
    if (this._toggleBtn) this._toggleBtn.dataset.active = 'true';
    this._renderList();
  }

  hide() {
    if (!this._visible) return;
    this._visible = false;
    if (this._panel) {
      this._panel.style.transition = 'transform 0.15s ease-in, opacity 0.15s ease-in';
      this._panel.style.transform = 'translateX(-20px)';
      this._panel.style.opacity = '0';
      setTimeout(() => {
        if (!this._visible && this._panel) {
          this._panel.style.display = 'none';
        }
      }, 160);
    }
    if (this._toggleBtn) this._toggleBtn.dataset.active = 'false';
  }

  toggle() {
    if (this._visible) this.hide();
    else this.show();
    if (WorkFeedPanel._isPortraitPhone()) {
      try { localStorage.setItem('denizen-feed-dock-hidden', this._visible ? '0' : '1'); } catch (_) {}
    }
  }

  /**
   * Add a new work output entry to the feed.
   * data = { npcName, phase, phaseEmoji, note, action, artifactPath, ts }
   */
  addEntry(data) {
    if (!data) return;
    const entry = {
      npcName:      data.npcName     || '?',
      phase:        data.phase       || '',
      phaseEmoji:   data.phaseEmoji  || '•',
      note:         data.note        || '',
      action:       data.action      || '',
      artifactPath: data.artifactPath || null,
      ts:           data.ts          || Date.now(),
    };

    // Newest first
    this._entries.unshift(entry);

    // Trim history
    if (this._entries.length > this._maxHistory) {
      this._entries.length = this._maxHistory;
    }

    if (this._visible) {
      this._prependEntryDOM(entry);
      this._trimDOMEntries();
    }
  }

  // ------------------------------------------------------------------
  // DOM creation
  // ------------------------------------------------------------------

  _createDOM() {
    // Inject styles once
    if (!document.getElementById('denizen-work-feed-style')) {
      const style = document.createElement('style');
      style.id = 'denizen-work-feed-style';
      style.textContent = `
        #denizen-work-feed {
          position: fixed;
          /* Under the Feed pill (show() refines this from the pill's rect).
             It used to sit bottom-left above the dock, which phone mode hides,
             so it opened in the opposite corner from its button. */
          top: calc(max(8px, env(safe-area-inset-top, 0px)) + 32px);
          left: max(8px, env(safe-area-inset-left, 0px));
          width: 320px;
          max-height: 200px;
          background: rgba(2, 6, 23, 0.96); /* opaque enough that the clock chip under it doesn't ghost through */
          border: 1px solid #1e293b;
          border-radius: 6px;
          display: none;
          flex-direction: column;
          z-index: 9998;
          font-family: 'Courier New', Courier, monospace;
          font-size: 11px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
          overflow: hidden;
        }
        #denizen-work-feed-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 8px;
          border-bottom: 1px solid #1e293b;
          color: #64748b;
          font-size: 10px;
          flex-shrink: 0;
          user-select: none;
        }
        #denizen-work-feed-header .wf-title {
          color: #94a3b8;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        #denizen-work-feed-header .wf-hint {
          color: #64748b;
          font-size: 9px;
        }
        #denizen-work-feed-list {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 4px 0;
        }
        #denizen-work-feed-list::-webkit-scrollbar {
          width: 3px;
        }
        #denizen-work-feed-list::-webkit-scrollbar-track {
          background: transparent;
        }
        #denizen-work-feed-list::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 2px;
        }
        .wf-entry {
          display: flex;
          align-items: baseline;
          gap: 4px;
          padding: 2px 8px;
          line-height: 1.45;
          animation: wf-fade-in 0.2s ease-out;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @keyframes wf-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .wf-entry .wf-emoji {
          flex-shrink: 0;
          color: #94a3b8;
          font-size: 10px;
          width: 12px;
          text-align: center;
        }
        .wf-entry .wf-name {
          flex-shrink: 0;
          font-weight: bold;
          font-size: 11px;
          min-width: 42px;
        }
        .wf-entry .wf-note {
          color: #cccccc;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 10px;
        }
        .wf-entry .wf-report-link {
          flex-shrink: 0;
          margin-left: 4px;
          font-size: 10px;
          color: #38bdf8;
          text-decoration: none;
          max-width: 88px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .wf-entry .wf-report-link:hover {
          color: #7dd3fc;
          text-decoration: underline;
        }
        .wf-entry .wf-ts {
          flex-shrink: 0;
          color: #64748b;
          font-size: 9px;
          margin-left: 4px;
          min-width: 38px;
          text-align: right;
        }
        #denizen-work-feed-empty {
          padding: 12px 8px;
          color: #94a3b8;
          font-size: 10px;
          font-style: italic;
          text-align: center;
        }
        .wf-empty-cta {
          margin-top: 10px;
          padding: 6px 14px;
          font: 600 11px/1.3 system-ui, sans-serif;
          font-style: normal;
          color: #0b1220;
          background: #7dd3fc;
          border: 1px solid #020617;
          border-radius: 999px;
          cursor: pointer;
        }
        html.denizen-phone.denizen-portrait .wf-empty-cta { font-size: 13px; padding: 10px 20px; min-height: 44px; }
        /* Portrait phone: dock under the HQ frame (--denizen-frame-bottom
           comes from mobile-controls.js), full width, clear of Buzz/Speak. */
        html.denizen-phone.denizen-portrait #denizen-work-feed {
          top: calc(var(--denizen-frame-bottom, 230px) + 10px) !important;
          left: 8px;
          right: 8px;
          width: auto;
          max-height: calc(100dvh - var(--denizen-frame-bottom, 230px) - 124px);
          font-size: 12px;
        }
        html.denizen-phone.denizen-portrait #denizen-work-feed-header { font-size: 11px; padding: 8px 10px; }
        html.denizen-phone.denizen-portrait #denizen-work-feed-header .wf-hint { display: none; }
        html.denizen-phone.denizen-portrait .wf-entry { padding: 4px 10px; }
        html.denizen-phone.denizen-portrait .wf-entry .wf-note { font-size: 12px; }
        html.denizen-phone.denizen-portrait #denizen-work-feed-empty {
          font-size: 13px;
          padding: 18px 16px;
          line-height: 1.5;
        }
        #denizen-work-feed-toggle {
          position: fixed;
          top: max(8px, env(safe-area-inset-top, 0px));
          left: max(8px, env(safe-area-inset-left, 0px));
          z-index: 9999;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: rgba(2, 6, 23, 0.75);
          color: #94a3b8;
          border: 1px solid #334155;
          border-radius: 999px;
          padding: 4px 10px;
          font: 11px/1.4 system-ui, sans-serif;
          cursor: pointer;
          user-select: none;
          letter-spacing: 0.02em;
          transition: color 0.15s, border-color 0.15s;
        }
        #denizen-work-feed-toggle:hover,
        #denizen-work-feed-toggle[data-active="true"] {
          color: #dbeafe;
          border-color: #60a5fa;
        }
      `;
      document.head.appendChild(style);
    }

    // Main panel — remove any earlier instance first (office-scene and
    // lazy-scripts can both construct WorkFeedPanel; duplicate ids stack
    // dead elements on top of live ones and swallow taps).
    document.getElementById('denizen-work-feed')?.remove();
    const panel = document.createElement('div');
    panel.id = 'denizen-work-feed';

    panel.innerHTML = `
      <div id="denizen-work-feed-header">
        <span class="wf-title">work feed</span>
        <span class="wf-hint">Tab · click report to open</span>
      </div>
      <div id="denizen-work-feed-list"></div>
    `;
    document.body.appendChild(panel);

    this._panel = panel;
    this._list = panel.querySelector('#denizen-work-feed-list');

    // Block game input while hovering panel
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  _createToggleButton() {
    document.getElementById('denizen-work-feed-toggle')?.remove();
    const btn = document.createElement('button');
    btn.id = 'denizen-work-feed-toggle';
    btn.type = 'button';
    const ti = globalThis.DenizenTablerIcons?.icon;
    btn.innerHTML = ti
      ? `${ti('clipboard-list', { size: 14 })} Feed`
      : 'Feed';
    btn.dataset.active = 'false';
    btn.title = 'Work output feed — what your agents produced (Tab)';
    btn.addEventListener('click', () => this.toggle());
    document.body.appendChild(btn);
    this._toggleBtn = btn;
  }

  _bindKeys() {
    // Tab key via document listener so it works independent of Phaser focus.
    // We use the document-level listener pattern the existing editor uses.
    document.addEventListener('keydown', (e) => {
      // Don't steal Tab from inputs / textareas / selects
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Tab') {
        e.preventDefault(); // prevent focus cycling
        this.toggle();
      }
    });
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  /**
   * Full re-render of the list (used when opening the panel).
   */
  _renderList() {
    if (!this._list) return;
    this._list.innerHTML = '';

    const visible = this._entries.slice(0, this._maxVisible);
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.id = 'denizen-work-feed-empty';
      empty.textContent = 'Nothing shipped yet — tap a resident on the floor and ask them for something.';
      // Give the empty state somewhere to go — except in the spectator-only
      // public demo (?demo=1), where chat is off.
      if (window.__DenizenPlayerChat?.open && !globalThis.DenizenPublicDemo?.active) {
        const cta = document.createElement('button');
        cta.type = 'button';
        cta.className = 'wf-empty-cta';
        cta.textContent = 'Open chat';
        cta.addEventListener('click', () => window.__DenizenPlayerChat?.open?.());
        empty.appendChild(document.createElement('br'));
        empty.appendChild(cta);
      }
      this._list.appendChild(empty);
      return;
    }

    visible.forEach(entry => {
      this._list.appendChild(this._buildEntryEl(entry));
    });
  }

  /**
   * Prepend a single new entry to the top of the DOM list (live update).
   */
  _prependEntryDOM(entry) {
    if (!this._list) return;

    // Remove empty-state placeholder if present
    const empty = this._list.querySelector('#denizen-work-feed-empty');
    if (empty) empty.remove();

    const el = this._buildEntryEl(entry);
    this._list.insertBefore(el, this._list.firstChild);
  }

  /**
   * Remove DOM entries beyond the max visible limit.
   */
  _trimDOMEntries() {
    if (!this._list) return;
    const entries = this._list.querySelectorAll('.wf-entry');
    for (let i = this._maxVisible; i < entries.length; i++) {
      entries[i].remove();
    }
  }

  /**
   * Build a DOM element for one feed entry.
   */
  _buildEntryEl(entry) {
    const el = document.createElement('div');
    el.className = 'wf-entry';

    const nameColor = NPC_ROLE_COLORS[entry.npcName] || '#94a3b8';
    const tsStr = this._relativeTime(entry.ts);
    const noteEsc = this._esc(entry.note);
    const nameEsc = this._esc(entry.npcName);

    el.innerHTML =
      `<span class="wf-emoji">${this._esc(entry.phaseEmoji)}</span>` +
      `<span class="wf-name" style="color:${nameColor}">${nameEsc}</span>` +
      `<span class="wf-note">${noteEsc}</span>` +
      `<span class="wf-ts">${tsStr}</span>`;

    const reportHref = this._reportHref(entry.artifactPath);
    if (reportHref) {
      const link = document.createElement('a');
      link.className = 'wf-report-link';
      link.href = reportHref;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = entry.artifactPath;
      link.textContent = this._reportLinkLabel(entry.artifactPath);
      link.addEventListener('click', (e) => e.stopPropagation());
      link.addEventListener('mousedown', (e) => e.stopPropagation());
      el.insertBefore(link, el.querySelector('.wf-ts'));
    }

    el.dataset.ts = String(entry.ts);

    return el;
  }

  /** Normalize artifact path → browser URL under the Denizen server. */
  _reportHref(artifactPath) {
    if (!artifactPath || typeof artifactPath !== 'string') return null;
    let p = artifactPath.replace(/\\/g, '/').trim();
    if (!p) return null;
    const idx = p.indexOf('reports/');
    if (idx >= 0) p = p.slice(idx);
    else if (!p.startsWith('reports/')) p = `reports/${p.replace(/^\/+/, '')}`;
    if (p.includes('..')) return null;
    return '/' + p.split('/').map(seg => encodeURIComponent(seg)).join('/');
  }

  _reportLinkLabel(artifactPath) {
    const name = String(artifactPath || '').replace(/\\/g, '/').split('/').pop() || 'report';
    const short = name.replace(/\.md$/i, '').slice(0, 22);
    return short.length < name.replace(/\.md$/i, '').length ? short + '…' : short;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  _relativeTime(ts) {
    if (!ts) return '';
    const diffMs = Date.now() - ts;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 5)  return 'just now';
    if (diffSec < 60) return diffSec + 's ago';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + 'm ago';
    return Math.floor(diffMin / 60) + 'h ago';
  }

  _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

window.WorkFeedPanel = WorkFeedPanel;
