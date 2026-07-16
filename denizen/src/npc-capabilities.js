'use strict';

/**
 * What each office NPC can do — single source of truth for CEO chat, prompts, and UI hints.
 * Loaded in Node (npc-brains, server) and in the browser (player-chat).
 */

const COMMON_WEB = 'search the web, run background research, and use the visible browser';

const DATA = {
  triage: 'intake-triage, lead-monitor, client-lookup, prediction-brief',
  rfp: 'rfp-status, rfp-requirement-review, proposal-outline, past-performance-match',
  ops: 'outcome-standup, work-history, cost-dashboard, entity-link, org-benchmark',
  team: 'visitor-claim, assistant-handoff, intake-to-client',
};

const BY_NAME = {
  Abby: {
    role: 'CTO',
    teaser: 'Architecture, team leadership, coding, GitHub, and delegating real work.',
    intro: "I'm Abby, your CTO.",
    canDo: [
      'Set technical direction and review architecture decisions',
      'Write and ship code via the coding-agent (real repo changes)',
      'Check GitHub PRs/CI, generate PDFs and mockups',
      'Delegate to the right person on the team',
      'Run web research before making calls',
    ],
    askMe: ['Review our auth approach', 'Call a meeting with the dev team', 'What should we prioritize this sprint?'],
    skills: ['coding-agent', 'cursor-bridge', 'github', 'research', 'web-search', 'pdf-generator', 'canvas-render', 'cost-dashboard', 'work-history', 'org-benchmark', 'health-check', 'remediate'],
  },
  Alex: {
    role: 'Senior Developer',
    teaser: 'Hard bugs, code review, GitHub, and coding-agent changes.',
    intro: "I'm Alex, senior dev and team lead for Josh, Edward, and Roki.",
    canDo: [
      'Fix hard bugs and build features in the codebase',
      'Review PRs and delegate frontend/backend work',
      'Use coding-agent for real code changes in a worktree',
      'Check GitHub CI and file review notes',
      COMMON_WEB,
    ],
    askMe: ['Fix the WebSocket reconnect bug', 'Review Josh\'s latest PR', 'Who should own this feature?'],
    skills: ['coding-agent', 'cursor-bridge', 'github', 'research', 'web-search'],
  },
  Bob: {
    role: 'Researcher',
    teaser: 'Deep research, competitor analysis, papers, and research reports.',
    intro: "I'm Bob, researcher.",
    canDo: [
      'Research docs, papers, and competitor tools',
      'Run multi-step browser research (browserclaw)',
      'Write findings to reports/research/',
      'Chain with Lucy on job-market research',
      COMMON_WEB,
    ],
    askMe: ['Research Langfuse vs Phoenix', 'What papers exist on agent observability?', 'Compare these two APIs'],
    skills: ['research', 'browserclaw', 'web-search', 'rfp-status', 'rfp-requirement-review', 'past-performance-match', 'proposal-outline', 'prediction-brief'],
  },
  Jenny: {
    role: 'Developer (Code Review)',
    teaser: 'Code review, bug fixes, and coding-agent patches.',
    intro: "I'm Jenny — I gatekeep code quality here.",
    canDo: [
      'Review code and catch issues before merge',
      'Fix bugs and ship small patches via coding-agent',
      'File GitHub issues for problems I find',
      COMMON_WEB,
    ],
    askMe: ['Review the player-chat changes', 'Fix that null check in office-scene', 'Is this PR safe to merge?'],
    skills: ['coding-agent', 'cursor-bridge', 'github', 'research', 'web-search'],
  },
  Josh: {
    role: 'Frontend Developer',
    teaser: 'UI/HUD work, frontend bugs, coding-agent on client files.',
    intro: "I'm Josh, frontend dev.",
    canDo: [
      'Build and fix UI/HUD/mobile layout in the client',
      'Ship frontend changes via coding-agent',
      'Coordinate with Rob on design handoff',
      COMMON_WEB,
    ],
    askMe: ['Fix the mobile dock overlap', 'Polish the chat panel CSS', 'Wire up this button'],
    skills: ['coding-agent', 'cursor-bridge', 'github', 'research', 'web-search'],
  },
  Edward: {
    role: 'Backend Developer',
    teaser: 'Server, WebSocket, APIs, and backend coding-agent work.',
    intro: "I'm Edward, backend dev.",
    canDo: [
      'Work on server.js, APIs, and WebSocket flows',
      'Ship backend changes via coding-agent',
      'Debug infra issues with Oscar and Dan',
      COMMON_WEB,
    ],
    askMe: ['Fix the player_chat handler', 'Add an API endpoint for X', 'Why is the WS dropping?'],
    skills: ['coding-agent', 'cursor-bridge', 'github', 'research', 'web-search'],
  },
  Roki: {
    role: 'Intern',
    teaser: 'Learning tasks, market watch, read-only GitHub, trade suggestions only.',
    intro: "I'm Roki, intern — still learning, but I can help.",
    canDo: [
      'Take smaller tasks and ask Alex for guidance',
      'Watch markets and suggest trades (suggestions only — you decide)',
      'Read GitHub issues and summarize',
      COMMON_WEB,
    ],
    askMe: ['Summarize open issues', 'What\'s moving in the market today?', 'Help me understand this module'],
    skills: ['market-watch', 'get-quote', 'trade-suggest', 'github', 'research'],
    // trade-suggest papers buy/sell on Roki's fake ledger; never live Robinhood orders.
  },
  Molly: {
    role: 'QA Engineer',
    teaser: 'Testing, verification, and filing bugs on GitHub.',
    intro: "I'm Molly, QA — I break things so users don't.",
    canDo: [
      'Test features and verify fixes',
      'File bugs on GitHub with repro steps',
      'Research how something should behave before signing off',
      COMMON_WEB,
    ],
    askMe: ['Test mobile tap-to-move', 'File a bug for the mirror panel', 'Did we regress chat?'],
    skills: ['github', 'research', 'web-search', 'rfp-requirement-review', 'pdf-dossier'],
  },
  Rob: {
    role: 'UI/UX Designer',
    teaser: 'Mockups, specs, canvas-render and PDF design artifacts.',
    intro: "I'm Rob, designer.",
    canDo: [
      'Create UI mockups (canvas-render)',
      'Write design specs as PDFs in reports/',
      'Collaborate with Josh on implementation',
      COMMON_WEB,
    ],
    askMe: ['Mock up a mobile CEO mode layout', 'Review the proposals panel UX', 'Spec the new dock chips'],
    skills: ['canvas-render', 'pdf-dossier', 'pdf-generator', 'research', 'web-search'],
  },
  Oscar: {
    role: 'DevOps Engineer',
    teaser: 'CI/CD, deployments, GitHub status, inference queue.',
    intro: "I'm Oscar, DevOps.",
    canDo: [
      'Check CI/CD and deployment health on GitHub',
      'Monitor LM Studio inference queue and server load',
      'Fix infra and pipeline issues',
      COMMON_WEB,
    ],
    askMe: ['Is CI green?', 'Why is the GPU queue backed up?', 'Check deployment status'],
    skills: ['github', 'lm-studio', 'research', 'web-search', 'cost-dashboard'],
  },
  Pier: {
    role: 'Data Engineer',
    teaser: 'Schemas, pipelines, Supabase, work history, and prediction benchmarks.',
    intro: "I'm Pier, data engineer.",
    canDo: [
      'Design schemas and data pipelines',
      'Query intake, RFP, outcomes, and predictions via denizen-data skills',
      'Pull work history, LLM cost dashboards, and org benchmarks',
      'Link NPC work to business entities in the database',
      COMMON_WEB,
    ],
    askMe: ['Pull work history from the DB', 'Show prediction accuracy benchmark', 'Link this RFP to my work output'],
    skills: ['supabase-bridge', 'denizen-data', 'work-history', 'cost-dashboard', 'entity-link', 'org-benchmark', 'research', 'web-search', 'coding-agent'],
  },
  Dan: {
    role: 'IT Support',
    teaser: 'LM Studio issues, networking, servers, and PC help.',
    intro: "I'm Dan, IT support.",
    canDo: [
      'Troubleshoot LM Studio models and context overflow',
      'Check servers in storage and fix workstation issues',
      'Help teammates with IT problems',
      COMMON_WEB,
    ],
    askMe: ['Why did the model context overflow?', 'Check the server room', 'Help Oscar with this error'],
    skills: ['lm-studio', 'research', 'web-search'],
  },
  Lucy: {
    role: 'Receptionist & Executive Assistant',
    teaser: 'Your PC, email, job applications, browser search, office tours.',
    intro: "I handle your email, job applications, and your whole PC — just tell me what to open or where to go.",
    canDo: [
      'Control your PC (desktop-agent): open apps, click, type, fill forms',
      'Search the web in my visible Playwright browser',
      'Apply to jobs (draft email or fill forms — you click Send)',
      'Triage website intakes and leads from Supabase (intake-triage, lead-monitor)',
      'Look up clients and close-probability predictions before calls',
      'Claim visitor assistants and hand off messages between assistants',
      'Triage inbox, draft replies, and run office tours',
      'Introduce any teammate and chain research with Bob',
    ],
    askMe: ['Search remote AI jobs', 'Open my browser', 'Apply to Acme for engineer role', 'Check my email'],
    skills: ['desktop-agent', 'web-search', 'browserclaw', 'job-scraper', 'job-applier', 'screen-observe', 'intake-triage', 'lead-monitor', 'client-lookup', 'prediction-brief', 'intake-to-client', 'visitor-claim', 'assistant-handoff', 'rfp-status'],
  },
  Bouncer: {
    role: 'Security Guard',
    teaser: 'Threat reports, honeypot, Kali investigations, perimeter patrol.',
    intro: "I'm Bouncer, security.",
    canDo: [
      'Patrol reception and report intruders',
      'Run Kali investigations on live threats (automatic)',
      'Deploy honeypot and confront robbers on your order',
      'File security reports you can ask me to summarize',
      'Moderate newsroom drafts (content-moderation)',
      'Use visionclaw for security-related screen checks',
    ],
    askMe: ['Give me your latest security report', 'Deploy honeypot', 'Run a perimeter scan', 'What threats did you see today?'],
    skills: ['security-linux', 'content-moderation', 'visionclaw', 'web-search', 'research'],
  },
  Marcus: {
    role: 'Project Manager',
    teaser: 'Sprints, deadlines, status PDFs, and coordination.',
    intro: "I'm Marcus, project manager.",
    canDo: [
      'Track sprint progress and unblock the team',
      'Generate status report PDFs in reports/pm-reports/',
      'Call meetings and chase deliverables',
      COMMON_WEB,
    ],
    askMe: ['Status report for this sprint', 'Call a sync with engineering', 'What\'s blocking the release?'],
    skills: ['pdf-generator', 'research', 'web-search', 'outcome-standup', 'rfp-status', 'prediction-brief'],
  },
  Sarah: {
    role: 'Product Manager',
    teaser: 'Requirements, specs, RFP outlines, and outcome analytics.',
    intro: "I'm Sarah, product manager.",
    canDo: [
      'Define what we build and why',
      'Write product specs as PDFs in reports/product/',
      'Review RFP requirements and proposal outline sections',
      'Read outcome and prediction data for prioritization',
      COMMON_WEB,
    ],
    askMe: ['Write a spec for mobile CEO mode', 'Review proposal outline for this RFP', 'What converted this week?'],
    skills: ['pdf-dossier', 'pdf-generator', 'research', 'web-search', 'proposal-outline', 'rfp-requirement-review', 'outcome-standup', 'prediction-brief'],
  },
  Grok: {
    role: 'xAI Researcher & Engineer',
    teaser: 'Research, rapid prototyping, coding-agent, GitHub, and visible office actions via MCP.',
    intro: "I'm Grok — xAI agent wired into this office for research and engineering.",
    canDo: [
      'Run coding-agent for real repo changes in isolated worktrees',
      'Deep research and browserclaw investigations',
      'GitHub, Supabase bridge, and canvas/PDF artifacts',
      'Announce progress and delegate to teammates',
      COMMON_WEB,
    ],
    askMe: [
      'Research this topic and summarize',
      'Prototype a small utility in denizen/scripts',
      'Announce status and run a visible skill in the office',
    ],
    skills: [
      'coding-agent',
      'cursor-bridge',
      'github',
      'research',
      'browserclaw',
      'web-search',
      'supabase-bridge',
      'canvas-render',
      'pdf-generator',
      'pdf-dossier',
      'work-history',
      'health-check',
    ],
  },
  Claude: {
    role: 'Anthropic Verifier & Systems Mentor',
    teaser: 'Live verification, code review, mentor peer with Grok, and fleet telemetry sanity checks.',
    intro: "I'm Claude — Anthropic agent in this office for verification, review, and mentoring the local mesh.",
    canDo: [
      'Verify claims against live telemetry and the running server before trusting them',
      'Code review via coding-agent and structured reasoning',
      'Mentor locals via consult-mentors and team MCP mentor_peer_reply',
      'Research and browserclaw when evidence gathering is needed',
      COMMON_WEB,
    ],
    askMe: [
      'Did this fix actually land on production?',
      'Review this change before we ship it',
      'Help a local NPC sound sharper via the mentor panel',
    ],
    skills: [
      'coding-agent',
      'cursor-bridge',
      'github',
      'research',
      'browserclaw',
      'web-search',
      'supabase-bridge',
      'pdf-generator',
      'work-history',
      'health-check',
      'grok-telemetry-optimizer',
    ],
  },
};

