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
  const SKILL_PROPOSALS_URL = '/api/skill-proposals';

  let chipEl = null;
  let panelEl = null;
  let pollTimer = null;
  let busy = false;
  let panelOpen = false;
  let lastFeed = { proposals: [], total: 0 };
  let filterStatus = 'pending';
  let filterKinds = defaultFilterKinds();
  let selectedId = null;
  let showTechnical = false;
  let soulApplyAvailable = null;
  let controlsWired = false;
  let autoOpenChecked = false;
  let serverMeta = { label: '' };
  let soulContextCache = new Map();
  let citationChecks = new Map();
  let noteModal = null;
  let pendingDecision = null;
  let toastTimer = null;
  let lastFlash = null;

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
        position: relative;
      }
      #${PANEL_ID} .prop-toast {
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        font: 600 12px/1.35 system-ui, sans-serif;
        color: #ecfdf5;
        background: rgba(6, 95, 70, 0.92);
        border: 1px solid rgba(52, 211, 153, 0.55);
      }
      #${PANEL_ID} .prop-toast.error {
        color: #fef2f2;
        background: rgba(127, 29, 29, 0.92);
        border-color: rgba(252, 165, 165, 0.55);
      }
      #${PANEL_ID} .prop-toast[hidden] {
        display: none !important;
      }
      #${PANEL_ID} .prop-shell-topline {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      #${PANEL_ID} .prop-shell-title {
        flex: 1;
        min-width: 0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      #${PANEL_ID} .prop-panel-close {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(30, 41, 59, 0.9);
        color: #e2e8f0;
        font: 700 21px/1 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${PANEL_ID} .prop-panel-close:hover {
        border-color: rgba(96, 165, 250, 0.65);
        background: rgba(51, 65, 85, 0.95);
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
        position: relative;
      }
      html.denizen-phone-mode #${PANEL_ID} .prop-body {
        grid-template-columns: 1fr !important;
        grid-template-rows: auto minmax(0, 1fr);
      }
      html.denizen-phone-mode #${PANEL_ID} .prop-index {
        max-height: 132px;
        border-right: none !important;
        border-bottom: 1px solid rgba(148, 163, 184, 0.15);
      }
      html.denizen-phone-mode #${PANEL_ID} .prop-reader {
        min-height: 0;
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
        position: relative;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
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
        touch-action: manipulation;
      }
      #${PANEL_ID} .prop-doc-actions button:disabled,
      #${PANEL_ID} .prop-doc-actions button[aria-disabled="true"] {
        opacity: 0.45;
        cursor: not-allowed;
      }
      #${PANEL_ID} .prop-dossier-gate {
        margin: 12px 0 0;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(217, 119, 6, 0.35);
        background: rgba(254, 243, 199, 0.85);
        color: #92400e;
        font-family: system-ui, sans-serif;
        font-size: 12px;
        line-height: 1.45;
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
      html.denizen-phone #${PANEL_ID}.open .prop-body,
      html.denizen-phone-mode #${PANEL_ID}.open .prop-body {
        flex: 1;
        min-height: 0;
      }
      html.denizen-phone #${PANEL_ID} .prop-shell-header,
      html.denizen-phone-mode #${PANEL_ID} .prop-shell-header {
        padding: 8px;
      }
      html.denizen-phone #${PANEL_ID} .prop-shell-topline,
      html.denizen-phone-mode #${PANEL_ID} .prop-shell-topline {
        margin-bottom: 6px;
      }
      html.denizen-phone #${PANEL_ID} .prop-shell-title,
      html.denizen-phone-mode #${PANEL_ID} .prop-shell-title {
        font-size: 10px;
        letter-spacing: 0.05em;
      }
      html.denizen-phone #${PANEL_ID} .prop-panel-close,
      html.denizen-phone-mode #${PANEL_ID} .prop-panel-close {
        width: 38px;
        height: 38px;
      }
      html.denizen-phone #${PANEL_ID} .prop-filters,
      html.denizen-phone-mode #${PANEL_ID} .prop-filters {
        flex-wrap: nowrap;
        gap: 5px;
        overflow-x: auto;
        overflow-y: hidden;
        padding-bottom: 2px;
        scrollbar-width: thin;
      }
      html.denizen-phone #${PANEL_ID} .prop-filters button,
      html.denizen-phone-mode #${PANEL_ID} .prop-filters button {
        flex: 0 0 auto;
        min-height: 32px;
        padding: 5px 8px;
      }
      html.denizen-phone #${PANEL_ID} .prop-body,
      html.denizen-phone-mode #${PANEL_ID} .prop-body {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
      }
      html.denizen-phone #${PANEL_ID} .prop-index,
      html.denizen-phone-mode #${PANEL_ID} .prop-index {
        border-right: none;
        border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        max-height: 112px;
        display: flex;
        gap: 6px;
        overflow-x: auto;
        overflow-y: hidden;
        flex-direction: row;
        padding: 7px;
      }
      html.denizen-phone #${PANEL_ID} .prop-index-item,
      html.denizen-phone-mode #${PANEL_ID} .prop-index-item {
        flex: 0 0 min(46%, 168px);
        min-height: 72px;
        margin-bottom: 0;
      }
      html.denizen-phone #${PANEL_ID} .prop-reader,
      html.denizen-phone-mode #${PANEL_ID} .prop-reader {
        min-width: 0;
        padding: 10px;
        overflow-x: hidden;
      }
      html.denizen-phone #${PANEL_ID} .prop-doc,
      html.denizen-phone-mode #${PANEL_ID} .prop-doc {
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        padding: 16px 14px;
        font-size: 13px;
        line-height: 1.5;
      }
      html.denizen-phone #${PANEL_ID} .prop-doc-title,
      html.denizen-phone-mode #${PANEL_ID} .prop-doc-title {
        font-size: 17px;
        padding-right: 0;
        overflow-wrap: anywhere;
      }
      html.denizen-phone #${PANEL_ID} .prop-doc-stamp,
      html.denizen-phone-mode #${PANEL_ID} .prop-doc-stamp {
        position: static;
        transform: none;
        display: inline-block;
        margin-bottom: 10px;
      }
      html.denizen-phone #${PANEL_ID} .prop-doc-actions,
      html.denizen-phone-mode #${PANEL_ID} .prop-doc-actions {
        position: sticky;
        bottom: 0;
        z-index: 4;
        margin-top: 16px;
        padding: 12px 0 calc(8px + env(safe-area-inset-bottom, 0px));
        background: linear-gradient(180deg, rgba(250, 248, 245, 0) 0%, #faf8f5 28%);
        box-shadow: 0 -8px 20px rgba(15, 23, 42, 0.08);
      }
      html.denizen-phone #${PANEL_ID} .prop-doc-actions button,
      html.denizen-phone-mode #${PANEL_ID} .prop-doc-actions button {
        flex: 1 1 120px;
        min-height: 44px;
        padding: 10px 12px;
      }
      @media (max-width: 640px) {
        #${PANEL_ID} .prop-shell-header {
          padding: 8px;
        }
        #${PANEL_ID} .prop-shell-topline {
          margin-bottom: 6px;
        }
        #${PANEL_ID} .prop-panel-close {
          width: 40px;
          height: 40px;
        }
        #${PANEL_ID} .prop-filters {
          gap: 4px;
        }
        #${PANEL_ID} .prop-filters button {
          min-height: 34px;
          padding: 5px 7px;
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
      html.denizen-phone.denizen-landscape #${PANEL_ID} .prop-index,
      html.denizen-phone-mode.denizen-landscape #${PANEL_ID} .prop-index {
        max-height: 86px;
      }
      html.denizen-phone.denizen-landscape #${PANEL_ID} .prop-reader,
      html.denizen-phone-mode.denizen-landscape #${PANEL_ID} .prop-reader {
        padding: 10px;
      }
      html.denizen-phone.denizen-landscape #${PANEL_ID} .prop-doc,
      html.denizen-phone-mode.denizen-landscape #${PANEL_ID} .prop-doc {
        padding: 16px 14px;
        font-size: 13px;
      }
      #${PANEL_ID} .prop-shell-subtitle {
        font-size: 10px;
        color: #64748b;
        margin-top: 2px;
        font-family: system-ui, sans-serif;
      }
      #${PANEL_ID} .prop-filter-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        margin-bottom: 4px;
      }
      #${PANEL_ID} .prop-filter-row:last-child {
        margin-bottom: 0;
      }
      #${PANEL_ID} .prop-filter-label {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #64748b;
        min-width: 42px;
        font-family: system-ui, sans-serif;
      }
      #${PANEL_ID} .prop-index-priority {
        display: inline-block;
        font-size: 8px;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 1px 5px;
        border-radius: 4px;
        margin-bottom: 4px;
        font-family: system-ui, sans-serif;
      }
      #${PANEL_ID} .prop-index-priority.ceo { background: #7f1d1d; color: #fecaca; }
      #${PANEL_ID} .prop-index-priority.ext { background: #713f12; color: #fde68a; }
      #${PANEL_ID} .prop-citation-list {
        list-style: none;
        margin: 0;
        padding: 0;
        font-family: system-ui, sans-serif;
        font-size: 12px;
      }
      #${PANEL_ID} .prop-citation-item {
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 6px;
        padding: 10px 12px;
        margin-bottom: 8px;
        background: rgba(255, 255, 255, 0.65);
      }
      #${PANEL_ID} .prop-citation-item label {
        display: block;
      }
      #${PANEL_ID} .prop-cite-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        min-width: 132px;
        margin-bottom: 8px;
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid rgba(15, 23, 42, 0.2);
        background: #fff;
        color: #0f172a;
        font: 600 12px system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${PANEL_ID} .prop-cite-toggle.checked {
        background: #dcfce7;
        border-color: #16a34a;
        color: #166534;
      }
      #${PANEL_ID} .prop-citation-item a {
        color: #1d4ed8;
        word-break: break-all;
      }
      #${PANEL_ID} .prop-preview-frame {
        width: 100%;
        min-height: 320px;
        border: 1px solid rgba(15, 23, 42, 0.15);
        border-radius: 4px;
        background: #fff;
        margin-top: 8px;
      }
      #${PANEL_ID} .prop-diff-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 11px;
      }
      #${PANEL_ID} .prop-diff-col {
        background: rgba(15, 23, 42, 0.06);
        border-radius: 4px;
        padding: 8px 10px;
        max-height: 240px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #${PANEL_ID} .prop-diff-col.add { border-left: 3px solid #15803d; }
      #${PANEL_ID} .prop-diff-col.drop { border-left: 3px solid #b91c1c; }
      #${PANEL_ID} .prop-diff-col.current { border-left: 3px solid #64748b; }
      #${PANEL_ID} .prop-note-modal {
        position: absolute;
        inset: 0;
        z-index: 80;
        background: rgba(15, 23, 42, 0.82);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        pointer-events: auto;
      }
      #${PANEL_ID} .prop-note-modal button {
        touch-action: manipulation;
        min-height: 44px;
      }
      #${PANEL_ID} .prop-note-card {
        width: min(420px, 100%);
        background: #1e293b;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 10px;
        padding: 14px;
        font-family: system-ui, sans-serif;
      }
      #${PANEL_ID} .prop-note-card h4 {
        margin: 0 0 8px;
        color: #e2e8f0;
        font-size: 13px;
      }
      #${PANEL_ID} .prop-note-card textarea {
        width: 100%;
        min-height: 88px;
        box-sizing: border-box;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: #0f172a;
        color: #e2e8f0;
        padding: 8px 10px;
        font: 12px/1.4 system-ui, sans-serif;
        resize: vertical;
      }
      #${PANEL_ID} .prop-note-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        justify-content: flex-end;
      }
      #${PANEL_ID} .prop-post-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }
      #${PANEL_ID} .prop-post-actions a,
      #${PANEL_ID} .prop-post-actions button {
        font-size: 11px;
        padding: 6px 12px;
        border-radius: 6px;
        border: 1px solid rgba(15, 23, 42, 0.2);
        background: #f1f5f9;
        color: #0f172a;
        text-decoration: none;
        cursor: pointer;
        font-family: system-ui, sans-serif;
      }
      @media (max-width: 640px) {
        #${PANEL_ID} .prop-diff-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function renderHeader(filtersHtml = '', subtitle = '') {
    const toastHtml = lastFlash && Date.now() - lastFlash.at < 4000
      ? `<div class="prop-toast${lastFlash.isError ? ' error' : ''}" role="status" aria-live="polite">${esc((lastFlash.isError ? '⚠ ' : '✓ ') + lastFlash.msg)}</div>`
      : '<div class="prop-toast" hidden></div>';
    return `
      <div class="prop-shell-header">
        <div class="prop-shell-topline">
          <div class="prop-shell-title">
            APPROVALS
            ${subtitle ? `<div class="prop-shell-subtitle">${esc(subtitle)}</div>` : ''}
          </div>
          <button type="button" class="prop-panel-close" data-action="close" aria-label="Close approvals" title="Close">×</button>
        </div>
        ${filtersHtml ? `<div class="prop-filters">${filtersHtml}</div>` : ''}
        ${toastHtml}
      </div>`;
  }

  function renderErrorPanel(message) {
    if (!panelEl) return;
    panelEl.innerHTML = `
      ${renderHeader()}
      <div class="prop-empty">${message}</div>`;
    wirePanelEvents();
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
    if (kind === 'skill') return 'Skill Proposal';
    if (kind === 'code') return 'Code Proposal';
    if (kind === 'dossier') return 'PDF Dossier';
    return String(kind || 'Proposal');
  }

  function kindShort(kind) {
    if (kind === 'animation') return 'ANIM';
    if (kind === 'soul') return 'SOUL';
    if (kind === 'capability') return 'CAP';
    if (kind === 'skill') return 'SKILL';
    if (kind === 'code') return 'CODE';
    if (kind === 'dossier') return 'PDF';
    return String(kind || '?').slice(0, 4).toUpperCase();
  }

  function docTitle(p) {
    const r = p.raw || {};
    if (p.kind === 'animation') return r.animName || p.summary || 'Untitled animation';
    if (p.kind === 'soul') return (r.proposal && r.proposal.summary) || p.summary || 'SOUL edit';
    if (p.kind === 'capability') return r.verbName || r.name || p.summary || 'New capability';
    if (p.kind === 'skill') return r.name || r.slug || p.summary || 'New skill';
    if (p.kind === 'code') return r.task || p.summary || 'Code change';
    if (p.kind === 'dossier') return `${r.type || 'dossier'}${r.recipient ? ` · ${r.recipient}` : ''}`;
    return p.summary || 'Proposal';
  }

  function mapSkillProposal(p) {
    const status = p.status === 'needs_review' ? 'pending' : p.status;
    return {
      kind: 'skill',
      id: p.id,
      status,
      by: p.npc,
      ts: p.at,
      raw: p,
      summary: p.purpose || p.name,
    };
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

  function proposalKey(p) {
    return selectionKey(p);
  }

  function priorityBadges(p) {
    const r = p.raw || {};
    const badges = [];
    if (r.requiresAngelaReview) badges.push({ cls: 'ceo', text: 'CEO REVIEW' });
    if (p.kind === 'dossier' && r.recipient) badges.push({ cls: 'ext', text: 'EXTERNAL' });
    if (Array.isArray(r.flags) && r.flags.some((f) => f.blocking)) badges.push({ cls: 'ceo', text: 'FLAGS' });
    return badges;
  }

  function getCitationChecks(key, count) {
    if (!citationChecks.has(key)) citationChecks.set(key, new Set());
    const set = citationChecks.get(key);
    return { set, checkedCount: set.size, allChecked: count > 0 && set.size >= count };
  }

  function renderDossierCitations(p) {
    const r = p.raw || {};
    const citations = r.recipientResearch?.citations || [];
    if (!citations.length) {
      return '<div class="prop-doc-section muted"><p>No Bob research citations attached.</p></div>';
    }
    const key = proposalKey(p);
    const { set } = getCitationChecks(key, citations.length);
    const items = citations.map((c) => {
      const verified = set.has(c.index);
      const cls = verified ? 'prop-cite-toggle checked' : 'prop-cite-toggle';
      const label = verified ? '✓ Verified' : 'Tap to verify';
      return `<li class="prop-citation-item">
        <button type="button" class="${cls}" data-action="cite-toggle" data-citation-check="${esc(key)}" data-cite-index="${c.index}">${label}</button>
        <div class="prop-cite-body">
          <strong>[${c.index}] ${esc(c.title || 'Source')}</strong><br>
          <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a><br>
          ${esc(c.snippet || c.title || '')}<br>
          <em style="color:#64748b;font-size:10px">Verify against Ben / business-model.json</em>
        </div>
      </li>`;
    }).join('');
    return `<div class="prop-doc-section">
      <h3>Bob research — verify line by line</h3>
      <ul class="prop-citation-list">${items}</ul>
    </div>`;
  }

  /** Dossier preview/PDF links need the caller's session_id — a bare <a href>
   *  has no other way to authenticate, so every click 401'd with a JSON body
   *  that browsers render as plain text ("just code"). */
  function withSession(url) {
    const sid = resolveSessionId();
    if (!sid) return url;
    return url + (url.includes('?') ? '&' : '?') + 'session_id=' + encodeURIComponent(sid);
  }

  function renderDossierPreview(p) {
    const id = p.id;
    const htmlUrl = withSession(`/api/dossier-proposals/${encodeURIComponent(id)}/preview?format=html`);
    const pdfUrl = withSession(`/api/dossier-proposals/${encodeURIComponent(id)}/preview?format=pdf`);
    return `<div class="prop-doc-section">
      <h3>Preview</h3>
      <iframe class="prop-preview-frame" src="${esc(htmlUrl)}" title="Dossier HTML preview"></iframe>
      <div class="prop-post-actions">
        <a href="${esc(pdfUrl)}" target="_blank" rel="noopener">Download PDF</a>
        <a href="${esc(htmlUrl)}" target="_blank" rel="noopener">Open HTML</a>
      </div>
    </div>`;
  }

  function renderSoulDiff(p, context) {
    const prop = (p.raw?.proposal) || {};
    const add = prop.addToSoul || '';
    const drop = prop.dropFromSoul || '';
    const current = context?.currentSoul || '';
    if (!add && !drop && !current) return '';
    return `<div class="prop-doc-section">
      <h3>SOUL diff</h3>
      <div class="prop-diff-grid">
        <div>
          <div style="font-size:10px;font-weight:700;margin-bottom:4px;color:#64748b">CURRENT SOUL.md</div>
          <div class="prop-diff-col current">${esc(current.slice(0, 6000) || '(empty or unreadable)')}</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;margin-bottom:4px;color:#64748b">PROPOSED CHANGES</div>
          ${add ? `<div class="prop-diff-col add">${esc(add)}</div>` : ''}
          ${drop ? `<div class="prop-diff-col drop">${esc(drop)}</div>` : ''}
        </div>
      </div>
    </div>`;
  }

  function renderCodeDiff(p) {
    const r = p.raw || {};
    const diff = r.diff || '';
    if (!diff) return '';
    return `<div class="prop-doc-section">
      <h3>Diff ${r.gitMode ? `(mode: ${esc(r.gitMode)})` : ''}</h3>
      <pre>${esc(String(diff).slice(0, 12000))}</pre>
    </div>`;
  }

  function renderPostApproveActions(p) {
    const status = (p.status || '').toLowerCase();
    if (status !== 'approved' && status !== 'pending') return '';
    if (p.kind === 'dossier') {
      const pdfUrl = withSession(`/api/dossier-proposals/${encodeURIComponent(p.id)}/preview?format=pdf`);
      const htmlUrl = withSession(`/api/dossier-proposals/${encodeURIComponent(p.id)}/preview?format=html`);
      return `<div class="prop-post-actions">
        <a href="${esc(pdfUrl)}" target="_blank" rel="noopener">Download PDF</a>
        <a href="${esc(htmlUrl)}" target="_blank" rel="noopener">Open HTML draft</a>
      </div>`;
    }
    if (p.kind === 'code' && p.raw?.reportPath) {
      return `<div class="prop-post-actions"><span style="font-size:11px;color:#64748b">Report: ${esc(p.raw.reportPath)}</span></div>`;
    }
    return '';
  }

  function renderNoteModalHtml() {
    if (!noteModal) return '';
    const { decision, requireNote } = noteModal;
    const title = decision === 'rejected' ? 'Reject — reason required' : 'Approve — optional note';
    return `<div class="prop-note-modal" data-note-modal="1">
      <div class="prop-note-card">
        <h4>${esc(title)}</h4>
        <textarea id="prop-note-text" placeholder="${requireNote ? 'Explain why this is rejected…' : 'Optional note for audit trail…'}"></textarea>
        <div class="prop-note-actions">
          <button type="button" class="prop-btn-secondary" data-action="note-cancel">Cancel</button>
          <button type="button" class="prop-btn-${decision === 'rejected' ? 'reject' : 'approve'}" data-action="note-submit">${decision === 'rejected' ? 'Reject' : 'Confirm approve'}</button>
        </div>
      </div>
    </div>`;
  }

  async function fetchSoulContext(p) {
    const cacheKey = `${p.kind}:${p.id}`;
    if (soulContextCache.has(cacheKey)) return soulContextCache.get(cacheKey);
    try {
      const res = await fetch(`/api/soul-proposals/${encodeURIComponent(p.id)}/context`, { cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      soulContextCache.set(cacheKey, json);
      return json;
    } catch (_) {
      return null;
    }
  }

  async function fetchServerMeta() {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      const id = j.server?.id || window.location.hostname;
      const port = j.server?.port || window.location.port;
      serverMeta.label = port ? `${id}:${port}` : String(id);
    } catch (_) {
      serverMeta.label = window.location.host || '';
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
    } else if (p.kind === 'skill') {
      if (r.purpose) sections.push({ title: 'Purpose', body: r.purpose });
      if (r.slug) sections.push({ title: 'Skill slug', body: r.slug });
      if (Array.isArray(r.scanFlags) && r.scanFlags.length) {
        sections.push({ title: 'Safety scan flags', body: r.scanFlags.join('\n'), tone: 'drop' });
      } else if (r.status === 'pending') {
        sections.push({ title: 'Safety scan', body: 'No dangerous patterns detected.' });
      }
      if (r.code) {
        sections.push({
          title: 'Generated code (quarantined until approved)',
          body: String(r.code).slice(0, 4000),
          muted: true,
        });
      }
    } else if (p.kind === 'code') {
      if (r.task) sections.push({ title: 'Task', body: r.task });
      if (r.gitMode) sections.push({ title: 'Edit mode', body: r.gitMode });
      if (r.targetFiles?.length) sections.push({ title: 'Target files', body: r.targetFiles.join('\n') });
      if (r.changedFiles?.length) sections.push({ title: 'Changed files', body: r.changedFiles.join('\n') });
      if (r.reportPath) sections.push({ title: 'Report', body: r.reportPath });
    } else if (p.kind === 'dossier') {
      if (r.type) sections.push({ title: 'Document type', body: r.type });
      if (r.recipient) sections.push({ title: 'Recipient', body: r.recipient });
      if (r.subject) sections.push({ title: 'Subject', body: r.subject });
      if (r.skin) sections.push({ title: 'Skin', body: r.skin });
      if (r.repo_pin) {
        sections.push({
          title: 'Repo pin',
          body: `commit ${r.repo_pin.short || r.repo_pin.commit} · ${r.repo_pin.test_files} test files`,
        });
      }
      const blocking = (r.flags || []).filter((f) => f.blocking);
      if (blocking.length) {
        sections.push({ title: 'Honesty flags (blocking)', body: JSON.stringify(blocking, null, 2).slice(0, 2000), tone: 'drop' });
      } else if (Array.isArray(r.flags) && r.flags.length) {
        sections.push({ title: 'Honesty flags (advisory)', body: JSON.stringify(r.flags, null, 2).slice(0, 1200), muted: true });
      }
      if (r.requiresAngelaReview) {
        sections.push({ title: 'Review gate', body: 'Requires holding CEO review before external use.', tone: 'drop' });
      }
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
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
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
      globalThis.DenizenBottomDock?.renderChip?.('denizen-proposals-chip', `${pendingCount} pending`);
      if (!globalThis.DenizenBottomDock?.renderChip) chipEl.textContent = `📋 ${pendingCount} pending`;
    } else {
      chipEl.style.background = '#0f172a';
      chipEl.style.borderColor = '#355';
      globalThis.DenizenBottomDock?.renderChip?.('denizen-proposals-chip', 'approvals');
      if (!globalThis.DenizenBottomDock?.renderChip) chipEl.textContent = '📋 approvals';
    }
  }

  function flash(msg, isError) {
    lastFlash = { msg, isError: !!isError, at: Date.now() };
    if (panelOpen && panelEl) renderPanel();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (lastFlash && Date.now() - lastFlash.at >= 3200) {
        lastFlash = null;
        if (panelOpen && panelEl) renderPanel();
      }
    }, 3400);
    if (!chipEl) return;
    try {
      if (getComputedStyle(chipEl).visibility === 'hidden') return;
    } catch (_) {}
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

  function isSystemOperator() {
    const caps = globalThis.DenizenVisitorCapabilities;
    if (caps?.isCeo?.() || caps?.canApproveSkills?.()) return true;
    const sess = globalThis.DenizenVisitorSession;
    return !!(sess?.isCeoPrincipal?.() || sess?.getProfile?.()?.canApproveSkills);
  }

  function defaultFilterKinds() {
    if (isSystemOperator()) {
      return new Set(['animation', 'soul', 'capability', 'skill', 'code', 'dossier']);
    }
    return new Set(['dossier']);
  }

  function canReviewProposals() {
    const sess = globalThis.DenizenVisitorSession;
    if (!sess?.getSessionId?.()) return false;
    if (isSystemOperator()) return true;
    return !!sess.getIdentityId?.();
  }

  function buildUI() {
    if (!canReviewProposals()) {
      teardownUI();
      return null;
    }
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
    chipEl.title = isSystemOperator()
      ? 'Review NPC proposals — animations, SOUL, code, PDF dossiers'
      : 'Review your PDF dossier proposals';
    globalThis.DenizenBottomDock?.renderChip?.('denizen-proposals-chip', 'approvals');
    if (!globalThis.DenizenBottomDock?.renderChip) chipEl.textContent = '📋 approvals';
    chipEl.setAttribute('aria-controls', PANEL_ID);
    chipEl.setAttribute('aria-expanded', 'false');
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
    panelEl.setAttribute('aria-hidden', 'true');
    panelEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function setPanelOpen(open) {
    panelOpen = !!open;
    document.documentElement.classList.toggle('denizen-proposals-open', panelOpen);
    chipEl?.setAttribute('aria-expanded', String(panelOpen));
    if (panelEl) {
      panelEl.classList.toggle('open', panelOpen);
      panelEl.setAttribute('aria-hidden', panelOpen ? 'false' : 'true');
      if (panelOpen) {
        globalThis.DenizenMobileSidebar?.close?.();
        globalThis.__DenizenPlayerChat?.close?.();
        globalThis.DenizenDeviceProfile?.resetPhonePanelLayout?.(panelEl);
      }
    }
    if (panelOpen) {
      renderPanel();
      refresh();
    }
  }

  function togglePanel() {
    setPanelOpen(!panelOpen);
  }

  function teardownUI() {
    setPanelOpen(false);
    chipEl?.remove();
    panelEl?.remove();
    chipEl = null;
    panelEl = null;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function authHeaders() {
    const sess = globalThis.DenizenVisitorSession;
    return typeof sess?.authHeaders === 'function' ? sess.authHeaders() : {};
  }

  function resolveSessionId() {
    const sess = globalThis.DenizenVisitorSession;
    if (typeof sess?.getSessionId === 'function') {
      const sid = sess.getSessionId();
      if (sid) return sid;
    }
    try {
      const raw = localStorage.getItem('denizen-visitor-session');
      const store = raw ? JSON.parse(raw) : {};
      return store.session_id || null;
    } catch (_) {
      return null;
    }
  }

  function sessionQuery(extra = {}) {
    const sessionId = resolveSessionId();
    const params = new URLSearchParams(extra);
    if (sessionId) params.set('session_id', sessionId);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  function fetchOpts(headers = {}) {
    return { cache: 'no-store', credentials: 'include', headers };
  }

  async function fetchFeed(status) {
    const auth = authHeaders();
    const docKinds = [...filterKinds].filter((k) => k !== 'skill');
    const proposals = [];
    if (docKinds.length) {
      const url = `${PROPOSALS_URL}${sessionQuery({
        status,
        kind: docKinds.join(','),
      })}`;
      const res = await fetch(url, fetchOpts(auth));
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          detail = errJson.error || errJson.message || detail;
        } catch (_) {}
        if (res.status === 401 && !resolveSessionId()) {
          detail = 'Session not ready — reload the page or sign in again';
        }
        throw new Error(detail);
      }
      const json = await res.json();
      if (Array.isArray(json.proposals)) proposals.push(...json.proposals);
    }
    if (filterKinds.has('skill')) {
      const skillStatuses = status === 'all'
        ? [null]
        : (status === 'pending' ? ['pending', 'needs_review'] : [status]);
      for (const st of skillStatuses) {
        const skillUrl = `${SKILL_PROPOSALS_URL}${sessionQuery(st ? { status: st } : {})}`;
        const sres = await fetch(skillUrl, fetchOpts(auth));
        if (!sres.ok) continue;
        const sjson = await sres.json();
        const skills = Array.isArray(sjson.proposals) ? sjson.proposals : [];
        for (const p of skills) {
          const mapped = mapSkillProposal(p);
          if (status === 'all' || mapped.status === status || (status === 'pending' && p.status === 'needs_review')) {
            proposals.push(mapped);
          }
        }
      }
    }
    lastFeed = {
      proposals,
      total: proposals.length,
    };
  }

  async function refresh() {
    if (busy) {
      if (panelOpen) renderPanel();
      return;
    }
    busy = true;
    try {
      const auth = authHeaders();
      let pendingCount;
      if (filterStatus === 'pending') {
        await fetchFeed(filterStatus);
        pendingCount = (lastFeed.proposals || []).filter((p) => p.status === 'pending').length;
      } else {
        const [, count] = await Promise.all([
          fetchFeed(filterStatus),
          fetch(`${PROPOSALS_URL}${sessionQuery({ status: 'pending' })}`, fetchOpts(auth))
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
        renderErrorPanel(`Could not load proposals. (${esc(err.message)})`);
      }
    } finally {
      busy = false;
    }
  }

  let soulContextForSelected = null;
  let soulContextLoading = false;

  function renderPanelExtras(selected, { skipDossier = false } = {}) {
    if (!selected) return '';
    let extra = '';
    if (!skipDossier && selected.kind === 'dossier') {
      extra += renderDossierCitations(selected);
      if (selected.status === 'pending' || selected.status === 'approved') {
        extra += renderDossierPreview(selected);
      }
    }
    if (selected.kind === 'soul') {
      extra += renderSoulDiff(selected, soulContextForSelected);
    }
    if (selected.kind === 'code') {
      extra += renderCodeDiff(selected);
    }
    extra += renderPostApproveActions(selected);
    return extra;
  }

  function renderDocActions(selected, items, { dossierOk, canAct, canApply }) {
    const approveBlocked = canAct && !dossierOk;
    const approveAttrs = approveBlocked ? ' aria-disabled="true" title="Verify all Bob citations first"' : '';
    return `<div class="prop-doc-actions">
      ${canAct ? `<button type="button" class="prop-btn-approve" data-action="approve"${approveAttrs}>Approve</button>` : ''}
      ${canAct ? `<button type="button" class="prop-btn-reject" data-action="reject">Reject</button>` : ''}
      ${canApply ? `<button type="button" class="prop-btn-apply" data-action="apply">Apply to SOUL.md</button>` : ''}
      ${canAct && items.length > 1 ? `<button type="button" class="prop-btn-secondary" data-action="next">Review next →</button>` : ''}
      <button type="button" class="prop-btn-secondary" data-action="toggle-tech">${showTechnical ? 'Hide technical' : 'Show technical'}</button>
    </div>`;
  }

  function renderDossierGate(p, dossierOk) {
    const citations = p.raw?.recipientResearch?.citations || [];
    if (!citations.length || dossierOk || (p.status || '').toLowerCase() !== 'pending') return '';
    const key = proposalKey(p);
    const checked = getCitationChecks(key, citations.length).checkedCount;
    return `<div class="prop-dossier-gate" role="status">
      Approve is locked until you verify all Bob citations (${checked}/${citations.length} checked).
      Scroll up to the checklist, then tap Approve again.
    </div>`;
  }

  function dossierCanApprove(p) {
    const r = p.raw || {};
    const citations = r.recipientResearch?.citations || [];
    if (!citations.length) return true;
    const key = proposalKey(p);
    return getCitationChecks(key, citations.length).allChecked;
  }

  function renderPanel() {
    if (!panelEl) return;
    if (lastFeed.error) {
      renderErrorPanel(`error: ${esc(lastFeed.error)}`);
      return;
    }
    const items = shownItems();
    ensureSelection(items);
    const selected = findSelected(items);

    const statusBtns = ['all', 'pending', 'approved', 'rejected', 'applied'].map((s) => {
      const active = filterStatus === s ? ' active' : '';
      return `<button type="button" class="prop-filter-status${active}" data-status="${s}">${s}</button>`;
    }).join('');

    const kindList = ['animation', 'soul', 'capability', 'skill', 'code', 'dossier'];
    const kindLabels = { animation: 'ANIM', soul: 'SOUL', capability: 'CAP', skill: 'SKILL', code: 'CODE', dossier: 'PDF' };
    const kindBtns = kindList.map((k) => {
      const on = filterKinds.has(k);
      const active = on ? ' active' : '';
      return `<button type="button" class="prop-filter-kind${active}" data-kind="${k}" title="${esc(kindLabel(k))}">${kindLabels[k] || k.toUpperCase()}</button>`;
    }).join('');

    const indexHtml = items.length
      ? items.map((p) => {
        const key = selectionKey(p);
        const sel = key === selectedId ? ' selected' : '';
        const badges = priorityBadges(p).map((b) =>
          `<span class="prop-index-priority ${b.cls}">${esc(b.text)}</span>`,
        ).join('');
        return `<button type="button" class="prop-index-item${sel}" data-select="${esc(key)}">
          ${badges}
          <div class="prop-index-kind">${esc(kindShort(p.kind))} · ${esc(p.status)}</div>
          <div class="prop-index-summary">${esc(docTitle(p))}</div>
        </button>`;
      }).join('')
      : '<div class="prop-empty">Nothing in this queue — NPCs will add work here when they propose changes.</div>';

    let readerHtml;
    if (!items.length) {
      readerHtml = '<div class="prop-empty">Adjust filters or wait for new proposals.</div>';
    } else if (!selected) {
      readerHtml = '<div class="prop-empty">Select a document from the list above.</div>';
    } else {
      const r = selected.raw || {};
      const author = selected.by || r.npcName || r.by || 'unknown';
      const ts = selected.ts || r.proposedAt || r.createdAt;
      const status = (selected.status || 'pending').toLowerCase();
      const stampClass = ['pending', 'approved', 'rejected', 'applied'].includes(status) ? status : 'pending';
      const canAct = status === 'pending';
      const canApply = selected.kind === 'soul' && status === 'approved' && soulApplyAvailable;
      const dossierOk = selected.kind !== 'dossier' || dossierCanApprove(selected);
      const dossierFront = selected.kind === 'dossier'
        ? `${renderDossierCitations(selected)}${renderDossierGate(selected, dossierOk)}`
        : '';
      const dossierPreview = selected.kind === 'dossier'
        && (status === 'pending' || status === 'approved')
        ? renderDossierPreview(selected)
        : '';

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
          ${dossierFront}
          ${renderDocActions(selected, items, { dossierOk, canAct, canApply })}
          ${dossierPreview}
          ${renderPanelExtras(selected, { skipDossier: true })}
          ${showTechnical ? `<div class="prop-doc-section muted"><h3>Raw data</h3><pre>${esc(JSON.stringify(r, null, 2))}</pre></div>` : ''}
        </article>`;
    }

    const filtersHtml = `
      <div class="prop-filter-row"><span class="prop-filter-label">STATUS</span>${statusBtns}</div>
      <div class="prop-filter-row"><span class="prop-filter-label">KIND</span>${kindBtns}<button type="button" class="prop-filter-refresh" title="Refresh">↻</button></div>`;

    const subtitle = serverMeta.label ? `Server · ${serverMeta.label}` : '';

    panelEl.innerHTML = `
      ${renderHeader(filtersHtml, subtitle)}
      <div class="prop-body">
        <nav class="prop-index" aria-label="Approval queue">${indexHtml}</nav>
        <main class="prop-reader">${readerHtml}</main>
      </div>
      ${renderNoteModalHtml()}`;

    wirePanelEvents();

    if (selected?.kind === 'soul' && !soulContextForSelected && !soulContextLoading) {
      soulContextLoading = true;
      fetchSoulContext(selected).then((ctx) => {
        soulContextForSelected = ctx;
        soulContextLoading = false;
        if (panelOpen && findSelected(shownItems())?.id === selected.id) renderPanel();
      }).catch(() => { soulContextLoading = false; });
    }
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
        soulContextForSelected = null;
        noteModal = null;
        renderPanel();
        return;
      }

      if (btn.getAttribute('data-action') === 'note-cancel') {
        noteModal = null;
        renderPanel();
        return;
      }
      if (btn.getAttribute('data-action') === 'note-submit') {
        if (!noteModal) return;
        const ta = panelEl.querySelector('#prop-note-text');
        const note = String(ta?.value || '').trim();
        if (noteModal.requireNote && !note) {
          flash('Rejection requires a note', true);
          return;
        }
        const { kind, id, decision } = noteModal;
        noteModal = null;
        await decide(kind, id, decision, note || null);
        return;
      }

      const action = btn.getAttribute('data-action');
      if (action === 'close') {
        setPanelOpen(false);
        return;
      }
      if (action === 'cite-toggle') {
        const key = btn.getAttribute('data-citation-check');
        const idx = Number(btn.getAttribute('data-cite-index'));
        if (!key || Number.isNaN(idx)) return;
        if (!citationChecks.has(key)) citationChecks.set(key, new Set());
        const set = citationChecks.get(key);
        if (set.has(idx)) set.delete(idx);
        else set.add(idx);
        renderPanel();
        return;
      }
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
      if (action === 'next') {
        const items = shownItems();
        const idx = items.findIndex((p) => selectionKey(p) === selectedId);
        if (idx >= 0 && idx < items.length - 1) {
          selectedId = selectionKey(items[idx + 1]);
          soulContextForSelected = null;
          renderPanel();
        }
        return;
      }
      if (action === 'approve') {
        if (btn.getAttribute('aria-disabled') === 'true') {
          flash('Verify all Bob citations first', true);
          return;
        }
        if (kind === 'dossier') {
          const sel = findSelected(shownItems());
          if (sel && !dossierCanApprove(sel)) {
            flash('Verify all Bob citations first', true);
            return;
          }
        }
        btn.disabled = true;
        try {
          await decide(kind, id, 'approved', null);
        } finally {
          btn.disabled = false;
        }
        return;
      }
      if (action === 'reject') {
        noteModal = { kind, id, decision: 'rejected', requireNote: true };
        renderPanel();
        panelEl.querySelector('#prop-note-text')?.focus?.({ preventScroll: true });
        return;
      }
      if (action === 'apply') await applySoul(id);
    };

    panelEl.addEventListener('change', (e) => {
      const cb = e.target;
      if (!cb?.dataset?.citationCheck) return;
      const key = cb.dataset.citationCheck;
      const idx = Number(cb.dataset.citeIndex);
      if (!citationChecks.has(key)) citationChecks.set(key, new Set());
      const set = citationChecks.get(key);
      if (cb.checked) set.add(idx);
      else set.delete(idx);
      renderPanel();
    });

    const delegate = globalThis.DenizenTouchBind?.delegatePress;
    if (delegate) {
      delegate(panelEl, 'button', (_e, btn) => {
        onPanelPress({ target: btn });
      }, { stop: true });
    } else {
      panelEl.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        onPanelPress(e);
      });
    }
    panelEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  async function decide(kind, id, decision, note) {
    try {
      const sessionId = resolveSessionId();
      const auth = authHeaders();
      let url;
      let body;
      let headers = { 'Content-Type': 'application/json' };
      if (kind === 'skill') {
        url = `/api/skill-proposals/${encodeURIComponent(id)}/${decision === 'approved' ? 'approve' : 'reject'}`;
        body = JSON.stringify({ session_id: sessionId });
        headers = { 'Content-Type': 'application/json' };
      } else if (kind === 'code') {
        url = `/api/code-proposals/${encodeURIComponent(id)}/${decision === 'approved' ? 'approve' : 'reject'}`;
        body = JSON.stringify({ note: note || null, session_id: sessionId });
      } else if (kind === 'dossier') {
        url = `/api/dossier-proposals/${encodeURIComponent(id)}/${decision === 'approved' ? 'approve' : 'reject'}`;
        body = JSON.stringify({ note: note || null, session_id: sessionId });
      } else {
        url = `/api/${encodeURIComponent(kind)}-proposal/approve`;
        body = JSON.stringify({ id, decision, note: note || null, session_id: sessionId });
      }
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { ...headers, ...auth },
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        let errMsg = text;
        try { errMsg = JSON.parse(text).error || text; } catch (_) {}
        console.warn(`[Proposals] ${kind} ${decision} failed: HTTP ${res.status} ${text}`);
        await refresh();
        flash(String(errMsg).slice(0, 120) || `${decision} failed`, true);
        return;
      }
      soulContextForSelected = null;
      noteModal = null;
      const items = shownItems();
      const idx = items.findIndex((p) => p.kind === kind && p.id === id);
      if (decision === 'approved' && idx >= 0 && idx < items.length - 1) {
        selectedId = selectionKey(items[idx + 1]);
      }
    } catch (err) {
      console.warn(`[Proposals] ${kind} ${decision} threw:`, err);
      await refresh();
      flash(`${decision} failed`, true);
      return;
    }
    await refresh();
    flash(`${kind} ${decision}`, false);
  }

  async function applySoul(id) {
    if (!soulApplyAvailable) {
      flash('apply endpoint not available', true);
      return;
    }
    try {
      const res = await fetch('/api/soul-proposal/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
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

  async function ensureReady() {
    const sess = globalThis.DenizenVisitorSession;
    if (typeof sess?.init === 'function') {
      try { await sess.init(); } catch (_) {}
    }
    if (!canReviewProposals()) {
      teardownUI();
      return false;
    }
    buildUI();
    await Promise.all([probeSoulApply(), fetchServerMeta()]);
    await refresh();
    if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);

    if (!autoOpenChecked) {
      autoOpenChecked = true;
      try {
        const auto = new URL(window.location.href).searchParams.get('proposals');
        if (auto === '1' || auto === 'open') {
          setPanelOpen(true);
          renderPanel();
        }
      } catch (_) {}
    }
    return true;
  }

  function wireGlobalControls() {
    if (controlsWired) return;
    controlsWired = true;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelOpen) {
        e.preventDefault();
        setPanelOpen(false);
      }
    });

    document.addEventListener('denizen-visitor-session-ready', () => {
      filterKinds = defaultFilterKinds();
      if (!canReviewProposals()) {
        teardownUI();
        return;
      }
      ensureReady().catch((err) => console.warn('[Proposals] ready sync failed:', err));
    });

    document.addEventListener('denizen-visitor-profile-updated', () => {
      filterKinds = defaultFilterKinds();
      if (!canReviewProposals()) {
        teardownUI();
        return;
      }
      ensureReady().catch((err) => console.warn('[Proposals] profile sync failed:', err));
    });

    document.addEventListener('denizen-phone-app-open', (e) => {
      if (e.detail?.appId !== 'approvals') return;
      if (!panelOpen) return;
      refresh().catch((err) => console.warn('[Proposals] phone open refresh failed:', err));
    });

    document.addEventListener('denizen-proposals-changed', () => {
      refresh().catch((err) => console.warn('[Proposals] live refresh failed:', err));
    });

    document.addEventListener('keydown', (e) => {
      if (!panelOpen || noteModal) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      if (e.key === 'a' && !e.metaKey && !e.ctrlKey) {
        const doc = panelEl?.querySelector('.prop-doc');
        if (doc) doc.querySelector('[data-action="approve"]')?.click();
      }
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
        const doc = panelEl?.querySelector('.prop-doc');
        if (doc) doc.querySelector('[data-action="reject"]')?.click();
      }
      if (e.key === 'j') {
        const items = shownItems();
        const idx = items.findIndex((p) => selectionKey(p) === selectedId);
        if (idx >= 0 && idx < items.length - 1) {
          selectedId = selectionKey(items[idx + 1]);
          soulContextForSelected = null;
          renderPanel();
        }
      }
      if (e.key === 'k') {
        const items = shownItems();
        const idx = items.findIndex((p) => selectionKey(p) === selectedId);
        if (idx > 0) {
          selectedId = selectionKey(items[idx - 1]);
          soulContextForSelected = null;
          renderPanel();
        }
      }
    });

    window.DenizenProposals = {
      async show() {
        try {
          const ok = await ensureReady();
          if (ok) setPanelOpen(true);
          return ok;
        } catch (err) {
          console.warn('[Proposals] show failed:', err);
          return false;
        }
      },
      hide() { setPanelOpen(false); },
      async toggle() {
        try {
          const ok = await ensureReady();
          if (ok) togglePanel();
          return ok;
        } catch (err) {
          console.warn('[Proposals] toggle failed:', err);
          return false;
        }
      },
      refresh,
      setFilter(s) {
        filterStatus = String(s || 'pending');
        ensureReady().then((ok) => {
          if (ok) refresh();
        }).catch((err) => console.warn('[Proposals] filter failed:', err));
      },
      feed: () => lastFeed,
    };
  }

  async function init() {
    wireGlobalControls();
    const ready = await ensureReady();
    if (!ready) {
      console.log('[Proposals] hidden — approver role required');
      return;
    }
    console.log('[Proposals] document review panel ready');
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
