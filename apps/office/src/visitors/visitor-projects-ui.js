/**
 * Visitor projects panel — personal project list per browser session.
 * Attaches to globalThis.DenizenVisitorProjectsUI (no imports).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-visitor-projects-ui-style';
  const BTN_ID = 'denizen-visitor-projects-btn';
  const PANEL_ID = 'denizen-visitor-projects-panel';

  let playerChat = null;
  let panelEl = null;
  let projectsBtn = null;
  let busy = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${BTN_ID} {
        margin-left: 6px;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(251, 191, 36, 0.12);
        border: 1px solid rgba(251, 191, 36, 0.35);
        color: #fde68a;
        font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: bold;
        cursor: pointer;
        vertical-align: middle;
      }
      #${BTN_ID}:hover { background: rgba(251, 191, 36, 0.22); }
      #${PANEL_ID} {
        position: fixed;
        z-index: 100550;
        bottom: calc(var(--denizen-dock-height, 56px) + 90px + env(safe-area-inset-bottom, 0px));
        left: max(20px, env(safe-area-inset-left, 0px));
        width: min(360px, calc(100vw - 40px));
        max-height: min(50vh, 320px);
        display: none;
        flex-direction: column;
        background: rgba(2, 6, 23, 0.98);
        border: 1px solid #1f2937;
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        color: #e2e8f0;
        overflow: hidden;
      }
      #${PANEL_ID}.open { display: flex; }
      #${PANEL_ID} .proj-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid #1f2937;
        color: #94a3b8;
        font-weight: bold;
      }
      #${PANEL_ID} .proj-close {
        background: transparent;
        border: none;
        color: #64748b;
        cursor: pointer;
        font: inherit;
        font-size: 14px;
      }
      #${PANEL_ID} .proj-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px 12px;
        min-height: 80px;
      }
      #${PANEL_ID} .proj-item {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 0;
        border-bottom: 1px solid rgba(31, 41, 55, 0.8);
      }
      #${PANEL_ID} .proj-item:last-child { border-bottom: none; }
      #${PANEL_ID} .proj-name { color: #4ade80; font-weight: bold; }
      #${PANEL_ID} .proj-notes { color: #64748b; font-size: 10px; margin-top: 2px; }
      #${PANEL_ID} .proj-delete {
        background: rgba(127, 29, 29, 0.35);
        border: 1px solid rgba(248, 113, 113, 0.35);
        color: #fecaca;
        border-radius: 4px;
        padding: 2px 6px;
        font: inherit;
        font-size: 9px;
        cursor: pointer;
        flex-shrink: 0;
      }
      #${PANEL_ID} .proj-empty { color: #64748b; font-size: 10px; padding: 8px 0; }
      #${PANEL_ID} .proj-form {
        padding: 10px 12px;
        border-top: 1px solid #1f2937;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      #${PANEL_ID} .proj-form input,
      #${PANEL_ID} .proj-form textarea {
        width: 100%;
        box-sizing: border-box;
        background: #1e293b;
        border: 1px solid #1f2937;
        border-radius: 6px;
        color: #e2e8f0;
        padding: 8px 10px;
        font: inherit;
        font-size: 11px;
        outline: none;
      }
      #${PANEL_ID} .proj-form input:focus,
      #${PANEL_ID} .proj-form textarea:focus { border-color: #4ade80; }
      #${PANEL_ID} .proj-add {
        background: #4ade80;
        color: #0f172a;
        border: none;
        border-radius: 6px;
        padding: 8px 12px;
        font: inherit;
        font-weight: bold;
        font-size: 11px;
        cursor: pointer;
      }
      #${PANEL_ID} .proj-add:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
    document.head.appendChild(s);
  }

  function ensureProjectsBtn() {
    if (projectsBtn) return projectsBtn;
    injectStyles();
    const chip = document.getElementById('denizen-visitor-assistant-chip');
    projectsBtn = document.createElement('button');
    projectsBtn.id = BTN_ID;
    projectsBtn.type = 'button';
    projectsBtn.textContent = 'Projects';
    projectsBtn.title = 'Your personal project list';
    projectsBtn.addEventListener('click', () => togglePanel());
    if (chip?.parentNode) {
      chip.parentNode.insertBefore(projectsBtn, chip.nextSibling);
    } else {
      const header = document.getElementById('player-chat-header');
      header?.querySelector('div')?.appendChild(projectsBtn)
        || header?.appendChild(projectsBtn)
        || document.body.appendChild(projectsBtn);
    }
    return projectsBtn;
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    injectStyles();
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.innerHTML = `
      <div class="proj-header">
        <span>Your projects</span>
        <button type="button" class="proj-close" aria-label="Close">${globalThis.DenizenTablerIcons?.x({ size: 14 }) || '×'}</button>
      </div>
      <div class="proj-list" id="denizen-projects-list"></div>
      <div class="proj-form">
        <input id="denizen-project-name" type="text" maxlength="120" placeholder="Project name" />
        <textarea id="denizen-project-notes" maxlength="500" rows="2" placeholder="Notes (optional)"></textarea>
        <button type="button" class="proj-add" id="denizen-project-add">Add project</button>
      </div>
    `;
    document.body.appendChild(panelEl);
    panelEl.querySelector('.proj-close').addEventListener('click', () => closePanel());
    panelEl.querySelector('#denizen-project-add').addEventListener('click', () => onAddProject());
    return panelEl;
  }

  function togglePanel() {
    ensurePanel();
    if (panelEl.classList.contains('open')) closePanel();
    else openPanel();
  }

  function openPanel() {
    ensurePanel();
    panelEl.classList.add('open');
    refreshList();
  }

  function closePanel() {
    if (panelEl) panelEl.classList.remove('open');
  }

  function esc(s) {
    return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function refreshList() {
    const listEl = document.getElementById('denizen-projects-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="proj-empty">Loading…</div>';
    try {
      const projects = await globalThis.DenizenVisitorSession.listProjects();
      if (!projects.length) {
        listEl.innerHTML = '<div class="proj-empty">No projects yet — add one below.</div>';
        return;
      }
      listEl.innerHTML = projects.map((p) => `
        <div class="proj-item" data-id="${esc(p.id)}">
          <div>
            <div class="proj-name">${esc(p.name)}</div>
            ${p.notes ? `<div class="proj-notes">${esc(p.notes)}</div>` : ''}
          </div>
          <button type="button" class="proj-delete" data-id="${esc(p.id)}">Delete</button>
        </div>
      `).join('');
      listEl.querySelectorAll('.proj-delete').forEach((btn) => {
        btn.addEventListener('click', () => onDeleteProject(btn.dataset.id));
      });
    } catch (err) {
      listEl.innerHTML = `<div class="proj-empty">${esc(err?.message || 'Could not load projects')}</div>`;
    }
  }

  async function onAddProject() {
    if (busy) return;
    const nameEl = document.getElementById('denizen-project-name');
    const notesEl = document.getElementById('denizen-project-notes');
    const name = String(nameEl?.value || '').trim();
    if (!name) {
      nameEl?.focus();
      return;
    }
    busy = true;
    const addBtn = document.getElementById('denizen-project-add');
    if (addBtn) addBtn.disabled = true;
    try {
      await globalThis.DenizenVisitorSession.addProject(name, {
        notes: String(notesEl?.value || '').trim() || null,
      });
      if (nameEl) nameEl.value = '';
      if (notesEl) notesEl.value = '';
      await refreshList();
    } catch (err) {
      playerChat?._addToLog?.('System', `Project add failed: ${err?.message || err}`);
    } finally {
      busy = false;
      if (addBtn) addBtn.disabled = false;
    }
  }

  async function onDeleteProject(id) {
    if (busy || !id) return;
    busy = true;
    try {
      await globalThis.DenizenVisitorSession.deleteProject(id);
      await refreshList();
    } catch (err) {
      playerChat?._addToLog?.('System', `Project delete failed: ${err?.message || err}`);
    } finally {
      busy = false;
    }
  }

  const DenizenVisitorProjectsUI = {
    attach(pc) {
      playerChat = pc;
      injectStyles();
      ensureProjectsBtn();
      ensurePanel();
      globalThis.DenizenVisitorSession?.init?.().catch(() => {});
      console.log('[DenizenVisitorProjectsUI] attached');
    },

    detach() {
      closePanel();
      playerChat = null;
    },
  };

  globalThis.DenizenVisitorProjectsUI = DenizenVisitorProjectsUI;
})();
