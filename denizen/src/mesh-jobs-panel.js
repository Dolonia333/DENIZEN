/**
 * Mesh jobs panel — fleet nodes, pending/running jobs, recent completions.
 *
 * Polls /api/compute/node/status (no auth) and /api/health or session fleet.
 * Toggle via bottom-dock chip, ?mesh=1, or window.DenizenMeshJobs.toggle().
 */
(function () {
  'use strict';

  const CHIP_ID = 'denizen-mesh-jobs-chip';
  const PANEL_ID = 'denizen-mesh-jobs-panel';
  const STYLE_ID = 'denizen-mesh-jobs-style';
  const POLL_MS = 20000;
  const STATUS_URL = '/api/compute/node/status';
  const HEALTH_URL = '/api/health';

  let chipEl = null;
  let panelEl = null;
  let pollTimer = null;
  let panelOpen = false;
  let busy = false;
  let snapshot = {
    pendingCount: 0,
    runningCount: 0,
    dbEnabled: false,
    pendingJobs: [],
    runningJobs: [],
    recentCompletions: [],
    fleet: [],
    inference: null,
    watchdogAlerts: [],
    resourcePressure: null,
    scalePlan: null,
    scaleActions: [],
    healthRunbook: null,
    fetchedAt: 0,
    error: null,
  };

  function getSessionId() {
    const sess = globalThis.DenizenVisitorSession;
    return sess?.getSessionId?.() || sess?.getProfile?.()?.sessionId || null;
  }

  function shortId(id) {
    const s = String(id || '');
    return s.length > 10 ? `${s.slice(0, 8)}…` : s;
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString();
    } catch (_) {
      return String(iso);
    }
  }

  function machineLabel(m) {
    return m?.label || m?.hostname || m?.machine_id || 'machine';
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CHIP_ID} {
        position: fixed;
        bottom: 14px;
        right: 14px;
        z-index: 9997;
        background: #0f172a;
        color: #a5f3fc;
        border: 1px solid #0e7490;
        border-radius: 14px;
        padding: 4px 10px;
        font: 11px monospace;
        cursor: pointer;
        max-width: 300px;
      }
      #${CHIP_ID}[data-state="busy"] { color: #fde68a; border-color: #b45309; }
      #${CHIP_ID}[data-state="idle"] { color: #86efac; border-color: #15803d; }
      #${PANEL_ID} {
        position: fixed;
        z-index: 100200;
        bottom: calc(var(--denizen-dock-height, 56px) + 10px + env(safe-area-inset-bottom, 0px));
        left: max(10px, env(safe-area-inset-left, 0px));
        right: max(10px, env(safe-area-inset-right, 0px));
        width: min(480px, calc(100vw - 20px));
        max-height: min(72vh, 560px);
        display: none;
        flex-direction: column;
        overflow: hidden;
        background: rgba(2, 6, 23, 0.97);
        color: #e2e8f0;
        border: 1px solid #334155;
        border-radius: 10px;
        font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        pointer-events: auto;
      }
      #${PANEL_ID}.open { display: flex !important; }
      #${PANEL_ID} header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid #334155;
        background: rgba(15, 23, 42, 0.9);
        flex-shrink: 0;
      }
      #${PANEL_ID} header h2 {
        margin: 0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #94a3b8;
      }
      #${PANEL_ID} .mesh-close {
        border: 1px solid #475569;
        background: rgba(51, 65, 85, 0.5);
        color: #cbd5e1;
        border-radius: 4px;
        padding: 4px 8px;
        cursor: pointer;
        font: inherit;
      }
      #${PANEL_ID} .mesh-body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 10px;
        -webkit-overflow-scrolling: touch;
      }
      #${PANEL_ID} .mesh-section {
        margin-bottom: 12px;
      }
      #${PANEL_ID} .mesh-section h3 {
        margin: 0 0 6px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: #64748b;
        text-transform: uppercase;
      }
      #${PANEL_ID} .mesh-row {
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 6px 8px;
        margin-bottom: 5px;
        background: rgba(30, 41, 59, 0.45);
      }
      #${PANEL_ID} .mesh-row.running { border-color: #b45309; }
      #${PANEL_ID} .mesh-row.done { border-color: #15803d; }
      #${PANEL_ID} .mesh-meta {
        color: #94a3b8;
        font-size: 10px;
      }
      #${PANEL_ID} .mesh-empty {
        color: #64748b;
        font-style: italic;
      }
      #${PANEL_ID} .mesh-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
      }
      #${PANEL_ID} .mesh-pill {
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid #334155;
        background: rgba(15, 23, 42, 0.8);
        color: #cbd5e1;
        font-size: 10px;
      }
    `;
    document.head.appendChild(style);
  }

  function buildUI() {
    injectStyles();
    if (chipEl && panelEl) return;

    chipEl = document.createElement('button');
    chipEl.id = CHIP_ID;
    chipEl.type = 'button';
    chipEl.title = 'City Power and connected stations';
    globalThis.DenizenBottomDock?.renderChip?.('denizen-mesh-jobs-chip', 'power');
    if (!globalThis.DenizenBottomDock?.renderChip) chipEl.textContent = '⬡ power';
    const openPanel = () => setPanelOpen(!panelOpen);
    const bind = globalThis.DenizenTouchBind?.bindPress;
    if (bind) bind(chipEl, openPanel);
    else chipEl.addEventListener('click', openPanel);
    document.body.appendChild(chipEl);

    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'City Power');
    panelEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(panelEl);
  }

  function setPanelOpen(open) {
    panelOpen = !!open;
    document.documentElement.classList.toggle('denizen-mesh-jobs-open', panelOpen);
    if (panelEl) {
      panelEl.classList.toggle('open', panelOpen);
      if (panelOpen) {
        globalThis.DenizenMobileSidebar?.close?.();
        globalThis.DenizenDeviceProfile?.resetPhonePanelLayout?.(panelEl);
        refresh();
        if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
      }
    }
    if (panelOpen) renderPanel();
  }

  function isTouchUi() {
    return document.documentElement.classList.contains('denizen-touch');
  }

  function paintChip() {
    if (!chipEl) return;
    const { pendingCount, runningCount, dbEnabled, error, watchdogAlerts, resourcePressure } = snapshot;
    const touch = isTouchUi();
    const pressureHigh = resourcePressure?.severity === 'critical' || resourcePressure?.severity === 'high';
    const paint = (label, title) => {
      globalThis.DenizenBottomDock?.renderChip?.('denizen-mesh-jobs-chip', label, { iconOnly: touch, title });
      if (!globalThis.DenizenBottomDock?.renderChip) chipEl.textContent = touch ? '⬡' : label;
      if (title) chipEl.title = title;
    };
    if (watchdogAlerts?.length || pressureHigh) {
      chipEl.dataset.state = 'busy';
      paint(touch ? '' : 'power ⚠', watchdogAlerts?.[0]?.message || 'City Power alert');
      return;
    }
    if (error) {
      chipEl.dataset.state = 'busy';
      paint(touch ? '' : 'power !', `City Power error: ${error}`);
      return;
    }
    if (!dbEnabled) {
      chipEl.dataset.state = '';
      paint(touch ? '' : 'power off', 'City Power is offline');
      return;
    }
    const active = pendingCount + runningCount;
    chipEl.dataset.state = active > 0 ? 'busy' : 'idle';
    if (touch) {
      paint('', active > 0
        ? `City Power - ${active} active (${pendingCount} waiting, ${runningCount} running)`
        : 'City Power - ready');
    } else {
      const title = 'City Power and connected stations';
      paint(active > 0 ? `power ${active}` : 'power', title);
    }
  }

  function renderJobRow(job, kind) {
    const type = job.job_type || job.type || '?';
    const pri = job.priority != null ? job.priority : '—';
    const id = shortId(job.id);
    const extra = kind === 'running'
      ? ` · node ${shortId(job.assigned_node_id)}`
      : kind === 'done'
        ? ` · ${fmtTime(job.completed_at)}`
        : '';
    return `<div class="mesh-row${kind === 'running' ? ' running' : kind === 'done' ? ' done' : ''}">
      <div><b>${type}</b> <span class="mesh-meta">#${id} · pri ${pri}${extra}</span></div>
    </div>`;
  }

  function renderFleetRow(m) {
    const jobs = Number(m.jobs_completed) || 0;
    const role = m.role ? ` · ${m.role}` : '';
    const cpu = m.cpu_percent != null ? ` · cpu ${Math.round(m.cpu_percent)}%` : '';
    return `<div class="mesh-row">
      <div><b>${machineLabel(m)}</b><span class="mesh-meta">${role}${cpu}</span></div>
      <div class="mesh-meta">city work completed: ${jobs}</div>
    </div>`;
  }

  function renderInferenceRow(n) {
    const ok = n.reachable !== false ? '✓' : '✗';
    const inflight = Number(n.inflight) || 0;
    const vram = n.vram_mb ? ` · ${Math.round(n.vram_mb / 1024)}GB VRAM` : '';
    const score = n.score != null ? ` · score ${n.score}` : '';
    return `<div class="mesh-row${n.reachable === false ? '' : ' done'}">
      <div><b>${ok} ${n.label || n.node_id}</b><span class="mesh-meta">${vram}${score}</span></div>
      <div class="mesh-meta">inflight ${inflight} · ${n.url || '—'}</div>
    </div>`;
  }

  function renderPanel() {
    if (!panelEl) return;
    const s = snapshot;
    const sections = [];

    sections.push(`<div class="mesh-summary">
      <span class="mesh-pill">waiting ${s.pendingCount}</span>
      <span class="mesh-pill">active ${s.runningCount}</span>
      <span class="mesh-pill">stations ${s.fleet.length}</span>
      <span class="mesh-pill">grid ${s.dbEnabled ? 'online' : 'offline'}</span>
    </div>`);

    if (s.error) {
      sections.push(`<div class="mesh-section"><div class="mesh-row">⚠ ${s.error}</div></div>`);
    }

    sections.push('<div class="mesh-section"><h3>Waiting city work</h3>');
    if (!s.pendingJobs.length) {
      sections.push('<div class="mesh-empty">(none queued)</div>');
    } else {
      sections.push(s.pendingJobs.map((j) => renderJobRow(j, 'pending')).join(''));
    }
    sections.push('</div>');

    sections.push('<div class="mesh-section"><h3>Active city work</h3>');
    if (!s.runningJobs.length) {
      sections.push('<div class="mesh-empty">(none assigned)</div>');
    } else {
      sections.push(s.runningJobs.map((j) => renderJobRow(j, 'running')).join(''));
    }
    sections.push('</div>');

    sections.push('<div class="mesh-section"><h3>Connected stations</h3>');
    if (!s.fleet.length) {
      sections.push('<div class="mesh-empty">(no stations online)</div>');
    } else {
      sections.push(s.fleet.map(renderFleetRow).join(''));
    }
    sections.push('</div>');

    sections.push('<div class="mesh-section"><h3>Local AI pool</h3>');
    const inf = s.inference;
    if (!inf?.nodes?.length) {
      sections.push('<div class="mesh-empty">(no inference nodes — set LM_STUDIO_REMOTE_URLS or add fleet agents with LM Studio)</div>');
    } else {
      const sel = inf.selected?.label || inf.selected?.url || '—';
      sections.push(`<div class="mesh-meta" style="margin-bottom:6px">router: ${inf.enabled ? 'on' : 'off'} · selected: ${sel}${inf.saturated ? ' · saturated' : ''}</div>`);
      sections.push(inf.nodes.map(renderInferenceRow).join(''));
    }
    sections.push('</div>');

    sections.push('<div class="mesh-section"><h3>Recent city work</h3>');
    if (!s.recentCompletions.length) {
      sections.push('<div class="mesh-empty">(none yet)</div>');
    } else {
      sections.push(s.recentCompletions.map((j) => renderJobRow(j, 'done')).join(''));
    }
    sections.push('</div>');

    const updated = s.fetchedAt ? fmtTime(new Date(s.fetchedAt).toISOString()) : '—';
    panelEl.innerHTML = `
      <header>
        <h2>CITY POWER</h2>
        <button type="button" class="mesh-close" aria-label="Close">✕</button>
      </header>
      <div class="mesh-body">
        ${sections.join('')}
        <div class="mesh-meta">updated ${updated} · refresh every ${POLL_MS / 1000}s</div>
      </div>`;

    panelEl.querySelector('.mesh-close')?.addEventListener('click', () => setPanelOpen(false));
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  async function fetchFleet() {
    const sid = getSessionId();
    if (!sid) return [];
    try {
      const live = await fetchJson(
        `/api/compute/hardware/live?session_id=${encodeURIComponent(sid)}`,
      );
      return Array.isArray(live.fleet) ? live.fleet : [];
    } catch (_) {
      return [];
    }
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const [status, fleet, pressure, scaleAdvice] = await Promise.all([
        fetchJson(`${STATUS_URL}?limit=25`).catch((err) => ({ _err: err?.message || String(err) })),
        fetchFleet(),
        fetchJson('/api/compute/resource-pressure').catch(() => null),
        fetchJson('/api/compute/scale-advice').catch(() => null),
      ]);

      if (status._err) {
        snapshot = {
          ...snapshot,
          error: status._err,
          fleet,
          fetchedAt: Date.now(),
        };
      } else {
        snapshot = {
          pendingCount: Number(status.pending_count) || (status.pending_jobs?.length ?? 0),
          runningCount: Number(status.running_count) || (status.running_jobs?.length ?? 0),
          dbEnabled: !!status.db_enabled,
          pendingJobs: Array.isArray(status.pending_jobs) ? status.pending_jobs : [],
          runningJobs: Array.isArray(status.running_jobs) ? status.running_jobs : [],
          recentCompletions: Array.isArray(status.recent_completions) ? status.recent_completions : [],
          fleet,
          inference: status.inference || null,
          resourcePressure: pressure?.signals || snapshot.resourcePressure,
          scalePlan: scaleAdvice?.plan || snapshot.scalePlan,
          fetchedAt: Date.now(),
          error: null,
        };
      }
    } catch (err) {
      snapshot = {
        ...snapshot,
        error: err?.message || String(err),
        fetchedAt: Date.now(),
      };
    } finally {
      busy = false;
      paintChip();
      if (panelOpen) renderPanel();
    }
  }

  function shouldShowMeshPanel() {
    const caps = globalThis.DenizenVisitorCapabilities;
    if (!caps) return false;
    return !!caps.canSeeMeshDashboard?.();
  }

  function onWsMessage(ev) {
    const msg = ev.detail;
    if (!msg) return;
    if (msg.type === 'mesh_watchdog_alert' && Array.isArray(msg.alerts)) {
      snapshot.watchdogAlerts = msg.alerts;
      paintChip();
      if (panelOpen) renderPanel();
    }
    if (msg.type === 'mesh_scale_action') {
      snapshot.scaleActions = [...(snapshot.scaleActions || []), msg].slice(-8);
      paintChip();
      if (panelOpen) renderPanel();
    }
    if (msg.type === 'resource_pressure_alert') {
      snapshot.resourcePressure = {
        severity: msg.severity,
        pressures: msg.pressures || [],
        queue_pending: msg.queue_pending,
      };
      paintChip();
      if (panelOpen) renderPanel();
    }
    if (msg.type === 'health_runbook_progress' || msg.type === 'health_runbook_complete') {
      snapshot.healthRunbook = {
        phase: msg.phase || (msg.type === 'health_runbook_complete' ? 'complete' : 'progress'),
        ok: msg.ok,
        issues: msg.issues,
      };
      if (panelOpen) renderPanel();
    }
  }

  function init() {
    document.addEventListener('denizen-ws-message', onWsMessage);
    if (!shouldShowMeshPanel()) {
      chipEl?.remove();
      panelEl?.remove();
      chipEl = null;
      panelEl = null;
      document.addEventListener('denizen-dashboard-gate', () => {
        if (shouldShowMeshPanel() && !chipEl) init();
      });
      document.addEventListener('denizen-visitor-session-ready', () => {
        if (shouldShowMeshPanel() && !chipEl) init();
      });
      return;
    }
    buildUI();
    refresh();
    setInterval(() => {
      if (panelOpen) refresh();
    }, POLL_MS);

    try {
      const auto = new URL(window.location.href).searchParams.get('mesh');
      if (auto === '1' || auto === 'open') setPanelOpen(true);
    } catch (_) {}

    globalThis.DenizenMeshJobs = {
      show: () => setPanelOpen(true),
      hide: () => setPanelOpen(false),
      toggle: () => setPanelOpen(!panelOpen),
      refresh,
      snapshot: () => snapshot,
    };
    globalThis.DenizenBottomDock?.refresh?.();
    console.log('[MeshJobs] panel ready (bottom-dock chip)');
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