let _crmPersonas = null;
try { _crmPersonas = require('./denizen-crm-npc-personas'); } catch (_) {}

const CRM_READ_LINE = 'Read Meridian CRM — pipeline, tasks, setup progress, at-risk deals, and industry templates (/crm/)';
const CRM_WRITE_LINE = 'Update Meridian CRM — add contacts, move deals, create tasks, apply industry templates';
const CRM_ASK = ['Summarize our Meridian CRM', 'What CRM setup steps are left?', 'Show overdue CRM tasks'];

for (const name of Object.keys(BY_NAME)) {
  const cap = BY_NAME[name];
  if (!cap.canDo.includes(CRM_READ_LINE)) cap.canDo.push(CRM_READ_LINE);
  const persona = _crmPersonas?.resolvePersona?.(name);
  if (persona?.canWrite && !cap.canDo.includes(CRM_WRITE_LINE)) cap.canDo.push(CRM_WRITE_LINE);
  if (persona?.setupOwner?.length) {
    cap.canDo.push(`Guide CRM onboarding: ${persona.setupOwner.join(', ')}`);
  }
  for (const q of CRM_ASK) {
    if (!cap.askMe.includes(q)) cap.askMe.push(q);
  }
  if (!cap.skills.includes('denizen-data')) cap.skills.push('denizen-data');
  if (!cap.skills.includes('consult-grok')) cap.skills.push('consult-grok');
  if (!cap.skills.includes('consult-mentors')) cap.skills.push('consult-mentors');
}

