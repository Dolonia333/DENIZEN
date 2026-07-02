const SESSION_KEY = "denizen-visitor-session";
const CEO_GRANT_KEY = "denizen-ceo-grant";
const DEFAULT_ORG_SLUG = "zion";

export type CrmWorkspaceState = {
  contacts?: unknown[];
  deals?: unknown[];
  notes?: unknown[];
  tasks?: unknown[];
  companies?: unknown[];
  goals?: unknown[];
  sequences?: unknown[];
  sequenceEnrollments?: unknown[];
  submissions?: unknown[];
  quotes?: unknown[];
  packages?: unknown[];
  meetings?: unknown[];
  automations?: unknown[];
  emailTemplates?: unknown[];
  emailLog?: unknown[];
  auditLog?: unknown[];
  noteBoards?: unknown[];
  industryConfig?: Record<string, unknown>;
  contactGroups?: unknown[];
  contactGroupMap?: Record<string, number[]>;
  crmQuotas?: unknown[];
  userPrefs?: Record<string, unknown>;
  onboarding?: Record<string, unknown>;
  availability?: unknown[];
  integrations?: Record<string, unknown>;
  metricSnapshots?: unknown[];
  automationRuns?: unknown[];
  dealComments?: unknown[];
  aiThreads?: unknown[];
  leadModelState?: Record<string, unknown>;
  supportTickets?: unknown[];
  marketingCampaigns?: unknown[];
  teamPolicy?: Record<string, unknown>;
  usageLog?: unknown[];
};

export type CrmTeamMember = { display_name: string; email: string; role: string; is_self?: boolean };
export type CrmSessionInfo = {
  display_name: string | null;
  username?: string | null;
  org_slug?: string | null;
  email: string | null;
  tier: string | null;
  ceo?: boolean;
  team_role?: string | null;
  can_approve_skills?: boolean;
  is_owner?: boolean;
  work_position?: { title?: string | null } | null;
};

const LEGACY_CEO_NAME = /^dolonia$/i;
const GUEST_LABEL = /^guest$/i;
const DEMO_PLACEHOLDER_NAME = /^(dolonia|guest)$/i;
const CEO_DISPLAY_NAME = "Dolonia";

export type PublicQuote = {
  id: number;
  clientName: string;
  company: string;
  recommendedPackage: string;
  lineItems: { id: number; name: string; price: number; unit: string }[];
  monthlyTotal: number;
  onetimeTotal: number;
  validUntil: string;
  status: string;
  portalToken: string;
  portalPaidAt?: string | null;
  signatures?: Array<{
    id: string;
    method: string;
    value: string;
    signerName: string;
    signerEmail?: string;
    signerRole?: string;
    signedAt: string;
    lockedAt: string;
  }>;
  branding?: { companyName: string; tagline: string; accentColor: string; logoEmoji: string };
};

const USER_EDITED_KEY = "meridian_user_edited";
const DEMO_LOADED_KEY = "meridian_demo_loaded";

export function markCrmUserEdited() {
  try { localStorage.setItem(USER_EDITED_KEY, "1"); } catch { /* ignore */ }
}

export function markCrmDemoLoaded() {
  try {
    localStorage.setItem(DEMO_LOADED_KEY, "1");
    localStorage.setItem(USER_EDITED_KEY, "1");
  } catch { /* ignore */ }
}

export function canPushLocalToCloud(): boolean {
  try {
    return localStorage.getItem(USER_EDITED_KEY) === "1" || localStorage.getItem(DEMO_LOADED_KEY) === "1";
  } catch {
    return false;
  }
}

type SessionStore = {
  session_id?: string;
  sessionId?: string;
  session_token?: string;
  sessionToken?: string;
  org_slug?: string;
  orgSlug?: string;
  display_name?: string;
  displayName?: string;
  tier?: string;
  access_method?: string;
  accessMethod?: string;
};

let lastUpdatedAt: string | null = null;
let bootstrapPromise: Promise<SessionStore | null> | null = null;
let urlParamsAbsorbed = false;

export function getCrmWorkspaceVersion(): string | null {
  return lastUpdatedAt;
}

function readRawStore(): SessionStore {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
  } catch {
    return {};
  }
}

function readCeoGrant(): string | null {
  try {
    return localStorage.getItem(CEO_GRANT_KEY);
  } catch {
    return null;
  }
}

