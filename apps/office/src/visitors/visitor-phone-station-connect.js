/**
 * Phone app — link Denizen Desktop to this Citizen ID (browser ↔ desktop sync).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-phone-station-style';
  const POLL_MS = 4000;

  let hostEl = null;
  let pollTimer = null;
  let busy = false;
  let busyProvision = false;
  let lastError = null;
  let lastProvision = null;

  function getState() {
    return globalThis.DenizenNodeUI?.getState?.() || {};
  }

  function sessionReady() {
    const api = globalThis.DenizenVisitorSession;
    return !!(api?.getSessionId?.());
  }

  async function ensurePairing() {
    if (typeof globalThis.DenizenDesktopPairing?.createPairingLink === 'function') return true;
    const lazy = globalThis.DenizenLazyScripts;
    if (lazy?.load) {
      await lazy.load(['./src/visitors/visitor-desktop-pairing.js?v=pair4']);
    }
    return typeof globalThis.DenizenDesktopPairing?.createPairingLink === 'function';
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      .dzp-station {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 4px 2px 16px;
      }
      .dzp-station-hero {
        border-radius: 14px;
        padding: 14px;
        background: linear-gradient(145deg, rgba(74, 222, 128, 0.14), rgba(15, 23, 42, 0.5));
        border: 1px solid rgba(74, 222, 128, 0.28);
      }
      .dzp-station-hero h3 {
        margin: 0 0 6px;
        font-size: 15px;
        color: #ecfdf5;
      }
      .dzp-station-hero p {
        margin: 0;
        font-size: 11px;
        line-height: 1.5;
        color: #94a3b8;
      }
      .dzp-station-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
        padding: 5px 10px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .dzp-station-status[data-state="linked"] {
        background: rgba(74, 222, 128, 0.18);
        color: #4ade80;
      }
      .dzp-station-status[data-state="pending"] {
        background: rgba(251, 191, 36, 0.16);
        color: #fbbf24;
      }
      .dzp-station-status[data-state="browser"] {
        background: rgba(148, 163, 184, 0.14);
        color: #cbd5e1;
      }
      .dzp-station-status-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: currentColor;
      }
      .dzp-station-steps {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .dzp-station-steps li {
        display: flex;
        gap: 10px;
        font-size: 11px;
        line-height: 1.45;
        color: #94a3b8;
      }
      .dzp-station-steps strong {
        flex: 0 0 18px;
        color: #4ade80;
        font-size: 12px;
      }
      .dzp-station-steps a {
        color: #7dd3fc;
        text-decoration: none;
      }
      .dzp-station-btn {
        width: 100%;
        border: none;
        border-radius: 12px;
        padding: 14px 16px;
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        touch-action: manipulation;
      }
      .dzp-station-btn.primary {
        background: #4ade80;
        color: #0f172a;
      }
      .dzp-station-btn.primary:hover { background: #22c55e; }
      .dzp-station-btn.secondary {
        background: rgba(30, 41, 59, 0.9);
        color: #93c5fd;
        border: 1px solid #334155;
      }
      .dzp-station-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .dzp-station-error {
        margin: 0;
        font-size: 10px;
        color: #fca5a5;
        line-height: 1.4;
      }
      .dzp-station-note {
        margin: 0;
        font-size: 10px;
        color: #64748b;
        line-height: 1.45;
      }
      .dzp-station-fleet {
        border-top: 1px solid rgba(51, 65, 85, 0.55);
        padding-top: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .dzp-station-fleet h4 {
        margin: 0;
        font-size: 12px;
        color: #e2e8f0;
      }
      .dzp-station-fleet p {
        margin: 0;
        font-size: 10px;
        color: #94a3b8;
        line-height: 1.45;
      }
      .dzp-station-fleet-list li strong {
        color: #e2e8f0;
        font-size: 11px;
      }
      .dzp-station-fleet-list li span {
        display: block;
        color: #64748b;
        font-size: 10px;
        margin-top: 2px;
      }
      .dzp-station-input {
        width: 100%;
        box-sizing: border-box;
        border-radius: 10px;
        border: 1px solid #334155;
        background: rgba(15, 23, 42, 0.85);
        color: #e2e8f0;
        font: inherit;
        font-size: 12px;
        padding: 10px 12px;
      }
      .dzp-station-code {
        margin: 0;
        padding: 10px;
        border-radius: 10px;
        background: rgba(2, 6, 23, 0.9);
        border: 1px solid #334155;
        color: #93c5fd;
        font-size: 9px;
        line-height: 1.45;
        word-break: break-all;
        max-height: 120px;
        overflow: auto;
      }
    `;
    document.head.appendChild(s);
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => {
      globalThis.DenizenNodeUI?.refresh?.().catch(() => null);
      paint();
    }, POLL_MS);
  }

  function statusMeta(state) {
    if (state.desktopLinked) {
      return {
        state: 'linked',
        label: 'Desktop linked',
        body: 'Your station is connected. Open City Power to choose how much you share with the mesh.',
      };
    }
    if (state.contributorState === 'desktop_setup_pending' || state.contributorState === 'needs_desktop_setup') {
      return {
        state: 'pending',
        label: 'Finish in Desktop app',
        body: 'Denizen Desktop is installed — approve pairing in the app to finish linking.',
      };
    }
    return {
      state: 'browser',
      label: 'Browser only',
      body: 'Link Denizen Desktop on this computer so your Citizen ID and City Power stay in sync.',
    };
  }

  function downloadHref(state) {
    const platform = globalThis.DenizenClientPlatform?.detect?.() || 'windows';
    return globalThis.DenizenClientPlatform?.directDownloadUrl?.(platform)
      || state.downloadUrl
      || '/desktop/download.html';
  }

  function platformLabel() {
    const platform = globalThis.DenizenClientPlatform?.detect?.() || 'windows';
    return globalThis.DenizenClientPlatform?.label?.(platform) || 'Desktop';
  }

  function paint() {
    if (!hostEl) return;
    const state = getState();
    const meta = statusMeta(state);
    const ready = sessionReady();
    const needsDownload = !!state.needsDesktopDownload;
    const linked = !!state.desktopLinked;
    const href = downloadHref(state);
    const label = platformLabel();

    const hero = hostEl.querySelector('.dzp-station-hero');
    if (hero) {
      hero.querySelector('p').textContent = meta.body;
      const status = hero.querySelector('.dzp-station-status');
      if (status) {
        status.dataset.state = meta.state;
        status.querySelector('.dzp-station-status-label').textContent = meta.label;
      }
    }

    const steps = hostEl.querySelector('.dzp-station-steps');
    if (steps) {
      if (linked) {
        steps.innerHTML = `
          <li><strong>✓</strong><span>Station linked — your browser and desktop share one Citizen ID.</span></li>
          <li><strong>→</strong><span>Open <strong>City Power</strong> to turn on mesh contribution when you want.</span></li>
        `;
      } else if (needsDownload) {
        steps.innerHTML = `
          <li><strong>1</strong><span>Install <a href="${href}" target="_blank" rel="noopener">Denizen Desktop (${label})</a> on this computer</span></li>
          <li><strong>2</strong><span>Keep the desktop app open, then tap <strong>Connect Desktop app</strong> below</span></li>
          <li><strong>3</strong><span>Approve the link in Denizen Desktop</span></li>
        `;
      } else {
        steps.innerHTML = `
          <li><strong>1</strong><span>Keep <strong>Denizen Desktop</strong> open on this computer</span></li>
          <li><strong>2</strong><span>Tap <strong>Connect Desktop app</strong> — we send a pairing link to the app</span></li>
          <li><strong>3</strong><span>Approve in the app, then enable City Power</span></li>
        `;
      }
    }

    const connectBtn = hostEl.querySelector('[data-act="connect"]');
    const cityBtn = hostEl.querySelector('[data-act="city-power"]');
    const downloadBtn = hostEl.querySelector('[data-act="download"]');
    const errEl = hostEl.querySelector('.dzp-station-error');

    if (connectBtn) {
      connectBtn.hidden = linked;
      connectBtn.disabled = busy || !ready;
      connectBtn.textContent = busy ? 'Opening link…' : 'Connect Desktop app';
    }
    if (cityBtn) {
      cityBtn.hidden = !linked;
    }
    if (downloadBtn) {
      downloadBtn.hidden = linked || !needsDownload;
    }
    if (errEl) {
      errEl.textContent = lastError || '';
      errEl.hidden = !lastError;
    }

    const fleetList = hostEl.querySelector('.dzp-station-fleet-list');
    if (fleetList) {
      const fleet = Array.isArray(state.fleet) ? state.fleet : [];
      if (fleet.length) {
        fleetList.innerHTML = fleet.slice(0, 4).map((m) => {
          const name = m.label || m.hostname || m.machine_id || 'station';
          const bits = [];
          if (m.reachable === true) bits.push('online');
          else if (m.reachable === false) bits.push('offline');
          if (m.cpu_percent != null) bits.push(`CPU ${Math.round(m.cpu_percent)}%`);
          return `<li><strong>${name}</strong><span>${bits.join(' · ') || m.role || 'linked'}</span></li>`;
        }).join('');
      } else {
        fleetList.innerHTML = '<li><span>No extra machines yet — add a NAS or Linux PC below.</span></li>';
      }
    }

    const provisionBtn = hostEl.querySelector('[data-act="provision"]');
    if (provisionBtn) {
      provisionBtn.disabled = busyProvision || !ready;
      provisionBtn.textContent = busyProvision ? 'Creating install link…' : 'Create install command';
    }
    const copyBtn = hostEl.querySelector('[data-act="copy-install"]');
    if (copyBtn) copyBtn.hidden = !lastProvision?.install_linux;
    const codeEl = hostEl.querySelector('.dzp-station-code');
    if (codeEl) {
      codeEl.textContent = lastProvision?.install_linux || '';
      codeEl.hidden = !lastProvision?.install_linux;
    }
  }

  function buildHtml() {
    return `
      <div class="dzp-station">
        <div class="dzp-station-hero">
          <h3>Link your office station</h3>
          <p>Sync this browser with Denizen Desktop on the same computer.</p>
          <div class="dzp-station-status" data-state="browser">
            <span class="dzp-station-status-dot" aria-hidden="true"></span>
            <span class="dzp-station-status-label">Checking…</span>
          </div>
        </div>
        <ol class="dzp-station-steps"></ol>
        <p class="dzp-station-error" hidden></p>
        <button type="button" class="dzp-station-btn primary" data-act="connect">Connect Desktop app</button>
        <button type="button" class="dzp-station-btn secondary" data-act="download">Download Denizen Desktop</button>
        <button type="button" class="dzp-station-btn secondary" data-act="city-power" hidden>Open City Power</button>
        <p class="dzp-station-note">Use the same computer for browser and desktop. If the app does not open, copy the pairing link from the popup.</p>
        <div class="dzp-station-fleet">
          <h4>Add another machine</h4>
          <p>NAS, old laptop, or Linux server — same fleet installer the operator mesh uses, tied to <strong>your</strong> Citizen ID.</p>
          <ul class="dzp-station-steps dzp-station-fleet-list"></ul>
          <input class="dzp-station-input" id="dzp-station-label" type="text" maxlength="48" placeholder="Machine name (e.g. Rilwan NAS)" />
          <button type="button" class="dzp-station-btn secondary" data-act="provision">Create install command</button>
          <pre class="dzp-station-code" hidden></pre>
          <button type="button" class="dzp-station-btn secondary" data-act="copy-install" hidden>Copy install command</button>
          <p class="dzp-station-note">SSH into the other machine, paste the command, and wait for <strong>agent.log</strong>. Requires Node.js on that machine.</p>
        </div>
      </div>
    `;
  }

  async function copyText(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}
    return false;
  }

  function sessionHeaders() {
    const api = globalThis.DenizenVisitorSession;
    const sid = api?.getSessionId?.();
    const token = api?.getSessionToken?.();
    const headers = { 'Content-Type': 'application/json' };
    if (sid) headers['X-Session-Id'] = sid;
    if (token) headers['X-Session-Token'] = token;
    return headers;
  }

  async function onProvision() {
    if (busyProvision || !sessionReady()) return;
    busyProvision = true;
    lastError = null;
    paint();
    try {
      const api = globalThis.DenizenVisitorSession;
      if (api?.init) await api.init().catch(() => null);
      const label = hostEl?.querySelector('#dzp-station-label')?.value?.trim() || 'My station';
      const res = await fetch('/api/compute/station/provision', {
        method: 'POST',
        headers: sessionHeaders(),
        body: JSON.stringify({ label }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Provision failed (${res.status})`);
      }
      lastProvision = data;
    } catch (err) {
      lastError = err?.message || 'Could not create install command';
      lastProvision = null;
    } finally {
      busyProvision = false;
      paint();
    }
  }

  async function onCopyInstall() {
    const ok = await copyText(lastProvision?.install_linux || '');
    if (!ok) lastError = 'Copy failed — select the command manually';
    else lastError = null;
    paint();
  }

  async function onConnect() {
    if (busy || !sessionReady()) return;
    busy = true;
    lastError = null;
    paint();
    try {
      const api = globalThis.DenizenVisitorSession;
      if (api?.init) await api.init().catch(() => null);
      const ready = await ensurePairing();
      if (!ready) {
        lastError = 'Pairing UI still loading — try again.';
        return;
      }
      await globalThis.DenizenDesktopPairing.createPairingLink();
    } catch (err) {
      lastError = err?.message || 'Could not start pairing';
    } finally {
      busy = false;
      paint();
    }
  }

  function onDownload() {
    const href = downloadHref(getState());
    try {
      window.open(href, '_blank', 'noopener');
    } catch (_) {
      window.location.href = href;
    }
  }

  function onCityPower() {
    if (globalThis.DenizenPhoneUI?.openApp?.('compute')) return;
    if (globalThis.DenizenMobileSidebar?.isTouchDrawerMode?.()) {
      globalThis.DenizenMobileSidebar?.open?.();
      document.querySelector('#denizen-mobile-drawer .drawer-tab[data-tab="compute"]')?.click();
      return;
    }
    globalThis.DenizenNodeUI?.showPanel?.({ persist: false });
  }

  function wireEvents() {
    if (!hostEl) return;
    hostEl.onclick = (e) => {
      const act = e.target?.closest?.('[data-act]')?.dataset?.act;
      if (act === 'connect') {
        e.preventDefault();
        onConnect().catch(() => null);
      } else if (act === 'download') {
        e.preventDefault();
        onDownload();
      } else if (act === 'city-power') {
        e.preventDefault();
        onCityPower();
      } else if (act === 'provision') {
        e.preventDefault();
        onProvision().catch(() => null);
      } else if (act === 'copy-install') {
        e.preventDefault();
        onCopyInstall().catch(() => null);
      }
    };
  }

  async function render(host) {
    injectStyles();
    hostEl = host;
    lastError = null;
    busy = false;
    lastProvision = null;
    hostEl.innerHTML = buildHtml();
    wireEvents();

    const api = globalThis.DenizenVisitorSession;
    if (api?.init) await api.init().catch(() => null);
    globalThis.DenizenClientPlatform?.loadDownloads?.()?.catch?.(() => null);
    globalThis.DenizenNodeUI?.refresh?.().catch(() => null);
    paint();
    startPoll();
  }

  function unmount() {
    stopPoll();
    if (hostEl) hostEl.onclick = null;
    hostEl = null;
    lastError = null;
    busy = false;
    lastProvision = null;
  }

  function refresh() {
    paint();
  }

  globalThis.DenizenPhoneStationConnect = {
    render,
    unmount,
    refresh,
    isLinked: () => !!getState().desktopLinked,
  };

  document.addEventListener('denizen-node-status', () => {
    if (hostEl) paint();
  });
})();
