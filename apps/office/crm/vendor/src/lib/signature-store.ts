// E-signature persistence layer shared between CRM and the public client portal.
// Keyed by the quote's portalToken so a signature captured in either context shows up in the other.
//
// Supports multiple signers per quote (each with their own signature + audit events).
// Signed records are LOCKED — they cannot be overwritten after being saved.

export type SignatureMethod = "typed" | "drawn";

export type SignatureEventType =
  | "viewed"
  | "signed"
  | "downloaded"
  | "link_copied"
  | "portal_opened"
  | "portal_blocked"
  | "receipt_emailed"
  | "lock_attempt_blocked";

export interface SignatureAuditEvent {
  event: SignatureEventType;
  at: string;
  detail?: string;
  userAgent?: string;
  /** Which signer this event belongs to (optional for portal-wide events). */
  signerId?: string;
  signerName?: string;
}

export interface SignatureRecord {
  /** Stable per-signer id. */
  id: string;
  method: SignatureMethod;
  /** typed: the printed name; drawn: PNG data URL of the canvas */
  value: string;
  signerName: string;
  signerEmail?: string;
  signerRole?: string;
  signedAt: string;
  /** When this record was committed and frozen. */
  lockedAt: string;
  userAgent: string;
  consent: string;
  auditLog: SignatureAuditEvent[];
}

const KEY = "meridian_signatures_v2";
const LEGACY_KEY = "meridian_signatures_v1";
const RATE_KEY = "meridian_portal_rate_v1";
const EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

type Store = Record<string, SignatureRecord[]>;
type RateStore = Record<string, number[]>;

function uid() {
  return `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
    // migrate v1 (single record per token) → v2 (array)
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy) as Record<string, Omit<SignatureRecord, "id" | "lockedAt"> & { id?: string; lockedAt?: string }>;
      const migrated: Store = {};
      for (const [token, rec] of Object.entries(old)) {
        migrated[token] = [{
          ...rec,
          id: rec.id ?? uid(),
          lockedAt: rec.lockedAt ?? rec.signedAt,
        } as SignatureRecord];
      }
      window.localStorage.setItem(KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch { /* noop */ }
  return {};
}

function write(store: Store) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch (e) { console.warn("signature store write failed", e); }
}

export function getSignatures(token: string): SignatureRecord[] {
  if (!token) return [];
  return read()[token] ?? [];
}

/** Back-compat: first (primary) signer. */
export function getSignature(token: string): SignatureRecord | null {
  return getSignatures(token)[0] ?? null;
}

/** Append a signature. Locked records are immutable. */
export function addSignature(
  token: string,
  partial: Omit<SignatureRecord, "lockedAt" | "id" | "auditLog"> & { id?: string; auditLog?: SignatureAuditEvent[] },
): { ok: true; record: SignatureRecord } | { ok: false; reason: string } {
  const store = read();
  const list = store[token] ?? [];
  if (partial.id && list.some(r => r.id === partial.id)) {
    return { ok: false, reason: "Signer already signed — record is locked." };
  }
  const sameSigner = list.find(r =>
    r.signerName.trim().toLowerCase() === partial.signerName.trim().toLowerCase() &&
    (r.signerEmail || "").toLowerCase() === (partial.signerEmail || "").toLowerCase()
  );
  if (sameSigner) {
    return { ok: false, reason: `${partial.signerName} has already signed this proposal.` };
  }
  const record: SignatureRecord = {
    ...partial,
    id: partial.id ?? uid(),
    lockedAt: new Date().toISOString(),
    auditLog: partial.auditLog ?? [],
  };
  store[token] = [...list, record];
  write(store);
  try { window.dispatchEvent(new StorageEvent("storage", { key: KEY })); } catch { /* noop */ }
  return { ok: true, record };
}

/** Legacy helper retained for back-compat: delegates to addSignature. */
export function saveSignature(
  token: string,
  record: Omit<SignatureRecord, "lockedAt" | "id" | "auditLog"> & { id?: string; auditLog?: SignatureAuditEvent[] },
): SignatureRecord {
  const r = addSignature(token, record);
  if (r.ok) return r.record;
  return getSignature(token)!;
}

export function appendAudit(token: string, event: SignatureAuditEvent) {
  if (!token) return;
  // Portal-wide events live in the pre-sign log; per-signer events go on that signer's record.
  if (event.signerId) {
    const store = read();
    const list = store[token];
    const rec = list?.find(r => r.id === event.signerId);
    if (rec) {
      rec.auditLog.push(event);
      write(store);
      return;
    }
  }
  try {
    const auditKey = `${KEY}_audit_${token}`;
    const prev = JSON.parse(window.localStorage.getItem(auditKey) ?? "[]") as SignatureAuditEvent[];
    prev.push(event);
    window.localStorage.setItem(auditKey, JSON.stringify(prev));
  } catch { /* noop */ }
}

export function getPreSignAudit(token: string): SignatureAuditEvent[] {
  try {
    const raw = window.localStorage.getItem(`${KEY}_audit_${token}`);
    return raw ? (JSON.parse(raw) as SignatureAuditEvent[]) : [];
  } catch { return []; }
}

/** Merged chronological audit (portal-wide + every signer's events). */
export function getFullAudit(token: string): SignatureAuditEvent[] {
  const pre = getPreSignAudit(token);
  const sigs = getSignatures(token);
  const all: SignatureAuditEvent[] = [...pre];
  for (const s of sigs) {
    for (const e of s.auditLog) {
      all.push({ ...e, signerId: e.signerId ?? s.id, signerName: e.signerName ?? s.signerName });
    }
  }
  const seen = new Set<string>();
  const unique: SignatureAuditEvent[] = [];
  for (const e of all) {
    const k = `${e.event}|${e.at}|${e.signerId ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(e);
  }
  return unique.sort((a, b) => a.at.localeCompare(b.at));
}

export interface GlobalAuditEntry extends SignatureAuditEvent {
  token: string;
}

/** All audit events across every known token. Used by the CRM global viewer. */
export function getGlobalAudit(tokens: string[]): GlobalAuditEntry[] {
  const out: GlobalAuditEntry[] = [];
  for (const t of tokens) {
    for (const e of getFullAudit(t)) out.push({ ...e, token: t });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function buildPortalUrl(token: string): string {
  if (typeof window === "undefined") return `#/portal/${token}`;
  return `${window.location.origin}${window.location.pathname}#/portal/${token}`;
}

// ─── Token hardening ────────────────────────────────────────────────────────

export function isTokenExpired(validUntil: string): boolean {
  const t = Date.parse(validUntil);
  if (isNaN(t)) return false;
  return Date.now() > t + EXPIRY_GRACE_MS;
}

export function tokenExpiresAt(validUntil: string): number | null {
  const t = Date.parse(validUntil);
  if (isNaN(t)) return null;
  return t + EXPIRY_GRACE_MS;
}

function readRate(): RateStore {
  try {
    const raw = window.localStorage.getItem(RATE_KEY);
    return raw ? (JSON.parse(raw) as RateStore) : {};
  } catch { return {}; }
}
function writeRate(s: RateStore) {
  try { window.localStorage.setItem(RATE_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

export function recordPortalOpen(token: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const store = readRate();
  const hits = (store[token] ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    const retryAfterMs = RATE_WINDOW_MS - (now - hits[0]);
    store[token] = hits;
    writeRate(store);
    return { allowed: false, retryAfterMs };
  }
  hits.push(now);
  store[token] = hits;
  writeRate(store);
  return { allowed: true, retryAfterMs: 0 };
}