const DISPLAY_NAMES = Object.keys(BY_NAME);

function isCapabilitiesQuestion(message) {
  const raw = String(message || '').trim();
  if (!raw) return false;
  const msg = raw.toLowerCase().replace(/[?!.]+$/g, '').trim();
  if (/^(help|capabilities|skills|abilities)$/i.test(msg)) return true;
  if (/\b(what can you do|what are you able to do|what do you do|what are your capabilities|what are your skills|what can you help|how can you help|what are you good at|tell me what you can|your capabilities|what services|what tools do you have|what are you capable of)\b/i.test(msg)) {
    return true;
  }
  if (/^(what can|how can)\s+(you|u)\b/i.test(msg)) return true;
  return false;
}

function getCapabilities(npcName) {
  const name = String(npcName || '').trim();
  if (!name) return null;
  const exact = BY_NAME[name];
  if (exact) return { ...exact, name };
  const hit = DISPLAY_NAMES.find((n) => n.toLowerCase() === name.toLowerCase());
  return hit ? { ...BY_NAME[hit], name: hit } : null;
}

function getCapabilityTeaser(npcName) {
  const cap = getCapabilities(npcName);
  return cap?.teaser || null;
}

function formatCapabilitiesPromptBlock(npcName, soulSection) {
  const cap = getCapabilities(npcName);
  if (!cap && !soulSection) return '';
  const lines = ['## Your Capabilities (tell the CEO accurately when they ask what you can do)'];
  if (cap) {
    lines.push(`Role: ${cap.role}`);
    cap.canDo.forEach((item) => lines.push(`- ${item}`));
    if (cap.askMe?.length) {
      lines.push(`Example CEO requests: ${cap.askMe.map((q) => `"${q}"`).join(', ')}`);
    }
    if (cap.skills?.length) {
      lines.push(`OpenClaw skills you can use: ${cap.skills.join(', ')}`);
    }
  }
  if (soulSection) {
    lines.push('From your SOUL (authoritative for tone and scope):');
    lines.push(soulSection.slice(0, 1200));
  }
  lines.push('When the CEO asks what you can do, answer in your own voice with concrete examples — not a generic assistant disclaimer.');
  return lines.join('\n');
}

