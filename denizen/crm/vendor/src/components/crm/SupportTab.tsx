import { useMemo, useState } from "react";
import {
  T, S,
  TICKET_STATUS_META, TICKET_PRIORITIES, TICKET_STATUSES,
  type Contact, type SupportTicket, type TicketHistoryEntry,
} from "@/lib/crm-data";

interface Props {
  tickets: SupportTicket[];
  contacts: Contact[];
  currentUserName: string;
  teamMembers: string[];
  onUpdate: (tickets: SupportTicket[]) => void;
  onSelectContact?: (contact: Contact) => void;
}

function nextId(list: { id: number }[]) {
  return list.length ? Math.max(...list.map((r) => r.id)) + 1 : Date.now();
}

export function SupportTab({
  tickets, contacts, currentUserName, teamMembers, onUpdate, onSelectContact,
}: Props) {
  const [filter, setFilter] = useState<"all" | "mine" | "open">("open");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ subject: "", contact: "", description: "", priority: "medium" as const });
  const [comment, setComment] = useState("");

  const filtered = useMemo(() => {
    let rows = [...tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (filter === "open") rows = rows.filter((t) => t.status === "open" || t.status === "pending");
    if (filter === "mine") {
      const me = currentUserName.toLowerCase();
      rows = rows.filter((t) => t.assignee?.toLowerCase() === me);
    }
    return rows;
  }, [tickets, filter, currentUserName]);

  const selected = tickets.find((t) => t.id === selectedId) || null;
  const openCount = tickets.filter((t) => t.status === "open" || t.status === "pending").length;
  const urgentCount = tickets.filter((t) => t.priority === "urgent" && t.status !== "closed").length;

  const saveNew = () => {
    if (!draft.subject.trim()) return;
    const now = new Date().toISOString();
    const contact = contacts.find((c) => c.name === draft.contact);
    const ticket: SupportTicket = {
      id: nextId(tickets),
      subject: draft.subject.trim(),
      contact: draft.contact || contact?.name || "Unknown",
      contactId: contact?.id,
      status: "open",
      priority: draft.priority,
      assignee: currentUserName,
      createdBy: currentUserName,
      createdAt: now,
      updatedAt: now,
      description: draft.description.trim(),
      history: [{
        id: 1, user: currentUserName, text: "Ticket created", at: now, type: "status",
      }],
      slaDue: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      category: "general",
    };
    onUpdate([ticket, ...tickets]);
    setShowNew(false);
    setDraft({ subject: "", contact: "", description: "", priority: "medium" });
    setSelectedId(ticket.id);
  };

  const patchTicket = (id: number, patch: Partial<SupportTicket>, historyNote?: string) => {
    const now = new Date().toISOString();
    onUpdate(tickets.map((t) => {
      if (t.id !== id) return t;
      const history = [...(t.history || [])];
      if (historyNote) {
        history.push({
          id: nextId(history),
          user: currentUserName,
          text: historyNote,
          at: now,
          type: patch.status ? "status" : patch.assignee ? "assign" : "comment",
        });
      }
      return { ...t, ...patch, updatedAt: now, history };
    }));
  };

  const addComment = () => {
    if (!selected || !comment.trim()) return;
    patchTicket(selected.id, {}, comment.trim());
    setComment("");
  };

  const card = { background: T.bg2, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: 16 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: T.text0 }}>🎧 Support</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: T.text2 }}>
            {openCount} open · {urgentCount} urgent · customer history on each ticket
          </p>
        </div>
        <button type="button" onClick={() => setShowNew(true)} style={S.btn as React.CSSProperties}>+ New ticket</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Open", value: openCount, color: T.blue },
          { label: "Urgent", value: urgentCount, color: T.red },
          { label: "Resolved", value: tickets.filter((t) => t.status === "resolved").length, color: T.green },
        ].map((s) => (
          <div key={s.label} style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: T.text3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["open", "mine", "all"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
            background: filter === f ? `${T.accent}22` : T.bg3,
            border: `1px solid ${filter === f ? T.accent : T.bg4}`,
            color: filter === f ? T.accent : T.text2,
          }}>{f === "mine" ? "My tickets" : f === "open" ? "Open queue" : "All"}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 340px" : "1fr", gap: 16 }}>
        <div>
          {filtered.length === 0 && (
            <div style={{ ...card, color: T.text3, fontSize: 13 }}>No tickets — create one when a customer needs help.</div>
          )}
          {filtered.map((t) => (
            <button key={t.id} type="button" onClick={() => setSelectedId(t.id)} style={{
              ...card, width: "100%", textAlign: "left", cursor: "pointer", marginBottom: 10,
              borderColor: selectedId === t.id ? T.accent : T.bg3,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 600, color: T.text0, fontSize: 14 }}>{t.subject}</span>
                <span style={{ fontSize: 10, color: TICKET_STATUS_META[t.status].color, fontWeight: 700, textTransform: "uppercase" }}>{t.status}</span>
              </div>
              <div style={{ fontSize: 12, color: T.text2, marginTop: 6 }}>{t.contact} · {t.assignee || "Unassigned"}</div>
              <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>{t.updatedAt.slice(0, 16).replace("T", " ")}</div>
            </button>
          ))}
        </div>

        {selected && (
          <div style={{ ...card, position: "sticky", top: 12, alignSelf: "start" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, color: T.text0 }}>{selected.subject}</h2>
            <p style={{ fontSize: 12, color: T.text2, margin: "0 0 12px" }}>{selected.description}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              <select value={selected.status} onChange={(e) => patchTicket(selected.id, { status: e.target.value as SupportTicket["status"] }, `Status → ${e.target.value}`)} style={S.input as React.CSSProperties}>
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={selected.priority} onChange={(e) => patchTicket(selected.id, { priority: e.target.value as SupportTicket["priority"] }, `Priority → ${e.target.value}`)} style={S.input as React.CSSProperties}>
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={selected.assignee || ""} onChange={(e) => patchTicket(selected.id, { assignee: e.target.value }, `Assigned to ${e.target.value}`)} style={S.input as React.CSSProperties}>
                <option value="">Unassigned</option>
                {teamMembers.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {selected.contactId && onSelectContact && (
              <button type="button" onClick={() => {
                const c = contacts.find((x) => x.id === selected.contactId);
                if (c) onSelectContact(c);
              }} style={{ ...S.btnGhost as React.CSSProperties, marginBottom: 12, fontSize: 11 }}>View customer history</button>
            )}
            <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 10 }}>
              {(selected.history || []).slice().reverse().map((h) => (
                <div key={h.id} style={{ fontSize: 11, color: T.text2, padding: "6px 0", borderBottom: `1px solid ${T.bg3}` }}>
                  <strong>{h.user}</strong> · {h.text}
                  <div style={{ color: T.text3, fontSize: 9 }}>{h.at.slice(0, 16).replace("T", " ")}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add note…" style={{ ...S.input as React.CSSProperties, flex: 1 }} />
              <button type="button" onClick={addComment} style={S.btn as React.CSSProperties}>Post</button>
            </div>
          </div>
        )}
      </div>

      {showNew && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ ...card, width: "min(480px, 92vw)" }}>
            <h3 style={{ margin: "0 0 12px", color: T.text0 }}>New support ticket</h3>
            <input placeholder="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} style={{ ...S.input as React.CSSProperties, width: "100%", marginBottom: 8 }} />
            <select value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} style={{ ...S.input as React.CSSProperties, width: "100%", marginBottom: 8 }}>
              <option value="">Select contact</option>
              {contacts.map((c) => <option key={c.id} value={c.name}>{c.name} — {c.company}</option>)}
            </select>
            <textarea placeholder="Describe the issue…" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={4} style={{ ...S.input as React.CSSProperties, width: "100%", marginBottom: 8, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowNew(false)} style={S.btnGhost as React.CSSProperties}>Cancel</button>
              <button type="button" onClick={saveNew} style={S.btn as React.CSSProperties}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
