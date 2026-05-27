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
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  show() {
    if (this._visible) return;
    this._visible = true;
    if (this._panel) {
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
          bottom: max(52px, calc(env(safe-area-inset-bottom, 0px) + 52px));
          left: max(8px, env(safe-area-inset-left, 0px));
          width: 320px;
          max-height: 200px;
          background: rgba(0, 0, 0, 0.75);
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
          color: #475569;
          font-size: 10px;
          flex-shrink: 0;
          user-select: none;
        }
        #denizen-work-feed-header .wf-title {
          color: #64748b;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        #denizen-work-feed-header .wf-hint {
          color: #334155;
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
        .wf-entry .wf-artifact {
          flex-shrink: 0;
          font-size: 11px;
          margin-left: 2px;
          opacity: 0.7;
        }
        .wf-entry .wf-ts {
          flex-shrink: 0;
          color: #334155;
          font-size: 9px;
          margin-left: 4px;
          min-width: 38px;
          text-align: right;
        }
        #denizen-work-feed-empty {
          padding: 12px 8px;
          color: #334155;
          font-size: 10px;
          font-style: italic;
          text-align: center;
        }
        #denizen-work-feed-toggle {
          position: fixed;
          top: max(8px, env(safe-area-inset-top, 0px));
          left: max(8px, env(safe-area-inset-left, 0px));
          z-index: 9999;
          background: rgba(0, 0, 0, 0.6);
          color: #475569;
          border: 1px solid #1e293b;
          border-radius: 4px;
          padding: 3px 7px;
          font: 10px/1.4 'Courier New', Courier, monospace;
          cursor: pointer;
          user-select: none;
          letter-spacing: 0.04em;
          transition: color 0.15s, border-color 0.15s;
        }
        #denizen-work-feed-toggle:hover,
        #denizen-work-feed-toggle[data-active="true"] {
          color: #94a3b8;
          border-color: #334155;
        }
      `;
      document.head.appendChild(style);
    }

    // Main panel
    const panel = document.createElement('div');
    panel.id = 'denizen-work-feed';

    panel.innerHTML = `
      <div id="denizen-work-feed-header">
        <span class="wf-title">work feed</span>
        <span class="wf-hint">Tab to close</span>
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
    const btn = document.createElement('button');
    btn.id = 'denizen-work-feed-toggle';
    btn.type = 'button';
    btn.textContent = '[feed]';
    btn.dataset.active = 'false';
    btn.title = 'Work Output Feed (Tab)';
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
      empty.textContent = 'No activity yet';
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
      (entry.artifactPath ? `<span class="wf-artifact" title="${this._esc(entry.artifactPath)}">&#x1F4C4;</span>` : '') +
      `<span class="wf-ts">${tsStr}</span>`;

    // Store ts on the element so we can update relative timestamps later (optional)
    el.dataset.ts = String(entry.ts);

    return el;
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