export function normalizeDenizenSession(raw: SessionStore = readRawStore()): SessionStore | null {
  const sessionId = String(raw.session_id || raw.sessionId || "").trim() || null;
  if (!sessionId) return null;
  const sessionToken = String(raw.session_token || raw.sessionToken || "").trim() || null;
  return {
    session_id: sessionId,
    session_token: sessionToken,
    org_slug: raw.org_slug || raw.orgSlug || null,
    display_name: raw.display_name || raw.displayName || null,
    tier: raw.tier || null,
    access_method: raw.access_method || raw.accessMethod || null,
  };
}

function persistSession(patch: SessionStore) {
  const prev = readRawStore();
  const next = { ...prev, ...patch };
  if (patch.session_id) {
    next.session_id = patch.session_id;
    next.sessionId = patch.session_id;
  }
  if (patch.session_token) {
    next.session_token = patch.session_token;
    next.sessionToken = patch.session_token;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(next));
}

function sessionAccessMethod(session: SessionStore | null): string {
  const raw = session || normalizeDenizenSession() || readRawStore();
  return String(raw.access_method || raw.accessMethod || "").toLowerCase();
}

function isDemoSession(session: SessionStore | null): boolean {
  const raw = session || normalizeDenizenSession() || readRawStore();
  const tier = String(raw.tier || "").toLowerCase();
  const method = sessionAccessMethod(session);
  const orgSlug = String(raw.org_slug || raw.orgSlug || "").toLowerCase();
  return tier === "demo" || method === "demo" || method === "demo_login" || orgSlug === "acme";
}

function isCeoSession(session: SessionStore | null): boolean {
  if (isDemoSession(session)) return false;
  if (!session) return false;
  if (session.access_method === "ceo" || session.tier === "ceo") return true;
  const method = sessionAccessMethod(session);
  if (method && method !== "ceo") return false;
  return !!readCeoGrant();
}

export function isCeoPrincipalSession(): boolean {
  absorbUrlSessionParams();
  return isCeoSession(normalizeDenizenSession());
}

function absorbUrlSessionParams() {
  if (urlParamsAbsorbed || typeof window === "undefined") return;
  urlParamsAbsorbed = true;
  try {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("dz_sid") || params.get("dz_session") || params.get("session_id");
    const tok = params.get("dz_stok") || params.get("dz_token") || params.get("session_token");
    if (!sid && !tok) return;
    const prev = readRawStore();
    persistSession({
      session_id: sid || prev.session_id || prev.sessionId,
      session_token: tok || prev.session_token || prev.sessionToken,
      access_method: prev.access_method || prev.accessMethod || undefined,
      tier: prev.tier || undefined,
      display_name: prev.display_name || prev.displayName || undefined,
    });
    params.delete("dz_sid");
    params.delete("dz_session");
    params.delete("dz_stok");
    params.delete("dz_token");
    params.delete("session_id");
    params.delete("session_token");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  } catch {
    /* ignore */
  }
}

export function hasDenizenSession(): boolean {
  absorbUrlSessionParams();
  const session = normalizeDenizenSession();
  if (session?.session_id) return true;
  return !!readCeoGrant();
}

const FETCH_TIMEOUT_MS = 8_000;

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    credentials: "include",
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

function rawDemoUsername(): string | null {
  const raw = readRawStore();
  return String(raw.demo_username || raw.demoUsername || "").trim() || null;
}

export function resolveProfileDisplayName(
  name: string | null | undefined,
  opts: { tier?: string | null; username?: string | null; ceo?: boolean; org_slug?: string | null; email?: string | null } = {},
): string | null {
  const tier = String(opts.tier || "").toLowerCase();
  const orgSlug = String(opts.org_slug || "").toLowerCase();
  const username = String(opts.username || rawDemoUsername() || "").trim() || null;
  const emailLocal = String(opts.email || "").split("@")[0]?.trim() || null;
  const n = String(name || "").trim();
  const demo = tier === "demo" || orgSlug === "acme";
  const ceo = !!opts.ceo || (tier === "ceo" && !demo);

  if (ceo) {
    if (n && !GUEST_LABEL.test(n)) return n;
    return CEO_DISPLAY_NAME;
  }
  if (demo) {
    if (n && !DEMO_PLACEHOLDER_NAME.test(n)) return n;
    return username || emailLocal || null;
  }
  if (GUEST_LABEL.test(n) || LEGACY_CEO_NAME.test(n)) {
    return username || emailLocal || null;
  }
  return n || null;
}

