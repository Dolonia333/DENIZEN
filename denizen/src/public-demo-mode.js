/**
 * Browser: ?mode=demo or ?demo=1 — 4-NPC read-only spectator (Phase 4.1 scaffold).
 * Load immediately after npc-roster.js.
 *
 * Banner appears briefly at the top, then slides away so Feed / HQ toggles stay usable.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const active = params.get('mode') === 'demo' || params.get('demo') === '1';
  if (!active) {
    globalThis.DenizenPublicDemo = { active: false };
    return;
  }

  const DISMISS_KEY = 'denizen_public_demo_banner_dismissed';
  const SHOW_MS = 5500;
  const defaultFolders = ['abby', 'alex', 'lucy', 'bouncer'];
  const raw = params.get('demo_npcs') || params.get('npcs') || '';
  const folders = raw
    ? raw.split(/[,;|]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    : defaultFolders;

  function applyRosterFilter() {
    const base = globalThis.DenizenNpcRoster;
    if (!base || !Array.isArray(base.entries)) return;
    const allow = new Set(folders);
    const entries = base.entries.filter((e) => allow.has(e.folder));
    if (!entries.length) return;
    const nameToKey = Object.fromEntries(entries.map((e) => [e.display.toLowerCase(), e.textureKey]));
    const keyToDisplay = Object.fromEntries(entries.map((e) => [e.textureKey, e.display]));
    base.entries = entries;
    base.nameToKey = nameToKey;
    base.keyToDisplay = keyToDisplay;
    base.displayNames = entries.map((e) => e.display);
    base.assetNames = entries.map((e) => e.assetName);
    base.displayToGender = Object.fromEntries(entries.map((e) => [e.display, e.gender || null]));
  }

  applyRosterFilter();

  let hideTimer = null;

  function setBannerVisible(visible) {
    const banner = document.getElementById('denizen-public-demo-banner');
    if (!banner) return;
    if (visible) {
      banner.classList.remove('is-hiding', 'is-gone');
      banner.setAttribute('aria-hidden', 'false');
      document.documentElement.classList.add('denizen-public-demo-banner-open');
    } else {
      dismissBanner({ persist: false });
    }
  }

  function dismissBanner({ persist = true } = {}) {
    const banner = document.getElementById('denizen-public-demo-banner');
    if (!banner || banner.classList.contains('is-gone')) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    banner.classList.add('is-hiding');
    banner.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('denizen-public-demo-banner-open');
    if (persist) {
      try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
    }
    window.setTimeout(() => {
      banner.classList.add('is-gone');
      banner.style.display = 'none';
    }, 320);
  }

  globalThis.DenizenPublicDemo = {
    active: true,
    readOnly: true,
    npcFolders: folders,
    label: 'Public demo — watch the office (chat disabled). Team login for full access.',
    setBannerVisible,
    dismissBanner,
  };

  document.documentElement.classList.add('denizen-public-demo');

  document.addEventListener('DOMContentLoaded', () => {
    let alreadyDismissed = false;
    try { alreadyDismissed = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch (_) {}

    const style = document.createElement('style');
    style.id = 'denizen-public-demo-banner-style';
    style.textContent = `
      #denizen-public-demo-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 100800;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 7px 36px 7px 12px;
        text-align: center;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
        background: rgba(30, 58, 138, 0.94);
        color: #bfdbfe;
        border-bottom: 1px solid #3b82f6;
        transform: translateY(0);
        opacity: 1;
        transition: transform 0.3s ease, opacity 0.3s ease;
        pointer-events: auto;
      }
      #denizen-public-demo-banner.is-hiding {
        transform: translateY(-110%);
        opacity: 0;
        pointer-events: none;
      }
      #denizen-public-demo-banner.is-gone { display: none !important; }
      #denizen-public-demo-banner .pdb-copy { flex: 1; min-width: 0; }
      #denizen-public-demo-banner .pdb-dismiss {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.12);
        color: #e2e8f0;
        font: 700 14px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      #denizen-public-demo-banner .pdb-dismiss:hover {
        background: rgba(255, 255, 255, 0.22);
      }
      /* Nudge top-left toggles only — never set top on the level chip
         (it is bottom-anchored; top+bottom stretches it into a tall pill). */
      html.denizen-public-demo-banner-open #denizen-work-feed-toggle,
      html.denizen-public-demo-banner-open #denizen-office-hq-toggle {
        top: max(40px, calc(env(safe-area-inset-top, 0px) + 36px)) !important;
        transition: top 0.25s ease;
      }
    `;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.id = 'denizen-public-demo-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML =
      `<span class="pdb-copy"></span>` +
      `<button type="button" class="pdb-dismiss" aria-label="Dismiss demo banner">×</button>`;
    banner.querySelector('.pdb-copy').textContent = globalThis.DenizenPublicDemo.label;
    banner.querySelector('.pdb-dismiss').addEventListener('click', () => dismissBanner({ persist: true }));
    document.body.prepend(banner);

    if (alreadyDismissed) {
      banner.classList.add('is-gone');
      banner.style.display = 'none';
      banner.setAttribute('aria-hidden', 'true');
      return;
    }

    document.documentElement.classList.add('denizen-public-demo-banner-open');
    hideTimer = window.setTimeout(() => dismissBanner({ persist: true }), SHOW_MS);
  });
})();
