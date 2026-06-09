/**
 * First-time visitor onboarding — guided tour after the office scene loads.
 * Demo visitors get a sales-oriented tour (value, limits, upgrade path).
 * Team members get the full day-to-day walkthrough including Lucy → CEO skill gating.
 * Attaches to globalThis.DenizenVisitorOnboarding (no imports).
 */
(function () {
  'use strict';

  const STORAGE_KEY_PREFIX = 'denizen-onboarding-seen-v3';
  const LEGACY_STORAGE_KEY = 'denizen-onboarding-seen-v2';
  const STYLE_ID = 'denizen-visitor-onboarding-style';
  const OVERLAY_ID = 'denizen-visitor-onboarding';
  const TOUR_CHIP_ID = 'denizen-onboarding-replay-chip';

  let scene = null;
  let playerChat = null;
  let overlayEl = null;
  let stepIndex = 0;
  let stepUnbinds = [];
  let activeSteps = [];

  function isTouchUi() {
    return document.documentElement.classList.contains('denizen-touch');
  }

  function isTapMove() {
    return document.documentElement.classList.contains('denizen-tap-move');
  }

  function isDemoVisitor() {
    const caps = globalThis.DenizenVisitorCapabilities;
    if (caps?.isDemo?.()) return true;
    const sess = globalThis.DenizenVisitorSession;
    return !!sess?.isDemo?.();
  }

  function isTeamVisitor() {
    const caps = globalThis.DenizenVisitorCapabilities;
    if (caps?.isTeam?.()) return true;
    const sess = globalThis.DenizenVisitorSession;
    return !!sess?.isTeam?.() && !sess?.isDemo?.();
  }

  function tourTier() {
    return isTeamVisitor() ? 'team' : 'demo';
  }

  function storageKey() {
    return `${STORAGE_KEY_PREFIX}-${tourTier()}`;
  }

  function moveLine() {
    if (isTouchUi() && isTapMove()) {
      return 'Tap anywhere on the floor to walk. Tap an NPC to start a conversation. Use E (top-right) near desks and chairs.';
    }
    if (isTouchUi()) {
      return 'Use the joystick to move, or tap a spot on the floor. Tap an NPC to talk.';
    }
    return 'Use arrow keys to walk. Walk up to an NPC and face them, or click their sprite to open chat.';
  }

  function claimLine() {
    if (isTouchUi()) {
      return 'Walk up to someone useful (Lucy, Alex, Roki…) and tap ⭐ Claim above the office.';
    }
    return 'Face an NPC and press C, or tap ⭐ Claim — they become your persistent assistant.';
  }

  function chatTips() {
    if (isDemoVisitor()) {
      return [
        'Tap 💬 in the dock (or press Enter / T on desktop) to open chat.',
        'Ask any NPC “What can you do?” — you are exploring how delegation works in a live AI office.',
        'Demo chat is real conversation, but sandboxed: no live browser automation, CRM, or team handoffs.',
        'Try Lucy (ops), Alex (engineering), or Bob (research) to see different roles.',
      ];
    }
    return [
      'Tap 💬 in the dock (or press Enter / T on desktop) to open chat.',
      'Ask Lucy about email, calendar, or job applications.',
      'Ask engineers (Alex, Josh, Edward) about code. Ask Bob or Lucy to research a topic.',
      'Try: “What can you do?” to see each NPC’s capabilities.',
    ];
  }

  function claimTips() {
    if (isDemoVisitor()) {
      return [
        claimLine(),
        'Claiming shows how a persistent assistant follows you across sessions on a paid team.',
        'In demo you can claim and chat, but your assistant cannot run team-only tools or custom skills yet.',
        'Good picks to try: Lucy (CEO’s assistant), Alex (engineering), Roki (quick tasks).',
      ];
    }
    return [
      claimLine(),
      'Your assistant remembers context across sessions and can be wired into Cursor, Claude, or ChatGPT.',
      'Good picks: Lucy (ops/admin), Alex (engineering lead), Roki (intern + quick tasks).',
    ];
  }

  function browserTips() {
    if (isDemoVisitor()) {
      return [
        'Tap 🌐 in the dock to preview how live browser work appears in Denizen.',
        'In demo, agents explain what they would search — team tier runs real browser automation.',
        'This is one reason teams upgrade: watch research, applications, and competitor checks happen live.',
      ];
    }
    return [
      'Tap 🌐 in the dock when Lucy (or another NPC) is searching the web.',
      'You see their browser live — useful for research, competitor checks, and client work.',
      'Ask in chat: “open a browser” or “search for …” then open 🌐 to follow along.',
    ];
  }

  function dailyTips() {
    if (isDemoVisitor()) {
      return [
        'You have seen the core loop: walk → chat → claim → watch the office work.',
        'Teams upgrade for handoffs, morning briefings, Connect AI, CRM data, and real tool execution.',
        'When you are ready, use the upgrade step or Log out → Team email login / Team code.',
      ];
    }
    return [
      'Start of day: Briefing → scan what the team promised overnight.',
      'Need something done: walk to the right NPC → 💬 chat → be specific.',
      'Blocked on a teammate: ↗ Hand off with context, not just a ping.',
      'Need a new capability? Ask Lucy — she packages skill proposals for CEO approval.',
      'Deep work in your IDE: Connect AI on your claimed assistant.',
      'Press Tab (desktop) for the live work feed — see what every NPC is doing right now.',
    ];
  }

  /** @type {Array<{ id: string, anchor: string, title: string, tips: string[] | (() => string[]), demoOnly?: boolean, teamOnly?: boolean, upgradeAction?: boolean }>} */
  const STEP_DEFS = [
    {
      id: 'welcome-demo',
      anchor: 'center',
      title: 'Welcome — explore Denizen',
      demoOnly: true,
      tips: [
        'You are in the demo office — a live pixel workspace where every character is an AI agent.',
        'Walk around, talk to NPCs, and claim an assistant to see how delegation feels in practice.',
        'This tour shows what Denizen is and what unlocks when your team goes paid.',
      ],
    },
    {
      id: 'welcome-team',
      anchor: 'center',
      title: 'Welcome to your AI office',
      teamOnly: true,
      tips: [
        'Denizen is your team’s live office — agents do real work while you delegate, watch, and hand off.',
        'You have full team access: research, briefings, handoffs, Connect AI, and skill requests through Lucy.',
        'This tour walks through the controls you will use every day.',
      ],
    },
    {
      id: 'move',
      anchor: 'game',
      title: 'Walk the office',
      tips: [
        moveLine,
        'The office runs 24/7 — NPCs keep thinking, talking, and producing work while you are away.',
      ],
    },
    {
      id: 'chat',
      anchor: 'chat-fab',
      title: 'Talk to any NPC',
      tips: chatTips,
    },
    {
      id: 'claim',
      anchor: 'claim',
      title: 'Claim your personal assistant',
      tips: claimTips,
    },
    {
      id: 'voice',
      anchor: 'voice',
      title: 'Hear NPC replies',
      tips: [
        'Tap 👤 in the dock to turn voice ON (green = on).',
        'When voice is on, NPCs speak aloud — useful when you are mobile or multitasking.',
        'Tap 👤 again to mute if you need a quiet session.',
      ],
    },
    {
      id: 'mic',
      anchor: 'mic',
      title: 'Speak instead of typing',
      tips: [
        'Tap 🎤 in the dock, speak your message, tap 🎤 again when done.',
        'Your words go into chat — great for quick asks while walking the office.',
        'Works best after you have opened 💬 chat at least once.',
      ],
    },
    {
      id: 'browser',
      anchor: 'browser',
      title: 'Watch live browser work',
      tips: browserTips,
    },
    {
      id: 'demo-limits',
      anchor: 'dock',
      title: 'What demo does not include',
      demoOnly: true,
      tips: [
        'Demo is a sandbox: no ↗ Hand off, Morning Briefing, Connect AI, or business CRM data.',
        'Agents will not run real desktop/browser tools or approved custom skills in demo.',
        'You still see a live office — NPCs think and talk — but execution stays read-only.',
      ],
    },
    {
      id: 'demo-value',
      anchor: 'center',
      title: 'Why teams pay for Denizen',
      demoOnly: true,
      tips: [
        'Persistent assistants wired to your stack — Cursor, Claude, Slack, email — same brain, two interfaces.',
        'Real execution: agents research, draft, apply, and coordinate overnight while you sleep.',
        'One office for delegating, watching progress, and handoffs — not another disconnected chat tab.',
        'New capabilities ship as approved skills, gated by Lucy and leadership so access stays controlled.',
      ],
    },
    {
      id: 'demo-upgrade',
      anchor: 'account',
      title: 'Upgrade to team access',
      demoOnly: true,
      upgradeAction: true,
      tips: [
        'Log out (account panel, top-right on desktop or Me tab on mobile) → choose Team email login or Team code.',
        'Your admin can invite you with a team code, or register with work email + code.',
        'Need access? Message Lucy in chat — she routes upgrade and onboarding requests to leadership.',
      ],
    },
    {
      id: 'handoff',
      anchor: 'handoff',
      title: 'Hand off to teammates',
      teamOnly: true,
      tips: [
        'Open 💬 chat, then tap ↗ Hand off in the chat header.',
        'Send context, a question, or a task to Lucy, a teammate, or leadership.',
        'When someone hands off to you, a toast appears — tap Reply to continue in chat.',
        'Use this instead of Slack for “can you take this?” moments inside Denizen.',
      ],
    },
    {
      id: 'connect',
      anchor: 'chat-header',
      title: 'Connect your own AI',
      teamOnly: true,
      tips: [
        'After you claim an NPC, tap Connect AI next to your assistant chip in chat.',
        'Link Cursor, Claude Desktop, or a ChatGPT Custom GPT to your in-world assistant.',
        'Your external AI can log activity, update memory, and read status — same brain, two interfaces.',
        'Day-to-day: keep coding in Cursor while your Denizen NPC stays in sync with the team.',
        'Ask research questions in chat — team tier gets cited web research when the server has BRAVE_SEARCH_API_KEY.',
        'Save optional API keys in Account → Connect & notifications (for your external client setup notes).',
      ],
    },
    {
      id: 'briefing',
      anchor: 'briefing',
      title: 'Morning briefing',
      teamOnly: true,
      tips: [
        'After you claim an assistant, a Briefing button appears in the chat header.',
        'Open it for the morning digest — open commitments, pipeline notes, and forecasts.',
        'Check it at the start of your day instead of digging through separate dashboards.',
      ],
    },
    {
      id: 'team-skills',
      anchor: 'chat-fab',
      title: 'Skills Lucy enables (with CEO approval)',
      teamOnly: true,
      tips: [
        'Your assistant ships with core skills — chat, memory, research, and everyday tasks.',
        'Need something advanced (new automation, CRM action, custom workflow)? Talk to Lucy, the CEO’s assistant.',
        'Lucy gathers requirements, packages a skill proposal, and runs it by the CEO before your team can use it.',
        'Try in chat: “Lucy, I need a skill that …” or ↗ Hand off to Lucy with full context.',
        'After CEO approval, the skill unlocks for your assistant — you do not install it yourself.',
        'Team leads with admin access may approve proposals from Account → Skills when the CEO delegates that authority.',
      ],
    },
    {
      id: 'team-agents',
      anchor: 'game',
      title: 'Work with every agent in the office',
      teamOnly: true,
      tips: [
        'Your claimed assistant is yours — but any NPC can help when you walk up and chat.',
        'Engineers (Alex, Josh, Edward) for code; Bob for research; Lucy for ops and skill requests.',
        'NPCs coordinate behind the scenes — press Tab (desktop) for the live work feed.',
        'Need Cursor in sync? Connect AI on your claimed assistant, not on every NPC.',
      ],
    },
    {
      id: 'capabilities-guide',
      anchor: 'guide',
      title: 'Capabilities Guide',
      teamOnly: true,
      tips: [
        'Tap Guide in the dock for the full reference: your assistant, team agents, models, mesh, desktop.',
        'Use it when onboarding teammates — explains browser vs desktop and multi-model routing.',
        'Super-users: Guide → Desktop power covers permission levels and coworker-class automation.',
      ],
    },
    {
      id: 'mesh-intro',
      anchor: 'compute',
      title: 'Mesh compute (optional super-user path)',
      teamOnly: true,
      tips: [
        'The Compute panel (top-right) shows your node: browser-only until you install Denizen Desktop.',
        'Download Desktop → Pair this computer → opt in to contribute GPU/CPU to the team mesh.',
        'Watch fleet jobs in the ⬡ mesh chip. Hardware score 75+ earns Super Node priority.',
        'Replay the Mesh tour anytime from Guide or the Mesh tour chip in the dock.',
      ],
    },
    {
      id: 'demo-guide',
      anchor: 'guide',
      title: 'See the full capability matrix',
      demoOnly: true,
      tips: [
        'Tap Guide in the dock — compare demo vs team vs desktop super-user capabilities.',
        'Shows how multiple AIs work together: mesh, cloud APIs, BYOK keys, and Connect AI.',
        'When you upgrade, the same Guide expands with handoffs, mesh, and desktop power details.',
      ],
    },
    {
      id: 'daily',
      anchor: 'dock',
      title: 'Wrap-up',
      tips: dailyTips,
    },
  ];

  function resolveTips(step) {
    const raw = typeof step.tips === 'function' ? step.tips() : step.tips;
    return raw.map((t) => (typeof t === 'function' ? t() : t));
  }

  function buildSteps() {
    const team = isTeamVisitor();
    return STEP_DEFS.filter((s) => {
      if (s.demoOnly && team) return false;
      if (s.teamOnly && !team) return false;
      return true;
    }).map((s) => {
      if (s.id !== 'daily') return s;
      return {
        ...s,
        title: team ? 'Your day-to-day cheat sheet' : 'What you have seen',
      };
    });
  }

  function hasSeenOnboarding() {
    try {
      if (localStorage.getItem(storageKey()) === '1') return true;
      if (tourTier() === 'team' && localStorage.getItem(LEGACY_STORAGE_KEY) === '1') return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(storageKey(), '1');
    } catch (_) {}
  }

  function shouldShow() {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isCeoPrincipal?.()) return false;
    return !hasSeenOnboarding();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147482000;
        pointer-events: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(2, 6, 23, 0.55);
        pointer-events: auto;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-tooltip {
        position: fixed;
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 10px;
        padding: 16px 18px;
        width: min(380px, calc(100vw - 28px));
        max-height: min(72dvh, 520px);
        overflow-y: auto;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
        pointer-events: auto;
        color: #e2e8f0;
        touch-action: manipulation;
        z-index: 1;
      }
      #${OVERLAY_ID} .onb-step {
        margin: 0 0 6px;
        font-size: 10px;
        color: #4ade80;
        font-weight: bold;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      #${OVERLAY_ID} .onb-tier-badge {
        display: inline-block;
        margin-left: 6px;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 9px;
        letter-spacing: 0.06em;
        vertical-align: middle;
      }
      #${OVERLAY_ID} .onb-tier-badge.demo {
        background: rgba(56, 189, 248, 0.15);
        color: #7dd3fc;
        border: 1px solid rgba(56, 189, 248, 0.35);
      }
      #${OVERLAY_ID} .onb-tier-badge.team {
        background: rgba(74, 222, 128, 0.12);
        color: #86efac;
        border: 1px solid rgba(74, 222, 128, 0.35);
      }
      #${OVERLAY_ID} .onb-title {
        margin: 0 0 10px;
        font-size: 15px;
        line-height: 1.3;
        color: #f8fafc;
        font-weight: bold;
      }
      #${OVERLAY_ID} .onb-tips {
        margin: 0 0 14px;
        padding-left: 18px;
        font-size: 12px;
        line-height: 1.5;
        color: #cbd5e1;
      }
      #${OVERLAY_ID} .onb-tips li {
        margin-bottom: 6px;
      }
      #${OVERLAY_ID} .onb-tips li:last-child {
        margin-bottom: 0;
      }
      #${OVERLAY_ID} .onb-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        align-items: center;
        flex-wrap: wrap;
        position: sticky;
        bottom: 0;
        background: #020617;
        padding-top: 8px;
      }
      #${OVERLAY_ID} .onb-skip,
      #${OVERLAY_ID} .onb-next,
      #${OVERLAY_ID} .onb-upgrade {
        min-height: 44px;
        touch-action: manipulation;
      }
      #${OVERLAY_ID} .onb-skip {
        background: transparent;
        border: none;
        color: #64748b;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        padding: 8px 10px;
      }
      #${OVERLAY_ID} .onb-skip:hover { color: #94a3b8; }
      #${OVERLAY_ID} .onb-next {
        background: #4ade80;
        color: #0f172a;
        border: none;
        border-radius: 6px;
        padding: 10px 16px;
        font: inherit;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
      }
      #${OVERLAY_ID} .onb-next:hover { background: #22c55e; }
      #${OVERLAY_ID} .onb-upgrade {
        background: transparent;
        color: #7dd3fc;
        border: 1px solid rgba(56, 189, 248, 0.45);
        border-radius: 6px;
        padding: 10px 14px;
        font: inherit;
        font-size: 11px;
        font-weight: bold;
        cursor: pointer;
        margin-right: auto;
      }
      #${OVERLAY_ID} .onb-upgrade:hover {
        border-color: #38bdf8;
        color: #e0f2fe;
      }
      #${OVERLAY_ID} .onb-dots {
        display: flex;
        gap: 5px;
        margin-right: auto;
        flex-wrap: wrap;
        max-width: 55%;
      }
      #${OVERLAY_ID} .onb-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: #1f2937;
        flex-shrink: 0;
      }
      #${OVERLAY_ID} .onb-dot.active { background: #4ade80; }
      html[data-denizen-onboarding="open"] #game-container,
      html[data-denizen-onboarding="open"] #game-container canvas,
      html[data-denizen-onboarding="open"] #denizen-bottom-dock,
      html[data-denizen-onboarding="open"] #denizen-mobile-controls {
        pointer-events: none !important;
      }
      #${TOUR_CHIP_ID} {
        display: none;
        background: rgba(15, 23, 42, 0.96);
        color: #a5f3fc;
        border: 1px solid rgba(34, 211, 238, 0.35);
        border-radius: 999px;
        padding: 6px 11px;
        font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: bold;
        cursor: pointer;
        touch-action: manipulation;
      }
      #${TOUR_CHIP_ID}.ready { display: inline-flex; align-items: center; }
      #${TOUR_CHIP_ID}:hover { border-color: #22d3ee; color: #e0f2fe; }
    `;
    document.head.appendChild(s);
  }

  function canUseReplayChip() {
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isCeoPrincipal?.()) return false;
    return true;
  }

  function replayChipLabel() {
    return isTeamVisitor() ? 'Team tour' : 'Demo tour';
  }

  function rewireReplayChip() {
    const chip = document.getElementById(TOUR_CHIP_ID);
    if (!chip) return;
    chip.textContent = replayChipLabel();
    chip.title = `Replay the ${isTeamVisitor() ? 'team' : 'demo'} onboarding tour`;
    const clone = chip.cloneNode(true);
    chip.replaceWith(clone);
    const onPress = () => {
      window.DenizenHaptics?.tap?.();
      globalThis.DenizenVisitorOnboarding?.replay?.();
    };
    const bind = window.DenizenTouchBind?.bindPress;
    if (bind) bind(clone, onPress);
    else clone.addEventListener('click', onPress);
  }

  function mountReplayChip() {
    if (!canUseReplayChip()) {
      document.getElementById(TOUR_CHIP_ID)?.remove();
      return;
    }
    injectStyles();
    let chip = document.getElementById(TOUR_CHIP_ID);
    if (!chip) {
      chip = document.createElement('button');
      chip.id = TOUR_CHIP_ID;
      chip.type = 'button';
      document.body.appendChild(chip);
    }
    chip.classList.add('ready');
    rewireReplayChip();
    window.DenizenBottomDock?.refresh?.();
  }

  function centerRect() {
    return {
      left: window.innerWidth / 2 - 160,
      top: window.innerHeight / 2 - 100,
      width: 320,
      height: 200,
      bottom: window.innerHeight / 2 + 100,
      right: window.innerWidth / 2 + 160,
    };
  }

  function rectForEl(id) {
    const el = document.getElementById(id);
    if (!el || el.offsetParent === null && id !== 'denizen-bottom-dock') return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return null;
    return r;
  }

  function getAnchorRect(anchor) {
    if (anchor === 'center') return centerRect();
    if (anchor === 'claim') {
      return rectForEl('denizen-visitor-claim-btn') || rectForEl('game-container') || centerRect();
    }
    if (anchor === 'chat-fab') {
      return rectForEl('player-chat-fab') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'voice') {
      return rectForEl('denizen-presence-chip') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'mic') {
      return rectForEl('denizen-mic-button') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'browser') {
      return rectForEl('denizen-browser-mirror-chip') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'briefing') {
      return rectForEl('denizen-visitor-briefing-btn')
        || rectForEl('player-chat-header')
        || centerRect();
    }
    if (anchor === 'chat-header') {
      return rectForEl('player-chat-header')
        || rectForEl('denizen-visitor-assistant-chip')
        || rectForEl('player-chat-fab')
        || centerRect();
    }
    if (anchor === 'handoff') {
      return rectForEl('denizen-visitor-handoff-btn')
        || rectForEl('player-chat-header')
        || rectForEl('player-chat-fab')
        || centerRect();
    }
    if (anchor === 'account') {
      return rectForEl('denizen-account-panel')
        || rectForEl('denizen-acct-identity')
        || centerRect();
    }
    if (anchor === 'dock') {
      return rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'guide') {
      return rectForEl('denizen-capabilities-guide-chip') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    if (anchor === 'compute') {
      return rectForEl('denizen-node-ui-chip') || centerRect();
    }
    if (anchor === 'mesh') {
      return rectForEl('denizen-mesh-jobs-chip') || rectForEl('denizen-bottom-dock') || centerRect();
    }
    const gc = document.getElementById('game-container');
    if (anchor === 'game' && gc) return gc.getBoundingClientRect();
    return centerRect();
  }

  function safeMargins() {
    const root = getComputedStyle(document.documentElement);
    const num = (v) => parseFloat(v) || 0;
    const dockH = num(root.getPropertyValue('--denizen-dock-height')) || 48;
    return {
      top: Math.max(12, num(root.getPropertyValue('--safe-top')) + 8),
      right: Math.max(12, num(root.getPropertyValue('--safe-right')) + 8),
      bottom: Math.max(12, num(root.getPropertyValue('--safe-bottom')) + dockH + 12),
      left: Math.max(12, num(root.getPropertyValue('--safe-left')) + 8),
    };
  }

  function positionTooltip(tooltip, anchor) {
    const rect = getAnchorRect(anchor);
    const margin = safeMargins();
    const tooltipRect = tooltip.getBoundingClientRect();
    let top = rect.bottom + margin.top;
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;

    if (anchor === 'center') {
      top = window.innerHeight / 2 - tooltipRect.height / 2;
      left = window.innerWidth / 2 - tooltipRect.width / 2;
    } else if (top + tooltipRect.height > window.innerHeight - margin.bottom) {
      top = rect.top - tooltipRect.height - margin.top;
    }
    left = Math.max(margin.left, Math.min(left, window.innerWidth - tooltipRect.width - margin.right));
    top = Math.max(margin.top, Math.min(top, window.innerHeight - tooltipRect.height - margin.bottom));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function clearStepUnbinds() {
    stepUnbinds.forEach((fn) => fn());
    stepUnbinds = [];
  }

  async function startUpgradeFlow() {
    markSeen();
    dismiss({ keepOverlayState: true });
    try {
      await globalThis.DenizenVisitorSession?.logout?.();
    } catch (err) {
      console.warn('[DenizenVisitorOnboarding] upgrade logout failed:', err?.message || err);
    }
  }

  function wireStepButtons(skipBtn, nextBtn, upgradeBtn) {
    clearStepUnbinds();
    const onNext = () => {
      if (stepIndex < activeSteps.length - 1) {
        stepIndex += 1;
        renderStep();
      } else {
        dismiss();
      }
    };
    const bind = window.DenizenTouchBind?.bindPress;
    if (skipBtn) {
      const handler = (e) => {
        e?.preventDefault?.();
        dismiss();
      };
      if (bind) {
        const offSkip = bind(skipBtn, handler, { stop: true });
        if (typeof offSkip === 'function') stepUnbinds.push(offSkip);
      } else {
        skipBtn.addEventListener('click', handler);
        stepUnbinds.push(() => skipBtn.removeEventListener('click', handler));
      }
    }
    if (upgradeBtn) {
      const handler = (e) => {
        e?.preventDefault?.();
        startUpgradeFlow();
      };
      if (bind) {
        const offUp = bind(upgradeBtn, handler, { stop: true });
        if (typeof offUp === 'function') stepUnbinds.push(offUp);
      } else {
        upgradeBtn.addEventListener('click', handler);
        stepUnbinds.push(() => upgradeBtn.removeEventListener('click', handler));
      }
    }
    if (nextBtn) {
      const handler = (e) => {
        e?.preventDefault?.();
        onNext();
      };
      if (bind) {
        const offNext = bind(nextBtn, handler, { stop: true });
        if (typeof offNext === 'function') stepUnbinds.push(offNext);
      } else {
        nextBtn.addEventListener('click', handler);
        stepUnbinds.push(() => nextBtn.removeEventListener('click', handler));
      }
    }
  }

  function dismiss(opts = {}) {
    if (!opts.keepOverlayState) markSeen();
    delete document.documentElement.dataset.denizenOnboarding;
    clearStepUnbinds();
    if (overlayEl) {
      if (overlayEl._cleanup) overlayEl._cleanup();
      overlayEl.remove();
      overlayEl = null;
    }
    stepIndex = 0;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tourAriaLabel() {
    return isTeamVisitor() ? 'Team onboarding tour' : 'Demo onboarding tour';
  }

  function tierBadgeHtml() {
    const team = isTeamVisitor();
    const cls = team ? 'team' : 'demo';
    const label = team ? 'Team' : 'Demo';
    return `<span class="onb-tier-badge ${cls}">${label}</span>`;
  }

  function renderStep() {
    if (!overlayEl) return;
    const step = activeSteps[stepIndex];
    if (!step) {
      dismiss();
      return;
    }

    const tips = resolveTips(step);
    const isLast = stepIndex >= activeSteps.length - 1;
    const tooltip = overlayEl.querySelector('.onb-tooltip');
    tooltip.innerHTML = `
      <p class="onb-step">Step ${stepIndex + 1} of ${activeSteps.length}${tierBadgeHtml()}</p>
      <p class="onb-title">${escapeHtml(step.title)}</p>
      <ul class="onb-tips">
        ${tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
      <div class="onb-actions">
        <div class="onb-dots">
          ${activeSteps.map((_, i) => `<span class="onb-dot${i === stepIndex ? ' active' : ''}"></span>`).join('')}
        </div>
        ${step.upgradeAction ? '<button type="button" class="onb-upgrade">Get team access</button>' : ''}
        <button type="button" class="onb-skip">Skip tour</button>
        <button type="button" class="onb-next">${isLast ? 'Start working' : 'Next'}</button>
      </div>
    `;

    wireStepButtons(
      tooltip.querySelector('.onb-skip'),
      tooltip.querySelector('.onb-next'),
      tooltip.querySelector('.onb-upgrade'),
    );

    requestAnimationFrame(() => positionTooltip(tooltip, step.anchor));
  }

  function showTour(opts = {}) {
    const force = !!opts.force;
    if (overlayEl) {
      if (overlayEl._cleanup) overlayEl._cleanup();
      overlayEl.remove();
      overlayEl = null;
      clearStepUnbinds();
      delete document.documentElement.dataset.denizenOnboarding;
    }
    if (!force && !shouldShow()) return;

    activeSteps = buildSteps();
    if (!activeSteps.length) return;

    injectStyles();
    document.documentElement.dataset.denizenOnboarding = 'open';
    overlayEl = document.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.innerHTML = `
      <div class="onb-backdrop" aria-hidden="true"></div>
      <div class="onb-tooltip" role="dialog" aria-label="${escapeHtml(tourAriaLabel())}"></div>
    `;
    document.body.appendChild(overlayEl);

    stepIndex = 0;
    renderStep();

    const onResize = () => {
      const tooltip = overlayEl?.querySelector('.onb-tooltip');
      const step = activeSteps[stepIndex];
      if (tooltip && step) positionTooltip(tooltip, step.anchor);
    };
    window.addEventListener('resize', onResize);
    overlayEl._cleanup = () => window.removeEventListener('resize', onResize);
  }

  function waitForSceneReady(sc, pc, attempt = 0) {
    if (!shouldShow()) return;
    if (sc?.player && document.getElementById('game-container')) {
      setTimeout(showTour, 800);
      return;
    }
    if (attempt >= 40) {
      showTour();
      return;
    }
    setTimeout(() => waitForSceneReady(sc, pc, attempt + 1), 250);
  }

  function onSessionReady() {
    mountReplayChip();
    if (shouldShow()) {
      if (scene?.player && document.getElementById('game-container')) {
        setTimeout(showTour, 600);
      } else {
        waitForSceneReady(scene, playerChat);
      }
    }
  }

  function onLoggedOut() {
    dismiss({ keepOverlayState: true });
  }

  const DenizenVisitorOnboarding = {
    attach(sc, pc) {
      scene = sc;
      playerChat = pc;

      document.addEventListener('denizen-visitor-session-ready', onSessionReady);
      document.addEventListener('denizen-visitor-logged-out', onLoggedOut);

      const afterSession = () => onSessionReady();

      globalThis.DenizenVisitorSession?.init?.().then(afterSession).catch(afterSession);

      console.log('[DenizenVisitorOnboarding] attached');
    },

    detach() {
      document.removeEventListener('denizen-visitor-session-ready', onSessionReady);
      document.removeEventListener('denizen-visitor-logged-out', onLoggedOut);
      if (overlayEl?._cleanup) overlayEl._cleanup();
      dismiss();
      document.getElementById(TOUR_CHIP_ID)?.remove();
      scene = null;
      playerChat = null;
    },

    replay() {
      if (!canUseReplayChip()) return false;
      activeSteps = buildSteps();
      if (!activeSteps.length) return false;
      stepIndex = 0;
      showTour({ force: true });
      return true;
    },

    rewireReplayChip,

    resetForTesting() {
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        localStorage.removeItem('denizen-onboarding-seen');
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}-demo`);
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}-team`);
      } catch (_) {}
    },
  };

  globalThis.DenizenVisitorOnboarding = DenizenVisitorOnboarding;
})();