async function pullVisitorProfileHints(session: SessionStore | null): Promise<{ display_name?: string | null; username?: string | null; email?: string | null }> {
  if (!session?.session_id) return {};
  try {
    const res = await fetchWithTimeout(
      `/api/visitor/settings?session_id=${encodeURIComponent(session.session_id)}`,
      { headers: authHeaders(session) },
    );
    const data = await res.json().catch(() => ({}));
    const settings = data.settings || {};
    return {
      display_name: settings.display_name || null,
      username: settings.demo_username || null,
      email: settings.email || null,
    };
  } catch {
    return {};
  }
}

function authHeaders(session: SessionStore | null): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.session_id) headers["X-Session-Id"] = session.session_id;
  if (session?.session_token) headers["X-Session-Token"] = session.session_token;
  if (isDemoSession(session)) {
    headers["X-Demo"] = "1";
    headers["X-Access-Method"] = sessionAccessMethod(session) || "demo";
  } else if (isCeoSession(session)) {
    headers["X-Access-Method"] = "ceo";
    const grant = readCeoGrant();
    if (grant) headers["X-Denizen-Ceo-Grant"] = grant;
  } else if (session?.access_method) {
    headers["X-Access-Method"] = session.access_method;
  }
  if (session?.org_slug) headers["X-Org-Slug"] = session.org_slug;
  const displayHeader = resolveProfileDisplayName(session?.display_name, {
    tier: session?.tier,
    org_slug: session?.org_slug,
    username: rawDemoUsername(),
    ceo: isCeoSession(session),
  });
  if (displayHeader) headers["X-Display-Name"] = displayHeader;
  return headers;
}

function ceoBootstrapHeaders(session: SessionStore | null): Record<string, string> {
  const raw = readRawStore();
  const headers: Record<string, string> = {
    "X-Access-Method": "ceo",
    "X-Display-Name": session?.display_name || raw.display_name || raw.displayName || "Dolonia",
    "X-Org-Slug": session?.org_slug || raw.org_slug || raw.orgSlug || DEFAULT_ORG_SLUG,
  };
  const grant = readCeoGrant();
  if (grant) headers["X-Denizen-Ceo-Grant"] = grant;
  if (session?.session_id) headers["X-Session-Id"] = session.session_id;
  if (session?.session_token) headers["X-Session-Token"] = session.session_token;
  return headers;
}

function visitorBootstrapHeaders(session: SessionStore | null): Record<string, string> {
  const raw = readRawStore();
  const demo = isDemoSession(session);
  const headers: Record<string, string> = {
    "X-Display-Name": resolveProfileDisplayName(session?.display_name || raw.display_name || raw.displayName, {
      tier: session?.tier,
      org_slug: session?.org_slug || raw.org_slug || raw.orgSlug,
      username: rawDemoUsername(),
      ceo: isCeoSession(session),
    })
      || rawDemoUsername()
      || "Demo user",
    "X-Org-Slug": session?.org_slug || raw.org_slug || raw.orgSlug || (demo ? "acme" : DEFAULT_ORG_SLUG),
  };
  if (demo) {
    headers["X-Demo"] = "1";
    headers["X-Access-Method"] = sessionAccessMethod(session) || "demo";
  } else if (session?.access_method) {
    headers["X-Access-Method"] = session.access_method;
  }
  if (session?.session_id) headers["X-Session-Id"] = session.session_id;
  if (session?.session_token) headers["X-Session-Token"] = session.session_token;
  return headers;
}

