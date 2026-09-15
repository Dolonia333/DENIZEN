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
    let s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = STYLE_ID;
      document.head.appendChild(s);
    }
    s.textContent = `
      #${BTN_ID} {
        margin: 0;
        padding: 5px 8px;
        border-radius: 4px;
        background: rgba(245, 158, 11, 0.12);
        border: 2px solid #020617;
        color: #fde68a;
        font: 700 9px/1.2 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        flex-shrink: 0;
        white-space: nowrap;
        box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.45), 2px 2px 0 #020617;
      }
      #${BTN_ID}:hover {
        background: rgba(245, 158, 11, 0.22);
        color: #fff7ed;
      }
      html.denizen-touch #${BTN_ID} {
        padding: 6px 8px;
        min-height: 32px;
      }
      #${PANEL_ID} {
        position: fixed;
        z-index: 100550;
        bottom: calc(var(--denizen-dock-height, 56px) + 90px + env(safe-area-inset-bottom, 0px));
        left: max(20px, env(safe-area-inset-left, 0px));
        width: min(360px, calc(100vw - 40px));
        max-height: min(50vh, 320px);
        display: none;
        flex-direction: column;
        background:
          repeating-linear-gradient(
            -12deg,
            transparent,
            transparent 11px,
            rgba(148, 163, 184, 0.03) 11px,
            rgba(148, 163, 184, 0.03) 12px
          ),
          #111827;
        border: 3px solid #020617;
        border-radius: 4px;
        box-shadow:
          inset 0 0 0 2px #334155,
          0 0 0 2px #f59e0b,
          5px 7px 0 #020617;
        font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        color: #e2e8f0;
        overflow: visible;
      }
      #${PANEL_ID}::before {
        content: "PROJECTS";
        position: absolute;
        top: -11px;
        left: 12px;
        padding: 2px 7px;
        font-family: "Syne", "Avenir Next", system-ui, sans-serif;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.14em;
        color: #0b1220;
        background: #f59e0b;
        border: 2px solid #020617;
        border-radius: 3px;
        box-shadow: 2px 2px 0 #020617;
        pointer-events: none;
      }
      #${PANEL_ID}.open { display: flex; }
      #${PANEL_ID} .proj-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 12px 10px;
        border-bottom: 2px solid #020617;
        color: #7dd3fc;
        font-weight: bold;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-size: 10px;
      }
      #${PANEL_ID} .proj-close {
        background: rgba(2, 6, 23, 0.65);
        border: 2px solid #020617;
        border-radius: 4px;
        color: #94a3b8;
        cursor: pointer;
        font: 700 12px/1 inherit;
        width: 28px;
        height: 28px;
        box-shadow: 1px 1px 0 #020617;
      }
      #${PANEL_ID} .proj-close:hover { color: #fde68a; border-color: #f59e0b; }
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
        border-bottom: 1px solid rgba(51, 65, 85, 0.8);
      }
      #${PANEL_ID} .proj-item:last-child { border-bottom: none; }
      #${PANEL_ID} .proj-name { color: #7dd3fc; font-weight: bold; }
      #${PANEL_ID} .proj-notes { color: #64748b; font-size: 10px; margin-top: 2px; }
      #${PANEL_ID} .proj-delete {
        background: rgba(127, 29, 29, 0.35);
        border: 2px solid #020617;
        color: #fecaca;
        border-radius: 4px;
        padding: 2px 6px;
        font: inherit;
        font-size: 9px;
        cursor: pointer;
        flex-shrink: 0;
        box-shadow: 1px 1px 0 #020617;
      }
      #${PANEL_ID} .proj-empty { color: #64748b; font-size: 10px; padding: 8px 0; }
      #${PANEL_ID} .proj-form {
        padding: 10px 12px;
        border-top: 2px solid #020617;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      #${PANEL_ID} .proj-form input,
      #${PANEL_ID} .proj-form textarea {
        width: 100%;
        box-sizing: border-box;
        background: #0b1220;
        border: 2px solid #020617;
        border-radius: 4px;
        color: #e2e8f0;
        padding: 8px 10px;
        font: inherit;
        font-size: 11px;
        outline: none;
        box-shadow: inset 0 0 0 1px #334155;
      }
      #${PANEL_ID} .proj-form input:focus,
      #${PANEL_ID} .proj-form textarea:focus {
        border-color: #7dd3fc;
        box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.2);
      }
      #${PANEL_ID} .proj-add {
        background: linear-gradient(180deg, #bae6fd, #7dd3fc);
        color: #0b1220;
        border: 2px solid #020617;
        border-radius: 4px;
        padding: 8px 12px;
        font: inherit;
        font-weight: 800;
        font-size: 11px;
        cursor: pointer;
        box-shadow: 2px 2px 0 #020617;
      }
      #${PANEL_ID} .proj-add:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
  }

  function ensureProjectsBtn() {
    if (projectsBtn) return projectsBtn;
    injectStyles();
    projectsBtn = document.createElement('button');
    projectsBtn.id = BTN_ID;
    projectsBtn.type = 'button';
    projectsBtn.textContent = 'Projects';
    projectsBtn.title = 'Your personal project list';
    projectsBtn.addEventListener('click', () => togglePanel());
    const actions = document.getElementById('player-chat-header-actions');
    const closeBtn = document.getElementById('player-chat-close-btn');
    if (actions) {
      actions.insertBefore(projectsBtn, closeBtn || null);
    } else {
      const header = document.getElementById('player-chat-header');
      if (header) {
        let created = document.getElementById('player-chat-header-actions');
        if (!created) {
          created = document.createElement('div');
          created.id = 'player-chat-header-actions';
          header.appendChild(created);
          if (closeBtn) created.appendChild(closeBtn);
        }
        created.insertBefore(projectsBtn, document.getElementById('player-chat-close-btn') || null);
      } else {
        document.body.appendChild(projectsBtn);
      }
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
        <button type="button" class="proj-close" aria-label="Close">✕</button>
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
