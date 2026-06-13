import { useEffect, useMemo, useState } from "react";
import { T, S } from "@/lib/crm-data";
import { getFullAudit, getGlobalAudit, getSignatures, type SignatureAuditEvent, type SignatureEventType, type GlobalAuditEntry } from "@/lib/signature-store";

const ICONS: Record<SignatureEventType, string> = {
  portal_opened: "👁",
  viewed: "👁",
  link_copied: "🔗",
  signed: "✍️",
  downloaded: "📄",
  portal_blocked: "🛑",
  receipt_emailed: "📧",
  lock_attempt_blocked: "🔒",
};

const COLORS: Record<SignatureEventType, string> = {
  portal_opened: T.blue,
  viewed: T.blue,
  link_copied: T.text2,
  signed: T.green,
  downloaded: T.accent,
  portal_blocked: T.red,
  receipt_emailed: T.blue,
  lock_attempt_blocked: T.red,
};

const ALL_EVENTS: SignatureEventType[] = [
  "portal_opened", "viewed", "link_copied", "signed", "downloaded",
  "portal_blocked", "receipt_emailed", "lock_attempt_blocked",
];

const PAGE_SIZE = 8;

interface Props {
  token: string;
  showUserAgent?: boolean;
  /** Enable inline filter + pagination controls (defaults to true). */
  enableFilters?: boolean;
}

