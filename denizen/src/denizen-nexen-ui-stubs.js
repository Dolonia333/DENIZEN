'use strict';

/**
 * Stub JSON for the NEXEN Command Center UI shells hosted under /nexen/.
 * Mirrors nexen-review/demo_server.py — layout review only, not private runtime.
 */

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function stubPayload(pathname, query) {
  const path = String(pathname || '');
  const q = query || {};

  if (path === '/api/auth/session') {
    return {
      authenticated: true,
      configured: true,
      can_setup: false,
      demo: true,
      preview: true,
      denizen_hosted: true,
    };
  }
  if (path === '/api/auth/login' || path === '/api/auth/setup' || path === '/api/auth/logout') {
    return { ok: true, authenticated: path !== '/api/auth/logout', demo: true, preview: true };
  }
  if (path === '/api/hub') {
    return {
      skills: 0,
      points: 0,
      brief: 'Preview telemetry only. Use /api/nexen/hub for the working Denizen workspace.',
      status: {
        files_indexed: 0,
        queued_jobs: 0,
        running_jobs: 0,
        failed_jobs: 0,
        compiled_workflows: 0,
        awaiting_approval: 0,
      },
      requests: [],
      collections: [],
      demo: true,
      preview: true,
      denizen_hosted: true,
    };
  }
  if (path === '/api/hub/control') {
    return {
      memory: { messages: 0, message_count: 0 },
      memory_messages: 0,
      census: { files_count: 0 },
      autonomy: { paused: true },
      services: [
        { name: 'NEXEN working hub', status: 'online', detail: 'Use /nexen/ Today for real tasks' },
        { name: 'Workers / models', status: 'unavailable', detail: 'Private runtime not attached' },
      ],
      demo: true,
      preview: true,
    };
  }
  if (path === '/api/hub/digest') {
    return {
      coverage: 'Preview — no Discord archive attached.',
      messages: [],
      demo: true,
      preview: true,
    };
  }
  if (path === '/api/hub/request') {
    return {
      id: 2,
      status: 'planned',
      message: 'Preview only. Save requests from /nexen/ Today via /api/nexen/request.',
      demo: true,
      preview: true,
    };
  }
  if (path === '/api/hub/autonomy') {
    return { paused: true, detail: 'Preview: autonomy is not connected.', demo: true, preview: true };
  }
  if (path.startsWith('/api/hub/')) {
    return { demo: true, preview: true, status: 'stub', path };
  }
  if (path === '/api/pc/apps') {
    return { apps: [], demo: true, preview: true };
  }
  if (path === '/api/skills') {
    const needle = String((q.q && q.q[0]) || q.q || '').toLowerCase();
    let rows = [
      {
        id: 'demo-video',
        name: 'Demo video skill',
        collection: 'skills',
        description: 'Placeholder skill for UI review.',
      },
      {
        id: 'demo-design',
        name: 'Demo design skill',
        collection: 'skills',
        description: 'Placeholder skill for UI review.',
      },
    ];
    if (needle) {
      rows = rows.filter((r) => `${r.name} ${r.description}`.toLowerCase().includes(needle));
    }
    // Array shape kept for preview UI clients; mark via header-equivalent field on empty sentinel
    rows.preview = true;
    rows.demo = true;
    return rows;
  }
  if (path === '/api/memory') {
    return {
      results: [],
      status: 'not_indexed',
      coverage: 'No conversation exports attached.',
      demo: true,
      preview: true,
    };
  }
  if (path === '/api/music') {
    return {
      tracks: [],
      coverage: 'No local music library attached.',
      demo: true,
      preview: true,
    };
  }
  if (path === '/api/money/status') {
    const gates = [
      {
        id: 'supplier',
        title: 'Confirm fulfillment costs',
        detail: 'Demo gate — supplier evidence is not attached.',
        href: '/nexen/connections',
        action: 'Open needs-you',
        state: 'unverified',
        provider_verified: false,
      },
      {
        id: 'checkout',
        title: 'Finish payments and test checkout',
        detail: 'Demo gate — checkout is not connected here.',
        href: '/nexen/connections',
        action: 'Open needs-you',
        state: 'incomplete',
        provider_verified: false,
      },
    ];
    return {
      updated_at: nowIso(),
      demo: true,
      inputs: {
        values: {
          price_cents: 3499,
          supplier_cost_cents: null,
          shipping_cents: null,
          packaging_cents: null,
          payment_fees_cents: null,
          refund_reserve_cents: null,
        },
      },
      calculator: {
        complete: false,
        missing: [
          'supplier_cost_cents',
          'shipping_cents',
          'packaging_cents',
          'payment_fees_cents',
          'refund_reserve_cents',
        ],
        landed_cost_cents: null,
        variable_cost_cents: null,
        contribution_before_ads_cents: null,
        break_even_cac_cents: null,
        orders_to_cover_50: null,
        scenario_only: true,
        excludes: ['fixed overhead', 'taxes'],
        forecast: false,
        reason: 'Demo mode — enter costs on a full local NEXEN install.',
      },
      opportunities: [
        {
          id: 1,
          title: 'Demo store opportunity',
          category: 'store',
          status: 'research',
          evidence: 'Placeholder for UI review.',
          next_step: 'Explore the Money Engine layout.',
          created_at: nowIso(),
          updated_at: nowIso(),
        },
      ],
      task_progress: {
        available: false,
        total: null,
        completed: null,
        percent: null,
        scope: 'No task database in the hosted UI shell.',
      },
      gates,
      readiness: {
        can_execute_ads: false,
        checkout_verified: false,
        revenue_connected: false,
        blockers: gates.length,
      },
      budget: {
        daily_cap_cents: 5000,
        total_cap_cents: 5000,
        automatically_restarts: false,
        actual_spend_cents: null,
        provider_enforcement_verified: false,
        execution_enabled: false,
      },
      revenue: { actual_cents: null, status: 'not_connected' },
      sources: {
        formula:
          'https://legacy.sba.gov/business-guide/plan-your-business/calculate-your-startup-costs/break-even-point',
      },
      notice: 'PREVIEW — Money Engine layout only. Ads/checkout are not connected on Denizen.',
      preview: true,
    };
  }
  if (path === '/api/money/workspace') {
    return {
      demo: true,
      preview: true,
      tracks: [],
      tasks: [],
      offset: 0,
      limit: 500,
      total: 0,
      notice: 'Preview — money workspace has no local task DB on Denizen.',
    };
  }
  if (path.startsWith('/api/money/')) {
    return { demo: true, preview: true, status: 'stub', path };
  }
  return null;
}

