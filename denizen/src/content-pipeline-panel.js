/**
 * Content pipeline HUD — newsroom demo status, stop control, plain-English steps.
 */
(function () {
  'use strict';

  const PANEL_ID = 'denizen-content-pipeline-panel';
  const CHIP_ID = 'denizen-content-pipeline-chip';
  const STYLE_ID = 'denizen-content-pipeline-style';

  let panelEl = null;
  let open = false;
  let pollTimer = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${CHIP_ID} {
        cursor: pointer;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid #334155;
        background: #0f172a;
        color: #e2e8f0;
      }
      #${CHIP_ID}[data-active="true"] { border-color: #f97316; color: #fdba74; }
      #${PANEL_ID} {
        display: none;
        position: fixed;
        left: 12px;
        bottom: calc(var(--denizen-dock-height, 56px) + 12px);
        width: min(420px, calc(100vw - 24px));
        max-height: min(520px, 58vh);
        overflow: auto;
        z-index: 12050;
        background: rgba(2, 6, 23, 0.96);
        border: 1px solid #334155;
        border-radius: 10px;
        padding: 10px 12px;
        font: 11px/1.45 ui-monospace, monospace;
        color: #cbd5e1;
        box-shadow: 0 8px 32px rgba(0,0,0,0.45);
      }
      #${PANEL_ID}.open { display: block; }
      #${PANEL_ID} h3 { margin: 0 0 6px; font-size: 13px; color: #f8fafc; }
      #${PANEL_ID} .cp-explainer {
        margin: 0 0 10px;
        font-size: 11px;
        line-height: 1.45;
        color: #94a3b8;
      }
      #${PANEL_ID} .cp-row { padding: 4px 0; border-bottom: 1px solid #1e293b; }
      #${PANEL_ID} .cp-muted { color: #64748b; }
      #${PANEL_ID} .cp-warn { color: #fbbf24; }
      #${PANEL_ID} .cp-err { color: #f87171; }
      #${PANEL_ID} .cp-active {
        margin: 10px 0;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid #ea580c;
        background: rgba(124, 45, 18, 0.25);
      }
      #${PANEL_ID} .cp-active-title {
        font-weight: 700;
        color: #fdba74;
        margin-bottom: 4px;
      }
      #${PANEL_ID} .cp-active-step { color: #fde68a; margin-bottom: 6px; }
      #${PANEL_ID} .cp-steps {
        margin: 8px 0;
        padding: 0;
        list-style: none;
      }
      #${PANEL_ID} .cp-steps li {
        padding: 3px 0;
        color: #64748b;
        font-size: 10px;
      }
      #${PANEL_ID} .cp-steps li.current { color: #fbbf24; font-weight: 600; }
      #${PANEL_ID} .cp-steps li.done { color: #4ade80; }
      #${PANEL_ID} button {
        margin-top: 8px;
        padding: 10px 14px;
        border-radius: 8px;
        border: 1px solid #475569;
        background: #1e293b;
        color: #f1f5f9;
        cursor: pointer;
        font-size: 14px;
        min-height: 44px;
        touch-action: manipulation;
        width: 100%;
        box-sizing: border-box;
      }
      #${PANEL_ID} button.cp-stop {
        border-color: #b91c1c;
        background: #450a0a;
        color: #fecaca;
      }
      #${PANEL_ID} button:disabled { opacity: 0.55; cursor: not-allowed; }
      html.denizen-touch #${PANEL_ID}.open,
      html.denizen-phone-mode #${PANEL_ID}.open {
        display: block !important;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
      }
      html.denizen-phone-mode #${PANEL_ID}.open {
        padding: 12px 14px;
      }
    `;
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function fetchSummary() {
    const res = await fetch('/api/content-pipeline');
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }

  async function cancelPipeline(chainId) {
    const res = await fetch('/api/content-pipeline/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chainId ? { chainId } : {}),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }

  function renderStepList(running, stepOrder) {
    if (!running?.length || !Array.isArray(stepOrder) || !stepOrder.length) return '';
    const active = running[0];
    const currentIdx = Math.max(0, (active.currentStep || 1) - 1);
    const items = stepOrder.map((step, idx) => {
      let cls = '';
      if (idx < currentIdx) cls = 'done';
      else if (idx === currentIdx) cls = 'current';
      const mark = idx < currentIdx ? '✓ ' : (idx === currentIdx ? '▸ ' : '  ');
      return `<li class="${cls}">${mark}${esc(step.label || step.npc)}</li>`;
    }).join('');
    return `<ul class="cp-steps">${items}</ul>`;
  }

  function renderRunningCards(running, stepOrder) {
    if (!running?.length) return '';
    return running.map((r) => `
      <div class="cp-active" data-chain-id="${esc(r.chainId)}">
        <div class="cp-active-title">${esc(r.topic || r.name)}</div>
        <div class="cp-active-step">Step ${r.currentStep} of ${r.totalSteps}: ${esc(r.stepLabel)}</div>
        ${r.revisionCount > 0 ? `<div class="cp-muted">Revisions: ${r.revisionCount}</div>` : ''}
        ${renderStepList([r], stepOrder)}
        <button type="button" class="cp-stop" data-action="stop" data-chain-id="${esc(r.chainId)}">Stop pipeline</button>
      </div>
    `).join('');
  }

  function renderRecent(recent) {
    const rows = (recent || []).slice(0, 5).map((r) => {
      const status = String(r.status || 'unknown');
      const cls = status === 'running' ? 'cp-warn'
        : (status === 'complete' ? 'cp-muted' : (status === 'cancelled' ? 'cp-muted' : ''));
      return `<div class="cp-row ${cls}">${esc(r.name || r.topic)} <span class="cp-muted">[${esc(status)}]</span></div>`;
    }).join('');
    return rows || '<div class="cp-muted">No previous runs</div>';
  }

  function wireButtons(summary) {
    const startBtn = document.getElementById('cp-start-demo');
    if (startBtn) {
      startBtn.onclick = async () => {
        startBtn.disabled = true;
        startBtn.textContent = 'Starting…';
        try {
          await fetch('/api/content-pipeline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: 'AI media automation trends' }),
          });
          await refresh();
        } catch (_) {}
        startBtn.disabled = false;
        startBtn.textContent = 'Start demo pipeline';
      };
    }
    for (const btn of panelEl.querySelectorAll('[data-action="stop"]')) {
      btn.onclick = async () => {
        const chainId = btn.dataset.chainId || null;
        btn.disabled = true;
        btn.textContent = 'Stopping…';
        try {
          await cancelPipeline(chainId);
          await refresh();
        } catch (_) {
          btn.disabled = false;
          btn.textContent = 'Stop pipeline';
        }
      };
    }
  }

  function render(summary) {
    if (!panelEl) return;
    const running = Array.isArray(summary.running) ? summary.running : [];
    const hasActive = running.length > 0 || Number(summary.active) > 0;
    const explainer = summary.explainer
      || 'NPC newsroom demo: research, pitch, draft, edit, design, publish — runs in the background.';

    panelEl.innerHTML = `
      <h3>📰 Newsroom</h3>
      <p class="cp-explainer">${esc(explainer)}</p>
      <div class="cp-row">Running: <b>${summary.active || 0}</b> · Blocked: <span class="cp-err">${summary.blocked || 0}</span> · Finished: ${summary.complete || 0}${summary.cancelled ? ` · Stopped: ${summary.cancelled}` : ''}</div>
      ${renderRunningCards(running, summary.stepOrder)}
      ${!hasActive ? `
        <div style="margin-top:10px;font-size:10px;color:#94a3b8">Demo topic</div>
        <div class="cp-muted" style="margin-bottom:6px">AI media automation trends</div>
        <button type="button" id="cp-start-demo">Start demo pipeline</button>
      ` : '<div class="cp-muted" style="margin-top:8px">A pipeline is already running. Stop it before starting another.</div>'}
      <div style="margin-top:10px;font-size:10px;color:#94a3b8">History</div>
      ${renderRecent(summary.recent)}
    `;
    wireButtons(summary);
  }

  async function refresh() {
    try {
      const summary = await fetchSummary();
      render(summary);
      const chip = document.getElementById(CHIP_ID);
      if (chip) {
        const n = Number(summary.active || 0);
        const touch = document.documentElement.classList.contains('denizen-touch');
        globalThis.DenizenBottomDock?.renderChip?.(CHIP_ID, n > 0 ? String(n) : 'Newsroom', { iconOnly: touch && n === 0 });
        if (!globalThis.DenizenBottomDock?.renderChip) chip.textContent = n > 0 ? `📰 ${n}` : '📰';
        chip.dataset.badge = n > 0 ? String(n) : '';
      }
    } catch (_) {
      if (panelEl) {
        panelEl.innerHTML = '<h3>📰 Newsroom</h3><div class="cp-muted">Could not load status — is the server running?</div>';
      }
    }
  }

  function toggle() {
    open = !open;
    document.documentElement.classList.toggle('denizen-content-pipeline-open', open);
    if (panelEl) {
      panelEl.classList.toggle('open', open);
      if (open) {
        globalThis.DenizenMobileSidebar?.close?.();
        globalThis.DenizenDeviceProfile?.resetPhonePanelLayout?.(panelEl);
      }
    }
    const chip = document.getElementById(CHIP_ID);
    if (chip) chip.dataset.active = open ? 'true' : 'false';
    if (open) refresh();
  }

  function attachChip() {
    if (document.getElementById(CHIP_ID)) return;
    const chip = document.createElement('button');
    chip.id = CHIP_ID;
    chip.type = 'button';
    chip.title = 'Newsroom content pipeline';
    globalThis.DenizenBottomDock?.renderChip?.(CHIP_ID, 'Newsroom');
    if (!globalThis.DenizenBottomDock?.renderChip) chip.textContent = '📰';
    chip.classList.add('denizen-dock-chip');
    chip.addEventListener('click', toggle);
    document.body.appendChild(chip);
    globalThis.DenizenBottomDock?.refresh?.();
  }

  function init() {
    injectStyles();
    if (!document.getElementById(PANEL_ID)) {
      panelEl = document.createElement('div');
      panelEl.id = PANEL_ID;
      document.body.appendChild(panelEl);
    } else {
      panelEl = document.getElementById(PANEL_ID);
    }
    attachChip();
    refresh();
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (open || Number(document.getElementById(CHIP_ID)?.dataset?.badge || 0) > 0) {
          refresh();
        }
      }, 5000);
    }
  }

  globalThis.DenizenContentPipelinePanel = { init, refresh, toggle };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