export function AuditTrailViewer({ token, showUserAgent = true, enableFilters = true }: Props) {
  const [events, setEvents] = useState<SignatureAuditEvent[]>(() => getFullAudit(token));
  const [signerFilter, setSignerFilter] = useState<string>("all");
  const [eventFilter, setEventFilter] = useState<SignatureEventType | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const refresh = () => setEvents(getFullAudit(token));
    window.addEventListener("storage", refresh);
    const id = window.setInterval(refresh, 3000);
    return () => { window.removeEventListener("storage", refresh); window.clearInterval(id); };
  }, [token]);

  const signers = useMemo(() => getSignatures(token), [token, events.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter(e => {
      if (eventFilter !== "all" && e.event !== eventFilter) return false;
      if (signerFilter !== "all" && (e.signerId ?? "_none") !== signerFilter) return false;
      if (q) {
        const hay = `${e.detail ?? ""} ${e.signerName ?? ""} ${e.event}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, signerFilter, eventFilter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  if (events.length === 0) {
    return (
      <div style={emptyStyle}>
        No portal activity yet. Events appear here once the client opens the link.
      </div>
    );
  }

  return (
    <div>
      {enableFilters && (
        <FilterBar
          signers={[{ id: "_none", name: "Portal-wide" }, ...signers.map(s => ({ id: s.id, name: s.signerName }))]}
          signerFilter={signerFilter}
          setSignerFilter={(v) => { setSignerFilter(v); setPage(0); }}
          eventFilter={eventFilter}
          setEventFilter={(v) => { setEventFilter(v); setPage(0); }}
          query={query}
          setQuery={(v) => { setQuery(v); setPage(0); }}
          counts={{ filtered: filtered.length, total: events.length }}
        />
      )}
      <div style={{ background: T.bg3, borderRadius: T.radius.md, padding: "4px 0", border: `1px solid ${T.bg4}` }}>
        {pageItems.length === 0 ? (
          <div style={{ padding: "20px 14px", fontSize: 12, color: T.text3, textAlign: "center" }}>
            No events match the current filters.
          </div>
        ) : pageItems.map((e, i) => <EventRow key={`${e.event}-${e.at}-${i}`} e={e} first={i === 0} showUserAgent={showUserAgent} />)}
      </div>
      {filtered.length > PAGE_SIZE && (
        <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}

// ─── Global viewer (cross-quote) ─────────────────────────────────────────────

interface GlobalProps {
  /** Map of portalToken → human label (e.g. "Acme Corp — Pro plan") */
  tokenLabels: Record<string, string>;
}

export function GlobalAuditViewer({ tokenLabels }: GlobalProps) {
  const tokens = useMemo(() => Object.keys(tokenLabels), [tokenLabels]);
  const [events, setEvents] = useState<GlobalAuditEntry[]>(() => getGlobalAudit(tokens));
  const [tokenFilter, setTokenFilter] = useState<string>("all");
  const [signerFilter, setSignerFilter] = useState<string>("all");
  const [eventFilter, setEventFilter] = useState<SignatureEventType | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const refresh = () => setEvents(getGlobalAudit(tokens));
    window.addEventListener("storage", refresh);
    const id = window.setInterval(refresh, 4000);
    return () => { window.removeEventListener("storage", refresh); window.clearInterval(id); };
  }, [tokens.join("|")]);

  const allSigners = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of tokens) for (const s of getSignatures(t)) seen.set(s.id, s.signerName);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [tokens, events.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter(e => {
      if (tokenFilter !== "all" && e.token !== tokenFilter) return false;
      if (eventFilter !== "all" && e.event !== eventFilter) return false;
      if (signerFilter !== "all" && (e.signerId ?? "_none") !== signerFilter) return false;
      if (q) {
        const hay = `${e.detail ?? ""} ${e.signerName ?? ""} ${e.event} ${tokenLabels[e.token] ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, tokenFilter, signerFilter, eventFilter, query, tokenLabels]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  if (events.length === 0) {
    return <div style={emptyStyle}>No portal activity yet across any quote.</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <Select label="Quote" value={tokenFilter} onChange={(v) => { setTokenFilter(v); setPage(0); }}
          options={[{ value: "all", label: `All quotes (${tokens.length})` }, ...tokens.map(t => ({ value: t, label: tokenLabels[t] ?? t }))]} />
        <Select label="Signer" value={signerFilter} onChange={(v) => { setSignerFilter(v); setPage(0); }}
          options={[{ value: "all", label: "All signers" }, { value: "_none", label: "Portal-wide" }, ...allSigners.map(s => ({ value: s.id, label: s.name }))]} />
        <Select label="Event" value={eventFilter} onChange={(v) => { setEventFilter(v as SignatureEventType | "all"); setPage(0); }}
          options={[{ value: "all", label: "All events" }, ...ALL_EVENTS.map(ev => ({ value: ev, label: ev.replace(/_/g, " ") }))]} />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          placeholder="Search detail, signer…"
          style={{ ...(S.input as React.CSSProperties), flex: "1 1 180px", minWidth: 160, padding: "6px 10px", fontSize: 12 }}
        />
        <span style={{ fontSize: 11, color: T.text3, alignSelf: "center" }}>
          {filtered.length} of {events.length}
        </span>
      </div>

      <div style={{ background: T.bg3, borderRadius: T.radius.md, padding: "4px 0", border: `1px solid ${T.bg4}` }}>
        {pageItems.length === 0 ? (
          <div style={{ padding: "20px 14px", fontSize: 12, color: T.text3, textAlign: "center" }}>No events match.</div>
        ) : pageItems.map((e, i) => (
          <EventRow
            key={`${e.token}-${e.event}-${e.at}-${i}`}
            e={e}
            first={i === 0}
            showUserAgent
            tokenLabel={tokenLabels[e.token]}
          />
        ))}
      </div>
      {filtered.length > PAGE_SIZE && <Pager page={safePage} totalPages={totalPages} onChange={setPage} />}
    </div>
  );
}

// ─── shared bits ─────────────────────────────────────────────────────────────

function FilterBar({ signers, signerFilter, setSignerFilter, eventFilter, setEventFilter, query, setQuery, counts }: {
  signers: { id: string; name: string }[];
  signerFilter: string; setSignerFilter: (v: string) => void;
  eventFilter: SignatureEventType | "all"; setEventFilter: (v: SignatureEventType | "all") => void;
  query: string; setQuery: (v: string) => void;
  counts: { filtered: number; total: number };
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      <Select label="Signer" value={signerFilter} onChange={setSignerFilter}
        options={[{ value: "all", label: "All signers" }, ...signers.map(s => ({ value: s.id, label: s.name }))]} />
      <Select label="Event" value={eventFilter} onChange={(v) => setEventFilter(v as SignatureEventType | "all")}
        options={[{ value: "all", label: "All events" }, ...ALL_EVENTS.map(ev => ({ value: ev, label: ev.replace(/_/g, " ") }))]} />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        style={{ ...(S.input as React.CSSProperties), flex: "1 1 160px", minWidth: 140, padding: "6px 10px", fontSize: 12 }}
      />
      <span style={{ fontSize: 11, color: T.text3, alignSelf: "center" }}>
        {counts.filtered} of {counts.total}
      </span>
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: T.text3 }}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: T.bg3, color: T.text1, border: `1px solid ${T.bg4}`,
          borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: "pointer",
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function EventRow({ e, first, showUserAgent, tokenLabel }: { e: SignatureAuditEvent; first: boolean; showUserAgent: boolean; tokenLabel?: string }) {
  const color = COLORS[e.event] ?? T.text2;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "28px 1fr auto",
      gap: 10, alignItems: "start",
      padding: "10px 14px",
      borderTop: first ? "none" : `1px solid ${T.bg4}`,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: `${color}18`, color, fontSize: 13,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{ICONS[e.event] ?? "•"}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {e.event.replace(/_/g, " ")}
          {e.signerName && <span style={{ marginLeft: 8, color: T.text2, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>· {e.signerName}</span>}
          {tokenLabel && <span style={{ marginLeft: 8, color: T.text3, fontWeight: 500, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>· {tokenLabel}</span>}
        </div>
        {e.detail && <div style={{ fontSize: 12, color: T.text2, marginTop: 2, lineHeight: 1.5 }}>{e.detail}</div>}
        {showUserAgent && e.userAgent && (
          <div style={{
            fontSize: 10, color: T.text3, marginTop: 4,
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            maxWidth: "100%",
          }} title={e.userAgent}>{summarizeUserAgent(e.userAgent)}</div>
        )}
      </div>
      <div style={{ fontSize: 11, color: T.text3, whiteSpace: "nowrap", textAlign: "right" }}>
        {formatRelative(e.at)}
        <div style={{ fontSize: 10, opacity: 0.7 }}>{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    </div>
  );
}

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const btn: React.CSSProperties = {
    background: T.bg3, border: `1px solid ${T.bg4}`, color: T.text2,
    borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer",
  };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, fontSize: 11, color: T.text3 }}>
      <button onClick={() => onChange(Math.max(0, page - 1))} disabled={page === 0} style={{ ...btn, opacity: page === 0 ? 0.4 : 1 }}>← Prev</button>
      <span>Page {page + 1} of {totalPages}</span>
      <button onClick={() => onChange(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={{ ...btn, opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Next →</button>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: "14px 16px",
  background: T.bg3,
  border: `1px dashed ${T.bg4}`,
  borderRadius: T.radius.md,
  fontSize: 12,
  color: T.text3,
  textAlign: "center",
};

function formatRelative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (isNaN(diff)) return iso;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function summarizeUserAgent(ua: string): string {
  if (/iPhone|iPad/i.test(ua)) return "iOS · " + (/Safari/.test(ua) ? "Safari" : "Browser");
  if (/Android/i.test(ua)) return "Android · " + (/Chrome/.test(ua) ? "Chrome" : "Browser");
  if (/Edg\//.test(ua)) return "Desktop · Edge";
  if (/Chrome/.test(ua)) return "Desktop · Chrome";
  if (/Firefox/.test(ua)) return "Desktop · Firefox";
  if (/Safari/.test(ua)) return "Desktop · Safari";
  return ua.slice(0, 60);
}