async function openDenizenSession(session: SessionStore | null): Promise<SessionStore | null> {
  const demo = isDemoSession(session);
  const res = await fetchWithTimeout("/api/visitor/session/open", {
    method: "GET",
    headers: isCeoSession(session) ? ceoBootstrapHeaders(session) : visitorBootstrapHeaders(session),
  });
  if (!res.ok) return session?.session_id ? session : null;
  const data = await res.json().catch(() => ({}));
  const sessionId = data.session?.id || session?.session_id || null;
  const token = data.session_token || session?.session_token || null;
  if (!sessionId) return null;
  const serverTier = String(data.tier || data.session?.metadata?.tier || "").toLowerCase();
  const resolvedDemo = demo || serverTier === "demo";
  const resolvedCeo = !resolvedDemo && (!!data.ceo_grant || isCeoSession(session));
  const next: SessionStore = {
    session_id: sessionId,
    session_token: token,
    org_slug: data.org?.slug || session?.org_slug || (resolvedDemo ? "acme" : DEFAULT_ORG_SLUG),
    display_name: resolveProfileDisplayName(
      session?.display_name || data.session?.display_name || data.identity?.display_name || rawDisplayName(),
      {
        tier: resolvedDemo ? "demo" : resolvedCeo ? "ceo" : session?.tier,
        org_slug: data.org?.slug || session?.org_slug,
        username: rawDemoUsername(),
        ceo: resolvedCeo,
      },
    )
      || (resolvedCeo ? CEO_DISPLAY_NAME : null)
      || rawDemoUsername()
      || null,
    tier: resolvedDemo ? "demo" : resolvedCeo ? "ceo" : session?.tier || null,
    access_method: resolvedDemo
      ? (sessionAccessMethod(session) || "demo")
      : resolvedCeo ? "ceo" : session?.access_method || null,
  };
  persistSession(next);
  if (resolvedDemo) {
    try { localStorage.removeItem(CEO_GRANT_KEY); } catch { /* ignore */ }
  } else if (data.ceo_grant) {
    try { localStorage.setItem(CEO_GRANT_KEY, data.ceo_grant); } catch { /* ignore */ }
  }
  return next;
}

function rawDisplayName(): string | null {
  const raw = readRawStore();
  return raw.display_name || raw.displayName || null;
}

async function loadSessionFromServerCookie(): Promise<SessionStore | null> {
  const res = await fetchWithTimeout("/api/crm/session");
  const data = await res.json().catch(() => ({}));
  if (!data.ok || !data.session_id) return null;
  const prev = normalizeDenizenSession() || {};
  const demo = data.tier === "demo" || String(data.org_slug || "").toLowerCase() === "acme";
  const prevName = demo && LEGACY_CEO_NAME.test(String(prev.display_name || prev.displayName || ""))
    ? null
    : (prev.display_name || prev.displayName || null);
  const displayName = resolveProfileDisplayName(data.display_name || prevName, {
    tier: demo ? "demo" : data.tier,
    org_slug: data.org_slug || prev.org_slug || null,
    username: data.username,
    ceo: !demo && !!data.ceo,
  })
    || (!demo && data.ceo ? CEO_DISPLAY_NAME : null)
    || data.display_name
    || prevName
    || null;
  const next: SessionStore = {
    ...prev,
    session_id: data.session_id,
    session_token: prev.session_token || prev.sessionToken || data.session_token || null,
    org_slug: data.org_slug || prev.org_slug || null,
    tier: demo ? "demo" : data.ceo ? "ceo" : (data.tier || prev.tier || null),
    access_method: demo ? "demo" : data.ceo ? "ceo" : (prev.access_method || null),
    display_name: displayName,
  };
  if (demo) {
    try { localStorage.removeItem(CEO_GRANT_KEY); } catch { /* ignore */ }
  }
  persistSession(next);
  if (!next.session_token) {
    const refreshed = await openDenizenSession(next);
    if (refreshed?.session_token) return refreshed;
  }
  return next;
}

function scrubLegacyCeoSessionStore() {
  const raw = readRawStore();
  const session = normalizeDenizenSession(raw);
  if (isCeoSession(session) && !isDemoSession(session)) {
    if (GUEST_LABEL.test(String(raw.display_name || raw.displayName || "")) || !raw.display_name) {
      persistSession({
        display_name: CEO_DISPLAY_NAME,
        tier: "ceo",
        access_method: "ceo",
        org_slug: raw.org_slug || raw.orgSlug || DEFAULT_ORG_SLUG,
      });
    }
    return;
  }
  if (!isDemoSession(session)) return;
  try { localStorage.removeItem(CEO_GRANT_KEY); } catch { /* ignore */ }
  const legacyName = LEGACY_CEO_NAME.test(String(raw.display_name || raw.displayName || ""));
  const guestName = GUEST_LABEL.test(String(raw.display_name || raw.displayName || ""));
  if (!legacyName && !guestName && raw.tier === "demo") return;
  persistSession({
    tier: "demo",
    access_method: sessionAccessMethod(session) || "demo",
    org_slug: raw.org_slug || raw.orgSlug || "acme",
    display_name: resolveProfileDisplayName(raw.display_name || raw.displayName, {
      tier: "demo",
      org_slug: raw.org_slug || raw.orgSlug || "acme",
      username: rawDemoUsername(),
    }) || rawDemoUsername() || null,
  });
}