const NEXEN_UI_API_PREFIXES = [
  '/api/auth/session',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/logout',
  '/api/hub',
  '/api/money/',
  '/api/pc/apps',
  '/api/skills',
  '/api/memory',
  '/api/music',
];

function matchesNexenUiApi(urlPath) {
  const p = String(urlPath || '');
  if (p === '/api/hub' || p.startsWith('/api/hub/')) return true;
  if (p === '/api/money' || p.startsWith('/api/money/')) return true;
  return NEXEN_UI_API_PREFIXES.includes(p);
}

/** Pretty path under /nexen/ → HTML file name */
const NEXEN_PAGE_MAP = {
  '': 'index.html',
  'index.html': 'index.html',
  hub: 'hub.html',
  'coming-soon': 'coming-soon.html',
  login: 'login.html',
  game: 'game.html',
  money: 'money.html',
  next: 'next.html',
  voice: 'voice.html',
  storage: 'storage.html',
  connections: 'connections.html',
  'check-in': 'check-in.html',
  photos: 'photos.html',
  problems: 'problems.html',
  'problem-cases': 'problem-cases.html',
  'memory-pools': 'memory-pools.html',
  'automatic-mode': 'automatic-mode.html',
  desktop: 'desktop.html',
  lookbook: 'lookbook.html',
  kilo: 'kilo.html',
  agents: 'agents-console.html',
  'agentic-os': 'agentic-os.html',
  'code-review': 'code-review.html',
  'youtube-memory': 'youtube-memory.html',
  continuity: 'continuity.html',
  readiness: 'v1-readiness.html',
  // Dead pretty paths → honest coming-soon (not silent home fallback)
  tasks: 'coming-soon.html',
  day: 'coming-soon.html',
  lab: 'coming-soon.html',
  plans: 'coming-soon.html',
  diagnostics: 'coming-soon.html',
  'music-render': 'coming-soon.html',
};

function resolveNexenPage(rel) {
  const clean = String(rel || '').replace(/^\/+|\/+$/g, '');
  if (!clean) return 'index.html';
  if (NEXEN_PAGE_MAP[clean]) return NEXEN_PAGE_MAP[clean];
  if (clean.endsWith('.html')) return clean;
  // Direct asset paths (world-assets/..., branding/...)
  if (clean.includes('/') || clean.startsWith('world-assets') || clean.startsWith('branding')) {
    return clean;
  }
  // Unknown pretty path → coming soon with notice, not silent home
  return 'coming-soon.html';
}

function tryHandleNexenUiApi(req, res, urlPath, searchParams) {
  if (!matchesNexenUiApi(urlPath)) return false;
  const query = {};
  if (searchParams && typeof searchParams.forEach === 'function') {
    searchParams.forEach((value, key) => {
      if (!query[key]) query[key] = [];
      query[key].push(value);
    });
  }
  const payload = stubPayload(urlPath, query);
  if (payload == null) return false;
  const body = JSON.stringify(payload);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-NEXEN-Demo': '1',
  });
  res.end(body);
  return true;
}

module.exports = {
  tryHandleNexenUiApi,
  matchesNexenUiApi,
  resolveNexenPage,
  NEXEN_PAGE_MAP,
  stubPayload,
};