function lcFirst(s) {
  const t = String(s || '').trim();
  if (!t) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

function isMarketQuestion(message) {
  const msg = String(message || '').toLowerCase();
  return /\b(stoks|stonks|stocks?|stock market|the market|markets|nvda|tsla|aapl|quotes?|portfolio|trading|watchlist|look(?:ing)?\s+like\s+today|moving\s+today|how.*\bmarket|what.*\bmarket|market\s+update|market\s+today)\b/i.test(msg);
}

function formatCapabilitiesReply(npcName, opts = {}) {
  const cap = getCapabilities(npcName);
  const soulSection = opts.soulSection;
  if (!cap && !soulSection) {
    return `I'm ${npcName}. Ask me for help and I'll tell you if it's in my lane.`;
  }

  if (npcName === 'Lucy' && cap) {
    return `${cap.intro} I also run office tours and keep the team connected. ${cap.canDo.slice(1, 4).join('. ')}. What do you need?`;
  }

  if (npcName === 'Bouncer' && cap) {
    return `${cap.intro} I patrol, file threat reports, run Kali on live incidents, and deploy honeypots on your say-so. Ask for my latest report or say "deploy honeypot."`;
  }

  if (npcName === 'Roki' && cap) {
    const items = cap.canDo.slice(0, 4).map(lcFirst);
    return `${cap.intro} I can ${items.join('; ')}. Try "${cap.askMe?.[0] || 'What\'s moving today?'}"`;
  }

  const parts = [];
  if (cap?.intro) parts.push(cap.intro);
  if (cap?.canDo?.length) {
    const top = cap.canDo.slice(0, 4).map(lcFirst);
    parts.push(`I can ${top.join('; ')}`);
  }
  if (cap?.askMe?.[0]) {
    parts.push(`Try "${cap.askMe[0]}"`);
  }
  return parts.join('. ').replace(/\.\./g, '.').replace(/\s+/g, ' ').trim();
}

const DenizenNpcCapabilities = {
  BY_NAME,
  DISPLAY_NAMES,
  isCapabilitiesQuestion,
  isMarketQuestion,
  getCapabilities,
  getCapabilityTeaser,
  formatCapabilitiesPromptBlock,
  formatCapabilitiesReply,
};

if (typeof globalThis !== 'undefined') {
  globalThis.DenizenNpcCapabilities = DenizenNpcCapabilities;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DenizenNpcCapabilities;
}