async function syncSessionProfileFromServer(session: SessionStore | null): Promise<SessionStore | null> {
  if (!session?.session_id) return session;
  try {
    const qs = `?session_id=${encodeURIComponent(session.session_id)}`;
    const res = await fetchWithTimeout(`/api/crm/session${qs}`, { headers: authHeaders(session) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return session;
    const demo = data.tier === "demo" || isDemoSession(session);
    if (demo) {
      try { localStorage.removeItem(CEO_GRANT_KEY); } catch { /* ignore */ }
    }
    const displayName = resolveProfileDisplayName(data.display_name || session.display_name, {
      tier: demo ? "demo" : data.tier,
      org_slug: data.org_slug || session.org_slug,
      username: data.username,
      ceo: !!data.ceo,
    });
    const next: SessionStore = {
      ...session,
      tier: demo ? "demo" : (data.ceo ? "ceo" : (data.tier || session.tier || null)),
      access_method: demo ? (sessionAccessMethod(session) || "demo") : (data.ceo ? "ceo" : session.access_method),
      org_slug: data.org_slug || session.org_slug || null,
      display_name: displayName
        || (data.ceo ? CEO_DISPLAY_NAME : null)
        || (demo ? (data.username || rawDemoUsername() || null) : session.display_name || null),
    };
    if (demo && LEGACY_CEO_NAME.test(String(next.display_name || ""))) {
      next.display_name = data.username || rawDemoUsername() || null;
    }
    persistSession(next);
    return next;
  } catch {
    return session;
  }
}

export async function ensureDenizenSession(): Promise<SessionStore | null> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    absorbUrlSessionParams();
    scrubLegacyCeoSessionStore();

    let session = normalizeDenizenSession();
    if (session?.session_id && session.session_token) {
      return syncSessionProfileFromServer(session);
    }

    if (!session?.session_id) {
      session = await loadSessionFromServerCookie();
    }

    if (!session?.session_id && readCeoGrant() && !isDemoSession(session)) {
      session = await openDenizenSession(session);
    } else if (session?.session_id && !session.session_token) {
      const refreshed = await openDenizenSession(session);
      session = refreshed || session;
    }

    if (session?.session_id) {
      session = await syncSessionProfileFromServer(session) || session;
    }

    return session;
  })().finally(() => {
    bootstrapPromise = null;
  });
  return bootstrapPromise;
}

export type CrmFetchResult =
  | { ok: true; state: CrmWorkspaceState; orgSlug: string | null; orgDisplayName: string | null; empty: boolean; updatedAt: string | null; updatedByName?: string | null }
  | { ok: false; reason: "no_session" | "no_org" | "error"; error?: string };

export type CrmAssistAction = {
  type: string;
  label: string;
  tab?: string;
  payload?: Record<string, unknown>;
};

