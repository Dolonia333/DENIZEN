/**
 * Office Guide — comprehensive reference for teammates and super-users.
 * Covers: your agent, team agents, multi-model stack, collaboration, City Power/desktop.
 * Attaches to globalThis.DenizenCapabilitiesGuide (no imports).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-capabilities-guide-style';
  const MODAL_ID = 'denizen-capabilities-guide';
  const CHIP_ID = 'denizen-capabilities-guide-chip';

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'my-agent', label: 'My assistant' },
    { id: 'team', label: 'Team agents' },
    { id: 'models', label: 'AI & models' },
    { id: 'collab', label: 'Collaborate' },
    { id: 'mesh', label: 'City Power' },
    { id: 'desktop-power', label: 'Desktop power', teamOnly: true },
  ];

  function caps() {
    return globalThis.DenizenVisitorCapabilities || {};
  }

  function sess() {
    return globalThis.DenizenVisitorSession || null;
  }

  function isTeam() {
    return !!caps().isTeam?.() || !!caps().isCeo?.();
  }

  function isDemo() {
    return !!caps().isDemo?.();
  }

  function claimedNpc() {
    const api = sess();
    const asst = api?.getAssistant?.() || api?.assistant;
    return asst?.npc_key || asst?.assistant_name || null;
  }

  function tierLabel() {
    if (caps().isCeo?.()) return 'CEO / host';
    if (isTeam()) return 'Team';
    return 'Demo';
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${CHIP_ID} {
        display: none;
        background: rgba(15, 23, 42, 0.96);
        color: #c4b5fd;
        border: 1px solid rgba(167, 139, 250, 0.4);
        border-radius: 999px;
        padding: 6px 11px;
        font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: bold;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${CHIP_ID}.ready { display: inline-flex; align-items: center; }
      #${CHIP_ID}:hover { border-color: #a78bfa; color: #ede9fe; }
      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147481500;
        background: rgba(2, 6, 23, 0.72);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
          max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        touch-action: manipulation;
      }
      #${MODAL_ID} .cg-card {
        background: #020617;
        border: 1px solid #334155;
        border-radius: 12px;
        width: min(720px, 100%);
        max-height: min(88dvh, 720px);
        display: flex;
        flex-direction: column;
        box-shadow: 0 24px 48px rgba(0,0,0,0.55);
        color: #e2e8f0;
      }
      #${MODAL_ID} .cg-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 14px 16px 10px;
        border-bottom: 1px solid #1f2937;
      }
      #${MODAL_ID} .cg-head h2 {
        margin: 0;
        font-size: 14px;
        color: #f8fafc;
      }
      #${MODAL_ID} .cg-tier {
        font-size: 10px;
        color: #a78bfa;
        border: 1px solid rgba(167,139,250,0.35);
        border-radius: 6px;
        padding: 2px 8px;
      }
      #${MODAL_ID} .cg-close {
        background: transparent;
        border: 1px solid #475569;
        border-radius: 6px;
        color: #94a3b8;
        font: inherit;
        font-size: 11px;
        padding: 6px 10px;
        cursor: pointer;
        min-height: 36px;
      }
      #${MODAL_ID} .cg-tabs {
        display: flex;
        gap: 4px;
        padding: 8px 12px;
        overflow-x: auto;
        border-bottom: 1px solid #1f2937;
        flex-shrink: 0;
      }
      #${MODAL_ID} .cg-tab {
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        color: #94a3b8;
        font: inherit;
        font-size: 10px;
        padding: 6px 10px;
        cursor: pointer;
        white-space: nowrap;
        min-height: 36px;
      }
      #${MODAL_ID} .cg-tab.active {
        color: #c4b5fd;
        border-color: rgba(167,139,250,0.45);
        background: rgba(167,139,250,0.08);
      }
      #${MODAL_ID} .cg-body {
        padding: 14px 16px 16px;
        overflow-y: auto;
        font-size: 11px;
        line-height: 1.5;
      }
      #${MODAL_ID} .cg-body h3 {
        margin: 0 0 8px;
        font-size: 12px;
        color: #f1f5f9;
      }
      #${MODAL_ID} .cg-body p { margin: 0 0 10px; color: #cbd5e1; }
      #${MODAL_ID} .cg-body ul { margin: 0 0 12px; padding-left: 18px; color: #cbd5e1; }
      #${MODAL_ID} .cg-body li { margin-bottom: 5px; }
      #${MODAL_ID} .cg-matrix {
        width: 100%;
        border-collapse: collapse;
        margin: 10px 0 14px;
        font-size: 10px;
      }
      #${MODAL_ID} .cg-matrix th, #${MODAL_ID} .cg-matrix td {
        border: 1px solid #1f2937;
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
      }
      #${MODAL_ID} .cg-matrix th { color: #94a3b8; background: #0f172a; }
      #${MODAL_ID} .cg-yes { color: #4ade80; }
      #${MODAL_ID} .cg-no { color: #64748b; }
      #${MODAL_ID} .cg-warn { color: #fbbf24; }
      #${MODAL_ID} .cg-npc-card {
        border: 1px solid #1f2937;
        border-radius: 8px;
        padding: 10px;
        margin-bottom: 8px;
        background: rgba(15,23,42,0.5);
      }
      #${MODAL_ID} .cg-npc-card b { color: #e2e8f0; }
      #${MODAL_ID} .cg-npc-card .role { color: #7dd3fc; font-size: 10px; }
      #${MODAL_ID} .cg-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding: 10px 16px 14px;
        border-top: 1px solid #1f2937;
      }
      #${MODAL_ID} .cg-btn {
        background: rgba(167,139,250,0.15);
        border: 1px solid rgba(167,139,250,0.45);
        border-radius: 6px;
        color: #ede9fe;
        font: inherit;
        font-size: 10px;
        font-weight: bold;
        padding: 8px 12px;
        cursor: pointer;
        min-height: 40px;
      }
      #${MODAL_ID} .cg-btn:hover { border-color: #a78bfa; }
      #${MODAL_ID} .cg-btn.secondary {
        background: transparent;
        border-color: #475569;
        color: #94a3b8;
      }
    `;
    document.head.appendChild(s);
  }

  function escapeHtml(t) {
    return String(t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function matrixCell(v) {
    if (v === true) return '<span class="cg-yes">✓</span>';
    if (v === false) return '<span class="cg-no">—</span>';
    return `<span class="cg-warn">${escapeHtml(String(v))}</span>`;
  }

  function featureRow(label, browser, desktop, note) {
    return `<tr><td>${escapeHtml(label)}</td><td>${matrixCell(browser)}</td><td>${matrixCell(desktop)}</td><td>${escapeHtml(note || '')}</td></tr>`;
  }

  function tierRow(label, demo, team, superUser, note) {
    return `<tr><td>${escapeHtml(label)}</td><td>${matrixCell(demo)}</td><td>${matrixCell(team)}</td><td>${matrixCell(superUser)}</td><td>${escapeHtml(note || '')}</td></tr>`;
  }

  function overviewHtml() {
    const team = isTeam();
    const demo = isDemo();
    return `
      <h3>Your access: ${escapeHtml(tierLabel())}</h3>
      <p>Denizen starts as a live AI office. You claim one persistent assistant, collaborate with the whole team, and can turn your computer into a station that helps power the city.</p>
      <table class="cg-matrix">
        <thead><tr><th>Capability</th><th>Demo</th><th>Team</th><th>Desktop super-user</th></tr></thead>
        <tbody>
          ${tierRow('Walk office & chat', true, true, true, '')}
          ${tierRow('Claim personal assistant', true, true, true, '')}
          ${tierRow('Real tools (browser, code, research)', false, true, true, 'Team tier required')}
          ${tierRow('Hand off & briefing', false, true, true, '')}
          ${tierRow('Connect AI (Cursor, Companion)', false, true, true, '')}
          ${tierRow('Custom skills (Lucy → CEO approve)', false, true, true, '')}
          ${tierRow('City Power', false, 'opt-in', true, 'Download Denizen Desktop')}
          ${tierRow('PC / screen / file access', false, false, 'ask/trusted', 'Desktop + your permission')}
        </tbody>
      </table>
      ${demo ? '<p class="cg-warn">You are in demo mode. Upgrade via the account banner or Team login for full capabilities.</p>' : ''}
      ${team ? '<p>Install Denizen Desktop to create your office station, unlock approval-first computer help, and optionally add City Power.</p>' : ''}
    `;
  }

  function myAgentHtml() {
    const key = claimedNpc();
    const cap = key && globalThis.DenizenNpcCapabilities?.getCapabilities?.(key);
    if (!cap) {
      return `
        <h3>No assistant claimed yet</h3>
        <p>Walk up to an NPC and tap ⭐ Claim (or press C on desktop). Good starters:</p>
        <ul>
          <li><b>Lucy</b> — ops, scheduling, skill requests to CEO</li>
          <li><b>Alex</b> — engineering, coding-agent, GitHub</li>
          <li><b>Bob</b> — research and competitor analysis</li>
          <li><b>Roki</b> — quick tasks and learning</li>
        </ul>
        <p>After claiming, your assistant remembers context across sessions and can run team tools when you ask.</p>
      `;
    }
    const skills = (cap.skills || []).join(', ');
    const canDo = (cap.canDo || []).map((c) => `<li>${escapeHtml(c)}</li>`).join('');
    const ask = (cap.askMe || []).map((q) => `<li>"${escapeHtml(q)}"</li>`).join('');
    return `
      <h3>Your assistant: ${escapeHtml(cap.name || key)}</h3>
      <p class="role">${escapeHtml(cap.role || '')}</p>
      <p>${escapeHtml(cap.teaser || '')}</p>
      <h3>What they can do for you</h3>
      <ul>${canDo}</ul>
      <h3>Try asking</h3>
      <ul>${ask}</ul>
      ${skills ? `<p><b>Skills:</b> ${escapeHtml(skills)}</p>` : ''}
      <p>New capability not listed? Ask <b>Lucy</b> — she packages a skill proposal for Dolonia to approve.</p>
    `;
  }

  function teamAgentsHtml() {
    const names = globalThis.DenizenNpcCapabilities?.DISPLAY_NAMES || [];
    const cards = names.map((name) => {
      const cap = globalThis.DenizenNpcCapabilities?.getCapabilities?.(name);
      if (!cap) return '';
      return `
        <div class="cg-npc-card">
          <b>${escapeHtml(name)}</b> <span class="role">· ${escapeHtml(cap.role || '')}</span>
          <p>${escapeHtml(cap.teaser || '')}</p>
        </div>
      `;
    }).join('');
    return `
      <h3>Using other agents with your assistant</h3>
      <ul>
        <li><b>Walk & chat</b> — talk to any NPC directly; they use their own brain and skills.</li>
        <li><b>Your claimed assistant</b> — persists context for <i>you</i>; best for ongoing work.</li>
        <li><b>Hand off (↗)</b> — send context to Lucy, a teammate, leadership, or an accepted outside-team connection from chat.</li>
        <li><b>Agent-to-agent</b> — NPCs coordinate in the office (meetings, delegation tags, live work feed via Tab). DMs to your claimed assistant appear in the <b>agent inbox</b> toast.</li>
        <li><b>Connect AI</b> — wire Cursor/Companion to your claimed NPC so external AI and in-world assistant share one brain.</li>
      </ul>
      <h3>Office roster</h3>
      ${cards || '<p>Roster loading…</p>'}
    `;
  }

  function modelsHtml() {
    const team = isTeam();
    return `
      <h3>Multiple AIs working together</h3>
      <p>Denizen mixes <b>local models</b> (LM Studio on the mesh), <b>cloud APIs</b> (Anthropic/OpenAI), and <b>your keys</b> (BYOK) — routed per task.</p>
      <table class="cg-matrix">
        <thead><tr><th>Layer</th><th>What it powers</th><th>Who provides it</th></tr></thead>
        <tbody>
          <tr><td>Mesh / LM Studio</td><td>NPC think loops, queue jobs when capacity exists</td><td>Host + contributors</td></tr>
          <tr><td>Cloud (server)</td><td>Player chat, skill codegen, research</td><td>Operator API keys</td></tr>
          <tr><td>Your BYOK</td><td>Chat inference when mesh is busy; faster replies</td><td>Account → Anthropic/OpenAI key</td></tr>
          <tr><td>Connect AI</td><td>Cursor, Claude Desktop, ChatGPT, Companion extension</td><td>Your external client</td></tr>
        </tbody>
      </table>
      ${team ? `
        <p>Save optional API keys in <b>Account → Connect & notifications</b>. When the mesh queue is deep, your assistant may use your key for chat while mesh runs heavy jobs.</p>
        <p>After claiming, tap <b>Connect AI</b> in chat to link Cursor or the browser Companion — same assistant, two interfaces.</p>
      ` : '<p class="cg-warn">Team tier required for Connect AI and BYOK routing.</p>'}
    `;
  }

  function collabHtml() {
    const team = isTeam();
    return `
      <h3>Teammate collaboration</h3>
      <ul>
        <li><b>↗ Hand off</b> — in chat header; routes to Lucy, CEO, online teammates, or accepted outside-team connections.</li>
        <li><b>Morning briefing</b> — digest of commitments and pipeline (team).</li>
        <li><b>Tab work feed</b> — see what every NPC is doing in real time.</li>
        <li><b>Projects panel</b> — track visitor projects tied to your session.</li>
      </ul>
      <h3>Skills & permissions</h3>
      <ul>
        <li>Core skills (research, GitHub, coding-agent) work out of the box on team tier.</li>
        <li>New/custom skills → ask <b>Lucy</b> → research + GitHub scan + draft → <b>Dolonia approves</b> → skill unlocks for the team.</li>
        ${caps().canApproveSkills?.() ? '<li>You can approve skill proposals in <b>Account → Skills</b>.</li>' : ''}
      </ul>
      ${team ? '' : '<p class="cg-warn">Demo users can explore chat but not handoffs, briefing, or real tool execution.</p>'}
    `;
  }

  function meshHtml() {
    const node = globalThis.DenizenNodeUI?.getState?.() || {};
    const state = node.contributorState || 'browser_only';
    const superNode = !!node.isSuperNode;
    const browserOnly = !!caps().isBrowserOnlyWeb?.();
    return `
      <h3>Your client: ${escapeHtml(caps().clientModeLabel?.() || tierLabel())}</h3>
      ${browserOnly ? '<p class="cg-warn">Browser-only view - pair Denizen Desktop to create your office station, see its live status, and manage City Power. Your account stays connected when you return to the website.</p>' : ''}
      <h3>Browser vs Denizen Desktop</h3>
      <table class="cg-matrix">
        <thead><tr><th>Feature</th><th>Browser</th><th>Desktop app</th></tr></thead>
        <tbody>
          ${featureRow('Office game & chat', true, true, '')}
          ${featureRow('Station status', false, true, 'See this computer in your office network')}
          ${featureRow('City Power', false, true, 'Optional after pairing')}
          ${featureRow('Earn / spend credits', 'view', true, 'Boost job priority')}
          ${featureRow('Super Node badge (75+ score)', false, superNode ? 'yes' : 'possible', '')}
          ${featureRow('Agent uses your files/screen', false, 'with permission', '')}
        </tbody>
      </table>
      <h3>Your node state: ${escapeHtml(String(state).replace(/_/g, ' '))}</h3>
      <ol>
        <li><b>Browser only</b> - explore the office and work with your agents.</li>
        <li><b>Build your station</b> - download Denizen Desktop from City Power.</li>
        <li><b>Claim it</b> - connect your Citizen ID from the browser.</li>
        <li><b>Choose its role</b> - approve local abilities and turn City Power on or off.</li>
        <li><b>Power station</b> - stronger machines can take on more city work.</li>
      </ol>
      <p>Watch the office-to-city network in the <b>⬡ power</b> chip on the dock. Technical operators can still inspect the underlying workers and local AI pool.</p>
    `;
  }

  function desktopPowerHtml() {
    if (!isTeam()) {
      return '<p class="cg-warn">Desktop power features require team access and the Denizen Desktop app.</p>';
    }
    return `
      <h3>Beyond Claude Coworker — with your permission</h3>
      <p>With Denizen Desktop paired and <b>Cowork mode</b> enabled in the setup wizard, your claimed assistant can run PC skills on <b>your machine</b> (not the cloud server):</p>
      <ul>
        <li><b>desktop-agent</b> — vision + mouse/keyboard: click, type, fill forms, open apps</li>
        <li><b>browserclaw / web-search / research</b> — routed to your local screen and browser</li>
        <li><b>coding-agent / run-code</b> — local scripts and dev tools (with approval)</li>
        <li>Read and act on your <b>real screen</b> (screen-observe, desktop-agent)</li>
        <li>Run <b>browser automation</b> on your machine (browserclaw)</li>
        <li>Apply <b>code changes</b> in an isolated worktree (coding-agent)</li>
        <li>Execute <b>approved custom skills</b> against your environment</li>
        <li>Stay synced with <b>Cursor / Companion</b> via Connect AI</li>
        <li>Add <b>City Power</b> when you opt in</li>
      </ul>
      <p>Every sensitive action can prompt you in the Desktop permission window — you approve, deny, or trust per session.</p>
      <h3>Permission levels (Desktop wizard)</h3>
      <ul>
        <li><b>off</b> — advisory only, no PC control</li>
        <li><b>ask</b> — prompt before each file/screen/shell action (recommended)</li>
        <li><b>trusted</b> — auto-approve for your linked assistant (power users)</li>
      </ul>
      <p>Coworker-class work happens through your <b>claimed NPC</b> + Desktop bridge — not a separate siloed chat.</p>
    `;
  }

  const TAB_RENDERERS = {
    overview: overviewHtml,
    'my-agent': myAgentHtml,
    team: teamAgentsHtml,
    models: modelsHtml,
    collab: collabHtml,
    mesh: meshHtml,
    'desktop-power': desktopPowerHtml,
  };

  function visibleTabs() {
    return TABS.filter((t) => !t.teamOnly || isTeam());
  }

  function renderTab(tabId) {
    const fn = TAB_RENDERERS[tabId];
    return fn ? fn() : '';
  }

  let modalEl = null;
  let activeTab = 'overview';

  function close() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  function renderModal() {
    if (!modalEl) return;
    const tabs = visibleTabs();
    if (!tabs.find((t) => t.id === activeTab)) activeTab = tabs[0]?.id || 'overview';

    const body = modalEl.querySelector('.cg-body');
    const tabBar = modalEl.querySelector('.cg-tabs');
    if (tabBar) {
      tabBar.innerHTML = tabs.map((t) => `
        <button type="button" class="cg-tab${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}">${escapeHtml(t.label)}</button>
      `).join('');
      tabBar.querySelectorAll('.cg-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeTab = btn.getAttribute('data-tab');
          renderModal();
        });
      });
    }
    if (body) body.innerHTML = renderTab(activeTab);

    const tourBtn = modalEl.querySelector('.cg-super-tour');
    if (tourBtn) {
      tourBtn.hidden = !isTeam();
      tourBtn.onclick = () => {
        close();
        globalThis.DenizenSuperuserOnboarding?.replay?.();
      };
    }
  }

  function open(opts = {}) {
    injectStyles();
    if (modalEl) close();
    activeTab = opts.tab || 'overview';
    modalEl = document.createElement('div');
    modalEl.id = MODAL_ID;
    modalEl.innerHTML = `
      <div class="cg-card" role="dialog" aria-label="Denizen capabilities guide">
        <div class="cg-head">
          <h2>Office Guide</h2>
          <span class="cg-tier">${escapeHtml(tierLabel())}</span>
          <button type="button" class="cg-close">Close</button>
        </div>
        <div class="cg-tabs"></div>
        <div class="cg-body"></div>
        <div class="cg-actions">
          <button type="button" class="cg-btn cg-super-tour">City Power tour</button>
          <button type="button" class="cg-btn secondary cg-replay-team">Replay team tour</button>
          <button type="button" class="cg-btn secondary cg-close2">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
    modalEl.querySelector('.cg-close')?.addEventListener('click', close);
    modalEl.querySelector('.cg-close2')?.addEventListener('click', close);
    modalEl.querySelector('.cg-replay-team')?.addEventListener('click', () => {
      close();
      globalThis.DenizenVisitorOnboarding?.replay?.();
    });
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) close();
    });
    renderModal();
  }

  function mountChip() {
    if (sess()?.isCeoPrincipal?.()) return;
    injectStyles();
    let chip = document.getElementById(CHIP_ID);
    if (!chip) {
      chip = document.createElement('button');
      chip.id = CHIP_ID;
      chip.type = 'button';
      chip.textContent = 'Guide';
      chip.title = 'Office guide - agents, models, City Power, desktop';
      document.body.appendChild(chip);
    }
    chip.classList.add('ready');
    const clone = chip.cloneNode(true);
    chip.replaceWith(clone);
    const onPress = () => {
      window.DenizenHaptics?.tap?.();
      open();
    };
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) bind(clone, onPress);
    else clone.addEventListener('click', onPress);
    window.DenizenBottomDock?.refresh?.();
  }

  function init() {
    mountChip();
    document.addEventListener('denizen-visitor-session-ready', mountChip);
    document.addEventListener('denizen-deferred-scripts-ready', mountChip);
  }

  globalThis.DenizenCapabilitiesGuide = {
    open,
    close,
    mountChip,
    init,
    tierLabel,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
