/**
 * Skill-gap pipeline progress — visitor-visible toasts when Lucy researches
 * GitHub and drafts skill proposals for CEO approval.
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-skill-gap-ui-style';
  const PANEL_ID = 'denizen-skill-gap-panel';

  const PHASE_LABELS = {
    discover: 'Searching skill catalog',
    research: 'Researching requirements',
    github: 'Scanning GitHub',
    build_skill: 'Drafting skill proposal',
    existing_skill: 'Found existing skill',
    notify_ceo: 'Notifying leadership',
    complete: 'Pipeline complete',
    error: 'Pipeline error',
  };

  let panelEl = null;
  let hideTimer = null;
  let active = null;

  function caps() {
    return globalThis.DenizenVisitorCapabilities || {};
  }

  function isTeam() {
    return !!caps().isTeam?.() || !!caps().isCeo?.();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${PANEL_ID} {
        position: fixed;
        left: max(12px, env(safe-area-inset-left));
        right: max(12px, env(safe-area-inset-right));
        bottom: calc(var(--denizen-dock-height, 56px) + 14px + env(safe-area-inset-bottom));
        z-index: 100150;
        display: none;
        max-width: min(420px, calc(100vw - 24px));
        margin: 0 auto;
        background: rgba(2, 6, 23, 0.96);
        border: 1px solid rgba(167, 139, 250, 0.45);
        border-radius: 10px;
        padding: 10px 12px;
        font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #e2e8f0;
        box-shadow: 0 12px 28px rgba(0,0,0,0.45);
        pointer-events: auto;
      }
      #${PANEL_ID}.open { display: block; }
      #${PANEL_ID} .sg-title {
        margin: 0 0 4px;
        font-size: 10px;
        font-weight: bold;
        color: #c4b5fd;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      #${PANEL_ID} .sg-phase { margin: 0 0 6px; color: #f8fafc; font-weight: bold; }
      #${PANEL_ID} .sg-purpose { margin: 0 0 8px; color: #94a3b8; }
      #${PANEL_ID} .sg-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      #${PANEL_ID} .sg-btn {
        background: rgba(167,139,250,0.12);
        border: 1px solid rgba(167,139,250,0.4);
        border-radius: 6px;
        color: #ede9fe;
        font: inherit;
        font-size: 10px;
        padding: 6px 10px;
        cursor: pointer;
        min-height: 34px;
      }
      #${PANEL_ID} .sg-btn.secondary {
        background: transparent;
        border-color: #475569;
        color: #94a3b8;
      }
      #${PANEL_ID}.ok { border-color: rgba(74, 222, 128, 0.45); }
      #${PANEL_ID}.err { border-color: rgba(248, 113, 113, 0.5); }
    `;
    document.head.appendChild(s);
  }

  function ensurePanel() {
    injectStyles();
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.setAttribute('role', 'status');
    panelEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function phaseLabel(phase) {
    return PHASE_LABELS[phase] || String(phase || 'Working').replace(/_/g, ' ');
  }

  function scheduleHide(ms) {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (panelEl) {
        panelEl.classList.remove('open', 'ok', 'err');
      }
      active = null;
    }, ms);
  }

  function render() {
    if (!active || !isTeam()) return;
    const el = ensurePanel();
    const ok = !!active.ok;
    const err = !!active.error;
    el.classList.toggle('ok', ok && !err);
    el.classList.toggle('err', err);
    el.classList.add('open');

    const purpose = active.purpose ? `"${String(active.purpose).slice(0, 120)}"` : '';
    const npc = active.npcName ? ` · ${active.npcName}` : '';
    const proposalBtn = active.proposalId && caps().canApproveSkills?.()
      ? '<button type="button" class="sg-btn" data-action="proposals">Review proposal</button>'
      : '';
    const guideBtn = '<button type="button" class="sg-btn secondary" data-action="dismiss">Dismiss</button>';

    el.innerHTML = `
      <p class="sg-title">Skill pipeline${npc}</p>
      <p class="sg-phase">${phaseLabel(active.phase)}</p>
      ${purpose ? `<p class="sg-purpose">${purpose}</p>` : ''}
      ${active.detail ? `<p class="sg-purpose">${String(active.detail).slice(0, 160)}</p>` : ''}
      <div class="sg-actions">${proposalBtn}${guideBtn}</div>
    `;

    el.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
      el.classList.remove('open', 'ok', 'err');
      active = null;
      if (hideTimer) clearTimeout(hideTimer);
    });
    el.querySelector('[data-action="proposals"]')?.addEventListener('click', () => {
      globalThis.DenizenProposals?.show?.();
      el.classList.remove('open');
    });
  }

  function onProgress(detail) {
    if (!isTeam()) return;
    active = {
      phase: detail.phase,
      purpose: detail.purpose,
      npcName: detail.npcName,
      ok: false,
      error: false,
    };
    render();
    if (hideTimer) clearTimeout(hideTimer);
  }

  function onComplete(detail) {
    if (!isTeam()) return;
    active = {
      phase: detail.phase || 'complete',
      purpose: detail.purpose,
      npcName: detail.npcName,
      proposalId: detail.proposalId,
      detail: detail.ok
        ? (detail.skill ? `Skill: ${detail.skill}` : 'Proposal ready for CEO review.')
        : (detail.error || 'Pipeline did not complete.'),
      ok: !!detail.ok,
      error: !detail.ok,
    };
    render();
    scheduleHide(detail.ok ? 12000 : 16000);
  }

  function onProposalPending(detail) {
    if (!isTeam()) return;
    active = {
      phase: 'notify_ceo',
      purpose: detail.purpose || detail.summary,
      npcName: detail.npcName || 'Lucy',
      proposalId: detail.id || detail.proposalId,
      detail: 'Waiting for leadership approval in Account → Skills.',
      ok: true,
      error: false,
    };
    render();
    scheduleHide(14000);
  }

  function onWsMessage(ev) {
    const msg = ev.detail;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'skill_gap_progress') onProgress(msg);
    else if (msg.type === 'skill_gap_complete') onComplete(msg);
    else if (msg.type === 'skill_proposal_pending') onProposalPending(msg);
  }

  function init() {
    document.addEventListener('denizen-ws-message', onWsMessage);
  }

  globalThis.DenizenSkillGapUI = {
    showProgress: onProgress,
    showComplete: onComplete,
    dismiss() {
      if (panelEl) panelEl.classList.remove('open', 'ok', 'err');
      active = null;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