export async function fetchCrmWorkspace(): Promise<CrmFetchResult> {
  const session = await ensureDenizenSession();
  if (!session?.session_id && !readCeoGrant()) {
    return { ok: false, reason: "no_session" };
  }
  const qs = session?.session_id
    ? `?session_id=${encodeURIComponent(session.session_id)}`
    : "";
  try {
    const res = await fetchWithTimeout(`/api/crm/workspace${qs}`, { headers: authHeaders(session) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && String(data.error || "").toLowerCase().includes("organization")) {
      return { ok: false, reason: "no_org", error: data.error || "Session is not linked to an organization" };
    }
    if (!res.ok || !data.ok) {
      if (res.status === 401 || data.code === "DENIED") {
        return { ok: false, reason: "no_session", error: data.error || `HTTP ${res.status}` };
      }
      return { ok: false, reason: "error", error: data.error || `HTTP ${res.status}` };
    }
    lastUpdatedAt = data.updated_at || null;
    return {
      ok: true,
      state: (data.state || {}) as CrmWorkspaceState,
      orgSlug: data.org_slug || session?.org_slug || null,
      orgDisplayName: data.org_display_name || null,
      empty: !!data.empty,
      updatedAt: data.updated_at || null,
      updatedByName: data.updated_by_name || null,
    };
  } catch (err) {
    return { ok: false, reason: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export type CrmSaveResult =
  | { ok: true; orgSlug: string | null; orgDisplayName: string | null; updatedAt: string | null; updatedByName?: string | null }
  | { ok: false; reason: "no_session" | "no_org" | "conflict" | "error"; error?: string; state?: CrmWorkspaceState; updatedAt?: string | null };

export async function saveCrmWorkspace(state: CrmWorkspaceState): Promise<CrmSaveResult> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) {
    return { ok: false, reason: "no_session" };
  }
  try {
    const res = await fetchWithTimeout("/api/crm/workspace", {
      method: "PUT",
      headers: authHeaders(session),
      body: JSON.stringify({
        session_id: session.session_id,
        state,
        if_updated_at: lastUpdatedAt,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.code === "CONFLICT") {
      lastUpdatedAt = data.updated_at || null;
      return {
        ok: false,
        reason: "conflict",
        error: data.error,
        state: (data.state || {}) as CrmWorkspaceState,
        updatedAt: data.updated_at || null,
      };
    }
    if (res.status === 409 && String(data.error || "").toLowerCase().includes("organization")) {
      return { ok: false, reason: "no_org", error: data.error };
    }
    if (!res.ok || !data.ok) {
      return { ok: false, reason: "error", error: data.error || `HTTP ${res.status}` };
    }
    lastUpdatedAt = data.updated_at || null;
    return {
      ok: true,
      orgSlug: data.org_slug || session.org_slug || null,
      orgDisplayName: data.org_display_name || null,
      updatedAt: data.updated_at || null,
      updatedByName: data.updated_by_name || null,
    };
  } catch (err) {
    return { ok: false, reason: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function intakeHandoff(submission: Record<string, unknown>): Promise<boolean> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return false;
  try {
    const res = await fetchWithTimeout("/api/crm/intake-handoff", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ session_id: session.session_id, submission }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && !!data.ok;
  } catch {
    return false;
  }
}

export function subscribeCrmWorkspaceStream(
  onUpdate: (payload: { updated_at: string; updated_by_name?: string | null }) => void,
): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const session = normalizeDenizenSession();
  const qs = session?.session_id ? `?session_id=${encodeURIComponent(session.session_id)}` : "";
  const es = new EventSource(`/api/crm/workspace/stream${qs}`);
  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data?.updated_at) onUpdate(data);
    } catch { /* ignore */ }
  };
  return () => es.close();
}

export async function assistCrm(
  message: string,
  state?: CrmWorkspaceState,
  opts?: { npcKey?: string | null; npcName?: string | null },
): Promise<{ ok: boolean; reply?: string; source?: string; error?: string; actions?: CrmAssistAction[]; persona?: string | null }> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return { ok: false, error: "no session" };
  try {
    const res = await fetchWithTimeout("/api/crm/assist", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        session_id: session.session_id,
        message,
        state,
        npc_key: opts?.npcKey || undefined,
        npc_name: opts?.npcName || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, reply: data.reply, source: data.source, actions: data.actions, persona: data.persona };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type VisitorAssistant = { npc_key?: string; display_name?: string; role?: string } | null;

export async function fetchVisitorAssistant(): Promise<VisitorAssistant> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return null;
  try {
    const qs = `?session_id=${encodeURIComponent(session.session_id)}`;
    const res = await fetchWithTimeout(`/api/visitor/assistant${qs}`, { headers: authHeaders(session) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return null;
    return data.assistant || null;
  } catch {
    return null;
  }
}

export type CrmSendEmailResult = {
  ok: boolean;
  mode?: "resend" | "mailto";
  mailto?: string | null;
  logEntry?: Record<string, unknown>;
  subject?: string;
  error?: string;
};

export async function sendCrmEmail(payload: {
  contactId?: number;
  dealId?: number;
  toEmail?: string;
  subject?: string;
  body?: string;
  templateId?: number;
  templateName?: string;
  forceMailto?: boolean;
  attachments?: { filename: string; content: string }[];
}): Promise<CrmSendEmailResult> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return { ok: false, error: "no session" };
  try {
    const res = await fetchWithTimeout("/api/crm/send-email", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        session_id: session.session_id,
        contact_id: payload.contactId,
        deal_id: payload.dealId,
        to_email: payload.toEmail,
        subject: payload.subject,
        body: payload.body,
        template_id: payload.templateId,
        template_name: payload.templateName,
        force_mailto: payload.forceMailto,
        attachments: payload.attachments,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    if (data.mode === "mailto" && data.mailto && !payload.forceMailto) {
      window.location.href = data.mailto;
    }
    if (payload.forceMailto && data.mailto) {
      window.location.href = data.mailto;
    }
    return {
      ok: true,
      mode: data.mode,
      mailto: data.mailto,
      logEntry: data.logEntry,
      subject: data.subject,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function enrollCrmSequence(sequenceId: number, contactId: number): Promise<{ ok: boolean; error?: string }> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return { ok: false, error: "no session" };
  try {
    const res = await fetchWithTimeout("/api/crm/sequence/enroll", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        session_id: session.session_id,
        sequence_id: sequenceId,
        contact_id: contactId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function postCrmEvent(kind: string, payload: Record<string, unknown> = {}): Promise<boolean> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return false;
  try {
    const res = await fetchWithTimeout("/api/crm/event", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ session_id: session.session_id, kind, payload }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && !!data.ok;
  } catch {
    return false;
  }
}

export async function fetchPublicQuote(token: string): Promise<{ ok: boolean; quote?: PublicQuote; expired?: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`/api/crm/quote/${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, quote: data.quote, expired: !!data.expired };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function postPortalEvent(token: string, event: string, detail?: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`/api/crm/quote/${encodeURIComponent(token)}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, detail }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && !!data.ok;
  } catch {
    return false;
  }
}

export async function signPublicQuote(token: string, signature: Record<string, unknown>): Promise<{ ok: boolean; error?: string; quote?: PublicQuote }> {
  try {
    const res = await fetchWithTimeout(`/api/crm/quote/${encodeURIComponent(token)}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signature),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, quote: data.quote };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function submitPublicIntake(payload: {
  org_slug: string;
  clientName: string;
  clientEmail: string;
  company?: string;
  answers?: Record<string, unknown>;
}): Promise<{ ok: boolean; submissionId?: number; error?: string }> {
  try {
    const res = await fetchWithTimeout("/api/crm/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, submissionId: data.submissionId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchStripeStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetchWithTimeout("/api/crm/stripe/status");
    const data = await res.json().catch(() => ({}));
    return { configured: !!data.configured };
  } catch {
    return { configured: false };
  }
}

export async function createPortalCheckout(token: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout(`/api/crm/quote/${encodeURIComponent(token)}/checkout`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, url: data.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type CalendarConnectionStatus = {
  google: { connected: boolean; email?: string | null; lastSync?: string | null };
  microsoft: { connected: boolean; email?: string | null; lastSync?: string | null };
  googleConfigured: boolean;
  microsoftConfigured: boolean;
};

export async function fetchCalendarStatus(): Promise<CalendarConnectionStatus | null> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return null;
  try {
    const res = await fetchWithTimeout("/api/crm/calendar/status", { headers: authHeaders(session) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return null;
    return data as CalendarConnectionStatus;
  } catch {
    return null;
  }
}

export function calendarConnectUrl(provider: "google" | "microsoft"): string {
  return `/api/crm/calendar/${provider}/connect`;
}

export async function syncExternalCalendar(provider: "google" | "microsoft"): Promise<{ ok: boolean; imported?: number; error?: string }> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return { ok: false, error: "no_session" };
  try {
    const res = await fetchWithTimeout("/api/crm/calendar/sync", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ session_id: session.session_id, provider }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, imported: data.imported };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function publicIntakePageUrl(orgSlug: string): string {
  const base = typeof window !== "undefined" ? `${window.location.origin}/crm/intake.html` : "/crm/intake.html";
  return `${base}?org=${encodeURIComponent(orgSlug)}`;
}

export async function inviteCrmTeamMember(payload: {
  email: string;
  displayName?: string;
  platform?: string;
}): Promise<{ ok: boolean; emailed?: boolean; joinUrl?: string; error?: string; message?: string }> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return { ok: false, error: 'no_session' };
  try {
    const res = await fetchWithTimeout('/api/crm/team/invite', {
      method: 'POST',
      headers: authHeaders(session),
      body: JSON.stringify({ session_id: session.session_id, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}`, message: data.message };
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchCrmSession(): Promise<CrmSessionInfo | null> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return null;
  try {
    const qs = `?session_id=${encodeURIComponent(session.session_id)}`;
    const res = await fetchWithTimeout(`/api/crm/session${qs}`, { headers: authHeaders(session) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (isDemoSession(session)) {
        return {
          display_name: resolveProfileDisplayName(session.display_name, {
            tier: "demo",
            org_slug: session.org_slug,
            username: rawDemoUsername(),
          }) || rawDemoUsername() || "Demo user",
          email: null,
          tier: "demo",
          ceo: false,
        };
      }
      if (isCeoSession(session)) {
        return {
          display_name: resolveProfileDisplayName(session.display_name, { tier: "ceo", ceo: true })
            || CEO_DISPLAY_NAME,
          email: null,
          tier: "ceo",
          ceo: true,
        };
      }
      return null;
    }
    const demo = data.tier === "demo" || String(data.org_slug || "").toLowerCase() === "acme" || isDemoSession(session);
    const ceo = !demo && (!!data.ceo || data.tier === "ceo");
    const hints = demo ? await pullVisitorProfileHints(session) : {};
    const username = data.username || hints.username || rawDemoUsername() || null;
    const resolvedName = resolveProfileDisplayName(data.display_name || session.display_name, {
      tier: demo ? "demo" : data.tier,
      org_slug: data.org_slug || session.org_slug,
      username,
      email: data.email || hints.email,
      ceo,
    })
      || (ceo ? CEO_DISPLAY_NAME : null)
      || username
      || (hints.email ? String(hints.email).split("@")[0] : null)
      || (demo ? "Demo user" : null);
    if (demo) {
      try { localStorage.removeItem(CEO_GRANT_KEY); } catch { /* ignore */ }
      persistSession({
        session_id: session.session_id,
        session_token: session.session_token || undefined,
        tier: "demo",
        access_method: sessionAccessMethod(session) || "demo",
        org_slug: data.org_slug || session.org_slug || "acme",
        display_name: resolvedName,
        demo_username: username || undefined,
      });
    } else if (ceo) {
      persistSession({
        session_id: session.session_id,
        session_token: session.session_token || undefined,
        tier: "ceo",
        access_method: "ceo",
        org_slug: data.org_slug || session.org_slug || DEFAULT_ORG_SLUG,
        display_name: resolvedName,
      });
    }
    return {
      display_name: resolvedName,
      username: username || null,
      org_slug: data.org_slug || session.org_slug || null,
      email: data.email || hints.email || null,
      tier: demo ? "demo" : ceo ? "ceo" : (data.tier || null),
      ceo,
      team_role: data.team_role || null,
      can_approve_skills: !!data.can_approve_skills,
      is_owner: demo ? false : !!data.is_owner,
      work_position: data.work_position || null,
    };
  } catch {
    if (isDemoSession(session)) {
      return {
        display_name: resolveProfileDisplayName(session.display_name, {
          tier: "demo",
          org_slug: session.org_slug,
          username: rawDemoUsername(),
        }) || rawDemoUsername() || "Demo user",
        email: null,
        tier: "demo",
        ceo: false,
      };
    }
    if (isCeoSession(session)) {
      return {
        display_name: resolveProfileDisplayName(session.display_name, { tier: "ceo", ceo: true })
          || CEO_DISPLAY_NAME,
        email: null,
        tier: "ceo",
        ceo: true,
      };
    }
    return null;
  }
}

export async function fetchCrmTeam(): Promise<{ members: CrmTeamMember[]; self: { display_name: string | null; email: string | null } }> {
  const session = await ensureDenizenSession();
  if (!session?.session_id) return { members: [], self: { display_name: null, email: null } };
  try {
    const res = await fetchWithTimeout("/api/crm/team", { headers: authHeaders(session) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { members: [], self: { display_name: null, email: null } };
    return {
      members: data.members || [],
      self: data.self || { display_name: null, email: null },
    };
  } catch {
    return { members: [], self: { display_name: null, email: null } };
  }
}

export function formatSyncTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}
