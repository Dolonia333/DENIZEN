/**
 * proposals-panel.js — Document-style proposal review UI.
 *
 * Pending animation / soul / capability proposals render as readable
 * paper sheets with Approve · Reject · Apply actions.
 */
(function () {
  'use strict';

  const CHIP_ID = 'denizen-proposals-chip';
  const PANEL_ID = 'denizen-proposals-panel';
  const POLL_MS = 30000;
  const STYLE_ID = 'denizen-proposals-doc-styles';
  const PROPOSALS_URL = '/api/proposals';

  let chipEl = null;
  let panelEl = null;
  let pollTimer = null;
  let busy = false;
  let panelOpen = false;
  let lastFeed = { proposals: [], total: 0 };
  let filterStatus = 'pending';
  let filterKinds = new Set(['animation', 'soul', 'capability']);
  let selectedId = null;
  let showTechnical = false;
  let soulApplyAvailable = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed !important;
        z-index: 100200 !important;
        bottom: calc(var(--denizen-dock-height, 56px) + 10px + env(safe-area-inset-bottom, 0px)) !important;
        left: max(10px, env(safe-area-inset-left, 0px)) !important;
        right: max(10px, env(safe-area-inset-right, 0px)) !important;
        width: min(820px, calc(100vw - 20px)) !important;
        max-height: min(82vh, 720px) !important;
        display: none;
        flex-direction: column;
        overflow: hidden;
        padding: 0 !important;
        background: #0f172a !important;
        border: 1px solid rgba(148, 163, 184, 0.25) !important;
        border-radius: 12px !important;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45) !important;
        pointer-events: auto;
      }
      #${PANEL_ID}.open {
        display: flex !important;
      }
      #${PANEL_ID} .prop-shell-header {
        flex-shrink: 0;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(15, 23, 42, 0.95);
      }
      #${PANEL_ID} .prop-shell-title {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #94a3b8;
        margin-bottom: 8px;
      }
      #${PANEL_ID} .prop-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      #${PANEL_ID} .prop-filters button {
        font-size: 10px;
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(30, 41, 59, 0.8);
        color: #cbd5e1;
        cursor: pointer;
      }
      #${PANEL_ID} .prop-filters button.active {
        background: rgba(59, 130, 246, 0.25);
        border-color: rgba(96, 165, 250, 0.6);
        color: #e2e8f0;
      }
      #${PANEL_ID} .prop-body {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: 200px 1fr;
        overflow: hidden;
      }
      #${PANEL_ID} .prop-index {
        overflow-y: auto;
        border-right: 1px solid rgba(148, 163, 184, 0.15);
        padding: 8px;
        background: rgba(15, 23, 42, 0.6);
      }
      #${PANEL_ID} .prop-index-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 8px 10px;
        margin-bottom: 6px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(30, 41, 59, 0.5);
        color: #e2e8f0;
        cursor: pointer;
        font-size: 10px;
        line-height: 1.35;
      }
      #${PANEL_ID} .prop-index-item:hover {
        border-color: rgba(96, 165, 250, 0.45);
      }
      #${PANEL_ID} .prop-index-item.selected {
        border-color: rgba(96, 165, 250, 0.7);
        background: rgba(59, 130, 246, 0.18);
      }
      #${PANEL_ID} .prop-index-kind {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #64748b;
        margin-bottom: 3px;
      }
      #${PANEL_ID} .prop-index-summary {
        color: #cbd5e1;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      #${PANEL_ID} .prop-reader {
        overflow-y: auto;
        padding: 14px 16px 18px;
        background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
      }
      #${PANEL_ID} .prop-doc {
        position: relative;
        background: #faf8f5;
        color: #1e293b;
        border-radius: 2px;
        box-shadow:
          0 1px 2px rgba(0, 0, 0, 0.08),
          0 8px 24px rgba(0, 0, 0, 0.18),
          inset 0 0 0 1px rgba(0, 0, 0, 0.04);
        padding: 28px 32px 20px;
        font-family: Georgia, 'Times New Roman', 'Palatino Linotype', serif;
        font-size: 14px;
        line-height: 1.6;
        min-height: 280px;
      }
      #${PANEL_ID} .prop-doc-stamp {
        position: absolute;
        top: 18px;
        right: 20px;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.12em;
        padding: 4px 10px;
        border: 2px solid;
        border-radius: 4px;
        transform: rotate(-8deg);
        opacity: 0.85;
        font-family: system-ui, sans-serif;
      }
      #${PANEL_ID} .prop-doc-stamp.pending { color: #b45309; border-color: #b45309; }
      #${PANEL_ID} .prop-doc-stamp.approved { color: #15803d; border-color: #15803d; }
      #${PANEL_ID} .prop-doc-stamp.rejected { color: #b91c1c; border-color: #b91c1c; }
      #${PANEL_ID} .prop-doc-stamp.applied { color: #6d28d9; border-color: #6d28d9; }
      #${PANEL_ID} .prop-doc-type {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.14em;
        color: #64748b;
        margin-bottom: 6px;
        font-family: system-ui, sans-serif;
      }
      #${PANEL_ID} .prop-doc-title {
        font-size: 20px;
        font-weight: 600;
        color: #0f172a;
        margin: 0 0 12px;
        padding-right: 80px;
        line-height: 1.25;
      }
      #${PANEL_ID} .prop-doc-meta {
        font-size: 11px;
        color: #64748b;
        margin-bottom: 20px;
        padding-bottom: 14px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.12);
        font-family: system-ui, sans-serif;
      }
      #${PANEL_ID} .prop-doc-section {
        margin-bottom: 18px;
      }
      #${PANEL_ID} .prop-doc-section h3 {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #475569;
        margin: 0 0 6px;
        font-family: system-ui, sans-serif;
      }
      #${PANEL_ID} .prop-doc-section p,
      #${PANEL_ID} .prop-doc-section pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #${PANEL_ID} .prop-doc-section pre {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 12px;
        background: rgba(15, 23, 42, 0.06);
        padding: 10px 12px;
        border-radius: 4px;
        border-left: 3px solid rgba(15, 23, 42, 0.15);
      }
      #${PANEL_ID} .prop-doc-section.add pre { border-left-color: #15803d; }
      #${PANEL_ID} .prop-doc-section.drop pre { border-left-color: #b91c1c; }
      #${PANEL_ID} .prop-doc-section.muted p,
      #${PANEL_ID} .prop-doc-section.muted pre {
        color: #64748b;
        font-size: 12px;
      }
      #${PANEL_ID} .prop-doc-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 22px;
        padding-top: 16px;
        border-top: 1px solid rgba(15, 23, 42, 0.12);
        font-family: system-ui, sans-serif;
      }
      #${PANEL_ID} .prop-doc-actions button {
        font-size: 12px;
        font-weight: 600;
        padding: 8px 16px;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        transition: opacity 0.15s;
      }
      #${PANEL_ID} .prop-doc-actions button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      #${PANEL_ID} .prop-btn-approve { background: #16a34a; color: #fff; }
      #${PANEL_ID} .prop-btn-reject { background: #dc2626; color: #fff; }
      #${PANEL_ID} .prop-btn-apply { background: #7c3aed; color: #fff; }
      #${PANEL_ID} .prop-btn-secondary {
        background: transparent;
        color: #475569;
        border: 1px solid rgba(15, 23, 42, 0.2) !important;
        font-weight: 500;
      }
      #${PANEL_ID} .prop-empty {
        color: #94a3b8;
        font-size: 12px;
        padding: 24px;
        text-align: center;
        font-family: system-ui, sans-serif;
      }
      @media (max-width: 640px) {
        #${PANEL_ID} {
          width: calc(100vw - 12px) !important;
          max-height: min(78vh, 640px) !important;
          left: 6px !important;
          right: 6px !important;
        }
        #${PANEL_ID} .prop-body {
          grid-template-columns: 1fr;
          grid-template-rows: auto 1fr;
        }
        #${PANEL_ID} .prop-index {
          border-right: none;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
          max-height: 120px;
          display: flex;
          gap: 6px;
          overflow-x: auto;
          overflow-y: hidden;
          flex-direction: row;
        }
        #${PANEL_ID} .prop-index-item {
          flex: 0 0 140px;
          margin-bottom: 0;
        }
        #${PANEL_ID} .prop-doc {
          padding: 20px 18px 16px;
        }
        #${PANEL_ID} .prop-doc-title {
          font-size: 17px;
          padding-right: 0;
        }
        #${PANEL_ID} .prop-doc-stamp {
          position: static;
          transform: none;
          display: inline-block;
          margin-bottom: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function kindLabel(kind) {
    if (kind === 'animation') return 'Animation Proposal';
    if (kind === 'soul') return 'SOUL Revision';
    if (kind === 'capability') return 'Capability Request';
    return String(kind || 'Proposal');
  }

  function kindShort(kind) {
    if (kind === 'animation') return 'ANIM';
    if (kind === 'soul') return 'SOUL';
    if (kind === 'capability') return 'CAP';
    return String(kind || '?').slice(0, 4).toUpperCase();
  }

  function docTitle(p) {
    const r = p.raw || {};
    if (p.kind === 'animation') return r.animName || p.summary || 'Untitled animation';
    if (p.kind === 'soul') return (r.proposal && r.proposal.summary) || p.summary || 'SOUL edit';
    if (p.kind === 'capability') return r.verbName || r.name || p.summary || 'New capability';
    return p.summary || 'Proposal';
  }

  function formatDate(ts) {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return String(ts);
      return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch (_) {
      return String(ts);
    }
  }

  function buildDocumentSections(p) {
    const r = p.raw || {};
    const sections = [];

    if (p.kind === 'animation') {
      if (r.animName) sections.push({ title: 'Animation name', body: r.animName });
      if (r.description) sections.push({ title: 'Description', body: r.description });
    } else if (p.kind === 'soul') {
      const prop = r.proposal || {};
      if (prop.summary) sections.push({ title: 'Summary', body: prop.summary });
      if (prop.addToSoul) sections.push({ title: 'Add to SOUL.md', body: prop.addToSoul, tone: 'add' });
      if (prop.dropFromSoul) sections.push({ title: 'Remove from SOUL.md', body: prop.dropFromSoul, tone: 'drop' });
      if (typeof prop.confidence === 'number' && prop.confidence > 0) {
        sections.push({ title: 'Confidence', body: `${Math.round(prop.confidence * 100)}%` });
      }
      if (r.reflectionPreview) {
        sections.push({ title: 'Reflection context', body: r.reflectionPreview, muted: true });
      }
    } else if (p.kind === 'capability') {
      const verb = r.verbName || r.name;
      if (verb) sections.push({ title: 'Proposed verb', body: verb });
      if (r.description) sections.push({ title: 'Description', body: r.description });
    }

    if (!sections.length && p.summary) {
      sections.push({ title: 'Summary', body: p.summary });
    }

    if (r.review && (r.review.note || r.review.reviewedAt)) {
      const note = r.review.note || '(no note)';
      sections.push({
        title: 'Review',
        body: `${note}\nReviewed: ${formatDate(r.review.reviewedAt)}`,
        muted: true,
      });
    }

    return sections;
  }

  function renderDocumentSections(p) {
    const sections = buildDocumentSections(p);
    if (!sections.length) {
      return '<div class="prop-doc-section muted"><p>No readable content for this proposal.</p></div>';
    }
    return sections.map((s) => {
      const cls = ['prop-doc-section'];
      if (s.tone) cls.push(s.tone);
      if (s.muted) cls.push('muted');
      const body = esc(s.body);
      const usePre = s.tone === 'add' || s.tone === 'drop' || (body && body.length > 120);
      return `<div class="${cls.join(' ')}"><h3>${esc(s.title)}</h3>${usePre ? `<pre>${body}</pre>` : `<p>${body}</p>`}</div>`;
    }).join('');
  }

  function shownItems() {
    return (lastFeed.proposals || []).filter((p) => {
      if (filterStatus !== 'all' && p.status !== filterStatus) return false;
      if (!filterKinds.has(p.kind)) return false;
      return true;
    });
  }

  function ensureSelection(items) {
    if (!items.length) {
      selectedId = null;
      return;
    }
    if (!selectedId || !findSelected(items)) {
      selectedId = selectionKey(items[0]);
    }
  }

  async function probeSoulApply() {
    if (soulApplyAvailable !== null) return soulApplyAvailable;
    try {
      const res = await fetch('/api/soul-proposal/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: '__probe__' }),
      });
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      soulApplyAvailable = !(res.status === 404 && !ctype.includes('json'));
    } catch (_) {
      soulApplyAvailable = false;
    }
    return soulApplyAvailable;
  }

  function setChipState(pendingCount) {
    if (!chipEl) return;
    if (pendingCount > 0) {
      chipEl.style.background = '#713f12';
      chipEl.style.borderColor = '#facc15';
      chipEl.textContent = `📋 ${pendingCount} pending`;
    } else {
      chipEl.style.background = '#0f172a';
      chipEl.style.borderColor = '#355';
      chipEl.textContent = '📋 proposals';
    }
  }

  function flash(msg, isError) {
    if (!chipEl) return;
    const prevText = chipEl.textContent;
    const prevBg = chipEl.style.background;
    const prevBorder = chipEl.style.borderColor;
    chipEl.textContent = (isError ? '⚠ ' : '✓ ') + msg;
    chipEl.style.background = isError ? '#7f1d1d' : '#065f46';
    chipEl.style.borderColor = isError ? '#fca5a5' : '#34d399';
    setTimeout(() => {
      chipEl.textContent = prevText;
      chipEl.style.background = prevBg;
      chipEl.style.borderColor = prevBorder;
    }, 2000);
  }

  function selectionKey(p) {
    return `${p.kind}:${p.id}`;
  }

  function findSelected(items) {
    if (!selectedId) return null;
    const [kind, ...rest] = selectedId.split(':');
    const id = rest.join(':');
    return items.find((p) => p.kind === kind && p.id === id) || null;
  }

  function buildUI() {
    injectStyles();
    if (chipEl && panelEl) return panelEl;

    chipEl = document.createElement('button');
    chipEl.id = CHIP_ID;
    chipEl.type = 'button';
    Object.assign(chipEl.style, {
      position: 'fixed', bottom: '14px', right: '14px', zIndex: 9997,
      background: '#0f172a', color: '#cfe7ff',
      border: '1px solid #355', borderRadius: '14px',
      padding: '4px 10px', font: '11px monospace',
      cursor: 'pointer', maxWidth: '300px',
    });
    chipEl.title = 'Review NPC proposals as documents';
    chipEl.textContent = '📋 proposals';
    const openPanel = () => {
      if (!panelOpen) setPanelOpen(true);
      else setPanelOpen(false);
    };
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) bind(chipEl, openPanel);
    else chipEl.addEventListener('click', openPanel);
    document.body.appendChild(chipEl);

    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'Proposal review');
    panelEl.setAttribute('aria-modal', 'true');
    panelEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function setPanelOpen(open) {
    panelOpen = !!open;
    if (panelEl) panelEl.classList.toggle('open', panelOpen);
    if (panelOpen) {
      renderPanel();
      refresh();
    }
  }

  function togglePanel() {
    setPanelOpen(!panelOpen);
  }

  async function fetchFeed(status) {
    const kinds = [...filterKinds].join(',');
    const url = `${PROPOSALS_URL}?status=${encodeURIComponent(status)}&kind=${encodeURIComponent(kinds)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    lastFeed = {
      proposals: Array.isArray(json.proposals) ? json.proposals : [],
      total: Number(json.total) || (Array.isArray(json.proposals) ? json.proposals.length : 0),
    };
  }

  async function refresh() {
    if (busy) {
      if (panelOpen) renderPanel();
      return;
    }
    busy = true;
    try {
      let pendingCount;
      if (filterStatus === 'pending') {
        await fetchFeed(filterStatus);
        pendingCount = (lastFeed.proposals || []).filter((p) => p.status === 'pending').length;
      } else {
        const [, count] = await Promise.all([
          fetchFeed(filterStatus),
          fetch(`${PROPOSALS_URL}?status=pending`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : { proposals: [] }))
            .then((j) => (Array.isArray(j.proposals) ? j.proposals.length : 0))
            .catch(() => 0),
        ]);
        pendingCount = count;
      }
      setChipState(pendingCount);
      if (panelOpen) renderPanel();
    } catch (err) {
      lastFeed = { proposals: [], total: 0, error: err.message || String(err) };
      console.warn('[proposals-panel] refresh failed:', err);
      if (panelOpen && panelEl) {
        panelEl.innerHTML = `<div class="prop-empty">Could not load proposals. (${esc(err.message)})</div>`;
      }
    } finally {
      busy = false;
    }
  }

  function renderPanel() {
    if (!panelEl) return;
    if (lastFeed.error) {
      panelEl.innerHTML = `<div class="prop-empty">error: ${esc(lastFeed.error)}</div>`;
      return;
    }
    const items = shownItems();
    ensureSelection(items);
    const selected = findSelected(items);

    const statusBtns = ['all', 'pending', 'approved', 'rejected', 'applied'].map((s) => {
      const active = filterStatus === s ? ' active' : '';
      return `<button type="button" class="prop-filter-status${active}" data-status="${s}">${s}</button>`;
    }).join('');

    const kindBtns = ['animation', 'soul', 'capability'].map((k) => {
      const on = filterKinds.has(k);
      const active = on ? ' active' : '';
      return `<button type="button" class="prop-filter-kind${active}" data-kind="${k}">${kindShort(k)}</button>`;
    }).join('');

    const indexHtml = items.length
      ? items.map((p) => {
        const key = selectionKey(p);
        const sel = key === selectedId ? ' selected' : '';
        return `<button type="button" class="prop-index-item${sel}" data-select="${esc(key)}">
          <div class="prop-index-kind">${esc(kindShort(p.kind))} · ${esc(p.status)}</div>
          <div class="prop-index-summary">${esc(docTitle(p))}</div>
        </button>`;
      }).join('')
      : '<div class="prop-empty">No proposals match these filters.</div>';

    let readerHtml;
    if (!selected) {
      readerHtml = '<div class="prop-empty">Select a document from the list to read it.</div>';
    } else {
      const r = selected.raw || {};
      const author = selected.by || r.npcName || r.by || 'unknown';
      const ts = selected.ts || r.proposedAt || r.createdAt;
      const status = (selected.status || 'pending').toLowerCase();
      const stampClass = ['pending', 'approved', 'rejected', 'applied'].includes(status) ? status : 'pending';
      const canAct = status === 'pending';
      const canApply = selected.kind === 'soul' && status === 'approved' && soulApplyAvailable;

      readerHtml = `
        <article class="prop-doc" data-kind="${esc(selected.kind)}" data-id="${esc(selected.id)}">
          <div class="prop-doc-stamp ${stampClass}">${esc(status.toUpperCase())}</div>
          <div class="prop-doc-type">${esc(kindLabel(selected.kind))}</div>
          <h2 class="prop-doc-title">${esc(docTitle(selected))}</h2>
          <div class="prop-doc-meta">
            Proposed by <strong>${esc(author)}</strong><br>
            ${formatDate(ts)} · Ref ${esc(selected.id)}
          </div>
          ${renderDocumentSections(selected)}
          ${showTechnical ? `<div class="prop-doc-section muted"><h3>Raw data</h3><pre>${esc(JSON.stringify(r, null, 2))}</pre></div>` : ''}
          <div class="prop-doc-actions">
            ${canAct ? `<button type="button" class="prop-btn-approve" data-action="approve">Approve</button>` : ''}
            ${canAct ? `<button type="button" class="prop-btn-reject" data-action="reject">Reject</button>` : ''}
            ${canApply ? `<button type="button" class="prop-btn-apply" data-action="apply">Apply to SOUL.md</button>` : ''}
            <button type="button" class="prop-btn-secondary" data-action="toggle-tech">${showTechnical ? 'Hide technical' : 'Show technical'}</button>
          </div>
        </article>`;
    }

    panelEl.innerHTML = `
      <div class="prop-shell-header">
        <div class="prop-shell-title">PROPOSALS — DOCUMENT REVIEW</div>
        <div class="prop-filters">
          ${statusBtns}
          <span style="width:1px;height:16px;background:rgba(148,163,184,0.3);margin:0 2px"></span>
          ${kindBtns}
          <button type="button" class="prop-filter-refresh" title="Refresh">↻</button>
        </div>
      </div>
      <div class="prop-body">
        <nav class="prop-index" aria-label="Proposal documents">${indexHtml}</nav>
        <main class="prop-reader">${readerHtml}</main>
      </div>`;

    wirePanelEvents();
  }

  function wirePanelEvents() {
    if (!panelEl) return;
    if (panelEl.dataset.eventsWired === '1') return;
    panelEl.dataset.eventsWired = '1';

    const onPanelPress = async (e) => {
      const btn = e.target?.closest?.('button');
      if (!btn || !panelEl.contains(btn)) return;

      if (btn.classList.contains('prop-filter-status')) {
        filterStatus = btn.getAttribute('data-status') || 'pending';
        refresh();
        return;
      }
      if (btn.classList.contains('prop-filter-kind')) {
        const k = btn.getAttribute('data-kind');
        if (!k) return;
        if (filterKinds.has(k)) filterKinds.delete(k);
        else filterKinds.add(k);
        if (!filterKinds.size) filterKinds.add(k);
        renderPanel();
        refresh();
        return;
      }
      if (btn.classList.contains('prop-filter-refresh')) {
        refresh();
        return;
      }
      if (btn.hasAttribute('data-select')) {
        selectedId = btn.getAttribute('data-select');
        renderPanel();
        return;
      }

      const action = btn.getAttribute('data-action');
      if (!action) return;
      const doc = btn.closest('.prop-doc');
      if (!doc) return;
      const kind = doc.getAttribute('data-kind');
      const id = doc.getAttribute('data-id');
      if (action === 'toggle-tech') {
        showTechnical = !showTechnical;
        renderPanel();
        return;
      }
      if (action === 'approve') await decide(kind, id, 'approved');
      else if (action === 'reject') await decide(kind, id, 'rejected');
      else if (action === 'apply') await applySoul(id);
    };

    let lastPressAt = 0;
    let lastPressKey = '';
    panelEl.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const btn = e.target?.closest?.('button');
      const key = btn ? (btn.id || btn.className || 'btn') : '';
      const now = Date.now();
      if (key && key === lastPressKey && now - lastPressAt < 320) return;
      lastPressKey = key;
      lastPressAt = now;
      onPanelPress(e);
    });
    panelEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  async function decide(kind, id, decision) {
    try {
      const res = await fetch(`/api/${encodeURIComponent(kind)}-proposal/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[Proposals] ${kind} ${decision} failed: HTTP ${res.status} ${text}`);
        flash(`${decision} failed: HTTP ${res.status}`, true);
        return;
      }
      flash(`${kind} ${decision}`, false);
    } catch (err) {
      console.warn(`[Proposals] ${kind} ${decision} threw:`, err);
      flash(`${decision} failed`, true);
    }
    await refresh();
  }

  async function applySoul(id) {
    if (!soulApplyAvailable) {
      flash('apply endpoint not available', true);
      return;
    }
    try {
      const res = await fetch('/api/soul-proposal/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[Proposals] soul apply failed: HTTP ${res.status} ${text}`);
        flash(`apply failed: HTTP ${res.status}`, true);
        return;
      }
      flash('soul applied', false);
    } catch (err) {
      console.warn('[Proposals] soul apply threw:', err);
      flash('apply failed', true);
    }
    await refresh();
  }

  async function init() {
    buildUI();
    await probeSoulApply();
    await refresh();
    pollTimer = setInterval(refresh, POLL_MS);

    try {
      const auto = new URL(window.location.href).searchParams.get('proposals');
      if (auto === '1' || auto === 'open') {
        setPanelOpen(true);
        renderPanel();
      }
    } catch (_) {}

    window.DenizenProposals = {
      show() { setPanelOpen(true); },
      hide() { setPanelOpen(false); },
      toggle: togglePanel,
      refresh,
      setFilter(s) { filterStatus = String(s || 'pending'); refresh(); },
      feed: () => lastFeed,
    };
    console.log('[Proposals] document review panel ready');
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
